# ColorFlow pre-PR fixes — design

**Status**: design, not yet implemented
**Date**: 2026-05-21
**Branch**: `colorflow-image-mode` (worktree at `.worktrees/colorflow-image-mode/`)
**Implementation plan**: TBD (next step is `superpowers:writing-plans`)

## 1. Problem

A pre-PR review pass of the ColorFlow feature surfaced one blocking bug and a
set of smaller correctness/UX issues. The headline problem: **with a ColorFlow
image loaded, the worker pipeline (`quantize → trace → extrude`) re-runs on a
perpetual loop with no user input** — confirmed by observation, the "TRACING"
pill cycles on/off forever while the app sits idle. Each cycle takes ~15–20s
because the worker also does ~10× redundant image traces. The combination makes
the tool feel permanently busy and laggy.

This design covers the agreed fix scope: **blockers + visible UX/UI polish +
proper worker cancellation**. Internal optimization refactors (modeFilter,
buffer allocations, mask transfer, ColorFlowModel material-split, bundle
code-splitting) are explicitly out of scope.

## 2. Root cause of the loop

`App.tsx:181-183` builds `initialImageAsset` as a fresh object literal on every
render:

```ts
const initialImageAsset = projectAssets.image
  ? { name: projectAssets.image.name, bytes: projectAssets.image.content as ArrayBuffer }
  : null;
```

It is passed to `ColorFlowControls` as `initialColorFlowImageAsset`. The
hydration `useEffect` in `ColorFlowControls.tsx:96-112` depends on
`[initialImageAsset, showAlert]`, so it re-fires on every App render →
`createImageBitmap` → `setImageBitmap(newBitmap)`.

The new `imageBitmap` reference re-fires the quantize effect
(`ColorFlowControls.tsx:176`, dep `imageBitmap`) → trace → extrude →
`onGeometryReady` → `App.setColorFlowGeom` → App re-renders → new
`initialImageAsset` → loop. By elimination, `imageBitmap` is the only
non-primitive quantize dependency that can churn (`outlinePolygon` and
`settings.*` are provably stable during idle), and the hydration effect is the
only code that changes it — so this is the chain. The loop period equals one
pipeline duration because App re-renders exactly once per completed cycle.

This also fires on a normal **upload** (not just project import): the upload
handler `handleImageFile` calls `onImageAssetChanged`, which populates
`projectAssets.image`, which activates the hydration path.

## 3. Scope

**In scope** (all on `colorflow-image-mode`):

Blockers:
- **B1** — stop the perpetual re-trigger loop.
- **B2** — remove the dead SVG generation that makes the trace ~10× too slow.
- **B3** — verify the 2D↔3D toggle no longer re-runs the pipeline (expected to
  be a symptom of B1).
- **B4** — add latest-wins worker request cancellation.

UX/UI polish:
- **U1** — renumber the ColorFlow panel sections; drop the empty Export section.
- **U2** — skip 2D-viewer labels on sliver polygons.
- **U3** — gate the Colors/Print/Spike/Layers controls until an image+outline
  exist.
- **U4** — fix `spikeColorMatch` hardcoded `true` in the 2D viewer path.
- **U5** — give the `TwoDViewer` draw effect a dependency array.
- **U6** — investigate the washed-out light colors in the 3D view; fix only if
  it is a small lighting/material change.

**Out of scope** (deferred): `modeFilter` mode-scan optimization, level-mesh
buffer pre-allocation, worker image double-decode / mask transfer /
`ImageBitmap.close()`, `ColorFlowModel` geometry-vs-material effect split,
`polygonUnion` precision review, bundle code-splitting, `Centroid.index`
removal, `ColorFlowModel` double-dispose cleanup. These are real but lower-risk
and can be a follow-up PR.

## 4. B1 — stop the re-trigger loop

Two changes, both required:

1. **Stabilize `initialImageAsset`** (`App.tsx`). Wrap it in `useMemo` keyed on
   `projectAssets.image`:

   ```ts
   const initialImageAsset = useMemo(
     () => projectAssets.image
       ? { name: projectAssets.image.name, bytes: projectAssets.image.content as ArrayBuffer }
       : null,
     [projectAssets.image],
   );
   ```

   `projectAssets.image` is set once per upload/import, so the memo reference is
   then stable across the `setColorFlowGeom` re-renders.

