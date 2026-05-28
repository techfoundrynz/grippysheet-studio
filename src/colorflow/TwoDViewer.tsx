import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { type OutlinePolygon } from './outlineToPolygon';
import { generateTilePositions, tileKey, filterRemovedTiles, toggleSpikeAt, type SpikePosition } from '../utils/patternUtils';
import { pointInPolygon, assignTilesToColors, type TileAssignment } from './spikes';
import type { Centroid } from './pipeline/quantize';
import type { TracedLayerEntry } from './workerProtocol';
import { getPatternLayers, type GeometrySettings, type InlayItem } from '../types/schemas';

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
  /** When true, hovering paints a red outline and clicking removes the tile. */
  tileRemovalMode?: boolean;
  /** Settings dispatcher — required when tileRemovalMode is true. */
  onGeometryChange?: React.Dispatch<React.SetStateAction<GeometrySettings>>;
}

/**
 * Hit-testable record persisted at the end of each tile paint so click +
 * mousemove handlers can resolve "what tile is under the cursor?" without
 * re-running `generateTilePositions`. Layer 0 = primary (top-level
 * removedTiles); layer ≥ 1 maps to `extraLayers[layerIdx - 1]`.
 */
interface DrawnTile {
  layerIdx: number;
  key: string;
  path: Path2D;
  x: number;        // world-mm tile origin
  y: number;
  origin: 'grid' | 'added';
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
  tileRemovalMode = false, onGeometryChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Cached static backdrop (background + glows + dot grid + corner brackets).
  // Repainted only when [W, H, dpr] change; the empty-state RAF loop and
  // every regular draw blit this instead of redoing ~1500 fillRect calls
  // and two createRadialGradient allocations every frame.
  const backdropRef = useRef<{ canvas: HTMLCanvasElement; w: number; h: number; dpr: number } | null>(null);
  // Dimension lines fade in on hover so the canvas reads cleaner at rest.
  const [showDims, setShowDims] = useState(false);
  // Track pad dimensions so the HTML overlay shows the same numbers the
  // canvas-drawn lines do when toggled in.
  const [padDimsMm, setPadDimsMm] = useState<{ w: number; h: number } | null>(null);
  // Painted-tiles registry. Populated at the end of every draw — the click
  // handler iterates these in reverse-paint-order (last layer painted is
  // hit-tested first) using `ctx.isPointInPath` so the top-most visible
  // tile claims the click.
  const drawnTilesRef = useRef<DrawnTile[]>([]);
  const tileRRef = useRef<number>(6);
  const worldToCanvasRef = useRef<{ minX: number; maxY: number; scale: number; offsetX: number; offsetY: number } | null>(null);
  // Cursor-anchored hover state for the in-canvas red outline. Stored as
  // the index into `drawnTilesRef.current` so we don't have to clone the
  // Path2D when the cursor moves between tiles.
  const [hoverTileIdx, setHoverTileIdx] = useState<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(200, Math.floor(rect.width));
    const H = Math.max(200, Math.floor(rect.height));
    const targetBackingW = Math.round(W * dpr);
    const targetBackingH = Math.round(H * dpr);
    // Reassigning canvas.width clears the canvas + resets the transform on
    // every call. Skip it when the size hasn't changed so the RAF loop in
    // empty state doesn't take that hit each frame.
    if (canvas.width !== targetBackingW) canvas.width = targetBackingW;
    if (canvas.height !== targetBackingH) canvas.height = targetBackingH;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Blit the cached static backdrop. Build once on first paint + on any
    // size change; otherwise the empty-state RAF is just a drawImage +
    // the silhouette redraw, not 1500 fillRect + 2 gradient allocations.
    let backdrop = backdropRef.current;
    if (!backdrop || backdrop.w !== W || backdrop.h !== H || backdrop.dpr !== dpr) {
      backdrop = paintBackdrop(W, H, dpr);
      backdropRef.current = backdrop;
    }
    ctx.drawImage(backdrop.canvas, 0, 0, W, H);

    if (!outlinePolygon || outlinePolygon.outer.length === 0) {
      drawEmptyState(ctx, W, H, performance.now());
      return;
    }

