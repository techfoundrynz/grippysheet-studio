import { describe, it, expect } from 'vitest';
import { ColorFlowSettingsSchema, defaultColorFlowSettings } from '../schema';
import { ProjectSchema, migrateV1ToV2 } from '../../types/schemas';

describe('ColorFlowSettingsSchema', () => {
  it('parses empty object into defaults', () => {
    const parsed = ColorFlowSettingsSchema.parse({});
    expect(parsed.colorCount).toBe(5);
    expect(parsed.simplify).toBe(1);
    expect(parsed.detail).toBe(1);
    expect(parsed.smooth).toBe(true);
    expect(parsed.sort).toBe('luma');
    expect(parsed.totalMm).toBe(2.0);
    expect(parsed.baseMm).toBe(1.0);
    expect(parsed.outlineSlug).toBeNull();
    expect(parsed.colorLayerMm).toBe(0.4);
    expect(parsed.imageOffsetMm).toEqual({ x: 0, y: 0 });
    expect(parsed.imageScale).toBe(1.0);
    expect(parsed.layerOrder).toBeNull();
    // Removed field: colorLayerHeights should NOT exist on the parsed object
    expect('colorLayerHeights' in parsed).toBe(false);
  });

  it('rejects imageScale outside 0.2..3', () => {
    expect(() => ColorFlowSettingsSchema.parse({ imageScale: 0.1 })).toThrow();
    expect(() => ColorFlowSettingsSchema.parse({ imageScale: 3.1 })).toThrow();
  });

  it('clamps offsetMm via schema range -200..200', () => {
    expect(() => ColorFlowSettingsSchema.parse({ imageOffsetMm: { x: -201, y: 0 } })).toThrow();
    expect(() => ColorFlowSettingsSchema.parse({ imageOffsetMm: { x: 0, y: 201 } })).toThrow();
  });

  it('defaultColorFlowSettings matches the schema defaults', () => {
    expect(ColorFlowSettingsSchema.parse({})).toEqual(defaultColorFlowSettings);
  });

  it('rejects colorCount outside 2..10', () => {
    expect(() => ColorFlowSettingsSchema.parse({ colorCount: 1 })).toThrow();
    expect(() => ColorFlowSettingsSchema.parse({ colorCount: 11 })).toThrow();
  });

  it('rejects baseMm >= totalMm-equivalent constraint at parse time? no — both numeric, ranges only', () => {
    // baseMm < totalMm is enforced at use time, not at schema parse time
    const ok = ColorFlowSettingsSchema.parse({ baseMm: 5, totalMm: 1 });
    expect(ok.baseMm).toBe(5);
  });
});

describe('ProjectSchema v2', () => {
  it('parses a v2 pattern-mode bundle (no imageMode)', () => {
    const result = ProjectSchema.safeParse({
      version: 2,
      timestamp: 123,
      mode: 'pattern',
      base: {},
      inlay: {},
      geometry: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('pattern');
      expect(result.data.imageMode).toBeUndefined();
    }
  });

  it('parses a v2 colorflow-mode bundle with imageMode', () => {
    const result = ProjectSchema.safeParse({
      version: 2,
      timestamp: 123,
      mode: 'colorflow',
      base: {},
      inlay: {},
      geometry: {},
      imageMode: { colorCount: 4 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imageMode?.colorCount).toBe(4);
    }
  });
});

describe('migrateV1ToV2', () => {
  it('promotes a v1 bundle to v2 with mode=pattern and no imageMode', () => {
    const v1 = {
      version: 1,
      timestamp: 999,
      base: { size: 300 },
      inlay: { items: [] },
      geometry: {},
    };
    const v2 = migrateV1ToV2(v1);
    expect(v2.version).toBe(2);
    expect(v2.mode).toBe('pattern');
    expect(v2.timestamp).toBe(999);
    expect(v2.imageMode).toBeUndefined();
    expect(v2.base.size).toBe(300);
  });
});
