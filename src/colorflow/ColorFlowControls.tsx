import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { type BaseSettings } from '../types/schemas';
import { type ColorFlowSettings } from './schema';
import { OUTLINE_LIBRARY, getOutlineBySlug } from './outlineLibrary';
import { parseShapeFile } from '../utils/shapeLoader';
import { useColorFlowWorker } from './useColorFlowWorker';
import {
  shapeToPolygon,
  outlineCanvasSize,
  buildOutlineCanvasMask,
  pixelToMmOnOutlineCanvas,
  CANVAS_PX_PER_MM,
  type OutlinePolygon,
} from './outlineToPolygon';
import { computeImageDrawCoords } from './imageTransform';
import { paletteCoverage, type Centroid } from './pipeline/quantize';
import { resolvedStackOrder } from './stackOrder';
import type { ExtrudedGeometry } from './pipeline/extrude';
import type { Response as WorkerResponse, TracedLayerEntry, ExtrudedLayerEntry } from './workerProtocol';
import { useAlert } from '../context/AlertContext';

interface Props {
  baseSettings: BaseSettings;
  setBaseSettings: React.Dispatch<React.SetStateAction<BaseSettings>>;
  settings: ColorFlowSettings;
  setSettings: React.Dispatch<React.SetStateAction<ColorFlowSettings>>;
  onGeometryReady?: (data: { base: ExtrudedGeometry; layers: { centroid: Centroid; position: number; geom: ExtrudedGeometry }[] }) => void;
  onImageAssetChanged?: (asset: { name: string; bytes: ArrayBuffer } | null) => void;
  initialImageAsset?: { name: string; bytes: ArrayBuffer } | null;
}

const SIMPLIFY_LABELS = ['off', 'light', 'medium', 'strong', 'max'] as const;
const DETAIL_LABELS = ['sharp', 'balanced', 'smooth'] as const;
const MAX_IMG_DIM = 1500;

