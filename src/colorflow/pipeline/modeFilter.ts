/** Kernel sizes for simplify levels 0..4. Matches STRATA's labels (off / light / medium / strong / max). */
export const SIMPLIFY_KERNELS: readonly number[] = [0, 3, 5, 9, 15];

/**
 * Sliding-window categorical mode filter. For each pixel, output the
 * most common category in a kernelSize x kernelSize window. Treats 0xFFFF
 * (transparent) as its own category so it can be smoothed too.
 *
 * Returns a new Uint16Array for kernelSize >= 1. For kernelSize === 0 the input
 * is returned by reference (callers should not mutate the result they receive).
 */
export function modeFilter(
  assignments: Uint16Array,
  w: number,
  h: number,
  kernelSize: number,
  numCategories: number,
): Uint16Array {
  if (kernelSize === 0) return assignments;
  const radius = (kernelSize - 1) >> 1;
  const out = new Uint16Array(assignments.length);
  const TRANS = numCategories;
  const numBuckets = numCategories + 1;

  for (let y = 0; y < h; y++) {
    const hist = new Uint32Array(numBuckets);
    for (let dy = -radius; dy <= radius; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = dx;
        if (nx < 0 || nx >= w) continue;
        let v = assignments[ny * w + nx];
        if (v === 0xFFFF) v = TRANS;
        hist[v]++;
      }
    }

    let bestCount = 0, mode = 0;
    for (let b = 0; b < numBuckets; b++) {
      if (hist[b] > bestCount) { bestCount = hist[b]; mode = b; }
    }
    out[y * w] = (mode === TRANS) ? 0xFFFF : mode;

    for (let x = 1; x < w; x++) {
      const xRem = x - 1 - radius;
      const xAdd = x + radius;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        if (xRem >= 0) {
          let v = assignments[ny * w + xRem];
          if (v === 0xFFFF) v = TRANS;
          hist[v]--;
        }
        if (xAdd < w) {
          let v = assignments[ny * w + xAdd];
          if (v === 0xFFFF) v = TRANS;
          hist[v]++;
        }
      }
      bestCount = 0; mode = 0;
      for (let b = 0; b < numBuckets; b++) {
        if (hist[b] > bestCount) { bestCount = hist[b]; mode = b; }
      }
      out[y * w + x] = (mode === TRANS) ? 0xFFFF : mode;
    }
  }
  return out;
}
