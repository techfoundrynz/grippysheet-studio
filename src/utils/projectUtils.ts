
import {
    ProjectSchema,
    ProjectSchemaV1,
    ProjectData,
    BaseSettings,
    InlaySettings,
    GeometrySettings
} from '../types/schemas';
import JSZip from 'jszip';
import { detectAssetType } from './fileTypeSniffer';

export interface Asset {
    name: string;
    content: string | ArrayBuffer;
    type: 'dxf' | 'svg' | 'stl';
}

export interface ProjectAssets {
    baseOutline?: Asset;
    pattern?: Asset;
    inlays?: Record<string, Asset>;
}

// --- Export Logic ---

// --- Export Logic ---

export const exportProjectBundle = async (
    base: BaseSettings,
    inlay: InlaySettings,
    geometry: GeometrySettings,
    assets: ProjectAssets
) => {
    // Construct the project object
    // Note: We don't save the runtime shapes (Three.js objects) directly in JSON.
    // We explicitly strip them or ensure they are null to avoid circular structure errors if not handled.
    // In settings-only mode, we are fine losing the geometry.

    const projectData: ProjectData = {
        version: 1,
        timestamp: Date.now(),

        base: {
            ...base,
            cutoutShapes: null
        },
        inlay: {
            ...inlay
        },
        geometry: {
            ...geometry,
            patternShapes: null
        }
    };

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
    data: {
        base: BaseSettings;
        inlay: InlaySettings;
        geometry: GeometrySettings;
    };
    versionMismatch?: boolean;
    importedVersion?: number;
    importedAssets?: ProjectAssets;
}

export const importProjectBundle = async (file: File): Promise<ImportResult> => {
    let rawData: any;
    const assets: ProjectAssets = { inlays: {} };

    if (file.name.endsWith('.zip')) {
        const zip = await JSZip.loadAsync(file);

        // Read project.json
        const projectFile = zip.file("project.json");
        if (!projectFile) {
            throw new Error("Invalid bundle: project.json missing");
        }
        const text = await projectFile.async("text");
        rawData = JSON.parse(text);

        // Helper to process a zip entry
        const processEntry = async (entry: JSZip.JSZipObject, fallbackName: string) => {
            const buffer = await entry.async("arraybuffer");
            const name = entry.name.split('/').pop() || fallbackName;
            const type = detectAssetType(buffer, name);

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

        // Inlays
        const inlayEntries = Object.keys(zip.files).filter(path => path.startsWith('assets/inlays/') && !zip.files[path].dir);
        for (const path of inlayEntries) {
            const parts = path.split('/');
            // assets/inlays/<id>/<filename>
            if (parts.length === 4) {
                const id = parts[2];
                const entry = zip.files[path];

                const asset = await processEntry(entry, 'inlay');

                if (assets.inlays) {
                    assets.inlays[id] = asset;
                }
            }
        }

    } else {
        throw new Error("Invalid file type. Only .zip bundles are supported.");
    }


    // Basic Validation
    // We try to parse against Current Schema.

    let versionMismatch = false;
    if (rawData.version !== ProjectSchemaV1.shape.version.value) {
        versionMismatch = true;
    }

    const result = ProjectSchema.safeParse(rawData);

    if (!result.success) {
        console.warn("Schema validation failed:", result.error);
        throw new Error("Invalid project file format or version mismatch.");
    }

    const { base, inlay, geometry } = result.data;

    // Return pure settings. Shapes will be null/undefined as per schema.
    return {
        data: { base, inlay, geometry },
        versionMismatch,
        importedVersion: rawData.version,
        importedAssets: assets
    };
};
// Legacy alias if needed
export const importProject = importProjectBundle;
