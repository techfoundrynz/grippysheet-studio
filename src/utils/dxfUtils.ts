import DxfParser from 'dxf-parser';
import * as THREE from 'three';

const EPSILON = 0.001; // Tolerance for connecting points

interface PathSegment {
    start: THREE.Vector2;
    end: THREE.Vector2;
    createPathAction: (path: THREE.Path, offset: THREE.Vector2) => void;
    type: string;
}

export const parseDxfToShapes = (dxfString: string): THREE.Shape[] => {
    console.log('Starting DXF parse...');
    const parser = new DxfParser();
    let dxf;
    try {
        dxf = parser.parseSync(dxfString);
        console.log('DXF parsed successfully');
    } catch (err) {
        console.error('Error parsing DXF:', err);
        return [];
    }

    if (!dxf || !dxf.entities || dxf.entities.length === 0) {
        console.warn('No entities found in DXF');
        return [];
    }

    // 1. Collect all potential segments from entities
    const segments: PathSegment[] = [];

    dxf.entities.forEach((entity) => {
        if (entity.type === 'LINE') {
            const line = entity as any;
            if (line.vertices && line.vertices.length >= 2) {
                segments.push({
                    start: new THREE.Vector2(line.vertices[0].x, -line.vertices[0].y),
                    end: new THREE.Vector2(line.vertices[1].x, -line.vertices[1].y),
                    createPathAction: (path, offset) => path.lineTo(line.vertices[1].x - offset.x, -line.vertices[1].y - offset.y),
                    type: 'LINE'
                });
            }
        } else if (entity.type === 'ARC') {
            const arc = entity as any;
            const cx = arc.center.x;
            const cy = -arc.center.y; // Flip center Y
            const r = arc.radius;
            // Angles need to be mirrored or just CCW/CW swap? 
            // Inverting Y means angles are mirrored across X axis.
            // Angle A becomes -A.
            let startAngle = -arc.startAngle;
            let endAngle = -arc.endAngle;

            const startX = cx + r * Math.cos(startAngle);
            const startY = cy + r * Math.sin(startAngle); // sin(-a) = -sin(a). Consistent with flipping cy and y.
            const endX = cx + r * Math.cos(endAngle);
            const endY = cy + r * Math.sin(endAngle);

            segments.push({
                start: new THREE.Vector2(startX, startY),
                end: new THREE.Vector2(endX, endY),
                createPathAction: (path, offset) => path.absarc(cx - offset.x, cy - offset.y, r, startAngle, endAngle, true), // Flip CCW boolean?
                // Standard arc is CCW. Flipped Y makes it CW?
                // If we flip Y, standard CCW (positive angle) becomes CW visually?
                // Visual consistency:
                // If I draw a circle CCW in +Y up.
                // In -Y down (flipped), traversing angles 0 -> 2PI is still "CCW" relative to the new axes?
                // Actually absarc takes boolean `clockwise`. default false (CCW).
                // Let's stick to default first. We fix winding later anyway.
                // But start/end angles MUST be negated.
                type: 'ARC'
            });
        } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
            const poly = entity as any;
            if (poly.vertices && poly.vertices.length > 1) {
                for (let i = 0; i < poly.vertices.length - 1; i++) {
                    segments.push({
                        start: new THREE.Vector2(poly.vertices[i].x, -poly.vertices[i].y),
                        end: new THREE.Vector2(poly.vertices[i + 1].x, -poly.vertices[i + 1].y),
                        createPathAction: (path, offset) => path.lineTo(poly.vertices[i + 1].x - offset.x, -poly.vertices[i + 1].y - offset.y),
                        type: 'POLYSEGMENT'
                    });
                }
                if (poly.shape || poly.closed) {
                    const last = poly.vertices.length - 1;
                    segments.push({
                        start: new THREE.Vector2(poly.vertices[last].x, -poly.vertices[last].y),
                        end: new THREE.Vector2(poly.vertices[0].x, -poly.vertices[0].y),
                        createPathAction: (path, offset) => path.lineTo(poly.vertices[0].x - offset.x, -poly.vertices[0].y - offset.y),
                        type: 'POLYSEGMENT'
                    });
                }
            }
        } else if (entity.type === 'SPLINE') {
            const spline = entity as any;
            if (spline.controlPoints && spline.controlPoints.length > 1) {
                for (let i = 0; i < spline.controlPoints.length - 1; i++) {
                    segments.push({
                        start: new THREE.Vector2(spline.controlPoints[i].x, -spline.controlPoints[i].y),
                        end: new THREE.Vector2(spline.controlPoints[i + 1].x, -spline.controlPoints[i + 1].y),
                        createPathAction: (path, offset) => path.lineTo(spline.controlPoints[i + 1].x - offset.x, -spline.controlPoints[i + 1].y - offset.y),
                        type: 'SPLINE_APPROX'
                    });
                }
            }
        }
    });

    console.log(`Extracted ${segments.length} segments.`);
    if (segments.length === 0) return [];

    // 2. Calculate Bounds to Center
    const bMin = new THREE.Vector2(Infinity, Infinity);
    const bMax = new THREE.Vector2(-Infinity, -Infinity);

    segments.forEach(s => {
        bMin.x = Math.min(bMin.x, s.start.x, s.end.x);
        bMin.y = Math.min(bMin.y, s.start.y, s.end.y);
        bMax.x = Math.max(bMax.x, s.start.x, s.end.x);
        bMax.y = Math.max(bMax.y, s.start.y, s.end.y);
    });

    // ... (rest is stitching logic)

    const center = new THREE.Vector2((bMin.x + bMax.x) / 2, (bMin.y + bMax.y) / 2);
    console.log('Centering offset:', center);

    // 3. Stitch Segments with Offset
    const shapes: THREE.Shape[] = [];
    const used = new Set<number>();

    const isSamePoint = (v1: THREE.Vector2, v2: THREE.Vector2) => v1.distanceToSquared(v2) < EPSILON * EPSILON;

    for (let i = 0; i < segments.length; i++) {
        if (used.has(i)) continue;

        const shape = new THREE.Shape();
        let currentSegment = segments[i];
        used.add(i);

        // Move to start point relative to center
        shape.moveTo(currentSegment.start.x - center.x, currentSegment.start.y - center.y);
        currentSegment.createPathAction(shape, center);

        let currentEnd = currentSegment.end;
        let loopClosed = false;
        let foundNext = true;

        while (foundNext && !loopClosed) {
            foundNext = false;

            if (isSamePoint(currentEnd, segments[i].start)) {
                loopClosed = true;
                break;
            }

            for (let j = 0; j < segments.length; j++) {
                if (used.has(j)) continue;
                const nextSeg = segments[j];

                if (isSamePoint(currentEnd, nextSeg.start)) {
                    used.add(j);
                    nextSeg.createPathAction(shape, center);
                    currentEnd = nextSeg.end;
                    foundNext = true;
                    break;
                } else if (isSamePoint(currentEnd, nextSeg.end)) {
                    // Reverse connection logic would go here if needed
                }
            }
        }

        if (loopClosed) {
            shape.closePath();
            shapes.push(shape);
        } else {
            // Automatically close the loop to ensure CSG solidity.
            shape.closePath();
            shapes.push(shape);
        }
    }

    console.log(`Stitched ${shapes.length} shapes.`);

    // 4. Enforce CCW winding (Solid)
    const correctedShapes = shapes.map(shape => {
        const points = shape.getPoints();
        const area = THREE.ShapeUtils.area(points);
        if (area < 0) { // Clockwise
            // Reverse points to make it CCW
            const newShape = new THREE.Shape();
            const reversed = points.reverse();
            newShape.moveTo(reversed[0].x, reversed[0].y);
            for (let k = 1; k < reversed.length; k++) {
                newShape.lineTo(reversed[k].x, reversed[k].y);
            }
            newShape.closePath();
            return newShape;
        }
        return shape;
    });

    return correctedShapes;
};

