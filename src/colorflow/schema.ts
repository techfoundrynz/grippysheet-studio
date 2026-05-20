import { z } from 'zod';

/**
 * Settings for the ColorFlow image mode.
 *
 * **Invariant:** `baseMm < totalMm` is **not** enforced at parse time. This is
 * deliberate so the UI can carry transient mid-edit states where the user is
 * still adjusting both numbers. Enforcement happens at use time in
 * `ColorFlowControls.tsx` (input clamping) and in the 3MF writer guard
 * (rejects with a user-facing alert if violated at export).
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
  /** Per-palette-index extrusion height in mm. Empty array = equal split. */
  colorLayerHeights: z.array(z.number().min(0.05)).default([]),
});

export type ColorFlowSettings = z.infer<typeof ColorFlowSettingsSchema>;

export const defaultColorFlowSettings: ColorFlowSettings = ColorFlowSettingsSchema.parse({});
