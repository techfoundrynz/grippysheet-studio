import { describe, it, expect } from 'vitest';
import { unionPolygons } from '../pipeline/polygonUnion';

describe('unionPolygons', () => {
  it('returns a single polygon unchanged (topologically)', () => {
    const result = unionPolygons([
      { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].holes).toEqual([]);
    // Polygon area ≈ 1 (within Clipper's integer-rounding tolerance)
    const area = polygonArea(result[0].outer);
    expect(Math.abs(area - 1)).toBeLessThan(0.01);
  });

  it('merges two adjacent squares sharing an edge into one rectangle', () => {
    const result = unionPolygons([
      { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] },
      { outer: [[1, 0], [2, 0], [2, 1], [1, 1]], holes: [] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].holes).toEqual([]);
    // Combined area ≈ 2
    const area = polygonArea(result[0].outer);
    expect(Math.abs(area - 2)).toBeLessThan(0.01);
    // The merged polygon should have 4 corners (rectangle), not 8.
    // Clipper sometimes leaves a collinear vertex on the shared edge — allow up to 6.
    expect(result[0].outer.length).toBeGreaterThanOrEqual(4);
    expect(result[0].outer.length).toBeLessThanOrEqual(6);
  });

  it('keeps disjoint polygons as separate entries', () => {
    const result = unionPolygons([
      { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] },
      { outer: [[5, 5], [6, 5], [6, 6], [5, 6]], holes: [] },
    ]);
    expect(result).toHaveLength(2);
    // Combined area = 2
    const totalArea = result.reduce((a, p) => a + polygonArea(p.outer), 0);
    expect(Math.abs(totalArea - 2)).toBeLessThan(0.01);
  });

  it('preserves a hole on a single input polygon', () => {
    const result = unionPolygons([
      {
        outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
        holes: [[[3, 3], [7, 3], [7, 7], [3, 7]]],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].holes).toHaveLength(1);
    const outerArea = polygonArea(result[0].outer);
    const holeArea = polygonArea(result[0].holes[0]);
    expect(Math.abs(outerArea - 100)).toBeLessThan(0.1);
    expect(Math.abs(holeArea - 16)).toBeLessThan(0.1);
  });

  it('returns [] for empty input', () => {
    expect(unionPolygons([])).toEqual([]);
  });

  it('preserves a hole when a second (non-overlapping) polygon is also in the input', () => {
    // Donut (10×10 outer with 4×4 hole) + isolated 5×5 square far away.
    // Exercises the hole-reversal path with a multi-polygon input — was
    // uncovered by the single-polygon hole test.
    const result = unionPolygons([
      {
        outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
        holes: [[[3, 3], [7, 3], [7, 7], [3, 7]]],
      },
      { outer: [[20, 0], [25, 0], [25, 5], [20, 5]], holes: [] },
    ]);
    expect(result).toHaveLength(2);
    const donut = result.find((p) => p.holes.length === 1);
    expect(donut).toBeDefined();
    expect(Math.abs(polygonArea(donut!.outer) - 100)).toBeLessThan(0.1);
    expect(Math.abs(polygonArea(donut!.holes[0]) - 16)).toBeLessThan(0.1);
  });
});

function polygonArea(ring: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}
