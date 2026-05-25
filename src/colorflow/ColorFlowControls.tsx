import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type BaseSettings } from '../types/schemas';
import { type ColorFlowSettings } from './schema';
import { getOutlineBySlug } from './outlineLibrary';
import { RequestCancelledError, useColorFlowWorker } from './useColorFlowWorker';
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
import type { ExtrudedGeometry } from './pipeline/extrude';
import type { Response as WorkerResponse, TracedLayerEntry, ExtrudedLayerEntry } from './workerProtocol';
import { useAlert } from '../context/AlertContext';
import { emitProcessing, eventBus, emitToast, consumePendingFileDrop } from '../utils/eventBus';
import { useDebouncedCommit } from '../utils/useDebouncedCommit';

import { BaseStatusBanner } from './controls/BaseStatusBanner';
import { ImageSection } from './controls/ImageSection';
import { ColorSliders } from './controls/ColorSliders';
import { PrintControls } from './controls/PrintControls';
import { LayerControls } from './controls/LayerControls';
import { StatusFooter } from './controls/StatusFooter';

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
  settings: ColorFlowSettings;
  setSettings: React.Dispatch<React.SetStateAction<ColorFlowSettings>>;
  onGeometryReady?: (data: ColorFlowGeomData) => void;
  onImageAssetChanged?: (asset: { name: string; bytes: ArrayBuffer } | null) => void;
  initialImageAsset?: { name: string; bytes: ArrayBuffer } | null;
  /** Callback to switch the right-panel tabs to "Base". */
  onSwitchToBase?: () => void;
}

const MAX_IMG_DIM = 1500;

