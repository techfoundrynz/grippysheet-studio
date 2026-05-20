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

export interface Placement {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Fit a bounded shape into a rectangular image canvas, preserving aspect ratio.
 * Returned placement maps shape-mm coords into pixel coords:
 *   pixelX = (mmX - bounds.minX) * scale + offsetX
 */
export function fitOutlineInImage(bounds: Bounds, imgW: number, imgH: number): Placement {
  const oW = bounds.maxX - bounds.minX;
  const oH = bounds.maxY - bounds.minY;
  if (oW <= 0 || oH <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };

  const scale = Math.min(imgW / oW, imgH / oH);
  const renderW = oW * scale;
  const renderH = oH * scale;
  return {
    scale,
    offsetX: (imgW - renderW) / 2,
    offsetY: (imgH - renderH) / 2,
  };
}

/**
 * Inverse of `buildOutlineMask`'s pixel placement: convert a pixel coordinate
 * back to the shape's absolute mm coordinate. Note that canvas Y is Y-down
 * but the outline (and Three.js scene) is Y-up, so Y is flipped relative
 * to bounds.maxY.
 */
export function pixelToMm(px: number, py: number, placement: Placement, bounds: Bounds): [number, number] {
  return [
    (px - placement.offsetX) / placement.scale + bounds.minX,
    bounds.maxY - (py - placement.offsetY) / placement.scale,
  ];
}

/**
 * Rasterize an outline polygon into a 1/0 mask the size of `(imgW, imgH)`.
 * 1 = inside outline. Browser-only — uses a 2D canvas + Path2D.
 */
export function buildOutlineMask(
  polygon: OutlinePolygon,
  placement: Placement,
  imgW: number,
  imgH: number,
): Uint8Array {
  if (polygon.outer.length === 0) {
    return new Uint8Array(imgW * imgH);
  }

  const canvas = document.createElement('canvas');
  canvas.width = imgW;
  canvas.height = imgH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, imgW, imgH);

  ctx.save();
  ctx.translate(placement.offsetX - polygon.minX * placement.scale,
                placement.offsetY - polygon.minY * placement.scale);
  ctx.scale(placement.scale, placement.scale);

  const path = new Path2D();
  const [ox, oy] = polygon.outer[0];
  path.moveTo(ox, oy);
  for (let i = 1; i < polygon.outer.length; i++) {
    path.lineTo(polygon.outer[i][0], polygon.outer[i][1]);
  }
  path.closePath();
  for (const hole of polygon.holes) {
    const [hx, hy] = hole[0];
    path.moveTo(hx, hy);
    for (let i = 1; i < hole.length; i++) path.lineTo(hole[i][0], hole[i][1]);
    path.closePath();
  }
  ctx.fillStyle = '#ffffff';
  ctx.fill(path, 'evenodd');
  ctx.restore();

  const img = ctx.getImageData(0, 0, imgW, imgH).data;
  const mask = new Uint8Array(imgW * imgH);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = img[i * 4] > 128 ? 1 : 0;
  }
  return mask;
}
