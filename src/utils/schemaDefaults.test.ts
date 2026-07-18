import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { getDefaults, defaultBaseSettings, defaultInlaySettings, defaultGeometrySettings } from './schemaDefaults';

describe('schemaDefaults utility', () => {
  it('getDefaults extracts default values from a zod schema', () => {
    const testSchema = z.object({
      str: z.string().default('hello'),
      num: z.number().default(42),
      bool: z.boolean().default(true),
    });
    
    const defaults = getDefaults(testSchema);
    expect(defaults).toEqual({
      str: 'hello',
      num: 42,
      bool: true,
    });
  });

  it('defaultBaseSettings contains correct defaults', () => {
    expect(defaultBaseSettings.size).toBe(300);
    expect(defaultBaseSettings.thickness).toBe(0.6);
    expect(defaultBaseSettings.cutoutShapes).toBeNull();
    expect(defaultBaseSettings.baseOutlineRotation).toBe(0);
    expect(defaultBaseSettings.baseOutlineMirror).toBe(false);
  });

  it('defaultInlaySettings contains correct defaults', () => {
    expect(defaultInlaySettings.items).toHaveLength(1);
    expect(defaultInlaySettings.items[0]).toMatchObject({
      id: 'default-layer',
      name: 'Inlay Layer 1',
      shapes: [],
      scale: 1,
      rotation: 0,
      mirror: false,
      x: 0,
      y: 0,
      depth: 0.4,
      extend: 0,
      positionPreset: 'center',
    });
  });

  it('defaultGeometrySettings contains correct defaults', () => {
    expect(defaultGeometrySettings.patternShapes).toBeNull();
    expect(defaultGeometrySettings.patternType).toBeNull();
    expect(defaultGeometrySettings.patternHeight).toBe('');
    expect(defaultGeometrySettings.patternScale).toBe(1);
    expect(defaultGeometrySettings.patternScaleZ).toBe('');
    expect(defaultGeometrySettings.isTiled).toBe(true);
    expect(defaultGeometrySettings.tileSpacing).toBe(10);
    expect(defaultGeometrySettings.patternMargin).toBe(3);
    expect(defaultGeometrySettings.clipToOutline).toBe(true);
    expect(defaultGeometrySettings.tilingDistribution).toBe('offset');
  });
});
