import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { generateTilePositions, getShapesBounds } from '../patternUtils';
import { offsetShape, unionShapes } from '../offsetUtils';
import {
  SerializedShape,
  SerializedGeometry,
  deserializeShape,
  deserializeShapes,
  deserializeGeometry,
  serializeGeometry,
  geometryTransferables,
} from './serialize';

/**
 * Pure, framework-free pattern generator. No React, no scene graph, no DOM — safe
 * to run on the main thread OR inside a Web Worker. It ports the pattern-effect
 * logic from ImperativeModel (extrude + tile + three-bvh-csg booleans) and returns
 * geometry buffers + material descriptors instead of building THREE.Mesh objects.
 *
 * The caller (main thread) turns MaterialSpec + geometry into real Mesh/Material and
 * adds them to the scene — the only DOM/GL-bound step.
 */

export type TilingDistribution =
  | 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave' | 'zigzag' | 'warped-grid';
export type TilingOrientation = 'none' | 'alternate' | 'random' | 'aligned';
export type TilingDirection = 'horizontal' | 'vertical';
export type HoleMode = 'default' | 'margin' | 'avoid';

/** How the main thread should build the material for a part. */
export type MaterialSpec =
  | { type: 'pattern' } // main pattern mesh -> createMaterial(patternColor, ...)
  | { type: 'masked'; color: string } // colored mask part -> createMaterial(resolve(color), ...)
  | { type: 'basic'; colorHex: number; opacity: number; transparent: boolean; depthWrite: boolean }; // debug/waste

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

  // Scalars
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
  /** Max of inlay `extend` values, precomputed on the main thread. */
  maxInlayExtend: number;

  // Shapes (serialized)
  filledCutoutShapes: SerializedShape[];
  holeShapes: SerializedShape[];
  patternUnit: PatternUnit;
  exclusionShapes: SerializedShape[];
  inclusionShapes: SerializedShape[];
  avoidShapes: SerializedShape[];
  maskShapes: { shape: SerializedShape; color: string }[];

  // Debug/waste generation (gated: only produced when the corresponding flag is on)
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

function bakePart(
  name: string,
  geo: THREE.BufferGeometry,
  material: MaterialSpec,
  opts: Partial<MeshPart> = {},
): MeshPart {
  return {
    name,
    geometry: serializeGeometry(geo),
    material,
    ...opts,
  };
}

