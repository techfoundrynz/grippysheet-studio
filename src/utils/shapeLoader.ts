import { SVGLoader, STLLoader } from 'three-stdlib';
import * as THREE from 'three';
import { parseDxfToShapes } from './dxfUtils';
import { centerShapes } from './patternUtils';

export interface LoadedShapeResult {
    shapes: any[]; // THREE.Shape[] or objects { shape: THREE.Shape, color: string }
    success: boolean;
    error?: string;
}

export const parseShapeFile = (
    content: string | ArrayBuffer,
    type: 'dxf' | 'svg' | 'stl',
    extractColors: boolean = false
): LoadedShapeResult => {
    try {
        let loadedShapes: any[] = [];

        // Auto-detect type mismatch for text content
        let detectedType = type;
        if (typeof content === 'string') {
            const trimmed = content.trim();
            if (trimmed.startsWith('<svg') || trimmed.startsWith('<?xml') || trimmed.includes('<svg')) {
                detectedType = 'svg';
            } else if (trimmed.startsWith('SECTION') || trimmed.startsWith('  0')) {
                detectedType = 'dxf';
            }
        }

        if (detectedType === 'stl') {
            if (content instanceof ArrayBuffer) {
                const loader = new STLLoader();
                const geometry = loader.parse(content);
                geometry.center();
                loadedShapes = [geometry];
            } else {
                return { shapes: [], success: false, error: "STL content must be ArrayBuffer" };
            }
        } else if (detectedType === 'svg') {
            if (typeof content !== 'string') return { shapes: [], success: false, error: "SVG content must be string" };

            const loader = new SVGLoader();
            const data = loader.parse(content);

            data.paths.forEach((path) => {
                const fillColor = path.userData?.style?.fill;
                const color = (fillColor && fillColor !== 'none') ? fillColor : (path.color && path.color.getStyle());

                const subShapes = path.toShapes(true);
                subShapes.forEach(s => {
                    if (extractColors) {
                        loadedShapes.push({ shape: s, color: color || '#000000' });
                    } else {
                        loadedShapes.push(s);
                    }
                });
            });

            if (extractColors) {
                const rawShapes = loadedShapes.map(item => item.shape);
                const centered = centerShapes(rawShapes, true);
                loadedShapes = loadedShapes.map((item, i) => ({ ...item, shape: centered[i] }));
            } else {
                loadedShapes = centerShapes(loadedShapes as THREE.Shape[], true);
            }

        } else if (detectedType === 'dxf') {
            if (typeof content !== 'string') return { shapes: [], success: false, error: "DXF content must be string" };

            loadedShapes = parseDxfToShapes(content);
            if (extractColors) {
                loadedShapes = loadedShapes.map(s => ({ shape: s, color: '#000000' }));
            }
        } else {
            return { shapes: [], success: false, error: "Unsupported type" };
        }

        return { shapes: loadedShapes, success: true };

    } catch (err: any) {
        console.error("Error parsing shape:", err);
        return { shapes: [], success: false, error: err.message };
    }
};
