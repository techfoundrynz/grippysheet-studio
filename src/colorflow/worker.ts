/// <reference lib="webworker" />
import imagetracer from './vendor/imagetracer';
import { kmeans, assignAll } from './pipeline/quantize';
import { modeFilter, SIMPLIFY_KERNELS } from './pipeline/modeFilter';
import { trace } from './pipeline/trace';
import { layerToPolygons } from './pipeline/polygonize';
import { extrudePolygon } from './pipeline/extrude';
import { buildLevelMesh } from './pipeline/levelMesh';
import { mulberry32 } from './pipeline/random';
import type { Request, Response, TransferredGeom, TracedLayerEntry } from './workerProtocol';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: Response, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

async function handleQuantize(req: Extract<Request, { kind: 'quantize' }>) {
  const { image, mask, width, height, opts, id } = req;
  post({ id, kind: 'progress', phase: 'sampling' });

  // Build a downsampled sample for k-means
  const sampleMax = 200;
  const ss = Math.min(1, sampleMax / Math.max(width, height));
  const sw = Math.max(1, Math.round(width * ss));
  const sh = Math.max(1, Math.round(height * ss));

  const offscreen = new OffscreenCanvas(width, height);
  const ctx2 = offscreen.getContext('2d')!;
  ctx2.drawImage(image, 0, 0, width, height);
  const fullData = ctx2.getImageData(0, 0, width, height);

  const sampleCanvas = new OffscreenCanvas(sw, sh);
  const sctx = sampleCanvas.getContext('2d')!;
  sctx.drawImage(image, 0, 0, sw, sh);
  const sampleData = sctx.getImageData(0, 0, sw, sh);

  // If outline mask is provided, mark sample-resolution pixels outside it as transparent.
  if (mask) {
    for (let i = 0; i < sw * sh; i++) {
      const sx = Math.min(width - 1, Math.floor((i % sw) / ss));
      const sy = Math.min(height - 1, Math.floor(Math.floor(i / sw) / ss));
      if (!mask[sy * width + sx]) sampleData.data[i * 4 + 3] = 0;
    }
  }

  post({ id, kind: 'progress', phase: 'clustering' });
  const palette = kmeans(sampleData, opts.colorCount, mulberry32(opts.seed));
  post({ id, kind: 'progress', phase: 'assigning' });
  let assignments = assignAll(fullData, palette, mask);

  if (opts.simplify > 0) {
    post({ id, kind: 'progress', phase: 'simplifying' });
    const k = SIMPLIFY_KERNELS[opts.simplify];
    assignments = modeFilter(assignments, width, height, k, palette.length);
  }

  // Build a quick combined preview from assignments
  const preview = new ImageData(width, height);
  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    if (a === 0xFFFF) { preview.data[i * 4 + 3] = 0; continue; }
    const c = palette[a];
    preview.data[i * 4]     = c.r;
    preview.data[i * 4 + 1] = c.g;
    preview.data[i * 4 + 2] = c.b;
    preview.data[i * 4 + 3] = 255;
  }
  // Cheap SVG: skip — leave combined SVG to the 'trace' step.

  post({ id, kind: 'quantized', palette, assignments, previewSvg: '' },
       [assignments.buffer]);
}