    // Compute world→canvas transform: fit-centered with PAD_PX margin.
    const wMm = outlinePolygon.maxX - outlinePolygon.minX;
    const hMm = outlinePolygon.maxY - outlinePolygon.minY;
    // The legend now lives in an HTML overlay; the canvas uses the full width.
    const availW = W - PAD_PX * 2;
    const availH = H - PAD_PX * 2;
    const scale = Math.min(availW / wMm, availH / hMm);
    const renderW = wMm * scale;
    const renderH = hMm * scale;
    const offsetX = PAD_PX + (availW - renderW) / 2;
    const offsetY = PAD_PX + (availH - renderH) / 2;

    // Map world (mm, Y-up) to canvas (px, Y-down).
    const wx = (mmX: number) => offsetX + (mmX - outlinePolygon.minX) * scale;
    const wy = (mmY: number) => offsetY + (outlinePolygon.maxY - mmY) * scale;
    worldToCanvasRef.current = { minX: outlinePolygon.minX, maxY: outlinePolygon.maxY, scale, offsetX, offsetY };

    const pathRing = (path: Path2D, ring: Array<[number, number]>) => {
      if (ring.length === 0) return;
      const [x0, y0] = ring[0];
      path.moveTo(wx(x0), wy(y0));
      for (let i = 1; i < ring.length; i++) path.lineTo(wx(ring[i][0]), wy(ring[i][1]));
      path.closePath();
    };

    // 1. Outline fill + stroke. A subtle drop shadow gives the pad weight —
    //    same trick Apple product shots use: the object looks like it's
    //    resting on a surface rather than floating in a void.
    const outlinePath = new Path2D();
    pathRing(outlinePath, outlinePolygon.outer);
    for (const hole of outlinePolygon.holes) pathRing(outlinePath, hole);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = baseColor;
    ctx.fill(outlinePath, 'evenodd');
    ctx.restore();

