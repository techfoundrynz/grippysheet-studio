import JSZip from 'jszip';
import { ProjectSchema, ProjectSchemaV1, ProjectDataV2, migrateV1ToV2, stripGeometryRuntime, normalizeExtraLayerIds } from '../types/schemas';
import type { ProjectAssets, Asset } from './projectUtils';
import { detectAssetType } from './fileTypeSniffer';

/**
 * Grippy embeds a complete project (settings + original asset bytes) inside
 * every 3MF it exports, under a private `Metadata/grippy/` namespace. The
 * Bambu/Orca/Cura slicers all ignore unknown `Metadata/` paths, so the same
 * file prints fine AND can be dropped back into the studio to keep editing.
 *
 * Layout written into the host JSZip:
 *
 *   Metadata/grippy/project.json
 *   Metadata/grippy/assets/base/<filename>
 *   Metadata/grippy/assets/pattern/<filename>
 *   Metadata/grippy/assets/inlays/<id>/<filename>
 *   Metadata/grippy/assets/image/<filename>
 *
 * This mirrors the legacy `.zip` bundle layout but lives under a stable
 * prefix so it never collides with a slicer's own metadata files.
 */

const SIDECAR_ROOT = 'Metadata/grippy';
const PROJECT_JSON = `${SIDECAR_ROOT}/project.json`;

export interface GrippySidecarPayload {
  /** Strip runtime-only fields (Three.js shapes) before serializing. */
  project: ProjectDataV2;
  assets: ProjectAssets;
}

/**
 * Write the Grippy project + assets into the supplied JSZip instance. The
 * caller decides when to call `zip.generateAsync` so this helper can be
 * composed with whichever 3MF writer is producing the bulk of the archive.
 */
export function addGrippySidecar(zip: JSZip, payload: GrippySidecarPayload): void {
    // The project.json is the marker subscribers look for. We strip
    // runtime-only Three.js shapes before serialising — they get rehydrated
    // from the asset bytes on import, same as the legacy .zip path.
    const projectData: ProjectDataV2 = {
        ...payload.project,
        base: { ...payload.project.base, cutoutShapes: null },
        geometry: stripGeometryRuntime(payload.project.geometry),
    };
    zip.file(PROJECT_JSON, JSON.stringify(projectData, null, 2));

    if (payload.assets.baseOutline) {
        zip.file(`${SIDECAR_ROOT}/assets/base/${payload.assets.baseOutline.name}`, payload.assets.baseOutline.content);
    }
    if (payload.assets.pattern) {
        zip.file(`${SIDECAR_ROOT}/assets/pattern/${payload.assets.pattern.name}`, payload.assets.pattern.content);
    }
    if (payload.assets.inlays) {
        Object.entries(payload.assets.inlays).forEach(([id, asset]) => {
            zip.file(`${SIDECAR_ROOT}/assets/inlays/${id}/${asset.name}`, asset.content);
        });
    }
    if (payload.assets.image) {
        zip.file(`${SIDECAR_ROOT}/assets/image/${payload.assets.image.name}`, payload.assets.image.content);
    }
    if (payload.assets.extraLayers) {
        Object.entries(payload.assets.extraLayers).forEach(([id, asset]) => {
            zip.file(`${SIDECAR_ROOT}/assets/extraLayers/${id}/${asset.name}`, asset.content);
        });
    }
}

/**
 * Read a Grippy sidecar out of a JSZip. Returns `null` when the archive
 * doesn't carry our metadata (i.e. it's a "naked" 3MF from a slicer or a
 * third-party tool — the import flow rejects those with a clear toast).
 *
 * Validates the embedded `project.json` against the current Zod schema +
 * runs the v1→v2 migrator so old exports still load.
 */
