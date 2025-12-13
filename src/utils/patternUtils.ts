import * as THREE from 'three';

export interface TileInstance {
    position: THREE.Vector2;
    rotation: number;
    scale: number;
}

/**
 * Calculates the bounding box of a set of shapes.
 */
export const getShapesBounds = (shapes: THREE.Shape[]) => {
    const min = new THREE.Vector2(Infinity, Infinity);
    const max = new THREE.Vector2(-Infinity, -Infinity);

    shapes.forEach(shape => {
        shape.getPoints().forEach(p => {
            min.min(p);
            max.max(p);
        });
    });

    // If no shapes, return 0 box
    if (min.x === Infinity) return { min: new THREE.Vector2(0, 0), max: new THREE.Vector2(0, 0), center: new THREE.Vector2(0, 0), size: new THREE.Vector2(0, 0) };

    const size = new THREE.Vector2().subVectors(max, min);
    const center = new THREE.Vector2().addVectors(min, max).multiplyScalar(0.5);

    return { min, max, center, size };
};

export const getGeometryBounds = (geometry: THREE.BufferGeometry) => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return { min: new THREE.Vector2(0, 0), max: new THREE.Vector2(0, 0), size: new THREE.Vector2(0, 0), center: new THREE.Vector2(0, 0) };

    // We assume geometry is lying on XZ plane or XY? 
    // Usually STLs are 3D. We care about footprint on the surface.
    // Assuming surface is XY plane for pattern generation context (before extrusion/rotation).
    // Or XZ?
    // In ModelViewer: pattern is on top of Base (XZ plane usually).
    // Let's assume X and Y are the dimensions we care about for tiling.
    // If STL is oriented differently, user might need to rotate it (not supported yet).
    // Let's assume standard orientation.

    // Actually, ModelViewer rotates pattern mesh: rotation={[patternDirection === 'up' ? -Math.PI / 2 : Math.PI / 2, 0, 0]}
    // This means the generic "Pattern" mesh local space has XY parallel to Base surface?
    // -PI/2 rotation around X means:
    // Local Y -> Global Z.
    // Local Z -> Global -Y.
    // Local X -> Global X.
    // So Local XY plane maps to Global XZ plane.
    // So yes, we care about X and Y bounds of the geometry.

    const min = new THREE.Vector2(box.min.x, box.min.y);
    const max = new THREE.Vector2(box.max.x, box.max.y);
    const size = new THREE.Vector2(box.max.x - box.min.x, box.max.y - box.min.y);
    const center = new THREE.Vector2(
        (box.max.x + box.min.x) / 2,
        (box.max.y + box.min.y) / 2
    );

    return { min, max, size, center };
};




const isPointInShape = (p: THREE.Vector2, shape: THREE.Shape): boolean => {
    const points = shape.getPoints();
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x, yi = points[i].y;
        const xj = points[j].x, yj = points[j].y;

        const intersect = ((yi > p.y) !== (yj > p.y)) &&
            (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

/**
 * Calculates the shortest distance from a point to a shape's edge (segments).
 * Returns approximate distance. (Positive).
 * Does not determine inside/outside (use isPointInShape for that).
 */
export const getDistanceToShape = (point: THREE.Vector2, shape: THREE.Shape): number => {
    let minDst = Infinity;
    const points = shape.getPoints();

    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];

        // Distance to segment p1-p2
        const l2 = p1.distanceToSquared(p2);
        if (l2 === 0) {
            minDst = Math.min(minDst, point.distanceTo(p1));
            continue;
        }

        // Project point onto line, clamped to segment
        let t = ((point.x - p1.x) * (p2.x - p1.x) + (point.y - p1.y) * (p2.y - p1.y)) / l2;
        t = Math.max(0, Math.min(1, t));

        const proj = new THREE.Vector2(
            p1.x + t * (p2.x - p1.x),
            p1.y + t * (p2.y - p1.y)
        );

        minDst = Math.min(minDst, point.distanceTo(proj));
    }
    return minDst;
};

