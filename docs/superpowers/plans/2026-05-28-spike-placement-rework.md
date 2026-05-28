# Spike Placement Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make click-to-remove spikes work reliably in 2D and 3D, add free click-to-toggle + drag-paint placement, and hide the compound extra-layers UI.

**Architecture:** Replace the failing CSG-mesh raycast with a ground-plane ray intersection that yields a clean world `(x,y)`. A shared pure `toggleSpikeAt` helper maps that point to a settings mutation: remove a nearby grid spike (`removedTiles`), remove a nearby free spike (`addedSpikes`), or add a new free spike. Both the 3D R3F hint and the 2D canvas viewer call the same helper. Construction appends `addedSpikes` to generated grid positions and tags each cached position with its origin.

**Tech Stack:** React 19 (React Compiler), Three.js / @react-three/fiber, Zod, Vitest, Vite. Worktree: `/home/ubuntu/grippy/grippysheet-studio/.worktrees/colorflow-image-mode`.

**Conventions:**
- Run commands from the worktree root.
- Verify with `npx tsc --noEmit -p tsconfig.app.json`, `npx vitest run`, `npm run build`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Do NOT add manual `useMemo`/`useCallback` for perf (React Compiler is on).

---

### Task 1: Schema — `addedSpikes` field + `getPatternLayers` synthesis

**Files:**
- Modify: `src/types/schemas.ts` (PatternLayerSchema ~L80-100, GeometrySettingsSchema ~L107-136, getPatternLayers ~L209-228)
- Test: `src/utils/__tests__/patternUtils.test.ts` (existing file — add a describe block)

- [ ] **Step 1: Write the failing test**

Add to the end of `src/utils/__tests__/patternUtils.test.ts`:

```ts
import { GeometrySettingsSchema, getPatternLayers } from '../../types/schemas';

describe('addedSpikes schema + getPatternLayers', () => {
    it('defaults addedSpikes to an empty array on GeometrySettings', () => {
        const g = GeometrySettingsSchema.parse({});
        expect(g.addedSpikes).toEqual([]);
    });

    it('round-trips addedSpikes coordinates', () => {
        const g = GeometrySettingsSchema.parse({ addedSpikes: [{ x: 1.5, y: -2.25 }] });
        expect(g.addedSpikes).toEqual([{ x: 1.5, y: -2.25 }]);
    });

    it('synthesizes the primary layer with addedSpikes from the flat field', () => {
        const g = GeometrySettingsSchema.parse({
            patternShapes: null,
            addedSpikes: [{ x: 3, y: 4 }],
        });
        // primary is index 0 even with null shapes (unfiltered contract)
        expect(getPatternLayers(g)[0].addedSpikes).toEqual([{ x: 3, y: 4 }]);
    });

    it('defaults a PatternLayer addedSpikes to empty', () => {
        const g = GeometrySettingsSchema.parse({ extraLayers: [{ id: 'x' }] });
        expect(g.extraLayers[0].addedSpikes).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/patternUtils.test.ts -t addedSpikes`
Expected: FAIL — `addedSpikes` is `undefined` (field not in schema yet).

- [ ] **Step 3: Add the field to both schemas**

In `src/types/schemas.ts`, inside `PatternLayerSchema` (right after the `removedTiles` line, currently `removedTiles: z.array(z.string()).default([]),`):

```ts
    /** Free-placed spikes at arbitrary world (x,y) — added by clicking
     *  empty deck in tile-selection mode. Appended to the generated grid
     *  positions at construction time. Plain numbers, JSON-safe. */
    addedSpikes: z.array(z.object({ x: z.number(), y: z.number() })).default([]),
```

In `GeometrySettingsSchema`, right after its `removedTiles: z.array(z.string()).default([]),` line:

```ts
    /** Free-placed spikes for the primary layer — see PatternLayer.addedSpikes. */
    addedSpikes: z.array(z.object({ x: z.number(), y: z.number() })).default([]),
```

- [ ] **Step 4: Thread it through `getPatternLayers`**

In `getPatternLayers`, the synthesized `primary` object literal — add after its `removedTiles: g.removedTiles ?? [],` line:

```ts
        addedSpikes: g.addedSpikes ?? [],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/patternUtils.test.ts`
Expected: PASS (all, including the new 4).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add src/types/schemas.ts src/utils/__tests__/patternUtils.test.ts
git commit -m "$(cat <<'EOF'
Add addedSpikes field for free spike placement

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `toggleSpikeAt` pure helper