async function handleTrace(req: Extract<Request, { kind: 'trace' }>) {
  const { assignments, palette, width, height, opts, id } = req;
  post({ id, kind: 'progress', phase: 'tracing' });

  // Build the quantized RGBA image with a leading transparent palette slot,
  // so out-of-mask pixels route to layer 0 (skipped downstream).
  const img = new ImageData(width, height);
  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    if (a === 0xFFFF) { img.data[i * 4 + 3] = 0; continue; }
    const c = palette[a];
    img.data[i * 4]     = c.r;
    img.data[i * 4 + 1] = c.g;
    img.data[i * 4 + 2] = c.b;
    img.data[i * 4 + 3] = 255;
  }
  const pal = [{ r: 0, g: 0, b: 0, a: 0 }, ...palette.map((c) => ({ r: c.r, g: c.g, b: c.b, a: 255 }))];
  const td = trace(img, pal, opts);

  // Build the combined SVG (palette without the leading transparent slot
  // since ImageTracer's getsvgstring still emits all layers).
  const combinedSvg = imagetracer.imagedataToSVG(img, {
    pal: palette.map((c) => ({ r: c.r, g: c.g, b: c.b, a: 255 })),
    viewbox: true,
    strokewidth: 0,
    roundcoords: 1,
    linefilter: opts.smooth,
  });

  // Polygons per layer (skip layer 0 = transparent slot)
  const layerEntries: TracedLayerEntry[] = [];
  const layerSvgs: Record<number, string> = {};
  for (let li = 1; li < td.layers.length; li++) {
    const polys = layerToPolygons(td.layers[li]);
    const centroidIndex = li - 1;
    for (const p of polys) layerEntries.push({ centroidIndex, polygon: p });
    // For per-layer SVG, regenerate using a 2-color palette (background white, region centroid)
    const binary = new ImageData(width, height);
    const centroid = palette[li - 1];
    if (!centroid) continue;
    for (let i = 0; i < assignments.length; i++) {
      const isMatch = assignments[i] === centroid.index;
      const v = isMatch ? 0 : 255;
      binary.data[i * 4]     = v;
      binary.data[i * 4 + 1] = v;
      binary.data[i * 4 + 2] = v;
      binary.data[i * 4 + 3] = 255;
    }
    const layerSvg = imagetracer.imagedataToSVG(binary, {
      pal: [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }],
      viewbox: true, strokewidth: 0, roundcoords: 1, linefilter: opts.smooth,
    });
    layerSvgs[centroid.index] = layerSvg;
  }

  post({ id, kind: 'traced', layers: layerEntries, layerSvgs, combinedSvg });
}

async function handleExtrude(req: Extract<Request, { kind: 'extrude' }>) {
  const { layers, outline, baseMm, colorLayerMm, stackOrder, id } = req;
  post({ id, kind: 'progress', phase: 'extruding' });

  const baseMesh = extrudePolygon(outline.outer, outline.holes, 0, baseMm);
  if (!baseMesh) {
    post({ id, kind: 'error', phase: 'extrude', message: 'Could not triangulate outline' });
    return;
  }

  // Map centroidIndex -> stack position (0 = nearest to base).
  const positionByCentroid = new Map<number, number>();
  for (let i = 0; i < stackOrder.length; i++) positionByCentroid.set(stackOrder[i], i);

  // STACKED-LEVEL MODEL (print-efficient):
  // For each level k ∈ [0, N), emit ONE merged mesh containing the union of
  // every traced polygon whose color sits at stack position >= k. That mesh
  // occupies z=[baseMm + k*layer, baseMm + (k+1)*layer] and is assigned the
  // color of stackOrder[k]. Result: the printed object is a stair-step where
  // each tier uses a single filament across all polygons of that height —
  // no mid-layer filament swaps, exactly what the slicer wants. Each
  // emitted entry's `centroidIndex` is the COLOR for this level (so the 3D
  // viewer + 3MF naming still tag by color), and `position` is the level k.
  const layerGeoms: { centroidIndex: number; position: number; geom: TransferredGeom }[] = [];
  for (let level = 0; level < stackOrder.length; level++) {
    const zBottom = baseMm + level * colorLayerMm;
    const zTop = baseMm + (level + 1) * colorLayerMm;

    // Union polygons whose color's stack position >= this level, then extrude
    // the merged outline as one closed multi-shell prism. Eliminates coincident
    // side walls between adjacent same-level polygons (was non-manifold before).
    const polygonsAtThisLevel = layers
      .filter((e) => {
        const pos = positionByCentroid.get(e.centroidIndex);
        return pos !== undefined && pos >= level;
      })
      .map((e) => e.polygon);
    const geom = buildLevelMesh(polygonsAtThisLevel, zBottom, zTop);
    if (!geom) continue;

    layerGeoms.push({
      centroidIndex: stackOrder[level],
      position: level,
      geom,
    });
  }

  const transfer: Transferable[] = [baseMesh.positions.buffer, baseMesh.indices.buffer];
  for (const entry of layerGeoms) {
    transfer.push(entry.geom.positions.buffer, entry.geom.indices.buffer);
  }
  post({ id, kind: 'extruded', baseGeom: baseMesh, layerGeoms }, transfer);
}

ctx.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    if (req.kind === 'quantize') await handleQuantize(req);
    else if (req.kind === 'trace') await handleTrace(req);
    else if (req.kind === 'extrude') await handleExtrude(req);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    post({ id: (req as { id: number }).id, kind: 'error', phase: req.kind, message });
  }
};
