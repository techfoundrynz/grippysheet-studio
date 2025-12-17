import DxfParser from 'dxf-parser';
import * as THREE from 'three';

const EPSILON = 0.001; // Tolerance for connecting points

interface PathSegment {
    start: THREE.Vector2;
    end: THREE.Vector2;
    createPathAction: (path: THREE.Path, offset: THREE.Vector2) => void;
    createReversePathAction: (path: THREE.Path, offset: THREE.Vector2) => void;
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
                    createReversePathAction: (path, offset) => path.lineTo(line.vertices[0].x - offset.x, -line.vertices[0].y - offset.y),
                    type: 'LINE'
                });
            }
        } else if (entity.type === 'ARC') {
            const arc = entity as any;
            const cx = arc.center.x;
            const cy = -arc.center.y; // Flip center Y
            const r = arc.radius;
            // Angles: 
            // In DXF, angles are CCW from X-axis. 
            // We flip Y, which mirrors the coordinate system.
            // A CCW arc (0 to 90) in +Y becomes a CW arc (0 to -90) visually if simply projected?
            // Or rather: Angle theta in +Y is (cos, sin). In -Y it is (cos, -sin) = (cos, sin(-theta)).
            // So angle becomes -theta.
            const startAngle = -arc.startAngle;
            const endAngle = -arc.endAngle;

            const startX = cx + r * Math.cos(startAngle);
            const startY = cy + r * Math.sin(startAngle);
            const endX = cx + r * Math.cos(endAngle);
            const endY = cy + r * Math.sin(endAngle);

            segments.push({
                start: new THREE.Vector2(startX, startY),
                end: new THREE.Vector2(endX, endY),
                // Forward: startAngle -> endAngle. Since we flipped Y and negated angles, the winding direction in the new coord system...
                // absarc(..., clockwise).
                // If original was CCW (increasing angle), new is decreasing angle (-start > -end)? No.
                // 0 -> 90. New: 0 -> -90. Decreasing. So Clockwise is TRUE?
                // Let's rely on standard ThreeJS behavior: absarc goes from aStart to aEnd.
                // Boolean 'clockwise': default false (CCW).
                // If we want 0 -> -90. That is CW. So set true.
                createPathAction: (path, offset) => path.absarc(cx - offset.x, cy - offset.y, r, startAngle, endAngle, true),
                // Reverse: endAngle -> startAngle. -90 -> 0. Increasing. CCW. So set false.
                createReversePathAction: (path, offset) => path.absarc(cx - offset.x, cy - offset.y, r, endAngle, startAngle, false),
                type: 'ARC'
            });
        } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
            const poly = entity as any;
            if (poly.vertices && poly.vertices.length > 1) {
                // Break polyline into individual segments to allow for partial stitching if needed, 
                // OR treat as pre-stitched blocks. 
                // Treat as individual segments is safer for mixed garbage input.
                for (let i = 0; i < poly.vertices.length - 1; i++) {
                    segments.push({
                        start: new THREE.Vector2(poly.vertices[i].x, -poly.vertices[i].y),
                        end: new THREE.Vector2(poly.vertices[i + 1].x, -poly.vertices[i + 1].y),
                        createPathAction: (path, offset) => path.lineTo(poly.vertices[i + 1].x - offset.x, -poly.vertices[i + 1].y - offset.y),
                        createReversePathAction: (path, offset) => path.lineTo(poly.vertices[i].x - offset.x, -poly.vertices[i].y - offset.y),
                        type: 'POLYSEGMENT'
                    });
                }
                if (poly.shape || poly.closed) {
                    const last = poly.vertices.length - 1;
                    segments.push({
                        start: new THREE.Vector2(poly.vertices[last].x, -poly.vertices[last].y),
                        end: new THREE.Vector2(poly.vertices[0].x, -poly.vertices[0].y),
                        createPathAction: (path, offset) => path.lineTo(poly.vertices[0].x - offset.x, -poly.vertices[0].y - offset.y),
                        createReversePathAction: (path, offset) => path.lineTo(poly.vertices[last].x - offset.x, -poly.vertices[last].y - offset.y),
                        type: 'POLYSEGMENT'
                    });
                }
            }
        } else if (entity.type === 'SPLINE') {
            const spline = entity as any;
            const controlPoints = spline.controlPoints;
            const knots = spline.knotValues;
            const degree = spline.degreeOfSplineCurve || 3;

            if (controlPoints && controlPoints.length > degree && knots && knots.length > 0) {
                // Interpolate BSpline
                const resolution = 20; // Points per knot span. 
                // Adjust based on needs. 4 spans * 20 = 80 points.
                const interpolatedPoints = interpolateBSpline(controlPoints, degree, knots, resolution);

                if (interpolatedPoints.length > 1) {
                    segments.push({
                        start: interpolatedPoints[0],
                        end: interpolatedPoints[interpolatedPoints.length - 1],
                        createPathAction: (path, offset) => {
                            for (let k = 1; k < interpolatedPoints.length; k++) {
                                path.lineTo(interpolatedPoints[k].x - offset.x, interpolatedPoints[k].y - offset.y);
                            }
                        },
                        createReversePathAction: (path, offset) => {
                            for (let k = interpolatedPoints.length - 2; k >= 0; k--) {
                                path.lineTo(interpolatedPoints[k].x - offset.x, interpolatedPoints[k].y - offset.y);
                            }
                        },
                        type: 'SPLINE_INTERPOLATED'
                    });
                }
            } else if (controlPoints && controlPoints.length > 1) {
                // Fallback to linear if data missing
                for (let i = 0; i < controlPoints.length - 1; i++) {
                    segments.push({
                        start: new THREE.Vector2(controlPoints[i].x, -controlPoints[i].y),
                        end: new THREE.Vector2(controlPoints[i + 1].x, -controlPoints[i + 1].y),
                        createPathAction: (path, offset) => path.lineTo(controlPoints[i + 1].x - offset.x, -controlPoints[i + 1].y - offset.y),
                        createReversePathAction: (path, offset) => path.lineTo(controlPoints[i].x - offset.x, -controlPoints[i].y - offset.y),
                        type: 'SPLINE_LINEAR_FALLBACK'
                    });
                }
            }
        } else if (entity.type === 'CIRCLE') {
            const circle = entity as any;
            const cx = circle.center.x;
            const cy = -circle.center.y;
            const r = circle.radius;
            // Circle is a closed loop. Start/End are same.
            // Start at 0 radians.
            const startEnd = new THREE.Vector2(cx + r, cy);

            segments.push({
                start: startEnd,
                end: startEnd,
                createPathAction: (path, offset) => path.absarc(cx - offset.x, cy - offset.y, r, 0, 2 * Math.PI, true),
                createReversePathAction: (path, offset) => path.absarc(cx - offset.x, cy - offset.y, r, 2 * Math.PI, 0, false),
                type: 'CIRCLE'
            });
        } else if (entity.type === 'ELLIPSE') {
            const ellipse = entity as any;
            const cx = ellipse.center.x;
            const cy = -ellipse.center.y;

            // Major axis vector
            const mx = ellipse.majorAxisEndPoint.x;
            const my = -ellipse.majorAxisEndPoint.y; // Flip Y

            const majorRadius = Math.sqrt(mx * mx + my * my);
            const minorRadius = majorRadius * ellipse.axisRatio;

            const rotation = Math.atan2(my, mx);

            // Params are in radians? DXF spec says radians 0..2PI
            let startParam = ellipse.startAngle;
            let endParam = ellipse.endAngle;
            // If full ellipse, standard is 0 to 2PI
            if (Math.abs(endParam - startParam) < EPSILON) {
                endParam = startParam + 2 * Math.PI;
            }

            // Calculate start/end points for stitching
            // Ellipse parametric eq: 
            // x = cx + a*cos(t)*cos(rot) - b*sin(t)*sin(rot)
            // y = cy + a*cos(t)*sin(rot) + b*sin(t)*cos(rot)

            const getEllipsePoint = (t: number) => {
                const cosT = Math.cos(t);
                const sinT = Math.sin(t);
                const cosR = Math.cos(rotation);
                const sinR = Math.sin(rotation);
                return new THREE.Vector2(
                    cx + majorRadius * cosT * cosR - minorRadius * sinT * sinR,
                    cy + majorRadius * cosT * sinR + minorRadius * sinT * cosR
                );
            };

            const startPoint = getEllipsePoint(startParam);
            const endPoint = getEllipsePoint(endParam);

            segments.push({
                start: startPoint,
                end: endPoint,
                createPathAction: (path, offset) => path.absellipse(cx - offset.x, cy - offset.y, majorRadius, minorRadius, startParam, endParam, true, rotation),
                createReversePathAction: (path, offset) => path.absellipse(cx - offset.x, cy - offset.y, majorRadius, minorRadius, endParam, startParam, false, rotation),
                type: 'ELLIPSE'
            });
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

    const center = new THREE.Vector2((bMin.x + bMax.x) / 2, (bMin.y + bMax.y) / 2);
    console.log('Centering offset:', center);

    // 3. Stitch Segments (Bidirectional)
    const shapes: THREE.Shape[] = [];
    const used = new Set<number>();
    const isSamePoint = (v1: THREE.Vector2, v2: THREE.Vector2) => v1.distanceToSquared(v2) < EPSILON * EPSILON;

    for (let i = 0; i < segments.length; i++) {
        if (used.has(i)) continue;

        const shape = new THREE.Shape();
        const startSeg = segments[i];
        used.add(i);

        // Start path
        shape.moveTo(startSeg.start.x - center.x, startSeg.start.y - center.y);
        startSeg.createPathAction(shape, center);

        let currentEnd = startSeg.end;
        let loopClosed = false;
        let foundNext = true;

        // Safety break to prevent infinite loops in weird cases
        let iterations = 0;
        const maxIterations = segments.length * 2;
        let segmentCount = 1;

        while (foundNext && !loopClosed && iterations < maxIterations) {
            foundNext = false;
            iterations++;

            // Check if closed loop with self (simple case) or back to original start
            if (isSamePoint(currentEnd, startSeg.start)) {
                loopClosed = true;
                break;
            }

            for (let j = 0; j < segments.length; j++) {
                if (used.has(j)) continue;
                const nextSeg = segments[j];

                // Forward connection: current end matches next start
                if (isSamePoint(currentEnd, nextSeg.start)) {
                    used.add(j);
                    nextSeg.createPathAction(shape, center);
                    currentEnd = nextSeg.end;
                    foundNext = true;
                    segmentCount++;
                    break;
                }
                // Reverse connection: current end matches next end
                else if (isSamePoint(currentEnd, nextSeg.end)) {
                    used.add(j);
                    nextSeg.createReversePathAction(shape, center);
                    currentEnd = nextSeg.start; // New end is the start of the reversed segment
                    foundNext = true;
                    segmentCount++;
                    break;
                }
            }
        }

        console.log(`Loop ${shapes.length}: segments=${segmentCount}, closed=${loopClosed}`);
        if (loopClosed) {
            shape.closePath();
            shapes.push(shape);
        } else {
            // Automatically close the loop to ensure CSG solidity.
            shape.closePath();
            shapes.push(shape);
        }
    }

    console.log(`Stitched ${shapes.length} loops.`);

    // 4. Hole Detection using Raycasting / Parent-Child
    // Prepare shapes with computed properties for containment checks
    const shapeInfos = shapes.map((shape, index) => {
        const points = shape.getPoints();
        let area = THREE.ShapeUtils.area(points);
        if (area < 0) {
            points.reverse();
            area = Math.abs(area);
            const newShape = new THREE.Shape();
            newShape.moveTo(points[0].x, points[0].y);
            for (let k = 1; k < points.length; k++) newShape.lineTo(points[k].x, points[k].y);
            newShape.closePath();
            return { shape: newShape, area, points, isHole: false, id: index, parent: null as any };
        }
        return { shape, area, points, isHole: false, id: index, parent: null as any };
    });

    // Helper for point in polygon (Ray casting algorithm)
    const isPointInPolygon = (p: THREE.Vector2, points: THREE.Vector2[]) => {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;

            const intersect = ((yi > p.y) !== (yj > p.y))
                && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    };

    // Sort by area descending. Largest shapes can contain smaller ones.
    shapeInfos.sort((a, b) => b.area - a.area);

    // Filter out degenerate shapes (lines or noise)
    const validShapes = shapeInfos.filter(s => s.area > EPSILON);

    const finalShapes: THREE.Shape[] = [];

    // O(N^2) but N is usually small for DXF imports
    for (let i = 0; i < validShapes.length; i++) {
        const current = validShapes[i];
        let parent = null;

        // Scan for the smallest parent that contains this shape
        for (let j = i - 1; j >= 0; j--) {
            const potentialParent = validShapes[j];
            // Check containment. Test multiple points for robustness.
            const indicesToTest = [0, Math.floor(current.points.length / 2), current.points.length - 1];
            let insideCount = 0;

            for (const idx of indicesToTest) {
                if (isPointInPolygon(current.points[idx], potentialParent.points)) {
                    insideCount++;
                }
            }

            if (insideCount > 0) {
                parent = potentialParent;
                break;
            }
        }

        if (parent) {
            if (!parent.isHole) {
                current.isHole = true;
                parent.shape.holes.push(current.shape);
            } else {
                // Parent is a hole -> current is a solid island inside a hole.
                finalShapes.push(current.shape);
            }
        } else {
            // No parent, it's a root solid
            current.isHole = false;
            finalShapes.push(current.shape);
        }
    }

    return finalShapes;
};

