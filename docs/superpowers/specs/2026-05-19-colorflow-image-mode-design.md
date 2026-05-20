# ColorFlow — Image-to-Color-Layers Mode for GrippySheet Studio

**Status**: Approved design · 2026-05-19
**Authors**: Claude Code + RepairFlow team
**Implementation plan**: TBD (next step is `superpowers:writing-plans`)

---

## 1. Purpose & summary

Merge the STRATA workflow (raster image → color-quantized → multi-part 3MF assembly for Bambu AMS printing) into GrippySheet Studio as a new peer mode named **ColorFlow**, sitting alongside the existing pattern/inlay workflow.

The two modes are mutually exclusive per project session: when ColorFlow is active, the existing Base / Inlay / Geometry overlay system isn't relevant. The only shared piece between modes is the footpad outline (DXF or SVG loaded into `BaseSettings.cutoutShapes`).

The unique value vs. today's studio:

- **Image as input** — drag any raster image, k-means quantize into N colors, mode-filter for noise, vector-trace each color region.
- **Multi-part 3MF** — emits a single `footpad_assembly` with `base` + per-color sub-parts pre-stacked at the right Z heights, so Bambu Studio AMS users assign one filament per part and slice in one click. The current studio emits a single extruded model.

## 2. Out of scope (deferred)

- **Filament-ID encoding inside the 3MF** — STRATA defers this; we defer too. Users assign filaments by hand in Bambu Studio for v1. (Roadmap item, not v1.)
- **Grip pattern overlay on color regions** — stamping bumps over colored areas. Future work.
- **Stacked relief mode** — each color at a slightly different Z for tactile multi-tone. Future work.
- **Standing up a full test runner for UI components** — only pure utils get Vitest coverage in v1.
- **Image-mode bring-your-own-outline beyond DXF/SVG** — we reuse the existing outline library, which already covers user uploads.

## 3. Locked-in product decisions

| Decision | Choice |
|---|---|
| Integration shape | Peer mode, mutually exclusive overlay with existing modes |
| UI style | Adaptive disclosure (sections reveal as prerequisites land) |
| Live preview | Reuse the existing 3D viewer, harden it against crashes |
| Outline source | Reuse the existing DXF/SVG library (single source of truth) |
| Project persistence | Same project bundle, schema bumps v1 → v2 |
| Mode switch UX | Top-level segmented control (`Pattern · ColorFlow`) |
| Rebrand | "ColorFlow" — shown as e.g. "GrippySheet · ColorFlow" |
| 3MF writer | Port STRATA's writer (assembly + sub-parts), reuse existing JSZip dep |
| Image processing | Web Worker for k-means / mode filter / trace / extrude |
| Libs | Vendor STRATA's ImageTracer + earcut into `src/colorflow/vendor/` |

## 4. Architecture

```
src/
├── App.tsx                     ← top-level segmented control: Pattern | ColorFlow
├── components/
│   ├── Controls.tsx            ← unchanged (pattern mode panel)
│   ├── ModelViewer.tsx         ← grows a `mode` prop; routes meshRef to the right model
│   ├── ImperativeModel.tsx     ← unchanged (pattern mode)
│   └── ErrorBoundary.tsx       ← NEW; wraps the 3D <Canvas> in both modes
├── colorflow/
│   ├── ColorFlowControls.tsx   ← adaptive disclosure panel
│   ├── ColorFlowModel.tsx      ← imperative Three.js builder for ColorFlow assembly
│   ├── schema.ts               ← Zod for ColorFlowSettings + v1→v2 migration glue
│   ├── worker.ts               ← Web Worker entry
│   ├── useColorFlowWorker.ts   ← React hook owning worker lifecycle + message protocol
│   ├── pipeline/
│   │   ├── quantize.ts         ← k-means++ (deterministic via seeded PRNG)
│   │   ├── modeFilter.ts       ← categorical sliding-window mode filter
│   │   ├── trace.ts            ← ImageTracer wrapper
│   │   ├── polygonize.ts       ← traced layers → outer + holes polygon list
│   │   └── extrude.ts          ← polygons → BufferGeometry via earcut
│   ├── threeMfWriter.ts        ← assembly + sub-parts, packs via JSZip
│   ├── outlineToPolygon.ts     ← THREE.Shape → polygon points + mask helpers
│   └── vendor/
│       ├── imagetracer.ts      ← TS wrapper around public-domain ImageTracer
│       └── earcut.ts           ← TS wrapper around earcut
├── types/schemas.ts            ← ProjectSchemaV2 adds imageMode section
└── utils/projectUtils.ts       ← v1 import compat + v2 export with image assets
```

