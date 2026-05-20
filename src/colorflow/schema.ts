import { z } from 'zod';

/**
 * Settings for the ColorFlow image mode.
 *
 * **Invariant:** `baseMm < totalMm` is **not** enforced at parse time — the UI
 * needs to carry transient mid-edit states. Enforcement happens at use time in
 * `ColorFlowControls.tsx` (input clamping) and in the 3MF writer.
 *
 * Heights are uniform per color: `zTop = baseMm + (stackPos + 1) × colorLayerMm`.
 * Stack position is derived from `resolvedStackOrder(palette, coverage, settings)`.
 */
export const ColorFlowSettingsSchema = z.object({
  outlineSlug: z.string().nullable().default(null),
  colorCount: z.number().int().min(2).max(10).default(5),
  simplify: z.number().int().min(0).max(4).default(1),
  detail: z.number().int().min(0).max(2).default(1),
  smooth: z.boolean().default(true),
  sort: z.enum(['luma', 'coverage']).default('luma'),
  totalMm: z.number().min(0.4).max(10).default(2.0),
  baseMm: z.number().min(0.2).max(5).default(1.0),
  colorLayerMm: z.number().min(0.05).max(2).default(0.4),
  imageOffsetMm: z.object({
    x: z.number().min(-200).max(200).default(0),
    y: z.number().min(-200).max(200).default(0),
  }).default({ x: 0, y: 0 }),
  imageScale: z.number().min(0.2).max(3).default(1.0),
  layerOrder: z.array(z.number().int()).nullable().default(null),
});

export type ColorFlowSettings = z.infer<typeof ColorFlowSettingsSchema>;

export const defaultColorFlowSettings: ColorFlowSettings = ColorFlowSettingsSchema.parse({});