**Files:**
- Modify: `src/utils/patternUtils.ts` (add exports near `tileKey`/`filterRemovedTiles`, ~L19-43)
- Test: `src/utils/__tests__/patternUtils.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/utils/__tests__/patternUtils.test.ts`:

```ts
import { toggleSpikeAt, type SpikePosition } from '../patternUtils';

describe('toggleSpikeAt', () => {
    const R = 5;
    const grid: SpikePosition[] = [
        { x: 0, y: 0, origin: 'grid' },
        { x: 20, y: 0, origin: 'grid' },
    ];

    it('removes a grid spike when the click lands within R of it', () => {
        const res = toggleSpikeAt(1, 1, grid, [], [], R);
        expect(res.removedTiles).toEqual([tileKey(0, 0)]);
        expect(res.addedSpikes).toEqual([]);
    });

    it('adds a free spike at the exact point when the click is in a gap', () => {
        const res = toggleSpikeAt(10, 10, grid, [], [], R);
        expect(res.removedTiles).toEqual([]);
        expect(res.addedSpikes).toEqual([{ x: 10, y: 10 }]);
    });

    it('removes an existing added spike when clicked', () => {
        const positions: SpikePosition[] = [{ x: 50, y: 50, origin: 'added' }];
        const res = toggleSpikeAt(50.5, 49.5, positions, [], [{ x: 50, y: 50 }], R);
        expect(res.addedSpikes).toEqual([]);
        expect(res.removedTiles).toEqual([]);
    });

    it('does not duplicate a removedTiles key already present', () => {
        const res = toggleSpikeAt(0, 0, grid, [tileKey(0, 0)], [], R);
        expect(res.removedTiles).toEqual([tileKey(0, 0)]);
    });

    it('prefers the nearest spike when two are in range', () => {
        const close: SpikePosition[] = [
            { x: 0, y: 0, origin: 'grid' },
            { x: 4, y: 0, origin: 'added' },
        ];
        // click at x=3 is nearest the added spike at x=4
        const res = toggleSpikeAt(3, 0, close, [], [{ x: 4, y: 0 }], R);
        expect(res.addedSpikes).toEqual([]);   // added one removed
        expect(res.removedTiles).toEqual([]);  // grid untouched
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/patternUtils.test.ts -t toggleSpikeAt`
Expected: FAIL — `toggleSpikeAt` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/utils/patternUtils.ts`, immediately after the `filterRemovedTiles` function (after its closing `}` near L43), add:

```ts
/** A spike position with provenance — `grid` came from the tile generator
 *  (removable via removedTiles), `added` came from a free click (removable
 *  by splicing addedSpikes). */
export interface SpikePosition {
    x: number;
    y: number;
    origin: 'grid' | 'added';
}

export interface SpikeToggleResult {
    removedTiles: string[];
    addedSpikes: Array<{ x: number; y: number }>;
}

/**
 * Toggle a spike at world (x, y) for one layer. Pure — returns the next
 * `removedTiles` + `addedSpikes` without mutating inputs.
 *
 * - Nearest spike within `radius` and origin `grid`  → push its tileKey to removedTiles.
 * - Nearest spike within `radius` and origin `added` → splice it from addedSpikes.
 * - No spike within `radius`                         → append {x,y} to addedSpikes.
 */
