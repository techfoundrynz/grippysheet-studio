
import { z } from 'zod';
import * as THREE from 'three';
import { DEFAULT_BASE_COLOR, DEFAULT_PATTERN_COLOR } from '../constants/colors';

// Helper for Three.js objects which are not easily serializable by Zod
const ThreeShapeSchema = z.custom<THREE.Shape[]>((val) => Array.isArray(val), "Must be an array of shapes");
const ThreeObjectsSchema = z.custom<any[]>((val) => Array.isArray(val), "Must be an array of objects");

export const BaseSettingsSchema = z.object({
    size: z.number(),
    thickness: z.number(),
    color: z.string().default(DEFAULT_BASE_COLOR),
    cutoutShapes: ThreeShapeSchema.nullable().optional(),
    baseOutlineRotation: z.number().default(0),
    baseOutlineMirror: z.boolean().default(false),

});

export const InlaySettingsSchema = z.object({
    inlayShapes: ThreeObjectsSchema.nullable().optional(),
    inlayDepth: z.number(),
    inlayScale: z.number(),
    inlayRotation: z.number(),
    inlayExtend: z.number(),
    inlayMirror: z.boolean().default(false),
});

export const GeometrySettingsSchema = z.object({
    patternShapes: ThreeObjectsSchema.nullable().optional(),
    patternType: z.enum(['dxf', 'svg', 'stl']).nullable(),

    extrusionAngle: z.number(),
    patternHeight: z.union([z.number(), z.string()]), // number or ''
    patternScale: z.number(),
    patternScaleZ: z.union([z.number(), z.string()]), // number or ''
    isTiled: z.boolean(),
    tileSpacing: z.number(),
    patternMargin: z.number(),
    patternColor: z.string().default(DEFAULT_PATTERN_COLOR),
    clipToOutline: z.boolean(),
    tilingDistribution: z.enum(['grid', 'offset', 'hex', 'radial', 'random', 'wave', 'zigzag', 'warped-grid']),
    tilingDirection: z.enum(['horizontal', 'vertical']),
    tilingOrientation: z.enum(['none', 'alternate', 'random', 'aligned']),
    baseRotation: z.number().default(0),
    debugMode: z.boolean().optional(),
});

export const ProjectSchemaV1 = z.object({
    version: z.literal(1),
    timestamp: z.number(),
    base: BaseSettingsSchema,
    inlay: InlaySettingsSchema,
    geometry: GeometrySettingsSchema,
});

export const ProjectSchema = ProjectSchemaV1;
export type ProjectData = z.infer<typeof ProjectSchema>;

export type BaseSettings = z.infer<typeof BaseSettingsSchema>;
export type InlaySettings = z.infer<typeof InlaySettingsSchema>;
export type GeometrySettings = z.infer<typeof GeometrySettingsSchema>;
