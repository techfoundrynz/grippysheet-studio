import { useCallback, useEffect, useRef, useState } from 'react';
import type { Request, Response } from './workerProtocol';
import ColorFlowWorker from './worker?worker';

/** Distributive Omit: correctly removes 'id' from each member of the union. */
type OmitId<T> = T extends unknown ? Omit<T, 'id'> : never;

export interface WorkerStatus {
  phase: string | null;
  error: string | null;
}

let nextId = 1;

export function useColorFlowWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void }>>(new Map());
  const [status, setStatus] = useState<WorkerStatus>({ phase: null, error: null });

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const w = new ColorFlowWorker();
    w.onmessage = (e: MessageEvent<Response>) => {
      const msg = e.data;
      if (msg.kind === 'progress') {
        setStatus({ phase: msg.phase, error: null });
        return;
      }
      const pending = pendingRef.current.get(msg.id);
      if (!pending) return;
      pendingRef.current.delete(msg.id);
      if (msg.kind === 'error') {
        setStatus({ phase: null, error: msg.message });
        pending.reject(new Error(`${msg.phase}: ${msg.message}`));
      } else {
        setStatus({ phase: null, error: null });
        pending.resolve(msg);
      }
    };
    w.onerror = (e) => {
      setStatus({ phase: null, error: e.message });
      // Reject any in-flight requests; tear down so next request spawns a fresh worker.
      for (const [, pending] of pendingRef.current) {
        pending.reject(new Error(e.message));
      }
      pendingRef.current.clear();
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

  const request = useCallback(<R extends Response>(req: OmitId<Request>, transfer: Transferable[] = []): Promise<R> => {
    const w = ensureWorker();
    const id = nextId++;
    return new Promise<R>((resolve, reject) => {
      pendingRef.current.set(id, { resolve: resolve as (r: Response) => void, reject });
      w.postMessage({ ...req, id }, transfer);
    });
  }, [ensureWorker]);

  return { request, status };
}
