import { describe, it, expect, beforeAll } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { generateInlay, InlayJob } from './inlayPipeline';
import { getManifold } from './manifoldModule';

function squareShape(half: number) {
  return { points: [-half, -half, half, -half, half, half, -half, half], holes: [] as number[][] };
}

function xyBounds(pos: Float32Array) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
    minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}

const baseJob = (overrides: Partial<InlayJob>): InlayJob => ({
  jobId: 1,
  thickness: 3,
  cutterExtra: 0,
  filledCutoutShapes: [squareShape(5)],
  holeShapes: [],
  items: [{
    id: 'a',
    itemIndex: 0,
    scale: 1,
    rotation: 0,
    mirror: false,
    x: 0,
    y: 0,
    depth: 0.6,
    extend: 0,
    positions: [{ x: 0, y: 0, rot: 0 }],
    shapes: [{ shape: squareShape(8), color: 'white' }],
  }],
  ...overrides,
});

describe('generateInlay (Manifold)', () => {
  let wasm: ManifoldToplevel;
  beforeAll(async () => { wasm = await getManifold(); });

  it('clips an oversized inlay to the base outline', () => {
    const res = generateInlay(baseJob({}), wasm);
    const part = res.parts.find((p) => p.name === 'Inlay_a_0_0');
    expect(part).toBeDefined();
    expect(part!.geometry.normal).toBeDefined();
    const b = xyBounds(part!.geometry.position);
    // Inlay (half 8) clipped to outline (half 5).
    expect(b.maxX).toBeLessThanOrEqual(5.01);
    expect(b.minX).toBeGreaterThanOrEqual(-5.01);
    expect(b.maxY).toBeLessThanOrEqual(5.01);
  });

  it('drops an inlay positioned entirely outside the outline', () => {
    const res = generateInlay(baseJob({
      items: [{ ...baseJob({}).items[0], x: 100, shapes: [{ shape: squareShape(2), color: 'white' }] }],
    }), wasm);
    expect(res.parts.length).toBe(0);
  });

  it('subtracts holes from the inlay', () => {
    const res = generateInlay(baseJob({ holeShapes: [squareShape(1)] }), wasm);
    const part = res.parts.find((p) => p.name === 'Inlay_a_0_0');
    expect(part).toBeDefined();
    expect(part!.geometry.position.length).toBeGreaterThan(0);
  });

  it('carries the color token and mesh name through', () => {
    const res = generateInlay(baseJob({
      items: [{ ...baseJob({}).items[0], shapes: [{ shape: squareShape(3), color: 'base' }] }],
    }), wasm);
    const part = res.parts.find((p) => p.name === 'Inlay_a_0_0');
    expect(part).toBeDefined();
    expect(part!.color).toBe('base');
  });

  it('skips transparent shapes', () => {
    const res = generateInlay(baseJob({
      items: [{ ...baseJob({}).items[0], shapes: [{ shape: squareShape(3), color: 'transparent' }] }],
    }), wasm);
    expect(res.parts.length).toBe(0);
  });
});
