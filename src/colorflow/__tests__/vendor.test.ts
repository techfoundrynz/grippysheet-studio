import { describe, it, expect } from 'vitest';
import earcut from '../vendor/earcut';
import imagetracer from '../vendor/imagetracer';

describe('vendor/earcut', () => {
  it('triangulates a unit square into two triangles', () => {
    const tris = earcut([0, 0, 1, 0, 1, 1, 0, 1]);
    expect(tris.length).toBe(6); // 2 triangles × 3 indices
  });

  it('handles a square with a square hole', () => {
    const tris = earcut(
      [0, 0, 10, 0, 10, 10, 0, 10, 3, 3, 7, 3, 7, 7, 3, 7],
      [4],
      2,
    );
    expect(tris.length).toBeGreaterThanOrEqual(24); // outer ring + hole ⇒ 8 triangles
  });
});

describe('vendor/imagetracer', () => {
  it('exposes the imagedataToTracedata API', () => {
    expect(typeof imagetracer.imagedataToTracedata).toBe('function');
    expect(typeof imagetracer.imagedataToSVG).toBe('function');
  });

  it('traces a 2x2 single-color ImageData without throwing', () => {
    // node has no DOM ImageData; use a plain object that matches the shape
    const fake = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        0, 0, 0, 255,  0, 0, 0, 255,
        0, 0, 0, 255,  0, 0, 0, 255,
      ]),
    } as unknown as ImageData;
    const td = imagetracer.imagedataToTracedata(fake, { numberofcolors: 1, colorsampling: 0 });
    expect(td.palette.length).toBeGreaterThan(0);
    expect(Array.isArray(td.layers)).toBe(true);
  });
});