2. **Make hydration idempotent** (`ColorFlowControls.tsx:96-112`). The hydration
   effect exists to restore a saved image on **project import**; it should run
   at most once and must not fight in-session uploads. Guard it with a ref:

   ```ts
   const hydratedRef = useRef(false);
   useEffect(() => {
     if (hydratedRef.current) return;
     if (!initialImageAsset) return;
     hydratedRef.current = true;
     // ...existing createImageBitmap logic...
   }, [initialImageAsset, showAlert]);
   ```

   If the user uploads a fresh image in-session (`handleImageFile` already set
   `imageBitmap`), hydration must not overwrite it. Setting `hydratedRef` in
   `handleImageFile` as well (or checking `imageBitmap === null` before
   hydrating) ensures an in-session upload wins over the stored asset.

Change (1) alone breaks the loop; change (2) additionally removes a redundant
second image decode on every upload and is the correct long-term shape of the
effect. Both ship together.

## 5. B2 — remove dead SVG generation (slow trace)

`worker.ts` does far more work than anything consumes:

- `handleTrace` calls `trace()` (the real, used path) **and then**
  `imagetracer.imagedataToSVG(img, …)` — a second full re-trace of the whole
  image — to build `combinedSvg`.
- `handleTrace` then loops over every palette color, builds a fresh
  `width×height` `ImageData`, and runs `imagedataToSVG` again **per color** to
  build `layerSvgs`.
- `handleQuantize` builds a full-canvas `preview` `ImageData` (lines ~59-68)
  that is never read — it posts `previewSvg: ''`.

`combinedSvg`, `layerSvgs`, and `previewSvg` are not referenced anywhere in
`src/`. For an 8-colour image this is roughly 10 full traces where 1 is needed.

**Fix:** delete the `combinedSvg` block, the per-layer SVG loop, the `preview`
`ImageData` block, and the `layerSvgs` / `combinedSvg` / `previewSvg` fields
from the `Response` union in `workerProtocol.ts`. Update `useColorFlowWorker` /
`ColorFlowControls` response handling to match. This is deletion of unused code;
no behaviour that any consumer relies on changes.

*Note:* this was classified as a blocker because the ~15–20s trace is itself a
release blocker, and the fix is removing dead code rather than a refactor.

## 6. B3 — 2D↔3D toggle re-runs the pipeline

Observed during review: toggling the viewer's 2D/3D control re-ran the worker
pipeline. The likely cause is the B1 loop firing on the extra App re-render that
the toggle produces. **Action:** after B1 lands, re-test the toggle. If it still
re-runs the pipeline, root-cause separately (candidate: a `renderMode`-dependent
value flowing into a pipeline effect dependency). No speculative change now.

## 7. B4 — worker request cancellation

Today `useColorFlowWorker.request()` has no cancellation. Rapid slider/drag
input queues N full `quantize+trace+extrude` jobs that all run FIFO to
completion; stale `progress` messages also clobber the live status pill, and
`pendingRef` entries for abandoned requests are never deleted.

**Approach — latest-wins generation token:**

- `useColorFlowWorker` keeps a monotonically increasing `generation` counter. A
  new "pipeline run" (a quantize kicked off by the quantize effect) bumps the
  generation. `request()` tags each message with its `generation`.
- The worker tracks the highest `generation` it has seen. At the entry of
  `handleQuantize` / `handleTrace` / `handleExtrude` it compares the request's
  generation to the latest; if stale, it posts a lightweight `cancelled`
  response and returns immediately — this drains superseded **queued** work
  without running it. JavaScript is single-threaded, so a handler already
  executing is allowed to finish; only queued handlers are skipped.
- On the main thread, the worker `onmessage` handler drops any response whose
  generation is not current (resolve the pending promise as cancelled / or
  simply delete the pending entry and never resolve, with callers already
  guarded by their `cancelled` effect-cleanup flag).
- `setStatus` (the pill) only updates for the current generation, so stale
  `progress` messages cannot clobber the live phase.
- Pending-map hygiene: delete `pendingRef` entries for superseded requests so
  the map cannot grow unbounded.

The three pipeline stages are separate worker messages, so generation-skipping
at handler entry already prevents most wasted work — a superseded run that has
finished `quantize` will skip `trace` and `extrude`.

This is a behaviour-preserving addition: in the steady state (one run at a time)
nothing changes.

## 8. UX/UI polish

### U1 — Section numbering

Current panel order: Base, Image, Colors, Print, Spike pattern, Layers, Export.
"Spike pattern" and "Layers" are unnumbered; "⑤ Export" is an empty section
whose body only says "use the footer button".

