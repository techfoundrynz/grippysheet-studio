import DxfParser from 'dxf-parser';
import * as THREE from 'three';

const EPSILON = 0.15; // Tolerance for connecting points

interface PathSegment {
    start: THREE.Vector2;
    end: THREE.Vector2;
    createPathAction: (path: THREE.Path, offset: THREE.Vector2) => void;
    createReversePathAction: (path: THREE.Path, offset: THREE.Vector2) => void;
    type: string;
}

const getExtrusion = (entity: any): THREE.Vector3 => {
    if (entity.extrusionDirectionX !== undefined && entity.extrusionDirectionY !== undefined && entity.extrusionDirectionZ !== undefined) {
        return new THREE.Vector3(entity.extrusionDirectionX, entity.extrusionDirectionY, entity.extrusionDirectionZ);
    }
    if (entity.extrusionDirection) {
        return new THREE.Vector3(entity.extrusionDirection.x, entity.extrusionDirection.y, entity.extrusionDirection.z);
    }
    return new THREE.Vector3(0, 0, 1);
};

// DXF Arbitrary Axis Algorithm
const getOCSBasis = (N: THREE.Vector3) => {
    const threshold = 1.0 / 64.0;
    const Ax = new THREE.Vector3();
    const Ay = new THREE.Vector3();

    if (Math.abs(N.x) < threshold && Math.abs(N.y) < threshold) {
        Ax.crossVectors(new THREE.Vector3(0, 1, 0), N).normalize();
    } else {
        Ax.crossVectors(new THREE.Vector3(0, 0, 1), N).normalize();
    }
    Ay.crossVectors(N, Ax).normalize();
    return { Ax, Ay, Az: N };
};

