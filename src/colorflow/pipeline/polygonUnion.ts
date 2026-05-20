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
  if (!ok) return [];

  const result: LayerPolygon[] = [];
  // Top-level children of the PolyTree are outer rings; their children are holes.
  for (const outerNode of tree.Childs()) {
    const outer = pathToRing(outerNode.Contour());
    if (outer.length < 3) continue;
    const holes: Array<Array<[number, number]>> = [];
    for (const holeNode of outerNode.Childs()) {
      const hole = pathToRing(holeNode.Contour());
      if (hole.length >= 3) holes.push(hole);
    }
    result.push({ outer, holes });
  }
  return result;
}
