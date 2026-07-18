import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generatePattern, PatternJob } from './patternPipeline';
import { serializeShape, deserializeShape, serializeGeometry, deserializeGeometry } from './serialize';

/** Flat-array square shape centered at origin. */
function squareShape(half: number) {
  return {
    points: [-half, -half, half, -half, half, half, -half, half],
    holes: [] as number[][],
  };
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

describe('generatePattern', () => {
  it('uses the instanced fast path when no CSG is needed', () => {
    const res = generatePattern(baseJob({ clipToOutline: false }));
    expect(res.empty).toBe(false);
    expect(res.instanced).toBeDefined();
    expect(res.instanced!.count).toBeGreaterThan(0);
    // 16 floats per instance matrix.
    expect(res.instanced!.matrices.length).toBe(res.instanced!.count * 16);
    expect(res.parts.length).toBe(0);
  });

  it('runs the CSG path and returns a Pattern part when clipping to outline', () => {
    const res = generatePattern(baseJob({ clipToOutline: true }));
    expect(res.instanced).toBeUndefined();
    const pattern = res.parts.find((p) => p.name === 'Pattern');
    expect(pattern).toBeDefined();
    expect(pattern!.geometry.position.length).toBeGreaterThan(0);
    expect(pattern!.material.type).toBe('pattern');
  });

  it('subtracts holes via CSG', () => {
    const res = generatePattern(baseJob({ holeShapes: [squareShape(1.5)] }));
    const pattern = res.parts.find((p) => p.name === 'Pattern');
    expect(pattern).toBeDefined();
    expect(pattern!.geometry.position.length).toBeGreaterThan(0);
  });

  it('produces colored mask parts', () => {
    const res = generatePattern(baseJob({
      clipToOutline: true,
      maskShapes: [{ shape: squareShape(2), color: 'red' }],
    }));
    const masked = res.parts.find((p) => p.name.startsWith('Pattern_Masked_'));
    expect(masked).toBeDefined();
    expect(masked!.material.type).toBe('masked');
  });

  it('returns empty when there is no pattern unit geometry', () => {
    const res = generatePattern(baseJob({ patternUnit: { kind: 'shapes', shapes: [] } }));
    expect(res.empty).toBe(true);
  });
});