**Outline library manifest** (new, shared with pattern mode)

The existing pattern mode loads outlines via `ShapeUploader` (manual file pick). The DXFs in `public/outlines/` are reachable as static assets, but there's no preset picker today. This work adds a small static manifest both modes can use:

```ts
// src/colorflow/outlineLibrary.ts
export interface OutlineEntry {
  slug: string;           // 'xrstock', 'pint', 'floatwheel', ...
  name: string;           // 'XR Stock'
  group: 'xr' | 'gt' | 'pint' | 'other';
  file: string;           // '/outlines/xrstock.dxf' — resolved at fetch time
  widthMm: number;
  heightMm: number;
}

export const OUTLINE_LIBRARY: OutlineEntry[] = [
  /* 16 entries derived from public/outlines/ */
];
```

The manifest is hand-maintained for v1 (16 entries, low churn). A "Library ▾" dropdown lives in both `<BaseControls />` (pattern mode) and `<ColorFlowControls />` (ColorFlow mode) and resolves the chosen `slug` into a fetch of the DXF via the existing `shapeLoader.parseShapeFile`. "Upload your own" stays as today.

`ColorFlowSettings.outlineSlug` references this library by `slug`; `null` means "user uploaded their own DXF in BaseSettings.cutoutShapes".

**Mode state in `App.tsx`**

`App` grows one new piece of state: `mode: 'pattern' | 'colorflow'`. When `mode === 'colorflow'`:

- The right panel renders `<ColorFlowControls />` instead of `<Controls />`.
- The 3D viewer receives `<ModelViewer mode="colorflow" />` and routes `meshRef` to `<ColorFlowModel />` instead of `<ImperativeModel />`.
- The existing `Base / Inlay / Geometry` tabbar isn't visible.
- The existing `baseSettings / inlaySettings / geometrySettings` aren't destroyed — they stay in `App` so a mode toggle round-trip doesn't lose work.

**What's shared**

- `BaseSettings.cutoutShapes` (the loaded outline as `THREE.Shape[]`) is the single bridge between modes. Picking an outline in either mode mutates this same field.
- 3D viewer chrome (orbit, screenshot, FPS, opacity menu) is shared; only the mesh source differs.
- Project bundle (one zip per project) is shared.
- `AlertContext` is shared for user-blocking errors.

## 5. Components

### `<ColorFlowControls />` — adaptive disclosure panel

Sections always in the DOM. Each section is "live" or "dimmed" based on whether its prerequisites are satisfied. A status line above the layer cards reports worker progress ("clustering colors…", "tracing paths…", "ready · 5 layers traced").

```
┌──────────────────────────────────────┐
│ GrippySheet · ColorFlow              │
├──────────────────────────────────────┤
│ ① Outline                            │
│   [DXF Library ▾] [Upload your own]  │
│   ✓ XR Stock · 232.9 × 219.7 mm      │
├──────────────────────────────────────┤
│ ② Image                              │  ← reveals after outline selected
│   ⬇ drop image / click to browse     │
│   ✓ design.png · 1200 × 900          │
├──────────────────────────────────────┤
│ ③ Colors                             │  ← reveals after image loaded
│   colors        ━━━●━━━━ 5           │
│   simplify      ━●━━━━━━ light       │
│   trace detail  ━━●━━━━━ balanced    │
│   smoothing     ◉ on  ◯ off          │
│   sort by       luminance · coverage │
├──────────────────────────────────────┤
│ ④ Print                              │  ← reveals after colors quantized
│   total         [ 2.0 ] mm           │
│   base          [ 1.0 ] mm           │
├──────────────────────────────────────┤
│ ⑤ Export                             │
│   [⬇ 3MF for Bambu]                  │
│   [⬇ Combined SVG] [⬇ Layers ZIP]    │
│                                      │
│   Layers (with swatches, hex, %)…    │
└──────────────────────────────────────┘
```