export async function readGrippySidecar(zip: JSZip): Promise<GrippySidecarPayload | null> {
    const projectFile = zip.file(PROJECT_JSON);
    if (!projectFile) return null;

    const text = await projectFile.async('text');
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (err) {
        throw new Error(`Grippy sidecar is corrupt: ${(err as Error).message}`);
    }

    // Migrate v1 → v2 if needed, otherwise validate v2 directly. Mirrors
    // the legacy `.zip` import path.
    const v1Parse = ProjectSchemaV1.safeParse(raw);
    let project: ProjectDataV2;
    if (v1Parse.success && (raw as { version?: number })?.version === 1) {
        project = migrateV1ToV2(v1Parse.data);
    } else {
        const v2Parse = ProjectSchema.safeParse(raw);
        if (!v2Parse.success) {
            throw new Error(`Grippy sidecar failed schema validation: ${v2Parse.error.message}`);
        }
        project = v2Parse.data;
    }

    const assets: ProjectAssets = { inlays: {} };
    const processEntry = async (entry: JSZip.JSZipObject, fallbackName: string, forcedType?: Asset['type']): Promise<Asset> => {
        const buffer = await entry.async('arraybuffer');
        const name = entry.name.split('/').pop() || fallbackName;
        const type: Asset['type'] = forcedType ?? detectAssetType(buffer, name);
        const content: string | ArrayBuffer = (type === 'svg' || type === 'dxf')
            ? new TextDecoder('utf-8').decode(buffer)
            : buffer;
        return { name, content, type };
    };

    // Base outline
    const baseFolder = zip.folder(`${SIDECAR_ROOT}/assets/base`);
    if (baseFolder) {
        const files = baseFolder.file(/.*/);
        if (files.length > 0) assets.baseOutline = await processEntry(files[0], 'baseOutline');
    }
    // Pattern
    const patternFolder = zip.folder(`${SIDECAR_ROOT}/assets/pattern`);
    if (patternFolder) {
        const files = patternFolder.file(/.*/);
        if (files.length > 0) assets.pattern = await processEntry(files[0], 'pattern');
    }
    // Inlays (path-traversal-safe ids, matching the legacy .zip importer).
    const isSafeInlayId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
    const inlayEntries = Object.keys(zip.files).filter((path) => path.startsWith(`${SIDECAR_ROOT}/assets/inlays/`) && !zip.files[path].dir);
    for (const path of inlayEntries) {
        const parts = path.split('/');
        // Metadata/grippy/assets/inlays/<id>/<filename> → 6 segments
        if (parts.length === 6) {
            const id = parts[4];
            if (!isSafeInlayId(id)) {
                console.warn(`[grippySidecar] skipping inlay with unsafe id: ${JSON.stringify(id)}`);
                continue;
            }
            if (assets.inlays) {
                assets.inlays[id] = await processEntry(zip.files[path], 'inlay');
            }
        }
    }
    // Image (ColorFlow)
    const imageFolder = zip.folder(`${SIDECAR_ROOT}/assets/image`);
    if (imageFolder) {
        const files = imageFolder.file(/.*/);
        if (files.length > 0) assets.image = await processEntry(files[0], 'image', 'image');
    }

    // Extra pattern layers — same path-safe id pattern as inlays since the
    // ids are user-uncontrolled but we route them into a Record<id, Asset>
    // that downstream code keys directly on.
    assets.extraLayers = {};
    const extraEntries = Object.keys(zip.files).filter((path) => path.startsWith(`${SIDECAR_ROOT}/assets/extraLayers/`) && !zip.files[path].dir);
    for (const path of extraEntries) {
        const parts = path.split('/');
        // Metadata/grippy/assets/extraLayers/<id>/<filename> → 6 segments
        if (parts.length === 6) {
            const id = parts[4];
            if (!isSafeInlayId(id)) {
                console.warn(`[grippySidecar] skipping extra layer with unsafe id: ${JSON.stringify(id)}`);
                continue;
            }
            assets.extraLayers[id] = await processEntry(zip.files[path], 'extraLayer');
        }
    }

    // Rewrite reserved/duplicate extraLayer ids. Mirrors the .zip path in
    // projectUtils.importProjectBundle so both routes apply the same id
    // safety contract.
    const { layers: normalizedExtras, idMap } = normalizeExtraLayerIds(project.geometry.extraLayers);
    if ([...idMap.entries()].some(([from, to]) => from !== to)) {
        const collisions = [...idMap.entries()].filter(([from, to]) => from !== to);
        console.warn(`[grippySidecar] rewrote ${collisions.length} reserved/duplicate extraLayer id(s):`, collisions);
        project.geometry.extraLayers = normalizedExtras;
        if (assets.extraLayers) {
            const rekeyed: Record<string, Asset> = {};
            for (const [oldId, asset] of Object.entries(assets.extraLayers)) {
                const newId = idMap.get(oldId) ?? oldId;
                rekeyed[newId] = asset;
            }
            assets.extraLayers = rekeyed;
        }
    }

    return { project, assets };
}

/** Does this archive carry a Grippy sidecar? Cheap-prefix check. */
export function hasGrippySidecar(zip: JSZip): boolean {
    return zip.file(PROJECT_JSON) !== null;
}