    // Subtle inner top-edge highlight to suggest curvature/material.
    const grad = ctx.createLinearGradient(0, offsetY, 0, offsetY + renderH);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    grad.addColorStop(0.4, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
    ctx.fillStyle = grad;
    ctx.fill(outlinePath, 'evenodd');

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
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

    // Sliver suppression: label only the top-K largest polygons per colour,
    // and never label anything below an absolute area floor. A K of 3 keeps
    // legends readable on busy designs (a colour that breaks into 30 tiny
    // pockets gets 3 numbered hot-spots, not 30 illegible L-tags).
    const LABEL_TOP_K = 3;
    const SLIVER_ABS_MM2 = 25;
    const byCentroid = new Map<number, typeof labelCandidates>();
    for (const cand of labelCandidates) {
      const bucket = byCentroid.get(cand.centroidIndex) ?? [];
      bucket.push(cand);
      byCentroid.set(cand.centroidIndex, bucket);
    }
    const layerLabels: typeof labelCandidates = [];
    for (const bucket of byCentroid.values()) {
      bucket.sort((a, b) => b.areaMm2 - a.areaMm2);
      for (const cand of bucket.slice(0, LABEL_TOP_K)) {
        if (cand.areaMm2 >= SLIVER_ABS_MM2) layerLabels.push(cand);
      }
    }

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
    //
    //    Iterates `getPatternLayers(geometrySettings)` so each compound
    //    pattern layer (primary + any extras) paints its own tile footprints
    //    in its own color. Paint order matches z-order: layer 0 first, then
    //    1, 2, … so later layers visually overlap earlier ones — same as the
    //    3D viewer's mesh order.
    //
    //    Side-effect: every painted tile is recorded in `drawnTilesRef` so
    //    the click + hover handlers can resolve which tile the cursor is
    //    on without re-running `generateTilePositions`. Stored in paint
    //    order — last-painted = top-most = hit-tested first. `layerIdx`
    //    maps back to `getPatternLayers`'s index, which the click handler
    //    translates to either `removedTiles` (layer 0) or
    //    `extraLayers[layerIdx-1].removedTiles`.
    const drawnTiles: DrawnTile[] = [];
    const patternLayers = getPatternLayers(geometrySettings);
    const tileBounds = new THREE.Box2(
      new THREE.Vector2(outlinePolygon.minX, outlinePolygon.minY),
      new THREE.Vector2(outlinePolygon.maxX, outlinePolygon.maxY),
    );
    const outlineForBounds = outlinePolygonToShape(outlinePolygon);
    const outlinePoly = { outer: outlinePolygon.outer, holes: outlinePolygon.holes };
    const colorPolygons = layersInMm.map((l) => ({ centroidIndex: l.centroidIndex, polygon: l.polygon }));

    patternLayers.forEach((layer, layerIdx) => {
      const layerShape = layer.shapes?.[0];
      const footprint = patternFootprint2D(layerShape);
      if (!footprint || footprint.length < 3) return;

      const layerScale = layer.scale ?? 1;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [px, py] of footprint) {
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      const tileW = (maxX - minX) * layerScale;
      const tileH = (maxY - minY) * layerScale;
      if (tileW <= 0.05 || tileH <= 0.05) return;
      if (layerIdx === 0) tileRRef.current = Math.max(tileW, tileH, 1) * 0.75;

      const rawTiles = generateTilePositions(
        tileBounds, tileW, tileH, layer.tileSpacing,
        [outlineForBounds], layer.margin, false,
        layer.distribution,
        layer.orientation,
        layer.direction,
      );
      // Apply user-removed-tile filter PER LAYER before color assignment
      // so the displayed dots match what the 3D pipeline builds for this
      // specific layer.
      const tilesIn = filterRemovedTiles(
        rawTiles.filter((t) => pointInPolygon(t.position.x, t.position.y, outlinePoly)),
        layer.removedTiles,
      ).map((t) => ({ x: t.position.x, y: t.position.y, rotation: t.rotation, scale: t.scale ?? 1 }));

      const assignments: TileAssignment[] = assignTilesToColors(tilesIn, colorPolygons, stackOrder);
      const fallbackColor = layer.color;

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
        const sx = tile.scale * layerScale;
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

        // Record for click + hover hit-testing. `layerIdx` tracks the
        // index in the compound layer view so the click handler routes
        // the removal to the right `removedTiles` array.
        drawnTiles.push({
          layerIdx,
          key: tileKey(tile.x, tile.y),
          path,
          x: tile.x,
          y: tile.y,
          origin: 'grid',
        });
      }

      // Free-placed spikes for this layer — painted with the same footprint
      // so they read identically to grid spikes and are click-removable.
      // Intentionally drawn with no per-tile orientation rotation (unlike
      // grid tiles, which carry alternate/aligned/random rotation): a
      // hand-placed point has no orientation. This matches the 3D side,
      // where added spikes also use rotation 0.
      for (const sp of layer.addedSpikes ?? []) {
        const path = new Path2D();
        for (let i = 0; i < footprint.length; i++) {
          const [px, py] = footprint[i];
          const lx = px * layerScale;
          const ly = py * layerScale;
          const rx = lx + sp.x;
          const ry = ly + sp.y;
          if (i === 0) path.moveTo(wx(rx), wy(ry));
          else path.lineTo(wx(rx), wy(ry));
        }
        path.closePath();
        ctx.fillStyle = layer.color;
        ctx.fill(path);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = 0.6;
        ctx.stroke(path);
        drawnTiles.push({
          layerIdx,
          key: tileKey(sp.x, sp.y),
          path,
          x: sp.x,
          y: sp.y,
          origin: 'added',
        });
      }
    });
    drawnTilesRef.current = drawnTiles;

