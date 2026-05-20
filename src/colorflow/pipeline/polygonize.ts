import type { TracedLayer, TracedSubPath } from '../vendor/imagetracer';

export interface LayerPolygon {
  outer: Array<[number, number]>;
  holes: Array<Array<[number, number]>>;
}

function pathToPoints(path: TracedSubPath, sampleQ: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  if (!path.segments.length) return pts;
  pts.push([path.segments[0].x1, path.segments[0].y1]);
  for (const seg of path.segments) {
    if (seg.type === 'L') {
      pts.push([seg.x2, seg.y2]);
    } else {
      for (let i = 1; i <= sampleQ; i++) {
        const t = i / sampleQ, mt = 1 - t;
        pts.push([
          mt * mt * seg.x1 + 2 * mt * t * seg.x2 + t * t * seg.x3,
          mt * mt * seg.y1 + 2 * mt * t * seg.y2 + t * t * seg.y3,
        ]);
      }
    }
  }
  if (pts.length > 2) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001) pts.pop();
  }
  return pts;
}

/**
 * Convert one tracedata layer (array of subpaths with hole metadata) into
 * a list of polygons-with-holes suitable for earcut.
 */
export function layerToPolygons(layer: TracedLayer, sampleQ = 6): LayerPolygon[] {
  const out: LayerPolygon[] = [];
  for (const path of layer) {
    if (path.isholepath) continue;
    const outer = pathToPoints(path, sampleQ);
    if (outer.length < 3) continue;
    const holes = (path.holechildren ?? [])
      .map((idx) => pathToPoints(layer[idx], sampleQ))
      .filter((h) => h.length >= 3);
    out.push({ outer, holes });
  }
  return out;
}
