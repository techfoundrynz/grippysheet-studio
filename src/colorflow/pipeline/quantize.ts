export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface Centroid extends RGB {
  /** Index into the palette array; the same index used in the assignments map. */
  index: number;
}

/**
 * K-means++ color quantization. `random()` should return [0, 1).
 * Adapted from STRATA / public-domain implementations.
 */
export function kmeans(imageData: ImageData, k: number, random: () => number): Centroid[] {
  const data = imageData.data;
  const total = imageData.width * imageData.height;
  const pixels = new Float32Array(total * 3);
  let count = 0;
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] < 200) continue;
    pixels[count * 3] = data[i * 4];
    pixels[count * 3 + 1] = data[i * 4 + 1];
    pixels[count * 3 + 2] = data[i * 4 + 2];
    count++;
  }

  if (count === 0) {
    return Array.from({ length: k }, (_, i) => ({ r: 128, g: 128, b: 128, index: i }));
  }

  const cents = new Float32Array(k * 3);
  const firstIdx = Math.floor(random() * count);
  cents[0] = pixels[firstIdx * 3];
  cents[1] = pixels[firstIdx * 3 + 1];
  cents[2] = pixels[firstIdx * 3 + 2];

  const distSq = new Float32Array(count);
  for (let c = 1; c < k; c++) {
    let totalDist = 0;
    for (let i = 0; i < count; i++) {
      let best = Infinity;
      for (let j = 0; j < c; j++) {
        const dr = pixels[i * 3] - cents[j * 3];
        const dg = pixels[i * 3 + 1] - cents[j * 3 + 1];
        const db = pixels[i * 3 + 2] - cents[j * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < best) best = d;
      }
      distSq[i] = best;
      totalDist += best;
    }
    if (totalDist === 0) {
      cents[c * 3] = cents[(c - 1) * 3];
      cents[c * 3 + 1] = cents[(c - 1) * 3 + 1];
      cents[c * 3 + 2] = cents[(c - 1) * 3 + 2];
      continue;
    }
    let r = random() * totalDist;
    for (let i = 0; i < count; i++) {
      r -= distSq[i];
      if (r <= 0) {
        cents[c * 3] = pixels[i * 3];
        cents[c * 3 + 1] = pixels[i * 3 + 1];
        cents[c * 3 + 2] = pixels[i * 3 + 2];
        break;
      }
    }
  }

  const assign = new Uint8Array(count);
  const sums = new Float32Array(k * 3);
  const counts = new Uint32Array(k);
  const MAX_ITER = 20;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let changed = 0;
    for (let i = 0; i < count; i++) {
      let best = Infinity, bestIdx = 0;
      for (let j = 0; j < k; j++) {
        const dr = pixels[i * 3] - cents[j * 3];
        const dg = pixels[i * 3 + 1] - cents[j * 3 + 1];
        const db = pixels[i * 3 + 2] - cents[j * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < best) { best = d; bestIdx = j; }
      }
      if (assign[i] !== bestIdx) { assign[i] = bestIdx; changed++; }
    }
    if (iter > 0 && changed === 0) break;
    sums.fill(0); counts.fill(0);
    for (let i = 0; i < count; i++) {
      const a = assign[i];
      sums[a * 3] += pixels[i * 3];
      sums[a * 3 + 1] += pixels[i * 3 + 1];
      sums[a * 3 + 2] += pixels[i * 3 + 2];
      counts[a]++;
    }
    for (let j = 0; j < k; j++) {
      if (counts[j] > 0) {
        cents[j * 3] = sums[j * 3] / counts[j];
        cents[j * 3 + 1] = sums[j * 3 + 1] / counts[j];
        cents[j * 3 + 2] = sums[j * 3 + 2] / counts[j];
      }
    }
  }

  const result: Centroid[] = [];
  for (let j = 0; j < k; j++) {
    result.push({
      r: Math.round(cents[j * 3]),
      g: Math.round(cents[j * 3 + 1]),
      b: Math.round(cents[j * 3 + 2]),
      index: j,
    });
  }
  return result;
}

/**
 * Assigns each pixel to the nearest centroid; returns a Uint16Array
 * where 0xFFFF means "skip" (mask says outside outline, or alpha low).
 */
export function assignAll(
  imageData: ImageData,
  centroids: Centroid[],
  mask: Uint8Array | null,
): Uint16Array {
  const data = imageData.data;
  const n = imageData.width * imageData.height;
  const out = new Uint16Array(n);
  const k = centroids.length;
  const cr = new Float32Array(k), cg = new Float32Array(k), cb = new Float32Array(k);
  for (let j = 0; j < k; j++) { cr[j] = centroids[j].r; cg[j] = centroids[j].g; cb[j] = centroids[j].b; }
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) { out[i] = 0xFFFF; continue; }
    if (data[i * 4 + 3] < 200) { out[i] = 0xFFFF; continue; }
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    let best = Infinity, bestIdx = 0;
    for (let j = 0; j < k; j++) {
      const dr = r - cr[j], dg = g - cg[j], db = b - cb[j];
      const d = dr * dr + dg * dg + db * db;
      if (d < best) { best = d; bestIdx = j; }
    }
    out[i] = bestIdx;
  }
  return out;
}

/**
 * Count post-simplify pixel assignments per palette index. Transparent pixels
 * (0xFFFF) are skipped. Returns an array of length === palette.length.
 */
export function paletteCoverage(
  assignments: Uint16Array,
  palette: Centroid[],
): number[] {
  const counts = new Array<number>(palette.length).fill(0);
  for (let i = 0; i < assignments.length; i++) {
    const v = assignments[i];
    if (v !== 0xFFFF && v < counts.length) counts[v]++;
  }
  return counts;
}
