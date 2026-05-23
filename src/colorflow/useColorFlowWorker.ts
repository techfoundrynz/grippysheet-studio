import { useCallback, useEffect, useRef, useState } from 'react';
import type { Request, Response } from './workerProtocol';
import ColorFlowWorker from './worker?worker';

/** Distributive Omit: correctly removes 'id' from each member of the union. */
type OmitId<T> = T extends unknown ? Omit<T, 'id'> : never;

export interface WorkerStatus {
  phase: string | null;
  error: string | null;
}

/** Thrown when a request is superseded by a later request of the same kind.
 *  Callers should treat this as a benign "drop the result" signal. */
export class RequestCancelledError extends Error {
  constructor(kind: string) {
    super(`ColorFlow request superseded (${kind})`);
    this.name = 'RequestCancelledError';
  }
}

let nextId = 1;

type RequestKind = OmitId<Request>['kind'];
interface PendingEntry {
  kind: RequestKind;
  resolve: (r: Response) => void;
  reject: (e: Error) => void;
}

export function useColorFlowWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<number, PendingEntry>>(new Map());
  /** id of the latest in-flight request per kind. Older requests with the
   *  same kind are superseded. */
  const latestIdByKindRef = useRef<Map<RequestKind, number>>(new Map());
  const [status, setStatus] = useState<WorkerStatus>({ phase: null, error: null });

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const w = new ColorFlowWorker();
    w.onmessage = (e: MessageEvent<Response>) => {
      const msg = e.data;
      const pending = pendingRef.current.get(msg.id);

      if (msg.kind === 'progress') {
        // Only the latest in-flight request drives the pill, so stale progress
        // messages from a superseded run can't clobber the live phase.
        if (pending && latestIdByKindRef.current.get(pending.kind) === msg.id) {
          setStatus({ phase: msg.phase, error: null });
        }
        return;
      }

      if (!pending) return; // already cancelled and cleaned up
      pendingRef.current.delete(msg.id);

      // Drop terminal responses for superseded requests; the new in-flight
      // request of the same kind will drive both state and the pill.
      const isLatest = latestIdByKindRef.current.get(pending.kind) === msg.id;

      if (msg.kind === 'error') {
        if (isLatest) {
          setStatus({ phase: null, error: msg.message });
          pending.reject(new Error(`${msg.phase}: ${msg.message}`));
        } else {
          pending.reject(new RequestCancelledError(pending.kind));
        }
        return;
      }

      // Success path: only resolve if still latest; otherwise reject as cancelled.
      if (isLatest) {
        setStatus({ phase: null, error: null });
        pending.resolve(msg);
      } else {
        pending.reject(new RequestCancelledError(pending.kind));
      }
    };
    w.onerror = (e) => {
      setStatus({ phase: null, error: e.message });
      // Reject any in-flight requests; tear down so next request spawns a fresh worker.
      for (const [, p] of pendingRef.current) p.reject(new Error(e.message));
      pendingRef.current.clear();
      latestIdByKindRef.current.clear();
      w.terminate();
      workerRef.current = null;
    };
    workerRef.current = w;
    return w;
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const request = useCallback(<R extends Response>(
    req: OmitId<Request>,
    transfer: Transferable[] = [],
  ): Promise<R> => {
    const w = ensureWorker();
    const id = nextId++;
    const kind = req.kind;

    // Supersede any in-flight request of the same kind.
    const prevId = latestIdByKindRef.current.get(kind);
    if (prevId !== undefined && prevId !== id) {
      const prev = pendingRef.current.get(prevId);
      if (prev) {
        pendingRef.current.delete(prevId);
        prev.reject(new RequestCancelledError(kind));
      }
    }
    latestIdByKindRef.current.set(kind, id);

    return new Promise<R>((resolve, reject) => {
      pendingRef.current.set(id, {
        kind,
        resolve: resolve as (r: Response) => void,
        reject,
      });
      w.postMessage({ ...req, id }, transfer);
    });
  }, [ensureWorker]);

  return { request, status };
}
