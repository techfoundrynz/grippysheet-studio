import * as THREE from 'three';
import ClipperLib from 'clipper-lib';

// Scaling factor for Clipper (Int coordinates)
const SCALE = 1000;

export const offsetShape = (shape: THREE.Shape, offset: number): THREE.Shape[] => {
    if (offset === 0) return [shape];

    // 1. Convert ThreeJS Shape to Clipper Paths
    const subj = new ClipperLib.Paths();

    // Outer Path
    const outerPath = new ClipperLib.Path();
    shape.getPoints().forEach(p => {
        outerPath.push({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) });
    });
    // Ensure Winding Order? 
    // Clipper usually expects a certain winding for outer vs holes, or uses orientation.
    // ThreeJS Outer is CCW. Clipper usually works fine if we just pass them.
    // But strictly: Outer should be one orientation, Holes the other?
    // Let's rely on ClipperOffset to handle it or simplify.

    subj.push(outerPath);

    // Holes
    if (shape.holes && shape.holes.length > 0) {
        shape.holes.forEach(hole => {
            const holePath = new ClipperLib.Path();
            hole.getPoints().forEach(p => {
                holePath.push({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) });
            });
            subj.push(holePath);
        });
    }

    // 2. Perform Offset
    const co = new ClipperLib.ClipperOffset();
    const resultPaths = new ClipperLib.Paths();

    // JoinType: jtSquare (0), jtRound (1), jtMiter (2)
    // EndType: etClosedPolygon (0), etClosedLine (1), etOpenSquare (2), etOpenRound (3), etOpenButt (4)
    // We want etClosedPolygon and probably jtRound or jtMiter.
    // Miter can produce huge spikes. Round is safer for organic shapes. Square is fast.
    // User requested "radius" corners usually implying round, but previous code was sharp.
    // Let's go with jtMiter (2) with a limit, or jtSquare if performance is key. 
    // Just default to Miter for clean corners on boxes, Round for organic.
    // Let's use jtMiter with MiterLimit 2.

    co.AddPaths(subj, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);

    // Apply Offset
    co.Execute(resultPaths, offset * SCALE);

    // 3. Convert back to ThreeJS Shapes
    // Result might be multiple keys (disjoint shapes)
    if (!resultPaths || resultPaths.length === 0) return [];

    // Clean Polygons? Simplify?
    // ClipperLib.Clipper.CleanPolygons(resultPaths, 0.1 * SCALE);

    // We need to determine which paths are outer and which are holes.
    // Clipper returns them all flat.
    // Orientation determines which is valid.
    // Use Clipper to organize them into a PolyTree if needed, 
    // OR just use area logic (ThreeJS ShapeUtils.area).
    // Positive Area = Outer, Negative Area = Hole (if Clipper follows typical convention, but usually Clipper returns all POSITIVE for orientation?)
    // Actually ClipperOffset returns properly oriented paths usually.
    // Let's assume standard behavior:
    // If we get multiple paths, we need to sort them out.
    // A robust way is to put them all into a THREE.Shape, and trust PathToShape converters that handle holes relative to parent.
    // But THREE.Shape expects 1 outer path and N holes.
    // If result is disjoint (2 islands), we need 2 THREE.Shapes.

    // Better way: Use transformations to find hierarchy.
    // For now, let's just turn every POSITIVE area path into a Shape, 
    // and every NEGATIVE area path into a Hole of the closest Container?
    // Or just check containment.

    // SIMPLIFICATION:
    // Convert all to Shapes.
    // Use ShapeUtils.isClockWise to detect holes? 
    // ThreeJS: CCW is Outer. CW is Hole.

    const convertedShapes: THREE.Shape[] = [];
    const derivedHoles: THREE.Path[] = []; // Potential holes
    const derivedOuters: THREE.Shape[] = []; // Potential outers

    resultPaths.forEach(path => {
        const points = path.map(pt => new THREE.Vector2(pt.X / SCALE, pt.Y / SCALE));
        if (points.length < 3) return; // Degenerate

        // Check Winding
        const area = THREE.ShapeUtils.area(points);
        // ThreeJS area: CCW is positive (if Y is up? No, ThreeJS 2D area calc: 
        // "Method returns signed area. Positive for counter-clockwise."
        // So if area > 0 -> CCW -> Outer.
        // If area < 0 -> CW -> Hole.

        if (area > 0) {
            const s = new THREE.Shape(points);
            derivedOuters.push(s);
        } else {
            // Hole
            // Ensure points are correct order? Path expects points.
            const p = new THREE.Path(points);
            derivedHoles.push(p);
        }
    });

    // Assign holes to correct outers
    // Brute force: check if hole inside outer.
    // If multiple outers, this is N*M. Usually small N.

    derivedOuters.forEach(outer => {
        // Find holes inside this outer
        const myHoles = derivedHoles.filter(h => {
            // Check one point of hole
            const pt = h.getPoints()[0];
            // isPointInShape?
            // Need a utility for that if we want robust check.
            // Or simplified bounding box check + raycast.
            // Let's just assume typically 1 outer.
            return isPointInPoly(pt, outer.getPoints());
        });

        outer.holes = myHoles;
        convertedShapes.push(outer);
    });

    // Handle orphan holes? (Shouldn't happen in offset of valid shape usually, unless inverted?)
    // If offset is negative (shrinking), hole might become outer? No.
    // If shrinking an outer, it remains outer (just smaller) or disappears.
    // If shrinking a hole (expanding margin), it remains hole.

    return convertedShapes;
};

// Helper for Point in Polygon (Ray Casting)
function isPointInPoly(p: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > p.y) !== (yj > p.y)) &&
            (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}
