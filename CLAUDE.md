# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GrippySheet Studio — a browser-based 3D design tool that lets users build custom printable grip-tape patterns for electric skateboards (Onewheel-style decks; outlines under `public/outlines/` like `pint.dxf`, `floatwheel.dxf`, etc.). Output is exported as STL or 3MF (Bambu/Orca) for FDM printing. Single-page React app deployed to GitHub Pages at https://techfoundrynz.github.io/grippysheet-studio.

The repo root (`/home/ubuntu/grippy`) contains a single project directory `grippysheet-studio/`. All commands below are run from there.

## Commands

Package manager is **pnpm** (declared via `packageManager` in `package.json`).

```bash
pnpm install         # install deps
pnpm dev             # vite dev server
pnpm build           # production build → dist/  (also surfaces TS errors via tsc --noEmit)
pnpm lint            # eslint .
pnpm preview         # serve dist/ locally
pnpm deploy:gh       # gh-pages -d dist  (publish current dist to gh-pages branch)

pnpm test            # vitest watch
pnpm test:run        # vitest run (one-shot, used in verification)
```

**Tests cover the ColorFlow pipeline only** — pure modules under `src/colorflow/` (schema, outline math, polygonize, modeFilter, quantize, extrude, threeMfWriter, vendored libs, spike helpers). There are no React tests; UI changes are verified by running the dev server. Don't claim "all tests pass" as proof that a UI change works.

## Architecture

### State flows top-down from `App.tsx`

Four settings objects live in `App.tsx` state and propagate via props (no global store):

- `BaseSettings` — grip outline shape, size, thickness, color, mirror/rotation, and `outlineSlug` (library preset id; null for custom uploads). The Base tab is the **single source of truth** for the outline regardless of which creation path the user picks.
- `InlaySettings` — array of `InlayItem`s (logos/badges) with per-item transform, mode (`single`/`tile`), modifier (`none`/`cut`/`mask`/`avoid`), and positioning. Pattern-mode only.
- `GeometrySettings` — the tiled pattern (e.g. dots, hex bumps) applied across the grip surface, plus tiling distribution and clipping options. Used by both modes — pattern mode tiles the bumps directly, ColorFlow mode reuses the same tiles as spike overlays.
- `ColorFlowSettings` — image quantize/trace/extrude controls (colorCount, simplify, detail, smooth, sort), image transform (offsetMm, scale), per-color uniform layer height (`colorLayerMm`), optional `layerOrder` manual override, plus spike controls (`spikeMaxMm`, `spikeColorMatch`).

All four are defined as **Zod schemas** in `src/types/schemas.ts` (ColorFlow schema in `src/colorflow/schema.ts`). Defaults are derived by `getDefaults(schema)` (which calls `schema.parse({})`) in `src/utils/schemaDefaults.ts` — don't hardcode defaults elsewhere; extend the schema instead.

Settings split into two roles:
1. **Pure settings** (numbers/strings/enums): serialized to JSON on export.
2. **Runtime shapes** (`cutoutShapes`, `patternShapes`, `InlayItem.shapes`): live `THREE.Shape`/`THREE.BufferGeometry` objects, **stripped to `null` before JSON export** and rehydrated from bundled asset files on import.

### The right panel (`Controls.tsx`)

Tabbed (Base / Inlay / ColorFlow / Geometry) with `react-freeze` pausing inactive tabs. The Inlay tab disables itself while ColorFlow is active (mutual exclusion). Each pattern-mode tab is a sub-component under `src/components/controls/`; the ColorFlow tab is itself split into seven focused sub-components under `src/colorflow/controls/` (`BaseStatusBanner`, `ImageSection`, `ColorSliders`, `PrintControls`, `SpikeControls`, `LayerControls`, `StatusFooter`) — `ColorFlowControls.tsx` is the orchestrator that owns state, effects, and worker calls. The footer hosts Reset, Import/Export Project (bundle), and the `OutputPanel` (STL/3MF export buttons).

### Mode detection

`App.tsx` derives `viewerMode: 'pattern' | 'colorflow'` from `colorFlowGeom !== null`. The ColorFlow extrude effect calls `onGeometryReady`, which sets `colorFlowGeom`; once it's non-null, the 3D viewer routes to `ColorFlowModel` and the export goes through the ColorFlow 3MF writer. Going back to pattern mode requires `Reset All Settings`.

