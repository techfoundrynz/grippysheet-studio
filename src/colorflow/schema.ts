import { z } from 'zod';

/**
 * Settings for the ColorFlow image mode.
 *
 * The base outline + thickness + rotation + mirror + color all come from
 * `BaseSettings` (the Base tab). ColorFlow only owns the color-overlay layer
 * settings on top of the base.
 *
 * Heights are uniform per color: `zTop = baseThickness + (stackPos + 1) × colorLayerMm`,
 * where `baseThickness = baseSettings.thickness`. Stack position is derived from
 * `resolvedStackOrder(palette, coverage, settings)`.
 */
export const ColorFlowSettingsSchema = z.object({
  colorCount: z.number().int().min(2).max(10).default(5),
  simplify: z.number().int().min(0).max(4).default(1),
  detail: z.number().int().min(0).max(2).default(1),
  smooth: z.boolean().default(true),
  sort: z.enum(['luma', 'coverage']).default('luma'),
  colorLayerMm: z.number().min(0.05).max(2).default(0.4),
  imageOffsetMm: z.object({
    x: z.number().min(-200).max(200).default(0),
    y: z.number().min(-200).max(200).default(0),
  }).default({ x: 0, y: 0 }),
  imageScale: z.number().min(0.2).max(3).default(1.0),
  layerOrder: z.array(z.number().int()).nullable().default(null),
  /** Absolute top-Z of the spike pattern when GeometrySettings provides a tile shape.
   *  0 = auto (baseMm + N×colorLayerMm + 1.0). Otherwise an absolute mm value. */
  spikeMaxMm: z.number().min(0).max(20).default(0),
  /** When true, each spike inherits the color of the region it sits on; when false,
   *  spikes all use GeometrySettings.patternColor. */
  spikeColorMatch: z.boolean().default(true),
});

export type ColorFlowSettings = z.infer<typeof ColorFlowSettingsSchema>;

export const defaultColorFlowSettings: ColorFlowSettings = ColorFlowSettingsSchema.parse({});
