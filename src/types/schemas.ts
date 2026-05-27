
import { z } from 'zod';
import * as THREE from 'three';
import { DEFAULT_BASE_COLOR, DEFAULT_PATTERN_COLOR } from '../constants/colors';
import { ColorFlowSettingsSchema } from '../colorflow/schema';

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
    /** Slug from the outline library when the base came from a preset; null for custom uploads. */
    outlineSlug: z.string().nullable().default(null),
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

/**
 * Compound pattern layer. The Geometry tab's flat top-level fields are
 * "layer 1"; this schema describes layers 2+ that stack on top via
 * `extraLayers`. Names are simplified (`shapes` not `patternShapes`)
 * since they're already namespaced inside the layer container.
 *
 * `removedTiles` is a sorted array of `"x.xx,y.yy"` quantised position
 * keys — tiles whose generated origin lands on one of these is dropped
 * by the construction loop. Enables "thin out a pattern by clicking
 * tiles to remove them".
 */
export const PatternLayerSchema = z.object({
    id: z.string(),
    shapes: ThreeObjectsSchema.nullable().optional().default(null),
    type: z.enum(['dxf', 'svg', 'stl']).nullable().default(null),
    scale: z.number().default(1),
    scaleZ: z.union([z.number(), z.string()]).default(""),
    maxHeight: z.union([z.number(), z.string()]).optional(),
    isTiled: z.boolean().default(true),
    tileSpacing: z.number().default(10),
    margin: z.number().default(3),
    color: z.string().default(DEFAULT_PATTERN_COLOR),
    distribution: z.enum(['grid', 'offset', 'hex', 'radial', 'random', 'wave', 'zigzag', 'warped-grid']).default('offset'),
    direction: z.enum(['horizontal', 'vertical']).default('horizontal'),
    orientation: z.enum(['none', 'alternate', 'random', 'aligned']).default('none'),
    rotation: z.number().default(0),
    rotationClamp: z.number().optional(),
    removedTiles: z.array(z.string()).default([]),
    /** Per-layer asset filename — referenced by the 3MF sidecar so
     *  each extra layer's source bytes round-trip on save. */
    assetName: z.string().optional(),
});

export const GeometrySettingsSchema = z.object({
    // --- Layer 1 (legacy flat fields, kept for back-compat) ----------
    patternShapes: ThreeObjectsSchema.nullable().optional().default(null),
    patternType: z.enum(['dxf', 'svg', 'stl']).nullable().default(null),
    patternHeight: z.union([z.number(), z.string()]).default(""), // number or ''
    patternScale: z.number().default(1),
    patternScaleZ: z.union([z.number(), z.string()]).default(""), // number or ''
    patternMaxHeight: z.union([z.number(), z.string()]).optional(), // number or ''
    isTiled: z.boolean().default(true),
    tileSpacing: z.number().default(10),
    patternMargin: z.number().default(3),
    patternColor: z.string().default(DEFAULT_PATTERN_COLOR),
    tilingDistribution: z.enum(['grid', 'offset', 'hex', 'radial', 'random', 'wave', 'zigzag', 'warped-grid']).default('offset'),
    tilingDirection: z.enum(['horizontal', 'vertical']).default('horizontal'),
    tilingOrientation: z.enum(['none', 'alternate', 'random', 'aligned']).default('none'),
    baseRotation: z.number().default(0),
    rotationClamp: z.number().optional(),
    /** Per-tile removal for the primary layer — same shape as
     *  `PatternLayer.removedTiles`. Enables thinning out the radial /
     *  grid via direct canvas clicks. */
    removedTiles: z.array(z.string()).default([]),

    // --- Additional layers (compound patterns, opt-in) ---------------
    extraLayers: z.array(PatternLayerSchema).default([]),

    // --- Global -----------------------------------------------------
    holeMode: z.enum(['default', 'margin', 'avoid']).default('default'),
    clipToOutline: z.boolean().default(true),
    debugMode: z.boolean().optional().default(false),
});

export const ProjectSchemaV1 = z.object({
    version: z.literal(1),
    timestamp: z.number(),
    base: BaseSettingsSchema,
    inlay: InlaySettingsSchema,
    geometry: GeometrySettingsSchema,
});

export const ProjectSchemaV2 = z.object({
    version: z.literal(2),
    timestamp: z.number(),
    mode: z.enum(['pattern', 'colorflow']).default('pattern'),
    base: BaseSettingsSchema,
    inlay: InlaySettingsSchema,
    geometry: GeometrySettingsSchema,
    imageMode: ColorFlowSettingsSchema.optional(),
});

export type ProjectDataV2 = z.infer<typeof ProjectSchemaV2>;

export function migrateV1ToV2(v1: unknown): ProjectDataV2 {
    const parsed = ProjectSchemaV1.parse(v1);
    return {
        version: 2,
        timestamp: parsed.timestamp,
        mode: 'pattern',
        base: parsed.base,
        inlay: parsed.inlay,
        geometry: parsed.geometry,
    };
}

export const ProjectSchema = ProjectSchemaV2;
export type ProjectData = z.infer<typeof ProjectSchema>;

export type BaseSettings = z.infer<typeof BaseSettingsSchema>;
export type InlaySettings = z.infer<typeof InlaySettingsSchema>;
export type GeometrySettings = z.infer<typeof GeometrySettingsSchema>;
export type PatternLayer = z.infer<typeof PatternLayerSchema>;

/**
 * Strip runtime-only fields (THREE.Shape / BufferGeometry arrays) from
 * a `GeometrySettings` snapshot so it survives `JSON.stringify`. The
 * primary layer drops `patternShapes`; every entry in `extraLayers`
 * drops its own `shapes`. Without this, `JSON.stringify` produces
 * non-rehydratable garbage (typed arrays, circular refs) AND blows the
 * localStorage quota for any project with two or more compound layers.
 *
 * Sites that must use it: 3MF sidecar writer, auto-save snapshot,
 * legacy `.zip` project bundle export.
 */
export function stripGeometryRuntime(geometry: GeometrySettings): GeometrySettings {
    return {
        ...geometry,
        patternShapes: null,
        extraLayers: (geometry.extraLayers ?? []).map((l) => ({ ...l, shapes: null })),
    };
}

/**
 * Uniform view of every pattern layer in play, including the primary one
 * synthesized from `GeometrySettings`'s flat fields. Construction loops
 * iterate this rather than special-casing layer 1.
 *
 * Layer 0 corresponds to the primary (flat-field) layer; index 1+ map to
 * `extraLayers`. Layers whose `shapes` are empty/null are filtered out so
 * an "empty extra layer" placeholder in the UI doesn't add a hidden empty
 * tile pass.
 */
export function getPatternLayers(g: GeometrySettings): PatternLayer[] {
    const primary: PatternLayer = {
        id: '__primary__',
        shapes: g.patternShapes ?? null,
        type: g.patternType,
        scale: g.patternScale,
        scaleZ: g.patternScaleZ,
        maxHeight: g.patternMaxHeight,
        isTiled: g.isTiled,
        tileSpacing: g.tileSpacing,
        margin: g.patternMargin,
        color: g.patternColor,
        distribution: g.tilingDistribution,
        direction: g.tilingDirection,
        orientation: g.tilingOrientation,
        rotation: g.baseRotation,
        rotationClamp: g.rotationClamp,
        removedTiles: g.removedTiles ?? [],
    };
    const all = [primary, ...(g.extraLayers ?? [])];
    return all.filter((l) => l.shapes && l.shapes.length > 0);
}
