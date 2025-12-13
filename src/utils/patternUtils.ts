import * as THREE from 'three';

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

/**
 * Tiles the given shapes across a rectangular area centered at 0,0.
 * @param shapes Source shapes (assumed centered).
 * @param bounds The dimensions to fill (e.g. 300x300).
 * @param scale Scaling factor for the motif.
 * @param spacing Spacing between motifs (mm). (e.g. 5mm gap).
 * @param gridType 'rect' (simple grid) or 'hex' (staggered)? Simplified to 'rect' for now.
 */
export const tileShapes = (
    shapes: THREE.Shape[],
    areaSize: number, // Using square area for now (size x size)
    scale: number,
    spacing: number = 0
): THREE.Shape[] => {
    if (!shapes || shapes.length === 0) return [];

    // 1. Analyze Source
    const sourceBounds = getShapesBounds(shapes);
    // Effective dimensions of the motif
    const motifWidth = sourceBounds.size.x * scale;
    const motifHeight = sourceBounds.size.y * scale;

    // Safety check
    if (motifWidth < 0.1 || motifHeight < 0.1) return shapes; // Too small to tile

    // 2. Determine Grid
    // We want to cover 'areaSize' x 'areaSize'.
    // Cell size = motif + spacing.
    const cellW = motifWidth + spacing;
    const cellH = motifHeight + spacing;

    // How many cells fit? 
    // We want to cover slightly more than the area to ensure clipping cuts it clean?
    // Or just cover the area based on center?
    const cols = Math.ceil(areaSize / cellW);
    const rows = Math.ceil(areaSize / cellH);

    // 3. Generate Tiles
    const tiledShapes: THREE.Shape[] = [];

    // Start position (Top-Left relative to center)
    // Grid center should be 0,0.

    // Start X = -gridW / 2 + cellW / 2 (center of first cell)
    // Actually simpler: 
    // for x = 0 to cols-1: xPos = (x - (cols-1)/2) * cellW

    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            const offsetX = (c - (cols - 1) / 2) * cellW;
            const offsetY = (r - (rows - 1) / 2) * cellH;

            // Clone and Transform
            shapes.forEach(srcShape => {
                // We need to clone the shape and apply Scale + Translate.
                // THREE.Shape doesn't have clone() that copies points deeply enough for mutation?
                // Actually shape.clone() exists.
                // BUT we need to Scale point coordinates. 
                // THREE.Shape has no .scale() method essentially.
                // We must rebuild.

                // Optimized approach: Extract points, transform, create new Shape.
                // This is heavy if done naively. 
                // But efficient enough for <1000 tiles.

                const tiledShape = new THREE.Shape();
                // We assume source shapes are simple (no holes? DXF parser supports holes).

                // Helper to transform a point
                const tx = (p: THREE.Vector2) => {
                    // Logic: Start Point (relative to source Center) * Scale + Offset
                    // sourceBounds.center is the origin of the shape coordinates?
                    // Ideally we assume shapes are pre-centered.
                    // If not, we subtract center first.
                    const x = (p.x - sourceBounds.center.x) * scale + offsetX;
                    const y = (p.y - sourceBounds.center.y) * scale + offsetY;
                    return { x, y };
                };

                // Migrate curves? 
                // Shape.extractPoints() gives us discretized points.
                // This loses curve fidelity (arcs become lines).
                // DXF/SVG often has curves.
                // If we want to keep curves, we must map the `curves` array.
                // This is hard.

                // Compromise: Use `shape.extractPoints(divisions)`?
                // Or: assume Shape is a Path.
                // We can iterate `.curves`?
                // Three.js Shape.curves contains LineCurve3, EllipseCurve, etc.
                // We can clone the curves and modify their params.
                // e.g. EllipseCurve.aX *= scale. .aX += offset.

                // Let's try deep cloning the shape logic properly.
                // Actually, just extractPoints is safest and easiest, but converts curves to polys.
                // For "Grip" (knurling), usually polygons anyway.
                // For SVG logos, might be curvy.
                // `shape.getPoints()` uses default division.
                // Let's stick to `extractPoints` or `getPoints` for now.

                const points = srcShape.getPoints(); // returns Vector2[]

                // Enforce CCW for consistent bevel behavior
                if (THREE.ShapeUtils.area(points) < 0) {
                    points.reverse();
                }

                const pointsTransformed = points.map(p => {
                    const t = tx(p);
                    return new THREE.Vector2(t.x, t.y);
                });

                tiledShape.setFromPoints(pointsTransformed);

                // Holes
                if (srcShape.holes && srcShape.holes.length > 0) {
                    srcShape.holes.forEach(holePath => {
                        const holePoints = holePath.getPoints();
                        const holeTransformed = holePoints.map(p => {
                            const t = tx(p);
                            return new THREE.Vector2(t.x, t.y);
                        });
                        const newHole = new THREE.Path(holeTransformed);
                        tiledShape.holes.push(newHole);
                    });
                }

                tiledShapes.push(tiledShape);
            });
        }
    }

    return tiledShapes;
};

/**
 * Checks if a point is inside a shape (polygon).
 * Uses raycasting algorithm (even-odd rule).
 */
export const isPointInShape = (point: THREE.Vector2 | { x: number, y: number }, shape: THREE.Shape): boolean => {
    const points = shape.getPoints();
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x, yi = points[i].y;
        const xj = points[j].x, yj = points[j].y;

        const intersect = ((yi > point.y) !== (yj > point.y))
            && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

export interface TileInstance {
    position: THREE.Vector2;
    rotation: number;
    scale: number;
}

/**
 * Generates positions for tiling, filtered by a boundary shape.
 */
export const generateTilePositions = (
    motifBounds: { size: THREE.Vector2, center: THREE.Vector2 },
    areaSize: number,
    scale: number,
    tileSpacing: number,
    boundaryShapes?: THREE.Shape[] | null
): TileInstance[] => {
    const motifWidth = motifBounds.size.x * scale;
    const motifHeight = motifBounds.size.y * scale;

    if (motifWidth < 0.1 || motifHeight < 0.1) return [];

    const cellW = motifWidth + tileSpacing;
    const cellH = motifHeight + tileSpacing;

    // Cover a slightly larger area to ensure edges are filled
    const cols = Math.ceil(areaSize / cellW) + 2;
    const rows = Math.ceil(areaSize / cellH) + 2;

    const instances: TileInstance[] = [];

    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            const offsetX = (c - (cols - 1) / 2) * cellW;
            const offsetY = (r - (rows - 1) / 2) * cellH;

            const px = offsetX;
            const py = offsetY;

            // Filter if boundary provided - DISABLED for debugging/stability
            /* 
            if (boundaryShapes && boundaryShapes.length > 0) {
                // Check if center is in ANY boundary shape
                // We use the center of the tile (px, py)
                // Note: boundaryShapes are centered at (0,0) in ModelViewer logic usually?
                // Yes, ModelViewer centers ExtrudeGeometry.

                let isInside = false;
                for (const boundary of boundaryShapes) {
                    if (isPointInShape({ x: px, y: py }, boundary)) {
                        isInside = true;
                        break;
                    }
                }

                if (!isInside) continue;
            }
            */

            instances.push({
                position: new THREE.Vector2(px, py),
                rotation: 0,
                scale: scale
            });
        }
    }
    return instances;
};
