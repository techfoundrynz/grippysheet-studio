import { describe, it, expect } from 'vitest';
import { buildLevelMesh } from '../pipeline/levelMesh';
import type { LayerPolygon } from '../pipeline/polygonUnion';

// Weld vertices that lie within `eps` of one another, then return a new
// `indices` array remapped to the welded positions. This is what slicers do
// on import, so manifold-ness must hold after this transform.
function weldedIndices(positions: Float32Array, indices: Uint32Array, eps: number): Uint32Array {
  const n = positions.length / 3;
  const map = new Int32Array(n);
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    let found = -1;
    for (const k of keep) {
      if (
        Math.abs(positions[i * 3] - positions[k * 3]) < eps
        && Math.abs(positions[i * 3 + 1] - positions[k * 3 + 1]) < eps
        && Math.abs(positions[i * 3 + 2] - positions[k * 3 + 2]) < eps
      ) {
        found = k;
        break;
      }
    }
    if (found < 0) {
      keep.push(i);
      map[i] = i;
    } else {
      map[i] = found;
    }
  }
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) out[i] = map[indices[i]];
  return out;
}

function edgeCounts(indices: Uint32Array): Map<string, number> {
  const counts = new Map<string, number>();
  const k = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      counts.set(k(u, v), (counts.get(k(u, v)) ?? 0) + 1);
    }
  }
  return counts;
}

describe('buildLevelMesh', () => {
  it('produces a manifold-after-weld mesh for two adjacent polygons', () => {
    const polygons: LayerPolygon[] = [
      { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] },
      { outer: [[1, 0], [2, 0], [2, 1], [1, 1]], holes: [] },
    ];
    const mesh = buildLevelMesh(polygons, 0, 1);
    expect(mesh).not.toBeNull();
    const welded = weldedIndices(mesh!.positions, mesh!.indices, 1e-4);
    const counts = edgeCounts(welded);
    const nonManifold = [...counts.values()].filter((c) => c !== 2);
    expect(nonManifold).toEqual([]);
  });

  it('produces a manifold-after-weld mesh for two disjoint polygons', () => {
    const polygons: LayerPolygon[] = [
      { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] },
      { outer: [[5, 5], [6, 5], [6, 6], [5, 6]], holes: [] },
    ];
    const mesh = buildLevelMesh(polygons, 0, 1);
    expect(mesh).not.toBeNull();
    const welded = weldedIndices(mesh!.positions, mesh!.indices, 1e-4);
    const counts = edgeCounts(welded);
    const nonManifold = [...counts.values()].filter((c) => c !== 2);
    expect(nonManifold).toEqual([]);
  });

  it('returns null for an empty polygon list', () => {
    expect(buildLevelMesh([], 0, 1)).toBeNull();
  });

  it('returns null for a zero-thickness slab', () => {
    const polygons: LayerPolygon[] = [
      { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] },
    ];
    expect(buildLevelMesh(polygons, 0, 0)).toBeNull();
  });
});
