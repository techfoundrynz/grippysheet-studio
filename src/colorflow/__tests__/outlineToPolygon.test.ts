import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  shapeToPolygon,
  CANVAS_PX_PER_MM,
  outlineCanvasSize,
  pixelToMmOnOutlineCanvas,
  buildOutlineCanvasMask,
} from '../outlineToPolygon';

function unitSquare(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-1, -1);
  s.lineTo(1, -1);
  s.lineTo(1, 1);
  s.lineTo(-1, 1);
  s.lineTo(-1, -1);
  return s;
}

describe('shapeToPolygon', () => {
  it('extracts at least 4 points from a unit square', () => {
    const poly = shapeToPolygon(unitSquare(), 32);
    expect(poly.outer.length).toBeGreaterThanOrEqual(4);
  });

  it('returns the shape bounds', () => {
    const poly = shapeToPolygon(unitSquare(), 32);
    expect(poly.minX).toBeCloseTo(-1, 5);
    expect(poly.maxX).toBeCloseTo(1, 5);
    expect(poly.minY).toBeCloseTo(-1, 5);
    expect(poly.maxY).toBeCloseTo(1, 5);
  });

  it('strips the duplicate closing point', () => {
    const poly = shapeToPolygon(unitSquare(), 32);
    const first = poly.outer[0];
    const last = poly.outer[poly.outer.length - 1];
    expect(first[0] !== last[0] || first[1] !== last[1]).toBe(true);
  });
});

describe('outlineCanvasSize', () => {
  it('returns px = mm * CANVAS_PX_PER_MM', () => {
    const size = outlineCanvasSize({ minX: 0, minY: 0, maxX: 10, maxY: 20 });
    expect(size.w).toBe(10 * CANVAS_PX_PER_MM);
    expect(size.h).toBe(20 * CANVAS_PX_PER_MM);
  });

  it('rounds to integer px', () => {
    const size = outlineCanvasSize({ minX: 0, minY: 0, maxX: 232.9, maxY: 219.7 });
    expect(Number.isInteger(size.w)).toBe(true);
    expect(Number.isInteger(size.h)).toBe(true);
    expect(size.w).toBe(Math.round(232.9 * CANVAS_PX_PER_MM));
  });

  it('caps at MAX_CANVAS_DIM by reducing effective px-per-mm', () => {
    // 500mm × 5 px/mm = 2500px — should clamp to 1500
    const size = outlineCanvasSize({ minX: 0, minY: 0, maxX: 500, maxY: 100 });
    expect(Math.max(size.w, size.h)).toBeLessThanOrEqual(1500);
  });
});

describe('pixelToMmOnOutlineCanvas', () => {
  it('maps (0,0) → (minX, maxY) and (w, h) → (maxX, minY) (Y is flipped)', () => {
    const bounds = { minX: 10, minY: 20, maxX: 30, maxY: 40 };
    const size = outlineCanvasSize(bounds);
    const tl = pixelToMmOnOutlineCanvas(0, 0, bounds, size);
    const br = pixelToMmOnOutlineCanvas(size.w, size.h, bounds, size);
    expect(tl[0]).toBeCloseTo(10);
    expect(tl[1]).toBeCloseTo(40);
    expect(br[0]).toBeCloseTo(30);
    expect(br[1]).toBeCloseTo(20);
  });
});

describe('buildOutlineCanvasMask', () => {
  it('returns an all-zero mask sized w*h for an empty outer ring', () => {
    const polygon = {
      outer: [] as Array<[number, number]>,
      holes: [],
      minX: 0, minY: 0, maxX: 10, maxY: 10,
    };
    const size = outlineCanvasSize(polygon);
    const mask = buildOutlineCanvasMask(polygon, size);
    expect(mask.length).toBe(size.w * size.h);
    expect(mask.every((b) => b === 0)).toBe(true);
  });
});