function interpolateBSpline(controlPoints: any[], degree: number, knots: number[], segmentResolution = 20) {
    const points: THREE.Vector2[] = [];

    // Domain [u_p, u_m-p]
    // Standard knots length = n + p + 1. 
    // n = controlPoints.length.

    // Check knot bounds.
    // If knots are standard clamped, p first knots are 0, p last are 1 (or max).
    // Domain is knots[degree] to knots[knots.length - 1 - degree].

    const low = knots[degree];
    const high = knots[knots.length - 1 - degree];

    // Safety check
    if (high <= low) return points;


    // Or just strictly sample based on knots?
    // Let's sample uniformly across domain for now. 
    // If knot spans are uneven, uniform sampling might undersample some areas.
    // Better: sample per knot span.

    // Iterate through unique knot spans
    for (let i = degree; i < knots.length - 1 - degree; i++) {
        const u0 = knots[i];
        const u1 = knots[i + 1];
        if (u1 <= u0) continue; // Empty span (multiplicity)

        // Sample this span
        for (let j = 0; j < segmentResolution; j++) {
            const t = u0 + (u1 - u0) * (j / segmentResolution);
            points.push(evaluateBSpline(t, degree, controlPoints, knots));
        }
    }
    // Add exact end point
    points.push(evaluateBSpline(high, degree, controlPoints, knots));

    return points;
}



