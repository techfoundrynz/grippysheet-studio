import * as THREE from 'three';
import type { ManifoldToplevel, Mat4 } from 'manifold-3d';
import { generateTilePositions, getShapesBounds } from '../patternUtils';
import { SerializedShape, SerializedGeometry, deserializeShapes, geometryTransferables } from './serialize';
import { ManifoldOps, M, CS } from './manifoldOps';

/**
 * Pure, framework-free pattern generator built on Manifold (manifold-3d / wasm).
 *
 * All boolean geometry runs through Manifold: 2D offset/union/clip via CrossSection
 * (Clipper2), extrusion + 3D booleans via Manifold. Output is guaranteed watertight,
 * so the coplanar Z-expansion hacks the three-bvh-csg version needed are gone.
 *
 * No React, no scene graph, no DOM — runs inside the geometry worker. The caller turns
 * the returned MaterialSpec + geometry buffers into Mesh/Material (the only DOM/GL step).
 */

export type TilingDistribution =
  | 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave' | 'zigzag' | 'warped-grid';
export type TilingOrientation = 'none' | 'alternate' | 'random' | 'aligned';
export type TilingDirection = 'horizontal' | 'vertical';
export type HoleMode = 'default' | 'margin' | 'avoid';

/** How the main thread should build the material for a part. */
export type MaterialSpec =
  | { type: 'pattern' }
  | { type: 'masked'; color: string }
  | { type: 'basic'; colorHex: number; opacity: number; transparent: boolean; depthWrite: boolean };

export interface MeshPart {
  name: string;
  geometry: SerializedGeometry;
  material: MaterialSpec;
  castShadow?: boolean;
  receiveShadow?: boolean;
  translateZ?: number;
  visible?: boolean;
}

export interface InstancedPart {
  unit: SerializedGeometry;
  /** Flat array of 4x4 matrices, 16 floats per instance (column-major, THREE order). */
  matrices: Float32Array;
  count: number;
}

export type PatternUnit =
  | { kind: 'shapes'; shapes: SerializedShape[] }
  | { kind: 'geometry'; geometry: SerializedGeometry };

export interface PatternJob {
  jobId: number;

  size: number;
  thickness: number;
  patternScale: number;
  patternScaleZ?: number;
  isTiled: boolean;
  tileSpacing: number;
  patternMargin: number;
  holeMode: HoleMode;
  tilingDistribution: TilingDistribution;
  tilingDirection: TilingDirection;
  tilingOrientation: TilingOrientation;
  baseRotation: number;
  rotationClamp?: number;
  patternMaxHeight?: number;
  clipToOutline: boolean;
  maxInlayExtend: number;

  filledCutoutShapes: SerializedShape[];
  holeShapes: SerializedShape[];
  patternUnit: PatternUnit;
  exclusionShapes: SerializedShape[];
  inclusionShapes: SerializedShape[];
  avoidShapes: SerializedShape[];
  maskShapes: { shape: SerializedShape; color: string }[];

  debugPattern: boolean;
  debugHole: boolean;
  debugInlay: boolean;
}

export interface PatternResult {
  jobId: number;
  instanced?: InstancedPart;
  parts: MeshPart[];
  empty: boolean;
}

/** Collect all Transferable buffers from a result for a zero-copy postMessage. */
export function patternResultTransferables(r: PatternResult): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  if (r.instanced) {
    out.push(...geometryTransferables(r.instanced.unit));
    out.push(r.instanced.matrices.buffer as ArrayBuffer);
  }
  for (const p of r.parts) out.push(...geometryTransferables(p.geometry));
  return out;
}

