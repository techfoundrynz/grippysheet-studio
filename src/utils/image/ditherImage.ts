import type { TracePath } from 'imagetracerjs';
import type { RGBAImage, TraceLayers } from './traceImage';

export const MAX_DITHER_DETAIL = 480;
export const DITHER_METHODS = [
  { value: 'floyd-steinberg', label: 'Floyd–Steinberg', description: 'Fine, evenly distributed dots.' },
  { value: 'atkinson', label: 'Atkinson', description: 'Crisp highlights and stronger contrast.' },
  { value: 'jarvis', label: 'Jarvis–Judice–Ninke', description: 'Softer dot clusters and smooth gradients.' },
  { value: 'bayer4', label: 'Ordered Bayer 4×4', description: 'A repeating geometric dot pattern.' },
  { value: 'bayer8', label: 'Ordered Bayer 8×8', description: 'A finer repeating pattern with more tonal steps.' },
  { value: 'threshold', label: 'Threshold (no dithering)', description: 'Solid shapes with a simple light/dark cutoff.' },
] as const;
export type DitherMethod = typeof DITHER_METHODS[number]['value'];

// [dx, dy, weight]. Atkinson deliberately distributes only 6/8 of the error.
const kernels: Partial<Record<DitherMethod, readonly (readonly [number, number, number])[]>> = {
  'floyd-steinberg': [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
  atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
  jarvis: [[1, 0, 7 / 48], [2, 0, 5 / 48], [-2, 1, 3 / 48], [-1, 1, 5 / 48], [0, 1, 7 / 48], [1, 1, 5 / 48], [2, 1, 3 / 48], [-2, 2, 1 / 48], [-1, 2, 3 / 48], [0, 2, 5 / 48], [1, 2, 3 / 48], [2, 2, 1 / 48]],
};

function bayer(size: number): number[][] {
  let matrix = [[0]];
  while (matrix.length < size) {
    const n = matrix.length;
    matrix = Array.from({ length: n * 2 }, (_, y) => Array.from({ length: n * 2 }, (_, x) =>
      matrix[y % n][x % n] * 4 + [[0, 2], [3, 1]][Math.floor(y / n)][Math.floor(x / n)]));
  }
  return matrix;
}
const bayer4 = bayer(4), bayer8 = bayer(8);

/** Single-colour dot geometry: light and transparent pixels leave the underlying base visible. */
export function ditherLayers(img: RGBAImage, detail = 64, method: DitherMethod = 'floyd-steinberg', color = '#000000'): TraceLayers {
  const scale = Math.min(1, Math.max(16, Math.min(MAX_DITHER_DETAIL, Math.round(detail))) / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const values = new Float32Array(width * height);
  const opaque = new Uint8Array(width * height);

  // Area sampling keeps thin features and averages tones before error diffusion.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let luminance = 0, alpha = 0, samples = 0;
      for (let sy = Math.floor(y * img.height / height); sy < Math.floor((y + 1) * img.height / height); sy++) {
        for (let sx = Math.floor(x * img.width / width); sx < Math.floor((x + 1) * img.width / width); sx++) {
          const i = (sy * img.width + sx) * 4;
          const a = img.data[i + 3] / 255;
          luminance += a * (0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]);
          alpha += a;
          samples++;
        }
      }
      const i = y * width + x;
      opaque[i] = alpha / samples >= 0.5 ? 1 : 0;
      values[i] = alpha ? luminance / alpha : 255;
    }
  }

  const bands = new Int8Array(width * height).fill(-1);
  const kernel = kernels[method] ?? [];
  const ordered = method === 'bayer4' ? bayer4 : method === 'bayer8' ? bayer8 : null;
  const diffuse = (x: number, y: number, error: number, weight: number) => {
    if (x >= 0 && x < width && y < height && opaque[y * width + x]) {
      values[y * width + x] += error * weight;
    }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!opaque[i]) continue;
      const threshold = ordered ? (ordered[y % ordered.length][x % ordered.length] + 0.5) * 255 / (ordered.length ** 2) : 127.5;
      const band = values[i] >= threshold ? 1 : 0;
      bands[i] = band;
      const error = values[i] - band * 255;
      for (const [dx, dy, weight] of kernel) diffuse(x + dx, y + dy, error, weight);
    }
  }

  // Exact rectangles preserve every dot; merge identical runs vertically to reduce solids.
  const layers: TracePath[][] = [[], []];
  let previous = new Map<string, TracePath>();
  for (let y = 0; y < height; y++) {
    const current = new Map<string, TracePath>();
    for (let x = 0; x < width;) {
      const start = x, band = bands[y * width + x];
      while (x < width && bands[y * width + x] === band) x++;
      if (band !== 0) continue;
      const key = `${band}:${start}:${x}`;
      const existing = previous.get(key);
      const top = existing ? existing.boundingbox[1] : y;
      const path: TracePath = existing ?? { segments: [], isholepath: false, holechildren: [], boundingbox: [start, top, x, y + 1] };
      path.boundingbox[3] = y + 1;
      const corners = [[start, top], [x, top], [x, y + 1], [start, y + 1], [start, top]];
      path.segments = corners.slice(0, 4).map(([x1, y1], i) => ({ type: 'L', x1, y1, x2: corners[i + 1][0], y2: corners[i + 1][1] }));
      if (!existing) layers[band + 1].push(path);
      current.set(key, path);
    }
    previous = current;
  }
  return { layers, palette: [color], width, height };
}

/** Keep generated geometry as an SVG asset so project bundles can restore it. */
export function ditherSVG(data: TraceLayers, widthMM = 50): string {
  const rects = data.layers.flatMap((layer, li) => layer.map(({ boundingbox: [x1, y1, x2, y2] }) =>
    `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="${data.palette[li - 1]}"/>`));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMM}mm" height="${widthMM * data.height / data.width}mm" viewBox="0 0 ${widthMM} ${widthMM * data.height / data.width}"><g transform="scale(${widthMM / data.width})">${rects.join('')}</g></svg>`;
}
