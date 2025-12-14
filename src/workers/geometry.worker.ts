import * as THREE from 'three';
import { generateTilePositions, getShapesBounds, TileInstance } from '../utils/patternUtils';

export interface WorkerMessage {
    id: string;
    type: 'compute';
    payload: {
        patternShapes: { points: { x: number, y: number }[], holes: { points: { x: number, y: number }[] }[] }[]; // Serialized Shapes
        cutoutShapes: { points: { x: number, y: number }[], holes: { points: { x: number, y: number }[] }[] }[] | null; // Serialized
        patternType: 'dxf' | 'svg' | 'stl' | null;
        extrusionAngle: number;
        patternHeight: number | string;
        patternScale: number;
        isTiled: boolean;
        tileSpacing: number;
        patternMargin: number;
        tilingDistribution: any;
        tilingRotation: any;
        clipToOutline: boolean;
        size: number;
        thickness: number;
        isStl: boolean;
        geometryBounds?: { min: { x: number, y: number }, max: { x: number, y: number }, size: { x: number, y: number } }; // optimization for STL
    };
}

export interface WorkerResponse {
    id: string;
    success: boolean;
    data?: {
        instanceMatrices?: Float32Array; // M x 16
        geometry?: {
            position: Float32Array;
            normal: Float32Array;
            uv: Float32Array;
            index: Uint32Array | Uint16Array | null;
            groups: { start: number, count: number, materialIndex?: number }[];
        };
        // For STL fallback (if we generated instances but also need geometry for CSG, returning matrices is enough?)
        // If we need merged geometry for CSG, we might want to do merging HERE?
        // But CSG library is active in main thread for now.
        // Let's stick to returning Instances Matrices OR Single Geometry (if merged here, but merging is for CSG).
        // Let's start with returning Instance Matrices.
        // And returning the Extruded Unit Geometry (so main thread doesn't have to extrude).
    };
    error?: string;
}

