import { describe, it, expect } from 'vitest';
import { resolvedStackOrder } from '../stackOrder';
import type { Centroid } from '../pipeline/quantize';

function p(r: number, g: number, b: number, index: number): Centroid {
  return { r, g, b, index };
}

describe('resolvedStackOrder', () => {
  const palette: Centroid[] = [
    p(255, 0, 0, 0),   // red,   luma ≈ 54
    p(255, 255, 255, 1), // white, luma ≈ 255
    p(0, 0, 0, 2),     // black, luma = 0
  ];
  const coverage = [10, 5, 50];

  it('sorts by luma ascending when sort=luma and layerOrder is null', () => {
    const order = resolvedStackOrder(palette, coverage, { sort: 'luma', layerOrder: null });
    expect(order).toEqual([2, 0, 1]); // black, red, white
  });

  it('sorts by coverage descending when sort=coverage', () => {
    const order = resolvedStackOrder(palette, coverage, { sort: 'coverage', layerOrder: null });
    expect(order).toEqual([2, 0, 1]); // 50, 10, 5
  });

  it('honors layerOrder verbatim when set with matching length', () => {
    const order = resolvedStackOrder(palette, coverage, { sort: 'luma', layerOrder: [1, 0, 2] });
    expect(order).toEqual([1, 0, 2]);
  });

  it('ignores layerOrder if length does not match palette and falls back to sort', () => {
    const order = resolvedStackOrder(palette, coverage, { sort: 'luma', layerOrder: [0, 1] });
    expect(order).toEqual([2, 0, 1]);
  });

  it('handles missing coverage entries as 0', () => {
    const order = resolvedStackOrder(palette, [], { sort: 'coverage', layerOrder: null });
    expect(order.length).toBe(3);
  });
});
