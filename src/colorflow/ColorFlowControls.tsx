import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { type BaseSettings } from '../types/schemas';
import { type ColorFlowSettings } from './schema';
import { OUTLINE_LIBRARY, getOutlineBySlug } from './outlineLibrary';
import { parseShapeFile } from '../utils/shapeLoader';
import { useColorFlowWorker } from './useColorFlowWorker';
import { shapeToPolygon, fitOutlineInImage, buildOutlineMask, type OutlinePolygon } from './outlineToPolygon';
import type { Centroid } from './pipeline/quantize';
import type { LayerPolygon } from './pipeline/polygonize';
import type { ExtrudedGeometry } from './pipeline/extrude';
import { build3MF } from './threeMfWriter';
import { useAlert } from '../context/AlertContext';

interface Props {
  baseSettings: BaseSettings;
  setBaseSettings: React.Dispatch<React.SetStateAction<BaseSettings>>;
  settings: ColorFlowSettings;
  setSettings: React.Dispatch<React.SetStateAction<ColorFlowSettings>>;
  /** Called when extrusion completes so the 3D viewer can render the result. */
  onGeometryReady?: (data: { base: ExtrudedGeometry; layers: { centroid: Centroid; geom: ExtrudedGeometry }[] }) => void;
}

const SIMPLIFY_LABELS = ['off', 'light', 'medium', 'strong', 'max'] as const;
const DETAIL_LABELS = ['sharp', 'balanced', 'smooth'] as const;
const MAX_IMG_DIM = 1500;

export const ColorFlowControls: React.FC<Props> = ({ baseSettings, setBaseSettings, settings, setSettings, onGeometryReady }) => {
  const { request, status } = useColorFlowWorker();
  const { showAlert } = useAlert();

  const [imageBitmap, setImageBitmap] = useState<ImageBitmap | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null);

  const [palette, setPalette] = useState<Centroid[]>([]);
  const [assignments, setAssignments] = useState<Uint16Array | null>(null);
  const [layers, setLayers] = useState<LayerPolygon[]>([]);
  const [_layerSvgs, setLayerSvgs] = useState<Record<number, string>>({});
  const [_combinedSvg, setCombinedSvg] = useState<string>('');

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
  }, [showAlert]);

  // --- Quantize whenever inputs change ---
  useEffect(() => {
    if (!hasImage || !hasOutline || !imageBitmap || !imageDims || !outlinePolygon) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const placement = fitOutlineInImage(outlinePolygon, imageDims.w, imageDims.h);
        const mask = buildOutlineMask(outlinePolygon, placement, imageDims.w, imageDims.h);
        const resp: any = await request({
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
        const resp: any = await request({
          kind: 'trace',
          assignments,
          palette,
          width: imageDims.w,
          height: imageDims.h,
          opts: { detail: settings.detail, smooth: settings.smooth },
        });
        if (cancelled || resp.kind !== 'traced') return;
        setLayers(resp.layers);
        setLayerSvgs(resp.layerSvgs);
        setCombinedSvg(resp.combinedSvg);
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
        const layersInMm: LayerPolygon[] = layers.map((p) => ({
          outer: p.outer.map(([x, y]) => [(x - placement.offsetX) / placement.scale + outlinePolygon.minX,
                                            (y - placement.offsetY) / placement.scale + outlinePolygon.minY] as [number, number]),
          holes: p.holes.map((h) => h.map(([x, y]) => [(x - placement.offsetX) / placement.scale + outlinePolygon.minX,
                                                       (y - placement.offsetY) / placement.scale + outlinePolygon.minY] as [number, number])),
        }));
        const outlineInMm: LayerPolygon = {
          outer: outlinePolygon.outer.map(([x, y]) => [x, y] as [number, number]),
          holes: outlinePolygon.holes.map((h) => h.map(([x, y]) => [x, y] as [number, number])),
        };
        const resp: any = await request({
          kind: 'extrude',
          layers: layersInMm,
          outline: outlineInMm,
          baseMm: settings.baseMm,
          totalMm: settings.totalMm,
        });
        if (cancelled || resp.kind !== 'extruded') return;
        if (onGeometryReady) {
          // Pair each layer geom with its centroid. layers and palette align by index when
          // we built one polygon per traced layer above, but layers can contain >1 polygon
          // per color — for now we map best-effort by sequence; refine in Task 17 once we
          // also surface centroid indices from the worker side.
          const pairs = resp.layerGeoms.map((geom: ExtrudedGeometry, i: number) => ({
            centroid: palette[i % palette.length],
            geom,
          }));
          onGeometryReady({ base: resp.baseGeom, layers: pairs });
        }
      } catch (err) {
        showAlert({ title: 'Extrusion failed', message: String(err), type: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [layers, outlinePolygon, imageDims, settings.baseMm, settings.totalMm, request, palette, onGeometryReady, showAlert]);

  // --- 3MF export ---
  const handleExport3MF = useCallback(async () => {
    if (!layers.length || !outlinePolygon || !imageDims) return;
    try {
      const placement = fitOutlineInImage(outlinePolygon, imageDims.w, imageDims.h);
      const layersInMm: LayerPolygon[] = layers.map((p) => ({
        outer: p.outer.map(([x, y]) => [(x - placement.offsetX) / placement.scale + outlinePolygon.minX,
                                          (y - placement.offsetY) / placement.scale + outlinePolygon.minY] as [number, number]),
        holes: p.holes.map((h) => h.map(([x, y]) => [(x - placement.offsetX) / placement.scale + outlinePolygon.minX,
                                                     (y - placement.offsetY) / placement.scale + outlinePolygon.minY] as [number, number])),
      }));
      const outlineInMm: LayerPolygon = {
        outer: outlinePolygon.outer.map(([x, y]) => [x, y] as [number, number]),
        holes: outlinePolygon.holes.map((h) => h.map(([x, y]) => [x, y] as [number, number])),
      };
      const resp: any = await request({
        kind: 'extrude', layers: layersInMm, outline: outlineInMm,
        baseMm: settings.baseMm, totalMm: settings.totalMm,
      });
      const parts = [{ name: 'base', mesh: resp.baseGeom }];
      resp.layerGeoms.forEach((g: ExtrudedGeometry, i: number) => {
        const c = palette[i % palette.length];
        const hex = c ? `${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}` : 'unk';
        parts.push({ name: `color_${i + 1}_${hex}`, mesh: g });
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
    <div className="bg-gray-800 md:rounded-lg md:border border-gray-700 shadow-lg flex-1 min-h-0 flex flex-col overflow-y-auto">
      <div className="p-6 space-y-6">
        <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
          GrippySheet · ColorFlow
        </h2>

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
                onChange={(e) => setSettings((s) => ({ ...s, totalMm: +e.target.value }))}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1" />
            </label>
            <label>base mm
              <input type="number" step={0.1} min={0.2} max={5} value={settings.baseMm}
                onChange={(e) => setSettings((s) => ({ ...s, baseMm: +e.target.value }))}
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
            <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">Layers</h3>
            <div className="grid grid-cols-2 gap-2">
              {palette.map((c) => (
                <div key={c.index} className="bg-gray-900 border border-gray-700 rounded p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded" style={{ background: `rgb(${c.r},${c.g},${c.b})` }} />
                    <div className="font-mono">#{c.r.toString(16).padStart(2,'0')}{c.g.toString(16).padStart(2,'0')}{c.b.toString(16).padStart(2,'0')}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
