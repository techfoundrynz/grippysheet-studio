# Spike placement rework — design

**Date:** 2026-05-27
**Branch:** `colorflow-image-mode`
**Status:** approved-pending-implementation

## Problem

Two user-reported failures in the prod build of the Geometry-tab pattern feature:

1. **Click-to-remove spikes doesn't work in 3D.** `TileRemovalHint` raycasts
   against the CSG-merged pattern mesh (`Pattern_<i>`, a non-indexed
   `BufferGeometry`). `raycaster.intersectObjects()` returns zero hits for that
   mesh despite a valid camera, ray, bounding box, and material — root cause
   never pinned down. A prior gimbal-lock camera fix (ortho `up` was parallel to
   the view direction) was necessary but not sufficient.
2. **The compound "2nd pattern" (extra layers) feature is confusing / not
   working** for the user, who has asked to drop it and focus on spike
   removal + free placement instead.

## Goals

- Reliable click-to-remove of spikes in **both** the 2D preview and the 3D render.
- **Free placement:** click empty deck to add a spike at the exact click point;
  click an existing spike to remove it (toggle). Drag to paint a streak.
- Hide the compound-layer UI without deleting the underlying schema/plumbing
  (so existing projects still load).

## Non-goals

- Removing the `extraLayers` schema, construction, or round-trip code (kept dormant).
- Per-spike rotation/scale editing. Out of scope.
- Snap-to-grid for added spikes (user chose exact placement).

## Approach

Stop raycasting the spike mesh. Intersect the click ray with a flat math plane
at the spike-top surface to get a clean world `(x, y)`. This is immune to the
CSG geometry quirks and works for both the ortho and perspective cameras. It is
also the exact primitive free placement needs.

### Data model (`src/types/schemas.ts`)

Add to the primary-layer settings (and, for uniformity, to `PatternLayerSchema`
so `getPatternLayers` stays homogeneous):

```ts
// GeometrySettings + PatternLayerSchema
addedSpikes: z.array(z.object({ x: z.number(), y: z.number() })).default([]),
```

- `removedTiles: string[]` (existing) — tileKeys of grid spikes the user removed.
- `addedSpikes: {x,y}[]` (new) — free-placed spikes at arbitrary world coords.

`getPatternLayers` pulls `addedSpikes` from `g.addedSpikes` into the synthesized
primary; extras default to `[]`. `stripGeometryRuntime` is unaffected (these are
plain numbers, already serializable).

### Construction (`src/components/ImperativeModel.tsx`)

After `filterRemovedTiles(rawPositions, layer.removedTiles)`, append the layer's
added spikes:

```ts
const positions = [
  ...filterRemovedTiles(rawPositions, layer.removedTiles),
  ...(layer.addedSpikes ?? []).map((p) => ({
    position: new THREE.Vector2(p.x, p.y), rotation: 0, scale: 1,
  })),
];
```

`userData.tilePositions` (cached for hit-testing) records every final position
with an `origin` tag so the click handler can route the toggle. The first
`gridCount` entries (the filtered grid tiles) are `'grid'`; the remainder
(the appended `addedSpikes`) are `'added'`:

```ts
const gridCount = filteredGrid.length;
mesh.userData.tilePositions = positions.map((p, i) => ({
  x: p.position.x, y: p.position.y,
  origin: i < gridCount ? 'grid' : 'added',
}));
```

The 2D viewer's `drawnTilesRef` entries gain the same `{x, y, origin}` fields.

### Toggle helper (shared)

A single pure function both views call:

```ts
// given world (x,y) + the layer's current spike list + radius R
// returns the next { removedTiles, addedSpikes } for that layer
toggleSpikeAt(x, y, positions, removedTiles, addedSpikes, R)
```

Logic:
1. Find nearest spike position within `R`.
2. If nearest is a **grid** spike → add its `tileKey` to `removedTiles`.
3. If nearest is an **added** spike → splice it from `addedSpikes`.
4. If none within `R` → append `{x, y}` to `addedSpikes` (exact point).

`R` = half the tile pitch, derived from the tile footprint (`tileWidth` +
`tileSpacing`) / 2, so a click anywhere inside a cell targets that cell's spike,
and free-adds only happen in genuinely empty gaps (no overlapping smears).

### 3D click (`src/components/interaction/TileRemovalHint.tsx`)

- Build a `THREE.Plane` with normal `+Z` at the pattern's top surface
  (`Pattern_<i>` bbox `max.z`, fallback = base thickness).
- `raycaster.setFromCamera(pointer, camera)` then `ray.intersectPlane(plane, hit)`.
- Hover ring renders at the snapped nearest-spike position (or the raw point when
  in an empty gap, to preview where an add will land).
- Click → `toggleSpikeAt(...)` → `onGeometryChange`.
- **Drag-to-paint:** on pointerdown begin a drag; on pointermove compute `(x,y)`,
  skip if within `R` of a point already toggled this drag (tracked in a `Set`),
  else toggle. Pointerup ends the drag. This lays added spikes ~`R` apart and
  removes grid spikes one-per-cell along the path.

### 2D click (`src/colorflow/TwoDViewer.tsx`)

The 2D path already converts screen→world via its `wx/wy` inverse and hit-tests
`drawnTilesRef`. Reuse that to get `(x,y)` and call the **same** `toggleSpikeAt`.
Drag-paint mirrors the 3D handler.

### Hide compound layers (`src/components/controls/GeometryControls.tsx`)

Remove the `<ExtraLayersSection>` render (and its library-target wiring). Keep
the component, schema, construction, and import/round-trip code dormant. Old
projects with `extraLayers` still load and render; users just can't add new ones.

### Camera fix

Already committed (`500c7fe`): ortho camera at `[0,0,1000]` with `up=[0,1,0]`.
Retained — any raycast in top-down ortho needs a non-degenerate camera basis.

## Testing

- Unit: extend `patternUtils.test.ts` with `toggleSpikeAt` cases — remove grid
  spike, remove added spike, add in gap, radius boundary, near-zero coords.
- Manual (both 2D + 3D): load deck + Pyramid, enable Tile Selection, click a
  spike (removes), click a gap (adds), drag across a row (paints), confirm
  `removedTiles` / `addedSpikes` update and the render matches. Verify 3MF
  round-trip preserves both arrays.

## Risks

- **Plane Z accuracy under perspective iso:** picking spike-top vs spike-base z
  shifts the hit point slightly under the angled camera. Mitigated by using the
  visible top surface; acceptable since `R` is half-pitch.
- **Drag spamming state updates:** throttle to one functional `setGeometrySettings`
  per toggled cell (the per-drag `Set` dedup handles this).
