import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { type OutlinePolygon } from './outlineToPolygon';
import { generateTilePositions } from '../utils/patternUtils';
import { pointInPolygon, assignTilesToColors, type TileAssignment } from './spikes';
import type { Centroid } from './pipeline/quantize';
import type { TracedLayerEntry } from './workerProtocol';
import type { GeometrySettings, InlayItem } from '../types/schemas';

interface Props {
  outlinePolygon: OutlinePolygon | null;
  /** ColorFlow color regions in mm-space. Empty in pattern mode. */
  layersInMm: TracedLayerEntry[];
  palette: Centroid[];
  stackOrder: number[];
  /** Pattern-mode inlay shapes. Empty/undefined in ColorFlow mode. */
  inlayItems?: InlayItem[];
  geometrySettings: GeometrySettings;
  /** Base outline fill color (from baseSettings). */
  baseColor: string;
  /** True = tint tile dots to the color underneath; false = pattern color. */
  spikeColorMatch: boolean;
}

const PAD_PX = 40; // canvas inset

/** 2D convex hull (Andrew's monotone chain). Used to flatten a pattern STL
 *  into its bottom-projection outline so spike footprints retain their shape
 *  (hex/square/dome) instead of becoming generic dots. */
function convexHull2D(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/** Cache: WeakMap from BufferGeometry → 2D footprint (convex hull in shape-local mm). */
const footprintCache = new WeakMap<THREE.BufferGeometry, Array<[number, number]>>();

function patternFootprint2D(patternShape: unknown): Array<[number, number]> | null {
  if (patternShape instanceof THREE.Shape) {
    return patternShape.getPoints(48).map((p) => [p.x, p.y] as [number, number]);
  }
  if (patternShape instanceof THREE.BufferGeometry) {
    const cached = footprintCache.get(patternShape);
    if (cached) return cached;
    const posAttr = patternShape.attributes.position;
    if (!posAttr) return null;
    const arr = posAttr.array as Float32Array;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < arr.length; i += 3) pts.push([arr[i], arr[i + 1]]);
    const hull = convexHull2D(pts);
    footprintCache.set(patternShape, hull);
    return hull;
  }
  return null;
}

/** Signed area (shoelace) magnitude of a polygon ring, in the units of the
 *  input points. Used to suppress labels on tiny anti-aliasing slivers. */
