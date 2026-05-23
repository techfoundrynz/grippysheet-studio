# ColorFlow pre-PR fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ColorFlow feature shippable: stop the perpetual worker re-trigger loop, delete the ~10× redundant image traces in the worker, add proper request cancellation, and apply the agreed UX/UI polish.

**Architecture:** Two surgical React fixes break the loop (`useMemo` the App-side `initialImageAsset`, make the hydration effect run-once) and a worker-side deletion removes the redundant SVG generation that was dominating trace cost. The worker hook adds latest-wins cancellation by tracking the most recent request id per kind. The UX changes touch six small files in the `colorflow/` tree.

**Tech Stack:** TypeScript, React 19 (React Compiler on), Three.js / @react-three/fiber, Vite + Web Workers, vitest (pure modules only — no React tests). Package manager: `pnpm`.

**Spec reference:** `docs/superpowers/specs/2026-05-21-colorflow-prepr-fixes-design.md`.

**Repository quirk:** the git repository is rooted at `/home/ubuntu/grippy/grippysheet-studio/` and this work happens in the worktree at `/home/ubuntu/grippy/grippysheet-studio/.worktrees/colorflow-image-mode` (branch `colorflow-image-mode`). All commands below assume `cd /home/ubuntu/grippy/grippysheet-studio/.worktrees/colorflow-image-mode`.

**Subagent safety note:** Never run `git reset --hard`, `git clean -fd`, `rm -rf` on tracked files, or `git checkout -- .` to "make a commit work." If a commit fails, investigate the root cause (usually staged + unstaged mixed, or hook failure). Stage explicit files only. **Do not commit any untracked PNGs in the project root** (`ux-*.png`, `cf_test.png`, etc.) — those are review screenshots from a prior session.

**Spec item U3 ("gate controls before image/outline exist")** is already satisfied by the existing `className={... ? '' : 'opacity-40 pointer-events-none'}` gating in each `controls/*.tsx` sub-component and the `if (palette.length === 0) return null` early-returns in `SpikeControls`/`LayerControls`. No task is needed for U3.

## File map

**Modified:**
- `src/App.tsx` — wrap `initialImageAsset` in `useMemo` (Task 1)
- `src/colorflow/ColorFlowControls.tsx` — guard hydration effect with `hydratedRef`; mark in-session uploads as hydrated; renumber `⑤ Export` section away (Tasks 1, 5)
- `src/colorflow/worker.ts` — delete `combinedSvg`, per-layer SVG loop, and discarded `preview` ImageData (Task 2)
- `src/colorflow/workerProtocol.ts` — drop `previewSvg`, `layerSvgs`, `combinedSvg` from `Response` union (Task 2)
- `src/colorflow/useColorFlowWorker.ts` — latest-wins per-kind cancellation (Task 3)
- `src/colorflow/controls/SpikeControls.tsx` — heading `Spike pattern` → `⑤ Spike pattern` (Task 5)
- `src/colorflow/controls/LayerControls.tsx` — heading `Layers` → `⑥ Layers` (Task 5)
- `src/colorflow/TwoDViewer.tsx` — area-threshold sliver label suppression + add effect dependency array (Tasks 6, 8)
- `src/components/ModelViewer.tsx` — pass real `colorFlowSettings.spikeColorMatch` to `TwoDViewer` (Task 7)

