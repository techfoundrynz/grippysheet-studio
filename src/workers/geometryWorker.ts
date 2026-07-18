/// <reference lib="webworker" />
import {
  generatePattern,
  patternResultTransferables,
  PatternJob,
  PatternResult,
} from '../utils/geometry/patternPipeline';

/**
 * Geometry worker. Receives a serialized PatternJob, runs the pure pipeline
 * (extrude + tile + three-bvh-csg booleans) off the main thread, and posts the
 * result back with its geometry buffers transferred (zero-copy).
 */
self.onmessage = (e: MessageEvent<PatternJob>) => {
  const job = e.data;
  try {
    const result = generatePattern(job);
    (self as unknown as Worker).postMessage(result, patternResultTransferables(result));
  } catch (err) {
    const fallback: PatternResult = { jobId: job.jobId, parts: [], empty: true };
    (self as unknown as Worker).postMessage(fallback);
    // Surface in the worker console for debugging.
    console.error('[geometryWorker] generation failed:', err);
  }
};
