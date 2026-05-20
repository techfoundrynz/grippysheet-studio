# ColorFlow 3MF Surgical Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ColorFlow 3MF export usable in BambuStudio/OrcaSlicer: (a) each part imports with its assigned filament color (no more gray meshes), and (b) the slicer no longer reports "non-manifold edges" on the exported assembly.

**Architecture:** Two surgical changes — the worker computes a Clipper-based polygon **union** per stacked level before extruding, so each level's mesh is a closed multi-shell manifold instead of N independently-extruded prisms with coincident side walls; and the 3MF writer emits the standard 3MF **Materials and Properties** extension (`<m:basematerials>` + per-triangle `pid`/`p1` bindings), driven by an explicit `color` field on each `MeshPart`. The caller (`OutputPanel.tsx`) supplies the hex color for base, color levels, and spike groups. No CSG; no Bambu-proprietary metadata.

**Tech Stack:** TypeScript, Vitest, `clipper-lib` (already a dep, integer-scaled boolean ops), `jszip` (already a dep, 3MF packaging). No new deps.

**Spec reference:** Brief conversation-level spec — see `Background` section below for the full rationale.

**Repository quirk:** the git repository is rooted at `/home/ubuntu/grippy/grippysheet-studio/` and this work happens in the worktree at `/home/ubuntu/grippy/grippysheet-studio/.worktrees/colorflow-image-mode` (branch `colorflow-image-mode`). All commands below assume `cd /home/ubuntu/grippy/grippysheet-studio/.worktrees/colorflow-image-mode`.

**Subagent safety note:** Never run `git reset --hard`, `git clean -fd`, `rm -rf` on tracked files, or `git checkout -- .` to "make a commit work." If a commit fails, investigate the root cause (usually staged + unstaged mixed, or hook failure). Stage explicit files only.

---

## Background

The current ColorFlow 3MF export has three problems when opened in BambuStudio:

1. **No color information.** `threeMfWriter.ts` emits raw `<vertices>` + `<triangles>` with the hex stored only in the part name (`name="color_1_ff0000"`). Bambu's "Load filaments from project" doesn't parse hex out of names — it reads the standard 3MF Materials extension. We supply neither that nor Bambu's proprietary `model_settings.config`, so the slicer shows gray meshes.

2. **Non-manifold edges.** In `worker.ts:handleExtrude` (the stacked-level model), each level *k* concatenates the result of `extrudePolygon(...)` for every traced polygon whose stack-pos ≥ *k*. Where two color regions share a boundary in the image, their polygons share that boundary edge — and each is extruded as its own closed prism. The shared edge ends up with 4 incident wall triangles (2 from each prism). Textbook non-manifold.

3. **Sub-parts list is long.** Each color level + spike group is its own top-level `<object>`. With many spikes, BambuStudio's sub-parts panel becomes unwieldy. *Out of scope for this plan* — the user confirmed it stops being a problem once parts are properly colored.

