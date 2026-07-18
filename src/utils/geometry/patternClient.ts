import { PatternJob, PatternResult } from './patternPipeline';
import { geometryTransferables } from './serialize';

/**
 * Main-thread manager for the geometry worker.
 *
 * - Owns a single module Worker (lazily created).
 * - Assigns a monotonic jobId to every submission.
 * - Latest-wins cancellation: only the newest job's result is delivered; results
 *   for superseded jobs are dropped, so rapid setting changes never apply stale
 *   geometry. The worker itself stays responsive because it runs off the UI thread.
 */
class PatternWorkerClient {
  private worker: Worker | null = null;
  private counter = 0;
  private latestJobId = 0;
  private pending = new Map<number, (r: PatternResult) => void>();

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../../workers/geometryWorker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<PatternResult>) => this.onMessage(e.data);
      this.worker.onerror = (e) => console.error('[patternClient] worker error:', e.message);
    }
    return this.worker;
  }

  private onMessage(result: PatternResult) {
    const cb = this.pending.get(result.jobId);
    this.pending.delete(result.jobId);
    // Drop stale results — only deliver the newest requested job.
    if (result.jobId === this.latestJobId && cb) cb(result);
  }

  /**
   * Submit a job. The jobId field is assigned here (any incoming value is overwritten).
   * Returns a handle whose cancel() prevents this job's callback from firing.
   */
  submit(job: PatternJob, cb: (r: PatternResult) => void): { cancel: () => void } {
    const worker = this.ensureWorker();
    const id = ++this.counter;
    job.jobId = id;
    this.latestJobId = id;
    this.pending.set(id, cb);

    // Transfer the pattern-unit geometry buffers when present (they are copies made
    // during serialization, so the scene-graph originals are unaffected).
    const transfer: ArrayBuffer[] =
      job.patternUnit.kind === 'geometry' ? geometryTransferables(job.patternUnit.geometry) : [];

    worker.postMessage(job, transfer);
    return {
      cancel: () => {
        this.pending.delete(id);
      },
    };
  }
}

export const patternWorkerClient = new PatternWorkerClient();
