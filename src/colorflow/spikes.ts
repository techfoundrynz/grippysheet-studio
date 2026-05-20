import * as THREE from 'three';
import type { ExtrudedGeometry } from './pipeline/extrude';
import { extrudePolygon } from './pipeline/extrude';
import { generateTilePositions } from '../utils/patternUtils';
import { shapeToPolygon, type OutlinePolygon } from './outlineToPolygon';
import type { Centroid } from './pipeline/quantize';
import type { TracedLayerEntry } from './workerProtocol';

/** Build a THREE.Shape from an OutlinePolygon so `generateTilePositions` can
 *  use it as a boundary check (matching pattern-mode's edge behavior). */
function outlinePolygonToShape(polygon: OutlinePolygon): THREE.Shape {
  const shape = new THREE.Shape();
  if (polygon.outer.length > 0) {
    const [x0, y0] = polygon.outer[0];
    shape.moveTo(x0, y0);
    for (let i = 1; i < polygon.outer.length; i++) {
      shape.lineTo(polygon.outer[i][0], polygon.outer[i][1]);
    }
    shape.closePath();
  }
  for (const hole of polygon.holes) {
    if (hole.length < 3) continue;
    const path = new THREE.Path();
    const [hx0, hy0] = hole[0];
    path.moveTo(hx0, hy0);
    for (let i = 1; i < hole.length; i++) path.lineTo(hole[i][0], hole[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

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
 * `baseMm + N×colorLayerMm + 0.4` — a subtle 0.4mm of grip relief above the
 * tallest color. Non-zero raw values pass through unchanged. A floor of
 * `+0.1mm` above the tallest color is enforced so non-degenerate extrusions
 * always exist.
 */
export function effectiveSpikeMaxMm(
  rawSpikeMaxMm: number,
  baseMm: number,
  numColors: number,
  colorLayerMm: number,
): number {
  const auto = baseMm + numColors * colorLayerMm + 0.4;
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

/**
 * Build per-color spike geometries from a 3D mesh pattern (e.g. an STL bump like
 * a Pyramid or Dome). For each tile, the source mesh is cloned, scaled by
 * `patternScale` in X/Y, scaled in Z so the spike top lands on `spikeMaxMm`,
 * rotated about Z, and translated so its base sits at the tile's color region
 * top. All instances within a color group are merged into one position+index
 * buffer.
 *
 * The pattern's bottom is anchored to z=0 by translating by -boundingBox.min.z
 * before the per-tile transform. Z scale = (spikeMaxMm - colorTop) / naturalH,
 * so taller colors get shorter spikes — keeping the unified top.
 */
export function buildSpikesFromMesh(
  patternGeom: THREE.BufferGeometry,
  tileAssignments: TileAssignment[],
  baseMm: number,
  colorLayerMm: number,
  stackOrder: number[],
  patternScale: number,
  spikeMaxMm: number,
): Array<{ centroidIndex: number; geom: ExtrudedGeometry }> {
  const posAttr = patternGeom.attributes.position;
  if (!posAttr) return [];
  const sourcePositions = posAttr.array as Float32Array;
  const numVerts = sourcePositions.length / 3;
  if (numVerts === 0) return [];

  // Indices may be present (indexed geom) or absent (each three vertices is a triangle).
  const sourceIndex = patternGeom.index ? (patternGeom.index.array as Uint32Array | Uint16Array) : null;

  // Anchor pattern bottom at z=0; capture natural height for Z scaling.
  if (!patternGeom.boundingBox) patternGeom.computeBoundingBox();
  const bbox = patternGeom.boundingBox!;
  const zOffset = -bbox.min.z;
  const naturalH = Math.max(1e-6, bbox.max.z - bbox.min.z);

  const positionByCentroid = new Map<number, number>();
  for (let i = 0; i < stackOrder.length; i++) positionByCentroid.set(stackOrder[i], i);

  const groups = new Map<number, TileAssignment[]>();
  for (const tile of tileAssignments) {
    const arr = groups.get(tile.colorIndex) ?? [];
    arr.push(tile);
    groups.set(tile.colorIndex, arr);
  }

  const result: Array<{ centroidIndex: number; geom: ExtrudedGeometry }> = [];

  for (const [centroidIndex, tiles] of groups) {
    const pos = centroidIndex >= 0 ? positionByCentroid.get(centroidIndex) ?? -1 : -1;
    const bottomZ = pos >= 0 ? baseMm + (pos + 1) * colorLayerMm : baseMm;
    const spikeHeight = spikeMaxMm - bottomZ;
    if (spikeHeight <= 1e-6) continue;
    const zScale = spikeHeight / naturalH;

    const positions: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;

    for (const tile of tiles) {
      const cos = Math.cos(tile.rotation);
      const sin = Math.sin(tile.rotation);
      const xyScale = tile.scale * patternScale;
      for (let i = 0; i < numVerts; i++) {
        const x = sourcePositions[i * 3] * xyScale;
        const y = sourcePositions[i * 3 + 1] * xyScale;
        const z = (sourcePositions[i * 3 + 2] + zOffset) * zScale;
        const rx = x * cos - y * sin;
        const ry = x * sin + y * cos;
        positions.push(rx + tile.x, ry + tile.y, z + bottomZ);
      }
      if (sourceIndex) {
        for (let i = 0; i < sourceIndex.length; i++) indices.push(sourceIndex[i] + vertexOffset);
      } else {
        for (let i = 0; i < numVerts; i++) indices.push(i + vertexOffset);
      }
      vertexOffset += numVerts;
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

/**
 * End-to-end spike layer generation. Pure function with no React deps so it
 * can run from anywhere (in particular: an App-level useMemo that updates as
 * the Geometry tab is being edited, even while the ColorFlow tab is frozen).
 *
 * Returns an array of per-color spike groups (centroidIndex, merged geom,
 * resolved hex color). Empty when:
 *   - no pattern shape configured
 *   - pattern's footprint is too small
 *   - no tiles fall inside the outline
 *   - palette empty
 *
 * `diag` is a human-readable status line for UI display.
 */
export function generateSpikes(input: {
  outlinePolygon: OutlinePolygon;
  layersInMm: TracedLayerEntry[];
  palette: Centroid[];
  stackOrder: number[];
  baseMm: number;
  colorLayerMm: number;
  patternShape: unknown;
  patternScale: number;
  tileSpacing: number;
  patternMargin: number;
  distribution: 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave' | 'zigzag' | 'warped-grid';
  orientation: 'none' | 'alternate' | 'random' | 'aligned';
  direction: 'horizontal' | 'vertical';
  spikeMaxMm: number;
  spikeColorMatch: boolean;
  fallbackColor: string;
}): { groups: Array<{ centroidIndex: number; geom: ExtrudedGeometry; color: string }>; diag: string } {
  const {
    outlinePolygon, layersInMm, palette, stackOrder, baseMm, colorLayerMm,
    patternShape, patternScale, tileSpacing, patternMargin, distribution, orientation, direction,
    spikeMaxMm, spikeColorMatch, fallbackColor,
  } = input;

  if (!palette.length) return { groups: [], diag: 'no palette yet' };
  if (!patternShape) return { groups: [], diag: 'no pattern tile configured in Geometry tab' };

  const spikeTop = effectiveSpikeMaxMm(spikeMaxMm, baseMm, palette.length, colorLayerMm);

  // Compute tile footprint + a builder function dispatched on the pattern type.
  let tileWidth = 0;
  let tileHeight = 0;
  let buildForColor: ((assignments: TileAssignment[]) => Array<{ centroidIndex: number; geom: ExtrudedGeometry }>) | null = null;

  if (patternShape instanceof THREE.Shape) {
    const tilePoly = shapeToPolygon(patternShape, 32);
    tileWidth = (tilePoly.maxX - tilePoly.minX) * patternScale;
    tileHeight = (tilePoly.maxY - tilePoly.minY) * patternScale;
    if (tileWidth < 0.05 || tileHeight < 0.05) {
      return { groups: [], diag: `pattern tile too small (${tileWidth.toFixed(2)}×${tileHeight.toFixed(2)}mm)` };
    }
    buildForColor = (assignments) => buildSpikeGeometriesForColors(
      assignments, { outer: tilePoly.outer, holes: tilePoly.holes },
      baseMm, colorLayerMm, stackOrder, spikeTop,
    );
  } else if (patternShape instanceof THREE.BufferGeometry) {
    if (!patternShape.boundingBox) patternShape.computeBoundingBox();
    const bbox = patternShape.boundingBox!;
    tileWidth = (bbox.max.x - bbox.min.x) * patternScale;
    tileHeight = (bbox.max.y - bbox.min.y) * patternScale;
    if (tileWidth < 0.05 || tileHeight < 0.05) {
      return { groups: [], diag: `pattern tile too small (${tileWidth.toFixed(2)}×${tileHeight.toFixed(2)}mm)` };
    }
    buildForColor = (assignments) => buildSpikesFromMesh(
      patternShape, assignments, baseMm, colorLayerMm, stackOrder, patternScale, spikeTop,
    );
  } else {
    return { groups: [], diag: `pattern shape type unsupported for spikes (${(patternShape as object).constructor?.name ?? 'unknown'})` };
  }

  const tileBounds = new THREE.Box2(
    new THREE.Vector2(outlinePolygon.minX, outlinePolygon.minY),
    new THREE.Vector2(outlinePolygon.maxX, outlinePolygon.maxY),
  );
  // Pass the outline as the boundary + use patternMargin so generateTilePositions
  // matches pattern-mode's edge handling (no partial tiles spilling past the curve).
  const outlineShape = outlinePolygonToShape(outlinePolygon);
  const rawTiles = generateTilePositions(
    tileBounds, tileWidth, tileHeight, tileSpacing,
    [outlineShape], patternMargin, false, distribution, orientation, direction,
  );
  const outlinePoly = { outer: outlinePolygon.outer, holes: outlinePolygon.holes };
  const tilesInOutline = rawTiles
    .filter((t) => pointInPolygon(t.position.x, t.position.y, outlinePoly))
    .map((t) => ({ x: t.position.x, y: t.position.y, rotation: t.rotation, scale: t.scale ?? 1 }));

  const colorPolygons = layersInMm.map((l) => ({ centroidIndex: l.centroidIndex, polygon: l.polygon }));
  const tileAssignments = assignTilesToColors(tilesInOutline, colorPolygons, stackOrder);
  const rawGroups = buildForColor(tileAssignments);

  const groups: Array<{ centroidIndex: number; geom: ExtrudedGeometry; color: string }> = [];
  for (const g of rawGroups) {
    const c = g.centroidIndex >= 0 ? palette[g.centroidIndex] : null;
    const color = spikeColorMatch && c
      ? `#${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`
      : fallbackColor;
    groups.push({ ...g, color });
  }

  const diag = `${rawTiles.length} tiles raw, ${tilesInOutline.length} inside outline, ${rawGroups.length} color groups`;
  return { groups, diag };
}
