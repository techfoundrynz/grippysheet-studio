import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  shapeToPolygon,
  type OutlinePolygon,
} from './outlineToPolygon';
import { generateTilePositions } from '../utils/patternUtils';
import { pointInPolygon, assignTilesToColors, type TileAssignment } from './spikes';
import type { Centroid } from './pipeline/quantize';
import type { TracedLayerEntry } from './workerProtocol';
import type { GeometrySettings } from '../types/schemas';

interface Props {
  outlinePolygon: OutlinePolygon | null;
  layersInMm: TracedLayerEntry[];
  palette: Centroid[];
  stackOrder: number[];
  geometrySettings: GeometrySettings;
  /** Base outline fill color (from baseSettings). */
  baseColor: string;
  /** True = tint tile dots to the color underneath; false = pattern color. */
  spikeColorMatch: boolean;
}

const PAD_PX = 40; // canvas inset
const TILE_DOT_RATIO = 0.45; // dot diameter relative to tile cell

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
  outlinePolygon, layersInMm, palette, stackOrder,
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
    for (const entry of sortedLayers) {
      const c = palette[entry.centroidIndex];
      if (!c) continue;
      const path = new Path2D();
      pathRing(path, entry.polygon.outer);
      for (const hole of entry.polygon.holes) pathRing(path, hole);
      ctx.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
      ctx.fill(path, 'evenodd');
    }

    // 3. Spike tile dots — only if a pattern shape exists.
    const patternShape = geometrySettings.patternShapes?.[0];
    if (patternShape && palette.length > 0) {
      const patternScale = geometrySettings.patternScale ?? 1;
      let tileW = 0, tileH = 0;
      if (patternShape instanceof THREE.Shape) {
        const tp = shapeToPolygon(patternShape, 32);
        tileW = (tp.maxX - tp.minX) * patternScale;
        tileH = (tp.maxY - tp.minY) * patternScale;
      } else if (patternShape instanceof THREE.BufferGeometry) {
        if (!patternShape.boundingBox) patternShape.computeBoundingBox();
        const bb = patternShape.boundingBox!;
        tileW = (bb.max.x - bb.min.x) * patternScale;
        tileH = (bb.max.y - bb.min.y) * patternScale;
      }
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

        // Single radius based on tile cell size + spacing.
        const tileCellPx = Math.max(2, Math.min(tileW, tileH) * scale * TILE_DOT_RATIO);
        const fallbackColor = geometrySettings.patternColor;

        for (const tile of assignments) {
          const cx = wx(tile.x);
          const cy = wy(tile.y);
          let fill = fallbackColor;
          if (spikeColorMatch && tile.colorIndex >= 0) {
            const c = palette[tile.colorIndex];
            if (c) {
              // Slightly darken color so dots read distinctly against region fill.
              fill = `rgb(${Math.max(0, c.r - 35)}, ${Math.max(0, c.g - 35)}, ${Math.max(0, c.b - 35)})`;
            }
          }
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.arc(cx, cy, tileCellPx / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 4. Dimension lines + size labels
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