Visual language matches the existing studio (gray-800/gray-950 surfaces, purple-cyan gradient brand bar). The dashed amber outline overlay STRATA shows on the source image is preserved — but rendered atop the 2D source thumbnail (a small expandable preview inside § Image), not the 3D viewer.

### `<ColorFlowModel />` — imperative 3D builder

Parallels `ImperativeModel.tsx` but ~300 lines because it's much simpler.

Inputs:
- Outline `THREE.Shape` (from `cutoutShapes[0]`).
- Layer `BufferGeometry[]` (extruded, received from the worker).
- `baseMm`, `totalMm` (numeric).

Builds a `THREE.Group` named `ColorFlowAssembly` containing:

- `mesh.name = 'Base'` — extruded outline, Z: `0 → baseMm`.
- `mesh.name = 'Color_${i}_${hex}'` — one per quantized region, Z: `baseMm → totalMm`. Material is `MeshStandardMaterial` (or `MeshToonMaterial` if the existing toon toggle is on) with the centroid RGB.

Names matter — the 3MF writer reads them. Same naming convention as the existing pattern-mode code (`Base`, `Pattern`, `Inlay_*`, `Debug_*`).

### `ModelViewer.tsx` change

A new `mode: 'pattern' | 'colorflow'` prop:

- Switches which child imperative component receives `meshRef`.
- Hides the debug "Cutter" toolbar buttons in ColorFlow mode (they don't apply).
- Camera/orbit/screenshot/FPS/opacity logic unchanged.

### `<ErrorBoundary />` — new class component

Wraps the entire `<Canvas>` block in `ModelViewer`. On unhandled render-tree errors:

- Renders fallback panel: *"3D preview crashed. Your settings are preserved. [Try again]"*.
- Logs the error to console (and to a future telemetry hook stub).
- Retry button bumps a `key` to remount the Canvas cleanly without losing settings state.

This boundary fixes the existing "geometry can crash the whole app" pain in pattern mode too — shipping it is part of this work.

### Worker boundary

`colorflow/worker.ts` is the only file that touches `vendor/imagetracer.ts` and `vendor/earcut.ts`. Main thread talks via a typed message protocol:

```ts
type Request =
  | { kind: 'quantize'; image: ImageBitmap; outlineMask: Uint8Array;
      width: number; height: number; opts: QuantizeOpts }
  | { kind: 'trace';    assignments: Uint16Array; palette: RGB[];
      width: number; height: number; opts: TraceOpts }
  | { kind: 'extrude';  layers: LayerPolygons[]; outlineMm: PolygonMm;
      baseMm: number; totalMm: number };

type Response =
  | { kind: 'progress'; phase: string; pct?: number }
  | { kind: 'quantized'; palette: RGB[]; assignments: Uint16Array }
  | { kind: 'traced';    layers: LayerPolygons[]; previewSvg: string;
      layerSvgs: Record<number, string> }
  | { kind: 'extruded';  baseGeom: TransferredGeom;
      layerGeoms: TransferredGeom[] }
  | { kind: 'error';     message: string; phase: string };
```

`BufferGeometry` data crosses the boundary as `Float32Array` + `Uint32Array` payloads in a `TransferredGeom`. The arrays are listed in the `transfer` argument to `postMessage` — zero-copy. Main thread reconstructs `BufferGeometry` from the buffers.

### `threeMfWriter.ts`

Runs on main thread (JSZip is lightweight, no need to worker-bundle it). Takes the constructed `THREE.Group` (or the raw extruded geometries plus name + Z-range list) and produces a 3MF blob:

```
[Content_Types].xml
_rels/.rels
3D/3dmodel.model      ← <model> with N <object> + one assembly <object> referencing them via <component>
```

Output `3dmodel.model` structure (one object per part, plus one parent assembly):

```xml
<model unit="millimeter" ...>
  <metadata name="Application">GrippySheet ColorFlow</metadata>
  <resources>
    <object id="1" type="model" name="base">
      <mesh>
        <vertices>...</vertices>
        <triangles>...</triangles>
      </mesh>
    </object>
    <object id="2" type="model" name="color_1_4a90e2"> ... </object>
    <object id="3" type="model" name="color_2_e84a3b"> ... </object>
    <object id="N" type="model" name="footpad_assembly">
      <components>
        <component objectid="1"/>
        <component objectid="2"/>
        <component objectid="3"/>
      </components>
    </object>
  </resources>
  <build>
    <item objectid="N"/>
  </build>
</model>
```

## 6. Data flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        MAIN THREAD                              │
│                                                                 │
│  ① User picks outline from dropdown (shared with Pattern mode)  │
│     → BaseSettings.cutoutShapes = THREE.Shape[]                 │
│                                                                 │
│  ② User drops image                                             │
│     → file → ImageBitmap (off-thread decode)                    │
│     → outlineToPolygon(cutoutShapes[0]) → polygon points        │
│     → rasterize polygon to Uint8Array mask matching image dims  │
│                                                                 │
│  ③ User adjusts color count / simplify / detail / smooth        │
│     → debounced (200ms)                                         │
│     → worker.postMessage({kind:'quantize', image, mask, opts})  │
│                              ↓                                  │
└──────────────────────────────│──────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                          WORKER                                 │
│   ④ k-means++ on 200px sample                  → palette        │
│   ⑤ assign all pixels (with outline mask)      → Uint16Array    │
│   ⑥ mode filter (categorical) per simplify lvl → Uint16Array'   │
│       postMessage({kind:'quantized', ...})                      │
│   ⑦ ImageTracer per color layer                                 │
│       → SVG path strings (for per-layer SVG download) +         │
│         polygon points (for extrusion / 3MF)                    │
│       postMessage({kind:'traced', layers, previewSvg})          │
│   ⑧ On 'extrude' request: earcut each polygon                   │
│       → BufferGeometry buffers, transferred zero-copy           │
│       postMessage({kind:'extruded', ...}, [transferables])      │
└──────────────────────────────│──────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                        MAIN THREAD                              │
│   ⑨ Hydrate buffers into BufferGeometry, build ColorFlowAssembly│
│   ⑩ 3D viewer re-renders                                        │
│   ⑪ "Export 3MF" → threeMfWriter walks the group,               │
│      emits model.xml + rels + content types, packs via JSZip,   │
│      triggers download.                                         │
└─────────────────────────────────────────────────────────────────┘
```

**State shape**

Persisted (Zod-validated):

```ts
// src/colorflow/schema.ts
export const ColorFlowSettingsSchema = z.object({
  outlineSlug: z.string().nullable().default(null),   // FK into outline library
  colorCount: z.number().int().min(2).max(10).default(5),
  simplify: z.number().int().min(0).max(4).default(1),
  detail: z.number().int().min(0).max(2).default(1),
  smooth: z.boolean().default(true),
  sort: z.enum(['luma', 'coverage']).default('luma'),
  totalMm: z.number().min(0.4).max(10).default(2.0),
  baseMm: z.number().min(0.2).max(5).default(1.0),
});
```

Image bytes are stored as `ProjectAssets.image` (parallel to `assets.baseOutline` / `assets.pattern`) — never inside Zod settings.

Runtime, non-serialized (owned by `<ColorFlowControls />`, or hoisted to `App` if needed):

```ts
interface ColorFlowRuntime {
  imageBitmap: ImageBitmap | null;
  outlineMask: Uint8Array | null;     // ImageData-sized binary mask
  palette: RGB[];                     // from worker
  assignments: Uint16Array | null;    // from worker
  layerGeoms: BufferGeometry[];       // from worker, extruded
  baseGeom: BufferGeometry | null;
  status: { phase: string; pct?: number } | null;
  layerSVGs: Record<number, string>;  // for per-layer SVG download
  combinedSvg: string | null;
}
```

**Schema migration**

```ts
ProjectSchemaV2 = z.object({
  version: z.literal(2),
  timestamp: z.number(),
  mode: z.enum(['pattern', 'colorflow']).default('pattern'),
  base: BaseSettingsSchema,
  inlay: InlaySettingsSchema,       // pattern-mode only, harmless otherwise
  geometry: GeometrySettingsSchema, // ditto
  imageMode: ColorFlowSettingsSchema.optional(),
});
```

`importProjectBundle` accepts v1 zips: synthesizes `mode = 'pattern'`, drops `imageMode`, otherwise passes through. **All existing v1 projects load without warnings.** v2 imports verify the image asset is present when `mode === 'colorflow'`.

**Outline ↔ image alignment**

Solved once in `outlineToPolygon.ts`, shared between three call sites:

1. Building the pixel-space mask for the worker.
2. Converting pixel-space traced polygons back to mm for 3MF.
3. Drawing the dashed amber outline overlay on the source thumbnail in § Image.

Algorithm matches STRATA's approach: fit outline inside image canvas preserving aspect, center it, build mask via `Path2D` + `ctx.fill()`, then for 3MF map pixel coords back via the same `(scale, offsetX, offsetY)`.

## 7. Error handling & defensive boundaries

Three layers of protection, plus existing AlertContext for user-facing prompts.

### Layer 1 — React `<ErrorBoundary />` around `<Canvas>`

Class component, both modes. On unhandled render error:

- Render fallback panel: *"3D preview crashed. Your settings are preserved. [Try again]"*
- `console.error(error, errorInfo)` (telemetry hook stub for later).
- Retry bumps a `key` to remount the Canvas cleanly.

**Worth shipping even for pattern mode** — addresses the user-flagged "geometry can crash the whole app" pain.

### Layer 2 — Worker isolation for image pipeline

If `quantize` / `trace` / `extrude` throws inside the worker:

- Worker catches → posts `{ kind: 'error', phase, message }`.
- Main thread shows it in the status line; the worker stays alive for the next request; the studio stays usable.
- If the worker truly dies (OOM / crash): `useColorFlowWorker` hook re-instantiates transparently on the next request.

### Layer 3 — Input guards before expensive work

| Where | Guard |
|---|---|
| Outline → polygon | If `shape.getPoints(64).length < 3` → status: *"outline too small or degenerate"*, abort. |
| Image load | If `naturalWidth * naturalHeight > 4000 * 4000` → AlertContext warning, cap to 1500px (STRATA's MAX). |
| K-means | If sample pixel count after mask is `< colorCount * 10` → fall back to fewer colors, surface warning in status line. |
| Earcut | Skip polygons where `triangulate(...)` returns empty (collinear / degenerate); log and continue. |
| 3MF write | Validate `totalMm > baseMm`, both `> 0` → reject with AlertContext modal. |

### AlertContext for user-blocking errors

Reuses the existing `useAlert()` system that the project import flow already uses. No new modal infrastructure.

### Schema-migration safety

`importProjectBundle`:

- v1 zip → `mode = 'pattern'`, no migration of fields. **All existing v1 projects work.**
- v2 zip with `mode = 'colorflow'` but no `imageMode` section → set `mode = 'pattern'`, warn via AlertContext.
- v2 zip with `mode = 'colorflow'` and no image asset → enter ColorFlow mode but show § Image as empty; user re-uploads.
- Future-unknown version → existing `versionMismatch: true` flow surfaces the "Continue Anyway?" prompt (no change).

### Image asset hydration on import

- `fileTypeSniffer.ts` confirms PNG / JPG / WebP.
- `createImageBitmap(blob)` produces the runtime `ImageBitmap`.
- On decode failure → fall back to empty § Image, AlertContext error, settings still apply.

## 8. Testing & validation

The studio has no test runner today (per `CLAUDE.md`). Standing one up just for this feature is overhead, but the pure data-transformation parts of the pipeline are exactly what unit tests are good for.

**Recommendation: add Vitest as a dev dependency, pure-utils only, no React/DOM testing.**

| Module | Test |
|---|---|
| `outlineToPolygon.ts` | Synthetic shapes (square, circle, shape-with-holes). Assert point count, bounds, winding order, mask cardinality. |
| `pipeline/quantize.ts` | Synthetic 4-color ImageData → palette within ε of expected centroids. Seeded PRNG for determinism. |
| `pipeline/modeFilter.ts` | Hand-computed 8×8 assignment grids → expected outputs. |
| `pipeline/polygonize.ts` | Canned ImageTracer fixtures → polygons preserving outer/hole structure. |
| `pipeline/extrude.ts` | Square outer + square hole → triangle count + winding asserts. |
| `threeMfWriter.ts` | Generate a tiny 3MF, unzip in-memory, assert `3D/3dmodel.model` shape (object count, `<component>` references, Z heights). |
| `schema.ts` migration | Round-trip a v1 fixture, assert v2 output with `mode='pattern'`. |

**Manual test plan**

1. Load each of the 16 stock outlines — outline preview renders.
2. Drop a representative design image (logo PNG, 4–5 colors).
3. Adjust color count 2 → 10; preview updates.
4. Adjust simplify off → max; smoother regions.
5. Adjust thickness; 3D preview reflects new Z extents.
6. Export 3MF, open in Bambu Studio, verify:
   - Lands as `footpad_assembly` parent.
   - Expands to `base` + N `color_*` sub-parts.
   - Z heights match (`base` at 0–baseMm, colors at baseMm–totalMm).
   - Assign one filament per part, slice, no errors.
7. Export combined SVG / per-layer SVG / per-layer PNG; visually inspect.
8. Export project bundle; reload; import the bundle; state restored.
9. Switch between Pattern and ColorFlow modes; each mode's settings survive round-trip.
10. Try with `cutoutShapes = null` — UI blocks image upload with clear status; 3MF button disabled.
11. Try a 4000×4000 image — downsamples with AlertContext warning.
12. Force an error inside the worker (monkey-patch ImageTracer) — verify ErrorBoundary catches gracefully or worker error surfaces in status line.

**Performance benchmark (tracked, not enforced)**

- 1500×1500 image, 5 colors, simplify=light → quantize+trace under 3s on a mid-tier laptop.
- 3MF export under 1s.

If either misses by >2× → add optimization tasks to the implementation plan.

## 9. Open questions / decisions deferred to implementation

- **Worker bundling** — Vite supports `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`. Confirm the React Compiler + Vite plugin combo doesn't interfere; if it does, fall back to a separate Rollup chunk.
- **Outline tessellation `divisions` constant** — STRATA's outlines are already pre-tessellated to ~30–60 points. DXF curves need `getPoints(divisions)` with `divisions ≈ 64` to look smooth in 3D and remain cheap for earcut. Final value picked at implementation time, exposed as a `vite.config.ts` constant if it ever needs tuning.
- **Per-color material instances** — every color region creates one material. Verify memory stays sane at N=10. If not, share a base material and use vertex colors.
- **Combined SVG download in ColorFlow** — STRATA's combined SVG was its primary preview. We have a 3D preview; the combined SVG stays as a download option only.

## 10. Files touched (summary, no line-count promises)

**New**:
- `src/components/ErrorBoundary.tsx`
- `src/colorflow/*` (whole new folder)
- `docs/superpowers/specs/2026-05-19-colorflow-image-mode-design.md` (this file)

**Modified**:
- `src/App.tsx` — `mode` state, segmented control, route to either control panel.
- `src/components/ModelViewer.tsx` — `mode` prop, ErrorBoundary wrap, conditional toolbar.
- `src/components/controls/BaseControls.tsx` — add the "Library ▾" dropdown driven by `OUTLINE_LIBRARY`.
- `src/types/schemas.ts` — `ProjectSchemaV2`, optional `imageMode` section.
- `src/utils/projectUtils.ts` — v1→v2 import compat, image asset bundling.
- `src/components/WelcomeModal.tsx` — copy refresh (mention ColorFlow option).
- `package.json` — add `vitest` (devDep) and a `test` script. No production deps added; ImageTracer + earcut are vendored.
- `CLAUDE.md` — note the new `colorflow/` module and the mode switch state.

## 11. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `three-3mf-exporter` and our custom 3MF writer produce incompatible files | low | Custom writer is only used in ColorFlow; pattern mode still uses the existing exporter. |
| Bambu Studio doesn't recognize the assembly structure exactly as STRATA built it | low | Port STRATA's exact XML structure verbatim, including `metadata` and `<components>` ordering. Validate against a real Bambu Studio import as part of the manual test plan. |
| Worker fails to bundle under Vite's React Compiler config | low | Fall back to a classic-script worker if module worker has issues; both are ~10-line changes. |
| Outline curves tessellate too coarsely → visible polygon edges in 3D | medium | `divisions=64` default; expose as a constant. |
| Schema v2 round-trip drops fields users care about | medium | Vitest test against fixed v1 + v2 fixtures. |
| Earcut chokes on near-degenerate polygons from ImageTracer | medium | Guard returns `[]`; we already skip empty triangulations. |
| User-facing: 4000×4000 photo causes 30s freeze | high (without worker) → low (with worker) | Worker isolates; status line keeps UI responsive. Downsample cap at 1500px. |
