import * as THREE from 'three';
import ImageTracer, { TracePath } from 'imagetracerjs';
import { shiftHueRGB } from '../geometry/colorShift';

/**
 * Posterize an image into K colour bands and vector-trace each band into THREE.Shapes.
 *
 * An image inlay is converted to a flat, multi-colour *shape* inlay at import time (via the
 * conversion dialog): each band becomes one or more filled shapes (with holes) carrying its
 * averaged palette colour. From then on it's an ordinary shape inlay — the existing pipeline
 * extrudes/clips/exports it, colours split by material in the 3MF, and there's no pixelation.
 *
 * Runs on the main thread (needs a 2D canvas / ImageData). Bands use equal-population
 * luminance thresholds; the per-band colour is the average of that band's pixels, optionally
 * hue-rotated. A "quality" control drives how closely the vectors follow the pixels
 * (detail/complexity) vs. how much they're simplified/smoothed.
 */

export interface TracedBandShape {
  shape: THREE.Shape;
  color: string;   // #rrggbb — band colour (hue already applied)
  band: number;    // 0 = darkest .. K-1 = lightest
}

export interface TraceResult {
  shapes: TracedBandShape[];
  palette: string[]; // index = band (hue already applied)
}

/** Raw trace output shared by the live preview and the final shape build. */
export interface TraceLayers {
  layers: TracePath[][]; // index 0 = transparent sentinel; band b == layers[b + 1]
  palette: string[];     // index = band (hue already applied)
  width: number;
  height: number;
}

export interface RGBAImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface TraceOpts {
  /** Physical width of the traced footprint at scale 1 (height follows aspect). */
  widthMM?: number;
  /** Hue rotation (deg) applied to every band colour. */
  hueShift?: number;
  /** 1 (heavily simplified/smooth) .. 10 (maximum detail). */
  quality?: number;
}

const MAX_COLORS = 12;
const ALPHA_THRESHOLD = 128;

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');

/**
 * Map a 1..10 quality to imagetracer tuning, scaled to the trace resolution so the look stays
 * consistent whether we trace a small preview or the full-res image (thresholds are in pixels).
 */
function qualityToTuning(quality: number, dim: number) {
  const t = (Math.max(1, Math.min(10, quality)) - 1) / 9; // 0 = simplified, 1 = detailed
  const ref = Math.max(0.25, dim / 1000);
  return {
    ltres: (6 - 5.7 * t) * ref,      // straight-line error (px)
    qtres: (6 - 5.7 * t) * ref,      // curve error (px)
    pathomit: Math.round((24 - 23 * t) * ref), // drop specks shorter than this (px)
    blurradius: Math.round(2 * (1 - t)),        // 0..2 pre-blur to smooth noisy edges
    blurdelta: 20,
    rightangleenhance: true,
  };
}

/** Equal-population luminance bands + per-band average colour (optionally hue-shifted). */
function posterize(img: RGBAImage, K: number, hueShift = 0) {
  const { data, width: W, height: H } = img;
  const N = W * H;
  const opaque = new Uint8Array(N);
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    opaque[i] = data[i * 4 + 3] >= ALPHA_THRESHOLD ? 1 : 0;
    lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
  }
  const opaqueLums: number[] = [];
  for (let i = 0; i < N; i++) if (opaque[i]) opaqueLums.push(lum[i]);
  const sorted = Float32Array.from(opaqueLums).sort();
  const Mn = sorted.length;
  const thresholds: number[] = [];
  for (let k = 1; k < K && Mn > 0; k++) thresholds.push(sorted[Math.floor((k * Mn) / K)]);

  const bandOf = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    if (!opaque[i]) { bandOf[i] = -1; continue; }
    let b = 0;
    while (b < thresholds.length && lum[i] >= thresholds[b]) b++;
    bandOf[i] = b;
  }

  const sum = Array.from({ length: K }, () => [0, 0, 0, 0]);
  for (let i = 0; i < N; i++) {
    const b = bandOf[i];
    if (b < 0) continue;
    sum[b][0] += data[i * 4]; sum[b][1] += data[i * 4 + 1]; sum[b][2] += data[i * 4 + 2]; sum[b][3] += 1;
  }
  const paletteRGB: [number, number, number][] = sum.map((s, b) => {
    const rgb = s[3] > 0
      ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] as [number, number, number]
      : (() => { const v = K > 1 ? (b / (K - 1)) * 255 : 128; return [v, v, v] as [number, number, number]; })();
    return hueShift ? shiftHueRGB(rgb[0], rgb[1], rgb[2], hueShift) : rgb;
  });
  return { bandOf, paletteRGB };
}

