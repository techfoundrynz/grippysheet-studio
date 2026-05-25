import * as THREE from 'three';
import type { ExtrudedGeometry } from './pipeline/extrude';
import { extrudePolygon } from './pipeline/extrude';
import { generateTilePositions } from '../utils/patternUtils';
import { shapeToPolygon, type OutlinePolygon } from './outlineToPolygon';
import type { Centroid } from './pipeline/quantize';
import type { TracedLayerEntry } from './workerProtocol';

/** 2D convex hull (Andrew's monotone chain). Used to derive a tight 2D
 *  footprint for STL pattern shapes — the bbox alone over-rejects round
 *  patterns like Dome/Cone whose corners are air, falsely dropping tiles
 *  near colour boundaries. */
function convexHull2D(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/** Cache: pattern BufferGeometry → 2D convex hull in shape-local mm. */
const footprintCache = new WeakMap<THREE.BufferGeometry, Array<[number, number]>>();

function stlXyFootprint(patternGeom: THREE.BufferGeometry): Array<[number, number]> | null {
  const cached = footprintCache.get(patternGeom);
  if (cached) return cached;
  const posAttr = patternGeom.attributes.position;
  if (!posAttr) return null;
  const arr = posAttr.array as Float32Array;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < arr.length; i += 3) pts.push([arr[i], arr[i + 1]]);
  const hull = convexHull2D(pts);
  footprintCache.set(patternGeom, hull);
  return hull;
}

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
 * `baseMm + N×colorLayerMm + 1.5` — 1.5mm of grip relief above the tallest
 * color, so the topmost (often largest-coverage) colour still ends up with
 * a meaningful, feel-it-with-your-foot bump rather than a sub-mm nub.
 * Shorter colours get correspondingly taller spikes (each grounded on its
 * own colour's slab, all topping out at the same Z). Non-zero raw values
 * pass through unchanged. A floor of `+0.5mm` above the tallest color is
 * enforced so non-degenerate extrusions always exist.
 */
export function effectiveSpikeMaxMm(
  rawSpikeMaxMm: number,
  baseMm: number,
  numColors: number,
  colorLayerMm: number,
): number {
  const auto = baseMm + numColors * colorLayerMm + 1.5;
  const resolved = rawSpikeMaxMm > 0 ? rawSpikeMaxMm : auto;
  const minTop = baseMm + numColors * colorLayerMm + 0.5;
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

  // Per-color grounding (preserves the per-LEVEL stair-step topography):
  // each tile rises from the top of its assigned colour's slab. Tiles outside
  // any colour region (centroidIndex === -1) — typically alpha=0 pixels in
  // the source image, i.e. the user's transparent background — get grounded
  // on the base itself. Without this, transparent-background designs lose
  // all their spike coverage. Boundary clipping (so tile footprints never
  // overhang into a shorter adjacent column) happens upstream in
  // `generateSpikes`.
  for (const [centroidIndex, tiles] of groups) {
    const pos = centroidIndex >= 0 ? (positionByCentroid.get(centroidIndex) ?? -1) : -1;
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

  // Per-color grounding (see buildSpikeGeometriesForColors). Each spike rises
  // from the top of its colour's slab. Tiles in alpha=0 source pixels (no
  // traced colour) ground on the base itself so transparent-background
  // designs still get spike coverage. Boundary clipping happens upstream.
  for (const [centroidIndex, tiles] of groups) {
    const pos = centroidIndex >= 0 ? (positionByCentroid.get(centroidIndex) ?? -1) : -1;
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

  // Compute tile footprint + a builder function dispatched on the pattern
  // type, plus the local 2D outline we'll use to clip tiles whose footprint
  // would overhang into a shorter adjacent column. For Shape patterns we use
  // the actual outline; for STL patterns we use the bbox rectangle (the
  // tightest approximation that doesn't require a per-frame convex hull).
  let tileWidth = 0;
  let tileHeight = 0;
  let localFootprint: Array<[number, number]> = [];
  let footprintExtraScale = 1;
  let buildForColor: ((assignments: TileAssignment[]) => Array<{ centroidIndex: number; geom: ExtrudedGeometry }>) | null = null;

  if (patternShape instanceof THREE.Shape) {
    const tilePoly = shapeToPolygon(patternShape, 32);
    tileWidth = (tilePoly.maxX - tilePoly.minX) * patternScale;
    tileHeight = (tilePoly.maxY - tilePoly.minY) * patternScale;
    if (tileWidth < 0.05 || tileHeight < 0.05) {
      return { groups: [], diag: `pattern tile too small (${tileWidth.toFixed(2)}×${tileHeight.toFixed(2)}mm)` };
    }
    localFootprint = tilePoly.outer;
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
    // Use the actual XY-projected convex hull of the STL — the bbox alone
    // is wrong for round / curved patterns (Dome, Stud, Cone, etc.) whose
    // bbox corners sit in empty air and would falsely reject most tiles
    // near colour boundaries.
    const hull = stlXyFootprint(patternShape);
    localFootprint = hull && hull.length >= 3 ? hull : [
      [bbox.min.x, bbox.min.y],
      [bbox.max.x, bbox.min.y],
      [bbox.max.x, bbox.max.y],
      [bbox.min.x, bbox.max.y],
    ];
    footprintExtraScale = patternScale;
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

  // We deliberately do NOT filter tiles whose footprint overhangs the
  // adjacent (shorter) column anymore — the user values 3D-density matching
  // the 2D preview more than they value perfect tile-to-colour containment.
  // Spikes whose centres land on a tall colour will overhang shorter
  // neighbours visually, but the alternative (clipping such tiles) loses
  // significant density on busy designs. The convex-hull footprint helper
  // above is preserved for future use (e.g. an opt-in "Clip overhang" mode).
  void localFootprint; void footprintExtraScale;
  const rawGroups = buildForColor(tileAssignments);

  const groups: Array<{ centroidIndex: number; geom: ExtrudedGeometry; color: string }> = [];
  for (const g of rawGroups) {
    const c = g.centroidIndex >= 0 ? palette[g.centroidIndex] : null;
    const color = spikeColorMatch && c
      ? `#${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`
      : fallbackColor;
    groups.push({ ...g, color });
  }

  const diag = `${rawTiles.length} raw / ${tilesInOutline.length} in outline / ${tileAssignments.length} assigned / ${rawGroups.length} groups`;
  return { groups, diag };
}