const transformPointToWCS = (x: number, y: number, z: number, basis: { Ax: THREE.Vector3, Ay: THREE.Vector3, Az: THREE.Vector3 }): THREE.Vector3 => {
    // P_wcs = x * Ax + y * Ay + z * Az
    const p = new THREE.Vector3();
    p.addScaledVector(basis.Ax, x);
    p.addScaledVector(basis.Ay, y);
    p.addScaledVector(basis.Az, z);
    return p;
};

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

    // Determine Scale Factor (Target: Millimeters)
    let scaleFactor = 1.0;
    if (dxf.header && dxf.header['$INSUNITS'] !== undefined) {
        const units = dxf.header['$INSUNITS'];
        // DXF Unit Codes:
        // 1 = Inches
        // 2 = Feet
        // 4 = Millimeters
        // 5 = Centimeters
        // 6 = Meters
        switch (units) {
            case 1: scaleFactor = 25.4; break; // Inches to mm
            case 2: scaleFactor = 304.8; break; // Feet to mm
            case 4: scaleFactor = 1.0; break; // mm to mm
            case 5: scaleFactor = 10.0; break; // cm to mm
            case 6: scaleFactor = 1000.0; break; // m to mm
            default:
                console.log(`Unknown or unsupported DXF unit code: ${units}. Assuming 1:1.`);
                scaleFactor = 1.0;
        }
        console.log(`DXF Units: ${units}, Scale Factor to mm: ${scaleFactor}`);
    } else {
        console.log('No DXF units found ($INSUNITS). Assuming millimeters (1:1).');
    }

    // 1. Collect all potential segments from entities
    const segments: PathSegment[] = [];

    dxf.entities.forEach((entity) => {
        const extrusion = getExtrusion(entity);
        const basis = getOCSBasis(extrusion);

        if (entity.type === 'LINE') {
            const line = entity as any;
            if (line.vertices && line.vertices.length >= 2) {
                const startWCS = transformPointToWCS(line.vertices[0].x, line.vertices[0].y, line.vertices[0].z, basis);
                const endWCS = transformPointToWCS(line.vertices[1].x, line.vertices[1].y, line.vertices[1].z, basis);

                segments.push({
                    start: new THREE.Vector2(startWCS.x * scaleFactor, startWCS.y * scaleFactor),
                    end: new THREE.Vector2(endWCS.x * scaleFactor, endWCS.y * scaleFactor),
                    createPathAction: (path, offset) => path.lineTo(endWCS.x * scaleFactor - offset.x, endWCS.y * scaleFactor - offset.y),
                    createReversePathAction: (path, offset) => path.lineTo(startWCS.x * scaleFactor - offset.x, startWCS.y * scaleFactor - offset.y),
                    type: 'LINE'
                });
            }
        } else if (entity.type === 'ARC') {
            const arc = entity as any;
            const cx = arc.center.x;
            const cy = arc.center.y;
            const cz = arc.center.z || 0;
            const r = arc.radius;

            const centerWCS = transformPointToWCS(cx, cy, cz, basis);

            const startAngleOcs = arc.startAngle;
            const endAngleOcs = arc.endAngle;

            const startX_ocs = cx + r * Math.cos(startAngleOcs);
            const startY_ocs = cy + r * Math.sin(startAngleOcs);
            const startZ_ocs = cz;

            const endX_ocs = cx + r * Math.cos(endAngleOcs);
            const endY_ocs = cy + r * Math.sin(endAngleOcs);
            const endZ_ocs = cz;

            const startWCS = transformPointToWCS(startX_ocs, startY_ocs, startZ_ocs, basis);
            const endWCS = transformPointToWCS(endX_ocs, endY_ocs, endZ_ocs, basis);

            const startAngleWCS = Math.atan2(startWCS.y - centerWCS.y, startWCS.x - centerWCS.x);
            const endAngleWCS = Math.atan2(endWCS.y - centerWCS.y, endWCS.x - centerWCS.x);

            const isCounterClockwise = basis.Az.z > 0;

            segments.push({
                start: new THREE.Vector2(startWCS.x * scaleFactor, startWCS.y * scaleFactor),
                end: new THREE.Vector2(endWCS.x * scaleFactor, endWCS.y * scaleFactor),
                createPathAction: (path, offset) => path.absarc(
                    centerWCS.x * scaleFactor - offset.x,
                    centerWCS.y * scaleFactor - offset.y,
                    r * scaleFactor,
                    startAngleWCS,
                    endAngleWCS,
                    !isCounterClockwise
                ),
                createReversePathAction: (path, offset) => path.absarc(
                    centerWCS.x * scaleFactor - offset.x,
                    centerWCS.y * scaleFactor - offset.y,
                    r * scaleFactor,
                    endAngleWCS,
                    startAngleWCS,
                    isCounterClockwise
                ),
                type: 'ARC'
            });
        } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
            const poly = entity as any;
            if (poly.vertices && poly.vertices.length > 1) {
                const elevation = poly.elevation || 0;
                const convertedVertices = poly.vertices.map((v: any) => {
                    const wcs = transformPointToWCS(v.x, v.y, elevation, basis);
                    return new THREE.Vector2(wcs.x * scaleFactor, wcs.y * scaleFactor);
                });

                for (let i = 0; i < convertedVertices.length - 1; i++) {
                    segments.push({
                        start: convertedVertices[i],
                        end: convertedVertices[i + 1],
                        createPathAction: (path, offset) => path.lineTo(convertedVertices[i + 1].x - offset.x, convertedVertices[i + 1].y - offset.y),
                        createReversePathAction: (path, offset) => path.lineTo(convertedVertices[i].x - offset.x, convertedVertices[i].y - offset.y),
                        type: 'POLYSEGMENT'
                    });
                }
                if (poly.shape || poly.closed) {
                    const last = convertedVertices.length - 1;
                    segments.push({
                        start: convertedVertices[last],
                        end: convertedVertices[0],
                        createPathAction: (path, offset) => path.lineTo(convertedVertices[0].x - offset.x, convertedVertices[0].y - offset.y),
                        createReversePathAction: (path, offset) => path.lineTo(convertedVertices[last].x - offset.x, convertedVertices[last].y - offset.y),
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
                // Scale control points
                const scaledCP = controlPoints.map((p: any) => ({ x: p.x * scaleFactor, y: p.y * scaleFactor }));

                // Interpolate BSpline
                const resolution = 20; // Points per knot span. 
                // Adjust based on needs. 4 spans * 20 = 80 points.
                const interpolatedPoints = interpolateBSpline(scaledCP, degree, knots, resolution);

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
                        start: new THREE.Vector2(controlPoints[i].x * scaleFactor, controlPoints[i].y * scaleFactor),
                        end: new THREE.Vector2(controlPoints[i + 1].x * scaleFactor, controlPoints[i + 1].y * scaleFactor),
                        createPathAction: (path, offset) => path.lineTo(controlPoints[i + 1].x * scaleFactor - offset.x, controlPoints[i + 1].y * scaleFactor - offset.y),
                        createReversePathAction: (path, offset) => path.lineTo(controlPoints[i].x * scaleFactor - offset.x, controlPoints[i].y * scaleFactor - offset.y),
                        type: 'SPLINE_LINEAR_FALLBACK'
                    });
                }
            }
        } else if (entity.type === 'CIRCLE') {
            const circle = entity as any;
            const cx = circle.center.x;
            const cy = circle.center.y;
            const cz = circle.center.z || 0;
            const r = circle.radius;

            const centerWCS = transformPointToWCS(cx, cy, cz, basis);

            segments.push({
                start: new THREE.Vector2(centerWCS.x * scaleFactor + r * scaleFactor, centerWCS.y * scaleFactor),
                end: new THREE.Vector2(centerWCS.x * scaleFactor + r * scaleFactor, centerWCS.y * scaleFactor),
                createPathAction: (path, offset) => path.absarc(centerWCS.x * scaleFactor - offset.x, centerWCS.y * scaleFactor - offset.y, r * scaleFactor, 0, 2 * Math.PI, false),
                createReversePathAction: (path, offset) => path.absarc(centerWCS.x * scaleFactor - offset.x, centerWCS.y * scaleFactor - offset.y, r * scaleFactor, 2 * Math.PI, 0, true),
                type: 'CIRCLE'
            });
        } else if (entity.type === 'ELLIPSE') {
            const ellipse = entity as any;
            const cx = ellipse.center.x * scaleFactor;
            const cy = ellipse.center.y * scaleFactor;

            // Major axis vector
            const mx = ellipse.majorAxisEndPoint.x * scaleFactor;
            const my = ellipse.majorAxisEndPoint.y * scaleFactor;

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
                createPathAction: (path, offset) => path.absellipse(cx - offset.x, cy - offset.y, majorRadius, minorRadius, startParam, endParam, false, rotation),
                createReversePathAction: (path, offset) => path.absellipse(cx - offset.x, cy - offset.y, majorRadius, minorRadius, endParam, startParam, true, rotation),
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
            v[i] = new THREE.Vector2(points[idx].x, points[idx].y);
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