/**
 * Generates positions for tiling, filtered by a boundary shape.
 */
export const generateTilePositions = (
    bounds: THREE.Box2,
    tileWidth: number,
    tileHeight: number,
    spacing: number,
    boundaryShapes: THREE.Shape[] | null,
    margin: number = 0,
    allowPartial: boolean = false,
    distribution: 'grid' | 'offset' | 'random' = 'grid',
    rotationMode: 'none' | 'alternate' | 'random' = 'none'
): TileInstance[] => {
    // Safety check
    if (tileWidth <= 0 || tileHeight <= 0) return [];

    const positions: TileInstance[] = [];

    // Grid calculations
    const fullWidth = tileWidth + spacing;
    const fullHeight = tileHeight + spacing;

    // Buffer for edge checking
    const buffer = allowPartial ? Math.max(fullWidth, fullHeight) : 0;
    const startX = bounds.min.x - buffer;
    const startY = bounds.min.y - buffer;
    const endX = bounds.max.x + buffer;
    const endY = bounds.max.y + buffer;

    // Bounds Size (for random)
    const spanW = (endX - startX);
    const spanH = (endY - startY);

    // --- Helper for Validity Check (Shape/Bounds) ---
    const checkPosition = (px: number, py: number): boolean => {
        const center = new THREE.Vector2(px, py);
        if (boundaryShapes && boundaryShapes.length > 0) {
            const halfW = tileWidth / 2;
            const halfH = tileHeight / 2;

            const testPoints = [
                center,
                new THREE.Vector2(px - halfW, py - halfH),
                new THREE.Vector2(px + halfW, py - halfH),
                new THREE.Vector2(px + halfW, py + halfH),
                new THREE.Vector2(px - halfW, py + halfH)
            ];

            let validCount = 0;
            for (const p of testPoints) {
                let pValid = false;
                // Must be inside ANY shape
                for (const shape of boundaryShapes) {
                    if (isPointInShape(p, shape)) {
                        // Check Margin
                        if (margin > 0) {
                            const dist = getDistanceToShape(p, shape);
                            if (dist >= margin) {
                                pValid = true;
                                break;
                            }
                        } else {
                            pValid = true;
                            break;
                        }
                    }
                }
                if (pValid) validCount++;
                else if (!allowPartial) break; // Optimization
            }

            if (allowPartial) {
                return validCount > 0;
            } else {
                return validCount === testPoints.length;
            }
        } else {
            // Box Check (Bounds)
            const safeMinX = bounds.min.x + margin;
            const safeMaxX = bounds.max.x - margin;
            const safeMinY = bounds.min.y + margin;
            const safeMaxY = bounds.max.y - margin;

            const halfW = tileWidth / 2;
            const halfH = tileHeight / 2;

            const tMinX = px - halfW;
            const tMaxX = px + halfW;
            const tMinY = py - halfH;
            const tMaxY = py + halfH;

            if (allowPartial) {
                if (tMaxX < safeMinX || tMinX > safeMaxX || tMaxY < safeMinY || tMinY > safeMaxY) return false;
            } else {
                if (tMinX < safeMinX || tMaxX > safeMaxX || tMinY < safeMinY || tMaxY > safeMaxY) return false;
            }
            return true;
        }
    };

    // --- Helper for Rotation ---
    const getRotation = (c: number, r: number): number => {
        if (rotationMode === 'random') return Math.random() * Math.PI * 2;
        if (rotationMode === 'alternate') {
            // Checkerboard
            return ((c + r) % 2 !== 0) ? Math.PI / 2 : 0;
        }
        return 0;
    };


    if (distribution === 'random') {
        // --- Random / Scatter Logic ---
        // Naive rejection sampling
        // Try to fill area with max attempts logic

        // Estimate max tiles based on area
        const area = spanW * spanH;
        const tileArea = fullWidth * fullHeight;
        const maxTiles = Math.floor(area / tileArea) * 2; // Heuristic cap
        const maxAttempts = maxTiles * 50;

        // Use a simple array for collision check (optimize later if needed)
        // Check dist > size/2 + spacing + existingSize/2
        // Assumes circular collision radius for simplicity or Box?
        // Box overlap for strictness. Let's use Radius for speed and "Scatter" feel.
        // effective radius = max(w,h)/2 + spacing/2? 
        // Or simply: dist > max(w,h) + spacing?
        // If we want tight packing this is too generous. 
        // Correct check: Rect Intersect.

        const rects: { x: number, y: number, w: number, h: number }[] = [];

        let attempts = 0;
        let count = 0;

        // Seeded random would be better but simple random for now.
        // Needs to fill relevant area only.

        while (attempts < maxAttempts && count < maxTiles) {
            attempts++;
            const rx = startX + Math.random() * spanW;
            const ry = startY + Math.random() * spanH;

            // 1. Check Collision with existing
            let collision = false;
            for (const rect of rects) {
                // Simple AABB overlap check for spacing
                // New Rect: [rx-w/2, rx+w/2] ...
                // Effectively check center distances vs collision box
                // But rotation makes this hard. 
                // Assuming worst case (bounding circle) is safest for "Random".
                // Radius = Hypotenuse / 2.

                const dx = rx - rect.x;
                const dy = ry - rect.y;
                // distance squared
                const d2 = dx * dx + dy * dy;

                // Required distance?
                // If we successfully placed it, we don't want overlap.
                // Min dist centers > (size + spacing)?
                // Let's use crude circle check for speed: 
                // radius = Math.max(tileWidth, tileHeight) / 2 + spacing/2;
                // minCenterDist = radius * 2;
                const minDist = Math.max(tileWidth, tileHeight) + spacing;
                if (d2 < minDist * minDist) {
                    collision = true;
                    break;
                }
            }

            if (collision) continue;

            // 2. Check Boundary Validity
            if (!checkPosition(rx, ry)) continue;

            // Valid!
            rects.push({ x: rx, y: ry, w: tileWidth, h: tileHeight });
            positions.push({
                position: new THREE.Vector2(rx, ry),
                rotation: getRotation(count, 0), // Index based alternate won't work well for random, effectively random
                scale: 1
            });
            count++;
        }

    } else {
        // --- Grid / Offset Grid Logic ---

        // Center Grid
        const boundsCenter = new THREE.Vector2();
        bounds.getCenter(boundsCenter);

        const cols = Math.ceil(spanW / fullWidth);
        const rows = Math.ceil(spanH / fullHeight);

        const grossGridWidth = cols * fullWidth;
        const grossGridHeight = rows * fullHeight;

        const gridOriginX = boundsCenter.x - (grossGridWidth / 2) + (fullWidth / 2);
        const gridOriginY = boundsCenter.y - (grossGridHeight / 2) + (fullHeight / 2);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                // Offset Logic
                let cx = gridOriginX + c * fullWidth;
                const cy = gridOriginY + r * fullHeight;

                if (distribution === 'offset') {
                    // Offset every other row
                    if (r % 2 !== 0) {
                        cx += fullWidth / 2;
                    }
                }

                if (checkPosition(cx, cy)) {
                    positions.push({
                        position: new THREE.Vector2(cx, cy),
                        rotation: getRotation(c, r),
                        scale: 1
                    });
                }
            }
        }
    }

    return positions;
};