export function generatePattern(job: PatternJob): PatternResult {
  const parts: MeshPart[] = [];
  const empty = (): PatternResult => ({ jobId: job.jobId, parts, empty: true });

  const {
    size, thickness, patternScale, patternScaleZ, isTiled, tileSpacing, patternMargin,
    holeMode, tilingDistribution, tilingDirection, tilingOrientation, baseRotation,
    rotationClamp, patternMaxHeight, clipToOutline, maxInlayExtend,
  } = job;

  const filledCutoutShapes = deserializeShapes(job.filledCutoutShapes);
  const holeShapes = deserializeShapes(job.holeShapes);
  const finalExclusionShapes = deserializeShapes(job.exclusionShapes);
  const finalInclusionShapes = deserializeShapes(job.inclusionShapes);
  let finalAvoidShapes = deserializeShapes(job.avoidShapes);
  const finalMaskShapesWithColor = job.maskShapes.map((m) => ({
    shape: deserializeShape(m.shape),
    color: m.color,
  }));

  // ---- A. Prepare unit geometry ----
  let unitGeo: THREE.BufferGeometry | null = null;
  if (job.patternUnit.kind === 'geometry') {
    unitGeo = deserializeGeometry(job.patternUnit.geometry);
  } else {
    const shapes = deserializeShapes(job.patternUnit.shapes);
    if (shapes.length > 0) {
      unitGeo = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
    }
  }
  if (!unitGeo) return empty();

  // Center locally
  unitGeo.computeBoundingBox();
  const center = new THREE.Vector3();
  if (unitGeo.boundingBox) unitGeo.boundingBox.getCenter(center);
  unitGeo.translate(-center.x, -center.y, -center.z);

  // Base rotation (of the pattern unit)
  if (baseRotation !== 0) {
    let rotationToApply = baseRotation;
    if (rotationClamp && rotationClamp > 0) {
      const steps = Math.round(baseRotation / rotationClamp);
      rotationToApply = steps * rotationClamp;
    }
    unitGeo.rotateZ(rotationToApply * (Math.PI / 180));
    unitGeo.computeBoundingBox();
  }

  // ---- B. Positions ----
  let bounds = new THREE.Box2(
    new THREE.Vector2(-size / 2, -size / 2),
    new THREE.Vector2(size / 2, size / 2),
  );
  if (filledCutoutShapes.length > 0) {
    const sb = getShapesBounds(filledCutoutShapes);
    bounds = new THREE.Box2(sb.min, sb.max);
  }

  let pWidth = 0, pHeight = 0;
  if (unitGeo.boundingBox) {
    pWidth = (unitGeo.boundingBox.max.x - unitGeo.boundingBox.min.x) * patternScale;
    pHeight = (unitGeo.boundingBox.max.y - unitGeo.boundingBox.min.y) * patternScale;
  }

  // Inject holes into the avoid list when holeMode === 'avoid'
  if (holeMode === 'avoid' && holeShapes.length > 0) {
    finalAvoidShapes = [...finalAvoidShapes, ...holeShapes];
  }

  const positions = isTiled
    ? generateTilePositions(
        bounds, pWidth, pHeight, tileSpacing,
        filledCutoutShapes.length > 0 ? filledCutoutShapes : null, patternMargin,
        clipToOutline,
        tilingDistribution, tilingOrientation, tilingDirection,
        finalExclusionShapes, finalInclusionShapes, finalAvoidShapes,
      )
    : [{ position: new THREE.Vector2(0, 0), rotation: 0, scale: 1 }];

  if (rotationClamp && rotationClamp > 0) {
    const radClamp = rotationClamp * (Math.PI / 180);
    positions.forEach((p) => {
      const steps = Math.round(p.rotation / radClamp);
      p.rotation = steps * radClamp;
    });
  }

  if (positions.length === 0) return empty();

  // ---- C. Strategy: instanced (fast) vs merged CSG (accurate) ----
  const actualScaleZ = (patternScaleZ !== undefined && patternScaleZ > 0) ? patternScaleZ : patternScale;

  let maxPatternHeight = 0;
  if (unitGeo.boundingBox) {
    maxPatternHeight = (unitGeo.boundingBox.max.z - unitGeo.boundingBox.min.z) * actualScaleZ;
  }
  if (maxPatternHeight === 0) maxPatternHeight = actualScaleZ * 10;

  const hasExclusions = finalExclusionShapes.length > 0;
  const hasMasks = finalMaskShapesWithColor.length > 0;
  const hasClipping = clipToOutline && filledCutoutShapes.length > 0;
  const hasHoles = holeShapes.length > 0;
  const hasHeightCut = patternMaxHeight !== undefined && patternMaxHeight > 0;
  const useCSG = hasClipping || hasExclusions || hasMasks || hasHoles || hasHeightCut;

  if (!useCSG) {
    // --- INSTANCED PATH ---
    const matrices = new Float32Array(positions.length * 16);
    const dummy = new THREE.Object3D();
    const bb = unitGeo.boundingBox!;
    positions.forEach((p, i) => {
      dummy.scale.set(patternScale * p.scale, patternScale * p.scale, actualScaleZ * p.scale);
      const instH = (bb.max.z - bb.min.z) * Math.abs(dummy.scale.z);
      const zCenter = thickness - 0.01 + instH / 2;
      dummy.position.set(p.position.x, p.position.y, zCenter);
      dummy.rotation.set(0, 0, p.rotation);
      dummy.updateMatrix();
      dummy.matrix.toArray(matrices, i * 16);
    });
    return {
      jobId: job.jobId,
      instanced: { unit: serializeGeometry(unitGeo), matrices, count: positions.length },
      parts,
      empty: false,
    };
  }

  // --- CSG PATH (merged) ---
  const geometries: THREE.BufferGeometry[] = [];
  const dummy = new THREE.Object3D();
  const bb = unitGeo.boundingBox!;
  positions.forEach((p) => {
    dummy.scale.set(patternScale * p.scale, patternScale * p.scale, actualScaleZ * p.scale);
    const instH = (bb.max.z - bb.min.z) * Math.abs(dummy.scale.z);
    const zCenter = thickness - 0.01 + instH / 2;
    dummy.position.set(p.position.x, p.position.y, zCenter);
    dummy.rotation.set(0, 0, p.rotation);
    dummy.updateMatrix();
    const clone = unitGeo!.clone();
    clone.applyMatrix4(dummy.matrix);
    geometries.push(clone);
  });

  if (geometries.length === 0) return empty();
  const rawMergedGeo = mergeGeometries(geometries);
  const mergedGeo = mergeVertices(rawMergedGeo);
  rawMergedGeo.dispose();
  geometries.forEach((g) => g.dispose());

  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];

  let resultBrush = new Brush(mergedGeo);
  resultBrush.updateMatrixWorld();

  // 3a. Exclusions
  if (hasExclusions) {
    const unifiedExclusions = unionShapes(finalExclusionShapes);
    const exclusionGeo = new THREE.ExtrudeGeometry(unifiedExclusions, { depth: 1000, bevelEnabled: false });
    if (exclusionGeo.attributes.position && exclusionGeo.attributes.position.count > 0) {
      let effectiveExclusionBrush = new Brush(exclusionGeo);
      effectiveExclusionBrush.position.z = -500;
      effectiveExclusionBrush.scale.z = 2.0;
      effectiveExclusionBrush.updateMatrixWorld();
      try {
        if (finalInclusionShapes.length > 0) {
          const inclusionGeo = new THREE.ExtrudeGeometry(finalInclusionShapes, { depth: 1000, bevelEnabled: false });
          if (inclusionGeo.attributes.position && inclusionGeo.attributes.position.count > 0) {
            const inclusionBrush = new Brush(inclusionGeo);
            inclusionBrush.position.z = -100;
            inclusionBrush.updateMatrixWorld();
            effectiveExclusionBrush = evaluator.evaluate(effectiveExclusionBrush, inclusionBrush, SUBTRACTION);
          }
          inclusionGeo.dispose();
        }

        if (job.debugInlay) {
          const wasteBrush = evaluator.evaluate(resultBrush, effectiveExclusionBrush, INTERSECTION);
          if (wasteBrush?.geometry?.attributes.position?.count > 0) {
            parts.push(bakePart('Debug_Pattern_Waste_Exclusion', wasteBrush.geometry,
              { type: 'basic', colorHex: 0x00ff00, opacity: 0.5, transparent: true, depthWrite: false },
              { visible: true }));
          }
        }

        resultBrush = evaluator.evaluate(resultBrush, effectiveExclusionBrush, SUBTRACTION);
      } catch (err) {
        console.warn('Error during Pattern Exclusion CSG:', err);
      }
    }
    exclusionGeo.dispose();
  }

  // 3b. Clip to outline (intersection)
  if (hasClipping && filledCutoutShapes.length > 0) {
    let finalCutoutShapes = filledCutoutShapes;
    if (patternMargin && Math.abs(patternMargin) > 0.001) {
      const offsetShapes: THREE.Shape[] = [];
      filledCutoutShapes.forEach((s) => { offsetShapes.push(...offsetShape(s, -patternMargin)); });
      if (offsetShapes.length > 0) finalCutoutShapes = offsetShapes;
    }

    const cutterDepth = thickness + Math.max(maxPatternHeight, maxInlayExtend) + 5;
    const cutterGeo = new THREE.ExtrudeGeometry(finalCutoutShapes, { depth: cutterDepth, bevelEnabled: false });
    if (cutterGeo.attributes.position && cutterGeo.attributes.position.count > 0) {
      const cutterBrush = new Brush(cutterGeo);
      cutterBrush.updateMatrixWorld();
      try {
        if (job.debugPattern) {
          const wasteBrush = evaluator.evaluate(resultBrush, cutterBrush, SUBTRACTION);
          if (wasteBrush?.geometry?.attributes.position?.count > 0) {
            parts.push(bakePart('Debug_Pattern_Waste', wasteBrush.geometry,
              { type: 'basic', colorHex: 0x0000ff, opacity: 0.5, transparent: true, depthWrite: false },
              { visible: true }));
          }
        }

        resultBrush = evaluator.evaluate(resultBrush, cutterBrush, INTERSECTION);

        if (job.debugPattern) {
          parts.push(bakePart('Debug_Pattern_Cutter', cutterGeo,
            { type: 'basic', colorHex: 0x0000ff, opacity: 0.3, transparent: true, depthWrite: false },
            { visible: true }));
        }
      } catch (err) {
        console.warn('Error during Pattern Clipping:', err);
      }
    }
    cutterGeo.dispose();
  }

  // 3c. Colored masks (bottom-to-top layering)
  if (hasMasks) {
    const maskGeometries = finalMaskShapesWithColor.map((m) =>
      new THREE.ExtrudeGeometry([m.shape], { depth: 1000, bevelEnabled: false }));

    finalMaskShapesWithColor.forEach((m, idx) => {
      const myGeo = maskGeometries[idx];
      if (!myGeo || !myGeo.attributes.position || myGeo.attributes.position.count === 0) return;
      let effectiveMaskBrush = new Brush(myGeo);
      effectiveMaskBrush.position.z = -100;
      effectiveMaskBrush.updateMatrixWorld();
      try {
        for (let j = idx + 1; j < finalMaskShapesWithColor.length; j++) {
          const upperGeo = maskGeometries[j];
          if (upperGeo && upperGeo.attributes.position && upperGeo.attributes.position.count > 0) {
            const upperBrush = new Brush(upperGeo);
            upperBrush.position.z = -500;
            upperBrush.scale.z = 2.0;
            upperBrush.updateMatrixWorld();
            effectiveMaskBrush = evaluator.evaluate(effectiveMaskBrush, upperBrush, SUBTRACTION);
          }
        }
        const maskedPartBrush = evaluator.evaluate(resultBrush, effectiveMaskBrush, INTERSECTION);
        if (maskedPartBrush?.geometry?.attributes.position?.count > 0) {
          parts.push(bakePart(`Pattern_Masked_${idx}_${m.color}`, maskedPartBrush.geometry,
            { type: 'masked', color: m.color },
            { castShadow: true, receiveShadow: true, translateZ: idx * 0.0001 }));
        }
      } catch (err) {
        console.warn('Error processing Mask Layering:', err);
      }
    });
    maskGeometries.forEach((g) => g.dispose());

    const unifiedMaskShapes = unionShapes(finalMaskShapesWithColor.map((m) => m.shape));
    const allMasksGeo = new THREE.ExtrudeGeometry(unifiedMaskShapes, { depth: 1000, bevelEnabled: false });
    if (allMasksGeo.attributes.position && allMasksGeo.attributes.position.count > 0) {
      const allMasksBrush = new Brush(allMasksGeo);
      allMasksBrush.position.z = -500;
      allMasksBrush.scale.z = 2.0;
      allMasksBrush.updateMatrixWorld();
      try {
        resultBrush = evaluator.evaluate(resultBrush, allMasksBrush, SUBTRACTION);
      } catch (err) {
        console.warn('Error subtracting Mask from Pattern:', err);
      }
    }
    allMasksGeo.dispose();
  }

  // 3d. Holes
  if (hasHoles) {
    let finalHoleShapes = holeShapes;
    if (holeMode === 'margin' && patternMargin && Math.abs(patternMargin) > 0.001) {
      const offsetShapes: THREE.Shape[] = [];
      holeShapes.forEach((s) => { offsetShapes.push(...offsetShape(s, patternMargin)); });
      if (offsetShapes.length > 0) finalHoleShapes = offsetShapes;
    }
    finalHoleShapes = unionShapes(finalHoleShapes);

    const holeDepth = thickness + Math.max(maxPatternHeight, maxInlayExtend) + 20;
    const holeGeo = new THREE.ExtrudeGeometry(finalHoleShapes, { depth: holeDepth, bevelEnabled: false });
    if (holeGeo.attributes.position && holeGeo.attributes.position.count > 0) {
      const holeBrush = new Brush(holeGeo);
      holeBrush.position.z = -10;
      holeBrush.updateMatrixWorld();
      try {
        if (job.debugHole) {
          const wasteBrush = evaluator.evaluate(resultBrush, holeBrush, INTERSECTION);
          if (wasteBrush?.geometry?.attributes.position?.count > 0) {
            parts.push(bakePart('Debug_Hole_Waste_Pattern', wasteBrush.geometry,
              { type: 'basic', colorHex: 0xff0000, opacity: 0.5, transparent: true, depthWrite: false },
              { visible: true }));
          }
        }
        resultBrush = evaluator.evaluate(resultBrush, holeBrush, SUBTRACTION);
        if (job.debugHole) {
          const dbg = holeGeo.clone();
          dbg.translate(0, 0, -10);
          parts.push(bakePart('Debug_Hole_Cutter', dbg,
            { type: 'basic', colorHex: 0xff0000, opacity: 0.3, transparent: true, depthWrite: false },
            { visible: true }));
          dbg.dispose();
        }
      } catch (err) {
        console.warn('Error during Pattern Hole subtract:', err);
      }
    }
    holeGeo.dispose();
  }

  // 3e. Max height cut
  if (hasHeightCut) {
    const boxSize = 10000;
    const cutStart = thickness + patternMaxHeight!;
    const cutHeight = (maxPatternHeight || 1000) + 1000;
    const cutterGeo = new THREE.BoxGeometry(boxSize, boxSize, cutHeight);
    const zPos = cutStart + cutHeight / 2;
    const cutterBrush = new Brush(cutterGeo);
    cutterBrush.position.set(0, 0, zPos);
    cutterBrush.updateMatrixWorld();
    try {
      resultBrush = evaluator.evaluate(resultBrush, cutterBrush, SUBTRACTION);
    } catch (err) {
      console.warn('Error during Pattern Height Cut:', err);
    }
    cutterGeo.dispose();
  }

  // 4. Result mesh
  if (resultBrush?.geometry?.attributes.position?.count > 0) {
    parts.push(bakePart('Pattern', resultBrush.geometry, { type: 'pattern' },
      { castShadow: true, receiveShadow: true }));
  } else {
    console.warn('Pattern Generation resulted in empty geometry.');
  }

  mergedGeo.dispose();

  return { jobId: job.jobId, parts, empty: parts.length === 0 };
}