The fix:
- **Problem 2:** Compute Clipper-union of polygons within a level *before* calling `extrudePolygon`. Where multiple input polygons touch, Clipper merges them into one outline; where they're truly disjoint, the union returns multiple disjoint polygons, each extruded independently into its own closed prism (still manifold, just multi-shell within one geometry).
- **Problem 1:** Add `xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"` to `<model>`, emit one `<m:basematerials id="1">` with one `<m:base name="..." displaycolor="#XXXXXX"/>` per `MeshPart`, and write `pid="1" p1="<index>"` on every `<triangle>`. The `MeshPart` type gains a required `color: string` field; `OutputPanel.tsx` supplies it (base color from `baseSettings.color`, color levels from each centroid's hex, spike groups from `spike.color` which already exists).

---

## Task 1: Add `polygonUnion` helper

**Files:**
- Create: `src/colorflow/pipeline/polygonUnion.ts`
- Test: `src/colorflow/__tests__/polygonUnion.test.ts`

This task introduces a pure helper that takes a list of polygons (outer + holes, plain arrays) and returns the boolean union as one or more disjoint polygons. It uses `clipper-lib` (already a dep) with integer scaling for precision.

- [ ] **Step 1: Write failing test for single-polygon pass-through**

Create `src/colorflow/__tests__/polygonUnion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { unionPolygons } from '../pipeline/polygonUnion';

describe('unionPolygons', () => {
  it('returns a single polygon unchanged (topologically)', () => {
    const result = unionPolygons([
      { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].holes).toEqual([]);
    // Polygon area ≈ 1 (within Clipper's integer-rounding tolerance)
    const area = polygonArea(result[0].outer);
    expect(Math.abs(area - 1)).toBeLessThan(0.01);
  });
});

function polygonArea(ring: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}
```

- [ ] **Step 2: Run test — should fail because `unionPolygons` doesn't exist**

Run: `pnpm test:run -- src/colorflow/__tests__/polygonUnion.test.ts`
Expected: FAIL with "Cannot find module '../pipeline/polygonUnion'" (or similar).

- [ ] **Step 3: Create minimal `polygonUnion.ts`**

Create `src/colorflow/pipeline/polygonUnion.ts`:

```ts
import ClipperLib from 'clipper-lib';

export interface LayerPolygon {
  outer: Array<[number, number]>;
  holes: Array<Array<[number, number]>>;
}

const SCALE = 1000;

function ringToPath(ring: Array<[number, number]>): Array<{ X: number; Y: number }> {
  return ring.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
}

function pathToRing(path: Array<{ X: number; Y: number }>): Array<[number, number]> {
  return path.map((p) => [p.X / SCALE, p.Y / SCALE] as [number, number]);
}

/**
 * Compute the boolean union of multiple polygons (each with optional holes).
 * Returns a set of disjoint, non-touching polygons. Coincident edges between
 * inputs are eliminated; truly overlapping inputs are merged.
 *
 * Empty input yields an empty array. Degenerate inputs (rings with < 3 points)
 * are skipped.
 */
export function unionPolygons(polygons: LayerPolygon[]): LayerPolygon[] {
  if (polygons.length === 0) return [];

  const clipper = new ClipperLib.Clipper();
  for (const poly of polygons) {
    if (poly.outer.length < 3) continue;
    clipper.AddPath(ringToPath(poly.outer), ClipperLib.PolyType.ptSubject, true);
    for (const hole of poly.holes) {
      if (hole.length < 3) continue;
      clipper.AddPath(ringToPath(hole), ClipperLib.PolyType.ptSubject, true);
    }
  }

  const tree = new ClipperLib.PolyTree();
  const ok = clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  if (!ok) return [];

  const result: LayerPolygon[] = [];
  // Top-level children of the PolyTree are outer rings; their children are holes.
  for (const outerNode of tree.Childs()) {
    const outer = pathToRing(outerNode.Contour());
    if (outer.length < 3) continue;
    const holes: Array<Array<[number, number]>> = [];
    for (const holeNode of outerNode.Childs()) {
      const hole = pathToRing(holeNode.Contour());
      if (hole.length >= 3) holes.push(hole);
    }
    result.push({ outer, holes });
  }
  return result;
}
```

- [ ] **Step 4: Run the test to verify single-polygon case passes**

Run: `pnpm test:run -- src/colorflow/__tests__/polygonUnion.test.ts`
Expected: PASS.

- [ ] **Step 5: Add failing test for two-adjacent-squares merge**

Append to `src/colorflow/__tests__/polygonUnion.test.ts` (inside the same `describe` block):

```ts
  it('merges two adjacent squares sharing an edge into one rectangle', () => {
    const result = unionPolygons([
      { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] },
      { outer: [[1, 0], [2, 0], [2, 1], [1, 1]], holes: [] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].holes).toEqual([]);
    // Combined area ≈ 2
    const area = polygonArea(result[0].outer);
    expect(Math.abs(area - 2)).toBeLessThan(0.01);
    // The merged polygon should have 4 corners (rectangle), not 8.
    // Clipper sometimes leaves a collinear vertex on the shared edge — allow up to 6.
    expect(result[0].outer.length).toBeGreaterThanOrEqual(4);
    expect(result[0].outer.length).toBeLessThanOrEqual(6);
  });
```

- [ ] **Step 6: Run test to verify adjacent-merge case passes**

Run: `pnpm test:run -- src/colorflow/__tests__/polygonUnion.test.ts`
Expected: PASS (no implementation change — Clipper handles this).

- [ ] **Step 7: Add tests for disjoint polygons and preserved holes**

Append to `src/colorflow/__tests__/polygonUnion.test.ts`:

```ts
  it('keeps disjoint polygons as separate entries', () => {
    const result = unionPolygons([
      { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] },
      { outer: [[5, 5], [6, 5], [6, 6], [5, 6]], holes: [] },
    ]);
    expect(result).toHaveLength(2);
    // Combined area = 2
    const totalArea = result.reduce((a, p) => a + polygonArea(p.outer), 0);
    expect(Math.abs(totalArea - 2)).toBeLessThan(0.01);
  });

  it('preserves a hole on a single input polygon', () => {
    const result = unionPolygons([
      {
        outer: [[0, 0], [10, 0], [10, 10], [0, 10]],
        holes: [[[3, 3], [7, 3], [7, 7], [3, 7]]],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].holes).toHaveLength(1);
    const outerArea = polygonArea(result[0].outer);
    const holeArea = polygonArea(result[0].holes[0]);
    expect(Math.abs(outerArea - 100)).toBeLessThan(0.1);
    expect(Math.abs(holeArea - 16)).toBeLessThan(0.1);
  });

  it('returns [] for empty input', () => {
    expect(unionPolygons([])).toEqual([]);
  });
```

- [ ] **Step 8: Run full polygonUnion suite**

Run: `pnpm test:run -- src/colorflow/__tests__/polygonUnion.test.ts`
Expected: 5 tests pass.

- [ ] **Step 9: Run the whole test suite to verify no regressions**

Run: `pnpm test:run`
Expected: All previously-passing tests still pass, plus 5 new ones.

- [ ] **Step 10: Commit**

```bash
cd /home/ubuntu/grippy/grippysheet-studio/.worktrees/colorflow-image-mode
git add src/colorflow/pipeline/polygonUnion.ts src/colorflow/__tests__/polygonUnion.test.ts
git commit -m "$(cat <<'EOF'
Add polygonUnion helper for ColorFlow stacked-level meshes

Wraps clipper-lib to boolean-union a set of LayerPolygon entries into
one or more disjoint polygons, preserving holes. Sets up Task 2's level-
mesh build to eliminate coincident side walls between adjacent color
regions in the same level (current non-manifold-edges source).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `buildLevelMesh` with a manifold-after-weld test

**Files:**
- Create: `src/colorflow/pipeline/levelMesh.ts`
- Test: `src/colorflow/__tests__/levelMesh.test.ts`

This task introduces a pure function that takes the polygons that should appear in one stacked level (the union of color regions whose stack-pos ≥ this level), unions them, and extrudes the result into one merged geometry. The test verifies the merged geometry is manifold *after vertex welding* — which is the check that would have failed against the pre-fix per-polygon-concatenation approach.

- [ ] **Step 1: Write a failing test for two adjacent polygons producing a welded-manifold mesh**

Create `src/colorflow/__tests__/levelMesh.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run the test — should fail because `buildLevelMesh` doesn't exist**

Run: `pnpm test:run -- src/colorflow/__tests__/levelMesh.test.ts`
Expected: FAIL with "Cannot find module '../pipeline/levelMesh'".

- [ ] **Step 3: Create `levelMesh.ts`**

Create `src/colorflow/pipeline/levelMesh.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify the manifold-after-weld case passes**

Run: `pnpm test:run -- src/colorflow/__tests__/levelMesh.test.ts`
Expected: PASS.

- [ ] **Step 5: Add a test for disjoint polygons (still manifold, two separate shells)**

Append to `src/colorflow/__tests__/levelMesh.test.ts` (inside the same `describe` block):

```ts
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
```

- [ ] **Step 6: Run the levelMesh suite**

Run: `pnpm test:run -- src/colorflow/__tests__/levelMesh.test.ts`
Expected: 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/colorflow/pipeline/levelMesh.ts src/colorflow/__tests__/levelMesh.test.ts
git commit -m "$(cat <<'EOF'
Add buildLevelMesh: union-then-extrude for one stacked level

Pure function that unions all polygons belonging to a stacked level (via
the Task-1 polygonUnion helper) and extrudes the merged outline as one
closed multi-shell prism. Eliminates the per-polygon side-wall
coincidence that produced non-manifold edges in the previous worker.ts
concatenation. Tested for manifold-after-weld on both adjacent and
disjoint inputs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Switch `worker.ts:handleExtrude` to use `buildLevelMesh`

**Files:**
- Modify: `src/colorflow/worker.ts:132-192`

The current `handleExtrude` loops over levels and, for each level, concatenates per-polygon extrusions. Replace the inner per-polygon concatenation with a single `buildLevelMesh` call. The outer loop, the `positionByCentroid` map, and the `layerGeoms` array shape stay the same so downstream consumers (3D viewer, 3MF naming) are unaffected.

- [ ] **Step 1: Read the current `handleExtrude` to confirm the exact block being replaced**

Run: `sed -n '132,192p' src/colorflow/worker.ts`
Expected: shows the function with the per-level loop and per-polygon concatenation (lines 155-185 roughly).

- [ ] **Step 2: Replace the per-level inner loop with `buildLevelMesh`**

Modify `src/colorflow/worker.ts`. Add the import near the top of the file (next to the other pipeline imports):

```ts
import { buildLevelMesh } from './pipeline/levelMesh';
```

Then replace the body of the per-level loop inside `handleExtrude`. Locate the existing block:

```ts
  const layerGeoms: { centroidIndex: number; position: number; geom: TransferredGeom }[] = [];
  for (let level = 0; level < stackOrder.length; level++) {
    const zBottom = baseMm + level * colorLayerMm;
    const zTop = baseMm + (level + 1) * colorLayerMm;
    if (zTop <= zBottom + 1e-6) continue;

    // Merge all polygons whose color's stack position >= this level.
    const positions: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;
    for (const entry of layers) {
      const pos = positionByCentroid.get(entry.centroidIndex);
      if (pos === undefined || pos < level) continue;
      const m = extrudePolygon(entry.polygon.outer, entry.polygon.holes, zBottom, zTop);
      if (!m) continue;
      const nVerts = m.positions.length / 3;
      for (let i = 0; i < m.positions.length; i++) positions.push(m.positions[i]);
      for (let i = 0; i < m.indices.length; i++) indices.push(m.indices[i] + vertexOffset);
      vertexOffset += nVerts;
    }
    if (indices.length === 0) continue;

    layerGeoms.push({
      centroidIndex: stackOrder[level],
      position: level,
      geom: {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
      },
    });
  }
```

Replace with:

```ts
  const layerGeoms: { centroidIndex: number; position: number; geom: TransferredGeom }[] = [];
  for (let level = 0; level < stackOrder.length; level++) {
    const zBottom = baseMm + level * colorLayerMm;
    const zTop = baseMm + (level + 1) * colorLayerMm;

    // Union polygons whose color's stack position >= this level, then extrude
    // the merged outline as one closed multi-shell prism. Eliminates coincident
    // side walls between adjacent same-level polygons (was non-manifold before).
    const polygonsAtThisLevel = layers
      .filter((e) => {
        const pos = positionByCentroid.get(e.centroidIndex);
        return pos !== undefined && pos >= level;
      })
      .map((e) => e.polygon);
    const geom = buildLevelMesh(polygonsAtThisLevel, zBottom, zTop);
    if (!geom) continue;

    layerGeoms.push({
      centroidIndex: stackOrder[level],
      position: level,
      geom,
    });
  }
```

Also remove the now-unused `extrudePolygon` import from `worker.ts` *only if* no other code in this file calls it (the `baseMesh = extrudePolygon(...)` call at the top of `handleExtrude` still uses it, so keep the import — just verify after editing that `extrudePolygon` is still referenced).

- [ ] **Step 3: Run TypeScript to verify no type errors**

Run: `pnpm build 2>&1 | tail -30`
Expected: build succeeds. (`pnpm build` runs `tsc --noEmit -p tsconfig.app.json` as part of `vite build`.)
If errors: fix them and re-run.

- [ ] **Step 4: Run the full test suite to verify no regressions**

Run: `pnpm test:run`
Expected: all tests pass, including the new `polygonUnion` and `levelMesh` suites from Tasks 1-2.

- [ ] **Step 5: Commit**

```bash
git add src/colorflow/worker.ts
git commit -m "$(cat <<'EOF'
worker.ts: use buildLevelMesh for stacked-level extrudes

handleExtrude now delegates each level's geometry to buildLevelMesh,
which unions overlapping polygons via clipper before extrusion. The
outer per-level loop, the positionByCentroid mapping, and the layerGeoms
shape are unchanged — downstream (3D viewer, 3MF naming) is unaffected.
Fixes "non-manifold edges" reported by BambuStudio on import.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Emit 3MF Materials extension from `threeMfWriter.ts`

**Files:**
- Modify: `src/colorflow/threeMfWriter.ts`
- Modify: `src/colorflow/__tests__/threeMfWriter.test.ts`

This task extends `MeshPart` with a required `color` field and rewrites `buildModelXml` to emit a `<m:basematerials>` block plus `pid`/`p1` on every triangle.

- [ ] **Step 1: Write a failing test that asserts the materials block + per-triangle binding**

Modify `src/colorflow/__tests__/threeMfWriter.test.ts`. Locate the first test (`'produces a Blob with the expected zip entries'`) and update the existing `build3MF` calls to include the new required `color` field. Then add a new test verifying the materials block. Replace the test file body (everything inside `describe('build3MF', ...)`) with:

```ts
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { build3MF } from '../threeMfWriter';

const cubeMesh = () => ({
  positions: new Float32Array([
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
    0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
  ]),
  indices: new Uint32Array([
    0, 1, 2,  0, 2, 3,
    4, 6, 5,  4, 7, 6,
  ]),
});

describe('build3MF', () => {
  it('produces a Blob with the expected zip entries', async () => {
    const blob = await build3MF([
      { name: 'base', mesh: cubeMesh(), color: '#888888' },
      { name: 'color_1_ff0000', mesh: cubeMesh(), color: '#FF0000' },
    ], 'footpad_assembly');
    expect(blob.size).toBeGreaterThan(100);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
    expect(zip.file('_rels/.rels')).toBeTruthy();
    expect(zip.file('3D/3dmodel.model')).toBeTruthy();
  });

  it('emits one <object> per mesh plus one assembly object', async () => {
    const blob = await build3MF([
      { name: 'base', mesh: cubeMesh(), color: '#888888' },
      { name: 'color_1', mesh: cubeMesh(), color: '#FF0000' },
      { name: 'color_2', mesh: cubeMesh(), color: '#00FF00' },
    ], 'assembly');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    const objectMatches = xml.match(/<object\s/g) ?? [];
    expect(objectMatches.length).toBe(4);
    const componentMatches = xml.match(/<component\s/g) ?? [];
    expect(componentMatches.length).toBe(3);
    expect(xml).toMatch(/<build>\s*<item objectid="4"/);
  });

  it('escapes XML special chars in names', async () => {
    const blob = await build3MF([
      { name: 'a&b<c>"d\'e', mesh: cubeMesh(), color: '#FFFFFF' },
    ], 'parent<x>');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    expect(xml).toContain('a&amp;b&lt;c&gt;&quot;d&apos;e');
    expect(xml).toContain('parent&lt;x&gt;');
  });

  it('declares the material extension on <model> and emits <m:basematerials> with one entry per part', async () => {
    const blob = await build3MF([
      { name: 'base', mesh: cubeMesh(), color: '#888888' },
      { name: 'color_1_ff0000', mesh: cubeMesh(), color: '#FF0000' },
      { name: 'color_2_00ff00', mesh: cubeMesh(), color: '#00FF00' },
    ], 'footpad_assembly');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    // Namespace declared on <model>
    expect(xml).toMatch(/<model[^>]*xmlns:m="http:\/\/schemas\.microsoft\.com\/3dmanufacturing\/material\/2015\/02"/);
    // basematerials block exists with id="1"
    expect(xml).toMatch(/<m:basematerials\s+id="1">/);
    // One <m:base> per part, in part order
    expect(xml).toMatch(/<m:base\s+name="base"\s+displaycolor="#888888"\s*\/>/);
    expect(xml).toMatch(/<m:base\s+name="color_1_ff0000"\s+displaycolor="#FF0000"\s*\/>/);
    expect(xml).toMatch(/<m:base\s+name="color_2_00ff00"\s+displaycolor="#00FF00"\s*\/>/);
  });

  it('binds every <triangle> to its part\'s material index via pid/p1', async () => {
    const blob = await build3MF([
      { name: 'base', mesh: cubeMesh(), color: '#888888' },        // p1=0
      { name: 'color_1', mesh: cubeMesh(), color: '#FF0000' },     // p1=1
    ], 'assembly');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    // Every <triangle> in object id=1 (base) has pid="1" p1="0"
    const baseTriangles = xml.match(/<triangle [^/]*pid="1" p1="0"/g) ?? [];
    expect(baseTriangles.length).toBe(4); // cubeMesh has 4 triangles
    // Every <triangle> in object id=2 has pid="1" p1="1"
    const colorTriangles = xml.match(/<triangle [^/]*pid="1" p1="1"/g) ?? [];
    expect(colorTriangles.length).toBe(4);
  });

  it('escapes XML special chars in colors (defensive)', async () => {
    // Colors are user-supplied strings — if someone passes garbage, it must still
    // produce well-formed XML (escaped) rather than corrupt the model.
    const blob = await build3MF([
      { name: 'evil', mesh: cubeMesh(), color: '#"><script>' },
    ], 'a');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&quot;&gt;&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run the test — should fail because `MeshPart.color` doesn't exist and writer doesn't emit materials**

Run: `pnpm test:run -- src/colorflow/__tests__/threeMfWriter.test.ts`
Expected: FAIL (TypeScript errors about missing `color` property, plus assertion failures on materials block).

- [ ] **Step 3: Rewrite `threeMfWriter.ts` to emit the materials block**

Replace the entire contents of `src/colorflow/threeMfWriter.ts` with:

```ts
import JSZip from 'jszip';
import type { ExtrudedGeometry } from './pipeline/extrude';

export interface MeshPart {
  name: string;
  mesh: ExtrudedGeometry;
  /**
   * Display color for this part as `"#RRGGBB"` (or `"#RRGGBBAA"`).
   * Emitted into the 3MF Materials and Properties extension so slicers
   * (BambuStudio / OrcaSlicer / PrusaSlicer) show the part in its
   * assigned color and can auto-map it to a filament profile by name.
   */
  color: string;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  } as Record<string, string>)[c]);
}