function polygonRingArea(ring: Array<[number, number]>): number {
  if (ring.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

/**
 * 2D top-down preview of the ColorFlow design. Cheaper than the 3D Canvas:
 * just a single 2D canvas with paths + circles, no GPU shader work, no mesh
 * extrusion. Always live (no Generate button) — tile positions are computed
 * on the fly using the same `generateTilePositions` the 3D pipeline uses.
 *
 * Renders, in order:
 *   1. Base outline (filled with baseColor, stroked white)
 *   2. Color region polygons (filled with their centroid color)
 *   3. Spike tile dots (one per tile position, tinted)
 *   4. Dimension lines along the bbox + W/H labels
 *   5. Layer-order legend strip down the right edge
 */
export const TwoDViewer: React.FC<Props> = ({
  outlinePolygon, layersInMm, palette, stackOrder, inlayItems,
  geometrySettings, baseColor, spikeColorMatch,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(200, Math.floor(rect.width));
    const H = Math.max(200, Math.floor(rect.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0f172a'; // slate-900
    ctx.fillRect(0, 0, W, H);

    // Grid (subtle)
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const gridStep = 40;
    for (let x = 0; x < W; x += gridStep) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += gridStep) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
    }

    if (!outlinePolygon || outlinePolygon.outer.length === 0) {
      // Hint when nothing to draw.
      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Pick a base outline to see a preview', W / 2, H / 2);
      return;
    }

    // Compute world→canvas transform: fit-centered with PAD_PX margin.
    const wMm = outlinePolygon.maxX - outlinePolygon.minX;
    const hMm = outlinePolygon.maxY - outlinePolygon.minY;
    // Reserve right strip for legend (max 80px) when palette has entries.
    const legendW = palette.length > 0 ? 90 : 0;
    const availW = W - PAD_PX * 2 - legendW;
    const availH = H - PAD_PX * 2;
    const scale = Math.min(availW / wMm, availH / hMm);
    const renderW = wMm * scale;
    const renderH = hMm * scale;
    const offsetX = PAD_PX + (availW - renderW) / 2;
    const offsetY = PAD_PX + (availH - renderH) / 2;

    // Map world (mm, Y-up) to canvas (px, Y-down).
    const wx = (mmX: number) => offsetX + (mmX - outlinePolygon.minX) * scale;
    const wy = (mmY: number) => offsetY + (outlinePolygon.maxY - mmY) * scale;

    const pathRing = (path: Path2D, ring: Array<[number, number]>) => {
      if (ring.length === 0) return;
      const [x0, y0] = ring[0];
      path.moveTo(wx(x0), wy(y0));
      for (let i = 1; i < ring.length; i++) path.lineTo(wx(ring[i][0]), wy(ring[i][1]));
      path.closePath();
    };

    // 1. Outline fill + stroke
    const outlinePath = new Path2D();
    pathRing(outlinePath, outlinePolygon.outer);
    for (const hole of outlinePolygon.holes) pathRing(outlinePath, hole);
    ctx.fillStyle = baseColor;
    ctx.fill(outlinePath, 'evenodd');
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke(outlinePath);

    // 2. Color region polygons
    const positionByCentroid = new Map<number, number>();
    for (let i = 0; i < stackOrder.length; i++) positionByCentroid.set(stackOrder[i], i);
    // Draw in stack order so higher layers paint on top of lower ones.
    const sortedLayers = [...layersInMm].sort((a, b) => {
      const pa = positionByCentroid.get(a.centroidIndex) ?? -1;
      const pb = positionByCentroid.get(b.centroidIndex) ?? -1;
      return pa - pb;
    });
    // Track polygon centroids per color so we can annotate with layer numbers.
    // Record area too so we can suppress labels on anti-aliasing slivers.
    const labelCandidates: Array<{ x: number; y: number; layerNum: number; color: Centroid; centroidIndex: number; areaMm2: number }> = [];
    for (const entry of sortedLayers) {
      const c = palette[entry.centroidIndex];
      if (!c) continue;
      const path = new Path2D();
      pathRing(path, entry.polygon.outer);
      for (const hole of entry.polygon.holes) pathRing(path, hole);
      ctx.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
      ctx.fill(path, 'evenodd');
      // Faint outline so adjacent same-color polygons read as distinct regions.
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.lineWidth = 0.8;
      ctx.stroke(path);

      // Polygon centroid (simple ring-mean — good enough for labeling).
      const stackPos = positionByCentroid.get(entry.centroidIndex);
      if (stackPos !== undefined && entry.polygon.outer.length > 0) {
        let cx = 0, cy = 0;
        for (const [px, py] of entry.polygon.outer) { cx += px; cy += py; }
        cx /= entry.polygon.outer.length;
        cy /= entry.polygon.outer.length;
        const areaMm2 = polygonRingArea(entry.polygon.outer);
        labelCandidates.push({ x: cx, y: cy, layerNum: stackPos + 1, color: c, centroidIndex: entry.centroidIndex, areaMm2 });
      }
    }

    // Suppress labels on sliver polygons: per colour, drop anything below
    // 15% of that colour's largest polygon AND below an absolute 25 mm² floor.
    const maxAreaPerCentroid = new Map<number, number>();
    for (const cand of labelCandidates) {
      const cur = maxAreaPerCentroid.get(cand.centroidIndex) ?? 0;
      if (cand.areaMm2 > cur) maxAreaPerCentroid.set(cand.centroidIndex, cand.areaMm2);
    }
    const SLIVER_REL = 0.15;
    const SLIVER_ABS_MM2 = 25;
    const layerLabels = labelCandidates.filter((cand) => {
      const maxA = maxAreaPerCentroid.get(cand.centroidIndex) ?? cand.areaMm2;
      return cand.areaMm2 >= SLIVER_ABS_MM2 || cand.areaMm2 >= maxA * SLIVER_REL;
    });

    // 2b. Pattern-mode inlays. Rendered after color regions but before
    //     spike tiles so spikes can sit on top.
    if (inlayItems && inlayItems.length > 0) {
      for (const item of inlayItems) {
        if (!item.shapes || item.shapes.length === 0) continue;
        for (const rawShape of item.shapes) {
          // Inlays may carry a {shape, color} wrapper from SVG parse.
          const shape: unknown = (rawShape && typeof rawShape === 'object' && 'shape' in rawShape)
            ? (rawShape as { shape: unknown }).shape
            : rawShape;
          const color: string | undefined = (rawShape && typeof rawShape === 'object' && 'color' in rawShape)
            ? (rawShape as { color?: string }).color
            : undefined;
          if (!(shape instanceof THREE.Shape)) continue;

          // Inlay transform: mirror (flip X) → rotate → translate by item.x/y.
          const cos = Math.cos((item.rotation ?? 0) * Math.PI / 180);
          const sin = Math.sin((item.rotation ?? 0) * Math.PI / 180);
          const itemScale = item.scale ?? 1;
          const mirror = item.mirror ? -1 : 1;
          const tx = item.x ?? 0;
          const ty = item.y ?? 0;
          const project = (p: [number, number]): [number, number] => {
            const lx = p[0] * itemScale * mirror;
            const ly = p[1] * itemScale;
            return [lx * cos - ly * sin + tx, lx * sin + ly * cos + ty];
          };
          const points = shape.getPoints(48).map((p) => project([p.x, p.y]));
          const holes = (shape.holes ?? []).map((h) => h.getPoints(48).map((p) => project([p.x, p.y])));

          const path = new Path2D();
          if (points.length > 0) {
            path.moveTo(wx(points[0][0]), wy(points[0][1]));
            for (let i = 1; i < points.length; i++) path.lineTo(wx(points[i][0]), wy(points[i][1]));
            path.closePath();
          }
          for (const hole of holes) {
            if (hole.length === 0) continue;
            path.moveTo(wx(hole[0][0]), wy(hole[0][1]));
            for (let i = 1; i < hole.length; i++) path.lineTo(wx(hole[i][0]), wy(hole[i][1]));
            path.closePath();
          }
          ctx.fillStyle = color ?? '#1f2937';
          ctx.fill(path, 'evenodd');
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.lineWidth = 1;
          ctx.stroke(path);
        }
      }
    }

    // 3. Spike tile footprints — render the pattern's actual 2D silhouette
    //    (convex hull of the STL projected to XY, or the THREE.Shape polygon
    //    for shape patterns) at each tile transform. Far more informative than
    //    flat dots — the user sees the actual bump shape: hex / square / dome
    //    outline. Tinted by the color region below when in ColorFlow mode +
    //    color-matched, otherwise patternColor.
    const patternShape = geometrySettings.patternShapes?.[0];
    const footprint = patternFootprint2D(patternShape);
    if (footprint && footprint.length >= 3) {
      const patternScale = geometrySettings.patternScale ?? 1;
      let tileW = 0, tileH = 0;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [px, py] of footprint) {
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      tileW = (maxX - minX) * patternScale;
      tileH = (maxY - minY) * patternScale;

      if (tileW > 0.05 && tileH > 0.05) {
        const tileBounds = new THREE.Box2(
          new THREE.Vector2(outlinePolygon.minX, outlinePolygon.minY),
          new THREE.Vector2(outlinePolygon.maxX, outlinePolygon.maxY),
        );
        const outlineForBounds = outlinePolygonToShape(outlinePolygon);
        const rawTiles = generateTilePositions(
          tileBounds, tileW, tileH, geometrySettings.tileSpacing,
          [outlineForBounds], geometrySettings.patternMargin, false,
          geometrySettings.tilingDistribution,
          geometrySettings.tilingOrientation,
          geometrySettings.tilingDirection,
        );
        const outlinePoly = { outer: outlinePolygon.outer, holes: outlinePolygon.holes };
        const tilesIn = rawTiles
          .filter((t) => pointInPolygon(t.position.x, t.position.y, outlinePoly))
          .map((t) => ({ x: t.position.x, y: t.position.y, rotation: t.rotation, scale: t.scale ?? 1 }));
        const colorPolygons = layersInMm.map((l) => ({ centroidIndex: l.centroidIndex, polygon: l.polygon }));
        const assignments: TileAssignment[] = assignTilesToColors(tilesIn, colorPolygons, stackOrder);

        const fallbackColor = geometrySettings.patternColor;

        for (const tile of assignments) {
          let fill = fallbackColor;
          if (spikeColorMatch && tile.colorIndex >= 0) {
            const c = palette[tile.colorIndex];
            if (c) {
              fill = `rgb(${Math.max(0, c.r - 40)}, ${Math.max(0, c.g - 40)}, ${Math.max(0, c.b - 40)})`;
            }
          }
          const cos = Math.cos(tile.rotation);
          const sin = Math.sin(tile.rotation);
          const sx = tile.scale * patternScale;
          const path = new Path2D();
          for (let i = 0; i < footprint.length; i++) {
            const [px, py] = footprint[i];
            const lx = px * sx;
            const ly = py * sx;
            const rx = lx * cos - ly * sin + tile.x;
            const ry = lx * sin + ly * cos + tile.y;
            if (i === 0) path.moveTo(wx(rx), wy(ry));
            else path.lineTo(wx(rx), wy(ry));
          }
          path.closePath();
          ctx.fillStyle = fill;
          ctx.fill(path);
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
          ctx.lineWidth = 0.6;
          ctx.stroke(path);
        }
      }
    }

    // 4. Layer-number annotations at each polygon centroid. Drawn after the
    //    spike footprints so labels stay readable above the bumps.
    if (layerLabels.length > 0) {
      ctx.font = '600 11px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const label of layerLabels) {
        const lx = wx(label.x);
        const ly = wy(label.y);
        const luma = 0.2126 * label.color.r + 0.7152 * label.color.g + 0.0722 * label.color.b;
        const textColor = luma < 140 ? 'rgba(255, 255, 255, 0.95)' : 'rgba(15, 23, 42, 0.95)';
        const haloColor = luma < 140 ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.7)';
        // Halo for legibility against busy spike grids.
        ctx.fillStyle = haloColor;
        ctx.beginPath();
        ctx.arc(lx, ly, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = textColor;
        ctx.fillText(`L${label.layerNum}`, lx, ly + 0.5);
      }
    }

    // 5. Dimension lines + size labels
    drawDimensionLines(ctx, outlinePolygon, offsetX, offsetY, renderW, renderH, scale);

    // 5. Layer-order legend (right strip)
    if (palette.length > 0 && legendW > 0) {
      drawLegend(ctx, palette, stackOrder, W - legendW + 4, PAD_PX, legendW - 8, H - PAD_PX * 2);
    }
  });

  return (
    <div ref={containerRef} className="absolute inset-0 bg-slate-900">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
};

function drawDimensionLines(
  ctx: CanvasRenderingContext2D,
  outline: OutlinePolygon,
  offsetX: number,
  offsetY: number,
  renderW: number,
  renderH: number,
  _scale: number,
) {
  const wMm = outline.maxX - outline.minX;
  const hMm = outline.maxY - outline.minY;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
  ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
  ctx.lineWidth = 1;
  ctx.font = '11px ui-sans-serif, system-ui';

  // Top dimension line
  const topY = offsetY - 10;
  ctx.beginPath();
  ctx.moveTo(offsetX, topY); ctx.lineTo(offsetX + renderW, topY);
  ctx.moveTo(offsetX, topY - 4); ctx.lineTo(offsetX, topY + 4);
  ctx.moveTo(offsetX + renderW, topY - 4); ctx.lineTo(offsetX + renderW, topY + 4);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillText(`${wMm.toFixed(1)} mm`, offsetX + renderW / 2, topY - 4);

  // Left dimension line
  const leftX = offsetX - 10;
  ctx.beginPath();
  ctx.moveTo(leftX, offsetY); ctx.lineTo(leftX, offsetY + renderH);
  ctx.moveTo(leftX - 4, offsetY); ctx.lineTo(leftX + 4, offsetY);
  ctx.moveTo(leftX - 4, offsetY + renderH); ctx.lineTo(leftX + 4, offsetY + renderH);
  ctx.stroke();
  ctx.save();
  ctx.translate(leftX - 4, offsetY + renderH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(`${hMm.toFixed(1)} mm`, 0, -2);
  ctx.restore();
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  palette: Centroid[],
  stackOrder: number[],
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.5)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
  ctx.font = '10px ui-sans-serif, system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('LAYERS', x + 8, y + 14);

  const rowH = 22;
  const startY = y + 26;
  // Iterate in stack order so labels match 3D rendering ("layer 1 = bottom").
  for (let i = 0; i < stackOrder.length; i++) {
    const c = palette[stackOrder[i]];
    if (!c) continue;
    const ry = startY + i * rowH;
    if (ry + rowH > y + h) break;
    ctx.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
    ctx.fillRect(x + 8, ry, 14, 14);
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.7)';
    ctx.strokeRect(x + 8.5, ry + 0.5, 13, 13);
    ctx.fillStyle = 'rgba(203, 213, 225, 0.95)';
    ctx.font = '10px ui-monospace, monospace';
    const hex = `#${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}`;
    ctx.fillText(`L${i + 1}`, x + 28, ry + 6);
    ctx.fillText(hex.toUpperCase(), x + 28, ry + 16);
  }
}

function outlinePolygonToShape(polygon: OutlinePolygon): THREE.Shape {
  const shape = new THREE.Shape();
  if (polygon.outer.length > 0) {
    const [x0, y0] = polygon.outer[0];
    shape.moveTo(x0, y0);
    for (let i = 1; i < polygon.outer.length; i++) shape.lineTo(polygon.outer[i][0], polygon.outer[i][1]);
    shape.closePath();
  }
  for (const hole of polygon.holes) {
    if (hole.length < 3) continue;
    const path = new THREE.Path();
    const [hx, hy] = hole[0];
    path.moveTo(hx, hy);
    for (let i = 1; i < hole.length; i++) path.lineTo(hole[i][0], hole[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}
