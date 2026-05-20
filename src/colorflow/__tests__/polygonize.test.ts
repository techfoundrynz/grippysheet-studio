import { describe, it, expect } from 'vitest';
import { layerToPolygons } from '../pipeline/polygonize';
import type { TracedLayer } from '../vendor/imagetracer';

describe('layerToPolygons', () => {
  it('returns empty for an empty layer', () => {
    expect(layerToPolygons([])).toEqual([]);
  });

  it('skips hole paths at top level (they attach to parents)', () => {
    const layer: TracedLayer = [
      { isholepath: true, segments: [
        { type: 'L', x1: 0, y1: 0, x2: 1, y2: 0 },
        { type: 'L', x1: 1, y1: 0, x2: 1, y2: 1 },
        { type: 'L', x1: 1, y1: 1, x2: 0, y2: 1 },
      ], boundingbox: [0, 0, 1, 1], holechildren: [] },
    ];
    expect(layerToPolygons(layer)).toEqual([]);
  });

  it('converts an L-only outer path into a 3+ point polygon', () => {
    const layer: TracedLayer = [
      { isholepath: false, segments: [
        { type: 'L', x1: 0, y1: 0, x2: 10, y2: 0 },
        { type: 'L', x1: 10, y1: 0, x2: 10, y2: 10 },
        { type: 'L', x1: 10, y1: 10, x2: 0, y2: 10 },
        { type: 'L', x1: 0, y1: 10, x2: 0, y2: 0 },
      ], boundingbox: [0, 0, 10, 10], holechildren: [] },
    ];
    const polys = layerToPolygons(layer);
    expect(polys.length).toBe(1);
    expect(polys[0].outer.length).toBeGreaterThanOrEqual(3);
    expect(polys[0].holes.length).toBe(0);
  });

  it('expands a Q segment by sampling', () => {
    const layer: TracedLayer = [
      { isholepath: false, segments: [
        { type: 'L', x1: 0, y1: 0, x2: 10, y2: 0 },
        { type: 'Q', x1: 10, y1: 0, x2: 15, y2: 5, x3: 10, y3: 10 },
        { type: 'L', x1: 10, y1: 10, x2: 0, y2: 10 },
        { type: 'L', x1: 0, y1: 10, x2: 0, y2: 0 },
      ], boundingbox: [0, 0, 15, 10], holechildren: [] },
    ];
    const polys = layerToPolygons(layer, 6);
    expect(polys[0].outer.length).toBeGreaterThan(4); // sampled curve
  });
});
