/// <reference lib="webworker" />
import {
  generatePattern,
  patternResultTransferables,
  PatternJob,
  PatternResult,
} from '../utils/geometry/patternPipeline';
import {
  generateInlay,
  inlayResultTransferables,
  InlayJob,
  InlayResult,
} from '../utils/geometry/inlayPipeline';
import { getManifold } from '../utils/geometry/manifoldModule';

/**
 * Geometry worker. Runs the Manifold pipelines (pattern + inlay) off the main thread
 * and posts results back with geometry buffers transferred (zero-copy). The wasm
 * module is loaded once (cached) and awaited before the first job.
 */
type WorkerRequest =
  | { kind: 'pattern'; job: PatternJob }
  | { kind: 'inlay'; job: InlayJob };

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    const wasm = await getManifold();
    if (req.kind === 'pattern') {
      const result = generatePattern(req.job, wasm);
      (self as unknown as Worker).postMessage({ kind: 'pattern', result }, patternResultTransferables(result));
    } else {
      const result = generateInlay(req.job, wasm);
      (self as unknown as Worker).postMessage({ kind: 'inlay', result }, inlayResultTransferables(result));
    }
  } catch (err) {
    const empty =
      req.kind === 'pattern'
        ? ({ jobId: req.job.jobId, parts: [], empty: true } as PatternResult)
        : ({ jobId: req.job.jobId, parts: [] } as InlayResult);
    (self as unknown as Worker).postMessage({ kind: req.kind, result: empty });
    console.error(`[geometryWorker] ${req.kind} generation failed:`, err);
  }
};