export const generateSVGPath = (shapes: THREE.Shape[]): string => {
    let pathData = "";
    shapes.forEach(shape => {
        const points = shape.getPoints();
        if (points.length > 0) {
            // Since shapes are now "correct" (Y-up for 3D), to display in SVG (Y-down) we must FLIP Y.
            // Previously we flipped Y because data was Y-up. Now data is...
            // Wait.
            // DXF is Y-up standard.
            // SVG is Y-down standard.
            // Browser SVG: Positive Y is down.
            // Three.js: Positive Y is up.
            // If user says "it is flipped", and we see upside down triangle.
            // Triangle defined as (0,0), (1,1), (-1,1). Pointing Up.
            // In ThreeJS (Y-up): Points Up.
            // User sees it Points Down?
            // "Flipped on Y axis".
            // If I import a DXF drawn in CAD (Y-up) with a triangle pointing up.
            // My code reads X, Y. Puts it in Three Scene.
            // If checking in ModelViewer, user sees it.
            // Maybe the `extrudeGeometry` or `rotations` in ModelViewer are doing something?
            // `rotation={[-Math.PI / 2, 0, 0]}` implies X-axis rotation -90deg.
            // Initial: Z is up. Y is back. X is right.
            // Rotate -90 on X:
            // New Y is Old Z (Up).
            // New Z is Old -Y (Forward).
            // So on the screen (XY plane relative to camera top view):
            // Camera Top View: `camera.position.set(0, 1000, 0); camera.lookAt(0, 0, 0);`
            // Looking down Y axis? No, Standard Top view looks down Y? Or Z?
            // Standard ThreeJS Y is Up. Top view looks down -Y?
            // `camera.position.set(0, 1000, 0)` is highly positive Y.
            // `lookAt(0,0,0)`. Direction is (0, -1, 0).
            // The mesh `rotation={[-Math.PI / 2, 0, 0]}`.
            // Local Z becomes World Y.
            // Local Y becomes World -Z.
            // Local X stays World X.
            // Shape defined on XY plane.
            // Extruded along Z.
            // After rotation:
            // Extrusion (Z) points Up (World Y).
            // Shape X points Right (World X).
            // Shape Y points Back (World -Z).
            // Viewer Top View sees X and Z?
            // If camera is at (0, 1000, 0), it sees X and Z plane.
            // Z increases "Down" the screen in standard 3D mapping?
            // Actually in Top View:
            // X is Horizontal.
            // Z is Vertical.
            // Positive Z usually "Towards" viewer in Front view. In Top view...
            // It depends on camera up vector. Default camera up is (0,1,0).
            // If cam is at (0,1000,0) looking at (0,0,0). Up vector is parallel to view direction... singularity.
            // OrbitControls handles this.
            // Use Front View. `camera.position.set(0, 0, 1000)`.
            // Sees X and Y.
            // Mesh is rotated -90 X.
            // Mesh Up (Extrusion) is Y.
            // Mesh "Y" is -Z.
            // So Front view sees X and ...?
            // Front view looks -Z.
            // Mesh Y axis points -Z.
            // So Shape Y aligns with View depth?
            // This is confusing.

            // Simpler: Use the User's report.
            // "Flipped on Y axis".
            // Means +Y and -Y are swapped.
            // My proposed fix: Negate Y in parsing.
            // s.start.y -> -s.start.y
            // This mirrors the shape vertically.

            // SVG Path Generation for Preview:
            // Preview is 2D SVG.
            // SVG coords: 0,0 top left. Y increases down.
            // ThreeJS Shape: 0,0 center. Y increases up.
            // To show ThreeJS Shape in SVG:
            // path y = - shape.y.
            // If shape.y is 10 (up). SVG y is -10 (up).
            // This maintains visual orientation (Up is Up).
            // So `pathData += ... ${-points[i].y}` is correct for preserving visual orientation.
            // I will keep this `-points[i].y` logic as it correctly maps "Up" to "Up".

            pathData += `M ${points[0].x} ${points[0].y} `; // Removed Flip Y
            for (let i = 1; i < points.length; i++) {
                pathData += `L ${points[i].x} ${points[i].y} `;
            }
            pathData += "Z ";
        }
    });
    return pathData;
};