**New:** none. (Spec didn't introduce new files.)

---

## Task 1: B1 — kill the perpetual re-trigger loop

**Files:**
- Modify: `src/App.tsx:181-183`
- Modify: `src/colorflow/ColorFlowControls.tsx:1` (imports), `:96-112` (hydration effect), `:151-172` (`handleImageFile`)

The loop chain: `App.tsx:181-183` builds `initialImageAsset` as a fresh object literal every render → passed to `ColorFlowControls` → the hydration `useEffect` (`ColorFlowControls.tsx:96`, dep `[initialImageAsset, showAlert]`) re-fires every App render → `createImageBitmap` → `setImageBitmap(newBitmap)` → quantize effect re-fires → trace → extrude → `onGeometryReady` → `App.setColorFlowGeom` → App re-renders → fresh `initialImageAsset` → loop. Two surgical changes fix it: stabilize the reference, and make the hydration effect idempotent.

- [ ] **Step 1.1: Stabilize `initialImageAsset` in `App.tsx`**

Open `src/App.tsx`. `useMemo` is already imported (used at line 96 and line 171). Replace the inline ternary at lines 181-183 with a `useMemo`:

```tsx
  const initialImageAsset = useMemo(
    () => projectAssets.image
      ? { name: projectAssets.image.name, bytes: projectAssets.image.content as ArrayBuffer }
      : null,
    [projectAssets.image],
  );
```

- [ ] **Step 1.2: Add `useRef` to `ColorFlowControls.tsx` imports**

Open `src/colorflow/ColorFlowControls.tsx`. The current import on line 1 is:

```ts
import React, { useCallback, useEffect, useMemo, useState } from 'react';
```

Add `useRef`:

```ts
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

- [ ] **Step 1.3: Guard the hydration effect by comparing the asset's bytes reference**

A plain "hydrated once" flag would break the case where the user uploads in-session and *then* imports a project — the imported asset would silently fail to load because hydration is permanently disabled. Instead, track which `ArrayBuffer` we have already hydrated; hydration runs whenever a new asset's `.bytes` reference arrives.

Inside the `ColorFlowControls` component body, just before the `// Hydrate from project bundle.` comment at line 95, add the ref declaration:

```ts
  // Hydration tracks the bytes ArrayBuffer (stable across the App.tsx
  // useMemo'd initialImageAsset → projectAssets.image.content → bytes chain).
  // A new asset reference (project import, or a different in-session upload
  // before we've pre-claimed) triggers one hydration; pre-claimed refs skip.
  const lastHydratedBytesRef = useRef<ArrayBuffer | null>(null);
```

Then replace the existing hydration effect (currently lines 96-112) with the guarded version:

```tsx
  // Hydrate from project bundle. Idempotent per ArrayBuffer reference —
  // handleImageFile pre-claims the ref before triggering the App re-render,
  // so an in-session upload doesn't fight its own hydration round-trip.
  useEffect(() => {
    if (!initialImageAsset) return;
    if (lastHydratedBytesRef.current === initialImageAsset.bytes) return;
    lastHydratedBytesRef.current = initialImageAsset.bytes;
    let cancelled = false;
    (async () => {
      try {
        const blob = new Blob([initialImageAsset.bytes]);
        const bitmap = await createImageBitmap(blob);
        if (cancelled) return;
        setImageBitmap(bitmap);
        setImageName(initialImageAsset.name);
        setImageDims({ w: bitmap.width, h: bitmap.height });
      } catch (err) {
        showAlert({ title: 'Failed to load saved image', message: String(err), type: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [initialImageAsset, showAlert]);
```

- [ ] **Step 1.4: Pre-claim the bytes ref in `handleImageFile`**

Find `handleImageFile` (currently starting at line 151). After the existing `const bytes = await file.arrayBuffer();` line (currently line 157), add a single line that pre-claims the hydration ref **before** the `onImageAssetChanged` call propagates the new asset back through App state:

```tsx
    const bytes = await file.arrayBuffer();
    // Pre-claim the hydration tracker so the upcoming App re-render's
    // initialImageAsset doesn't trigger a redundant ImageBitmap decode of
    // bytes we're already turning into a bitmap below.
    lastHydratedBytesRef.current = bytes;
    onImageAssetChanged?.({ name: file.name, bytes });
```

The rest of `handleImageFile` (lines 159-172) stays unchanged: it creates the bitmap, optionally downsizes, and calls `setImageBitmap`.

- [ ] **Step 1.5: Build to verify the changes type-check**

Run: `pnpm build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 1.6: Run the existing pipeline tests**

Run: `pnpm test:run`
Expected: 85 tests pass (no test changes were needed).

- [ ] **Step 1.7: Manual verification — confirm the loop is gone**

Start the dev server: `pnpm dev` (background). In a browser at `http://localhost:5173/`:
1. Dismiss the welcome modal ("Get Started").
2. Base tab → Outline Library → pick "Pint · 206.1×173.4mm".
3. ColorFlow tab → drag/click the Image dropzone → upload any PNG with a few distinct colours (`.playwright-mcp/cf_test.png` from the prior review session works, or create any test PNG).
4. Wait for the initial trace to finish.
5. Let the app sit idle for at least 60s. The viewer's top-right pill must NOT cycle on "TRACING" / "EXTRUDING" — it should remain empty after the initial run completes.

Stop the dev server when done.

If the loop is still visible: re-check Steps 1.1 and 1.3 carefully, then re-test.

- [ ] **Step 1.8: Commit**

```bash
git add src/App.tsx src/colorflow/ColorFlowControls.tsx
git commit -m "$(cat <<'EOF'
Stop ColorFlow worker re-trigger loop

initialImageAsset was rebuilt as a fresh object literal every App
render; ColorFlowControls' hydration effect re-fired on each render,
re-creating imageBitmap and cascading through quantize → trace →
extrude → onGeometryReady → App re-render forever. useMemo
initialImageAsset and guard hydration with a ref so it runs at most
once.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: B2 — delete dead SVG generation in the worker

**Files:**
- Modify: `src/colorflow/worker.ts:58-72` (drop `preview` ImageData), `:94-130` (drop combinedSvg + per-layer SVG loop)
- Modify: `src/colorflow/workerProtocol.ts:46-53` (drop `previewSvg`, `layerSvgs`, `combinedSvg`)

`handleTrace` runs the real `trace()`, then re-traces the whole image via `imagedataToSVG` (for `combinedSvg`), then re-traces ONCE PER PALETTE COLOUR (for `layerSvgs`). `handleQuantize` builds a `preview` `ImageData` (~width×height×4 bytes) only to post `previewSvg: ''`. Grep across `src/` confirms none of these three fields are consumed:

```
$ grep -rn "previewSvg\|layerSvgs\|combinedSvg" src/ --include='*.ts' --include='*.tsx'
src/colorflow/worker.ts:71:      ... previewSvg: '' ...
src/colorflow/worker.ts:96:      const combinedSvg = ...
src/colorflow/worker.ts:106,123,127,130:    layerSvgs ...
src/colorflow/workerProtocol.ts:49-51:  ... previewSvg / layerSvgs / combinedSvg ...
```

Only producers and the type definition reference them — no consumers.

- [ ] **Step 2.1: Re-confirm the grep before editing**

Run:
```bash
grep -rn "previewSvg\|layerSvgs\|combinedSvg" src/ --include='*.ts' --include='*.tsx'
```
Expected: matches only in `src/colorflow/worker.ts` and `src/colorflow/workerProtocol.ts`. If there are any other matches, STOP and report — a consumer exists that the spec missed.

- [ ] **Step 2.2: Remove the dead `preview` ImageData and `previewSvg` field in `handleQuantize`**

Open `src/colorflow/worker.ts`. Replace the block currently at lines 58-72 (from the `// Build a quick combined preview…` comment through the `post(...)` call) with this single `post`:

```ts
  post(
    { id, kind: 'quantized', palette, assignments },
    [assignments.buffer],
  );
```

That deletes the `preview` allocation, the per-pixel fill loop, the stale comment, and the unused `previewSvg: ''` payload.

- [ ] **Step 2.3: Remove combinedSvg + per-layer SVG generation in `handleTrace`**

Still in `src/colorflow/worker.ts`. Replace the block currently from line 94 (the `// Build the combined SVG ...` comment) through line 130 (the final `post(...)`) with this simplified version that calls `trace()` once and posts only the polygon layers:

```ts
  // Polygons per layer (skip layer 0 = transparent slot).
  const layerEntries: TracedLayerEntry[] = [];
  for (let li = 1; li < td.layers.length; li++) {
    const polys = layerToPolygons(td.layers[li]);
    const centroidIndex = li - 1;
    for (const p of polys) layerEntries.push({ centroidIndex, polygon: p });
  }

  post({ id, kind: 'traced', layers: layerEntries });
```

This removes the redundant second `imagedataToSVG` call, the per-color loop (~N extra full traces), the `binary` ImageData allocation, and the `layerSvgs` map.

- [ ] **Step 2.4: Drop the unused fields from the `Response` union**

Open `src/colorflow/workerProtocol.ts`. Replace lines 46-53 (the entire `Response` type) with:

```ts
export type Response =
  | { id: number; kind: 'progress'; phase: string }
  | { id: number; kind: 'quantized'; palette: Centroid[]; assignments: Uint16Array }
  | { id: number; kind: 'traced'; layers: TracedLayerEntry[] }
  | { id: number; kind: 'extruded'; baseGeom: TransferredGeom; layerGeoms: ExtrudedLayerEntry[] }
  | { id: number; kind: 'error'; phase: string; message: string };
```

- [ ] **Step 2.5: Build to confirm no consumer breaks**

Run: `pnpm build`
Expected: build succeeds. Any TypeScript error here would indicate a consumer DID read one of the removed fields (the grep should have caught it — investigate).

- [ ] **Step 2.6: Run the pipeline tests**

Run: `pnpm test:run`
Expected: 85 tests pass. None of the worker-protocol-touching tests assert on the removed fields.

- [ ] **Step 2.7: Manual verification — trace is fast**

Restart the dev server (`pnpm dev`). Repeat the manual flow from Step 1.7 (outline + image). The trace step should complete in well under a second on the same image that previously took ~15-20s. The 2D viewer should show the same traced output as before.

- [ ] **Step 2.8: Commit**

```bash
git add src/colorflow/worker.ts src/colorflow/workerProtocol.ts
git commit -m "$(cat <<'EOF'
Delete dead SVG generation from ColorFlow worker

handleTrace was running trace() once for real, then imagedataToSVG
again for combinedSvg, then once per palette colour for layerSvgs —
all consumed nowhere. handleQuantize was also building a discarded
preview ImageData. Removing them takes the trace step from ~10× full
traces to 1, and the trace response no longer carries unused string
payloads.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: B4 — latest-wins worker request cancellation

**Files:**
- Modify: `src/colorflow/useColorFlowWorker.ts` (whole hook restructure)

Today, rapid input queues N full pipeline runs that all complete; stale `progress` messages clobber the status pill; `pendingRef` entries for abandoned requests are never deleted. Fix: per-kind "latest id" tracking. A new request of a given kind supersedes earlier in-flight requests of the same kind: the earlier promise rejects with a sentinel error and its pending entry is deleted, so its eventual worker response is dropped. The worker is single-threaded JS — a handler already executing can't be interrupted, but its result is filtered out on the main thread.

We do NOT modify `worker.ts` for cancellation. Worker-side bail would require an out-of-band cancel-message protocol; main-thread filtering is enough to solve the visible bugs (stale state, stuck pill, leaked pending map).

- [ ] **Step 3.1: Replace `src/colorflow/useColorFlowWorker.ts` with the cancellation-aware version**

Replace the entire file contents with:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Request, Response } from './workerProtocol';
import ColorFlowWorker from './worker?worker';

/** Distributive Omit: correctly removes 'id' from each member of the union. */
type OmitId<T> = T extends unknown ? Omit<T, 'id'> : never;

export interface WorkerStatus {
  phase: string | null;
  error: string | null;
}

/** Thrown when a request is superseded by a later request of the same kind.
 *  Callers should treat this as a benign "drop the result" signal. */
export class RequestCancelledError extends Error {
  constructor(kind: string) {
    super(`ColorFlow request superseded (${kind})`);
    this.name = 'RequestCancelledError';
  }
}

let nextId = 1;

type RequestKind = OmitId<Request>['kind'];
interface PendingEntry {
  kind: RequestKind;
  resolve: (r: Response) => void;
  reject: (e: Error) => void;
}

export function useColorFlowWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<number, PendingEntry>>(new Map());
  /** id of the latest in-flight request per kind. Older requests with the
   *  same kind are superseded. */
  const latestIdByKindRef = useRef<Map<RequestKind, number>>(new Map());
  const [status, setStatus] = useState<WorkerStatus>({ phase: null, error: null });

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const w = new ColorFlowWorker();
    w.onmessage = (e: MessageEvent<Response>) => {
      const msg = e.data;
      const pending = pendingRef.current.get(msg.id);

      if (msg.kind === 'progress') {
        // Only the latest in-flight request drives the pill, so stale progress
        // messages from a superseded run can't clobber the live phase.
        if (pending && latestIdByKindRef.current.get(pending.kind) === msg.id) {
          setStatus({ phase: msg.phase, error: null });
        }
        return;
      }

      if (!pending) return; // already cancelled and cleaned up
      pendingRef.current.delete(msg.id);

      // Drop terminal responses for superseded requests; the new in-flight
      // request of the same kind will drive both state and the pill.
      const isLatest = latestIdByKindRef.current.get(pending.kind) === msg.id;

      if (msg.kind === 'error') {
        if (isLatest) {
          setStatus({ phase: null, error: msg.message });
          pending.reject(new Error(`${msg.phase}: ${msg.message}`));
        } else {
          pending.reject(new RequestCancelledError(pending.kind));
        }
        return;
      }

      // Success path: only resolve if still latest; otherwise reject as cancelled.
      if (isLatest) {
        setStatus({ phase: null, error: null });
        pending.resolve(msg);
      } else {
        pending.reject(new RequestCancelledError(pending.kind));
      }
    };
    w.onerror = (e) => {
      setStatus({ phase: null, error: e.message });
      // Reject any in-flight requests; tear down so next request spawns a fresh worker.
      for (const [, p] of pendingRef.current) p.reject(new Error(e.message));
      pendingRef.current.clear();
      latestIdByKindRef.current.clear();
      w.terminate();
      workerRef.current = null;
    };
    workerRef.current = w;
    return w;
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const request = useCallback(<R extends Response>(
    req: OmitId<Request>,
    transfer: Transferable[] = [],
  ): Promise<R> => {
    const w = ensureWorker();
    const id = nextId++;
    const kind = req.kind;

    // Supersede any in-flight request of the same kind.
    const prevId = latestIdByKindRef.current.get(kind);
    if (prevId !== undefined && prevId !== id) {
      const prev = pendingRef.current.get(prevId);
      if (prev) {
        pendingRef.current.delete(prevId);
        prev.reject(new RequestCancelledError(kind));
      }
    }
    latestIdByKindRef.current.set(kind, id);

    return new Promise<R>((resolve, reject) => {
      pendingRef.current.set(id, {
        kind,
        resolve: resolve as (r: Response) => void,
        reject,
      });
      w.postMessage({ ...req, id }, transfer);
    });
  }, [ensureWorker]);

  return { request, status };
}
```

- [ ] **Step 3.2: Update callers to swallow `RequestCancelledError`**

Open `src/colorflow/ColorFlowControls.tsx`. Find the three pipeline effects (quantize ~line 176, trace ~line 217, extrude ~line 240). Each has a `try { ... } catch (err) { showAlert({ title: '... failed', message: String(err), type: 'error' }); }` block. We must not surface a cancelled-request error as a toast.

Add this import near the top of the file (next to the existing `useColorFlowWorker` import on line 5):

```ts
import { RequestCancelledError, useColorFlowWorker } from './useColorFlowWorker';
```

Then in each of the three `catch (err)` blocks, change the body from:

```ts
      } catch (err) {
        showAlert({ title: 'Quantization failed', message: String(err), type: 'error' });
      }
```

to (using the appropriate title per stage — "Quantization failed", "Tracing failed", "Extrusion failed"):

```ts
      } catch (err) {
        if (err instanceof RequestCancelledError) return;
        showAlert({ title: 'Quantization failed', message: String(err), type: 'error' });
      }
```

Apply this edit at all three `catch` sites. Keep each stage's title text unchanged.

- [ ] **Step 3.3: Build and test**

```
pnpm build
pnpm test:run
```
Expected: both succeed; 85 tests pass.

- [ ] **Step 3.4: Manual verification — rapid drag is debounced cleanly**

Restart `pnpm dev`. Repeat the standard flow (outline + image). Then:
1. Grab the "colors" slider in ③ Colors and drag it rapidly back and forth across 2..10 several times.
2. Watch the top-right viewer pill and the right-panel status footer.
3. Expected: at most one full pipeline run executes per drag-pause. While dragging, the pill should not stack stale phases. No "Quantization failed" / "Tracing failed" toasts appear.
4. After the drag settles, exactly one run completes for the final value.

If you see error toasts during rapid drag, Step 3.2 missed a catch site — re-check all three pipeline effects.

- [ ] **Step 3.5: Commit**

```bash
git add src/colorflow/useColorFlowWorker.ts src/colorflow/ColorFlowControls.tsx
git commit -m "$(cat <<'EOF'
Add latest-wins cancellation to ColorFlow worker requests

A new request of a given kind now supersedes earlier in-flight
requests of the same kind: the earlier promise rejects with
RequestCancelledError and its pending entry is deleted, so stale
worker responses are dropped on arrival. The status pill ignores
progress messages from superseded runs. Pipeline-effect catch
blocks swallow RequestCancelledError so cancellation doesn't
surface as a toast.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: U1 — renumber sections, drop the Export pseudo-section

**Files:**
- Modify: `src/colorflow/ColorFlowControls.tsx:362-367` (delete the `⑤ Export` section)
- Modify: `src/colorflow/controls/SpikeControls.tsx:41` (heading text)
- Modify: `src/colorflow/controls/LayerControls.tsx:33` (heading text)

Target layout:

```
① Base   ② Image   ③ Colors   ④ Print   ⑤ Spike pattern   ⑥ Layers
```

①–④ already exist correctly. Drop the empty ⑤ Export section (the footer's "Export 3MF (Bambu/Orca)" button is the real control). Number the previously-unnumbered "Spike pattern" and "Layers" sections.

- [ ] **Step 4.1: Delete the Export pseudo-section in `ColorFlowControls.tsx`**

Open `src/colorflow/ColorFlowControls.tsx`. Delete the entire block currently at lines 362-367:

```tsx
      <section className={layers.length > 0 ? '' : 'opacity-40 pointer-events-none'}>
        <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">⑤ Export</h3>
        <p className="text-xs text-gray-400">
          Use <span className="text-blue-400 font-bold">Export 3MF</span> in the footer below to download the multi-part Bambu assembly.
        </p>
      </section>
```

Leave the surrounding `<LayerControls .../>` and `<StatusFooter .../>` in place.

- [ ] **Step 4.2: Renumber `SpikeControls` heading**

Open `src/colorflow/controls/SpikeControls.tsx`. At line 41, change:

```tsx
      <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">Spike pattern</h3>
```

to:

```tsx
      <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">⑤ Spike pattern</h3>
```

- [ ] **Step 4.3: Renumber `LayerControls` heading**

Open `src/colorflow/controls/LayerControls.tsx`. At line 33, change:

```tsx
      <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">Layers</h3>
```

to:

```tsx
      <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">⑥ Layers</h3>
```

- [ ] **Step 4.4: Build**

Run: `pnpm build`
Expected: build succeeds. (No TS changes; pure JSX text.)

- [ ] **Step 4.5: Manual verification — section sequence reads 1-6 with no Export step**

Restart `pnpm dev`. Repeat the standard flow (outline + image). In the ColorFlow tab scroll the right panel and confirm the headings now read, top to bottom: `① Base`, `② Image`, `③ Colors`, `④ Print`, `⑤ Spike pattern`, `⑥ Layers`. The "Export" section is gone. The footer's "Export 3MF (Bambu/Orca)" button remains and works.

- [ ] **Step 4.6: Commit**

```bash
git add src/colorflow/ColorFlowControls.tsx src/colorflow/controls/SpikeControls.tsx src/colorflow/controls/LayerControls.tsx
git commit -m "$(cat <<'EOF'
Renumber ColorFlow panel sections 1-6, drop Export pseudo-section

Spike pattern and Layers now carry ⑤ and ⑥ numbers, matching the
existing ①-④ on Base/Image/Colors/Print. The Export section was a
numbered step whose body just pointed at the footer button; deleted
in favour of the real footer control.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: U2 — suppress sliver-polygon labels in the 2D viewer

**Files:**
- Modify: `src/colorflow/TwoDViewer.tsx:176-200` (layer-label collection)

The 2D viewer puts an `L#` label at the centroid of every traced polygon. Anti-aliasing on a colour edge produces many tiny sliver polygons; the viewer labels each one, so a circle's edge ends up ringed with stray labels. Fix: compute each polygon's area in mm² and skip the label for polygons below a threshold (relative to the largest polygon for the same colour, with an absolute floor so tiny pads still get one label per colour).

- [ ] **Step 5.1: Add a polygon-area helper near the top of `TwoDViewer.tsx`**

Open `src/colorflow/TwoDViewer.tsx`. Add this helper just after the `patternFootprint2D` function (currently ending around line 70):

```ts
/** Signed area (shoelace) magnitude of a polygon ring, in the units of the
 *  input points. Used to suppress labels on tiny anti-aliasing slivers. */
function polygonRingArea(ring: Array<[number, number]>): number {
  if (ring.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}
```

- [ ] **Step 5.2: Track area on each label candidate and apply a per-colour threshold**

Still in `src/colorflow/TwoDViewer.tsx`. Find the layer-label collection block (currently lines 176-200) — the loop that pushes `{ x, y, layerNum, color }` onto `layerLabels` for each polygon.

Replace the existing `layerLabels` declaration and the polygon-centroid block (currently around lines 177-199) with this version that records the area too and filters slivers after the loop:

```tsx
    // Track polygon centroids per color so we can annotate with layer numbers.
    // Record area too so we can suppress labels on anti-aliasing slivers.
    const labelCandidates: Array<{ x: number; y: number; layerNum: number; color: Centroid; centroidIndex: number; areaMm2: number }> = [];
    for (const entry of sortedLayers) {
      const c = palette[entry.centroidIndex];
      if (!c) continue;
      const path = new Path2D();
      pathRing(path, entry.polygon.outer);
      for (const hole of entry.polygon.holes) pathRing(path, hole);
      ctx.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
      ctx.fill(path, 'evenodd');
      // Faint outline so adjacent same-color polygons read as distinct regions.
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.lineWidth = 0.8;
      ctx.stroke(path);

      // Polygon centroid (simple ring-mean — good enough for labeling).
      const stackPos = positionByCentroid.get(entry.centroidIndex);
      if (stackPos !== undefined && entry.polygon.outer.length > 0) {
        let cx = 0, cy = 0;
        for (const [px, py] of entry.polygon.outer) { cx += px; cy += py; }
        cx /= entry.polygon.outer.length;
        cy /= entry.polygon.outer.length;
        const areaMm2 = polygonRingArea(entry.polygon.outer);
        labelCandidates.push({ x: cx, y: cy, layerNum: stackPos + 1, color: c, centroidIndex: entry.centroidIndex, areaMm2 });
      }
    }

    // Suppress labels on sliver polygons: per colour, drop anything below
    // 15% of that colour's largest polygon AND below an absolute 25 mm² floor.
    const maxAreaPerCentroid = new Map<number, number>();
    for (const cand of labelCandidates) {
      const cur = maxAreaPerCentroid.get(cand.centroidIndex) ?? 0;
      if (cand.areaMm2 > cur) maxAreaPerCentroid.set(cand.centroidIndex, cand.areaMm2);
    }
    const SLIVER_REL = 0.15;
    const SLIVER_ABS_MM2 = 25;
    const layerLabels = labelCandidates.filter((cand) => {
      const maxA = maxAreaPerCentroid.get(cand.centroidIndex) ?? cand.areaMm2;
      return cand.areaMm2 >= SLIVER_ABS_MM2 || cand.areaMm2 >= maxA * SLIVER_REL;
    });
```

The downstream loop at lines ~327-345 already reads from `layerLabels` with the existing shape; the extra `centroidIndex` / `areaMm2` fields on the type are harmless extras.

- [ ] **Step 5.3: Build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5.4: Manual verification — sliver labels gone**

Restart `pnpm dev`. Upload the same multi-colour test image (a circle on a contrasting background works well — anti-aliasing produces slivers). In the 2D viewer, confirm: a single `L#` label sits on each major colour region; the sliver halo of duplicate labels around colour edges is gone.

- [ ] **Step 5.5: Commit**

```bash
git add src/colorflow/TwoDViewer.tsx
git commit -m "$(cat <<'EOF'
2D viewer: suppress layer labels on anti-aliasing slivers

Every traced polygon used to get an L# label at its centroid, so a
circle edge ended up ringed with stray labels from sub-pixel
slivers. Now we compute each polygon's mm² area and drop labels
below 15% of the colour's largest polygon AND below a 25 mm² floor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: U4 — pass real `spikeColorMatch` to 2D viewer

**Files:**
- Modify: `src/components/ModelViewer.tsx:538` (the `spikeColorMatch={true}` literal)
- Possibly modify: `src/components/ModelViewer.tsx` Props (add `colorFlowSettings`) and `src/App.tsx` ModelViewer render site.

The 2D viewer always colour-matches spikes because `ModelViewer.tsx:538` hardcodes `spikeColorMatch={true}`. The 3D path honours the user's `colorFlowSettings.spikeColorMatch`. Wire the real value through.

- [ ] **Step 6.1: Check whether `ModelViewer` already receives `colorFlowSettings`**

Run:
```bash
grep -n "colorFlowSettings" src/components/ModelViewer.tsx | head -20
grep -n "ModelViewer" src/App.tsx | head -10
```

If `colorFlowSettings` already appears in `ModelViewer.tsx` (as a prop or destructured), skip to Step 6.3. If it does not, do Step 6.2 first.

- [ ] **Step 6.2: Thread `colorFlowSettings` into `ModelViewer` (only if missing)**

In `src/components/ModelViewer.tsx`, find the component's `Props` interface (near the top). Add:

```ts
  colorFlowSettings: ColorFlowSettings;
```

Add the type import at the top of the file:

```ts
import type { ColorFlowSettings } from '../colorflow/schema';
```

Destructure `colorFlowSettings` in the component signature (whatever pattern the file already uses — likely `({ ... }) =>`).

Then in `src/App.tsx`, find where `<ModelViewer ... />` is rendered (around line 203 per the earlier grep) and add the prop:

```tsx
                colorFlowSettings={colorFlowSettings}
```

- [ ] **Step 6.3: Replace the hardcoded `spikeColorMatch={true}`**

In `src/components/ModelViewer.tsx`, change line 538 from:

```tsx
          spikeColorMatch={true}
```

to:

```tsx
          spikeColorMatch={colorFlowSettings.spikeColorMatch}
```

- [ ] **Step 6.4: Build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 6.5: Manual verification — 2D respects the toggle**

Restart `pnpm dev`. Full flow: outline + image + pick a pattern in the Geometry tab so spikes appear. In ColorFlow's ⑤ Spike pattern, untick "color-match spikes to the region below". In the 2D viewer the spike tile fills should switch from the per-region colour to the pattern colour. Re-tick and confirm they go back.

- [ ] **Step 6.6: Commit**

```bash
git add src/components/ModelViewer.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
2D viewer: respect colorFlowSettings.spikeColorMatch

ModelViewer was passing spikeColorMatch={true} as a literal into
TwoDViewer; the 2D preview ignored the user's setting while 3D
honoured it. Thread the real value through.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: U5 — `TwoDViewer` draw effect dependency array

**Files:**
- Modify: `src/colorflow/TwoDViewer.tsx:92-354` (the giant `useEffect` with no deps)
- Modify: `src/colorflow/TwoDViewer.tsx:88-90` and surrounding (add a `ResizeObserver` effect)

The draw effect ends `});` at line 354 with no dependency array, so it re-runs on every render — repainting the canvas and rerunning `generateTilePositions` / `assignTilesToColors` on every unrelated state change. Add an explicit dep array, and a separate `ResizeObserver`-backed redraw so container size changes still repaint.

- [ ] **Step 7.1: Lift the draw routine into a callback so the resize observer can invoke it**

Open `src/colorflow/TwoDViewer.tsx`. The simplest refactor: extract the draw body into a `useCallback` that the main effect and a `ResizeObserver` effect both call. Replace the entire `useEffect(() => { ... });` block (currently lines 92-354) by wrapping the same body in `const draw = useCallback(() => { ... }, [<deps>]);` and following it with two effects.

Concretely, change the structure from:

```tsx
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    // ...340 lines of draw code...
  });
```

to:

```tsx
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    // ...340 lines of draw code — unchanged...
  }, [outlinePolygon, layersInMm, palette, stackOrder, inlayItems, geometrySettings, baseColor, spikeColorMatch]);

  // Repaint when any draw input changes.
  useEffect(() => {
    draw();
  }, [draw]);

  // Repaint when the container resizes (the draw call reads getBoundingClientRect).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);
```

(Add `useCallback` to the `react` import at line 1: `import React, { useCallback, useEffect, useRef } from 'react';`.)

The draw body itself is unchanged — only the wrapping changes.

- [ ] **Step 7.2: Build**

Run: `pnpm build`
Expected: build succeeds with no React Hook exhaustive-deps lint errors. (If the lint surfaces an extra dep you missed, add it to the `draw` `useCallback`'s dep array.)

- [ ] **Step 7.3: Lint**

Run: `pnpm lint`
Expected: no new errors / warnings introduced by this file. (Repo-wide lint baseline has pre-existing errors; just confirm `TwoDViewer.tsx` itself doesn't add to them.)

- [ ] **Step 7.4: Manual verification — 2D paints once per real input change + on resize**

Restart `pnpm dev`. Full flow. In the 2D viewer:
1. Resize the browser window — the 2D canvas should repaint cleanly.
2. Toggle the FPS counter (top toolbar) — the 2D canvas should NOT flicker or repaint (it's an unrelated change).
3. Reorder layers in ⑥ Layers — the 2D canvas SHOULD repaint with the new stack.

- [ ] **Step 7.5: Commit**

```bash
git add src/colorflow/TwoDViewer.tsx
git commit -m "$(cat <<'EOF'
2D viewer: add dependency array to draw effect

The draw useEffect had no deps array, so it repainted the whole
canvas and re-ran generateTilePositions + assignTilesToColors on
every unrelated render. Extract the draw body into a useCallback
keyed on the real inputs, paint via a tight dep effect, and use a
ResizeObserver so container size changes still trigger a redraw.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: B3 — verify the 2D↔3D toggle no longer re-runs the pipeline

**Files:** none (verification task).

After Task 1 lands, toggling the viewer 2D/3D control should be a pure display flip. We expected the previously-observed re-run was a symptom of the B1 loop firing on the toggle's re-render. Confirm.

- [ ] **Step 8.1: Manual verification — toggle is display-only**

Restart `pnpm dev`. Full flow until the initial pipeline completes (no "TRACING" pill). Then:
1. Toggle the top-toolbar "3D" button. The 3D viewer should appear with the existing geometry; no pill, no worker activity.
2. Toggle back to "2D". The 2D viewer appears; no pill.
3. Toggle back and forth 5+ times rapidly. The pill must stay empty throughout.

- [ ] **Step 8.2: If the toggle still triggers a re-run**

If you see "TRACING" / "EXTRUDING" appear on the toggle:
1. Open the browser devtools and inspect which ColorFlow effect fires (add a `console.log('quantize fired')` etc. temporarily inside each effect body in `ColorFlowControls.tsx`).
2. Identify which dep changed — typical suspects are `inlaySettings.items` (changes shape across `colorFlowGeom ? undefined : ...`), `geometrySettings`, or a `renderMode`-dependent value in the React tree that pushes a fresh prop down.
3. Stabilize the offending value (`useMemo` at the call site) and re-test.
4. Commit the stabilization separately:

```bash
git add <files>
git commit -m "Stabilize <name> so 2D/3D toggle stops re-firing pipeline"
```

If the toggle is clean, no commit is needed for this task — the previous tasks' fixes already covered it.

---

## Task 9: U6 — investigate washed-out light colours in 3D

**Files:**
- Possibly modify: `src/colorflow/ColorFlowModel.tsx` (material) and/or the lighting setup in `src/components/ModelViewer.tsx`.

In the 3D view the largest light region (`#F1FAEE`) renders medium-gray. This is likely either `MeshStandardMaterial`'s default `metalness`/`roughness` darkening near-white, the scene lighting being underexposed for light colours, or the colour being converted through sRGB twice. Fix only if it's a small, contained change; otherwise drop a note and defer.

- [ ] **Step 9.1: Identify the material**

In `src/colorflow/ColorFlowModel.tsx`, find where the colour-level meshes' material is created (the `flatShading: true` `MeshStandardMaterial` mentioned in CLAUDE.md). Note the current parameters.

- [ ] **Step 9.2: Try a focused fix**

Try, in this order, stopping at the first that visibly fixes the issue without breaking the look of other colours:

a) Set `metalness: 0, roughness: 0.8` on the colour-level material if not already.
b) Wrap the colour string through `new THREE.Color(hex).convertSRGBToLinear()` when assigning to `material.color`, IF the renderer is configured with `outputColorSpace = THREE.SRGBColorSpace` (check `Canvas` props in `ModelViewer.tsx`).
c) Add or boost an `AmbientLight` intensity in the scene (check `Canvas` children for lights).

Each option is one line of change. Try one, build, restart dev, look. If none of (a)/(b)/(c) is a clean improvement after ~15 minutes total, STOP and leave a `// TODO: light colours wash out in 3D (U6 deferred)` comment near the colour-level material and skip the commit.

- [ ] **Step 9.3: If a fix worked, commit**

```bash
git add <changed files>
git commit -m "$(cat <<'EOF'
3D viewer: render light ColorFlow colours closer to true

<one-line description of the actual change made>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If no fix landed cleanly, no commit; the TODO marker is the deliverable.

---

## Final verification

After all tasks above are committed:

- [ ] **Step F.1: Full health gate**

```
pnpm lint
pnpm test:run
pnpm build
```

Lint: do not regress any of the ColorFlow-owned files vs the pre-existing repo baseline (the `master` branch ships with a large existing error count from non-ColorFlow code — that's not our concern).
Tests: 85 pass.
Build: succeeds.

- [ ] **Step F.2: End-to-end manual smoke**

`pnpm dev`. Walk the full flow once:

1. Welcome → Get Started.
2. Base tab → outline library → Pint.
3. ColorFlow tab → upload a multi-colour PNG.
4. Wait for the pipeline (now fast). Confirm:
   - No perpetual TRACING pill while idle.
   - 2D viewer shows L1–L5 labels only on real regions, not on slivers.
   - Sections read ①–⑥ with no Export step.
5. Geometry tab → pick a pattern (e.g. `pubgrip.stl`). Back to ColorFlow → ⑤ Spike pattern → "Generate preview".
6. Untick "color-match spikes" — 2D viewer spikes switch colour.
7. Toggle viewer 3D ↔ 2D a few times — no pipeline re-fire.
8. Drag the "colors" slider rapidly — no toasts, no stuck pill.
9. Footer → "Export 3MF (Bambu/Orca)" → file downloads.

- [ ] **Step F.3: Branch state ready for PR**

```
git status --short
git log --oneline master..HEAD
```

`git status` should be clean (modulo any pre-existing untracked PNGs in the project root). The `git log` should show this PR's commit chain on top of the existing branch work. The branch is now ready for the user to open the PR against `master`.