### The left panel (`ModelViewer.tsx` → `ImperativeModel.tsx` / `ColorFlowModel.tsx` / `TwoDViewer.tsx`)

`ModelViewer` owns the `@react-three/fiber` `Canvas`, the camera rig (ortho ↔ perspective via `CameraRig.tsx`), `OrbitControls`, FPS overlay, screenshot capture, the bottom-left pad-dimension readout, the global processing-spinner overlay, and the debug UI (outlines, wireframes, opacity, "cutter" debug meshes — gated by `geometrySettings.debugMode`, toggled with `Ctrl+Shift+D`).

`ModelViewer` also owns a **`renderMode: '2d' | '3d'`** toggle in the top toolbar; **2D is the default** for performance on modest devices. When in 2D, the Three.js Canvas is hidden inside a `display:none` wrapper (kept mounted so 3D state survives mode swaps) and `TwoDViewer` paints a top-down summary (outline silhouette, color regions or inlays, pattern-tile footprints, dimension lines, layer-order legend). Many of the 3D-only toolbar buttons (ortho/iso, opacity, display mode, debug) are disabled while in 2D.

The whole viewer area is also a **drop target** (`ModelViewer.tsx` ~L280+): images route to ColorFlow via `emitFileDrop({ kind: 'image:colorflow', file })`, DXF/SVG/STL files route to Base via `emitFileDrop({ kind: 'shape:base', file })`, and `.3mf` / `.zip` drops go through `importProjectBundle` and emit `project-loaded`. A nested enter/leave counter avoids overlay flicker over child elements.

**Right-click anywhere on the viewer** opens a `ContextMenu` (toggle 2D↔3D, Reset View, Save Screenshot, Open Outline Library, Upload Outline…, Upload Image…). The "Upload" items wire to hidden `<input type="file">` refs and reuse the same `emitFileDrop` pipeline as the canvas drag handler, so the keyboard path and the drag path stay equivalent.

**Keyboard shortcuts** (suppressed while a text input / contenteditable is focused or any modifier is held): `2` / `3` swap render mode, `O` orthographic, `I` isometric (both 3D-only), `F` toggles the FPS counter. `Ctrl+Shift+D` (separate handler) toggles `geometrySettings.debugMode`.

The Canvas wraps in `<ErrorBoundary>` so a crash in geometry construction (CSG, earcut, ImperativeModel) doesn't take the whole studio down.

`ImperativeModel.tsx` (~1500 lines) is the **3D model factory**. It's intentionally imperative — instead of rendering JSX children, each `useEffect` reacts to a slice of props and mutates the shared `THREE.Group` (`meshRef`) directly. Building the model involves:

- **Base mesh** (`mesh.name = 'Base'`): extruded from `cutoutShapes` with rotation/mirror applied.
- **Inlays** (`InlayGroup` container, children named `Inlay_<id>_<tileIdx>_<shapeIdx>`): per-item shapes, optionally tiled.
- **Pattern** (`mesh.name = 'Pattern'`, often a `THREE.InstancedMesh`): the tiled grip texture, then CSG-clipped to the base outline (minus inlay masks/avoid zones / holes).
- **Debug meshes** (`Debug_*` names): visualisations of CSG cutters and waste — filtered out on export.

CSG uses **three-bvh-csg** (`SUBTRACTION`, `INTERSECTION`). 2D polygon offsetting (margin/avoid zones) uses **clipper-lib** via `src/utils/offsetUtils.ts`. Tile placement (grid/offset/hex/radial/random/wave/zigzag/warped-grid) lives in `src/utils/patternUtils.ts`.

### Export pipeline (`OutputPanel.tsx`)