export function toggleSpikeAt(
    x: number,
    y: number,
    positions: SpikePosition[],
    removedTiles: string[],
    addedSpikes: Array<{ x: number; y: number }>,
    radius: number,
): SpikeToggleResult {
    let best: SpikePosition | null = null;
    let bestD2 = radius * radius;
    for (const p of positions) {
        const dx = p.x - x;
        const dy = p.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
            bestD2 = d2;
            best = p;
        }
    }

    if (!best) {
        // Empty gap → place a new free spike at the exact click point.
        return { removedTiles, addedSpikes: [...addedSpikes, { x, y }] };
    }

    if (best.origin === 'grid') {
        const key = tileKey(best.x, best.y);
        if (removedTiles.includes(key)) return { removedTiles, addedSpikes };
        return { removedTiles: [...removedTiles, key], addedSpikes };
    }

    // origin === 'added' → drop the matching free spike (match on quantised key).
    const targetKey = tileKey(best.x, best.y);
    return {
        removedTiles,
        addedSpikes: addedSpikes.filter((p) => tileKey(p.x, p.y) !== targetKey),
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/patternUtils.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/patternUtils.ts src/utils/__tests__/patternUtils.test.ts
git commit -m "$(cat <<'EOF'
Add toggleSpikeAt pure helper for spike add/remove

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Construction — append addedSpikes + tag cached positions

**Files:**
- Modify: `src/components/ImperativeModel.tsx` (primaryLayer literal ~L886-903; positions build ~L1035; userData writes at ~L1075 and ~L1371)

No unit test (Three.js construction is verified via build + manual). 

- [ ] **Step 1: Add `addedSpikes` to the synthesized primary layer**

In `src/components/ImperativeModel.tsx`, the `primaryLayer` object literal (the one with `removedTiles: removedTiles ?? [],` ~L902) — add right after that line:

```ts
        addedSpikes: addedSpikes ?? [],
```

This requires `addedSpikes` to be in scope. It is destructured from props alongside `removedTiles` — find the destructure that includes `removedTiles, extraLayers,` (~L1414 region and the params list ~L89). Add `addedSpikes` next to `removedTiles` in BOTH the component props destructure (near L89) and the effect-dependency destructure (near L1414). If the props type is inline, add `addedSpikes?: { x: number; y: number }[];` to the `ImperativeModelProps`/local props interface near the `removedTiles?: string[];` declaration (~L35).

- [ ] **Step 2: Append addedSpikes to positions, remember the grid count**

Find the positions build (~L1035):

```ts
        const positions: TileInstance[] = filterRemovedTiles(rawPositions, layer.removedTiles);
```

Replace with:

```ts
        const gridPositions: TileInstance[] = filterRemovedTiles(rawPositions, layer.removedTiles);
        const gridCount = gridPositions.length;
        const positions: TileInstance[] = [
            ...gridPositions,
            ...(layer.addedSpikes ?? []).map((p) => ({
                position: new THREE.Vector2(p.x, p.y),
                rotation: 0,
                scale: 1,
            })),
        ];
```

- [ ] **Step 3: Tag the InstancedMesh cached positions with origin**

Find (~L1075):

```ts
            iMesh.userData.tilePositions = positions.map((p) => ({ x: p.position.x, y: p.position.y }));
```

Replace with:

```ts
            iMesh.userData.tilePositions = positions.map((p, i) => ({
                x: p.position.x, y: p.position.y,
                origin: i < gridCount ? 'grid' : 'added',
            }));
            iMesh.userData.tileR = Math.max(pWidth, pHeight, 1) * 0.6;
```

- [ ] **Step 4: Tag the CSG-merged cached positions with origin**

Find (~L1371):

```ts
            resultBrush.userData.tilePositions = positions.map((p) => ({ x: p.position.x, y: p.position.y }));
```

Replace with:

```ts
            resultBrush.userData.tilePositions = positions.map((p, i) => ({
                x: p.position.x, y: p.position.y,
                origin: i < gridCount ? 'grid' : 'added',
            }));
            resultBrush.userData.tileR = Math.max(pWidth, pHeight, 1) * 0.6;
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: clean typecheck; build succeeds ("✓ built in ...").

- [ ] **Step 6: Commit**

```bash
git add src/components/ImperativeModel.tsx
git commit -m "$(cat <<'EOF'
Render addedSpikes + tag cached spike positions with origin

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 3D — ground-plane raycast + toggle + drag in TileRemovalHint

**Files:**
- Rewrite: `src/components/interaction/TileRemovalHint.tsx`

The mesh raycast (intersectObjects) is replaced by a plane intersection. Hover + click + drag all use the plane point. No unit test — verified by build + manual.

- [ ] **Step 1: Replace the file body**

Overwrite `src/components/interaction/TileRemovalHint.tsx` with:

```tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { toggleSpikeAt, type SpikePosition } from '../../utils/patternUtils';
import type { GeometrySettings } from '../../types/schemas';

interface TileRemovalHintProps {
    meshRef: React.RefObject<THREE.Group | null>;
    enabled: boolean;
    onGeometryChange: (updater: (prev: GeometrySettings) => GeometrySettings) => void;
}

const REMOVE_COLOR = '#ef4444'; // signal-error — "this will be removed"
const ADD_COLOR = '#ff6b1a';    // brand-500 — "a spike will be added here"

interface PrimarySpikes {
    positions: SpikePosition[];
    tileR: number;
    topZ: number;
}

/**
 * Hover-affordance + click/drag-to-toggle for primary-layer spikes.
 *
 * Click detection uses a ground-plane intersection rather than raycasting
 * the CSG-merged spike mesh (which returns no hits). We intersect the
 * pointer ray with a horizontal plane at the spike-top surface to get a
 * clean world (x,y), then `toggleSpikeAt` decides remove-vs-add.
 *
 * Pulls the rendered primary-layer spike origins from the `Pattern_0`
 * mesh's `userData.tilePositions` (each tagged grid|added) + `userData.tileR`.
 */
export const TileRemovalHint: React.FC<TileRemovalHintProps> = ({
    meshRef,
    enabled,
    onGeometryChange,
}) => {
    const { camera, gl } = useThree();
    const raycaster = useMemo(() => new THREE.Raycaster(), []);
    const plane = useMemo(() => new THREE.Plane(), []);
    const hitPoint = useMemo(() => new THREE.Vector3(), []);
    const [hover, setHover] = useState<{ position: THREE.Vector3; size: number; mode: 'add' | 'remove' } | null>(null);
    const dragging = useRef(false);
    const draggedPoints = useRef<Array<{ x: number; y: number }>>([]);

    // Read the primary spike set (Pattern_0) from the imperative group.
    const readPrimary = (): PrimarySpikes | null => {
        const group = meshRef.current;
        if (!group) return null;
        let mesh: THREE.Object3D | null = null;
        group.traverse((o) => {
            if (o.name === 'Pattern_0' || o.name === 'Pattern') mesh = o;
        });
        if (!mesh) return null;
        const m = mesh as THREE.Mesh;
        const cached = m.userData?.tilePositions as SpikePosition[] | undefined;
        const tileR = (m.userData?.tileR as number | undefined) ?? 6;
        // Spike-top z for the intersection plane. Compute the bbox lazily.
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const topZ = m.geometry.boundingBox ? m.geometry.boundingBox.max.z : 5;
        return { positions: cached ?? [], tileR, topZ };
    };

    useFrame((state) => {
        if (!enabled || !meshRef.current) {
            if (hover) setHover(null);
            return;
        }
        const primary = readPrimary();
        if (!primary) {
            if (hover) setHover(null);
            return;
        }
        // Intersect pointer ray with the spike-top plane.
        plane.set(new THREE.Vector3(0, 0, 1), -primary.topZ);
        raycaster.setFromCamera(state.pointer, camera);
        const ok = raycaster.ray.intersectPlane(plane, hitPoint);
        if (!ok) {
            if (hover) setHover(null);
            return;
        }
        // Nearest spike within tileR decides add vs remove preview.
        let best: SpikePosition | null = null;
        let bestD2 = primary.tileR * primary.tileR;
        for (const p of primary.positions) {
            const dx = p.x - hitPoint.x;
            const dy = p.y - hitPoint.y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= bestD2) { bestD2 = d2; best = p; }
        }
        const mode: 'add' | 'remove' = best ? 'remove' : 'add';
        const px = best ? best.x : hitPoint.x;
        const py = best ? best.y : hitPoint.y;
        const size = primary.tileR * 1.4;
        if (!hover || hover.position.x !== px || hover.position.y !== py || hover.mode !== mode) {
            setHover({ position: new THREE.Vector3(px, py, primary.topZ + 0.5), size, mode });
        }
    });

    // Cursor styling while active.
    useEffect(() => {
        const el = gl.domElement;
        if (enabled) el.style.cursor = 'crosshair';
        else if (el.style.cursor === 'crosshair') el.style.cursor = '';
        return () => { if (el.style.cursor === 'crosshair') el.style.cursor = ''; };
    }, [enabled, gl]);

    // Compute the world (x,y) for a given clientX/clientY against the plane.
    const clientToWorld = (clientX: number, clientY: number, primary: PrimarySpikes): { x: number; y: number } | null => {
        const rect = gl.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        plane.set(new THREE.Vector3(0, 0, 1), -primary.topZ);
        raycaster.setFromCamera(ndc, camera);
        if (!raycaster.ray.intersectPlane(plane, hitPoint)) return null;
        return { x: hitPoint.x, y: hitPoint.y };
    };

    // One toggle at a world point, deduped against the current drag stroke.
    const applyToggle = (wx: number, wy: number, primary: PrimarySpikes) => {
        for (const d of draggedPoints.current) {
            const dx = d.x - wx, dy = d.y - wy;
            if (dx * dx + dy * dy <= (primary.tileR * primary.tileR)) return; // already toggled nearby this stroke
        }
        draggedPoints.current.push({ x: wx, y: wy });
        onGeometryChange((prev) => {
            const result = toggleSpikeAt(
                wx, wy, primary.positions,
                prev.removedTiles ?? [], prev.addedSpikes ?? [], primary.tileR,
            );
            return { ...prev, removedTiles: result.removedTiles, addedSpikes: result.addedSpikes };
        });
    };

    // Pointer down/move/up on the canvas drive click + drag-paint.
    useEffect(() => {
        if (!enabled) return;
        const el = gl.domElement;
        const onDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            const primary = readPrimary();
            if (!primary) return;
            dragging.current = true;
            draggedPoints.current = [];
            const w = clientToWorld(e.clientX, e.clientY, primary);
            if (w) applyToggle(w.x, w.y, primary);
        };
        const onMove = (e: PointerEvent) => {
            if (!dragging.current) return;
            const primary = readPrimary();
            if (!primary) return;
            const w = clientToWorld(e.clientX, e.clientY, primary);
            if (w) applyToggle(w.x, w.y, primary);
        };
        const onUp = () => { dragging.current = false; draggedPoints.current = []; };
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            el.removeEventListener('pointerdown', onDown);
            el.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, gl, onGeometryChange, camera]);

    if (!hover || !enabled) return null;
    const color = hover.mode === 'remove' ? REMOVE_COLOR : ADD_COLOR;
    return (
        <group position={hover.position} renderOrder={998}>
            <mesh>
                <ringGeometry args={[hover.size * 0.45, hover.size * 0.55, 32]} />
                <meshBasicMaterial color={color} transparent opacity={0.95} depthTest={false} depthWrite={false} />
            </mesh>
        </group>
    );
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: clean.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: "✓ built in ...".

- [ ] **Step 4: Commit**

```bash
git add src/components/interaction/TileRemovalHint.tsx
git commit -m "$(cat <<'EOF'
Rewrite 3D spike toggle to use ground-plane raycast + drag-paint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 2D — toggle + drag in TwoDViewer

**Files:**
- Modify: `src/colorflow/TwoDViewer.tsx` (DrawnTile interface ~L35-39; drawnTiles.push ~L429-433; findTileAt ~L549-566; handleMouseMove ~L568-580; handleClick ~L582-609; wrapper handlers ~L611-620)

No unit test — verified via build + manual.

- [ ] **Step 1: Extend DrawnTile to carry world coords + origin**

Replace the `DrawnTile` interface (~L35-39):

```ts
interface DrawnTile {
  layerIdx: number;
  key: string;
  path: Path2D;
}
```

with:

```ts
interface DrawnTile {
  layerIdx: number;
  key: string;
  path: Path2D;
  x: number;        // world-mm tile origin
  y: number;
  origin: 'grid' | 'added';
}
```

- [ ] **Step 2: Populate the new fields when recording tiles**

The paint loop appends grid tiles (~L429). Find:

```ts
        drawnTiles.push({
          layerIdx,
          key: tileKey(tile.x, tile.y),
          path,
        });
```

Replace with:

```ts
        drawnTiles.push({
          layerIdx,
          key: tileKey(tile.x, tile.y),
          path,
          x: tile.x,
          y: tile.y,
          origin: 'grid',
        });
```

Then, immediately AFTER the `for (const tile of assignments) { ... }` loop closes (still inside the `patternLayers.forEach` body, before its closing `});`), append the layer's free spikes so they paint and are clickable. Add:

```ts
      // Free-placed spikes for this layer — painted with the same footprint
      // so they read identically to grid spikes and are click-removable.
      for (const sp of layer.addedSpikes ?? []) {
        const path = new Path2D();
        for (let i = 0; i < footprint.length; i++) {
          const [px, py] = footprint[i];
          const lx = px * layerScale;
          const ly = py * layerScale;
          const rx = lx + sp.x;
          const ry = ly + sp.y;
          if (i === 0) path.moveTo(wx(rx), wy(ry));
          else path.lineTo(wx(rx), wy(ry));
        }
        path.closePath();
        ctx.fillStyle = layer.color;
        ctx.fill(path);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = 0.6;
        ctx.stroke(path);
        drawnTiles.push({
          layerIdx,
          key: tileKey(sp.x, sp.y),
          path,
          x: sp.x,
          y: sp.y,
          origin: 'added',
        });
      }
```

(`footprint`, `layerScale`, `wx`, `wy`, `ctx` are all already in scope in that loop body — confirm against the existing grid paint that uses them.)

- [ ] **Step 3: Add a screen→world helper and a tile radius ref**

Near the other refs at the top of the component (after `const drawnTilesRef = useRef<DrawnTile[]>([]);` ~L133) add:

```ts
  const tileRRef = useRef<number>(6);
  const worldToCanvasRef = useRef<{ minX: number; maxY: number; scale: number; offsetX: number; offsetY: number } | null>(null);
```

In `draw()`, right after `offsetX` / `offsetY` / `scale` / `wx` / `wy` are defined (~L188-189), record the inverse-mapping params:

```ts
    worldToCanvasRef.current = { minX: outlinePolygon.minX, maxY: outlinePolygon.maxY, scale, offsetX, offsetY };
```

And where each layer computes `tileW`/`tileH` (~L376-378), set the radius for the primary layer:

```ts
      if (layerIdx === 0) tileRRef.current = Math.max(tileW, tileH, 1) * 0.6;
```

- [ ] **Step 4: Replace handleClick with toggle, and add drag handlers**

Replace `handleClick` (~L582-609) with:

```ts
  // Convert a canvas-relative (cx,cy) px coord into world mm using the
  // inverse of wx/wy captured during the last draw.
  const canvasToWorld = useCallback((cx: number, cy: number): { x: number; y: number } | null => {
    const m = worldToCanvasRef.current;
    if (!m) return null;
    return {
      x: m.minX + (cx - m.offsetX) / m.scale,
      y: m.maxY - (cy - m.offsetY) / m.scale,
    };
  }, []);

  const draggingRef = useRef(false);
  const draggedRef = useRef<Array<{ x: number; y: number }>>([]);

  const toggleAtClient = useCallback((clientX: number, clientY: number) => {
    if (!tileRemovalMode || !onGeometryChange) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const w = canvasToWorld(cx, cy);
    if (!w) return;
    const R = tileRRef.current;
    // dedup against the current drag stroke
    for (const d of draggedRef.current) {
      const dx = d.x - w.x, dy = d.y - w.y;
      if (dx * dx + dy * dy <= R * R) return;
    }
    draggedRef.current.push(w);
    const primaryPositions: SpikePosition[] = drawnTilesRef.current
      .filter((t) => t.layerIdx === 0)
      .map((t) => ({ x: t.x, y: t.y, origin: t.origin }));
    onGeometryChange((prev) => {
      const result = toggleSpikeAt(
        w.x, w.y, primaryPositions,
        prev.removedTiles ?? [], prev.addedSpikes ?? [], R,
      );
      return { ...prev, removedTiles: result.removedTiles, addedSpikes: result.addedSpikes };
    });
  }, [tileRemovalMode, onGeometryChange, canvasToWorld]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!tileRemovalMode) return;
    draggingRef.current = true;
    draggedRef.current = [];
    toggleAtClient(e.clientX, e.clientY);
  }, [tileRemovalMode, toggleAtClient]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) toggleAtClient(e.clientX, e.clientY);
  }, [toggleAtClient]);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
    draggedRef.current = [];
  }, []);
```

Ensure `toggleSpikeAt` and `SpikePosition` are imported. Update the import at the top of the file (~L4):

```ts
import { generateTilePositions, tileKey, filterRemovedTiles, toggleSpikeAt, type SpikePosition } from '../utils/patternUtils';
```

- [ ] **Step 5: Wire the wrapper element to the new handlers**

The wrapper `<div ... onClick={handleClick}>` (~L611-620) — replace its event props. Find the wrapper div opening tag and swap `onClick={handleClick}` for:

```tsx
      onPointerDown={handlePointerDown}
      onPointerMove={(e) => { handleMouseMove(e); handlePointerMove(e); }}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
```

Keep the existing `onMouseEnter`/`onMouseLeave`/`onMouseMove` for the hover highlight if present — but route the move through both as shown (`handleMouseMove` is the existing hover updater; if its signature is `React.MouseEvent`, change its type to `React.PointerEvent` or call it as `handleMouseMove(e as unknown as React.MouseEvent<HTMLDivElement>)`). If `handleMouseMove` no longer compiles cleanly, simplest fix: change its parameter type to `React.PointerEvent<HTMLDivElement>` (PointerEvent extends MouseEvent, all `.clientX/.clientY` usage is unchanged).

- [ ] **Step 6: Delete the now-unused handleClick if it remains**

If a separate `handleClick` is still defined and now unreferenced, remove it (TS `noUnusedLocals` will flag it). `findTileAt` is still used by `handleMouseMove` for hover — keep it.

- [ ] **Step 7: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: clean typecheck, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/colorflow/TwoDViewer.tsx
git commit -m "$(cat <<'EOF'
Add 2D spike toggle + drag-paint via shared toggleSpikeAt

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Hide the compound extra-layers UI

**Files:**
- Modify: `src/components/controls/GeometryControls.tsx` (the `<ExtraLayersSection ... />` render ~L679-685)

- [ ] **Step 1: Remove the ExtraLayersSection render**

Find the JSX:

```tsx
      <ExtraLayersSection
        settings={settings}
        updateSettings={updateSettings}
        baseSize={baseSize}
        onExtraLayerAssetChanged={onExtraLayerAssetChanged}
        onOpenLibrary={(id) => setLibraryTarget({ kind: 'extra', id })}
      />
```

Replace with a comment marking it dormant:

```tsx
      {/* Compound "extra layers" UI intentionally hidden — the schema,
          construction, and round-trip code remain so existing projects with
          extraLayers still load and render. Re-enable by restoring this
          <ExtraLayersSection/> render. */}
```

- [ ] **Step 2: Silence unused-symbol errors**

`noUnusedLocals`/`noUnusedParameters` will now flag `ExtraLayersSection`, `ExtraLayerCard`, and possibly `onExtraLayerAssetChanged`. Do the minimum to keep them dormant without deleting:
- Keep `ExtraLayersSection` and `ExtraLayerCard` defined but, if TS flags them as unused, add `void ExtraLayersSection;` once right after the `GeometryControls` component's closing (module scope) — a single reference that documents intent.
- `onExtraLayerAssetChanged` is still a prop in the interface and still destructured; it's now passed nowhere. If flagged unused, prefix the destructured binding with a reference: keep it threaded to nothing is fine as long as it's read somewhere. Simplest: leave the prop in the interface, and in the destructure rename to `_onExtraLayerAssetChanged` ONLY if TS complains, otherwise leave as-is.

Run `npx tsc --noEmit -p tsconfig.app.json` and resolve exactly what it reports — do not pre-emptively gut code.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: clean, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/controls/GeometryControls.tsx
git commit -m "$(cat <<'EOF'
Hide compound extra-layers UI (schema + plumbing kept dormant)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all tests pass (previous 130 + new toggleSpikeAt/addedSpikes cases).

- [ ] **Step 2: Typecheck + production build**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: clean typecheck; "✓ built in ...".

- [ ] **Step 3: Manual verification (report findings, do not auto-pass)**

Start preview: `npm run preview -- --port 4173 --host 127.0.0.1` (background).
In a browser (or the Playwright MCP), perform and CONFIRM each:
1. Load a deck (XR Stock), Geometry tab, pick Pyramid from the library.
2. Enable Tile Selection (toolbar eraser).
3. **2D:** click a spike → it disappears; click a gap → a spike appears; drag across a row → a streak toggles. Confirm `removedTiles` / `addedSpikes` update (inspect React state if using Playwright).
4. **3D:** repeat clicks/drag in the 3D render — same behavior (this is the bug that must now be fixed).
5. Confirm the hover ring is red over a spike (remove) and orange over a gap (add).
6. Export 3MF, re-import, confirm `removedTiles` + `addedSpikes` survive round-trip.
7. Confirm the "Add another pattern" UI is gone from the Geometry tab.

Report the actual observed result of each step. Do not claim success without observing it.

---

## Notes for the executor

- The camera fix (ortho `up=[0,1,0]`, `position=[0,0,1000]`) is already on the branch (commit `500c7fe`) and is required for any raycast in top-down ortho. Do not revert it.
- `tileR` is the add/remove radius: ~0.6 × the tile footprint. Clicking within it of a spike removes that spike; clicking outside it of every spike adds a new one. Drag dedup uses the same radius so a stroke lays spikes ~one footprint apart.
- Free spikes are stored only on the primary layer (`g.addedSpikes`). Compound layers are hidden, so the click handlers operate on the primary layer (`Pattern_0` / `layerIdx === 0`) only.
