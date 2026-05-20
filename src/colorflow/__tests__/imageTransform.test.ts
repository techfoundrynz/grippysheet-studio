import { describe, it, expect } from 'vitest';
import { computeImageDrawCoords } from '../imageTransform';

describe('computeImageDrawCoords', () => {
  it('fit-centers a square image inside a square canvas at scale=1, offset=0', () => {
    const r = computeImageDrawCoords({
      imageW: 100, imageH: 100,
      canvasW: 200, canvasH: 200,
      offsetMm: { x: 0, y: 0 },
      scale: 1,
      pxPerMm: 5,
    });
    expect(r.w).toBe(200);
    expect(r.h).toBe(200);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
  });

  it('letterboxes when aspect ratios differ', () => {
    const r = computeImageDrawCoords({
      imageW: 100, imageH: 50,
      canvasW: 200, canvasH: 200,
      offsetMm: { x: 0, y: 0 },
      scale: 1,
      pxPerMm: 1,
    });
    // fitScale = min(200/100, 200/50) = 2
    expect(r.w).toBe(200);
    expect(r.h).toBe(100);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(50); // vertical letterbox
  });

  it('applies user scale on top of fit', () => {
    const r = computeImageDrawCoords({
      imageW: 100, imageH: 100,
      canvasW: 200, canvasH: 200,
      offsetMm: { x: 0, y: 0 },
      scale: 2,
      pxPerMm: 5,
    });
    expect(r.w).toBe(400);
    expect(r.h).toBe(400);
    expect(r.dx).toBe(-100);
    expect(r.dy).toBe(-100);
  });

  it('applies offsetMm in pixels after centering', () => {
    const r = computeImageDrawCoords({
      imageW: 100, imageH: 100,
      canvasW: 200, canvasH: 200,
      offsetMm: { x: 10, y: -5 },
      scale: 1,
      pxPerMm: 5,
    });
    expect(r.dx).toBe(0 + 10 * 5);
    expect(r.dy).toBe(0 - 5 * 5);
  });
});
