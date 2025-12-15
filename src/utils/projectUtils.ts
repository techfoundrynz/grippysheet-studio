
import {
    ProjectSchema,
    ProjectSchemaV1,
    ProjectData,
    BaseSettings,
    InlaySettings,
    GeometrySettings
} from '../types/schemas';

// --- Export Logic ---

export const exportProject = (
    base: BaseSettings,
    inlay: InlaySettings,
    geometry: GeometrySettings
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
            ...inlay,
            inlayShapes: null
        },
        geometry: {
            ...geometry,
            patternShapes: null
        }
    };

    // Serialize
    const jsonString = JSON.stringify(projectData, null, 2);

    // Download
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `grippysheet-project-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

// --- Import Logic ---

export interface ImportResult {
    data: {
        base: BaseSettings;
        inlay: InlaySettings;
        geometry: GeometrySettings;
    };
    versionMismatch?: boolean;
    importedVersion?: number;
}

export const importProject = async (file: File): Promise<ImportResult> => {
    const text = await file.text();
    const rawData = JSON.parse(text);

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
        importedVersion: rawData.version
    };
};