    // 3b. Hover outline for tile removal mode — drawn after the tile paint
    //     so it sits on top. signal-error red so the destructive intent
    //     reads instantly even on the busiest pattern.
    if (tileRemovalMode && hoverTileIdx !== null && drawnTiles[hoverTileIdx]) {
      const t = drawnTiles[hoverTileIdx];
      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ef4444';
      ctx.shadowColor = 'rgba(239, 68, 68, 0.65)';
      ctx.shadowBlur = 8;
      ctx.stroke(t.path);
      ctx.restore();
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

    // 5. Dimension lines — hover-only so the design reads cleanly at rest.
    //    Numbers are also surfaced in the bottom-left HTML chip whenever the
    //    outline changes, so this is purely visual reinforcement on hover.
    if (showDims) {
      drawDimensionLines(ctx, outlinePolygon, offsetX, offsetY, renderW, renderH, scale);
    }
  }, [outlinePolygon, layersInMm, palette, stackOrder, inlayItems, geometrySettings, baseColor, spikeColorMatch, showDims, tileRemovalMode, hoverTileIdx]);

  // Repaint when any draw input changes.
  useEffect(() => {
    draw();
  }, [draw]);

  // When the canvas is in empty-state mode, run a soft RAF loop so the
  // pulsing dashed border breathes. We tear it down the moment an outline
  // shows up — no idle work while a deck is loaded. Users with
  // prefers-reduced-motion get a single static paint instead of the
  // continuous pulse, since the pulsing is the entire motion.
  useEffect(() => {
    if (outlinePolygon && outlinePolygon.outer.length > 0) return;
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    if (reduceMotion) {
      draw();
      return;
    }
    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [outlinePolygon, draw]);

  // Publish the outline's pad dimensions to the HTML overlay chip. Kept in
  // sync with the same source the canvas draws from so the readout never
  // drifts from the rendered geometry.
  useEffect(() => {
    if (!outlinePolygon || outlinePolygon.outer.length === 0) {
      setPadDimsMm(null);
      return;
    }
    setPadDimsMm({
      w: outlinePolygon.maxX - outlinePolygon.minX,
      h: outlinePolygon.maxY - outlinePolygon.minY,
    });
  }, [outlinePolygon]);

  // Repaint when the container resizes (the draw call reads getBoundingClientRect).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  // Layer entries for the HTML legend overlay, in stack order so the rendered
  // list matches the printed top-down stack.
  const legendEntries = stackOrder
    .map((centroidIdx, displayIdx) => {
      const c = palette[centroidIdx];
      if (!c) return null;
      const hex = `#${c.r.toString(16).padStart(2, '0')}${c.g.toString(16).padStart(2, '0')}${c.b.toString(16).padStart(2, '0')}`;
      return { displayIdx, hex, rgb: `rgb(${c.r}, ${c.g}, ${c.b})` };
    })
    .filter((x): x is { displayIdx: number; hex: string; rgb: string } => x !== null);

  // Resolve which painted tile the cursor sits on. Iterates in reverse
  // so the most-recently-drawn (top-most) tile wins ties — same convention
  // a 3D raycaster would use. Returns -1 when no tile is under the cursor
  // (clicks here are no-ops; the user is in tile-removal mode but pointing
  // at empty pad / a color region / outside the canvas).
  const findTileAt = useCallback((evtX: number, evtY: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const tiles = drawnTilesRef.current;
    if (tiles.length === 0) return -1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return -1;
    // Canvas backing-store uses a DPR transform — `isPointInPath` accepts
    // user-space coords once we pre-divide by DPR. The transform set by
    // `draw()` is `setTransform(dpr, 0, 0, dpr, 0, 0)`, so a user-space hit
    // at (evtX, evtY) maps to the backing-store at (evtX*dpr, evtY*dpr).
    // `isPointInPath(path, x, y)` uses the *current transform*, so we pass
    // user-space coords directly — the same coords paths were built with.
    for (let i = tiles.length - 1; i >= 0; i--) {
      if (ctx.isPointInPath(tiles[i].path, evtX, evtY)) return i;
    }
    return -1;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!tileRemovalMode) {
      if (hoverTileIdx !== null) setHoverTileIdx(null);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const idx = findTileAt(x, y);
    if (idx !== hoverTileIdx) setHoverTileIdx(idx === -1 ? null : idx);
  }, [tileRemovalMode, hoverTileIdx, findTileAt]);

  // Invert wx/wy: canvas-relative px (CSS space, since draw() applies the DPR
  // transform) → world mm. Mirrors wx/wy captured during the last draw.
  const canvasToWorld = useCallback((cx: number, cy: number): { x: number; y: number } | null => {
    const m = worldToCanvasRef.current;
    if (!m) return null;
    return {
      x: m.minX + (cx - m.offsetX) / m.scale,
      y: m.maxY - (cy - m.offsetY) / m.scale,
    };
  }, []);

  const draggingRef = useRef(false);
  const draggedRef = useRef<Array<{ x: number; y: number }>>([]);

  const toggleAtClient = useCallback((clientX: number, clientY: number) => {
    if (!tileRemovalMode || !onGeometryChange) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const w = canvasToWorld(cx, cy);
    if (!w) return;
    const R = tileRRef.current;
    for (const d of draggedRef.current) {
      const dx = d.x - w.x, dy = d.y - w.y;
      if (dx * dx + dy * dy <= R * R) return;
    }
    draggedRef.current.push(w);
    // Use the exact Path2D hit-test for the remove-vs-add decision: if the
    // click lands inside a painted spike's footprint, that spike is the
    // target (removal), regardless of how far the click is from its centre
    // — an edge click still removes. Only a click on bare deck (no footprint
    // under it) falls through to a free add. The radius search inside
    // toggleSpikeAt is bypassed by feeding it just the hit tile (or none).
    const idx = findTileAt(cx, cy);
    const hit = idx >= 0 ? drawnTilesRef.current[idx] : null;
    const positions: SpikePosition[] = hit && hit.layerIdx === 0
      ? [{ x: hit.x, y: hit.y, origin: hit.origin }]
      : [];
    onGeometryChange((prev) => {
      const result = toggleSpikeAt(
        w.x, w.y, positions,
        prev.removedTiles ?? [], prev.addedSpikes ?? [],
        // Infinite radius when we have an exact hit (always remove it);
        // the empty-positions case adds regardless of radius.
        hit ? Number.POSITIVE_INFINITY : R,
      );
      return { ...prev, removedTiles: result.removedTiles, addedSpikes: result.addedSpikes };
    });
  }, [tileRemovalMode, onGeometryChange, canvasToWorld, findTileAt]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!tileRemovalMode) return;
    draggingRef.current = true;
    draggedRef.current = [];
    toggleAtClient(e.clientX, e.clientY);
  }, [tileRemovalMode, toggleAtClient]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) toggleAtClient(e.clientX, e.clientY);
  }, [toggleAtClient]);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
    draggedRef.current = [];
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 bg-slate-900"
      style={tileRemovalMode ? { cursor: 'crosshair' } : undefined}
      onMouseEnter={() => setShowDims(true)}
      onMouseLeave={() => { setShowDims(false); if (hoverTileIdx !== null) setHoverTileIdx(null); }}
      onMouseMove={handleMouseMove}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <canvas ref={canvasRef} className="block" />

      {/* HTML legend overlay — replaces the canvas-painted strip. Renders
          crisp text at any DPR and stays out of the canvas drawing budget. */}
      {legendEntries.length > 0 && (
        <div className="absolute top-3 right-3 z-10 px-3 py-2 bg-gray-900/70 backdrop-blur-sm border border-gray-700/60 rounded-md text-xs shadow-lg pointer-events-none select-none">
          <div className="text-[10px] uppercase tracking-wide font-medium text-gray-400 mb-1.5">Layers</div>
          <div className="flex flex-col gap-1">
            {legendEntries.map(({ displayIdx, hex, rgb }) => (
              <div key={displayIdx} className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-sm ring-1 ring-white/15" style={{ background: rgb }} />
                <span className="text-gray-300 font-mono text-[10px] w-6">L{displayIdx + 1}</span>
                <span className="text-gray-500 font-mono text-[10px]">{hex.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pad-dim chip — always visible so users know the canvas scale. The
          dimension *lines* are reserved for hover so the rest area stays clean. */}
      {padDimsMm && (
        <div className="absolute bottom-3 left-3 z-10 px-2.5 py-1 bg-gray-900/70 backdrop-blur-sm border border-gray-700/60 rounded-md text-[11px] font-mono text-gray-300 shadow-lg pointer-events-none select-none">
          <span className="text-gray-500">pad </span>
          <span className="text-gray-200">{padDimsMm.w.toFixed(1)}</span>
          <span className="text-gray-500"> × </span>
          <span className="text-gray-200">{padDimsMm.h.toFixed(1)}</span>
          <span className="text-gray-500"> mm</span>
        </div>
      )}
    </div>
  );
};

/** Hero empty state for the canvas — draws a ghost deck silhouette with a
 *  pulsing dashed border + brand-coloured callout. Reads as "your deck goes
 *  here", not "this app is broken". The silhouette is a stylized Pint-like
 *  outline so users get a hint of what the picker will fill in. */
/** Paint the static viewer backdrop (deep base + radial blooms + dot grid +
 *  corner brackets) once into an offscreen canvas keyed by [W, H, dpr].
 *  The caller blits this every draw, saving ~60% of empty-state CPU
 *  (those layers used to repaint every animation frame). */
function paintBackdrop(W: number, H: number, dpr: number): { canvas: HTMLCanvasElement; w: number; h: number; dpr: number } {
  const off = document.createElement('canvas');
  off.width = Math.round(W * dpr);
  off.height = Math.round(H * dpr);
  const ctx = off.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#07090c';
  ctx.fillRect(0, 0, W, H);

  const bloom1 = ctx.createRadialGradient(W * 0.18, H * 0.22, 0, W * 0.18, H * 0.22, Math.max(W, H) * 0.55);
  bloom1.addColorStop(0, 'rgba(255, 107, 26, 0.10)');
  bloom1.addColorStop(0.6, 'rgba(255, 107, 26, 0.025)');
  bloom1.addColorStop(1, 'rgba(255, 107, 26, 0)');
  ctx.fillStyle = bloom1;
  ctx.fillRect(0, 0, W, H);

  const bloom2 = ctx.createRadialGradient(W * 0.85, H * 0.85, 0, W * 0.85, H * 0.85, Math.max(W, H) * 0.55);
  bloom2.addColorStop(0, 'rgba(0, 212, 255, 0.06)');
  bloom2.addColorStop(0.6, 'rgba(0, 212, 255, 0.015)');
  bloom2.addColorStop(1, 'rgba(0, 212, 255, 0)');
  ctx.fillStyle = bloom2;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.12)';
  const gridStep = 40;
  for (let x = gridStep / 2; x < W; x += gridStep) {
    for (let y = gridStep / 2; y < H; y += gridStep) {
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
  for (let x = 0; x <= W; x += gridStep) {
    for (let y = 0; y <= H; y += gridStep) {
      ctx.fillRect(x - 0.5, y - 0.5, 2, 2);
    }
  }

  const bracketLen = 14;
  const bracketInset = 12;
  ctx.strokeStyle = 'rgba(255, 107, 26, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'square';
  ([[bracketInset, bracketInset, 1, 1], [W - bracketInset, bracketInset, -1, 1], [bracketInset, H - bracketInset, 1, -1], [W - bracketInset, H - bracketInset, -1, -1]] as const).forEach(([cx, cy, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy + sy * bracketLen);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + sx * bracketLen, cy);
    ctx.stroke();
  });

  return { canvas: off, w: W, h: H, dpr };
}

function drawEmptyState(ctx: CanvasRenderingContext2D, W: number, H: number, t = 0) {
  const cx = W / 2;
  const cy = H / 2;
  const w = Math.min(W * 0.42, 360);
  const h = w * 0.78;
  const r = w * 0.08;

  // Ghost outline path — rounded-rect with rider notches at the bottom.
  const path = new Path2D();
  const x0 = cx - w / 2, y0 = cy - h / 2;
  path.moveTo(x0 + r, y0);
  path.lineTo(x0 + w - r, y0);
  path.arcTo(x0 + w, y0, x0 + w, y0 + r, r);
  path.lineTo(x0 + w, y0 + h - r * 0.6);
  // Right notch
  path.lineTo(x0 + w - w * 0.05, y0 + h - r * 0.4);
  path.lineTo(x0 + w - w * 0.08, y0 + h);
  path.lineTo(x0 + w - w * 0.18, y0 + h);
  path.lineTo(x0 + w - w * 0.20, y0 + h - r * 0.4);
  path.lineTo(x0 + w * 0.20, y0 + h - r * 0.4);
  // Left notch
  path.lineTo(x0 + w * 0.18, y0 + h);
  path.lineTo(x0 + w * 0.08, y0 + h);
  path.lineTo(x0 + w * 0.05, y0 + h - r * 0.4);
  path.lineTo(x0, y0 + h - r * 0.6);
  path.lineTo(x0, y0 + r);
  path.arcTo(x0, y0, x0 + r, y0, r);
  path.closePath();

  // Soft inner fill
  ctx.fillStyle = 'rgba(255, 107, 26, 0.04)';
  ctx.fill(path);

  // Pulsing dashed border — `t` in ms drives a slow breathing alpha + a
  // dash offset for the "ant march" effect. Combined they make the empty
  // state feel alive without being noisy.
  const pulse = 0.45 + 0.30 * (0.5 + 0.5 * Math.sin(t / 900));
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.lineDashOffset = -(t / 30) % 14;
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(255, 107, 26, ${pulse.toFixed(3)})`;
  ctx.shadowColor = 'rgba(255, 107, 26, 0.5)';
  ctx.shadowBlur = 12 + 8 * (pulse - 0.45) / 0.30;
  ctx.stroke(path);
  ctx.restore();

  // Headline + subline
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f5f5f5';
  ctx.font = '600 22px "Space Grotesk", Inter, ui-sans-serif, system-ui';
  ctx.fillText('Pick your deck', cx, cy - 8);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
  ctx.font = '13px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText('XR · GT · Pint · Floatwheel — or upload your own DXF', cx, cy + 20);

  // Decorative chevron pointing toward the right-panel CTA
  ctx.fillStyle = 'rgba(255, 107, 26, 0.85)';
  ctx.font = '700 14px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText('→ start in the Base tab', cx, cy + 46);
}

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