**Fix:** renumber the six real sections sequentially and delete the Export
pseudo-section. Final layout:

```
① Base   ② Image   ③ Colors   ④ Print   ⑤ Spike pattern   ⑥ Layers
```

The footer's existing "Export 3MF (Bambu/Orca)" button remains the export
control. Section headings live in the `ColorFlowControls` sub-components
(`controls/*.tsx`); update the heading strings there.

### U2 — 2D viewer label clutter

`TwoDViewer` draws an `L#` label at the centroid of every traced polygon,
including tiny anti-aliasing sliver polygons (e.g. ~10 stray "L4" labels
ringing a circle edge). **Fix:** in the label-drawing pass, skip polygons whose
area is below a small threshold (e.g. a fraction of the largest polygon for that
colour, or an absolute mm² floor). Optionally draw only one label per colour at
its largest polygon. Keep it simple — an area threshold is sufficient.

### U3 — Gate controls before image/outline exist

In the empty state the Colors/Print/Spike/Layers controls render fully
interactive even though they do nothing without an image. **Fix:** disable (or
hide the bodies of) sections ③–⑥ until `hasOutline && hasImage`. The dimmed
heading already exists; extend the same gating to the controls.

### U4 — `spikeColorMatch` hardcoded in 2D viewer

`ModelViewer.tsx` (~line 539) passes `spikeColorMatch={true}` literally to
`TwoDViewer`, so the 2D preview always colour-matches spikes even when the user
disabled the setting (3D respects it). **Fix:** pass
`colorFlowSettings.spikeColorMatch` through instead.

### U5 — `TwoDViewer` draw effect dependency array

The main draw `useEffect` in `TwoDViewer.tsx` (ends ~line 354) has **no
dependency array**, so it re-runs on every render — including unrelated state
churn — re-doing a full canvas repaint plus `generateTilePositions` +
`assignTilesToColors`. **Fix:** add an explicit dependency array covering the
draw inputs (`outlinePolygon`, `layersInMm`, `palette`, `stackOrder`,
`inlayItems`, `geometrySettings`, `baseColor`, `spikeColorMatch`). Add a
`ResizeObserver` on the container so container-size changes still trigger a
redraw once the deps array stops incidental resize repaints.

### U6 — Washed-out light colours in 3D

In the 3D view the largest light region (`#F1FAEE`) renders medium-gray rather
than near-white. **Action:** investigate whether scene lighting / the
`MeshStandardMaterial` settings darken light palette colours. Fix only if it is
a small, contained lighting or material adjustment; otherwise note it and defer.

## 9. Test plan

- **vitest** (pure modules): B2 changes the worker `Response` shape — update
  `threeMfWriter`/`vendor`/any worker-protocol-touching tests and the
  `workerProtocol` type. Existing 85 tests must stay green.
- **Manual / browser** (no React tests in this project):
  - B1: load an outline + image; confirm the pipeline runs **once** and the
    "TRACING" pill clears and stays cleared while idle.
  - B2: confirm trace completes quickly (well under the previous ~15–20s) and
    the traced output is unchanged.
  - B3: toggle 2D↔3D repeatedly; confirm no pipeline re-run.
  - B4: drag the `colors` slider rapidly; confirm only the final value's run
    completes and the pill reflects the live phase.
  - U1–U5: visually confirm numbering 1–6, no Export section, no sliver labels,
    gated empty state, 2D spike colour follows the setting.
- **Health gates:** `pnpm test:run` green, `pnpm build` succeeds. (`pnpm lint`
  has pre-existing repo-wide errors unrelated to this work; do not regress the
  ColorFlow-owned files.)

## 10. Risks

| Risk | Mitigation |
|------|------------|
| B1 hydration guard breaks project-import image restore | Keep the import path: the ref allows exactly one hydration; verify import-then-render restores the saved image. |
| B2 removes a field some consumer secretly reads | Grep confirmed `combinedSvg`/`layerSvgs`/`previewSvg` are unreferenced in `src/`; type removal will surface any miss at compile time. |
| B4 generation logic drops a response that was actually current | Bump generation only at quantize-start (one place); echo generation verbatim; treat "unknown" as current to fail safe. |
| U5 deps array omits an input → stale 2D canvas | Enumerate every value the draw routine reads; the `ResizeObserver` covers the one non-prop input (container size). |
