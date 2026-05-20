import { describe, it, expect } from 'vitest';
import { extrudePolygon } from '../pipeline/extrude';

describe('extrudePolygon', () => {
  it('returns null for a degenerate polygon (collinear)', () => {
    const result = extrudePolygon(
      [[0, 0], [1, 0], [2, 0]],
      [],
      0,
      1,
    );
    expect(result).toBeNull();
  });

  it('extrudes a unit square into a manifold mesh', () => {
    const result = extrudePolygon(
      [[0, 0], [1, 0], [1, 1], [0, 1]],
      [],
      0,
      1,
    );
    expect(result).not.toBeNull();
    // 2 top + 2 bottom + 8 side triangles = 12 triangles
    expect(result!.indices.length).toBe(36);
    expect(result!.positions.length).toBe(24); // 8 vertices × 3 coords
  });

  it('extrudes a square with a square hole', () => {
    const result = extrudePolygon(
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [[[3, 3], [7, 3], [7, 7], [3, 7]]],
      0,
      1,
    );
    expect(result).not.toBeNull();
    // 8 top + 8 bottom + 16 side triangles = 32 triangles
    expect(result!.indices.length).toBe(96);
  });

  it('places top vertices at zTop and bottom at zBottom', () => {
    const result = extrudePolygon([[0, 0], [1, 0], [1, 1], [0, 1]], [], 2, 5);
    const zs = new Set<number>();
    for (let i = 2; i < result!.positions.length; i += 3) zs.add(result!.positions[i]);
    expect(zs.has(2)).toBe(true);
    expect(zs.has(5)).toBe(true);
  });
});
