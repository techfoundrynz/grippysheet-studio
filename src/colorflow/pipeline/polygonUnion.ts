import ClipperLib from 'clipper-lib';

export interface LayerPolygon {
  outer: Array<[number, number]>;
  holes: Array<Array<[number, number]>>;
}

const SCALE = 1000;

function ringToPath(ring: Array<[number, number]>): Array<{ X: number; Y: number }> {
  return ring.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
}

function pathToRing(path: Array<{ X: number; Y: number }>): Array<[number, number]> {
  return path.map((p) => [p.X / SCALE, p.Y / SCALE] as [number, number]);
}

/**
 * Force a polygon ring to CCW orientation. The downstream extruder
 * (`extrudePolygon`) assumes CCW for both outer rings AND hole rings —
 * Clipper's PolyTree output is CCW for outers but CW for holes by default,
 * which produces inside-out side walls on the holes (visible in slicers as
 * non-manifold edges along every hole boundary). Computing the signed area
 * once per ring and reversing when negative is cheap insurance against the
 * convention drift.
 */
function ensureCCW(ring: Array<[number, number]>): Array<[number, number]> {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  if (a < 0) return ring.slice().reverse();
  return ring;
}

/**
 * Compute the boolean union of multiple polygons (each with optional holes).
 * Returns a set of disjoint, non-touching polygons. Coincident edges between
 * inputs are eliminated; truly overlapping inputs are merged.
 *
 * Empty input yields an empty array. Degenerate inputs (rings with < 3 points)
 * are skipped.
 */
export function unionPolygons(polygons: LayerPolygon[]): LayerPolygon[] {
  if (polygons.length === 0) return [];

  const clipper = new ClipperLib.Clipper();
  for (const poly of polygons) {
    if (poly.outer.length < 3) continue;
    clipper.AddPath(ringToPath(poly.outer), ClipperLib.PolyType.ptSubject, true);
    for (const hole of poly.holes) {
      if (hole.length < 3) continue;
      // Holes must have opposite winding to their outer ring so NonZero fill treats
      // them as empty regions. Reverse the path to flip CW↔CCW.
      clipper.AddPath(ringToPath(hole).reverse(), ClipperLib.PolyType.ptSubject, true);
    }
  }

  const tree = new ClipperLib.PolyTree();
  const ok = clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  if (!ok) {
    // Should be unreachable for valid input — Clipper only returns false on
    // truly malformed paths. Surface to devtools so a swallowed empty level
    // doesn't become a debugging black hole inside the worker.
    console.warn('unionPolygons: clipper.Execute returned false for', polygons.length, 'polygons');
    return [];
  }

  const result: LayerPolygon[] = [];
  // Top-level children of the PolyTree are outer rings; their children are holes.
  // Force CCW orientation on both — see ensureCCW for why.
  for (const outerNode of tree.Childs()) {
    const outer = ensureCCW(pathToRing(outerNode.Contour()));
    if (outer.length < 3) continue;
    const holes: Array<Array<[number, number]>> = [];
    for (const holeNode of outerNode.Childs()) {
      const hole = ensureCCW(pathToRing(holeNode.Contour()));
      if (hole.length >= 3) holes.push(hole);
    }
    result.push({ outer, holes });
  }
  return result;
}
