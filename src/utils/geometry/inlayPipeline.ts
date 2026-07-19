import type { ManifoldToplevel } from 'manifold-3d';
import { SerializedShape, SerializedGeometry, geometryTransferables } from './serialize';
import { ManifoldOps, M } from './manifoldOps';

/**
 * Pure inlay generator (Manifold). Extrudes each inlay shape, bakes its per-item /
 * per-tile transform, then subtracts base holes and intersects the base outline —
 * the CSG that used to run synchronously on the main thread and stall on drag-release.
 *
 * Returns geometry buffers named `Inlay_<id>_<tile>_<shape>` (matching the inline
 * placeholders and the eventBus drag path). Materials are built by the caller.
 */

export interface InlayJobShape {
  shape: SerializedShape;
  color: string; // may be 'base' (resolved on the main thread)
}

export interface InlayJobItem {
  id: string;
  itemIndex: number; // i — drives the (i+1)*0.001 z-stack epsilon
  scale: number;
  rotation: number; // degrees
  mirror: boolean;
  x: number;
  y: number;
  depth: number;
  extend: number;
  positions: { x: number; y: number; rot: number }[]; // tile placements (rot in radians)
  shapes: InlayJobShape[];
}

export interface InlayJob {
  jobId: number;
  thickness: number;
  /** max(patternScaleZ||0, maxInlayExtend) — sizes the shared hole/outline cutters. */
  cutterExtra: number;
  filledCutoutShapes: SerializedShape[];
  holeShapes: SerializedShape[];
  items: InlayJobItem[];
}

export interface InlayPart {
  name: string;
  geometry: SerializedGeometry;
  color: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface InlayResult {
  jobId: number;
  parts: InlayPart[];
}

export function inlayResultTransferables(r: InlayResult): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const p of r.parts) out.push(...geometryTransferables(p.geometry));
  return out;
}

export function generateInlay(job: InlayJob, wasm: ManifoldToplevel): InlayResult {
  const ops = new ManifoldOps(wasm);
  const { Manifold } = ops;
  const parts: InlayPart[] = [];

  const hasHoles = job.holeShapes.length > 0;
  const hasClip = job.filledCutoutShapes.length > 0;

  try {
    // Shared cutters (built once, reused for every item — the legacy code rebuilt these
    // per shape). Depths mirror the legacy inlay effect.
    let holeSolid: M | null = null;
    let outlineSolid: M | null = null;
    if (hasHoles) {
      const cs = ops.csFromShapes(job.holeShapes);
      if (cs) {
        const holeDepth = job.thickness + job.cutterExtra + 20;
        holeSolid = ops.track(ops.track(Manifold.extrude(cs, holeDepth)).translate(0, 0, -10));
      }
    }
    if (hasClip) {
      const cs = ops.csFromShapes(job.filledCutoutShapes);
      if (cs) {
        const cutterDepth = job.thickness + job.cutterExtra + 5;
        outlineSolid = ops.track(Manifold.extrude(cs, cutterDepth));
      }
    }

    for (const item of job.items) {
      item.positions.forEach((pos, tileIdx) => {
        item.shapes.forEach((sh, shapeIdx) => {
          if (sh.color === 'transparent') return;
          const cs = ops.csFromShape(sh.shape, item.mirror);
          if (!cs) return;

          const totalDepth = item.depth + item.extend + (item.itemIndex + 1) * 0.001;
          let solid = ops.track(Manifold.extrude(cs, totalDepth));

          // Bake transforms in the same order as the legacy ExtrudeGeometry path:
          // translate-Z, scale XY, rotate Z, translate XY.
          // Capped per-shape z-stagger (see ImperativeModel): breaks z-fighting between a few
          // overlapping shapes without letting a many-shape inlay creep above the surface.
          const zTrans = job.thickness - item.depth + Math.min(shapeIdx, 20) * 0.002;
          const totalRotDeg = item.rotation + (pos.rot * 180) / Math.PI;
          solid = ops.track(solid.translate(0, 0, zTrans));
          solid = ops.track(solid.scale([item.scale, item.scale, 1]));
          if (totalRotDeg !== 0) solid = ops.track(solid.rotate(0, 0, totalRotDeg));
          solid = ops.track(solid.translate(pos.x + item.x, pos.y + item.y, 0));

          if (hasHoles && holeSolid) solid = ops.track(solid.subtract(holeSolid));
          if (hasClip && outlineSolid) solid = ops.track(solid.intersect(outlineSolid));

          if (solid.numTri() > 0) {
            parts.push({
              name: `Inlay_${item.id}_${tileIdx}_${shapeIdx}`,
              geometry: ops.serializeMesh(solid, true),
              color: sh.color,
              castShadow: true,
              receiveShadow: true,
            });
          }
        });
      });
    }

    return { jobId: job.jobId, parts };
  } finally {
    ops.flush();
  }
}