export const ColorFlowControls: React.FC<Props> = ({ baseSettings, setBaseSettings, settings, setSettings, onGeometryReady, onImageAssetChanged, initialImageAsset }) => {
  const { request, status } = useColorFlowWorker();
  const { showAlert } = useAlert();

  const [imageBitmap, setImageBitmap] = useState<ImageBitmap | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null);

  // --- Hydrate saved image from imported project bundle ---
  useEffect(() => {
    if (!initialImageAsset) return;
    let cancelled = false;
    (async () => {
      try {
        const blob = new Blob([initialImageAsset.bytes]);
        const bitmap = await createImageBitmap(blob);
        if (cancelled) return;
        setImageBitmap(bitmap);
        setImageName(initialImageAsset.name);
        setImageDims({ w: bitmap.width, h: bitmap.height });
      } catch (err) {
        showAlert({ title: 'Failed to load saved image', message: String(err), type: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [initialImageAsset, showAlert]);

  const [palette, setPalette] = useState<Centroid[]>([]);
  const [assignments, setAssignments] = useState<Uint16Array | null>(null);
  const [layers, setLayers] = useState<TracedLayerEntry[]>([]);
  const [coverage, setCoverage] = useState<number[]>([]);

  const outlinePolygon = useMemo<OutlinePolygon | null>(() => {
    const shape = baseSettings.cutoutShapes?.[0];
    return shape ? shapeToPolygon(shape, 64) : null;
  }, [baseSettings.cutoutShapes]);

  const hasOutline = outlinePolygon !== null;
  const hasImage = imageBitmap !== null;

  // --- Outline picker handlers ---
  const handlePickPreset = useCallback(async (slug: string) => {
    const entry = getOutlineBySlug(slug);
    if (!entry) return;
    try {
      const res = await fetch(entry.file);
      const text = await res.text();
      const parsed = parseShapeFile(text, 'dxf');
      if (!parsed.success) throw new Error(parsed.error);
      setBaseSettings((b) => ({ ...b, cutoutShapes: parsed.shapes as unknown as THREE.Shape[] }));
      setSettings((s) => ({ ...s, outlineSlug: slug }));
    } catch (err) {
      showAlert({ title: 'Failed to load outline', message: String(err), type: 'error' });
    }
  }, [setBaseSettings, setSettings, showAlert]);

  // --- Image drop handler ---
  const handleImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showAlert({ title: 'Not an image', message: 'Drop a PNG, JPG, or WebP file.', type: 'error' });
      return;
    }
    setImageName(file.name);
    // Capture raw bytes for project bundling before creating the bitmap.
    const bytes = await file.arrayBuffer();
    onImageAssetChanged?.({ name: file.name, bytes });
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    if (Math.max(width, height) > MAX_IMG_DIM) {
      const scale = MAX_IMG_DIM / Math.max(width, height);
      const downsized = await createImageBitmap(bitmap, { resizeWidth: Math.round(width * scale), resizeHeight: Math.round(height * scale) });
      width = downsized.width;
      height = downsized.height;
      setImageBitmap(downsized);
      bitmap.close();
    } else {
      setImageBitmap(bitmap);
    }
    setImageDims({ w: width, h: height });
  }, [showAlert, onImageAssetChanged]);

  // --- Quantize whenever inputs change ---
  useEffect(() => {
    if (!hasImage || !hasOutline || !imageBitmap || !outlinePolygon) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const canvas = outlineCanvasSize(outlinePolygon);
        // Render the source image onto an OffscreenCanvas at outline-canvas dims,
        // applying fit + user scale + user offset, then ship as ImageBitmap to the worker.
        const off = new OffscreenCanvas(canvas.w, canvas.h);
        const ctx = off.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.w, canvas.h);
        const { dx, dy, w, h } = computeImageDrawCoords({
          imageW: imageBitmap.width,
          imageH: imageBitmap.height,
          canvasW: canvas.w,
          canvasH: canvas.h,
          offsetMm: settings.imageOffsetMm,
          scale: settings.imageScale,
          pxPerMm: CANVAS_PX_PER_MM,
        });
        ctx.drawImage(imageBitmap, dx, dy, w, h);
        const rendered = off.transferToImageBitmap();
        const mask = buildOutlineCanvasMask(outlinePolygon, canvas);

        const resp = await request<Extract<WorkerResponse, { kind: 'quantized' }>>({
          kind: 'quantize',
          image: rendered,
          mask,
          width: canvas.w,
          height: canvas.h,
          opts: { colorCount: settings.colorCount, simplify: settings.simplify, seed: 42 },
        });
        if (cancelled || resp.kind !== 'quantized') return;
        setPalette(resp.palette);
        setAssignments(resp.assignments);
        setCoverage(paletteCoverage(resp.assignments, resp.palette));
      } catch (err) {
        showAlert({ title: 'Quantization failed', message: String(err), type: 'error' });
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [hasImage, hasOutline, imageBitmap, outlinePolygon, settings.colorCount, settings.simplify, settings.imageOffsetMm, settings.imageScale, request, showAlert]);

  // --- Trace whenever assignments / detail / smooth change ---
  useEffect(() => {
    if (!assignments || !palette.length || !outlinePolygon) return;
    let cancelled = false;
    const canvas = outlineCanvasSize(outlinePolygon);
    (async () => {
      try {
        const resp = await request<Extract<WorkerResponse, { kind: 'traced' }>>({
          kind: 'trace',
          assignments,
          palette,
          width: canvas.w,
          height: canvas.h,
          opts: { detail: settings.detail, smooth: settings.smooth },
        });
        if (cancelled || resp.kind !== 'traced') return;
        setLayers(resp.layers);
      } catch (err) {
        showAlert({ title: 'Tracing failed', message: String(err), type: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [assignments, palette, outlinePolygon, settings.detail, settings.smooth, request, showAlert]);

  // --- Extrude whenever layers / thickness change ---
  useEffect(() => {
    if (!layers.length || !outlinePolygon || !palette.length) return;
    let cancelled = false;
    (async () => {
      try {
        const canvas = outlineCanvasSize(outlinePolygon);
        // Map pixel-space traced polygons back into outline-mm space.
        const mapRing = (pts: Array<[number, number]>): Array<[number, number]> => {
          const out = pts.map(([px, py]) => pixelToMmOnOutlineCanvas(px, py, outlinePolygon, canvas));
          out.reverse(); // Y-flip reverses orientation; restore CCW winding
          return out;
        };

        const layersInMm: TracedLayerEntry[] = layers.map((entry) => ({
          centroidIndex: entry.centroidIndex,
          polygon: {
            outer: mapRing(entry.polygon.outer),
            holes: entry.polygon.holes.map(mapRing),
          },
        }));
        const outlineInMm = {
          outer: outlinePolygon.outer.map(([x, y]) => [x, y] as [number, number]),
          holes: outlinePolygon.holes.map((h) => h.map(([x, y]) => [x, y] as [number, number])),
        };

        const stackOrder = resolvedStackOrder(palette, coverage, settings);

        const resp = await request<Extract<WorkerResponse, { kind: 'extruded' }>>({
          kind: 'extrude',
          layers: layersInMm,
          outline: outlineInMm,
          baseMm: settings.baseMm,
          colorLayerMm: settings.colorLayerMm,
          stackOrder,
        });
        if (cancelled || resp.kind !== 'extruded') return;
        if (onGeometryReady) {
          const pairs = resp.layerGeoms.map((entry: ExtrudedLayerEntry) => ({
            centroid: palette[entry.centroidIndex],
            position: entry.position,
            geom: entry.geom,
          }));
          onGeometryReady({ base: resp.baseGeom, layers: pairs });
        }
      } catch (err) {
        showAlert({ title: 'Extrusion failed', message: String(err), type: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [layers, outlinePolygon, palette, coverage, settings.baseMm, settings.colorLayerMm, settings.sort, settings.layerOrder, request, onGeometryReady, showAlert]);

  // --- Render ---
  const _dropRef = useRef<HTMLDivElement>(null);

  return (
    <div className="space-y-6">
        <section>
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">① Outline</h3>
          <select
            value={settings.outlineSlug ?? ''}
            onChange={(e) => handlePickPreset(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
          >
            <option value="">— pick an outline —</option>
            {(['xr','gt','pint','other'] as const).map((g) => (
              <optgroup key={g} label={g.toUpperCase()}>
                {OUTLINE_LIBRARY.filter((o) => o.group === g).map((o) => (
                  <option key={o.slug} value={o.slug}>{o.name} · {o.widthMm}×{o.heightMm}mm</option>
                ))}
              </optgroup>
            ))}
          </select>
          {hasOutline && <p className="text-xs text-green-400 mt-2">✓ outline loaded</p>}
        </section>

        <section className={hasOutline ? '' : 'opacity-40 pointer-events-none'}>
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">② Image</h3>
          <div
            ref={_dropRef}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleImageFile(f); };
              input.click();
            }}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImageFile(f); }}
            className="border-2 border-dashed border-gray-700 rounded p-6 text-center text-gray-400 text-sm cursor-pointer hover:border-blue-500 hover:bg-gray-900/50"
          >
            {hasImage
              ? <span className="text-green-400">✓ {imageName} · {imageDims?.w}×{imageDims?.h}</span>
              : <span>drag image / click to browse</span>}
          </div>
          {hasImage && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-400">
              <label>x mm
                <input
                  type="number"
                  step={1}
                  min={-200}
                  max={200}
                  value={settings.imageOffsetMm.x}
                  onChange={(e) => {
                    const v = Math.max(-200, Math.min(200, +e.target.value || 0));
                    setSettings((s) => ({ ...s, imageOffsetMm: { ...s.imageOffsetMm, x: v } }));
                  }}
                  className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1"
                />
              </label>
              <label>y mm
                <input
                  type="number"
                  step={1}
                  min={-200}
                  max={200}
                  value={settings.imageOffsetMm.y}
                  onChange={(e) => {
                    const v = Math.max(-200, Math.min(200, +e.target.value || 0));
                    setSettings((s) => ({ ...s, imageOffsetMm: { ...s.imageOffsetMm, y: v } }));
                  }}
                  className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1"
                />
              </label>
              <label>scale
                <input
                  type="number"
                  step={0.05}
                  min={0.2}
                  max={3}
                  value={settings.imageScale}
                  onChange={(e) => {
                    const v = Math.max(0.2, Math.min(3, +e.target.value || 1));
                    setSettings((s) => ({ ...s, imageScale: v }));
                  }}
                  className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1"
                />
              </label>
              <button
                type="button"
                onClick={() => setSettings((s) => ({ ...s, imageOffsetMm: { x: 0, y: 0 }, imageScale: 1.0 }))}
                className="col-span-3 mt-1 text-[10px] text-blue-400 hover:underline text-left"
              >
                Reset to fit-centered
              </button>
            </div>
          )}
        </section>

        <section className={hasImage ? '' : 'opacity-40 pointer-events-none'}>
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">③ Colors</h3>
          <div className="space-y-3">
            <label className="block text-xs text-gray-400">
              colors <span className="text-purple-400 font-mono">{settings.colorCount}</span>
              <input type="range" min={2} max={10} value={settings.colorCount}
                onChange={(e) => setSettings((s) => ({ ...s, colorCount: +e.target.value }))}
                className="w-full mt-1" />
            </label>
            <label className="block text-xs text-gray-400">
              simplify <span className="text-purple-400 font-mono">{SIMPLIFY_LABELS[settings.simplify]}</span>
              <input type="range" min={0} max={4} value={settings.simplify}
                onChange={(e) => setSettings((s) => ({ ...s, simplify: +e.target.value }))}
                className="w-full mt-1" />
            </label>
            <label className="block text-xs text-gray-400">
              trace detail <span className="text-purple-400 font-mono">{DETAIL_LABELS[settings.detail]}</span>
              <input type="range" min={0} max={2} value={settings.detail}
                onChange={(e) => setSettings((s) => ({ ...s, detail: +e.target.value }))}
                className="w-full mt-1" />
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input type="checkbox" checked={settings.smooth}
                onChange={(e) => setSettings((s) => ({ ...s, smooth: e.target.checked }))} />
              smoothing
            </label>
          </div>
        </section>

        <section className={layers.length > 0 ? '' : 'opacity-40 pointer-events-none'}>
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">④ Print</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
            <label>total mm
              <input type="number" step={0.1} min={0.4} max={10} value={settings.totalMm}
                onChange={(e) => {
                  const v = Math.max(0.4, Math.min(10, +e.target.value));
                  setSettings((s) => ({ ...s, totalMm: v, baseMm: Math.min(s.baseMm, v - 0.1) }));
                }}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1" />
            </label>
            <label>base mm
              <input type="number" step={0.1} min={0.2} max={5} value={settings.baseMm}
                onChange={(e) => {
                  const v = Math.max(0.2, Math.min(5, +e.target.value));
                  setSettings((s) => ({ ...s, baseMm: Math.min(v, s.totalMm - 0.1) }));
                }}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1" />
            </label>
          </div>
        </section>

        <section className={layers.length > 0 ? '' : 'opacity-40 pointer-events-none'}>
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">⑤ Export</h3>
          <p className="text-xs text-gray-400">
            Use <span className="text-blue-400 font-bold">Export 3MF</span> in the footer below to download the multi-part Bambu assembly.
          </p>
        </section>

        <div className="text-xs text-gray-500 min-h-[20px]">
          {status.phase && <span>working: {status.phase}</span>}
          {status.error && <span className="text-red-400">error: {status.error}</span>}
          {!status.phase && !status.error && palette.length > 0 && <span>ready · {palette.length} colors traced</span>}
        </div>


    </div>
  );
};
