import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type BaseSettings, type GeometrySettings } from '../types/schemas';
import { type ColorFlowSettings } from './schema';
import { getOutlineBySlug } from './outlineLibrary';
import { useColorFlowWorker } from './useColorFlowWorker';
import { ImageTransformPreview } from './ImageTransformPreview';
import {
  shapeToPolygon,
  outlineCanvasSize,
  buildOutlineCanvasMask,
  pixelToMmOnOutlineCanvas,
  transformOutlinePolygon,
  CANVAS_PX_PER_MM,
  type OutlinePolygon,
} from './outlineToPolygon';
import { computeImageDrawCoords } from './imageTransform';
import { paletteCoverage, type Centroid } from './pipeline/quantize';
import { resolvedStackOrder } from './stackOrder';
import { effectiveSpikeMaxMm } from './spikes';
import type { ExtrudedGeometry } from './pipeline/extrude';
import type { Response as WorkerResponse, TracedLayerEntry, ExtrudedLayerEntry } from './workerProtocol';
import { useAlert } from '../context/AlertContext';
import { eventBus } from '../utils/eventBus';

export interface SpikeGroup {
  centroidIndex: number; // -1 = no color underneath
  geom: ExtrudedGeometry;
  /** Resolved hex color for this spike group's material. */
  color: string;
}

/**
 * Captures everything `generateSpikes` needs to rebuild the spike layer when
 * the user changes the Geometry / spike settings. Stored alongside the base +
 * color geometries so spike regeneration can run from anywhere (including
 * while the ColorFlow tab is frozen).
 */
export interface SpikeSource {
  outlinePolygon: { outer: Array<[number, number]>; holes: Array<Array<[number, number]>>;
    minX: number; minY: number; maxX: number; maxY: number };
  layersInMm: TracedLayerEntry[];
  palette: Centroid[];
  stackOrder: number[];
  baseMm: number;
  colorLayerMm: number;
}

export interface ColorFlowGeomData {
  base: ExtrudedGeometry;
  layers: { centroid: Centroid; position: number; geom: ExtrudedGeometry }[];
  /** Source data used by App-level spike regeneration. Spikes themselves
   *  are computed downstream so Geometry-tab changes flow live. */
  source: SpikeSource;
}

interface Props {
  baseSettings: BaseSettings;
  geometrySettings: GeometrySettings;
  settings: ColorFlowSettings;
  setSettings: React.Dispatch<React.SetStateAction<ColorFlowSettings>>;
  onGeometryReady?: (data: ColorFlowGeomData) => void;
  onImageAssetChanged?: (asset: { name: string; bytes: ArrayBuffer } | null) => void;
  initialImageAsset?: { name: string; bytes: ArrayBuffer } | null;
  /** Callback to switch the right-panel tabs to "Base". */
  onSwitchToBase?: () => void;
  /** Diagnostic line produced by App-level spike generation. */
  spikeDiag?: string;
}

const SIMPLIFY_LABELS = ['off', 'light', 'medium', 'strong', 'max'] as const;
const DETAIL_LABELS = ['sharp', 'balanced', 'smooth'] as const;
const MAX_IMG_DIM = 1500;