export const ColorFlowControls: React.FC<Props> = ({
  baseSettings, settings, setSettings,
  onGeometryReady, onImageAssetChanged, initialImageAsset, onSwitchToBase,
}) => {
  const { request, status } = useColorFlowWorker();
  const { showAlert } = useAlert();

  const [imageBitmap, setImageBitmap] = useState<ImageBitmap | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null);

  // Hydration tracks the bytes ArrayBuffer (stable across the App.tsx
  // useMemo'd initialImageAsset → projectAssets.image.content → bytes chain).
  // A new asset reference (project import, or a different in-session upload
  // before we've pre-claimed) triggers one hydration; pre-claimed refs skip.
  const lastHydratedBytesRef = useRef<ArrayBuffer | null>(null);

  // Hydrate from project bundle. Idempotent per ArrayBuffer reference —
  // handleImageFile pre-claims the ref before triggering the App re-render,
  // so an in-session upload doesn't fight its own hydration round-trip.
  useEffect(() => {
    if (!initialImageAsset) return;
    if (lastHydratedBytesRef.current === initialImageAsset.bytes) return;
    lastHydratedBytesRef.current = initialImageAsset.bytes;
    let cancelled = false;
    (async () => {
      try {
        const blob = new Blob([initialImageAsset.bytes]);
        const bitmap = await createImageBitmap(blob);
        if (cancelled) { bitmap.close(); return; }
        setImageBitmap((prev) => { prev?.close(); return bitmap; });
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

  // Slider drafts: smooth local feedback while the heavy pipeline waits.
  const [colorCountDraft, setColorCountDraft] = useDebouncedCommit<number>(
    settings.colorCount,
    (v) => setSettings((s) => ({ ...s, colorCount: v })),
  );
  const [simplifyDraft, setSimplifyDraft] = useDebouncedCommit<number>(
    settings.simplify,
    (v) => setSettings((s) => ({ ...s, simplify: v })),
  );
  const [detailDraft, setDetailDraft] = useDebouncedCommit<number>(
    settings.detail,
    (v) => setSettings((s) => ({ ...s, detail: v })),
  );

  // Broadcast worker activity so the 3D viewer overlay can label it.
  useEffect(() => {
    emitProcessing({ key: 'colorflow:worker', busy: !!status.phase, label: status.phase || undefined });
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
  const outlineEntry = baseSettings.outlineSlug ? getOutlineBySlug(baseSettings.outlineSlug) ?? null : null;
  const baseMm = baseSettings.thickness;

  const handleImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showAlert({ title: 'Not an image', message: 'Drop a PNG, JPG, or WebP file.', type: 'error' });
      emitToast({ message: 'Unsupported image', detail: file.name, tone: 'error' });
      return;
    }
    // Decode + downsize can throw on corrupt/partial bytes; we wrap the
    // whole pipeline so the caller (drag-drop subscriber or right-panel
    // dropzone) gets a useful surface instead of an unhandled rejection.
    try {
      setImageName(file.name);
      const bytes = await file.arrayBuffer();
      lastHydratedBytesRef.current = bytes;
      onImageAssetChanged?.({ name: file.name, bytes });
      const bitmap = await createImageBitmap(file);
      let { width, height } = bitmap;
      if (Math.max(width, height) > MAX_IMG_DIM) {
        const scale = MAX_IMG_DIM / Math.max(width, height);
        const downsized = await createImageBitmap(bitmap, { resizeWidth: Math.round(width * scale), resizeHeight: Math.round(height * scale) });
        width = downsized.width;
        height = downsized.height;
        setImageBitmap((prev) => { prev?.close(); return downsized; });
        bitmap.close();
      } else {
        setImageBitmap((prev) => { prev?.close(); return bitmap; });
      }
      setImageDims({ w: width, h: height });
      emitToast({ message: 'Image loaded', detail: file.name, tone: 'ready' });
    } catch (err: any) {
      showAlert({ title: 'Could not load image', message: err?.message ?? String(err), type: 'error' });
      emitToast({ message: 'Image failed', detail: file.name, tone: 'error' });
    }
  }, [showAlert, onImageAssetChanged]);

  // Subscribe to canvas drag-drop. When the user drops an image onto the
  // viewer, ModelViewer emits `file-drop` and we hydrate the bytes through
  // the same `handleImageFile` path the right-panel dropzone uses. Also
  // replay any in-flight drop that fired before this subscriber mounted
  // (e.g. first drop after page load, while this panel was still Frozen).
  useEffect(() => {
    const claim = (file: File) => {
      // handleImageFile already toasts + alerts on failure; explicit catch
      // here is a belt-and-suspenders guard against the promise rejecting
      // before the inner try/catch runs (e.g. synchronous throw).
      handleImageFile(file).catch((err) => {
        console.error('[ColorFlow] drop handler crashed', err);
      });
    };
    const pending = consumePendingFileDrop('image:colorflow');
    if (pending) claim(pending.file);
    return eventBus.on('file-drop', (e: { file: File; kind: string }) => {
      if (e.kind === 'image:colorflow') claim(e.file);
    });
  }, [handleImageFile]);

  // Quantize whenever inputs change (debounced 200ms internally; slider drafts
  // add another ~250ms on top).
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

        // Transfer the rendered bitmap + the mask buffer rather than
        // structured-clone them. Otherwise every quantize call leaves a
        // GPU-backed ImageBitmap behind that the GC can't reliably free
        // — the app crashes after enough pipeline runs.
        const resp = await request<Extract<WorkerResponse, { kind: 'quantized' }>>({
          kind: 'quantize',
          image: rendered,
          mask,
          width: canvas.w,
          height: canvas.h,
          opts: { colorCount: settings.colorCount, simplify: settings.simplify, seed: 42 },
        }, mask ? [rendered, mask.buffer] : [rendered]);
        if (cancelled || resp.kind !== 'quantized') return;
        setPalette(resp.palette);
        setAssignments(resp.assignments);
        setCoverage(paletteCoverage(resp.assignments, resp.palette));
      } catch (err) {
        if (err instanceof RequestCancelledError) return;
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
        if (err instanceof RequestCancelledError) return;
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
        if (err instanceof RequestCancelledError) return;
        showAlert({ title: 'Extrusion failed', message: String(err), type: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [layers, outlinePolygon, palette, coverage, baseMm, settings.colorLayerMm, settings.sort, settings.layerOrder, request, onGeometryReady, showAlert]);

  return (
    <div className="space-y-6">
      <BaseStatusBanner
        hasOutline={hasOutline}
        outlineEntry={outlineEntry}
        onSwitchToBase={onSwitchToBase}
      />

      <ImageSection
        hasOutline={hasOutline}
        hasImage={hasImage}
        imageBitmap={imageBitmap}
        imageName={imageName}
        imageDims={imageDims}
        outlinePolygon={outlinePolygon}
        settings={settings}
        setSettings={setSettings}
        onImageFile={handleImageFile}
      />

      <ColorSliders
        hasImage={hasImage}
        settings={settings}
        setSettings={setSettings}
        colorCountDraft={colorCountDraft}
        setColorCountDraft={setColorCountDraft}
        simplifyDraft={simplifyDraft}
        setSimplifyDraft={setSimplifyDraft}
        detailDraft={detailDraft}
        setDetailDraft={setDetailDraft}
      />

      <PrintControls
        hasLayers={layers.length > 0}
        paletteSize={palette.length}
        baseMm={baseMm}
        settings={settings}
        setSettings={setSettings}
      />

      <LayerControls
        palette={palette}
        coverage={coverage}
        settings={settings}
        setSettings={setSettings}
      />

      <StatusFooter
        phase={status.phase || undefined}
        error={status.error || undefined}
        paletteLength={palette.length}
      />
    </div>
  );
};
