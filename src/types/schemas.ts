
import { z } from 'zod';
import * as THREE from 'three';
import { DEFAULT_BASE_COLOR, DEFAULT_PATTERN_COLOR } from '../constants/colors';

// Helper for Three.js objects which are not easily serializable by Zod
const ThreeShapeSchema = z.custom<THREE.Shape[]>((val) => Array.isArray(val), "Must be an array of shapes");
const ThreeObjectsSchema = z.custom<any[]>((val) => Array.isArray(val), "Must be an array of objects");

export const BaseSettingsSchema = z.object({
    size: z.number().default(300),
    thickness: z.number().default(3),
    color: z.string().default(DEFAULT_BASE_COLOR),
    cutoutShapes: ThreeShapeSchema.nullable().optional().default(null),
    baseOutlineRotation: z.number().default(0),
    baseOutlineMirror: z.boolean().default(false),
});

export const InlayItemSchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    shapes: z.array(z.any()), // Array of THREE.Shape or object wrapper
    valid: z.boolean().optional(),

    // Transform
    scale: z.number(),
    rotation: z.number(),
    mirror: z.boolean(),

    // Mode
    mode: z.enum(['single', 'tile']).optional(), // Default to 'single' if undefined
    modifier: z.enum(['none', 'cut', 'mask', 'avoid']).optional(), // Default 'none'

    // Position
    x: z.number().optional(),
    y: z.number().optional(),
    positionPreset: z.enum(['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'manual']).optional(),

    // Tiling (Only valid if mode === 'tile')
    tileSpacing: z.number().optional(),
    tilingDistribution: z.enum(['grid', 'offset', 'hex', 'radial', 'random', 'wave', 'zigzag', 'warped-grid']).optional(),

    // Extrude
    depth: z.number().optional(),
    extend: z.number().optional(),
});

export type InlayItem = z.infer<typeof InlayItemSchema>;

export const InlaySettingsSchema = z.object({
    items: z.array(InlayItemSchema).default([{
        id: 'default-layer',
        name: 'Inlay Layer 1',
        shapes: [],
        scale: 1,
        rotation: 0,
        mirror: false,
        x: 0,
        y: 0,
        depth: 0.6,
        extend: 0,
        positionPreset: 'center',
    }]),
});

export const GeometrySettingsSchema = z.object({
    patternShapes: ThreeObjectsSchema.nullable().optional().default(null),
    patternType: z.enum(['dxf', 'svg', 'stl']).nullable().default(null),
    patternHeight: z.union([z.number(), z.string()]).default(""), // number or ''
    patternScale: z.number().default(1),
    patternScaleZ: z.union([z.number(), z.string()]).default(""), // number or ''
    patternMaxHeight: z.union([z.number(), z.string()]).optional(), // number or ''
    isTiled: z.boolean().default(true),
    tileSpacing: z.number().default(10),
    patternMargin: z.number().default(3),
    holeMode: z.enum(['default', 'margin', 'avoid']).default('default'),
    patternColor: z.string().default(DEFAULT_PATTERN_COLOR),
    clipToOutline: z.boolean().default(true),
    tilingDistribution: z.enum(['grid', 'offset', 'hex', 'radial', 'random', 'wave', 'zigzag', 'warped-grid']).default('offset'),
    tilingDirection: z.enum(['horizontal', 'vertical']).default('horizontal'),
    tilingOrientation: z.enum(['none', 'alternate', 'random', 'aligned']).default('none'),
    baseRotation: z.number().default(0),
    rotationClamp: z.number().optional(),
    debugMode: z.boolean().optional().default(false),
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