function buildModelXml(parts: MeshPart[], assemblyName: string): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<model unit="millimeter" xml:lang="en-US"';
  xml += ' xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"';
  xml += ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">\n';
  xml += '<metadata name="Application">GrippySheet ColorFlow</metadata>\n';
  xml += '<resources>\n';

  // Materials block — one <m:base> per part. The pid+p1 on each triangle
  // (below) references this group's id ("1") and the part's index here.
  xml += '<m:basematerials id="1">';
  parts.forEach((p) => {
    xml += `<m:base name="${escapeXml(p.name)}" displaycolor="${escapeXml(p.color)}"/>`;
  });
  xml += '</m:basematerials>\n';

  parts.forEach((p, i) => {
    const id = i + 1;
    const matIndex = i;
    xml += `<object id="${id}" type="model" name="${escapeXml(p.name)}"><mesh><vertices>`;
    const positions = p.mesh.positions;
    const n = positions.length / 3;
    for (let v = 0; v < n; v++) {
      const x = positions[v * 3].toFixed(3);
      const y = positions[v * 3 + 1].toFixed(3);
      const z = positions[v * 3 + 2].toFixed(3);
      xml += `<vertex x="${x}" y="${y}" z="${z}"/>`;
    }
    xml += '</vertices><triangles>';
    const indices = p.mesh.indices;
    for (let t = 0; t < indices.length; t += 3) {
      xml += `<triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}" pid="1" p1="${matIndex}"/>`;
    }
    xml += '</triangles></mesh></object>\n';
  });

  const parentId = parts.length + 1;
  xml += `<object id="${parentId}" type="model" name="${escapeXml(assemblyName)}"><components>`;
  parts.forEach((_, i) => { xml += `<component objectid="${i + 1}"/>`; });
  xml += '</components></object>\n';

  xml += '</resources>\n<build>\n';
  xml += `<item objectid="${parentId}"/>\n`;
  xml += '</build>\n</model>\n';
  return xml;
}

