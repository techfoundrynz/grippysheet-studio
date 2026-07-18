import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import type { ManifoldToplevel } from 'manifold-3d';
import { generatePattern, PatternJob, PatternResult } from './patternPipeline';
import { getManifold } from './manifoldModule';
import { serializeShape, deserializeShape, serializeGeometry, deserializeGeometry } from './serialize';

/** Flat-array square shape centered at origin. */
function squareShape(half: number) {
  return {
    points: [-half, -half, half, -half, half, half, -half, half],
    holes: [] as number[][],
  };
}

/** XY bounding box of a part's position buffer. */
function xyBounds(pos: Float32Array) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
    minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}

const baseJob = (overrides: Partial<PatternJob>): PatternJob => ({
  jobId: 1,
  size: 20,
  thickness: 3,
  patternScale: 1,
  patternScaleZ: undefined,
  isTiled: true,
  tileSpacing: 2,
  patternMargin: 0,
  holeMode: 'default',
  tilingDistribution: 'grid',
  tilingDirection: 'horizontal',
  tilingOrientation: 'none',
  baseRotation: 0,
  rotationClamp: undefined,
  patternMaxHeight: undefined,
  clipToOutline: false,
  maxInlayExtend: 0,
  filledCutoutShapes: [squareShape(5)],
  holeShapes: [],
  patternUnit: { kind: 'shapes', shapes: [squareShape(1)] },
  exclusionShapes: [],
  inclusionShapes: [],
  avoidShapes: [],
  maskShapes: [],
  debugPattern: false,
  debugHole: false,
  debugInlay: false,
  ...overrides,
});

describe('serialize round-trip', () => {
  it('shape survives serialize -> deserialize with holes', () => {
    const shape = new THREE.Shape([
      new THREE.Vector2(-4, -4), new THREE.Vector2(4, -4),
      new THREE.Vector2(4, 4), new THREE.Vector2(-4, 4),
    ]);
    shape.holes = [new THREE.Path([
      new THREE.Vector2(-1, -1), new THREE.Vector2(1, -1),
      new THREE.Vector2(1, 1), new THREE.Vector2(-1, 1),
    ])];
    const round = deserializeShape(serializeShape(shape));
    expect(round.getPoints().length).toBeGreaterThanOrEqual(4);
    expect(round.holes.length).toBe(1);
  });

  it('geometry survives serialize -> deserialize', () => {
    const geo = new THREE.BoxGeometry(2, 2, 2);
    const round = deserializeGeometry(serializeGeometry(geo));
    expect(round.getAttribute('position').count).toBe(geo.getAttribute('position').count);
  });
});

describe('generatePattern (Manifold)', () => {
  let wasm: ManifoldToplevel;
  const run = (job: PatternJob): PatternResult => generatePattern(job, wasm);

  beforeAll(async () => {
    wasm = await getManifold();
  });

  it('uses the instanced fast path when no CSG is needed', () => {
    const res = run(baseJob({ clipToOutline: false }));
    expect(res.empty).toBe(false);
    expect(res.instanced).toBeDefined();
    expect(res.instanced!.count).toBeGreaterThan(0);
    expect(res.instanced!.matrices.length).toBe(res.instanced!.count * 16);
    // Manifold provides normals for lit materials.
    expect(res.instanced!.unit.normal).toBeDefined();
    expect(res.parts.length).toBe(0);
  });

  it('runs the CSG path and returns a watertight Pattern part when clipping', () => {
    const res = run(baseJob({ clipToOutline: true }));
    expect(res.instanced).toBeUndefined();
    const pattern = res.parts.find((p) => p.name === 'Pattern');
    expect(pattern).toBeDefined();
    expect(pattern!.geometry.position.length).toBeGreaterThan(0);
    expect(pattern!.geometry.index).toBeDefined();
    expect(pattern!.material.type).toBe('pattern');
    // Clipped result must lie within the 10x10 outline (±5).
    const b = xyBounds(pattern!.geometry.position);
    expect(b.maxX).toBeLessThanOrEqual(5.01);
    expect(b.minX).toBeGreaterThanOrEqual(-5.01);
    expect(b.maxY).toBeLessThanOrEqual(5.01);
    expect(b.minY).toBeGreaterThanOrEqual(-5.01);
  });

  it('erodes the clip region by the margin', () => {
    const res = run(baseJob({ clipToOutline: true, patternMargin: 1 }));
    const pattern = res.parts.find((p) => p.name === 'Pattern')!;
    const b = xyBounds(pattern.geometry.position);
    // With a 1mm margin the pattern must stay within ±4.
    expect(b.maxX).toBeLessThanOrEqual(4.01);
    expect(b.minX).toBeGreaterThanOrEqual(-4.01);
  });

  it('subtracts holes via CSG', () => {
    const res = run(baseJob({ holeShapes: [squareShape(1.5)] }));
    const pattern = res.parts.find((p) => p.name === 'Pattern');
    expect(pattern).toBeDefined();
    expect(pattern!.geometry.position.length).toBeGreaterThan(0);
  });

  it('produces colored mask parts', () => {
    const res = run(baseJob({
      clipToOutline: true,
      maskShapes: [{ shape: squareShape(2), color: 'red' }],
    }));
    const masked = res.parts.find((p) => p.name.startsWith('Pattern_Masked_'));
    expect(masked).toBeDefined();
    expect(masked!.material.type).toBe('masked');
    expect(masked!.geometry.normal).toBeDefined();
  });

  it('emits debug parts only when a debug flag is set', () => {
    const off = run(baseJob({ clipToOutline: true }));
    expect(off.parts.some((p) => p.name.startsWith('Debug_'))).toBe(false);
    const on = run(baseJob({ clipToOutline: true, debugPattern: true }));
    expect(on.parts.some((p) => p.name === 'Debug_Pattern_Cutter')).toBe(true);
  });

  it('returns empty when there is no pattern unit geometry', () => {
    const res = run(baseJob({ patternUnit: { kind: 'shapes', shapes: [] } }));
    expect(res.empty).toBe(true);
  });
});
