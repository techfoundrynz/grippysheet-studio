import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { type BaseSettings } from '../types/schemas';
import { type ColorFlowSettings } from './schema';
import { OUTLINE_LIBRARY, getOutlineBySlug } from './outlineLibrary';
import { parseShapeFile } from '../utils/shapeLoader';
import { useColorFlowWorker } from './useColorFlowWorker';
import { shapeToPolygon, fitOutlineInImage, buildOutlineMask, type OutlinePolygon } from './outlineToPolygon';
import type { Centroid } from './pipeline/quantize';
import type { ExtrudedGeometry } from './pipeline/extrude';
import type { Response as WorkerResponse, TracedLayerEntry } from './workerProtocol';
import { build3MF } from './threeMfWriter';
import { useAlert } from '../context/AlertContext';

interface Props {
  baseSettings: BaseSettings;
  setBaseSettings: React.Dispatch<React.SetStateAction<BaseSettings>>;
  settings: ColorFlowSettings;
  setSettings: React.Dispatch<React.SetStateAction<ColorFlowSettings>>;
  /** Called when extrusion completes so the 3D viewer can render the result. */
  onGeometryReady?: (data: { base: ExtrudedGeometry; layers: { centroid: Centroid; geom: ExtrudedGeometry }[] }) => void;
  /** Called when the user loads or clears an image, so the parent can keep raw bytes for project bundling. */
  onImageAssetChanged?: (asset: { name: string; bytes: ArrayBuffer } | null) => void;
  /** Hydrate a saved image asset from an imported project bundle. */
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
    if (!hasImage || !hasOutline || !imageBitmap || !imageDims || !outlinePolygon) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const placement = fitOutlineInImage(outlinePolygon, imageDims.w, imageDims.h);
        const mask = buildOutlineMask(outlinePolygon, placement, imageDims.w, imageDims.h);
        const resp = await request<Extract<WorkerResponse, { kind: 'quantized' }>>({
          kind: 'quantize',
          image: imageBitmap,
          mask,
          width: imageDims.w,
          height: imageDims.h,
          opts: { colorCount: settings.colorCount, simplify: settings.simplify, seed: 42 },
        });
        if (cancelled || resp.kind !== 'quantized') return;
        setPalette(resp.palette);
        setAssignments(resp.assignments);
        setSettings((s) => {
          if (s.colorLayerHeights.length === resp.palette.length) return s;
          const each = (s.totalMm - s.baseMm) / resp.palette.length;
          return { ...s, colorLayerHeights: new Array(resp.palette.length).fill(+each.toFixed(2)) };
        });
      } catch (err) {
        showAlert({ title: 'Quantization failed', message: String(err), type: 'error' });
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [hasImage, hasOutline, imageBitmap, imageDims, outlinePolygon, settings.colorCount, settings.simplify, request, showAlert]);

  // --- Trace whenever assignments / detail / smooth change ---
  useEffect(() => {
    if (!assignments || !palette.length || !imageDims) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await request<Extract<WorkerResponse, { kind: 'traced' }>>({
          kind: 'trace',
          assignments,
          palette,
          width: imageDims.w,
          height: imageDims.h,
          opts: { detail: settings.detail, smooth: settings.smooth },
        });
        if (cancelled || resp.kind !== 'traced') return;
        setLayers(resp.layers);
      } catch (err) {
        showAlert({ title: 'Tracing failed', message: String(err), type: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [assignments, palette, imageDims, settings.detail, settings.smooth, request, showAlert]);

  // --- Extrude whenever layers / thickness change ---
  useEffect(() => {
    if (!layers.length || !outlinePolygon || !imageDims) return;
    let cancelled = false;
    (async () => {
      try {
        // Convert pixel-space polygon coords back to mm-space for the 3D model.
        const placement = fitOutlineInImage(outlinePolygon, imageDims.w, imageDims.h);
        const flipAndReverse = (pts: Array<[number, number]>): Array<[number, number]> => {
          const flipped = pts.map(([x, y]) => [
            (x - placement.offsetX) / placement.scale + outlinePolygon.minX,
            outlinePolygon.maxY - (y - placement.offsetY) / placement.scale,
          ] as [number, number]);
          flipped.reverse();
          return flipped;
        };

        const layersInMm: TracedLayerEntry[] = layers.map((entry) => ({
          centroidIndex: entry.centroidIndex,
          polygon: {
            outer: flipAndReverse(entry.polygon.outer),
            holes: entry.polygon.holes.map(flipAndReverse),
          },
        }));
        const outlineInMm = {
          outer: outlinePolygon.outer.map(([x, y]) => [x, y] as [number, number]),
          holes: outlinePolygon.holes.map((h) => h.map(([x, y]) => [x, y] as [number, number])),
        };
        const resp = await request<Extract<WorkerResponse, { kind: 'extruded' }>>({
          kind: 'extrude',
          layers: layersInMm,
          outline: outlineInMm,
          baseMm: settings.baseMm,
          totalMm: settings.totalMm,
          colorLayerHeights: settings.colorLayerHeights,
        });
        if (cancelled || resp.kind !== 'extruded') return;
        if (onGeometryReady) {
          const pairs = resp.layerGeoms.map(({ centroidIndex, geom }: { centroidIndex: number; geom: ExtrudedGeometry }) => ({
            centroid: palette[centroidIndex],
            geom,
          }));
          onGeometryReady({ base: resp.baseGeom, layers: pairs });
        }
      } catch (err) {
        showAlert({ title: 'Extrusion failed', message: String(err), type: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [layers, outlinePolygon, imageDims, settings.baseMm, settings.totalMm, settings.colorLayerHeights, request, palette, onGeometryReady, showAlert]);

  // --- 3MF export ---
  const handleExport3MF = useCallback(async () => {
    if (!layers.length || !outlinePolygon || !imageDims) return;
    try {
      const placement = fitOutlineInImage(outlinePolygon, imageDims.w, imageDims.h);
      const flipAndReverse = (pts: Array<[number, number]>): Array<[number, number]> => {
        const flipped = pts.map(([x, y]) => [
          (x - placement.offsetX) / placement.scale + outlinePolygon.minX,
          outlinePolygon.maxY - (y - placement.offsetY) / placement.scale,
        ] as [number, number]);
        flipped.reverse();
        return flipped;
      };

      const layersInMm: TracedLayerEntry[] = layers.map((entry) => ({
        centroidIndex: entry.centroidIndex,
        polygon: {
          outer: flipAndReverse(entry.polygon.outer),
          holes: entry.polygon.holes.map(flipAndReverse),
        },
      }));
      const outlineInMm = {
        outer: outlinePolygon.outer.map(([x, y]) => [x, y] as [number, number]),
        holes: outlinePolygon.holes.map((h) => h.map(([x, y]) => [x, y] as [number, number])),
      };
      const resp = await request<Extract<WorkerResponse, { kind: 'extruded' }>>({
        kind: 'extrude', layers: layersInMm, outline: outlineInMm,
        baseMm: settings.baseMm, totalMm: settings.totalMm,
        colorLayerHeights: settings.colorLayerHeights,
      });
      const parts = [{ name: 'base', mesh: resp.baseGeom }];
      resp.layerGeoms.forEach(({ centroidIndex, geom }: { centroidIndex: number; geom: ExtrudedGeometry }, i: number) => {
        const c = palette[centroidIndex];
        const hex = c ? `${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}` : 'unk';
        parts.push({ name: `color_${i + 1}_${hex}`, mesh: geom });
      });
      const blob = await build3MF(parts, 'footpad_assembly');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(imageName || 'design').replace(/\.[^.]+$/, '')}_${settings.outlineSlug || 'outline'}.3mf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      showAlert({ title: '3MF export failed', message: String(err), type: 'error' });
    }
  }, [layers, outlinePolygon, imageDims, settings, palette, imageName, request, showAlert]);

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
          <button
            onClick={handleExport3MF}
            className="w-full bg-gradient-to-r from-purple-500 to-cyan-500 text-white py-3 rounded font-bold hover:brightness-110 disabled:opacity-50"
            disabled={layers.length === 0}
          >
            ⬇ Export 3MF (Bambu)
          </button>
        </section>

        <div className="text-xs text-gray-500 min-h-[20px]">
          {status.phase && <span>working: {status.phase}</span>}
          {status.error && <span className="text-red-400">error: {status.error}</span>}
          {!status.phase && !status.error && palette.length > 0 && <span>ready · {palette.length} colors traced</span>}
        </div>

        {palette.length > 0 && (
          <section>
            <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">Color Layers (Z-stacked)</h3>
            <p className="text-[10px] text-gray-500 mb-2">
              Layer 1 sits directly on the base; later layers stack on top.
              Sum of heights {settings.colorLayerHeights.reduce((s, h) => s + h, 0).toFixed(2)}mm
              / max {(settings.totalMm - settings.baseMm).toFixed(2)}mm.
            </p>
            <div className="space-y-2">
              {palette.map((c, i) => {
                const hex = `#${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`;
                const height = settings.colorLayerHeights[i] ?? 0;
                return (
                  <div key={c.index} className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded p-2 text-xs">
                    <div className="w-6 h-6 rounded flex-shrink-0" style={{ background: hex }} />
                    <div className="font-mono text-gray-300 w-20">{hex.toUpperCase()}</div>
                    <div className="text-gray-500 text-[10px] flex-1">layer {i + 1}</div>
                    <input
                      type="number"
                      step={0.05}
                      min={0.05}
                      max={settings.totalMm - settings.baseMm}
                      value={height}
                      onChange={(e) => {
                        const v = Math.max(0.05, +e.target.value);
                        setSettings((s) => {
                          const next = [...s.colorLayerHeights];
                          while (next.length < palette.length) next.push(0);
                          next[i] = v;
                          return { ...s, colorLayerHeights: next };
                        });
                      }}
                      className="w-16 bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-center"
                    />
                    <span className="text-gray-500">mm</span>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => {
                const each = (settings.totalMm - settings.baseMm) / palette.length;
                setSettings((s) => ({ ...s, colorLayerHeights: new Array(palette.length).fill(+each.toFixed(2)) }));
              }}
              className="mt-2 text-[10px] text-blue-400 hover:underline"
            >
              Reset to equal heights
            </button>
          </section>
        )}

    </div>
  );
};