/**
 * Tiles the given shapes across a rectangular area centered at 0,0.
 * Updated to respect bounds and margin.
 */
export const tileShapes = (
    patternShapes: any[],
    bounds: THREE.Box2,
    scale: number,
    spacing: number,
    boundaryShapes: THREE.Shape[] | null,
    margin: number = 0,
    patternType?: 'dxf' | 'svg' | 'stl' | null,
    allowPartial: boolean = false,
    distribution: 'grid' | 'offset' | 'random' = 'grid',
    rotationMode: 'none' | 'alternate' | 'random' = 'none'
): any[] => {
    if (!patternShapes || patternShapes.length === 0) return [];

    // 1. Calculate Pattern Size
    let patternWidth = 0;
    let patternHeight = 0;

    // For tiling, we need the bounding box of the unit pattern
    if (patternType === 'stl'
        || (patternShapes.length > 0 && patternShapes[0] instanceof THREE.BufferGeometry)) {
        const geoBounds = getGeometryBounds(patternShapes[0]);
        patternWidth = geoBounds.size.x * scale;
        patternHeight = geoBounds.size.y * scale;
    } else {
        const shpBounds = getShapesBounds(patternShapes);
        patternWidth = shpBounds.size.x * scale;
        patternHeight = shpBounds.size.y * scale;
    }

    // 2. Generate Positions
    const positions = generateTilePositions(
        bounds,
        patternWidth,
        patternHeight,
        spacing,
        boundaryShapes,
        margin,
        allowPartial,
        distribution,
        rotationMode
    );

    const tiledShapes: any[] = [];

    // 3. Clone and Translate
    let sourceCenter = new THREE.Vector2(0, 0);
    if (patternType !== 'stl' && patternShapes.length > 0) {
        const shpBounds = getShapesBounds(patternShapes);
        sourceCenter = shpBounds.center;
    }

    for (const instance of positions) {
        const pos = instance.position; // Access Vector2 from TileInstance
        const rot = instance.rotation;

        // For STL/Geometry
        if (patternType === 'stl'
            || (patternShapes.length > 0 && patternShapes[0] instanceof THREE.BufferGeometry)) {

            for (const geom of patternShapes) {
                const clone = geom.clone();
                // Geometry scaling is usually done via matrix or scale property if it's a Mesh. 
                // But here we are returning Geometry! 
                // BufferGeometry has .scale(x,y,z) method.
                clone.scale(scale, scale, 1); // Scale X/Y. Z? User might expect Z scale? 
                // Usually patternScale applies to X/Y footprint. Height is separate.

                // Rotate (around Z Axis for 2D pattern)
                // Geometry rotation is around origin (0,0,0). 
                // We are assuming pattern is centered at 0,0 locally.
                if (rot !== 0) clone.rotateZ(rot);

                // Translate
                // Scale is around (0,0,0) usually. 
                // If we want to scale around center, we need to center, scale, uncenter?
                // Or assume centered.
                // Simplest: Scale, then Translate.
                clone.translate(pos.x, pos.y, 0);
                tiledShapes.push(clone);
            }

        } else {
            // For Shapes (DXF/SVG)
            for (const shape of patternShapes) {
                // Transform: Rotate THEN Scale THEN Translate
                // (Point - SourceCenter) -> Rotate -> Scale -> + Pos

                const transformPoint = (p: THREE.Vector2) => {
                    let x = p.x - sourceCenter.x;
                    let y = p.y - sourceCenter.y;

                    // Rotate
                    if (rot !== 0) {
                        const cos = Math.cos(rot);
                        const sin = Math.sin(rot);
                        const rx = x * cos - y * sin;
                        const ry = x * sin + y * cos;
                        x = rx;
                        y = ry;
                    }

                    // Scale
                    x *= scale;
                    y *= scale;

                    // Translate
                    return new THREE.Vector2(x + pos.x, y + pos.y);
                };

                const newPts = shape.getPoints().map(transformPoint);
                const newShape = new THREE.Shape(newPts);

                if (shape.holes && shape.holes.length > 0) {
                    newShape.holes = shape.holes.map((h: THREE.Path) => {
                        const hPts = h.getPoints();
                        const newHPts = hPts.map(transformPoint);
                        return new THREE.Path(newHPts);
                    });
                }

                tiledShapes.push(newShape);
            }
        }
    }

    return tiledShapes;
};
