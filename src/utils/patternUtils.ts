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
    distribution: 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave' | 'zigzag' | 'warped-grid' = 'grid',
    orientation: 'none' | 'alternate' | 'random' | 'aligned' = 'none',
    direction: 'horizontal' | 'vertical' = 'horizontal',
    exclusionShapes: THREE.Shape[] | null = null,
    inclusionShapes: THREE.Shape[] | null = null
): TileInstance[] => {
    // Safety check
    if (!bounds) return [];

    const positions: TileInstance[] = [];

    // Buffer for edge checking
    // Unused variables removed for cleanup

    // Bounds Size (for random)
    // const spanW = (endX - startX);
    // const spanH = (endY - startY);

    // --- Helper for Validity Check (Shape/Bounds) ---
    const checkPosition = (px: number, py: number): boolean => {
        const center = new THREE.Vector2(px, py);
        const halfW = tileWidth / 2;
        const halfH = tileHeight / 2;

        // Use 5 test points (Center + Corners) to determine containment
        const testPoints = [
            center,
            new THREE.Vector2(px - halfW, py - halfH),
            new THREE.Vector2(px + halfW, py - halfH),
            new THREE.Vector2(px + halfW, py + halfH),
            new THREE.Vector2(px - halfW, py + halfH)
        ];

        // 1. Check Exclusion Zones
        if (exclusionShapes && exclusionShapes.length > 0) {
            let pointsFullyExcluded = 0;

            for (const pt of testPoints) {
                let isPtExcluded = false;

                // Must be inside ANY exclusion shape
                for (const shape of exclusionShapes) {
                    if (isPointInShape(pt, shape)) {
                        isPtExcluded = true;
                        break;
                    }
                }

                // But NOT inside ANY inclusion shape (rescue)
                if (isPtExcluded && inclusionShapes && inclusionShapes.length > 0) {
                    for (const shape of inclusionShapes) {
                        if (isPointInShape(pt, shape)) {
                            isPtExcluded = false;
                            break;
                        }
                    }
                }

                if (isPtExcluded) pointsFullyExcluded++;
            }

            // ONLY exclude if ALL points are in the exclusion zone.
            // If even one point is outside (partial overlap), we KEEP it (to be cut by CSG later).
            if (pointsFullyExcluded === testPoints.length) return false;
        }

        if (boundaryShapes && boundaryShapes.length > 0) {
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
    const getRotation = (c: number, r: number, x: number, y: number): number => {
        if (orientation === 'random') return Math.random() * Math.PI * 2;
        if (orientation === 'alternate') {
            // Checkerboard
            return ((c + r) % 2 !== 0) ? Math.PI / 2 : 0;
        }
        if (orientation === 'aligned') {
            // Tangential to Center
            const center = new THREE.Vector2();
            bounds.getCenter(center);
            const angle = Math.atan2(y - center.y, x - center.x);
            return angle + Math.PI / 2;
        }
        return 0;
    };


    const fullWidth = tileWidth + spacing;
    const fullHeight = tileHeight + spacing;

    if (distribution === 'random') {
        // --- Random / Scatter Logic ---

        // Estimate max tiles based on area
        const spanW = bounds.max.x - bounds.min.x;
        const spanH = bounds.max.y - bounds.min.y;
        const area = spanW * spanH;
        const tileArea = fullWidth * fullHeight;
        const maxTiles = Math.floor(area / tileArea) * 2;
        const maxAttempts = maxTiles * 50;

        const startX = bounds.min.x + fullWidth / 2;
        const startY = bounds.min.y + fullHeight / 2;
        const effSpanW = Math.max(0, spanW - fullWidth);
        const effSpanH = Math.max(0, spanH - fullHeight);

        const rects: { x: number, y: number, w: number, h: number }[] = [];

        let attempts = 0;
        let count = 0;

        while (attempts < maxAttempts && count < maxTiles) {
            attempts++;
            const rx = startX + Math.random() * effSpanW;
            const ry = startY + Math.random() * effSpanH;

            // 1. Check Collision with existing
            let collision = false;
            for (const rect of rects) {
                const dx = rx - rect.x;
                const dy = ry - rect.y;
                const d2 = dx * dx + dy * dy;
                // Use slightly relaxed spacing for random to allow denser packing?
                // Or strict: tileWidth + spacing
                const minDist = (tileWidth + tileHeight) / 2 + spacing * 0.8;
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
                rotation: getRotation(count, 0, rx, ry),
                scale: 1
            });
            count++;
        }
    } else if (distribution === 'radial') {
        // --- Radial Logic ---
        const boundsCenter = new THREE.Vector2();
        bounds.getCenter(boundsCenter);

        const bWidth = bounds.max.x - bounds.min.x;
        const bHeight = bounds.max.y - bounds.min.y;
        const maxDim = Math.max(bWidth, bHeight) * 0.6; // extent

        // Center point
        if (checkPosition(boundsCenter.x, boundsCenter.y)) {
            positions.push({
                position: boundsCenter.clone(),
                rotation: 0,
                scale: 1
            });
        }

        // Step size ~ tile size + spacing
        const stepSize = Math.max(tileWidth, tileHeight) + spacing;

        let currentRadius = stepSize;

        while (currentRadius < maxDim) {
            const circumference = 2 * Math.PI * currentRadius;
            // Arc length per item approx tileWidth + spacing
            const arcLen = Math.max(tileWidth, tileHeight) + spacing;
            const count = Math.floor(circumference / arcLen);

            if (count > 0) {
                const angleStep = (2 * Math.PI) / count;
                // alternating offset for packing
                const ringIndex = Math.round(currentRadius / stepSize);
                const angleOffset = (ringIndex % 2 === 0) ? angleStep / 2 : 0;

                for (let i = 0; i < count; i++) {
                    const angle = i * angleStep + angleOffset;
                    const x = boundsCenter.x + currentRadius * Math.cos(angle);
                    const y = boundsCenter.y + currentRadius * Math.sin(angle);

                    if (checkPosition(x, y)) {
                        positions.push({
                            position: new THREE.Vector2(x, y),
                            rotation: getRotation(i, ringIndex, x, y),
                            scale: 1
                        });
                    }
                }
            }
            currentRadius += stepSize;
        }

    } else if (distribution === 'hex') {
        // --- Hex Cluster Logic (Clusters of 6) ---
        // 6 items arranged in a ring.
        // Ring Radius (center to item center) such that items have `spacing` gap.
        // Side length of huge hex = R. Distance between neighbors = R.
        // We want neighbor distance = tileWidth + spacing.
        // So R = tileWidth + spacing.

        const R = Math.max(tileWidth, tileHeight) + spacing;

        // Cluster Size approx diameter
        // const clusterDiameter = 2 * R + Math.max(tileWidth, tileHeight);

        // Spacing between Clusters
        // For "Interlocked", we want them tighter.
        // Hex grid stride:
        // X-stride = 3 * R approx? No, standard hex grid spacing.
        // If we want clusters to "nest", we treat the cluster as a large hex unit.
        // Radius of cluster is R.
        // Distance between cluster centers should be roughly 3*R? or 2.5*R?
        // Let's stick to the previous spacing but maybe slightly tighter if "Interlocked" meant density.
        // Actually, user might mean the orientation (30 deg offset).

        const clusterSpacing = spacing * 2;
        const clusterStepX = (2 * R) + Math.max(tileWidth, tileHeight) + clusterSpacing;
        const clusterStepY = clusterStepX * 0.866;

        const boundsCenter = new THREE.Vector2();
        bounds.getCenter(boundsCenter);

        const spanW = bounds.max.x - bounds.min.x;
        const spanH = bounds.max.y - bounds.min.y;

        const cols = Math.ceil(spanW / clusterStepX) + 1;
        const rows = Math.ceil(spanH / clusterStepY) + 1;

        const gridW = cols * clusterStepX;
        const gridH = rows * clusterStepY;

        const startX = boundsCenter.x - gridW / 2 + clusterStepX / 2;
        const startY = boundsCenter.y - gridH / 2 + clusterStepY / 2;

        for (let r = 0; r <= rows; r++) {
            for (let c = 0; c <= cols; c++) {
                let cx = startX + c * clusterStepX;
                const cy = startY + r * clusterStepY;

                // Stagger rows for hexagonal cluster packing
                if (r % 2 !== 0) {
                    cx += clusterStepX / 2;
                }

                // Generate 6 items for this cluster
                for (let i = 0; i < 6; i++) {
                    const angle = (i * 60) * (Math.PI / 180) + (Math.PI / 6);
                    // Add 30 deg offset to make it "pointy top" or 0 for "flat top"?
                    // Usually 30 deg looks like a proper honeycomb cell orientation if the cluster is staggered?
                    // Let's stick to 0 for standard ring.

                    const px = cx + R * Math.cos(angle);
                    const py = cy + R * Math.sin(angle);

                    if (checkPosition(px, py)) {
                        let rot = 0;
                        if (orientation === 'aligned') {
                            // Tangential to CLUSTER center
                            rot = Math.atan2(py - cy, px - cx) + Math.PI / 2;
                        } else {
                            rot = getRotation(c, r, px, py);
                        }

                        positions.push({
                            position: new THREE.Vector2(px, py),
                            rotation: rot,
                            scale: 1
                        });
                    }
                }
            }
        }

    } else {
        // --- Grid / Offset Logic ---

        // Center Grid
        const boundsCenter = new THREE.Vector2();
        bounds.getCenter(boundsCenter);

        // Adjust row height for Hex (Legacy Hex was here)
        // Now just Grid/Offset
        const effectiveFullHeight = fullHeight;

        // Cover area
        const spanW = bounds.max.x - bounds.min.x;
        const spanH = bounds.max.y - bounds.min.y;

        const cols = Math.ceil(spanW / fullWidth) + 1;
        const rows = Math.ceil(spanH / effectiveFullHeight) + 1;

        const grossGridWidth = cols * fullWidth;
        const grossGridHeight = rows * effectiveFullHeight;

        const gridOriginX = boundsCenter.x - (grossGridWidth / 2) + (fullWidth / 2);
        const gridOriginY = boundsCenter.y - (grossGridHeight / 2) + (effectiveFullHeight / 2);

        // Random factors removed for revert

        for (let r = 0; r <= rows; r++) {
            for (let c = 0; c <= cols; c++) {
                // Offset Logic
                let cx = gridOriginX + c * fullWidth;
                let cy = gridOriginY + r * effectiveFullHeight;

                if (distribution === 'offset') {
                    if (r % 2 !== 0) cx += fullWidth / 2;
                }
                else if (distribution === 'wave') {
                    // Replaced wave-v / wave-h logic
                    const freq = 0.6;
                    if (direction === 'vertical') {
                        const amp = fullWidth * 0.35;
                        cx += Math.sin(r * freq) * amp;
                    } else {
                        const amp = fullHeight * 0.35;
                        cy += Math.sin(c * freq) * amp;
                    }
                }
                // OLD LOGIC PRESERVED FOR REFERENCE IF NEEDED
                /*
                else if (distribution === 'wave-v') {
                    const amp = fullWidth * 0.35;
                    const freq = 0.6;
                    cx += Math.sin(r * freq) * amp;
                }
                else if (distribution === 'wave-h') {
                    const amp = fullHeight * 0.35;
                    const freq = 0.6;
                    cy += Math.sin(c * freq) * amp;
                }
                */
                else if (distribution === 'zigzag') { // Combined zigzag-v/h
                    const period = 8;

                    if (direction === 'vertical') {
                        // zigzag-v logic
                        const scalar = r % period;
                        const tri = (scalar < period / 2) ? scalar : period - scalar;
                        const norm = tri - period / 4;
                        cx += norm * (fullWidth * 0.3);
                    } else {
                        // zigzag-h logic
                        const scalar = c % period;
                        const tri = (scalar < period / 2) ? scalar : period - scalar;
                        const norm = tri - period / 4;
                        cy += norm * (fullHeight * 0.3);
                    }
                }
                /*
                else if (distribution === 'zigzag-v') {
                    // Zigzag columns
                    // Create a linear back-and-forth offset based on row index
                    const period = 8;
                    const scalar = r % period; // 0..7
                    // 0,1,2,3,4,3,2,1
                    const tri = (scalar < period / 2) ? scalar : period - scalar;
                    // Center it: -2..2
                    const norm = tri - period / 4;
                    cx += norm * (fullWidth * 0.3);
                }
                else if (distribution === 'zigzag-h') {
                    const period = 8;
                    const scalar = c % period;
                    const tri = (scalar < period / 2) ? scalar : period - scalar;
                    const norm = tri - period / 4;
                    cy += norm * (fullHeight * 0.3);
                }
                */
                else if (distribution === 'warped-grid') {
                    // Dual wave distortion
                    // Distort X based on Y, and Y based on X.
                    // This creates a warped grid effect.

                    // Normalize coords for frequency consistency regardless of size
                    const nx = c * 0.5;
                    const ny = r * 0.5;

                    // Apply Sine Wave offsets
                    const xOff = Math.sin(ny) * (fullWidth * 0.4);
                    const yOff = Math.cos(nx) * (fullHeight * 0.4);

                    cx += xOff;
                    cy += yOff;
                }

                if (checkPosition(cx, cy)) {
                    positions.push({
                        position: new THREE.Vector2(cx, cy),
                        rotation: getRotation(c, r, cx, cy),
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
    distribution: 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave' | 'zigzag' | 'warped-grid' = 'grid',
    orientation: 'none' | 'alternate' | 'random' | 'aligned' = 'none',
    direction: 'horizontal' | 'vertical' = 'horizontal',
    exclusionShapes: THREE.Shape[] | null = null,
    inclusionShapes: THREE.Shape[] | null = null
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
        orientation,
        direction,
        exclusionShapes,
        inclusionShapes
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

/**
 * Centers a set of shapes around (0,0).
 * Optionally flips the Y axis (useful for SVG import).
 */
export const centerShapes = (shapes: THREE.Shape[], flipY: boolean = false): THREE.Shape[] => {
    if (shapes.length === 0) return shapes;

    const min = new THREE.Vector2(Infinity, Infinity);
    const max = new THREE.Vector2(-Infinity, -Infinity);

    shapes.forEach(shape => {
        shape.getPoints().forEach(p => {
            min.min(p);
            max.max(p);
        });
    });

    const center = new THREE.Vector2().addVectors(min, max).multiplyScalar(0.5);

    // If already centered (close enough) and no flip, return
    if (center.lengthSq() < 0.001 && !flipY) return shapes;

    return shapes.map(shape => {
        const newShape = new THREE.Shape();

        // Move Shape Points
        const pts = shape.getPoints();

        // Enforce CCW for outer shape
        if (THREE.ShapeUtils.area(pts) < 0) {
            pts.reverse();
        }

        pts.forEach((p, i) => {
            const tx = p.x - center.x;
            const ty = flipY ? -(p.y - center.y) : (p.y - center.y);
            if (i === 0) newShape.moveTo(tx, ty);
            else newShape.lineTo(tx, ty);
        });

        // Move Holes
        if (shape.holes && shape.holes.length > 0) {
            shape.holes.forEach(hole => {
                const newHole = new THREE.Path();
                const hPts = hole.getPoints();
                hPts.forEach((p, i) => {
                    const tx = p.x - center.x;
                    const ty = flipY ? -(p.y - center.y) : (p.y - center.y);
                    if (i === 0) newHole.moveTo(tx, ty);
                    else newHole.lineTo(tx, ty);
                });
                newShape.holes.push(newHole);
            });
        }

        return newShape;
    });
};


/**
 * Calculates the optimal scale for an inlay pattern to fit within the base outline or default size.
 * Targeting ~80% coverage.
 */
export const calculateInlayScale = (
    inlayShapes: any[],
    cutoutShapes: THREE.Shape[] | null,
    defaultSize: number,
    coverage: number = 0.8
): number => {
    // Extract shapes if they are objects (which they are for inlayShapes often: {shape, color})
    const shapes = inlayShapes.map((s: any) => s.shape || s);
    const bounds = getShapesBounds(shapes);
    const width = bounds.size.x;
    const height = bounds.size.y;

    if (width > 0 && height > 0) {
        if (cutoutShapes && cutoutShapes.length > 0) {
            // Fit within Outline Bounds
            const outlineBounds = getShapesBounds(cutoutShapes);
            const outlineW = outlineBounds.size.x;
            const outlineH = outlineBounds.size.y;

            const scaleX = (outlineW * coverage) / width;
            const scaleY = (outlineH * coverage) / height;
            const scale = Math.min(scaleX, scaleY);
            return Math.round(scale * 100) / 100;
        } else {
            // Fit within Default Square Size
            const maxSize = Math.max(width, height);
            const scale = (defaultSize * coverage) / maxSize;
            return Math.round(scale * 100) / 100;
        }
    }
    return 1;
};


