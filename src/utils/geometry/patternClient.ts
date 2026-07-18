import { PatternJob, PatternResult } from './patternPipeline';
import { InlayJob, InlayResult } from './inlayPipeline';
import { geometryTransferables } from './serialize';

/**
 * Main-thread manager for the geometry worker (pattern + inlay).
 *
 * The worker is single-threaded and a running Manifold job can't be interrupted, so we
 * avoid letting stale work pile up: at most ONE job is in flight, plus ONE pending
 * "latest" job per kind. Rapid input changes overwrite the pending slot, so intermediate
 * values are coalesced away — the worker computes the in-flight job, then jumps straight
 * to the newest values instead of grinding through every queued change.
 *
 * Latest-wins delivery still applies: an in-flight result that has since been superseded
 * is dropped rather than applied.
 */
type Kind = 'pattern' | 'inlay';

interface Slot {
  kind: Kind;
  jobId: number;
  job: PatternJob | InlayJob;
  transfer: ArrayBuffer[];
  cb: (r: unknown) => void;
  cancelled: boolean;
}

class GeometryWorkerClient {
  private worker: Worker | null = null;
  private counter = 0;
  private latest: Record<Kind, number> = { pattern: 0, inlay: 0 };
  private slots: Record<Kind, Slot | null> = { pattern: null, inlay: null };
  private inFlight: Slot | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../../workers/geometryWorker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<{ kind: Kind; result: { jobId: number } }>) =>
        this.onMessage(e.data);
      this.worker.onerror = (e) => {
        console.error('[geometryClient] worker error:', e.message);
        // Unblock the pump so a wedged in-flight job doesn't stall everything.
        this.inFlight = null;
        this.pump();
      };
    }
    return this.worker;
  }

  private onMessage(msg: { kind: Kind; result: { jobId: number } }) {
    const done = this.inFlight;
    this.inFlight = null;
    // Deliver only if this job is still the newest of its kind and wasn't cancelled.
    if (done && !done.cancelled && done.jobId === this.latest[done.kind]) done.cb(msg.result);
    this.pump();
  }

  private pump() {
    if (this.inFlight) return;
    // Send whichever kind has a pending latest (pattern first, then inlay next cycle).
    const next = this.slots.pattern ?? this.slots.inlay;
    if (!next) return;
    this.slots[next.kind] = null;
    this.inFlight = next;
    this.ensureWorker().postMessage({ kind: next.kind, job: next.job }, next.transfer);
  }

  private enqueue(kind: Kind, job: PatternJob | InlayJob, transfer: ArrayBuffer[], cb: (r: unknown) => void) {
    const id = ++this.counter;
    job.jobId = id;
    this.latest[kind] = id;
    const slot: Slot = { kind, jobId: id, job, transfer, cb, cancelled: false };
    this.slots[kind] = slot; // coalesce — overwrite any older pending job of this kind
    this.ensureWorker();
    this.pump();
    return {
      cancel: () => {
        if (this.slots[kind] === slot) this.slots[kind] = null;
        if (this.inFlight === slot) this.inFlight.cancelled = true;
      },
    };
  }

  submitPattern(job: PatternJob, cb: (r: PatternResult) => void): { cancel: () => void } {
    const transfer =
      job.patternUnit.kind === 'geometry' ? geometryTransferables(job.patternUnit.geometry) : [];
    return this.enqueue('pattern', job, transfer, cb as (r: unknown) => void);
  }

  submitInlay(job: InlayJob, cb: (r: InlayResult) => void): { cancel: () => void } {
    return this.enqueue('inlay', job, [], cb as (r: unknown) => void);
  }
}

export const geometryWorkerClient = new GeometryWorkerClient();
