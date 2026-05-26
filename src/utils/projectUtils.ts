
import {
    ProjectSchema, ProjectSchemaV1, ProjectDataV2,
    BaseSettings, InlaySettings, GeometrySettings,
    migrateV1ToV2,
} from '../types/schemas';
import { ColorFlowSettings } from '../colorflow/schema';
import JSZip from 'jszip';
import { detectAssetType } from './fileTypeSniffer';

export interface Asset {
    name: string;
    content: string | ArrayBuffer;
    type: 'dxf' | 'svg' | 'stl' | 'image';
}

export interface ProjectAssets {
    baseOutline?: Asset;
    pattern?: Asset;
    inlays?: Record<string, Asset>;
    image?: Asset;  // ColorFlow image bytes
}

// --- Export Logic ---

export const exportProjectBundle = async (
    mode: 'pattern' | 'colorflow',
    base: BaseSettings,
    inlay: InlaySettings,
    geometry: GeometrySettings,
    imageMode: ColorFlowSettings | undefined,
    assets: ProjectAssets
) => {
    const projectData = {
        version: 2 as const,
        timestamp: Date.now(),
        mode,
        base: { ...base, cutoutShapes: null },
        inlay: { ...inlay },
        geometry: { ...geometry, patternShapes: null },
        imageMode,
    } satisfies ProjectDataV2;

    const zip = new JSZip();
    zip.file("project.json", JSON.stringify(projectData, null, 2));

    // Add Assets
    if (assets.baseOutline) {
        zip.file(`assets/base/${assets.baseOutline.name}`, assets.baseOutline.content);
    }

    if (assets.pattern) {
        zip.file(`assets/pattern/${assets.pattern.name}`, assets.pattern.content);
    }

    if (assets.inlays) {
        Object.entries(assets.inlays).forEach(([id, asset]) => {
            zip.file(`assets/inlays/${id}/${asset.name}`, asset.content);
        });
    }

    if (assets.image) {
        zip.file(`assets/image/${assets.image.name}`, assets.image.content);
    }

    // Generate Zip
    const content = await zip.generateAsync({ type: "blob" });

    // Download
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `grippysheet-bundle-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

// Legacy Export (keep for compatibility if needed, but we'll prefer bundle)


// --- Import Logic ---

export interface ImportResult {
    data: ProjectDataV2;
    versionMismatch?: boolean;
    importedVersion?: number;
    importedAssets?: ProjectAssets;
}

// Zip-bomb defence: bound a single bundle's footprint so a tiny .zip
// can't expand into gigabytes of decompressed content and freeze the tab
// (or get the worker OOM-killed on mobile). Numbers are generous for a
// legit project (~50 colors × few-MB inlays) but reject pathological input.
const MAX_BUNDLE_ENTRIES = 256;
const MAX_BUNDLE_DECOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_BUNDLE_ENTRY_BYTES = 50 * 1024 * 1024;        // 50 MB per file

// JSZip stores per-entry compressed/decompressed sizes in `_data` on the
// internal `JSZipObject`. Public typings hide it, hence the structural cast.
type SizedJSZipObject = JSZip.JSZipObject & { _data?: { uncompressedSize?: number } };
function bundleSizesFromZip(zip: JSZip): { total: number; worstEntry: number; entryCount: number } {
    let total = 0;
    let worstEntry = 0;
    let entryCount = 0;
    Object.values(zip.files).forEach((entry) => {
        if (entry.dir) return;
        entryCount += 1;
        const size = (entry as SizedJSZipObject)._data?.uncompressedSize ?? 0;
        if (size > worstEntry) worstEntry = size;
        total += size;
    });
    return { total, worstEntry, entryCount };
}

export const importProjectBundle = async (file: File): Promise<ImportResult> => {
    let rawData: any;
    const assets: ProjectAssets = { inlays: {} };

    if (file.name.endsWith('.zip')) {
        const zip = await JSZip.loadAsync(file);

        // Bound the bundle before decompressing anything. Rejects zip
        // bombs (tiny compressed → enormous decompressed) before they can
        // allocate.
        const sizes = bundleSizesFromZip(zip);
        if (sizes.entryCount > MAX_BUNDLE_ENTRIES) {
            throw new Error(`Bundle has too many entries (${sizes.entryCount} > ${MAX_BUNDLE_ENTRIES}). Suspected zip bomb — refusing to import.`);
        }
        if (sizes.total > MAX_BUNDLE_DECOMPRESSED_BYTES) {
            throw new Error(`Bundle is too large when decompressed (${(sizes.total / 1024 / 1024).toFixed(1)} MB > ${MAX_BUNDLE_DECOMPRESSED_BYTES / 1024 / 1024} MB). Suspected zip bomb — refusing to import.`);
        }
        if (sizes.worstEntry > MAX_BUNDLE_ENTRY_BYTES) {
            throw new Error(`Bundle contains an entry larger than ${MAX_BUNDLE_ENTRY_BYTES / 1024 / 1024} MB. Refusing to import.`);
        }

        // Read project.json
        const projectFile = zip.file("project.json");
        if (!projectFile) {
            throw new Error("Invalid bundle: project.json missing");
        }
        const text = await projectFile.async("text");
        rawData = JSON.parse(text);

        // Helper to process a zip entry. `forcedType` overrides the sniffer
        // when we know the kind from the asset slot (e.g. ColorFlow image
        // bytes aren't sniffable as shapes — the slot dictates the type).
        const processEntry = async (
            entry: JSZip.JSZipObject,
            fallbackName: string,
            forcedType?: Asset['type'],
        ): Promise<Asset> => {
            const buffer = await entry.async("arraybuffer");
            const name = entry.name.split('/').pop() || fallbackName;
            const type: Asset['type'] = forcedType ?? detectAssetType(buffer, name);

            let content: string | ArrayBuffer = buffer;
            if (type === 'svg' || type === 'dxf') {
                content = new TextDecoder('utf-8').decode(buffer);
            }

            return { name, content, type };
        };

        // Load Assets
        // Base
        const baseFolder = zip.folder("assets/base");
        if (baseFolder) {
            const files = await baseFolder.file(/.*/); // Get all files
            if (files.length > 0) {
                assets.baseOutline = await processEntry(files[0], 'baseOutline');
            }
        }

        // Pattern
        const patternFolder = zip.folder("assets/pattern");
        if (patternFolder) {
            const files = await patternFolder.file(/.*/);
            if (files.length > 0) {
                assets.pattern = await processEntry(files[0], 'pattern');
            }
        }

        // Inlays. `id` is keyed into a plain object, so we have to reject
        // path-traversal-y segments before they pollute `assets.inlays`
        // with attacker-chosen keys ('..', '__proto__', etc.). The id
        // pattern from our exporter is a uuid-ish ASCII slug.
        const isSafeInlayId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
        const inlayEntries = Object.keys(zip.files).filter(path => path.startsWith('assets/inlays/') && !zip.files[path].dir);
        for (const path of inlayEntries) {
            const parts = path.split('/');
            // assets/inlays/<id>/<filename>
            if (parts.length === 4) {
                const id = parts[2];
                if (!isSafeInlayId(id)) {
                    console.warn(`[importProjectBundle] skipping inlay with unsafe id: ${JSON.stringify(id)}`);
                    continue;
                }
                const entry = zip.files[path];

                const asset = await processEntry(entry, 'inlay');

                if (assets.inlays) {
                    assets.inlays[id] = asset;
                }
            }
        }

        // Image (ColorFlow) — sniffer can't classify raster bytes, so we
        // force the type from the slot.
        const imageFolder = zip.folder('assets/image');
        if (imageFolder) {
            const files = imageFolder.file(/.*/);
            if (files.length > 0) {
                assets.image = await processEntry(files[0], 'image', 'image');
            }
        }

    } else {
        throw new Error("Invalid file type. Only .zip bundles are supported.");
    }

    // Route v1 bundles through the migrator; validate v2 against ProjectSchema.
    if (rawData.version === ProjectSchemaV1.shape.version.value) {
        const migrated = migrateV1ToV2(rawData);
        return { data: migrated, versionMismatch: false, importedVersion: 1, importedAssets: assets };
    }

    const result = ProjectSchema.safeParse(rawData);

    if (!result.success) {
        console.warn("Schema validation failed:", result.error);
        throw new Error("Invalid project file format or version mismatch.");
    }

    // Return full ProjectDataV2.
    return {
        data: result.data,
        versionMismatch: false,
        importedVersion: rawData.version,
        importedAssets: assets
    };
};
// Legacy alias if needed
export const importProject = importProjectBundle;
