
import { z } from 'zod';
import { BaseSettingsSchema, InlaySettingsSchema, GeometrySettingsSchema } from '../types/schemas';

// Helper to get defaults from a Zod schema
export const getDefaults = <T extends z.ZodTypeAny>(schema: T): z.infer<T> => {
    return schema.parse({});
};

export const defaultBaseSettings = getDefaults(BaseSettingsSchema);
export const defaultInlaySettings = getDefaults(InlaySettingsSchema);
export const defaultGeometrySettings = getDefaults(GeometrySettingsSchema);