export function generatePattern(job: PatternJob, wasm: ManifoldToplevel): PatternResult {
  const ops = new ManifoldOps(wasm);
  const { Manifold, CrossSection } = ops;
  const track = ops.track;
  const parts: MeshPart[] = [];

  const {
    size, thickness, patternScale, patternScaleZ, isTiled, tileSpacing, patternMargin,
    holeMode, tilingDistribution, tilingDirection, tilingOrientation, baseRotation,
    rotationClamp, patternMaxHeight, clipToOutline, maxInlayExtend,
  } = job;

  // Extrude shapes into a solid tall enough to span the whole model in Z (through-cutter).
  const spanHeight = thickness + Math.max(patternMaxHeight || 0, maxInlayExtend, 100) + 100;
  const spanExtrude = (cs: CS): M => track(track(Manifold.extrude(cs, spanHeight * 2)).translate(0, 0, -spanHeight));

  const basicPart = (name: string, m: M, colorHex: number, opacity: number): MeshPart => ({
    name,
    geometry: ops.serializeMesh(m, false),
    material: { type: 'basic', colorHex, opacity, transparent: true, depthWrite: false },
    visible: true,
  });

  const empty = (): PatternResult => {
    ops.flush();
    return { jobId: job.jobId, parts, empty: true };
  };

  try {
    // ---- A. Unit solid ----
    let unit: M | null = null;
    if (job.patternUnit.kind === 'geometry') {
      unit = ops.manifoldFromGeometry(job.patternUnit.geometry); // throws if the STL is not watertight
    } else {
      const cs = ops.csFromShapes(job.patternUnit.shapes, 'EvenOdd');
      if (cs) unit = track(Manifold.extrude(cs, 1));
    }
    if (!unit || unit.numTri() === 0) return empty();

    // Center the unit in X/Y/Z
    let box = unit.boundingBox();
    unit = track(unit.translate(
      -(box.min[0] + box.max[0]) / 2,
      -(box.min[1] + box.max[1]) / 2,
      -(box.min[2] + box.max[2]) / 2,
    ));

    // Base rotation of the pattern unit (with optional clamp)
    if (baseRotation !== 0) {
      let rot = baseRotation;
      if (rotationClamp && rotationClamp > 0) rot = Math.round(baseRotation / rotationClamp) * rotationClamp;
      unit = track(unit.rotate(0, 0, rot));
    }
    box = unit.boundingBox();
    const unitW = box.max[0] - box.min[0];
    const unitH = box.max[1] - box.min[1];
    const unitZ = box.max[2] - box.min[2];

    // ---- B. Tile positions (THREE-based, unchanged) ----
    const filledTHREE = deserializeShapes(job.filledCutoutShapes);
    let bounds = new THREE.Box2(
      new THREE.Vector2(-size / 2, -size / 2),
      new THREE.Vector2(size / 2, size / 2),
    );
    if (filledTHREE.length > 0) {
      const sb = getShapesBounds(filledTHREE);
      bounds = new THREE.Box2(sb.min, sb.max);
    }

    const pWidth = unitW * patternScale;
    const pHeight = unitH * patternScale;

    const exclTHREE = deserializeShapes(job.exclusionShapes);
    const inclTHREE = deserializeShapes(job.inclusionShapes);
    let avoidTHREE = deserializeShapes(job.avoidShapes);
    if (holeMode === 'avoid' && job.holeShapes.length > 0) {
      avoidTHREE = [...avoidTHREE, ...deserializeShapes(job.holeShapes)];
    }

    const positions = isTiled
      ? generateTilePositions(
          bounds, pWidth, pHeight, tileSpacing,
          filledTHREE.length > 0 ? filledTHREE : null, patternMargin,
          clipToOutline,
          tilingDistribution, tilingOrientation, tilingDirection,
          exclTHREE, inclTHREE, avoidTHREE,
        )
      : [{ position: new THREE.Vector2(0, 0), rotation: 0, scale: 1 }];

    if (rotationClamp && rotationClamp > 0) {
      const radClamp = rotationClamp * (Math.PI / 180);
      positions.forEach((p) => { p.rotation = Math.round(p.rotation / radClamp) * radClamp; });
    }
    if (positions.length === 0) return empty();

    const actualScaleZ = (patternScaleZ !== undefined && patternScaleZ > 0) ? patternScaleZ : patternScale;
    let maxPatternHeight = unitZ * actualScaleZ;
    if (maxPatternHeight === 0) maxPatternHeight = actualScaleZ * 10;

    // Per-instance transform matrix (matches the legacy THREE dummy math).
    const dummy = new THREE.Object3D();
    const instanceMatrix = (p: { position: THREE.Vector2; rotation: number; scale: number }): THREE.Matrix4 => {
      dummy.scale.set(patternScale * p.scale, patternScale * p.scale, actualScaleZ * p.scale);
      const instH = unitZ * Math.abs(dummy.scale.z);
      const zCenter = thickness - 0.01 + instH / 2;
      dummy.position.set(p.position.x, p.position.y, zCenter);
      dummy.rotation.set(0, 0, p.rotation);
      dummy.updateMatrix();
      return dummy.matrix;
    };

    // ---- C. Strategy ----
    const hasExclusions = job.exclusionShapes.length > 0;
    const hasMasks = job.maskShapes.length > 0;
    const hasClipping = clipToOutline && job.filledCutoutShapes.length > 0;
    const hasHoles = job.holeShapes.length > 0;
    const hasHeightCut = patternMaxHeight !== undefined && patternMaxHeight > 0;
    const useCSG = hasClipping || hasExclusions || hasMasks || hasHoles || hasHeightCut;

    if (!useCSG) {
      // Instanced fast path — return unit geometry + per-instance matrices.
      const unitSer = ops.serializeMesh(unit, true);
      const matrices = new Float32Array(positions.length * 16);
      positions.forEach((p, i) => { instanceMatrix(p).toArray(matrices, i * 16); });
      return { jobId: job.jobId, instanced: { unit: unitSer, matrices, count: positions.length }, parts, empty: false };
    }

    // CSG path — compose all instances into one solid, then boolean.
    const instances: M[] = [];
    positions.forEach((p) => {
      instances.push(unit!.transform(instanceMatrix(p).toArray() as unknown as Mat4));
    });
    let result = track(Manifold.compose(instances));
    instances.forEach((i) => i.delete()); // compose copied them
    if (result.numTri() === 0) return empty();

    // 3a. Exclusions (subtract), with optional inclusion carve-outs.
    if (hasExclusions) {
      let exCS = ops.csFromShapes(job.exclusionShapes);
      if (exCS) {
        if (job.inclusionShapes.length > 0) {
          const inCS = ops.csFromShapes(job.inclusionShapes);
          if (inCS) exCS = track(exCS.subtract(inCS));
        }
        const exM = spanExtrude(exCS);
        if (job.debugInlay) {
          const waste = track(result.intersect(exM));
          if (waste.numTri() > 0) parts.push(basicPart('Debug_Pattern_Waste_Exclusion', waste, 0x00ff00, 0.5));
        }
        result = track(result.subtract(exM));
      }
    }

    // 3b. Clip to outline (intersect), with optional erosion margin.
    if (hasClipping) {
      let cutCS = ops.csFromShapes(job.filledCutoutShapes);
      if (cutCS) {
        if (patternMargin && Math.abs(patternMargin) > 0.001) {
          cutCS = track(cutCS.offset(-patternMargin, 'Miter', 2));
        }
        const cutterDepth = thickness + Math.max(maxPatternHeight, maxInlayExtend) + 5;
        const cutter = track(Manifold.extrude(cutCS, cutterDepth));
        if (job.debugPattern) {
          const waste = track(result.subtract(cutter));
          if (waste.numTri() > 0) parts.push(basicPart('Debug_Pattern_Waste', waste, 0x0000ff, 0.5));
        }
        result = track(result.intersect(cutter));
        if (job.debugPattern) parts.push(basicPart('Debug_Pattern_Cutter', cutter, 0x0000ff, 0.3));
      }
    }

    // 3c. Colored masks — 2D layering (subtract upper masks in CrossSection space).
    if (hasMasks) {
      const maskCSs = job.maskShapes.map((m) => ops.csFromShapes([m.shape]));
      job.maskShapes.forEach((m, idx) => {
        let myCS = maskCSs[idx];
        if (!myCS) return;
        for (let j = idx + 1; j < maskCSs.length; j++) {
          const up = maskCSs[j];
          if (up) myCS = track(myCS!.subtract(up));
        }
        const maskM = spanExtrude(myCS);
        const maskedPart = track(result.intersect(maskM));
        if (maskedPart.numTri() > 0) {
          parts.push({
            name: `Pattern_Masked_${idx}_${m.color}`,
            geometry: ops.serializeMesh(maskedPart, true),
            material: { type: 'masked', color: m.color },
            castShadow: true,
            receiveShadow: true,
            translateZ: idx * 0.0001,
          });
        }
      });
      const allCS = ops.csFromShapes(job.maskShapes.map((m) => m.shape));
      if (allCS) result = track(result.subtract(spanExtrude(allCS)));
    }

    // 3d. Holes (subtract), with optional margin expansion.
    if (hasHoles) {
      let holeCS = ops.csFromShapes(job.holeShapes);
      if (holeCS) {
        if (holeMode === 'margin' && patternMargin && Math.abs(patternMargin) > 0.001) {
          holeCS = track(holeCS.offset(patternMargin, 'Miter', 2));
        }
        const holeM = spanExtrude(holeCS);
        if (job.debugHole) {
          const waste = track(result.intersect(holeM));
          if (waste.numTri() > 0) parts.push(basicPart('Debug_Hole_Waste_Pattern', waste, 0xff0000, 0.5));
        }
        result = track(result.subtract(holeM));
        if (job.debugHole) parts.push(basicPart('Debug_Hole_Cutter', holeM, 0xff0000, 0.3));
      }
    }

    // 3e. Max-height cut — subtract a big box above the cut plane.
    if (hasHeightCut) {
      const cutStart = thickness + patternMaxHeight!;
      const cutHeight = maxPatternHeight + 1000;
      const boxCS = track(CrossSection.square([10000, 10000], true));
      const boxM = track(track(Manifold.extrude(boxCS, cutHeight)).translate(0, 0, cutStart));
      result = track(result.subtract(boxM));
    }

    // 4. Final pattern mesh
    if (result.numTri() > 0) {
      parts.push({
        name: 'Pattern',
        geometry: ops.serializeMesh(result, true),
        material: { type: 'pattern' },
        castShadow: true,
        receiveShadow: true,
      });
    }

    return { jobId: job.jobId, parts, empty: parts.length === 0 };
  } finally {
    ops.flush();
  }
}
