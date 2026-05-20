import earcut from '../vendor/earcut';

export interface ExtrudedGeometry {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Extrude a 2D polygon (with optional holes) between two Z planes.
 * Returns null if the polygon is degenerate (earcut produces no triangles).
 */
export function extrudePolygon(
  outer: Array<[number, number]>,
  holes: Array<Array<[number, number]>>,
  zBottom: number,
  zTop: number,
): ExtrudedGeometry | null {
  const flat: number[] = [];
  for (const [x, y] of outer) flat.push(x, y);
  const holeStarts: number[] = [];
  for (const hole of holes) {
    if (hole.length < 3) continue;
    holeStarts.push(flat.length / 2);
    for (const [x, y] of hole) flat.push(x, y);
  }
  const triIndices = earcut(flat, holeStarts, 2);
  if (triIndices.length === 0) return null;
  const n = flat.length / 2;

  const positions = new Float32Array(n * 6); // n bottom + n top, each xyz
  for (let i = 0; i < n; i++) {
    positions[i * 3]     = flat[i * 2];
    positions[i * 3 + 1] = flat[i * 2 + 1];
    positions[i * 3 + 2] = zBottom;
    positions[(n + i) * 3]     = flat[i * 2];
    positions[(n + i) * 3 + 1] = flat[i * 2 + 1];
    positions[(n + i) * 3 + 2] = zTop;
  }

  const indices: number[] = [];
  // Top face — use top vertex indices, original winding
  for (let i = 0; i < triIndices.length; i += 3) {
    indices.push(n + triIndices[i], n + triIndices[i + 1], n + triIndices[i + 2]);
  }
  // Bottom face — bottom vertex indices, reversed winding (faces down)
  for (let i = 0; i < triIndices.length; i += 3) {
    indices.push(triIndices[i + 2], triIndices[i + 1], triIndices[i]);
  }

  // Side walls — one quad per edge of each ring.
  // Outer ring (r === 0) is CCW from above; its walls face outward.
  // Hole rings (r > 0) are also CCW in our pipeline (per polygonize.ts),
  // but their walls must face into the cavity rather than away from it, so
  // we flip the triangle winding for them.
  const ringStarts = [0, ...holeStarts];
  const ringEnds = [...holeStarts, n];
  for (let r = 0; r < ringStarts.length; r++) {
    const s = ringStarts[r], e = ringEnds[r];
    const isHole = r > 0;
    for (let i = s; i < e; i++) {
      const next = (i + 1 >= e) ? s : (i + 1);
      if (isHole) {
        indices.push(i, n + next, next);
        indices.push(i, n + i, n + next);
      } else {
        indices.push(i, next, n + next);
        indices.push(i, n + next, n + i);
      }
    }
  }

  return { positions, indices: new Uint32Array(indices) };
}