/** Build the palette-indexed ImageData tracing input (index 0 = transparent, 1..K = bands). */
function buildQuant(img: RGBAImage, bandOf: Int32Array, paletteRGB: [number, number, number][]): ImageData {
  const { width: W, height: H } = img;
  const N = W * H;
  const quant = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const b = bandOf[i];
    if (b < 0) { quant[i * 4 + 3] = 0; continue; }
    quant[i * 4] = clamp255(paletteRGB[b][0]);
    quant[i * 4 + 1] = clamp255(paletteRGB[b][1]);
    quant[i * 4 + 2] = clamp255(paletteRGB[b][2]);
    quant[i * 4 + 3] = 255;
  }
  return new ImageData(quant, W, H);
}

/**
 * Posterize + vector-trace an image into raw per-band path layers. Shared by the dialog's live
 * preview (rendered to a canvas) and the final shape build, so both look identical.
 */
export function traceLayers(img: RGBAImage, colors: number, opts: TraceOpts = {}): TraceLayers {
  const { width: W, height: H } = img;
  const K = Math.max(1, Math.min(MAX_COLORS, Math.round(colors)));
  const { bandOf, paletteRGB } = posterize(img, K, opts.hueShift ?? 0);
  const imgd = buildQuant(img, bandOf, paletteRGB);
  const pal = [
    { r: 0, g: 0, b: 0, a: 0 },
    ...paletteRGB.map(([r, g, b]) => ({ r: clamp255(r), g: clamp255(g), b: clamp255(b), a: 255 })),
  ];
  const traced = ImageTracer.imagedataToTracedata(imgd, {
    pal,
    colorsampling: 0,
    ...qualityToTuning(opts.quality ?? 6, Math.max(W, H)),
  });
  return { layers: traced.layers, palette: paletteRGB.map(([r, g, b]) => toHex(r, g, b)), width: W, height: H };
}

/** Convert one imagetracer path's segments into a THREE.Path/Shape via a pixel→mm mapper. */
function buildPath<T extends THREE.Path>(
  target: T,
  segments: { type: string; x1: number; y1: number; x2?: number; y2?: number; x3?: number; y3?: number }[],
  map: (px: number, py: number) => [number, number],
): T {
  if (segments.length === 0) return target;
  const [sx, sy] = map(segments[0].x1, segments[0].y1);
  target.moveTo(sx, sy);
  for (const s of segments) {
    if (s.type === 'L') {
      const [x, y] = map(s.x2!, s.y2!);
      target.lineTo(x, y);
    } else if (s.type === 'Q') {
      const [cx, cy] = map(s.x2!, s.y2!);
      const [x, y] = map(s.x3!, s.y3!);
      target.quadraticCurveTo(cx, cy, x, y);
    }
  }
  return target;
}

/**
 * Trace a downsampled RGBA image into per-band vector shapes (used on dialog confirm).
 */
export function traceImage(img: RGBAImage, colors: number, opts: TraceOpts = {}): TraceResult {
  const widthMM = opts.widthMM ?? 50;
  const { layers, palette, width: W, height: H } = traceLayers(img, colors, opts);

  // Pixel → local mm (centred, Y flipped so image-down maps to world-up).
  const physW = widthMM;
  const physH = widthMM * (H / Math.max(1, W));
  const map = (px: number, py: number): [number, number] => [
    (px / W - 0.5) * physW,
    (0.5 - py / H) * physH,
  ];

  const shapes: TracedBandShape[] = [];
  layers.forEach((layer, layerIdx) => {
    const band = layerIdx - 1; // layer 0 is the transparent sentinel
    if (band < 0 || band >= palette.length) return;
    layer.forEach((path) => {
      if (path.isholepath) return; // consumed as a hole of its parent
      const shape = buildPath(new THREE.Shape(), path.segments, map);
      (path.holechildren || []).forEach((hi) => {
        const hole = layer[hi];
        if (hole) shape.holes.push(buildPath(new THREE.Path(), hole.segments, map));
      });
      shapes.push({ shape, color: palette[band], band });
    });
  });

  return { shapes, palette };
}
