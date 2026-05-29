import { describe, it, expect } from 'vitest';
import { hexToRgb, calculateColorDistance, flattenColors } from './colorUtils';

describe('colorUtils utility', () => {
  describe('hexToRgb', () => {
    it('converts valid hex strings to rgb objects', () => {
      expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
      // Without hash
      expect(hexToRgb('00ff00')).toEqual({ r: 0, g: 255, b: 0 });
    });

    it('returns null for invalid hex strings', () => {
      expect(hexToRgb('invalid')).toBeNull();
      expect(hexToRgb('#fff')).toBeNull(); // Schema specifies 6 digit hex in match regex
      expect(hexToRgb('#12345')).toBeNull();
    });
  });

  describe('calculateColorDistance', () => {
    it('returns 0 for identical colors', () => {
      expect(calculateColorDistance('#ffffff', '#ffffff')).toBe(0);
      expect(calculateColorDistance('transparent', 'transparent')).toBe(0);
      expect(calculateColorDistance('base', 'base')).toBe(0);
    });

    it('returns 100 if one of them is transparent or base and they are not identical', () => {
      expect(calculateColorDistance('transparent', '#ffffff')).toBe(100);
      expect(calculateColorDistance('#000000', 'base')).toBe(100);
      expect(calculateColorDistance('transparent', 'base')).toBe(100);
    });

    it('calculates Euclidean distance between colors normalized to 0-100', () => {
      const distance = calculateColorDistance('#000000', '#ffffff');
      expect(distance).toBeCloseTo(100, 1);

      const halfDistance = calculateColorDistance('#000000', '#7f7f7f');
      expect(halfDistance).toBeCloseTo(49.8, 1);
    });

    it('returns 100 if parsing invalid hex', () => {
      expect(calculateColorDistance('invalid', '#ffffff')).toBe(100);
    });
  });

  describe('flattenColors', () => {
    it('returns shapes as-is if there are 1 or 0 unique non-base/non-transparent colors', () => {
      const shapes = [{ color: 'transparent' }, { color: 'base' }, { color: '#ffffff' }];
      expect(flattenColors(shapes, 10)).toEqual(shapes);
    });

    it('merges similar colors based on threshold', () => {
      const shapes = [
        { id: 1, color: '#ff0000' },
        { id: 2, color: '#ff1010' }, // Very close to #ff0000
        { id: 3, color: '#00ff00' }, // Far
        { id: 4, color: 'transparent' },
        { id: 5, color: 'base' },
      ];

      // Distance between #ff0000 and #ff1010 is:
      // rDiff = 0, gDiff = 16, bDiff = 16
      // dist = sqrt(256 + 256) = 22.62
      // normalized = 22.62 / 441.67 * 100 = 5.12
      // Using threshold 10, #ff1010 should be remapped to #ff0000.
      const flattened = flattenColors(shapes, 10);
      expect(flattened[0].color).toBe('#ff0000');
      expect(flattened[1].color).toBe('#ff0000'); // Remapped!
      expect(flattened[2].color).toBe('#00ff00');
      expect(flattened[3].color).toBe('transparent');
      expect(flattened[4].color).toBe('base');
    });
  });
});
