import { z } from 'zod';

export const ColorFlowSettingsSchema = z.object({
  outlineSlug: z.string().nullable().default(null),
  colorCount: z.number().int().min(2).max(10).default(5),
  simplify: z.number().int().min(0).max(4).default(1),
  detail: z.number().int().min(0).max(2).default(1),
  smooth: z.boolean().default(true),
  sort: z.enum(['luma', 'coverage']).default('luma'),
  totalMm: z.number().min(0.4).max(10).default(2.0),
  baseMm: z.number().min(0.2).max(5).default(1.0),
});

export type ColorFlowSettings = z.infer<typeof ColorFlowSettingsSchema>;

export const defaultColorFlowSettings: ColorFlowSettings = ColorFlowSettingsSchema.parse({});
