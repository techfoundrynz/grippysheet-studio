import DxfParser from 'dxf-parser';
import * as THREE from 'three';

const EPSILON = 0.15; // General tolerance

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
    if (!dxf || !dxf.entities || dxf.entities.length === 0) return [];

    let scaleFactor = 1.0;
    if (dxf.header && dxf.header['$INSUNITS']) {
        const units = dxf.header['$INSUNITS'];
        switch (units) {
            case 1: scaleFactor = 25.4; break;
            case 2: scaleFactor = 304.8; break;
            case 4: scaleFactor = 1.0; break;
            case 5: scaleFactor = 10.0; break;
            case 6: scaleFactor = 1000.0; break;
            default: scaleFactor = 1.0;
        }
    }

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
            const centerWCS = transformPointToWCS(arc.center.x, arc.center.y, arc.center.z || 0, basis);
            const r = arc.radius;
            const startAngleOcs = arc.startAngle;
            const endAngleOcs = arc.endAngle;
            const startWCS = transformPointToWCS(arc.center.x + r * Math.cos(startAngleOcs), arc.center.y + r * Math.sin(startAngleOcs), arc.center.z || 0, basis);
            const endWCS = transformPointToWCS(arc.center.x + r * Math.cos(endAngleOcs), arc.center.y + r * Math.sin(endAngleOcs), arc.center.z || 0, basis);
            const startAngleWCS = Math.atan2(startWCS.y - centerWCS.y, startWCS.x - centerWCS.x);
            const endAngleWCS = Math.atan2(endWCS.y - centerWCS.y, endWCS.x - centerWCS.x);
            const isCCW = basis.Az.z > 0;
            segments.push({
                start: new THREE.Vector2(startWCS.x * scaleFactor, startWCS.y * scaleFactor),
                end: new THREE.Vector2(endWCS.x * scaleFactor, endWCS.y * scaleFactor),
                createPathAction: (path, offset) => path.absarc(centerWCS.x * scaleFactor - offset.x, centerWCS.y * scaleFactor - offset.y, r * scaleFactor, startAngleWCS, endAngleWCS, !isCCW),
                createReversePathAction: (path, offset) => path.absarc(centerWCS.x * scaleFactor - offset.x, centerWCS.y * scaleFactor - offset.y, r * scaleFactor, endAngleWCS, startAngleWCS, isCCW),
                type: 'ARC'
            });
        } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
            const poly = entity as any;
            if (poly.vertices && poly.vertices.length > 1) {
                const elevation = poly.elevation || 0;
                const getWCS = (v: any) => { const w = transformPointToWCS(v.x, v.y, elevation, basis); return new THREE.Vector2(w.x * scaleFactor, w.y * scaleFactor); };
                for (let i = 0; i < poly.vertices.length; i++) {
                    let nextIdx = i + 1;
                    if (nextIdx >= poly.vertices.length) { if (poly.shape || poly.closed) nextIdx = 0; else break; }
                    const v1 = poly.vertices[i]; const v2 = poly.vertices[nextIdx]; const bulge = v1.bulge || 0;
                    const p1 = getWCS(v1); const p2 = getWCS(v2);
                    if (Math.abs(bulge) > 1e-6) {
                        const dist = p1.distanceTo(p2);
                        const radius = dist * (bulge * bulge + 1) / (4 * Math.abs(bulge));
                        const cx = (p1.x + p2.x) / 2 - (p2.y - p1.y) * (1 - bulge * bulge) / (4 * bulge);
                        const cy = (p1.y + p2.y) / 2 + (p2.x - p1.x) * (1 - bulge * bulge) / (4 * bulge);
                        const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
                        const endAngle = Math.atan2(p2.y - cy, p2.x - cx);
                        const isCW = bulge < 0;
                        segments.push({ start: p1, end: p2, createPathAction: (path, offset) => path.absarc(cx - offset.x, cy - offset.y, radius, startAngle, endAngle, isCW), createReversePathAction: (path, offset) => path.absarc(cx - offset.x, cy - offset.y, radius, endAngle, startAngle, !isCW), type: 'POLYSEGMENT_ARC' });
                    } else {
                        segments.push({ start: p1, end: p2, createPathAction: (path, offset) => path.lineTo(p2.x - offset.x, p2.y - offset.y), createReversePathAction: (path, offset) => path.lineTo(p1.x - offset.x, p1.y - offset.y), type: 'POLYSEGMENT' });
                    }
                }
            }
        } else if (entity.type === 'SPLINE') {
            const spline = entity as any;
            const controlPoints = spline.controlPoints;
            const knots = spline.knotValues;
            const degree = spline.degreeOfSplineCurve || 3;
            if (controlPoints && controlPoints.length > degree && knots && knots.length > 0) {
                const scaledCP = controlPoints.map((p: any) => ({ x: p.x * scaleFactor, y: p.y * scaleFactor }));
                const pts = interpolateBSpline(scaledCP, degree, knots, 20);
                if (pts.length > 1) {
                    segments.push({
                        start: pts[0], end: pts[pts.length - 1],
                        createPathAction: (path, offset) => { for (let k = 1; k < pts.length; k++) path.lineTo(pts[k].x - offset.x, pts[k].y - offset.y); },
                        createReversePathAction: (path, offset) => { for (let k = pts.length - 2; k >= 0; k--) path.lineTo(pts[k].x - offset.x, pts[k].y - offset.y); },
                        type: 'SPLINE_INTERPOLATED'
                    });
                }
            } else if (controlPoints && controlPoints.length > 1) {
                for (let i = 0; i < controlPoints.length - 1; i++) {
                    segments.push({ start: new THREE.Vector2(controlPoints[i].x * scaleFactor, controlPoints[i].y * scaleFactor), end: new THREE.Vector2(controlPoints[i + 1].x * scaleFactor, controlPoints[i + 1].y * scaleFactor), createPathAction: (path, offset) => path.lineTo(controlPoints[i + 1].x * scaleFactor - offset.x, controlPoints[i + 1].y * scaleFactor - offset.y), createReversePathAction: (path, offset) => path.lineTo(controlPoints[i].x * scaleFactor - offset.x, controlPoints[i].y * scaleFactor - offset.y), type: 'SPLINE_LINEAR_FALLBACK' });
                }
            }
        } else if (entity.type === 'CIRCLE') {
            const circle = entity as any;
            const centerWCS = transformPointToWCS(circle.center.x, circle.center.y, circle.center.z || 0, basis);
            const r = circle.radius;
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
            const mx = ellipse.majorAxisEndPoint.x * scaleFactor;
            const my = ellipse.majorAxisEndPoint.y * scaleFactor;
            const majorRadius = Math.sqrt(mx * mx + my * my);
            const minorRadius = majorRadius * ellipse.axisRatio;
            const rotation = Math.atan2(my, mx);
            let startParam = ellipse.startAngle;
            let endParam = ellipse.endAngle;
            if (Math.abs(endParam - startParam) < EPSILON) endParam = startParam + 2 * Math.PI;
            const getEllipsePoint = (t: number) => {
                const cosT = Math.cos(t); const sinT = Math.sin(t); const cosR = Math.cos(rotation); const sinR = Math.sin(rotation);
                return new THREE.Vector2(cx + majorRadius * cosT * cosR - minorRadius * sinT * sinR, cy + majorRadius * cosT * sinR + minorRadius * sinT * cosR);
            };
            segments.push({
                start: getEllipsePoint(startParam), end: getEllipsePoint(endParam),
                createPathAction: (path, offset) => path.absellipse(cx - offset.x, cy - offset.y, majorRadius, minorRadius, startParam, endParam, false, rotation),
                createReversePathAction: (path, offset) => path.absellipse(cx - offset.x, cy - offset.y, majorRadius, minorRadius, endParam, startParam, true, rotation),
                type: 'ELLIPSE'
            });
        }
    });

    console.log(`Extracted ${segments.length} segments.`);
    if (segments.length === 0) return [];

    const bMin = new THREE.Vector2(Infinity, Infinity);
    const bMax = new THREE.Vector2(-Infinity, -Infinity);
    segments.forEach(s => {
        bMin.x = Math.min(bMin.x, s.start.x, s.end.x);
        bMax.x = Math.max(bMax.x, s.start.x, s.end.x);
        bMin.y = Math.min(bMin.y, s.start.y, s.end.y);
        bMax.y = Math.max(bMax.y, s.start.y, s.end.y);
    });
    const center = new THREE.Vector2((bMin.x + bMax.x) / 2, (bMin.y + bMax.y) / 2);

    // 1. Deduplication (Strict + Directional)
    let unique: PathSegment[] = [];
    const keys = new Set<string>();
    const pointsKey = (p1: THREE.Vector2, p2: THREE.Vector2) => `${p1.x.toFixed(4)},${p1.y.toFixed(4)}|${p2.x.toFixed(4)},${p2.y.toFixed(4)}`;
    segments.forEach(seg => {
        if (seg.type !== 'LINE') { unique.push(seg); return; }
        const key = pointsKey(seg.start, seg.end);
        if (!keys.has(key)) { keys.add(key); unique.push(seg); }
    });

    // 2. Cut-Line Removal (Robust O(N^2) Bridge Removal)
    const bridgeThreshold = 0.1;
    const sqBridgeThreshold = bridgeThreshold * bridgeThreshold;
    const activeSegments: PathSegment[] = [];
    const usedIndices = new Set<number>();

    for (let i = 0; i < unique.length; i++) {
        if (usedIndices.has(i)) continue;
        const s = unique[i];
        let isBridge = false;
        for (let j = i + 1; j < unique.length; j++) {
            if (usedIndices.has(j)) continue;
            const other = unique[j];
            // Check reversed pair (A->B vs B->A)
            const d1 = s.start.distanceToSquared(other.end);
            const d2 = s.end.distanceToSquared(other.start);
            if (d1 < sqBridgeThreshold && d2 < sqBridgeThreshold) {
                usedIndices.add(i);
                usedIndices.add(j);
                isBridge = true;
                break;
            }
        }
        if (!isBridge && !usedIndices.has(i)) activeSegments.push(s);
    }
    console.log(`Bridges Removed: ${unique.length - activeSegments.length} segments.`);

    // 3. Multi-Pass Stitching with Double-Ended Traversal
    const stitchChains = (poolIndices: number[], epsilon: number) => {
        const sqEpsilon = epsilon * epsilon;
        const closedChains: { indices: number[], reversed: boolean[] }[] = [];
        const openChains: { indices: number[], reversed: boolean[] }[] = [];
        const used = new Set<number>();

        const neighbors: Record<number, { start: number[], end: number[] }> = {};
        poolIndices.forEach(i => neighbors[i] = { start: [], end: [] });
        poolIndices.forEach(i => {
            const s1 = activeSegments[i];
            poolIndices.forEach(j => {
                if (i === j) return;
                const s2 = activeSegments[j];
                if (s1.start.distanceToSquared(s2.start) < sqEpsilon || s1.start.distanceToSquared(s2.end) < sqEpsilon) neighbors[i].start.push(j);
                if (s1.end.distanceToSquared(s2.start) < sqEpsilon || s1.end.distanceToSquared(s2.end) < sqEpsilon) neighbors[i].end.push(j);
            });
        });

        const getBestNeighbor = (currentEnd: THREE.Vector2, exclude: Set<number>, candidates: number[]) => {
            let best = -1; let minDist = Infinity; let bestIsRev = false;
            for (const idx of candidates) {
                if (exclude.has(idx)) continue;
                const seg = activeSegments[idx];
                const dStart = currentEnd.distanceToSquared(seg.start);
                const dEnd = currentEnd.distanceToSquared(seg.end);
                if (dStart < sqEpsilon && dStart < minDist) { minDist = dStart; best = idx; bestIsRev = false; }
                if (dEnd < sqEpsilon && dEnd < minDist) { minDist = dEnd; best = idx; bestIsRev = true; }
            }
            return best !== -1 ? { idx: best, reversed: bestIsRev } : null;
        };

        poolIndices.forEach(seedIdx => {
            if (used.has(seedIdx)) return;
            used.add(seedIdx);

            // Forward
            const forwardChain: number[] = [seedIdx];
            const forwardRev: boolean[] = [false];
            let currHead = activeSegments[seedIdx].end;
            let found = true;
            while (found) {
                found = false;
                const lastIdx = forwardChain[forwardChain.length - 1];
                const lastWasRev = forwardRev[forwardRev.length - 1];
                const candidates = lastWasRev ? neighbors[lastIdx].start : neighbors[lastIdx].end;
                const res = getBestNeighbor(currHead, used, candidates);
                if (res) {
                    used.add(res.idx);
                    forwardChain.push(res.idx);
                    forwardRev.push(res.reversed);
                    const seg = activeSegments[res.idx];
                    currHead = res.reversed ? seg.start : seg.end;
                    found = true;
                    if (currHead.distanceToSquared(activeSegments[seedIdx].start) < sqEpsilon) {
                        closedChains.push({ indices: forwardChain, reversed: forwardRev });
                        return;
                    }
                }
            }

            // Backward
            let currTail = activeSegments[seedIdx].start;
            const backChain: number[] = [];
            const backRev: boolean[] = [];
            found = true;
            while (found) {
                found = false;
                const firstIdx = backChain.length > 0 ? backChain[backChain.length - 1] : seedIdx;
                const firstWasRev = backChain.length > 0 ? backRev[backRev.length - 1] : false;
                const candidates = (firstIdx === seedIdx || firstWasRev === false) ? neighbors[firstIdx].start : neighbors[firstIdx].end;
                const res = getBestNeighbor(currTail, used, candidates);
                if (res) {
                    used.add(res.idx);
                    backChain.push(res.idx);
                    backRev.push(res.reversed);
                    const seg = activeSegments[res.idx];
                    currTail = res.reversed ? seg.start : seg.end;
                    found = true;
                }
            }

            const finalIndices: number[] = [];
            const finalRev: boolean[] = [];
            for (let k = backChain.length - 1; k >= 0; k--) {
                finalIndices.push(backChain[k]);
                finalRev.push(!backRev[k]);
            }
            finalIndices.push(seedIdx);
            finalRev.push(false);
            for (let k = 0; k < forwardChain.length; k++) {
                if (k === 0 && forwardChain[k] === seedIdx) continue;
                finalIndices.push(forwardChain[k]);
                finalRev.push(forwardRev[k]);
            }

            const headSeg = activeSegments[finalIndices[finalIndices.length - 1]];
            const headPt = finalRev[finalRev.length - 1] ? headSeg.start : headSeg.end;
            const tailSeg = activeSegments[finalIndices[0]];
            const tailPt = finalRev[0] ? tailSeg.end : tailSeg.start;

            if (headPt.distanceToSquared(tailPt) < sqEpsilon) {
                closedChains.push({ indices: finalIndices, reversed: finalRev });
            } else {
                openChains.push({ indices: finalIndices, reversed: finalRev });
            }
        });
        return { closed: closedChains, open: openChains };
    };

    console.log(`Starting Stitch (Segments: ${activeSegments.length})`);
    const p1 = stitchChains(activeSegments.map((_, i) => i), 0.1);
    console.log(`Pass 1: ${p1.closed.length} Closed, ${p1.open.length} Open`);

    let finalClosed = p1.closed;
    let finalOpen = p1.open;
    if (p1.open.length > 0) {
        const p2 = stitchChains(p1.open.flatMap(c => c.indices), 1.0);
        console.log(`Pass 2: ${p2.closed.length} Closed, ${p2.open.length} Open`);
        finalClosed = [...finalClosed, ...p2.closed];
        finalOpen = p2.open;
    }

    const shapes: THREE.Shape[] = [];
    const build = (chain: { indices: number[], reversed: boolean[] }, force: boolean) => {
        if (!chain.indices.length) return;
        const s = new THREE.Shape();
        const fSeg = activeSegments[chain.indices[0]];
        const start = chain.reversed[0] ? fSeg.end : fSeg.start;
        s.moveTo(start.x - center.x, start.y - center.y);
        chain.indices.forEach((idx, i) => {
            const seg = activeSegments[idx];
            chain.reversed[i] ? seg.createReversePathAction(s, center) : seg.createPathAction(s, center);
        });
        if (force) s.closePath();
        if (Math.abs(THREE.ShapeUtils.area(s.getPoints())) > 1.0) shapes.push(s);
    };
    finalClosed.forEach(c => build(c, true));
    finalOpen.forEach(c => build(c, true));

    console.log(`Generated ${shapes.length} Shapes.`);

    const shapeInfos = shapes.map((shape, index) => {
        const points = shape.getPoints();
        let area = THREE.ShapeUtils.area(points);
        if (area < 0) { points.reverse(); area = Math.abs(area); const n = new THREE.Shape(); n.moveTo(points[0].x, points[0].y); for (let k = 1; k < points.length; k++) n.lineTo(points[k].x, points[k].y); n.closePath(); return { shape: n, area, points, isHole: false, id: index, parent: null as any }; }
        return { shape, area, points, isHole: false, id: index, parent: null as any };
    });

    const isPointInPolygon = (p: THREE.Vector2, points: THREE.Vector2[]) => {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;
            const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    };

    shapeInfos.sort((a, b) => b.area - a.area);
    const valid = shapeInfos.filter(s => s.area > EPSILON);
    const final: THREE.Shape[] = [];
    for (let i = 0; i < valid.length; i++) {
        const curr = valid[i];
        let parent = null;
        for (let j = i - 1; j >= 0; j--) {
            const pot = valid[j];
            const idxs = [0, Math.floor(curr.points.length / 2), curr.points.length - 1];
            let cnt = 0;
            for (const k of idxs) if (isPointInPolygon(curr.points[k], pot.points)) cnt++;
            if (cnt > 0) { parent = pot; break; }
        }
        if (parent) {
            if (!parent.isHole) { curr.isHole = true; parent.shape.holes.push(curr.shape); }
            else { final.push(curr.shape); }
        } else { final.push(curr.shape); }
    }
    return final;
};