/**
 * Pack a list of named, colored meshes + a parent assembly into a Bambu-
 * compatible 3MF blob with the 3MF Materials and Properties extension
 * for filament-color hints.
 */
export async function build3MF(parts: MeshPart[], assemblyName: string): Promise<Blob> {
  if (parts.length === 0) throw new Error('build3MF: no parts');
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    '<Relationship Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/>\n' +
    '</Relationships>';
  const model = buildModelXml(parts, assemblyName);

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rels);
  zip.file('3D/3dmodel.model', model);
  return zip.generateAsync({ type: 'blob', mimeType: 'model/3mf' });
}
```

- [ ] **Step 4: Run the threeMfWriter tests to verify they all pass**

Run: `pnpm test:run -- src/colorflow/__tests__/threeMfWriter.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Run the full test suite to verify no regressions elsewhere**

Run: `pnpm test:run`
Expected: all tests pass. (Other tests that import `MeshPart` — if any — will fail; if they do, fix them in this step.)

If the build/typecheck fails because callers of `build3MF` don't pass `color` yet, that's expected — Task 5 fixes the caller. For this step, only fix any test-file references; leave `OutputPanel.tsx` for Task 5.

- [ ] **Step 6: Commit**

```bash
git add src/colorflow/threeMfWriter.ts src/colorflow/__tests__/threeMfWriter.test.ts
git commit -m "$(cat <<'EOF'
threeMfWriter: emit Materials extension + per-triangle pid/p1

Adds the 3MF Materials and Properties extension namespace, emits a
single <m:basematerials> block with one <m:base name=... displaycolor=
"#XXXXXX"/> per MeshPart, and tags every <triangle> with pid="1"
p1=<index>. MeshPart gains a required color field driven by the caller.
Result: BambuStudio shows each part in its assigned color and can
auto-map them to filament profiles by name. No Bambu-proprietary
metadata — works in OrcaSlicer / PrusaSlicer / any 3MF-compliant slicer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Thread base color through `OutputPanel`

**Files:**
- Modify: `src/components/OutputPanel.tsx`
- Modify: `src/App.tsx`

`OutputPanel` already has the color for color-level parts (the per-centroid hex it currently puts in the part name) and for spike groups (`spike.color`). It needs the base color from `BaseSettings.color`, which is held in `App.tsx`.

- [ ] **Step 1: Add a `baseColor` prop to `OutputPanel`**

Modify `src/components/OutputPanel.tsx`. In the `OutputPanelProps` interface, add a new field:

```ts
  /** Hex color for the base mesh, used as the displaycolor in the 3MF
   *  Materials block. e.g. "#333333". */
  baseColor?: string;
