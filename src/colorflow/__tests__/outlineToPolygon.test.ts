import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  shapeToPolygon,
  fitOutlineInImage,
  pixelToMm,
  type Bounds,
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

describe('fitOutlineInImage', () => {
  it('centers a 1×1 shape inside a 2×2 image', () => {
    const placement = fitOutlineInImage({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 2, 2);
    expect(placement.scale).toBeCloseTo(2);
    expect(placement.offsetX).toBeCloseTo(0);
    expect(placement.offsetY).toBeCloseTo(0);
  });

  it('preserves aspect ratio (letterboxes)', () => {
    const placement = fitOutlineInImage({ minX: 0, minY: 0, maxX: 2, maxY: 1 }, 4, 4);
    expect(placement.scale).toBeCloseTo(2); // limited by width
    expect(placement.offsetY).toBeCloseTo(1); // vertical letterbox
  });

  it('returns scale=1 fallback for zero-size bounds', () => {
    const placement = fitOutlineInImage({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, 4, 4);
    expect(placement.scale).toBe(1);
  });
});

describe('pixelToMm', () => {
  it('inverts fitOutlineInImage for a shape anchored at the origin', () => {
    const bounds: Bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const placement = { scale: 10, offsetX: 5, offsetY: 7 };
    const [mx, my] = pixelToMm(15, 17, placement, bounds);
    expect(mx).toBeCloseTo(1);
    expect(my).toBeCloseTo(0);
  });

  it('inverts fitOutlineInImage for a shifted-bounds shape', () => {
    const bounds: Bounds = { minX: 100, minY: 200, maxX: 110, maxY: 210 };
    const placement = { scale: 10, offsetX: 5, offsetY: 7 };
    const [mx, my] = pixelToMm(15, 17, placement, bounds);
    expect(mx).toBeCloseTo(101);
    expect(my).toBeCloseTo(209);
  });
});