// Helper to deserialize shapes
const deserializeShapes = (data: { points: { x: number, y: number }[], holes: { points: { x: number, y: number }[] }[] }[]): THREE.Shape[] => {
    return data.map(d => {
        const shape = new THREE.Shape();
        if (d.points.length > 0) {
            shape.moveTo(d.points[0].x, d.points[0].y);
            for (let i = 1; i < d.points.length; i++) {
                shape.lineTo(d.points[i].x, d.points[i].y);
            }
        }
        if (d.holes) {
            d.holes.forEach(h => {
                const path = new THREE.Path();
                if (h.points.length > 0) {
                    path.moveTo(h.points[0].x, h.points[0].y);
                    for (let i = 1; i < h.points.length; i++) {
                        path.lineTo(h.points[i].x, h.points[i].y);
                    }
                }
                shape.holes.push(path);
            });
        }
        return shape;
    });
};

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const { id, type, payload } = e.data;
    if (type !== 'compute') return;

    try {
        const {
            patternShapes, cutoutShapes, patternType,
            extrusionAngle, patternHeight, patternScale,
            isTiled, tileSpacing, patternMargin,
            tilingDistribution, tilingRotation, clipToOutline,
            size, thickness, isStl, geometryBounds
        } = payload;

        // 1. Reconstruct Input Data
        const deserializedPatternShapes = !isStl ? deserializeShapes(patternShapes) : null;
        const deserializedCutoutShapes = cutoutShapes ? deserializeShapes(cutoutShapes) : null;

        // 2. Calculate Unit Geometry (if not STL)
        let unitGeo: THREE.BufferGeometry | null = null;
        let unitShapes: THREE.Shape[] | null = null;
        let activePatternHeight = Number(patternHeight === '' ? 1 : patternHeight);

        // Bounds Calculation
        let pWidth = 0;
        let pHeight = 0;

        if (!isStl && deserializedPatternShapes) {
            // ... Logic duplicated from ImperativeModel ...
            const angleRad = (Math.abs(extrusionAngle) * Math.PI) / 180;
            let extrudeSettings: any = { depth: activePatternHeight, bevelEnabled: false };

            unitShapes = deserializedPatternShapes; // Already clean? Or need orientation check?
            // Sanitize and Validate
            unitShapes.forEach(s => {
                // 1. Remove close points (degenerate segments)
                const threshold = 0.0001;
                const newPts: THREE.Vector2[] = [];
                const src = s.getPoints();
                if (src.length > 0) {
                    newPts.push(src[0]);
                    for (let i = 1; i < src.length; i++) {
                        if (src[i].distanceTo(newPts[newPts.length - 1]) > threshold) {
                            newPts.push(src[i]);
                        }
                    }
                    // Check closure (start vs end) - Shape is implicitly closed, but if end == start, remove end
                    if (newPts.length > 1 && newPts[newPts.length - 1].distanceTo(newPts[0]) < threshold) {
                        newPts.pop();
                    }
                }

                // 2. Enforce CCW
                if (THREE.ShapeUtils.area(newPts) < 0) {
                    newPts.reverse();
                }

                // Rebuild Shape if changed
                s.curves = [];
                s.moveTo(newPts[0].x, newPts[0].y);
                for (let i = 1; i < newPts.length; i++) {
                    s.lineTo(newPts[i].x, newPts[i].y);
                }
            });

            if (Math.abs(extrusionAngle) > 0 && unitShapes.length > 0) {
                const shpBounds = getShapesBounds(unitShapes);
                const radius = Math.min(shpBounds.size.x, shpBounds.size.y) / 2;
                const scaledRadius = radius * patternScale;
                let autoHeight = scaledRadius / Math.tan(angleRad);

                if (patternHeight !== '' && Number(patternHeight) > 0) {
                    autoHeight = Math.min(autoHeight, Number(patternHeight));
                }
                activePatternHeight = autoHeight;

                extrudeSettings = {
                    depth: 0.05,
                    bevelEnabled: true,
                    bevelThickness: autoHeight,
                    bevelSize: -radius + 0.1,
                    bevelSegments: 1,
                    bevelOffset: 0
                };
            }

            // EXTRUDE (Heavy Op)
            unitGeo = new THREE.ExtrudeGeometry(unitShapes, extrudeSettings);

            // Center
            unitGeo.computeBoundingBox();
            const center = new THREE.Vector3();
            if (unitGeo.boundingBox) unitGeo.boundingBox.getCenter(center);
            unitGeo.translate(-center.x, -center.y, -center.z);

            pWidth = (unitGeo.boundingBox!.max.x - unitGeo.boundingBox!.min.x) * patternScale;
            pHeight = (unitGeo.boundingBox!.max.y - unitGeo.boundingBox!.min.y) * patternScale;

        } else if (isStl && geometryBounds) {
            // We don't generate geometry for STL here, but we need bounds for tiling
            pWidth = geometryBounds.size.x * patternScale;
            pHeight = geometryBounds.size.y * patternScale;
        }

        // 3. Tile Positions
        let bounds = new THREE.Box2(new THREE.Vector2(-size / 2, -size / 2), new THREE.Vector2(size / 2, size / 2));
        if (deserializedCutoutShapes && deserializedCutoutShapes.length > 0) {
            const sb = getShapesBounds(deserializedCutoutShapes);
            bounds = new THREE.Box2(sb.min, sb.max);
        }

        const positions = isTiled ? generateTilePositions(
            bounds, pWidth, pHeight, tileSpacing,
            deserializedCutoutShapes, patternMargin,
            clipToOutline, // Allow Partial
            tilingDistribution, tilingRotation
        ) : [{ position: new THREE.Vector2(0, 0), rotation: 0, scale: 1 }];


        // 4. Construct Response
        // Matrix Array for Instances
        const matrixArray = new Float32Array(positions.length * 16);
        const dummy = new THREE.Object3D();
        const zPos = thickness + Number(activePatternHeight) - 0.01;

        for (let i = 0; i < positions.length; i++) {
            const p = positions[i];
            dummy.position.set(p.position.x, p.position.y, zPos);
            dummy.rotation.set(0, 0, p.rotation);

            if (!isStl) {
                dummy.scale.set(patternScale, patternScale, -1);
            } else {
                // For STL we need Z height info which we don't have exactly if we didn't pass full geometry?
                // Wait, we need geometryBounds.max.z - min.z!
                // Let's assume passed in geometryBounds has Z size?
                // Or we pass `instH` calculation requirement?
                // We need Z size for STL positioning.
                // Let's rely on geometryBounds.size.z being passed if it exists (Box3).
                // For now, if we don't have it, we might err.
                // Actually, main thread sends `geometryBounds`.
                // Let's update interface to include Z size for STL.

                // Fallback if not STL logic:
                dummy.scale.set(patternScale * p.scale, patternScale * p.scale, patternScale * p.scale);
                // We can't set correct Z without height.
                // But wait, if we return MATRICES, the main thread can apply them?
                // No, main thread wants to feed InstancedMesh.
                // Correct logic: Main thread has the Unit Geometry.
                // Main thread can simply set matrices.
                // BUT Main thread is offloading tiling calculation.
                // Tiling calculation gives x,y,rot.
                // Matrix construction needs Z and Scale.
                // If we return the plain positions (x,y,rot,scale), Main thread can construct matrices very fast.
                // Matrix construction is 16 mults per instance. 10k instances = 160k ops. Fast.
                // Extrusion is millions of ops.
                // Tiling calc is thousands of checks.

                // Maybe we return positions/rotations/scales AND the UNIT GEOMETRY?
            }
            dummy.updateMatrix();
            dummy.matrix.toArray(matrixArray, i * 16);
        }

        // Transferables
        const transferables: Transferable[] = [matrixArray.buffer];

        let geometryData = undefined;
        if (unitGeo) {
            // Serialize Geometry
            const pos = unitGeo.attributes.position.array as Float32Array;
            const norm = unitGeo.attributes.normal?.array as Float32Array;
            const uv = unitGeo.attributes.uv?.array as Float32Array;
            const idx = unitGeo.index?.array as Uint32Array | Uint16Array;

            // Copies? Or transfer buffer?
            // If we transfer the buffer, the generic array becomes unusable in worker (fine).
            // But we need to make sure we own it.

            geometryData = {
                position: pos,
                normal: norm,
                uv: uv,
                index: idx,
                groups: unitGeo.groups
            };

            if (pos) transferables.push(pos.buffer);
            if (norm) transferables.push(norm.buffer);
            if (uv) transferables.push(uv.buffer);
            if (idx) transferables.push(idx.buffer);
        }

        const response: WorkerResponse = {
            id,
            success: true,
            data: {
                instanceMatrices: matrixArray,
                geometry: geometryData
            }
        };

        self.postMessage(response, transferables);

    } catch (err: any) {
        self.postMessage({ id, success: false, error: err.message });
    }
};
