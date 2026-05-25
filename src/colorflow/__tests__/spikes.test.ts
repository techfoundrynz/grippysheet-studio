import { describe, it, expect } from 'vitest';
import {
  pointInRing,
  pointInPolygon,
  effectiveSpikeMaxMm,
  assignTilesToColors,
  buildSpikeGeometriesForColors,
} from '../spikes';

const square = (cx: number, cy: number, half: number): Array<[number, number]> => [
  [cx - half, cy - half],
  [cx + half, cy - half],
  [cx + half, cy + half],
  [cx - half, cy + half],
];

describe('pointInRing', () => {
  it('returns true for a point inside a square', () => {
    expect(pointInRing(0, 0, square(0, 0, 5))).toBe(true);
  });
  it('returns false for a point outside a square', () => {
    expect(pointInRing(10, 0, square(0, 0, 5))).toBe(false);
  });
});

describe('pointInPolygon', () => {
  it('subtracts holes', () => {
    const polygon = { outer: square(0, 0, 10), holes: [square(0, 0, 3)] };
    expect(pointInPolygon(7, 0, polygon)).toBe(true);  // inside outer, outside hole
    expect(pointInPolygon(1, 0, polygon)).toBe(false); // inside hole
    expect(pointInPolygon(20, 0, polygon)).toBe(false); // outside outer
  });
});

describe('effectiveSpikeMaxMm', () => {
  it('returns the auto value when raw is 0', () => {
    // Auto = baseMm + N*colorLayerMm + 0.4
    expect(effectiveSpikeMaxMm(0, 1.0, 5, 0.4)).toBeCloseTo(1.0 + 5 * 0.4 + 0.4);
  });
  it('passes a non-zero raw through', () => {
    expect(effectiveSpikeMaxMm(7.5, 1.0, 5, 0.4)).toBeCloseTo(7.5);
  });
  it('floors at baseMm + N×layer + 0.1 even if raw is too low', () => {
    expect(effectiveSpikeMaxMm(2.5, 1.0, 5, 0.4)).toBeCloseTo(1.0 + 5 * 0.4 + 0.1);
  });
});

describe('assignTilesToColors', () => {
  it('assigns a tile to the topmost color region that contains it', () => {
    // Two color polygons that overlap at (0, 0); 0 is at stack pos 0, 1 is at stack pos 1 (taller).
    const polygons = [
      { centroidIndex: 0, polygon: { outer: square(0, 0, 10), holes: [] } },
      { centroidIndex: 1, polygon: { outer: square(0, 0, 5), holes: [] } },
    ];
    const tiles = [
      { x: 0, y: 0, rotation: 0, scale: 1 },    // inside both → assigns to 1 (higher stack pos)
      { x: 7, y: 0, rotation: 0, scale: 1 },    // inside only color 0
      { x: 20, y: 0, rotation: 0, scale: 1 },   // outside both
    ];
    const result = assignTilesToColors(tiles, polygons, [0, 1]);
    expect(result[0].colorIndex).toBe(1);
    expect(result[1].colorIndex).toBe(0);
    expect(result[2].colorIndex).toBe(-1);
  });
});

describe('buildSpikeGeometriesForColors', () => {
  const tileShape = { outer: square(0, 0, 1), holes: [] };

  it('groups tiles by color and produces one merged geometry per group', () => {
    const tiles = [
      { x: 0, y: 0, rotation: 0, scale: 1, colorIndex: 0 },
      { x: 5, y: 0, rotation: 0, scale: 1, colorIndex: 0 },
      { x: 0, y: 5, rotation: 0, scale: 1, colorIndex: 1 },
    ];
    const result = buildSpikeGeometriesForColors(tiles, tileShape, 1.0, 0.4, [0, 1], 3.0);
    const byColor = Object.fromEntries(result.map((r) => [r.centroidIndex, r]));
    expect(byColor[0]).toBeDefined();
    expect(byColor[1]).toBeDefined();
    // Group 0 (pos=0, two tiles): expect more vertices than group 1 (pos=1, one tile).
    expect(byColor[0].geom.positions.length).toBeGreaterThan(byColor[1].geom.positions.length);
  });

  it('grounds every spike at the uniform stack-top regardless of color', () => {
    // Per-color fillers (worker-side) extend every column to baseMm + N×layer,
    // so spike bases share a flat plane. Tiles on different colors should all
    // start at z = 1 + 3×0.4 = 2.2 (with N=3 here).
    const tiles = [
      { x: 0, y: 0, rotation: 0, scale: 1, colorIndex: 0 },   // pos 0 (shortest)
      { x: 5, y: 0, rotation: 0, scale: 1, colorIndex: 2 },   // pos 2 (tallest)
    ];
    const result = buildSpikeGeometriesForColors(tiles, tileShape, 1.0, 0.4, [0, 1, 2], 3.0);
    for (const group of result) {
      const zs = new Set<number>();
      for (let i = 2; i < group.geom.positions.length; i += 3) {
        zs.add(+group.geom.positions[i].toFixed(3));
      }
      expect(zs.has(2.2)).toBe(true);  // uniform bottom
      expect(zs.has(3.0)).toBe(true);  // spikeMaxMm
    }
  });

  it('skips groups with degenerate Z range (spikeMax <= uniform bottom)', () => {
    const tiles = [{ x: 0, y: 0, rotation: 0, scale: 1, colorIndex: 1 }];
    // uniform bottom = 1 + 2×0.4 = 1.8; topZ = 1.5 → degenerate, skipped.
    const result = buildSpikeGeometriesForColors(tiles, tileShape, 1.0, 0.4, [0, 1], 1.5);
    expect(result).toEqual([]);
  });

  it('skips tiles outside every color region (colorIndex === -1)', () => {
    const tiles = [
      { x: 0, y: 0, rotation: 0, scale: 1, colorIndex: -1 }, // gap between regions
      { x: 5, y: 0, rotation: 0, scale: 1, colorIndex: 0 },
    ];
    const result = buildSpikeGeometriesForColors(tiles, tileShape, 1.0, 0.4, [0, 1], 3.0);
    // Only color 0 should produce a group; the -1 tile is dropped.
    expect(result.map((r) => r.centroidIndex)).toEqual([0]);
  });
});