**Pattern-mode path**: reads `meshRef.current` and walks it via `prepareForExport`, which expands `InstancedMesh` → `Group` of individual `Mesh`es (STL/3MF can't represent instancing), filters meshes whose name starts with `Debug_`, and shallow-clones `Base` and `Pattern` (drops their CSG children). 3MF goes through `three-3mf-exporter`; STL via `STLExporter` from `three-stdlib`.

**ColorFlow path**: when `colorFlowGeom` is non-null, the 3MF export uses the explicit assembly in `src/colorflow/threeMfWriter.ts`. Parts emitted: `base` + one per color **level** + one per spike group. The naming convention is `color_<pos+1>_<hex>` / `spikes_c<centroidIndex>` so the Bambu slicer's "Load filaments from project" picks them up in stack order.

#### 3MF round-trip (`src/utils/grippySidecar.ts`, `src/colorflow/threeMfWriter.ts`, `src/utils/projectUtils.ts`)

Every exported `.3mf` carries the editable project alongside the printable geometry. `addGrippySidecar` writes the full `ProjectDataV2` (runtime shapes stripped to `null`) + the original uploaded asset bytes under a private `Metadata/grippy/` namespace:

```
Metadata/grippy/project.json
Metadata/grippy/assets/{base,pattern,image}/<filename>
Metadata/grippy/assets/inlays/<id>/<filename>
```

Bambu/Orca/Cura ignore unknown `Metadata/` paths, so the same file slices cleanly AND re-opens in the studio. `importProjectBundle` in `projectUtils.ts` accepts both `.3mf` and legacy `.zip` — `.3mf` is unzipped via JSZip and `readGrippySidecar` looks for `Metadata/grippy/project.json`. Foreign 3MFs (slicer output, third-party files) have no sidecar and are **rejected with a clear toast** rather than silently importing geometry.

The sidecar reader runs the v1→v2 migrator on legacy bundles and validates path-safe inlay ids (`/^[A-Za-z0-9_-]{1,64}$/`) before keying them into `assets.inlays`.

### Asset I/O

- `src/utils/shapeLoader.ts` — entry point: parses DXF/SVG/STL `ArrayBuffer`/string into shapes, with content sniffing to fix wrong file extensions and optional color extraction for SVGs.
- `src/utils/dxfUtils.ts` — custom DXF → `THREE.Shape` converter (handles arcs, splines, etc.); we don't use a single off-the-shelf parser end-to-end.
- `src/utils/fileTypeSniffer.ts` — detect type from bytes when extension is missing/wrong.
- `src/utils/projectUtils.ts` — project save = JSZip containing `project.json` (Zod-validated `ProjectSchema`) + `assets/{base,pattern,inlays/<id>}/<filename>` of the original uploaded files. Import re-parses the assets back into runtime shapes.

`ShapeUploader.tsx` is the shared file-picker UI; it notifies parent of both the parsed shapes *and* the raw asset bytes (so they can be bundled into a project export).

### Interaction

`src/components/interaction/InlayInteractionHandles.tsx` lets the user drag/scale/rotate inlays directly inside the 3D scene. While dragging it disables `OrbitControls` (via `orbitRef.current.enabled`) and broadcasts a `previewInlay` to `ImperativeModel` so the inlay can be shown without committing to state every frame.

`src/components/interaction/InlayHoverHint.tsx` is the in-scene affordance that makes inlays look interactive **before** the user clicks. It raycasts each frame against the `InlayGroup` descendants, parses the hovered mesh's `Inlay_<id>_<tileIdx>_<shapeIdx>` name back to an id, overlays an orange `EdgesGeometry` outline (30° silhouette threshold, brand-500), and sets `cursor: pointer` on the Canvas DOM element. It also installs a `click` listener on the canvas — this is the first click-to-select path in 3D; previously selection only worked from the right panel. Suppressed when an inlay is already selected (handles take over), mid-drag, or in 2D mode.

### Typed event bus (`src/utils/eventBus.ts`)

A strongly-typed pub/sub that decouples cross-component signals from prop drilling. The central `EventMap` interface parameterises `on/emit`, so subscribers get the payload narrowed automatically and a new event without a map entry is a TS error at the publish site.

Internal dispatch (`_emit`) is module-private and JSDoc-marked `@internal`; all publishes go through typed helpers (`emitProcessing`, `emitToast`, `emitFileDrop`, `emitOpenOutlineLibrary`, `emitSetActiveTab`, `emitInlayTransform`, `emitProjectLoaded`). This keeps ad-hoc `eventBus.emit('whatever', …)` calls out of the codebase.

Events currently on the bus:

- `processing` — `{ key, busy, label? }`. Spinner-overlay protocol (see below).
- `toast` — `{ message, detail?, tone: 'ready' | 'info' | 'error' }`. Rendered by `ToastHost`; `emitToast` defaults `tone` to `'ready'`.
- `file-drop` — discriminated `{ kind: 'image:colorflow' | 'shape:base'; file }`. Canvas-to-control bridge.
- `open-outline-library` — `void`. Asks `BaseControls` to open the library picker (e.g. from the viewer's right-click menu).
- `set-active-tab` — `{ tab: 'base' | 'inlay' | 'colorflow' | 'geometry' }`. Programmatic right-panel navigation.
- `inlay-transform` — `{ id, x, y, rotation?, scale? }`. Live drag preview from `InlayInteractionHandles` to `ImperativeModel`.
- `project-loaded` — `{ data: ProjectDataV2, assets }`. Fired after a canvas-dropped `.3mf` / `.zip` parses successfully.

**File-drop replay buffer.** `emitFileDrop` also writes the event to a module-local `pendingFileDrop` slot with a 1.5s TTL. Tab panels gated by `<Freeze>` aren't mounted when the drop fires, so they miss the live event; on mount they call `consumePendingFileDrop(expectedKind)` to claim any in-flight drop matching their kind. The buffer is single-consume so two subscribers can't both grab the same file.

### Processing overlay protocol

Heavy async/sync work broadcasts on the `processing` channel of the bus:

```ts
emitProcessing({ key: 'colorflow:worker', busy: true, label: 'tracing' });
// ...later
emitProcessing({ key: 'colorflow:worker', busy: false });
```

`ModelViewer` subscribes once and maintains a `Map<key, label>`; the top-right spinner pill shows whenever the map is non-empty, concatenating labels. Current sources: ColorFlow worker phases (`quantize`/`trace`/`extrude`/`simplifying`), Base outline fetch, Geometry pattern fetch, 3MF export, manual spike generation. Use a stable `key` per source so concurrent emits don't clobber each other.

`useDebouncedCommit` in `src/utils/useDebouncedCommit.ts` is the local-draft + 250ms debounced-commit pattern used by ColorFlow sliders so dragging doesn't fire the pipeline on every tick.

## Conventions and gotchas

- **React Compiler is on** (`babel-plugin-react-compiler` target 19 in `vite.config.ts`). Don't add manual `useMemo`/`useCallback` purely for perf — the compiler handles it. Existing memos usually exist because of an actual referential-identity requirement (e.g. Three.js objects shared across effects).
- **Mesh names are load-bearing**: `OutputPanel`, `ModelViewer`, and screenshot logic all look up meshes by name (`Base`, `Pattern`, `InlayGroup`, prefix `Debug_`, prefix `Inlay_`). Don't rename without auditing the search sites.
- **Coordinate convention**: scene is Z-up. Cameras have `up={[0,0,1]}`; `gridHelper` is rotated `[π/2, 0, 0]` to lie on XY. 2D shapes (DXF/SVG) live in XY; thickness extrudes along +Z.
- **`cutoutShapes` is the base outline, not a hole list.** When `null`, `ImperativeModel` falls back to a centered `size × size` square so inlays/patterns still render. "Holes" (in the `THREE.Shape.holes` sense) on the cutout shape become subtracted regions.
- **Imported projects may lose live shapes.** If a user exports without the original asset in memory, `projectUtils` warns about "Missing Asset Files"; on import, the settings load but `*Shapes` remain null until they re-upload. Don't add code paths that assume shapes are always present alongside their settings.
- **Auto-save (`src/utils/autoSave.ts` + `src/components/ResumeBanner.tsx`).** `saveAutoSnapshot({ project })` debounces 500ms and writes a stripped `ProjectDataV2` (runtime shapes nulled) to `localStorage['grippy_autosave_v1']`. **Asset bytes are intentionally not persisted** (quota), so a restore loads settings only and prompts re-upload — same contract as the 3MF sidecar writer. On mount, `loadAutoSnapshot` reads + Zod-validates the snapshot; if it survives, App seeds state from it and renders `ResumeBanner` when the user still has default mount-state. **Auto-save is suppressed while the banner is visible** so the default values that App boots with can't clobber the snapshot before the user decides. Schema/JSON corruption clears the snapshot; quota/IO errors warn-and-skip without crashing.
- **Brand tokens (`tailwind.config.js`).** Custom palette: `brand-50…900` (Onewheel orange, primary identity, `brand-500` = `#ff6b1a`), `accent-500/600` (neon pink `#ff2dd1`, secondary punch), `signal-{ready, ready-dim, pending, error, info}` (VESC neon-green telemetry channels). Font stacks: `font-display` = Space Grotesk, `font-mono` = JetBrains Mono, `font-sans` = Inter. Custom shadows: `shadow-glow-brand` (orange halo) and `shadow-glow-ready` (green halo) for active/ready states. Prefer these over inline hex — the palette is intentional brand identity.
- **Build timestamp** is injected via Vite `define` as `__BUILD_TIMESTAMP__`; it's referenced in `Controls.tsx` (`import.meta.env.DEV ? 'DEV' : __BUILD_TIMESTAMP__`). Declared in `src/vite-env.d.ts`.
- **Deployment**: `pnpm deploy:gh` publishes whatever is in `dist/`. Custom domain is set via `public/CNAME` (also: `homepage` in `package.json` for the gh-pages base URL). If you change the domain, update both.
- **Strict TS settings**: `noUnusedLocals` and `noUnusedParameters` are on. Prefix intentionally-unused params with `_` rather than disabling. `tsc --noEmit -p tsconfig.app.json` is the way to surface errors in `src/`; the root `tsconfig.json` has `files: []` and won't check anything.
- **Context value stability**: contexts (e.g. `AlertContext`) MUST `useCallback` their handlers and `useMemo` the value object — a fresh function/object on every provider render cascades into effect-dep churn in consumers and has caused infinite render loops in the past.
- **`colorFlowGeom?.source` is keyed by content for change detection**, not by reference. App-level `useEffect`s that respond to "source changed" should depend on a stringified shape (palette length + stackOrder + baseMm + colorLayerMm), not on `colorFlowGeom.source` directly — the extrude pipeline produces a fresh source object every run with the same content.

### UI primitives (`src/components/ui/`)

Small, focused, app-wide controls. Prefer these over hand-rolled `<input>` / menu / tooltip shells — they handle the a11y + edge cases consistently.

- **`NumberStepper.tsx`** — instrument-dial numeric input with `−` / `+` buttons, arrow-key nudging (Shift = `bigStep`, defaults to `step × 10`), scroll-wheel, and accelerating long-press repeat. Controlled (`value` / `onChange`); **commits only on blur or Enter** so typing `-12.5` doesn't blast intermediate `-` / `-1` values through the parent. Optional `unit` suffix (mm/deg/%) renders muted; `precision` inferred from `step` if omitted.
- **`IconTooltip.tsx`** — `<IconTooltip label="…" shortcut="O">{child}</IconTooltip>`. Portals to `<body>` so it escapes `overflow:hidden` toolbar parents; ~300ms hover delay; clones the child with `aria-describedby` wired to a `useId`-stable tooltip id, and projects the shortcut into the accessible name (`"label, shortcut O"`) for SR users while sighted users see a `<kbd>` chip.
- **`ToastHost.tsx`** — single global subscriber to the bus `toast` event. Bottom-center stack, **caps at 4 visible toasts**, **dedupes identical content within 600ms** by refreshing the existing toast's expiry, 2.4s lifetime. Three tones (`ready` neon-green / `info` cyan / `error` red); uses `aria-live="polite"` for ready/info and escalates to `role="alert"` + `assertive` for `error`. Mount once near the app root.
- **`ContextMenu.tsx`** — generic right-click menu used by the viewer (and reusable elsewhere). Portals to `<body>`, clamps to the viewport, full keyboard nav (arrows / Home / End / Enter / Escape), and **restores focus to the previously-focused element on close** so a11y isn't broken. Items support `label`, optional `shortcut` kbd chip, `onClick`, `separator`, `disabled`; falsy entries in the items array are filtered.
- **`SegmentedControl.tsx`** — generic mutually-exclusive pill group. The `semantics` prop picks the ARIA pattern: `'radio'` (default — `role="radiogroup"` + `aria-checked`, used by the 2D/3D pill, Place/Tile, Layout Mode) or `'tab'` (`role="tablist"` + `aria-selected`, roving tabindex, ArrowLeft/Right wrap, wires `id="tab-<value>"` / `aria-controls="tabpanel-<value>"`). Single-action activation in both modes — panels are pre-mounted via `react-freeze`, so no perf reason to defer.

### ColorFlow mode (`src/colorflow/`)

A peer creation path to pattern/inlay. The user picks a base outline in the Base tab, drops an image in the ColorFlow tab, the worker quantizes + traces + extrudes the colored regions, and the 3D viewer renders the result. Optionally a Geometry-tab pattern adds spike bumps on top.

- **Pipeline lives in a Web Worker** (`colorflow/worker.ts`). Main thread sends `quantize` / `trace` / `extrude` requests via the `useColorFlowWorker` hook; worker returns transferable typed-array geometries. The hook also drives the worker-phase pill via `emitProcessing` (see "Processing overlay" below).
- **Outline-anchored working canvas**: dimensions are `outline.widthMm × CANVAS_PX_PER_MM` (default 5 px/mm, capped at `MAX_CANVAS_DIM`). The source image is rendered into that canvas at fit-then-user-scale-then-user-offset. See `imageTransform.ts` for the pure math and `ImageTransformPreview.tsx` for the drag/wheel UI. The outline polygon is **rotated/mirrored according to the Base tab's `baseOutlineRotation` / `baseOutlineMirror`** before sizing the canvas — pattern-mode and ColorFlow-mode renders stay in sync.
- **The 3D viewer is reused**. `ModelViewer` routes to `ColorFlowModel.tsx` when `colorFlowGeom` is non-null. The model is built per-section: base mesh, color-level meshes, and spike meshes each track their own refs and only dispose/recreate when their specific inputs change. Materials use `flatShading: true` on `MeshStandardMaterial` to avoid per-triangle smooth-shading noise on flat tops.
- **Stack model is per-LEVEL, not per-color** (since `6a9fece`). For each level `k` ∈ `[0, palette.length)`, the worker emits ONE merged mesh containing the union of polygons whose centroid sits at `stackPos >= k`, occupying `z = [baseMm + k×layer, baseMm + (k+1)×layer]`. Top-down view is unchanged but the printed assembly is a true stair-step: each slab uses one filament with no mid-layer swaps. The emitted level still tags by its color (`stackOrder[k]`) so naming + the 3D viewer stay color-keyed.
- **Stack order**: `resolvedStackOrder(palette, coverage, settings)` in `stackOrder.ts`. `settings.layerOrder` is the manual override array; null means sort by `settings.sort` (`luma` ascending or `coverage` descending).
- **Mesh + 3MF naming uses stack position**: `Color_<pos+1>_<hex>` for in-scene meshes, `color_<pos+1>_<hex>` for 3MF parts. The worker emits `layerGeoms` pre-sorted by position so downstream code doesn't re-sort.
- **Spike overlay**: when a Geometry-tab pattern is configured, `generateSpikes` (in `spikes.ts`) tiles the pattern across the pad and assigns each tile to the topmost color region beneath it (`assignTilesToColors`). STL patterns are scaled in Z so all spike tops land at the user's `spikeMaxMm` cap; Shape patterns prism-extrude. **Spike regen is gated by a manual "Generate preview" button** in `SpikeControls` — the heavy computation only runs on click, not on every input change. App-level state tracks `generatedSpikeInputsKey` (a stringified hash of every input) to display Up-to-date / Regenerate states. Cleared when the underlying source content (palette size, stack order, baseMm, colorLayerMm) changes — so stale spikes referencing old color polygons never render.
- **Outlines** come from `colorflow/outlineLibrary.ts` (a 16-entry manifest referencing the existing DXFs in `public/outlines/`). The same dropdown is also surfaced in pattern-mode `BaseControls`.
- **Vendored libs** in `colorflow/vendor/` (ImageTracer + earcut, public-domain). Don't add them as npm deps — the upstream versions are unmaintained.
- **3MF assembly export** lives in `threeMfWriter.ts` (JSZip-based, hand-rolled XML) rather than `three-3mf-exporter`, because we need exact part-name control for Bambu's filament auto-assignment.