function interpolateBSpline(controlPoints: any[], degree: number, knots: number[], segmentResolution = 20) {
    const points: THREE.Vector2[] = [];
    const low = knots[degree];
    const high = knots[knots.length - 1 - degree];
    if (high <= low) return points;
    for (let i = degree; i < knots.length - 1 - degree; i++) {
        const u0 = knots[i];
        const u1 = knots[i + 1];
        if (u1 <= u0) continue;
        for (let j = 0; j < segmentResolution; j++) {
            const t = u0 + (u1 - u0) * (j / segmentResolution);
            points.push(evaluateBSpline(t, degree, controlPoints, knots));
        }
    }
    points.push(evaluateBSpline(high, degree, controlPoints, knots));
    return points;
}

function evaluateBSpline(t: number, degree: number, points: any[], knots: number[]) {
    let s = degree;
    while (s < knots.length - 1 - degree && knots[s + 1] <= t) s++;
    if (t > knots[knots.length - 1 - degree] - 1e-9) s = knots.length - degree - 2;
    const v: THREE.Vector2[] = [];
    for (let i = 0; i <= degree; i++) {
        const idx = s - degree + i;
        v[i] = (idx >= 0 && idx < points.length) ? new THREE.Vector2(points[idx].x, points[idx].y) : new THREE.Vector2(0, 0);
    }
    for (let r = 1; r <= degree; r++) {
        for (let j = degree; j >= r; j--) {
            const denom = knots[s + 1 + j - r] - knots[s - degree + j];
            let alpha = 0;
            if (denom !== 0) alpha = (t - knots[s - degree + j]) / denom;
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
            for (let i = 1; i < points.length; i++) pathData += `L ${points[i].x} ${points[i].y} `;
            if (shape.holes && shape.holes.length > 0) {
                shape.holes.forEach(hole => {
                    const holePoints = hole.getPoints();
                    if (holePoints.length > 0) {
                        pathData += `M ${holePoints[0].x} ${holePoints[0].y} `;
                        for (let k = 1; k < holePoints.length; k++) pathData += `L ${holePoints[k].x} ${holePoints[k].y} `;
                        pathData += "Z ";
                    }
                });
            }
            pathData += "Z ";
        }
    });
    return pathData;
};
