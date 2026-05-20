import { describe, it, expect } from 'vitest';
import { kmeans, paletteCoverage } from '../pipeline/quantize';
import { mulberry32 } from '../pipeline/random';

function buildImageData(rgbs: Array<[number, number, number]>): ImageData {
  // 1×N image, one pixel per color
  return {
    width: rgbs.length,
    height: 1,
    data: new Uint8ClampedArray(rgbs.flatMap(([r, g, b]) => [r, g, b, 255])),
  } as unknown as ImageData;
}

describe('kmeans', () => {
  it('recovers 2 clusters from a synthetic image', () => {
    // 4 red + 4 blue pixels
    const img = buildImageData([
      [255, 0, 0], [240, 10, 10], [230, 0, 5], [250, 5, 0],
      [0, 0, 255], [10, 10, 240], [5, 0, 230], [0, 5, 250],
    ]);
    const rand = mulberry32(42);
    const centroids = kmeans(img, 2, rand);
    expect(centroids.length).toBe(2);
    // Each centroid should be close to red or blue
    const reds = centroids.filter((c) => c.r > 200 && c.b < 50);
    const blues = centroids.filter((c) => c.b > 200 && c.r < 50);
    expect(reds.length).toBe(1);
    expect(blues.length).toBe(1);
  });

  it('returns gray fallback if pixel count is zero', () => {
    const img = buildImageData([]);
    const centroids = kmeans(img, 3, mulberry32(1));
    expect(centroids.length).toBe(3);
    for (const c of centroids) {
      expect(c.r).toBe(128);
    }
  });

  it('produces deterministic output for a fixed seed', () => {
    const img = buildImageData([
      [255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128],
    ]);
    const a = kmeans(img, 2, mulberry32(7));
    const b = kmeans(img, 2, mulberry32(7));
    expect(a).toEqual(b);
  });
});

describe('paletteCoverage', () => {
  it('counts assignments per palette index, ignoring 0xFFFF', () => {
    const assignments = new Uint16Array([0, 0, 1, 1, 1, 2, 0xFFFF, 0xFFFF]);
    const fakePalette = [
      { r: 0, g: 0, b: 0, index: 0 },
      { r: 0, g: 0, b: 0, index: 1 },
      { r: 0, g: 0, b: 0, index: 2 },
    ];
    const c = paletteCoverage(assignments, fakePalette);
    expect(c).toEqual([2, 3, 1]);
  });

  it('returns all zeros if every pixel is transparent', () => {
    const assignments = new Uint16Array([0xFFFF, 0xFFFF]);
    const fakePalette = [{ r: 0, g: 0, b: 0, index: 0 }];
    expect(paletteCoverage(assignments, fakePalette)).toEqual([0]);
  });
});
