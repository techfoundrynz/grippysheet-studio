import * as THREE from 'three';

export interface Bounds {
  minX: number; minY: number;
  maxX: number; maxY: number;
}

export interface OutlinePolygon extends Bounds {
  /** Counterclockwise polygon points in shape-local mm coordinates. */
  outer: Array<[number, number]>;
  /** Optional hole rings. */
  holes: Array<Array<[number, number]>>;
}

export const CANVAS_PX_PER_MM = 5;
export const MAX_CANVAS_DIM = 1500;

export function outlineCanvasSize(bounds: Bounds): { w: number; h: number } {
  const wMm = bounds.maxX - bounds.minX;
  const hMm = bounds.maxY - bounds.minY;
  const naturalMax = Math.max(wMm, hMm) * CANVAS_PX_PER_MM;
  const scale = naturalMax > MAX_CANVAS_DIM ? MAX_CANVAS_DIM / naturalMax : 1;
  return {
    w: Math.round(wMm * CANVAS_PX_PER_MM * scale),
    h: Math.round(hMm * CANVAS_PX_PER_MM * scale),
  };
}

/**
 * Convert a THREE.Shape (curves allowed) into a polygon ring + holes.
 * `divisions` controls curve tessellation; default 64 matches DXF/SVG outlines well.
 */
export function shapeToPolygon(shape: THREE.Shape, divisions = 64): OutlinePolygon {
  const outerRaw = shape.getPoints(divisions);

  const dedupe = (pts: THREE.Vector2[]): Array<[number, number]> => {
    const out: Array<[number, number]> = pts.map((p) => [p.x, p.y]);
    if (out.length >= 2) {
      const a = out[0], b = out[out.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop();
    }
    return out;
  };

  const outer = dedupe(outerRaw);
  const holes = (shape.holes ?? []).map((h) => dedupe(h.getPoints(divisions)));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of outer) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return { outer, holes, minX, minY, maxX, maxY };
}

/**
 * Pixel → mm on the outline-anchored canvas. Canvas Y is down; world Y is up,
 * so Y is flipped relative to maxY. Outline (minX, maxY) sits at canvas (0, 0).
 */
export function pixelToMmOnOutlineCanvas(
  px: number,
  py: number,
  bounds: Bounds,
  canvasSize: { w: number; h: number },
): [number, number] {
  const wMm = bounds.maxX - bounds.minX;
  const hMm = bounds.maxY - bounds.minY;
  return [
    (px / canvasSize.w) * wMm + bounds.minX,
    bounds.maxY - (py / canvasSize.h) * hMm,
  ];
}

/**
 * Rasterise the outline polygon as a 1/0 mask sized to the outline canvas.
 * 1 = inside outline (including holes subtracted via evenodd fill).
 */
export function buildOutlineCanvasMask(
  polygon: OutlinePolygon,
  canvasSize: { w: number; h: number },
): Uint8Array {
  const { w, h } = canvasSize;
  if (polygon.outer.length === 0) return new Uint8Array(w * h);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  const wMm = polygon.maxX - polygon.minX;
  const hMm = polygon.maxY - polygon.minY;
  const sx = w / wMm;
  const sy = h / hMm;

  ctx.save();
  ctx.translate(-polygon.minX * sx, -polygon.minY * sy);
  ctx.scale(sx, sy);

  const path = new Path2D();
  const [ox, oy] = polygon.outer[0];
  path.moveTo(ox, oy);
  for (let i = 1; i < polygon.outer.length; i++) {
    path.lineTo(polygon.outer[i][0], polygon.outer[i][1]);
  }
  path.closePath();
  for (const hole of polygon.holes) {
    if (hole.length < 3) continue;
    const [hx, hy] = hole[0];
    path.moveTo(hx, hy);
    for (let i = 1; i < hole.length; i++) path.lineTo(hole[i][0], hole[i][1]);
    path.closePath();
  }
  ctx.fillStyle = '#ffffff';
  ctx.fill(path, 'evenodd');
  ctx.restore();

  const img = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = img[i * 4] > 128 ? 1 : 0;
  }
  return mask;
}
