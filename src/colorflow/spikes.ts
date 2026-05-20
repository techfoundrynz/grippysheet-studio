import type { ExtrudedGeometry } from './pipeline/extrude';
import { extrudePolygon } from './pipeline/extrude';

export interface TileAssignment {
  /** Tile center in world mm. */
  x: number;
  y: number;
  /** Rotation in radians (CCW). */
  rotation: number;
  /** Scale factor applied to the shape polygon. */
  scale: number;
  /** Index into the palette; -1 means "no color region under this tile". */
  colorIndex: number;
}

export type Polygon = { outer: Array<[number, number]>; holes: Array<Array<[number, number]>> };

/**
 * Standard ray-casting point-in-polygon test against a single ring.
 * Holes are NOT subtracted by this function; pass holes separately if you need
 * inside-with-hole-subtraction semantics.
 */
export function pointInRing(x: number, y: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-30) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Point-in-polygon with holes subtracted (outer minus holes). */
export function pointInPolygon(x: number, y: number, polygon: Polygon): boolean {
  if (!pointInRing(x, y, polygon.outer)) return false;
  for (const hole of polygon.holes) {
    if (pointInRing(x, y, hole)) return false;
  }
  return true;
}

/**
 * Resolve the auto value (0) of `spikeMaxMm` into a concrete top-Z. Auto is
 * defined as `baseMm + N×colorLayerMm + 1.0`, leaving 1mm of grip height above
 * the tallest color region. A non-zero raw value passes through unchanged.
 *
 * Always returns a value strictly greater than `baseMm` so spikes that fall
 * outside any color region (resting at z=baseMm) still produce a non-degenerate
 * extrusion.
 */
export function effectiveSpikeMaxMm(
  rawSpikeMaxMm: number,
  baseMm: number,
  numColors: number,
  colorLayerMm: number,
): number {
  const auto = baseMm + numColors * colorLayerMm + 1.0;
  const resolved = rawSpikeMaxMm > 0 ? rawSpikeMaxMm : auto;
  const minTop = baseMm + numColors * colorLayerMm + 0.1;
  return Math.max(resolved, minTop);
}

/**
 * For each tile, find the topmost color region that contains it (preference goes
 * to the color with the highest stack position, which is the visually-topmost
 * color at that tile location). Tiles outside every color region get colorIndex=-1.
 *
 * `colorPolygons` is a multi-polygon-per-color list — one entry per traced
 * region (a single color can have multiple disjoint regions, e.g. islands).
 */
export function assignTilesToColors(
  tiles: Array<{ x: number; y: number; rotation: number; scale: number }>,
  colorPolygons: Array<{ centroidIndex: number; polygon: Polygon }>,
  stackOrder: number[],
): TileAssignment[] {
  const positionByCentroid = new Map<number, number>();
  for (let i = 0; i < stackOrder.length; i++) positionByCentroid.set(stackOrder[i], i);

  return tiles.map((t) => {
    let bestColor = -1;
    let bestPos = -1;
    for (const entry of colorPolygons) {
      if (!pointInPolygon(t.x, t.y, entry.polygon)) continue;
      const pos = positionByCentroid.get(entry.centroidIndex) ?? -1;
      if (pos > bestPos) {
        bestPos = pos;
        bestColor = entry.centroidIndex;
      }
    }
    return { x: t.x, y: t.y, rotation: t.rotation, scale: t.scale, colorIndex: bestColor };
  });
}

/**
 * Transform a shape-local polygon (centered around origin in shape coords) into
 * world-mm coords for one tile: scale → rotate → translate.
 */
function transformTilePolygon(
  shape: Polygon,
  tile: { x: number; y: number; rotation: number; scale: number },
): Polygon {
  const cos = Math.cos(tile.rotation);
  const sin = Math.sin(tile.rotation);
  const transform = ([px, py]: [number, number]): [number, number] => {
    const sx = px * tile.scale;
    const sy = py * tile.scale;
    return [sx * cos - sy * sin + tile.x, sx * sin + sy * cos + tile.y];
  };
  return {
    outer: shape.outer.map(transform),
    holes: shape.holes.map((h) => h.map(transform)),
  };
}

/**
 * Build per-color spike geometries. For each color (plus the "no color" group
 * with centroidIndex=-1), merge per-tile extrusions into one combined position
 * + index buffer.
 */
export function buildSpikeGeometriesForColors(
  tileAssignments: TileAssignment[],
  tileShape: Polygon,
  baseMm: number,
  colorLayerMm: number,
  stackOrder: number[],
  spikeMaxMm: number,
): Array<{ centroidIndex: number; geom: ExtrudedGeometry }> {
  const positionByCentroid = new Map<number, number>();
  for (let i = 0; i < stackOrder.length; i++) positionByCentroid.set(stackOrder[i], i);

  // Group tiles by centroidIndex.
  const groups = new Map<number, TileAssignment[]>();
  for (const tile of tileAssignments) {
    const group = groups.get(tile.colorIndex) ?? [];
    group.push(tile);
    groups.set(tile.colorIndex, group);
  }

  const result: Array<{ centroidIndex: number; geom: ExtrudedGeometry }> = [];

  for (const [centroidIndex, tiles] of groups) {
    const pos = centroidIndex >= 0 ? positionByCentroid.get(centroidIndex) ?? -1 : -1;
    const bottomZ = pos >= 0 ? baseMm + (pos + 1) * colorLayerMm : baseMm;
    const topZ = spikeMaxMm;
    if (topZ <= bottomZ + 1e-6) continue;

    // Accumulators
    const positions: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;

    for (const tile of tiles) {
      const polygon = transformTilePolygon(tileShape, tile);
      const ext = extrudePolygon(polygon.outer, polygon.holes, bottomZ, topZ);
      if (!ext) continue;
      const nVerts = ext.positions.length / 3;
      for (let i = 0; i < ext.positions.length; i++) positions.push(ext.positions[i]);
      for (let i = 0; i < ext.indices.length; i++) indices.push(ext.indices[i] + vertexOffset);
      vertexOffset += nVerts;
    }

    if (indices.length === 0) continue;

    result.push({
      centroidIndex,
      geom: {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
      },
    });
  }

  return result;
}
