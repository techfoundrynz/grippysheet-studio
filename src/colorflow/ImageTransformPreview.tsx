import React, { useEffect, useRef } from 'react';
import { CANVAS_PX_PER_MM, outlineCanvasSize, type OutlinePolygon } from './outlineToPolygon';
import { computeImageDrawCoords } from './imageTransform';

interface Props {
  imageBitmap: ImageBitmap | null;
  outline: OutlinePolygon | null;
  offsetMm: { x: number; y: number };
  scale: number;
  onCommit: (offsetMm: { x: number; y: number }, scale: number) => void;
  /** CSS width of the preview area in pixels. */
  cssWidth?: number;
}

function drawPreview(
  canvas: HTMLCanvasElement,
  imageBitmap: ImageBitmap,
  outline: OutlinePolygon,
  offsetMm: { x: number; y: number },
  scale: number,
) {
  const size = outlineCanvasSize(outline);
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, size.w, size.h);
  const { dx, dy, w, h } = computeImageDrawCoords({
    imageW: imageBitmap.width,
    imageH: imageBitmap.height,
    canvasW: size.w,
    canvasH: size.h,
    offsetMm,
    scale,
    pxPerMm: CANVAS_PX_PER_MM,
  });
  ctx.drawImage(imageBitmap, dx, dy, w, h);

  // Outline overlay (dashed amber, like the original colorflow.html)
  const wMm = outline.maxX - outline.minX;
  const hMm = outline.maxY - outline.minY;
  const sx = size.w / wMm;
  const sy = size.h / hMm;
  ctx.save();
  ctx.translate(-outline.minX * sx, -outline.minY * sy);
  ctx.scale(sx, sy);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.5 / Math.min(sx, sy);
  ctx.setLineDash([4 / Math.min(sx, sy), 3 / Math.min(sx, sy)]);
  ctx.beginPath();
  const [ox, oy] = outline.outer[0];
  ctx.moveTo(ox, oy);
  for (let i = 1; i < outline.outer.length; i++) ctx.lineTo(outline.outer[i][0], outline.outer[i][1]);
  ctx.closePath();
  ctx.stroke();
  for (const hole of outline.holes) {
    if (hole.length < 3) continue;
    ctx.beginPath();
    const [hx, hy] = hole[0];
    ctx.moveTo(hx, hy);
    for (let i = 1; i < hole.length; i++) ctx.lineTo(hole[i][0], hole[i][1]);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

export const ImageTransformPreview: React.FC<Props> = ({ imageBitmap, outline, offsetMm, scale, onCommit, cssWidth = 280 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<{ offsetMm: { x: number; y: number }; scale: number }>({ offsetMm, scale });
  previewRef.current = { offsetMm, scale };
  const draggingRef = useRef<null | { startMouseX: number; startMouseY: number; startOffsetMm: { x: number; y: number } }>(null);
  const wheelTimer = useRef<number | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const outlineRef = useRef(outline);
  outlineRef.current = outline;
  const imageBitmapRef = useRef(imageBitmap);
  imageBitmapRef.current = imageBitmap;

  // Initial + commit-driven draw
  useEffect(() => {
    if (canvasRef.current && imageBitmap && outline) {
      drawPreview(canvasRef.current, imageBitmap, outline, offsetMm, scale);
    }
  }, [imageBitmap, outline, offsetMm, scale]);

  // Native non-passive wheel listener so preventDefault() works (React's
  // delegated onWheel is still effectively passive in some browsers/versions).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!imageBitmapRef.current || !outlineRef.current) return;
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1.06 : 0.94;
      const nextScale = Math.max(0.2, Math.min(3, previewRef.current.scale * dir));
      previewRef.current = { ...previewRef.current, scale: nextScale };
      if (canvasRef.current) {
        drawPreview(canvasRef.current, imageBitmapRef.current, outlineRef.current, previewRef.current.offsetMm, nextScale);
      }
      if (wheelTimer.current) window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(() => {
        onCommitRef.current(previewRef.current.offsetMm, previewRef.current.scale);
      }, 200);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  if (!imageBitmap || !outline) return null;
  const cssHeight = Math.round(cssWidth * (outline.maxY - outline.minY) / (outline.maxX - outline.minX));

  return (
    <canvas
      ref={canvasRef}
      style={{ width: cssWidth, height: cssHeight, cursor: draggingRef.current ? 'grabbing' : 'grab' }}
      className="mt-2 border border-gray-700 rounded bg-gray-900 block"
      onMouseDown={(e) => {
        draggingRef.current = {
          startMouseX: e.clientX,
          startMouseY: e.clientY,
          startOffsetMm: { ...previewRef.current.offsetMm },
        };
        e.preventDefault();
      }}
      onMouseMove={(e) => {
        const d = draggingRef.current;
        if (!d) return;
        const cssW = canvasRef.current!.clientWidth;
        const wMm = outline.maxX - outline.minX;
        const mmPerCssPx = wMm / cssW;
        const dxPx = e.clientX - d.startMouseX;
        const dyPx = e.clientY - d.startMouseY;
        const next = {
          x: Math.max(-200, Math.min(200, Math.round(d.startOffsetMm.x + dxPx * mmPerCssPx))),
          y: Math.max(-200, Math.min(200, Math.round(d.startOffsetMm.y + dyPx * mmPerCssPx))),
        };
        previewRef.current = { ...previewRef.current, offsetMm: next };
        if (canvasRef.current) drawPreview(canvasRef.current, imageBitmap, outline, next, previewRef.current.scale);
      }}
      onMouseUp={() => {
        if (!draggingRef.current) return;
        draggingRef.current = null;
        onCommit(previewRef.current.offsetMm, previewRef.current.scale);
      }}
      onMouseLeave={() => {
        if (!draggingRef.current) return;
        draggingRef.current = null;
        onCommit(previewRef.current.offsetMm, previewRef.current.scale);
      }}
    />
  );
};
