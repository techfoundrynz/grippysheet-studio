# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

GrippySheet Studio — a browser-based 3D design tool that lets users build custom printable grip-tape patterns for electric skateboards (Onewheel-style decks; outlines under `public/outlines/` like `pint.dxf`, `floatwheel.dxf`, etc.). Output is exported as STL or 3MF (Bambu/Orca) for FDM printing. Single-page React app deployed to GitHub Pages at https://techfoundrynz.github.io/grippysheet-studio.

The repo root (`/home/ubuntu/grippy`) contains a single project directory `grippysheet-studio/`. All commands below are run from there.

## Commands

Package manager is **pnpm** (declared via `packageManager` in `package.json`).

```bash
pnpm install        # install deps
pnpm dev            # vite dev server
pnpm build          # production build → dist/
pnpm lint           # eslint .
pnpm preview        # serve dist/ locally
pnpm deploy:gh      # gh-pages -d dist  (publish current dist to gh-pages branch)
```

There is **no test runner configured**. Don't claim "tests pass" — there's nothing to run. TypeScript checking happens through `tsc --noEmit` (configured but not bound to a script); `pnpm build` will surface type errors.

## Architecture

### State flows top-down from `App.tsx`

Three independent settings objects live in `App.tsx` state and propagate via props (no global store):

- `BaseSettings` — grip outline shape, size, thickness, color, mirror/rotation
- `InlaySettings` — array of `InlayItem`s (logos/badges) with per-item transform, mode (`single`/`tile`), modifier (`none`/`cut`/`mask`/`avoid`), and positioning
- `GeometrySettings` — the tiled pattern (e.g. dots, hex bumps) applied across the grip surface, plus tiling distribution and clipping options

All three are defined as **Zod schemas** in `src/types/schemas.ts`. Defaults are derived by `getDefaults(schema)` (which calls `schema.parse({})`) in `src/utils/schemaDefaults.ts` — don't hardcode defaults elsewhere; extend the schema instead.

Settings split into two roles:
1. **Pure settings** (numbers/strings/enums): serialized to JSON on export.
2. **Runtime shapes** (`cutoutShapes`, `patternShapes`, `InlayItem.shapes`): live `THREE.Shape`/`THREE.BufferGeometry` objects, **stripped to `null` before JSON export** and rehydrated from bundled asset files on import.

### The right panel (`Controls.tsx`)

Tabbed (Base / Inlay / Geometry) with `react-freeze` pausing inactive tabs. Each tab is a sub-component under `src/components/controls/`. The footer hosts Reset, Import/Export Project (bundle), and the `OutputPanel` (STL/3MF export buttons).

### The left panel (`ModelViewer.tsx` → `ImperativeModel.tsx`)

`ModelViewer` owns the `@react-three/fiber` `Canvas`, the camera rig (ortho ↔ perspective via `CameraRig.tsx`), `OrbitControls`, FPS overlay, screenshot capture, and the debug UI (outlines, wireframes, opacity, "cutter" debug meshes — gated by `geometrySettings.debugMode`, toggled with `Ctrl+Shift+D`).

`ImperativeModel.tsx` (~1500 lines) is the **3D model factory**. It's intentionally imperative — instead of rendering JSX children, each `useEffect` reacts to a slice of props and mutates the shared `THREE.Group` (`meshRef`) directly. Building the model involves:

- **Base mesh** (`mesh.name = 'Base'`): extruded from `cutoutShapes` with rotation/mirror applied.
- **Inlays** (`InlayGroup` container, children named `Inlay_<id>_<tileIdx>_<shapeIdx>`): per-item shapes, optionally tiled.
- **Pattern** (`mesh.name = 'Pattern'`, often a `THREE.InstancedMesh`): the tiled grip texture, then CSG-clipped to the base outline (minus inlay masks/avoid zones / holes).
- **Debug meshes** (`Debug_*` names): visualisations of CSG cutters and waste — filtered out on export.

CSG uses **three-bvh-csg** (`SUBTRACTION`, `INTERSECTION`). 2D polygon offsetting (margin/avoid zones) uses **clipper-lib** via `src/utils/offsetUtils.ts`. Tile placement (grid/offset/hex/radial/random/wave/zigzag/warped-grid) lives in `src/utils/patternUtils.ts`.

### Export pipeline (`OutputPanel.tsx`)

Reads `meshRef.current` and walks it via `prepareForExport`, which:

- Expands `InstancedMesh` → `Group` of individual `Mesh`es (STL/3MF can't represent instancing).
- Filters meshes whose name starts with `Debug_`.
- Shallow-clones `Base` and `Pattern` (drops their CSG children).

3MF export goes through `three-3mf-exporter`; STL via `STLExporter` from `three-stdlib`.

### Asset I/O

- `src/utils/shapeLoader.ts` — entry point: parses DXF/SVG/STL `ArrayBuffer`/string into shapes, with content sniffing to fix wrong file extensions and optional color extraction for SVGs.
- `src/utils/dxfUtils.ts` — custom DXF → `THREE.Shape` converter (handles arcs, splines, etc.); we don't use a single off-the-shelf parser end-to-end.
- `src/utils/fileTypeSniffer.ts` — detect type from bytes when extension is missing/wrong.
- `src/utils/projectUtils.ts` — project save = JSZip containing `project.json` (Zod-validated `ProjectSchema`) + `assets/{base,pattern,inlays/<id>}/<filename>` of the original uploaded files. Import re-parses the assets back into runtime shapes.

`ShapeUploader.tsx` is the shared file-picker UI; it notifies parent of both the parsed shapes *and* the raw asset bytes (so they can be bundled into a project export).

### Interaction

`src/components/interaction/InlayInteractionHandles.tsx` lets the user drag/scale/rotate inlays directly inside the 3D scene. While dragging it disables `OrbitControls` (via `orbitRef.current.enabled`) and broadcasts a `previewInlay` to `ImperativeModel` so the inlay can be shown without committing to state every frame.

`src/utils/eventBus.ts` is a tiny pub/sub used to decouple a handful of cross-component events (e.g. processing-state nudges) from prop drilling.

## Conventions and gotchas

- **React Compiler is on** (`babel-plugin-react-compiler` target 19 in `vite.config.ts`). Don't add manual `useMemo`/`useCallback` purely for perf — the compiler handles it. Existing memos usually exist because of an actual referential-identity requirement (e.g. Three.js objects shared across effects).
- **Mesh names are load-bearing**: `OutputPanel`, `ModelViewer`, and screenshot logic all look up meshes by name (`Base`, `Pattern`, `InlayGroup`, prefix `Debug_`, prefix `Inlay_`). Don't rename without auditing the search sites.
- **Coordinate convention**: scene is Z-up. Cameras have `up={[0,0,1]}`; `gridHelper` is rotated `[π/2, 0, 0]` to lie on XY. 2D shapes (DXF/SVG) live in XY; thickness extrudes along +Z.
- **`cutoutShapes` is the base outline, not a hole list.** When `null`, `ImperativeModel` falls back to a centered `size × size` square so inlays/patterns still render. "Holes" (in the `THREE.Shape.holes` sense) on the cutout shape become subtracted regions.
- **Imported projects may lose live shapes.** If a user exports without the original asset in memory, `projectUtils` warns about "Missing Asset Files"; on import, the settings load but `*Shapes` remain null until they re-upload. Don't add code paths that assume shapes are always present alongside their settings.
- **Build timestamp** is injected via Vite `define` as `__BUILD_TIMESTAMP__`; it's referenced in `Controls.tsx` (`import.meta.env.DEV ? 'DEV' : __BUILD_TIMESTAMP__`). Declared in `src/vite-env.d.ts`.
- **Deployment**: `pnpm deploy:gh` publishes whatever is in `dist/`. Custom domain is set via `public/CNAME` (also: `homepage` in `package.json` for the gh-pages base URL). If you change the domain, update both.
- **Strict TS settings**: `noUnusedLocals` and `noUnusedParameters` are on. Prefix intentionally-unused params with `_` rather than disabling.

### ColorFlow mode (`src/colorflow/`)

A peer mode to the existing pattern/inlay workflow. Selected via the top-right segmented control in `App.tsx` (`mode: 'pattern' | 'colorflow'`).

- **Pipeline lives in a Web Worker** (`colorflow/worker.ts`). Main thread sends `quantize` / `trace` / `extrude` requests via the `useColorFlowWorker` hook; worker returns transferable typed-array geometries.
- **The 3D viewer is reused**. `ModelViewer` gets a `mode` prop and routes to `ColorFlowModel.tsx` (a small imperative builder) when in ColorFlow.
- **Output is a multi-part 3MF assembly** (`base` + N `color_*` sub-parts at stacked Z heights) packed via the existing JSZip dep — see `threeMfWriter.ts`. The pattern-mode 3MF export remains via `three-3mf-exporter`.
- **Outlines** come from `colorflow/outlineLibrary.ts` (a 16-entry manifest referencing the existing DXFs in `public/outlines/`). The same dropdown is also surfaced in pattern-mode `BaseControls`.
- **Vendored libs** in `colorflow/vendor/` (ImageTracer + earcut, public-domain). Don't add them as npm deps — the upstream versions are unmaintained.
- **Vitest** covers the pure pipeline utils only. No React testing. `pnpm test` / `pnpm test:run`.
- **An `<ErrorBoundary>` wraps the Canvas in both modes** — a crash in geometry construction no longer kills the studio.
- **Working canvas is outline-anchored**: dimensions are `outline.widthMm × CANVAS_PX_PER_MM` (default 5 px/mm, capped at `MAX_CANVAS_DIM`). The source image is rendered into that canvas at fit-then-user-scale-then-user-offset. See `imageTransform.ts` for the pure math and `ImageTransformPreview.tsx` for the drag/wheel UI.
- **Stack model**: every color extrudes from `baseMm` to `baseMm + (stackPos + 1) × colorLayerMm`. Stack position comes from `resolvedStackOrder(palette, coverage, settings)` in `stackOrder.ts`. `settings.layerOrder` is the manual override; null means sort by `settings.sort` (`luma` ascending or `coverage` descending).
- **Mesh + 3MF naming uses stack position**, not array index — meshes are `Color_<pos+1>_<hex>` and 3MF parts are `color_<pos+1>_<hex>`. The worker emits `layerGeoms` pre-sorted by position so downstream code doesn't re-sort.
