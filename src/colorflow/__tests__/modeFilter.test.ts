import { describe, it, expect } from 'vitest';
import { modeFilter, SIMPLIFY_KERNELS } from '../pipeline/modeFilter';

describe('modeFilter', () => {
  it('returns the input unchanged when kernel is 0', () => {
    const a = new Uint16Array([0, 1, 1, 0, 0xFFFF]);
    const out = modeFilter(a, 5, 1, 0, 2);
    expect(Array.from(out)).toEqual(Array.from(a));
  });

  it('replaces a single-pixel outlier with surrounding majority (3×3)', () => {
    // 3x3 grid, center pixel (1,1) is 1, all neighbors are 0
    const a = new Uint16Array([
      0, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ]);
    const out = modeFilter(a, 3, 3, 3, 2);
    expect(out[4]).toBe(0); // center should now be 0 (majority)
  });

  it('preserves transparent (0xFFFF) when it is the majority', () => {
    const T = 0xFFFF;
    const a = new Uint16Array([
      T, T, T,
      T, 0, T,
      T, T, T,
    ]);
    const out = modeFilter(a, 3, 3, 3, 2);
    expect(out[4]).toBe(T);
  });

  it('SIMPLIFY_KERNELS maps simplify level 0..4 to kernel sizes 0,3,5,9,15', () => {
    expect(SIMPLIFY_KERNELS).toEqual([0, 3, 5, 9, 15]);
  });
});
