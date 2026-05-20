import { describe, it, expect } from 'vitest';
import { OUTLINE_LIBRARY, getOutlineBySlug } from '../outlineLibrary';

describe('OUTLINE_LIBRARY', () => {
  it('exposes 16 entries', () => {
    expect(OUTLINE_LIBRARY.length).toBe(16);
  });

  it('each entry has a unique slug', () => {
    const slugs = OUTLINE_LIBRARY.map((o) => o.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('each entry points to a /outlines/<slug>.dxf path', () => {
    for (const o of OUTLINE_LIBRARY) {
      expect(o.file).toBe(`/outlines/${o.slug}.dxf`);
    }
  });

  it('each entry has positive mm dimensions', () => {
    for (const o of OUTLINE_LIBRARY) {
      expect(o.widthMm).toBeGreaterThan(0);
      expect(o.heightMm).toBeGreaterThan(0);
    }
  });

  it('getOutlineBySlug returns the matching entry or undefined', () => {
    expect(getOutlineBySlug('pint')?.name).toBe('Pint');
    expect(getOutlineBySlug('nonexistent')).toBeUndefined();
  });

  it('groups partition into xr / gt / pint / other', () => {
    const groups = new Set(OUTLINE_LIBRARY.map((o) => o.group));
    expect(groups).toEqual(new Set(['xr', 'gt', 'pint', 'other']));
  });
});