function evaluateBSpline(t: number, degree: number, points: any[], knots: number[]) {
    // Find knot span s such that knots[s] <= t < knots[s+1]
    let s = degree;
    while (s < knots.length - 1 - degree && knots[s + 1] <= t) {
        s++;
    }

    // Handle t == high endpoint for clamped splines
    if (t > knots[knots.length - 1 - degree] - 1e-9) {
        s = knots.length - degree - 2;
    }

    // De Boor's algorithm
    // We create a temporary array of points d[i]
    // d_i^0 = P_{s-p+i} for i=0..p

    const v: THREE.Vector2[] = [];
    for (let i = 0; i <= degree; i++) {
        // Handle index bounds just in case
        const idx = s - degree + i;
        if (idx >= 0 && idx < points.length) {
            v[i] = new THREE.Vector2(points[idx].x, -points[idx].y);
        } else {
            v[i] = new THREE.Vector2(0, 0);
        }
    }

    for (let r = 1; r <= degree; r++) {
        for (let j = degree; j >= r; j--) {
            const denom = knots[s + 1 + j - r] - knots[s - degree + j];
            let alpha = 0;
            if (denom !== 0) {
                alpha = (t - knots[s - degree + j]) / denom;
            }
            v[j].lerp(v[j - 1], 1 - alpha);
        }
    }

    return v[degree];
}

export const generateSVGPath = (shapes: THREE.Shape[]): string => {
    let pathData = "";
    shapes.forEach(shape => {
        const points = shape.getPoints();
        if (points.length > 0) {
            pathData += `M ${points[0].x} ${points[0].y} `;
            for (let i = 1; i < points.length; i++) {
                pathData += `L ${points[i].x} ${points[i].y} `;
            }
            // Add holes to path? SVG paths can have multiple Move commands for holes (nonzero rule usually handles it)
            if (shape.holes && shape.holes.length > 0) {
                shape.holes.forEach(hole => {
                    const holePoints = hole.getPoints();
                    if (holePoints.length > 0) {
                        pathData += `M ${holePoints[0].x} ${holePoints[0].y} `;
                        for (let k = 1; k < holePoints.length; k++) {
                            pathData += `L ${holePoints[k].x} ${holePoints[k].y} `;
                        }
                        pathData += "Z ";
                    }
                });
            }
            pathData += "Z ";
        }
    });
    return pathData;
};

