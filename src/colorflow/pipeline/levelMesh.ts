import type { ExtrudedGeometry } from './extrude';
import { extrudePolygon } from './extrude';
import { unionPolygons, type LayerPolygon } from './polygonUnion';

/**
 * Build a single stacked-level mesh. Inputs are the polygons whose color's
 * stack position is ≥ this level (i.e., the polygons that should be present
 * at this Z slab). They're unioned via clipper to eliminate coincident edges
 * between adjacent same-level polygons, then each disjoint result polygon is
 * extruded as its own closed prism. Disjoint prisms are concatenated into one
 * geometry (manifold by construction, since they share no vertices or edges).
 *
 * Returns null if the union is empty or every prism is degenerate.
 */
export function buildLevelMesh(
  polygons: LayerPolygon[],
  zBottom: number,
  zTop: number,
): ExtrudedGeometry | null {
  if (zTop <= zBottom + 1e-6) return null;
  const merged = unionPolygons(polygons);
  if (merged.length === 0) return null;

  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;
  for (const poly of merged) {
    const m = extrudePolygon(poly.outer, poly.holes, zBottom, zTop);
    if (!m) continue;
    const nVerts = m.positions.length / 3;
    for (let i = 0; i < m.positions.length; i++) positions.push(m.positions[i]);
    for (let i = 0; i < m.indices.length; i++) indices.push(m.indices[i] + vertexOffset);
    vertexOffset += nVerts;
  }
  if (indices.length === 0) return null;
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}
