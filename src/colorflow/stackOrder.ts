import type { Centroid } from './pipeline/quantize';

export interface StackOrderInput {
  sort: 'luma' | 'coverage';
  layerOrder: number[] | null;
}

/**
 * Return palette indices in stack order (first = nearest to base, last = tallest).
 * Honors `layerOrder` if its length matches palette; otherwise sorts by
 * luma ascending (dark → light) or coverage descending (dominant → minor).
 */
export function resolvedStackOrder(
  palette: Centroid[],
  coverage: number[],
  settings: StackOrderInput,
): number[] {
  if (settings.layerOrder && settings.layerOrder.length === palette.length) {
    return [...settings.layerOrder];
  }
  const withMeta = palette.map((c, i) => ({
    i,
    luma: 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b,
    coverage: coverage[i] ?? 0,
  }));
  if (settings.sort === 'luma') {
    withMeta.sort((a, b) => a.luma - b.luma);
  } else {
    withMeta.sort((a, b) => b.coverage - a.coverage);
  }
  return withMeta.map((m) => m.i);
}