```

Destructure it from props in the component signature:

```ts
const OutputPanel: React.FC<OutputPanelProps> = ({ meshRef, debugMode = false, className = '', colorFlowGeom, colorFlowImageName, colorFlowOutlineSlug, baseColor = '#888888' }) => {
```

- [ ] **Step 2: Pass `color` on every `MeshPart` in `handleExport3MF`**

Modify the ColorFlow branch of `handleExport3MF` (around lines 167-184 of the original file). Replace this block:

```ts
        const parts: MeshPart[] = [{ name: 'base', mesh: colorFlowGeom.base }];
        colorFlowGeom.layers.forEach((entry) => {
          const c = entry.centroid;
          const hex = `${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`;
          parts.push({ name: `color_${entry.position + 1}_${hex}`, mesh: entry.geom });
        });
        colorFlowGeom.spikes.forEach((spike, i) => {
          const suffix = spike.centroidIndex >= 0 ? `c${spike.centroidIndex}` : `u${i}`;
          parts.push({ name: `spikes_${suffix}`, mesh: spike.geom });
        });
```

with:

```ts
        const parts: MeshPart[] = [{ name: 'base', mesh: colorFlowGeom.base, color: baseColor }];
        colorFlowGeom.layers.forEach((entry) => {
          const c = entry.centroid;
          const hex = `${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`;
          parts.push({
            name: `color_${entry.position + 1}_${hex}`,
            mesh: entry.geom,
            color: `#${hex}`,
          });
        });
        colorFlowGeom.spikes.forEach((spike, i) => {
          const suffix = spike.centroidIndex >= 0 ? `c${spike.centroidIndex}` : `u${i}`;
          parts.push({
            name: `spikes_${suffix}`,
            mesh: spike.geom,
            color: spike.color,
          });
        });
```

- [ ] **Step 3: Pass `baseColor` from `App.tsx`**

Modify `src/App.tsx`. Find the `<OutputPanel ... />` site (around line 225) and add the `baseColor` prop. The full component should now read:

```tsx
                <OutputPanel
                  meshRef={meshRef}
                  debugMode={geometrySettings.debugMode ?? false}
                  className="bg-transparent border-0 shadow-none p-0 !p-0"
                  colorFlowGeom={colorFlowGeomWithSpikes}
                  colorFlowImageName={projectAssets.image?.name}
                  colorFlowOutlineSlug={baseSettings.outlineSlug}
                  baseColor={baseSettings.color}
                />
```

- [ ] **Step 4: Verify the type for `baseSettings.color`**

Run: `grep -n "color:" src/types/schemas.ts | head -10`
Expected: shows a `color: z.string()...` field on the base schema (e.g. `BaseSettingsSchema`). If `baseSettings.color` is not a hex string at runtime (e.g. it's a CSS color like `"red"`), the displaycolor in the 3MF will still be readable by slicers as a fallback; no special handling needed. Just confirm the property name is `color`.

If the property name is different (e.g. `baseColor`), update Step 3 to use the correct name.

- [ ] **Step 5: Run the build to verify no TypeScript errors**

Run: `pnpm build 2>&1 | tail -30`
Expected: build succeeds.

- [ ] **Step 6: Run the full test suite**

Run: `pnpm test:run`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/OutputPanel.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
OutputPanel: thread baseColor + per-part colors into 3MF export

baseColor flows from App.tsx (baseSettings.color) through a new
OutputPanel prop into the MeshPart for the base mesh. Color-level parts
build "#" + their existing hex string; spike parts reuse spike.color
which is already a "#RRGGBB" string from spikes.ts. Together with the
Task-4 Materials-extension writer, the exported 3MF now imports into
BambuStudio with each part shown in its assigned color and the
filament-from-project mapping populated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Manual verification

This is not automated. The agent should report findings to the user and stop here — the user runs the dev server, generates a result, exports a 3MF, and imports it into BambuStudio (or OrcaSlicer).

- [ ] **Step 1: Run the test suite and the build one final time**

Run: `pnpm test:run && pnpm build`
Expected: all tests pass and the production build succeeds.

- [ ] **Step 2: Start the dev server (background)**

The agent should start the dev server in the background using `pnpm dev`, then surface the localhost URL to the user with instructions:

> Please do the following manual checks in your browser at the URL above:
>
> 1. Pick an outline in the Base tab, pick a `BaseSettings.color` (e.g. a distinctive non-gray like `#3366CC`).
> 2. Drop a multi-color image into the ColorFlow tab.
> 3. Wait for the pipeline (quantize → trace → extrude); confirm the 3D viewer shows the colored stack.
> 4. (Optional) Configure a Geometry-tab pattern + click "Generate preview" so spikes are included.
> 5. Click **Export 3MF (Bambu/Orca)**.
> 6. Open the resulting `.3mf` in BambuStudio (or OrcaSlicer).
>
> Confirm:
> - The base imports in the color you chose in step 1 (not gray).
> - Each color level imports in its image-derived color.
> - Spike groups import in their assigned colors (or the fallback color if `spikeColorMatch` is off).
> - **No "non-manifold edges" warning** on import.
> - Optional: click "Load filaments from project" — BambuStudio should populate the filament list from the part names + displaycolors.

- [ ] **Step 3: Stop the dev server when the user confirms**

Once the user reports success (or specific failure), stop the background dev server.

- [ ] **Step 4: If the user reports any issue, do NOT attempt fixes in this same plan**

Report the findings to the user. New issues are out-of-scope for this plan and should be triaged separately — they may indicate a different root cause not covered by the surgical fix.

---

## Self-Review Notes

- **Spec coverage:** All three observed problems map to tasks. #1 (color) → Tasks 4–5. #3 (non-manifold) → Tasks 1–3. #2 (long sub-parts list) was explicitly de-scoped per user.
- **Type consistency:** `LayerPolygon` is defined in `polygonUnion.ts` (Task 1) and reused as-is in `levelMesh.ts` (Task 2) and `worker.ts` (Task 3, where it matches the existing inline polygon shape from `polygonize.ts`'s `LayerPolygon` — same structure, just imported from the new module for Tasks 1–2's tests). `MeshPart.color` is required (Task 4), supplied by caller (Task 5).
- **No placeholders:** all code blocks are complete; all commands have expected output.
- **Frequent commits:** one commit per task (5 code commits + 1 verification gate).
- **TDD:** Tasks 1, 2, and 4 are test-first. Task 3 has no new tests of its own — it's a refactor protected by Task 2's manifold test and the existing extrude tests. Task 5 is a small caller wiring change verified by `pnpm build` (type-check).