export const ColorFlowControls: React.FC<Props> = ({ baseSettings, geometrySettings, settings, setSettings, onGeometryReady, onImageAssetChanged, initialImageAsset, onSwitchToBase, spikeDiag }) => {
  const { request, status } = useColorFlowWorker();
  const { showAlert } = useAlert();

  const [imageBitmap, setImageBitmap] = useState<ImageBitmap | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null);

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

  // Broadcast worker activity so the 3D viewer can show a spinner.
  useEffect(() => {
    eventBus.emit('colorflow:processing', !!status.phase);
  }, [status.phase]);

  // Apply Base tab's rotation + mirror to the polygon used for canvas, mask, and extrusion.
  const outlinePolygon = useMemo<OutlinePolygon | null>(() => {
    const shape = baseSettings.cutoutShapes?.[0];
    if (!shape) return null;
    const raw = shapeToPolygon(shape, 64);
    return transformOutlinePolygon(raw, baseSettings.baseOutlineRotation, baseSettings.baseOutlineMirror);
  }, [baseSettings.cutoutShapes, baseSettings.baseOutlineRotation, baseSettings.baseOutlineMirror]);

  const hasOutline = outlinePolygon !== null;
  const hasImage = imageBitmap !== null;
  const outlineEntry = baseSettings.outlineSlug ? getOutlineBySlug(baseSettings.outlineSlug) : null;
  const baseMm = baseSettings.thickness;

  const handleImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showAlert({ title: 'Not an image', message: 'Drop a PNG, JPG, or WebP file.', type: 'error' });
      return;
    }
    setImageName(file.name);
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

  useEffect(() => {
    if (!hasImage || !hasOutline || !imageBitmap || !outlinePolygon) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const canvas = outlineCanvasSize(outlinePolygon);
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

  useEffect(() => {
    if (!layers.length || !outlinePolygon || !palette.length) return;
    let cancelled = false;
    (async () => {
      try {
        const canvas = outlineCanvasSize(outlinePolygon);
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
          baseMm,
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
          // Spikes are derived at App level from this `source` so Geometry-tab
          // changes flow live without re-running the extrude effect.
          const source: SpikeSource = {
            outlinePolygon: {
              outer: outlinePolygon.outer.map(([x, y]) => [x, y] as [number, number]),
              holes: outlinePolygon.holes.map((h) => h.map(([x, y]) => [x, y] as [number, number])),
              minX: outlinePolygon.minX, minY: outlinePolygon.minY,
              maxX: outlinePolygon.maxX, maxY: outlinePolygon.maxY,
            },
            layersInMm,
            palette,
            stackOrder,
            baseMm,
            colorLayerMm: settings.colorLayerMm,
          };
          onGeometryReady({ base: resp.baseGeom, layers: pairs, source });
        }
      } catch (err) {
        showAlert({ title: 'Extrusion failed', message: String(err), type: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [layers, outlinePolygon, palette, coverage, baseMm, settings.colorLayerMm, settings.sort, settings.layerOrder, request, onGeometryReady, showAlert]);

  const _dropRef = useRef<HTMLDivElement>(null);

  return (
    <div className="space-y-6">
        <section>
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">① Base</h3>
          {hasOutline ? (
            <div className="flex items-center justify-between gap-2 text-xs bg-gray-900 border border-gray-700 rounded px-3 py-2">
              <span className="text-green-400">
                ✓ {outlineEntry ? `${outlineEntry.name} · ${outlineEntry.widthMm}×${outlineEntry.heightMm}mm` : 'custom outline loaded'}
              </span>
              {onSwitchToBase && (
                <button
                  type="button"
                  onClick={onSwitchToBase}
                  className="text-blue-400 hover:underline text-[10px] whitespace-nowrap"
                >edit in Base ↗</button>
              )}
            </div>
          ) : (
            <div className="text-xs bg-yellow-900/20 border border-yellow-700/50 rounded px-3 py-2 text-yellow-200">
              <p>⚠ No outline configured yet.</p>
              {onSwitchToBase && (
                <button
                  type="button"
                  onClick={onSwitchToBase}
                  className="text-blue-400 hover:underline text-[10px] mt-1"
                >Configure in Base tab ↗</button>
              )}
            </div>
          )}
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
          <ImageTransformPreview
            imageBitmap={imageBitmap}
            outline={outlinePolygon}
            offsetMm={settings.imageOffsetMm}
            scale={settings.imageScale}
            onCommit={(offsetMm, scale) => setSettings((s) => ({ ...s, imageOffsetMm: offsetMm, imageScale: scale }))}
          />
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
          <div className="grid grid-cols-1 gap-2 text-xs text-gray-400">
            <label>layer mm (each color rises this much above the base)
              <input
                type="number"
                step={0.05}
                min={0.05}
                max={2}
                value={settings.colorLayerMm}
                onChange={(e) => {
                  const v = Math.max(0.05, Math.min(2, +e.target.value || 0.4));
                  setSettings((s) => ({ ...s, colorLayerMm: v }));
                }}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1"
              />
            </label>
          </div>
          {palette.length > 0 && (
            <p className="text-[10px] text-gray-500 mt-2">
              total {(baseMm + palette.length * settings.colorLayerMm).toFixed(2)}mm
              ({baseMm.toFixed(2)} base + {palette.length} × {settings.colorLayerMm.toFixed(2)}mm) · base thickness set in Base tab
            </p>
          )}
        </section>

        {palette.length > 0 && (
          <section>
            <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">Spike pattern</h3>
            {geometrySettings.patternShapes?.[0] ? (
              <>
                <p className="text-[10px] text-gray-500 mb-2">
                  Pattern tile + spacing come from the Geometry tab. Each spike rises from its
                  color region's top to a unified spike-max height.
                </p>
                <div className="grid grid-cols-1 gap-2 text-xs text-gray-400">
                  <label>spike max mm (0 = auto: max color + 1mm)
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      max={20}
                      value={settings.spikeMaxMm}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(20, +e.target.value || 0));
                        setSettings((s) => ({ ...s, spikeMaxMm: v }));
                      }}
                      className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.spikeColorMatch}
                      onChange={(e) => setSettings((s) => ({ ...s, spikeColorMatch: e.target.checked }))}
                    />
                    color-match spikes to the region below
                  </label>
                </div>
                <p className="text-[10px] text-gray-500 mt-2">
                  resolved spike top: {effectiveSpikeMaxMm(settings.spikeMaxMm, baseMm, palette.length, settings.colorLayerMm).toFixed(2)}mm
                </p>
                {spikeDiag && (
                  <p className="text-[10px] text-blue-400 mt-1 font-mono">{spikeDiag}</p>
                )}
              </>
            ) : (
              <p className="text-[10px] text-gray-500">
                No pattern tile configured — pick one in the Geometry tab to add a grip spike layer on top.
              </p>
            )}
          </section>
        )}

        {palette.length > 0 && (
          <section>
            <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">Layers</h3>
            <div className="flex items-center gap-2 mb-2 text-[10px]">
              <span className="text-gray-500">sort:</span>
              <div className="inline-flex rounded border border-gray-700 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, sort: 'luma', layerOrder: null }))}
                  className={`px-2 py-1 ${settings.layerOrder === null && settings.sort === 'luma' ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-white'}`}
                >luminance</button>
                <button
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, sort: 'coverage', layerOrder: null }))}
                  className={`px-2 py-1 ${settings.layerOrder === null && settings.sort === 'coverage' ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-white'}`}
                >coverage</button>
                <button
                  type="button"
                  disabled={settings.layerOrder === null}
                  className={`px-2 py-1 ${settings.layerOrder !== null ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-500'}`}
                >manual</button>
              </div>
              {settings.layerOrder !== null && (
                <button
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, layerOrder: null }))}
                  className="text-blue-400 hover:underline"
                >reset</button>
              )}
            </div>

            {(() => {
              const order = resolvedStackOrder(palette, coverage, settings);
              const total = coverage.reduce((s, c) => s + c, 0) || 1;
              return (
                <div className="space-y-1">
                  {order.map((paletteIdx, displayIdx) => {
                    const c = palette[paletteIdx];
                    const hex = `#${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`;
                    const pct = ((coverage[paletteIdx] ?? 0) / total) * 100;
                    return (
                      <div key={paletteIdx} className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded p-2 text-xs">
                        <div className="w-5 h-5 rounded flex-shrink-0 border border-gray-700" style={{ background: hex }} />
                        <div className="font-mono text-gray-300 w-16">{hex.toUpperCase()}</div>
                        <div className="text-gray-500 text-[10px] flex-1">layer {displayIdx + 1} · {pct.toFixed(1)}%</div>
                        <button
                          type="button"
                          disabled={displayIdx === 0}
                          onClick={() => {
                            const next = [...order];
                            [next[displayIdx - 1], next[displayIdx]] = [next[displayIdx], next[displayIdx - 1]];
                            setSettings((s) => ({ ...s, layerOrder: next }));
                          }}
                          className="px-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Move toward base"
                        >↑</button>
                        <button
                          type="button"
                          disabled={displayIdx === order.length - 1}
                          onClick={() => {
                            const next = [...order];
                            [next[displayIdx + 1], next[displayIdx]] = [next[displayIdx], next[displayIdx + 1]];
                            setSettings((s) => ({ ...s, layerOrder: next }));
                          }}
                          className="px-1 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Move toward top"
                        >↓</button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <p className="text-[10px] text-gray-500 mt-2">
              Layer 1 sits closest to the base; higher numbers stack taller. Each adds {settings.colorLayerMm.toFixed(2)}mm.
            </p>
          </section>
        )}

        <section className={layers.length > 0 ? '' : 'opacity-40 pointer-events-none'}>
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">⑤ Export</h3>
          <p className="text-xs text-gray-400">
            Use <span className="text-blue-400 font-bold">Export 3MF</span> in the footer below to download the multi-part Bambu assembly.
          </p>
        </section>

        <div className="text-xs min-h-[24px]">
          {status.phase && (
            <span className="inline-flex items-center gap-2 text-blue-400 bg-blue-900/20 border border-blue-700/40 rounded px-2 py-1">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              working: {status.phase}…
            </span>
          )}
          {status.error && <span className="text-red-400">error: {status.error}</span>}
          {!status.phase && !status.error && palette.length > 0 && (
            <span className="text-green-400">ready · {palette.length} colors traced</span>
          )}
        </div>


    </div>
  );
};
