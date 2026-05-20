# ColorFlow Image-Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new "ColorFlow" peer mode in GrippySheet Studio that takes a raster image, k-means quantizes it into color regions inside a chosen footpad outline, and exports a multi-part Bambu-compatible 3MF assembly (base + colored sub-parts at stacked Z heights). Mutually exclusive with the existing inlay/pattern overlay mode.

**Architecture:** New `src/colorflow/` module owns the image pipeline (k-means, mode filter, ImageTracer, earcut extrusion, 3MF assembly). A Web Worker isolates the heavy CPU work. A new top-level `mode` state in `App.tsx` toggles between the existing pattern UI and the new ColorFlow UI via a segmented control. The 3D viewer is reused with a `mode` prop. A new React `ErrorBoundary` wraps the Canvas to harden both modes against geometry crashes. Outlines come from a new manifest shared with the existing Base tab.

**Tech Stack:** React 19 + TypeScript + Vite + Three.js (via `@react-three/fiber`/`drei`) + Tailwind. New: vendored ImageTracer + earcut (public-domain JS), Vitest for pure-utils unit tests. Existing JSZip dep is reused for 3MF packaging.

**Spec reference:** `docs/superpowers/specs/2026-05-19-colorflow-image-mode-design.md`

**Repository quirk:** the git repository is rooted at `/home/ubuntu/grippy/grippysheet-studio/` — all commands below assume `cd /home/ubuntu/grippy/grippysheet-studio` (already the working directory for subagent execution).

**Subagent safety note:** Never run `git reset --hard`, `git clean -fd`, `rm -rf` on tracked files, or `git checkout -- .` to "make a commit work." If a commit fails, investigate the root cause (usually staged + unstaged mixed, or hook failure). Stage explicit files only.

---

## Task 0: Add Vitest and scaffolding directories

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/colorflow/.gitkeep`
- Create: `src/colorflow/pipeline/.gitkeep`
- Create: `src/colorflow/vendor/.gitkeep`
- Test: `src/colorflow/__tests__/sanity.test.ts`

- [ ] **Step 1: Install vitest as a dev dependency**

Run: `pnpm add -D vitest@^2.0.0`
Expected: `package.json` `devDependencies` gains `vitest`; lockfile updated.

- [ ] **Step 2: Add `test` scripts to `package.json`**

Modify `package.json` `scripts`:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "deploy:gh": "gh-pages -d dist",
  "test": "vitest",
  "test:run": "vitest run"
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    globals: false,
  },
});
```

- [ ] **Step 4: Scaffold the empty `colorflow/` directories with `.gitkeep`**

Create empty files at:
- `src/colorflow/.gitkeep`
- `src/colorflow/pipeline/.gitkeep`
- `src/colorflow/vendor/.gitkeep`
- `src/colorflow/__tests__/.gitkeep`

- [ ] **Step 5: Write a sanity test that proves the runner is wired**

Create `src/colorflow/__tests__/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the test to verify**

Run: `pnpm test:run`
Expected: 1 file, 1 test passing.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/colorflow/
git commit -m "Add vitest and scaffold colorflow/ module dirs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1: Outline library manifest

**Files:**
- Create: `src/colorflow/outlineLibrary.ts`
- Test: `src/colorflow/__tests__/outlineLibrary.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/colorflow/__tests__/outlineLibrary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OUTLINE_LIBRARY, getOutlineBySlug } from '../outlineLibrary';

describe('OUTLINE_LIBRARY', () => {
  it('exposes 16 entries', () => {
    expect(OUTLINE_LIBRARY.length).toBe(16);
  });

  it('each entry has a unique slug', () => {
    const slugs = OUTLINE_LIBRARY.map((o) => o.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('each entry points to a /outlines/<slug>.dxf path', () => {
    for (const o of OUTLINE_LIBRARY) {
      expect(o.file).toBe(`/outlines/${o.slug}.dxf`);
    }
  });

  it('each entry has positive mm dimensions', () => {
    for (const o of OUTLINE_LIBRARY) {
      expect(o.widthMm).toBeGreaterThan(0);
      expect(o.heightMm).toBeGreaterThan(0);
    }
  });

  it('getOutlineBySlug returns the matching entry or undefined', () => {
    expect(getOutlineBySlug('pint')?.name).toBe('Pint');
    expect(getOutlineBySlug('nonexistent')).toBeUndefined();
  });

  it('groups partition into xr / gt / pint / other', () => {
    const groups = new Set(OUTLINE_LIBRARY.map((o) => o.group));
    for (const g of groups) {
      expect(['xr', 'gt', 'pint', 'other']).toContain(g);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:run -- outlineLibrary`
Expected: FAIL — `OUTLINE_LIBRARY` not defined.

- [ ] **Step 3: Create `src/colorflow/outlineLibrary.ts`**

```ts
export type OutlineGroup = 'xr' | 'gt' | 'pint' | 'other';

export interface OutlineEntry {
  slug: string;
  name: string;
  group: OutlineGroup;
  file: string;
  widthMm: number;
  heightMm: number;
}

export const OUTLINE_LIBRARY: OutlineEntry[] = [
  { slug: 'xrstock',         name: 'XR Stock',         group: 'xr',    file: '/outlines/xrstock.dxf',         widthMm: 232.9, heightMm: 219.7 },
  { slug: 'xrcobraviper',    name: 'XR Cobra/Viper',   group: 'xr',    file: '/outlines/xrcobraviper.dxf',    widthMm: 229.3, heightMm: 211.5 },
  { slug: 'xrkushwide',      name: 'XR Kush Wide',     group: 'xr',    file: '/outlines/xrkushwide.dxf',      widthMm: 251.5, heightMm: 218.0 },
  { slug: 'xrmushiesv2',     name: 'XR Mushies V2',    group: 'xr',    file: '/outlines/xrmushiesv2.dxf',     widthMm: 230.8, heightMm: 216.5 },
  { slug: 'xrpubpad',        name: 'XR PubPad',        group: 'xr',    file: '/outlines/xrpubpad.dxf',        widthMm: 233.6, heightMm: 220.0 },
  { slug: 'xrstompies',      name: 'XR Stompies',      group: 'xr',    file: '/outlines/xrstompies.dxf',      widthMm: 231.9, heightMm: 201.0 },
  { slug: 'xrviperbitewide', name: 'XR Viperbite Wide',group: 'xr',    file: '/outlines/xrviperbitewide.dxf', widthMm: 254.7, heightMm: 236.7 },
  { slug: 'gtstock',         name: 'GT Stock',         group: 'gt',    file: '/outlines/gtstock.dxf',         widthMm: 229.3, heightMm: 203.4 },
  { slug: 'gtkushwide',      name: 'GT Kush Wide',     group: 'gt',    file: '/outlines/gtkushwide.dxf',      widthMm: 255.3, heightMm: 233.9 },
  { slug: 'gtmushies',       name: 'GT Mushies',       group: 'gt',    file: '/outlines/gtmushies.dxf',       widthMm: 246.5, heightMm: 226.1 },
  { slug: 'gtfst',           name: 'GT FST',           group: 'gt',    file: '/outlines/gtfst.dxf',           widthMm: 239.0, heightMm: 216.7 },
  { slug: 'gtlowboyflared',  name: 'GT Lowboy Flared', group: 'gt',    file: '/outlines/gtlowboyflared.dxf',  widthMm: 255.8, heightMm: 215.2 },
  { slug: 'pint',            name: 'Pint',             group: 'pint',  file: '/outlines/pint.dxf',            widthMm: 206.1, heightMm: 173.4 },
  { slug: 'pintmatix',       name: 'Pint Matix',       group: 'pint',  file: '/outlines/pintmatix.dxf',       widthMm: 241.4, heightMm: 194.9 },
  { slug: 'floatwheel',      name: 'Floatwheel',       group: 'other', file: '/outlines/floatwheel.dxf',      widthMm: 233.0, heightMm: 200.6 },
  { slug: 'gosmilox7',       name: 'Gosmilo X7',       group: 'other', file: '/outlines/gosmilox7.dxf',       widthMm: 231.7, heightMm: 222.5 },
];

export function getOutlineBySlug(slug: string): OutlineEntry | undefined {
  return OUTLINE_LIBRARY.find((o) => o.slug === slug);
}
```

Then verify the entries match the existing files:

Run: `ls public/outlines/ | sort`
Expected: 16 .dxf files matching the slugs above. If any are missing, the entry is wrong — fix the slug or the manifest, do **not** rename the files in `public/outlines/`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:run -- outlineLibrary`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/colorflow/outlineLibrary.ts src/colorflow/__tests__/outlineLibrary.test.ts
git commit -m "Add outline library manifest for ColorFlow + pattern modes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: ColorFlow Zod schema + project schema v2

**Files:**
- Create: `src/colorflow/schema.ts`
- Modify: `src/types/schemas.ts`
- Test: `src/colorflow/__tests__/schema.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/colorflow/__tests__/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ColorFlowSettingsSchema, defaultColorFlowSettings } from '../schema';
import { ProjectSchema, migrateV1ToV2 } from '../../types/schemas';

describe('ColorFlowSettingsSchema', () => {
  it('parses empty object into defaults', () => {
    const parsed = ColorFlowSettingsSchema.parse({});
    expect(parsed.colorCount).toBe(5);
    expect(parsed.simplify).toBe(1);
    expect(parsed.detail).toBe(1);
    expect(parsed.smooth).toBe(true);
    expect(parsed.sort).toBe('luma');
    expect(parsed.totalMm).toBe(2.0);
    expect(parsed.baseMm).toBe(1.0);
    expect(parsed.outlineSlug).toBeNull();
  });

  it('defaultColorFlowSettings matches the schema defaults', () => {
    expect(ColorFlowSettingsSchema.parse({})).toEqual(defaultColorFlowSettings);
  });

  it('rejects colorCount outside 2..10', () => {
    expect(() => ColorFlowSettingsSchema.parse({ colorCount: 1 })).toThrow();
    expect(() => ColorFlowSettingsSchema.parse({ colorCount: 11 })).toThrow();
  });

  it('rejects baseMm >= totalMm-equivalent constraint at parse time? no — both numeric, ranges only', () => {
    // baseMm < totalMm is enforced at use time, not at schema parse time
    const ok = ColorFlowSettingsSchema.parse({ baseMm: 5, totalMm: 1 });
    expect(ok.baseMm).toBe(5);
  });
});

describe('ProjectSchema v2', () => {
  it('parses a v2 pattern-mode bundle (no imageMode)', () => {
    const result = ProjectSchema.safeParse({
      version: 2,
      timestamp: 123,
      mode: 'pattern',
      base: {},
      inlay: {},
      geometry: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('pattern');
      expect(result.data.imageMode).toBeUndefined();
    }
  });

  it('parses a v2 colorflow-mode bundle with imageMode', () => {
    const result = ProjectSchema.safeParse({
      version: 2,
      timestamp: 123,
      mode: 'colorflow',
      base: {},
      inlay: {},
      geometry: {},
      imageMode: { colorCount: 4 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imageMode?.colorCount).toBe(4);
    }
  });
});

describe('migrateV1ToV2', () => {
  it('promotes a v1 bundle to v2 with mode=pattern and no imageMode', () => {
    const v1 = {
      version: 1,
      timestamp: 999,
      base: { size: 300 },
      inlay: { items: [] },
      geometry: {},
    };
    const v2 = migrateV1ToV2(v1);
    expect(v2.version).toBe(2);
    expect(v2.mode).toBe('pattern');
    expect(v2.timestamp).toBe(999);
    expect(v2.imageMode).toBeUndefined();
    expect(v2.base.size).toBe(300);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:run -- schema`
Expected: FAIL — imports unresolved.

- [ ] **Step 3: Create `src/colorflow/schema.ts`**

```ts
import { z } from 'zod';

export const ColorFlowSettingsSchema = z.object({
  outlineSlug: z.string().nullable().default(null),
  colorCount: z.number().int().min(2).max(10).default(5),
  simplify: z.number().int().min(0).max(4).default(1),
  detail: z.number().int().min(0).max(2).default(1),
  smooth: z.boolean().default(true),
  sort: z.enum(['luma', 'coverage']).default('luma'),
  totalMm: z.number().min(0.4).max(10).default(2.0),
  baseMm: z.number().min(0.2).max(5).default(1.0),
});

export type ColorFlowSettings = z.infer<typeof ColorFlowSettingsSchema>;

export const defaultColorFlowSettings: ColorFlowSettings = ColorFlowSettingsSchema.parse({});
```

- [ ] **Step 4: Modify `src/types/schemas.ts` to add v2 + migration**

At the top of the file (after existing imports), add:

```ts
import { ColorFlowSettingsSchema } from '../colorflow/schema';
```

After `ProjectSchemaV1`, add the v2 schema and migration helper:

```ts
export const ProjectSchemaV2 = z.object({
    version: z.literal(2),
    timestamp: z.number(),
    mode: z.enum(['pattern', 'colorflow']).default('pattern'),
    base: BaseSettingsSchema,
    inlay: InlaySettingsSchema,
    geometry: GeometrySettingsSchema,
    imageMode: ColorFlowSettingsSchema.optional(),
});

export type ProjectDataV2 = z.infer<typeof ProjectSchemaV2>;

export function migrateV1ToV2(v1: unknown): ProjectDataV2 {
    const parsed = ProjectSchemaV1.parse(v1);
    return {
        version: 2,
        timestamp: parsed.timestamp,
        mode: 'pattern',
        base: parsed.base,
        inlay: parsed.inlay,
        geometry: parsed.geometry,
    };
}
```

Change the existing `ProjectSchema` and `ProjectData` exports to point to v2 by default:

```ts
export const ProjectSchema = ProjectSchemaV2;
export type ProjectData = z.infer<typeof ProjectSchema>;
```

(Remove the old `export const ProjectSchema = ProjectSchemaV1;` and `export type ProjectData = z.infer<typeof ProjectSchema>;` lines — they're replaced.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:run -- schema`
Expected: 7 tests pass.

- [ ] **Step 6: Run a typecheck via build to surface any compile errors**

Run: `pnpm build`
Expected: success. If `projectUtils.ts` or callers complain about `ProjectData` shape, see Task 14 — for now, we accept that downstream code may briefly compile because `ProjectSchemaV2` has a default `mode` and same nested shapes. If anything fails, narrow the change: at this task we want ProjectData to be the v2 shape but downstream code can still treat it as v1-shaped (mode field is just ignored for now).

- [ ] **Step 7: Commit**

```bash
git add src/colorflow/schema.ts src/colorflow/__tests__/schema.test.ts src/types/schemas.ts
git commit -m "Add ColorFlow Zod schema and ProjectSchema v2 migration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: React ErrorBoundary wrapping the 3D Canvas

**Files:**
- Create: `src/components/ErrorBoundary.tsx`
- Modify: `src/components/ModelViewer.tsx`

(No unit tests — React class component, smoke-tested manually.)

- [ ] **Step 1: Create `src/components/ErrorBoundary.tsx`**

```tsx
import React from 'react';

interface Props {
  children: React.ReactNode;
  fallbackMessage?: string;
}

interface State {
  error: Error | null;
  attempt: number;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] caught:', error, errorInfo);
  }

  retry = () => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gray-900 text-gray-100 p-8">
          <div className="max-w-md text-center space-y-4">
            <div className="text-red-400 text-lg font-bold">3D preview crashed</div>
            <div className="text-gray-400 text-sm">
              {this.props.fallbackMessage ?? 'Your settings are preserved. You can try again or adjust controls.'}
            </div>
            <div className="text-gray-500 text-xs font-mono break-all">
              {this.state.error.message}
            </div>
            <button
              onClick={this.retry}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    // The `key` forces a remount of the subtree on retry, clearing any sticky state.
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}
```

- [ ] **Step 2: Wrap `<Canvas>` in `ModelViewer.tsx`**

Open `src/components/ModelViewer.tsx`. Find the `<Canvas shadows>` opening tag and the matching `</Canvas>` closing tag (around lines 416 and 575 in the current file).

Add `import { ErrorBoundary } from './ErrorBoundary';` near the top with the other imports.

Wrap the `<Canvas>` block with `<ErrorBoundary>`:

```tsx
<ErrorBoundary>
  <Canvas shadows>
    {/* ...existing canvas children unchanged... */}
  </Canvas>
</ErrorBoundary>
```

The `<ScreenshotModal>` (which is rendered outside the canvas) should stay outside the boundary.

- [ ] **Step 3: Smoke-test by starting the dev server**

Run: `pnpm dev`
Expected: dev server starts, app loads, 3D viewer renders as before. Stop the server (Ctrl-C).

(No automated test; manual confirmation that nothing regressed.)

- [ ] **Step 4: Commit**

```bash
git add src/components/ErrorBoundary.tsx src/components/ModelViewer.tsx
git commit -m "Add ErrorBoundary around 3D Canvas to harden against geometry crashes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Vendor ImageTracer and earcut

**Files:**
- Create: `src/colorflow/vendor/imagetracer.js`
- Create: `src/colorflow/vendor/imagetracer.d.ts`
- Create: `src/colorflow/vendor/earcut.js`
- Create: `src/colorflow/vendor/earcut.d.ts`
- Create: `src/colorflow/vendor/README.md`
- Test: `src/colorflow/__tests__/vendor.test.ts`

- [ ] **Step 1: Fetch the ImageTracer source from upstream**

ImageTracer 1.2.6 is public domain. Download it directly to the vendor folder:

```bash
mkdir -p src/colorflow/vendor
curl -fsSL https://raw.githubusercontent.com/jankovicsandras/imagetracerjs/v1.2.6/imagetracer_v1.2.6.js -o src/colorflow/vendor/imagetracer.js
```

Then convert it to an ES module — the upstream file ends with a UMD detection block (`if(typeof define === 'function' && define.amd){...}else if(typeof module !== 'undefined'){...}else...`). **Delete that entire trailing block** and replace with a single line:

```js
export default new ImageTracer();
```

Verify the file:

```bash
wc -l src/colorflow/vendor/imagetracer.js
```

Expected: ~1000 lines. The file should start with the comment block, contain `function ImageTracer(){` near the top, and end with the `export default` line you added.

- [ ] **Step 2: Write the TS declaration shim**

Create `src/colorflow/vendor/imagetracer.d.ts`:

```ts
export interface TracerOptions {
  ltres?: number;
  qtres?: number;
  pathomit?: number;
  rightangleenhance?: boolean;
  colorquantcycles?: number;
  colorsampling?: 0 | 1 | 2;
  mincolorratio?: number;
  blurradius?: number;
  blurdelta?: number;
  strokewidth?: number;
  linefilter?: boolean;
  scale?: number;
  roundcoords?: number;
  viewbox?: boolean;
  desc?: boolean;
  numberofcolors?: number;
  pal?: Array<{ r: number; g: number; b: number; a: number }>;
  layering?: 0 | 1;
}

export interface TracedSegmentL {
  type: 'L';
  x1: number; y1: number;
  x2: number; y2: number;
}
export interface TracedSegmentQ {
  type: 'Q';
  x1: number; y1: number;
  x2: number; y2: number;
  x3: number; y3: number;
}
export type TracedSegment = TracedSegmentL | TracedSegmentQ;

export interface TracedSubPath {
  segments: TracedSegment[];
  boundingbox: [number, number, number, number];
  holechildren: number[];
  isholepath: boolean;
}

export type TracedLayer = TracedSubPath[];

export interface Tracedata {
  layers: TracedLayer[];
  palette: Array<{ r: number; g: number; b: number; a: number }>;
  width: number;
  height: number;
}

declare const imagetracer: {
  imagedataToSVG(imgd: ImageData, options?: TracerOptions): string;
  imagedataToTracedata(imgd: ImageData, options?: TracerOptions): Tracedata;
  checkoptions(options?: TracerOptions | string): TracerOptions;
};
export default imagetracer;
```

- [ ] **Step 3: Fetch the earcut source from upstream**

earcut is ISC-licensed. Fetch the canonical ES-module build directly — modern earcut already exports the function as default:

```bash
curl -fsSL https://raw.githubusercontent.com/mapbox/earcut/v3.0.1/src/earcut.js -o src/colorflow/vendor/earcut.js
```

Verify it begins with `export default function earcut(` and not a UMD wrapper:

```bash
head -5 src/colorflow/vendor/earcut.js
```

Expected first non-comment line: `export default function earcut(data, holeIndices, dim = 2) {`.

If the curl returned a UMD-style file instead (older earcut), fall back to manual conversion: wrap the IIFE body so it mutates a local `e` object, then `export default e.default; export const area = e.area; export const deviation = e.deviation; export const flatten = e.flatten;`.

- [ ] **Step 4: Write the earcut TS declaration**

Create `src/colorflow/vendor/earcut.d.ts`:

```ts
export default function earcut(
  data: ArrayLike<number>,
  holeIndices?: number[] | null,
  dim?: number,
): number[];

export function area(data: ArrayLike<number>, holeIndices?: number[] | null, dim?: number): number;
export function deviation(
  data: ArrayLike<number>,
  holeIndices: number[] | null,
  dim: number,
  triangles: ArrayLike<number>,
): number;
export function flatten(coords: number[][][]): {
  vertices: number[];
  holes: number[];
  dimensions: number;
};
```

- [ ] **Step 5: Document the vendoring in a README**

Create `src/colorflow/vendor/README.md`:

```md
# Vendored libraries

## imagetracer.js
- Source: https://github.com/jankovicsandras/imagetracerjs (v1.2.6, public domain / Unlicense)
- Modified: ES-module export, stripped UMD wrapper, no logic changes.

## earcut.js
- Source: https://github.com/mapbox/earcut (ISC license)
- Modified: ES-module export, stripped UMD wrapper, no logic changes.
```

- [ ] **Step 6: Write a vendor smoke test**

Create `src/colorflow/__tests__/vendor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import earcut from '../vendor/earcut';
import imagetracer from '../vendor/imagetracer';

describe('vendor/earcut', () => {
  it('triangulates a unit square into two triangles', () => {
    const tris = earcut([0, 0, 1, 0, 1, 1, 0, 1]);
    expect(tris.length).toBe(6); // 2 triangles × 3 indices
  });

  it('handles a square with a square hole', () => {
    const tris = earcut(
      [0, 0, 10, 0, 10, 10, 0, 10, 3, 3, 7, 3, 7, 7, 3, 7],
      [4],
      2,
    );
    expect(tris.length).toBeGreaterThanOrEqual(24); // outer ring + hole ⇒ 8 triangles
  });
});

describe('vendor/imagetracer', () => {
  it('exposes the imagedataToTracedata API', () => {
    expect(typeof imagetracer.imagedataToTracedata).toBe('function');
    expect(typeof imagetracer.imagedataToSVG).toBe('function');
  });

  it('traces a 2x2 single-color ImageData without throwing', () => {
    // node has no DOM ImageData; use a plain object that matches the shape
    const fake = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        0, 0, 0, 255,  0, 0, 0, 255,
        0, 0, 0, 255,  0, 0, 0, 255,
      ]),
    } as unknown as ImageData;
    const td = imagetracer.imagedataToTracedata(fake, { numberofcolors: 1, colorsampling: 0 });
    expect(td.palette.length).toBeGreaterThan(0);
    expect(Array.isArray(td.layers)).toBe(true);
  });
});
```

- [ ] **Step 7: Run the tests**

Run: `pnpm test:run -- vendor`
Expected: 4 tests pass. If earcut tests pass but imagetracer fails with a `document is not defined` error, the IIFE is referencing the DOM at module top level — strip those branches (the AMD/browser fallback at the bottom).

- [ ] **Step 8: Commit**

```bash
git add src/colorflow/vendor/ src/colorflow/__tests__/vendor.test.ts
git commit -m "Vendor ImageTracer + earcut as ES modules with TS shims

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: outlineToPolygon — THREE.Shape → polygon points + mask helpers

**Files:**
- Create: `src/colorflow/outlineToPolygon.ts`
- Test: `src/colorflow/__tests__/outlineToPolygon.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/colorflow/__tests__/outlineToPolygon.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  shapeToPolygon,
  fitOutlineInImage,
  pixelToMm,
} from '../outlineToPolygon';

function unitSquare(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-1, -1);
  s.lineTo(1, -1);
  s.lineTo(1, 1);
  s.lineTo(-1, 1);
  s.lineTo(-1, -1);
  return s;
}

describe('shapeToPolygon', () => {
  it('extracts at least 4 points from a unit square', () => {
    const poly = shapeToPolygon(unitSquare(), 32);
    expect(poly.outer.length).toBeGreaterThanOrEqual(4);
  });

  it('returns the shape bounds', () => {
    const poly = shapeToPolygon(unitSquare(), 32);
    expect(poly.minX).toBeCloseTo(-1, 5);
    expect(poly.maxX).toBeCloseTo(1, 5);
    expect(poly.minY).toBeCloseTo(-1, 5);
    expect(poly.maxY).toBeCloseTo(1, 5);
  });

  it('strips the duplicate closing point', () => {
    const poly = shapeToPolygon(unitSquare(), 32);
    const first = poly.outer[0];
    const last = poly.outer[poly.outer.length - 1];
    expect(first[0] !== last[0] || first[1] !== last[1]).toBe(true);
  });
});

describe('fitOutlineInImage', () => {
  it('centers a 1×1 shape inside a 2×2 image', () => {
    const placement = fitOutlineInImage({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 2, 2);
    expect(placement.scale).toBeCloseTo(2);
    expect(placement.offsetX).toBeCloseTo(0);
    expect(placement.offsetY).toBeCloseTo(0);
  });

  it('preserves aspect ratio (letterboxes)', () => {
    const placement = fitOutlineInImage({ minX: 0, minY: 0, maxX: 2, maxY: 1 }, 4, 4);
    expect(placement.scale).toBeCloseTo(2); // limited by width
    expect(placement.offsetY).toBeCloseTo(1); // vertical letterbox
  });
});

describe('pixelToMm', () => {
  it('inverts fitOutlineInImage', () => {
    const placement = { scale: 10, offsetX: 5, offsetY: 7 };
    const [mx, my] = pixelToMm(15, 17, placement);
    expect(mx).toBeCloseTo(1);
    expect(my).toBeCloseTo(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:run -- outlineToPolygon`
Expected: FAIL — module not defined.

- [ ] **Step 3: Implement `src/colorflow/outlineToPolygon.ts`**

```ts
import * as THREE from 'three';

export interface Bounds {
  minX: number; minY: number;
  maxX: number; maxY: number;
}

export interface OutlinePolygon extends Bounds {
  /** Counterclockwise polygon points in shape-local mm coordinates. */
  outer: Array<[number, number]>;
  /** Optional hole rings. */
  holes: Array<Array<[number, number]>>;
}

/**
 * Convert a THREE.Shape (curves allowed) into a polygon ring + holes.
 * `divisions` controls curve tessellation; default 64 matches DXF/SVG outlines well.
 */
export function shapeToPolygon(shape: THREE.Shape, divisions = 64): OutlinePolygon {
  const outerRaw = shape.getPoints(divisions);

  const dedupe = (pts: THREE.Vector2[]): Array<[number, number]> => {
    const out: Array<[number, number]> = pts.map((p) => [p.x, p.y]);
    if (out.length >= 2) {
      const a = out[0], b = out[out.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop();
    }
    return out;
  };

  const outer = dedupe(outerRaw);
  const holes = (shape.holes ?? []).map((h) => dedupe(h.getPoints(divisions)));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of outer) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return { outer, holes, minX, minY, maxX, maxY };
}

export interface Placement {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Fit a bounded shape into a rectangular image canvas, preserving aspect ratio.
 * Returned placement maps shape-mm coords into pixel coords:
 *   pixelX = (mmX - bounds.minX) * scale + offsetX
 */
export function fitOutlineInImage(bounds: Bounds, imgW: number, imgH: number): Placement {
  const oW = bounds.maxX - bounds.minX;
  const oH = bounds.maxY - bounds.minY;
  if (oW <= 0 || oH <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };

  const scale = Math.min(imgW / oW, imgH / oH);
  const renderW = oW * scale;
  const renderH = oH * scale;
  return {
    scale,
    offsetX: (imgW - renderW) / 2,
    offsetY: (imgH - renderH) / 2,
  };
}

/** Inverse of fitOutlineInImage: convert pixel coords back to shape-mm. */
export function pixelToMm(px: number, py: number, placement: Placement): [number, number] {
  return [(px - placement.offsetX) / placement.scale, (py - placement.offsetY) / placement.scale];
}

/**
 * Rasterize an outline polygon into a 1/0 mask the size of `(imgW, imgH)`.
 * 1 = inside outline. Browser-only — uses a 2D canvas + Path2D.
 */
export function buildOutlineMask(
  polygon: OutlinePolygon,
  placement: Placement,
  imgW: number,
  imgH: number,
): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = imgW;
  canvas.height = imgH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, imgW, imgH);

  ctx.save();
  ctx.translate(placement.offsetX - polygon.minX * placement.scale,
                placement.offsetY - polygon.minY * placement.scale);
  ctx.scale(placement.scale, placement.scale);

  const path = new Path2D();
  const [ox, oy] = polygon.outer[0];
  path.moveTo(ox, oy);
  for (let i = 1; i < polygon.outer.length; i++) {
    path.lineTo(polygon.outer[i][0], polygon.outer[i][1]);
  }
  path.closePath();
  for (const hole of polygon.holes) {
    const [hx, hy] = hole[0];
    path.moveTo(hx, hy);
    for (let i = 1; i < hole.length; i++) path.lineTo(hole[i][0], hole[i][1]);
    path.closePath();
  }
  ctx.fillStyle = '#ffffff';
  ctx.fill(path, 'evenodd');
  ctx.restore();

  const img = ctx.getImageData(0, 0, imgW, imgH).data;
  const mask = new Uint8Array(imgW * imgH);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = img[i * 4] > 128 ? 1 : 0;
  }
  return mask;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:run -- outlineToPolygon`
Expected: 6 tests pass. `buildOutlineMask` isn't unit-tested because it depends on the DOM — exercised via the integration smoke test later.

- [ ] **Step 5: Commit**

```bash
git add src/colorflow/outlineToPolygon.ts src/colorflow/__tests__/outlineToPolygon.test.ts
git commit -m "Add outlineToPolygon: THREE.Shape -> polygon points + mask helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: K-means quantization (pure, seedable)

**Files:**
- Create: `src/colorflow/pipeline/quantize.ts`
- Create: `src/colorflow/pipeline/random.ts`
- Test: `src/colorflow/__tests__/quantize.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/colorflow/__tests__/quantize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { kmeans } from '../pipeline/quantize';
import { mulberry32 } from '../pipeline/random';

function buildImageData(rgbs: Array<[number, number, number]>): ImageData {
  // 1×N image, one pixel per color
  return {
    width: rgbs.length,
    height: 1,
    data: new Uint8ClampedArray(rgbs.flatMap(([r, g, b]) => [r, g, b, 255])),
  } as unknown as ImageData;
}

describe('kmeans', () => {
  it('recovers 2 clusters from a synthetic image', () => {
    // 4 red + 4 blue pixels
    const img = buildImageData([
      [255, 0, 0], [240, 10, 10], [230, 0, 5], [250, 5, 0],
      [0, 0, 255], [10, 10, 240], [5, 0, 230], [0, 5, 250],
    ]);
    const rand = mulberry32(42);
    const centroids = kmeans(img, 2, rand);
    expect(centroids.length).toBe(2);
    // Each centroid should be close to red or blue
    const reds = centroids.filter((c) => c.r > 200 && c.b < 50);
    const blues = centroids.filter((c) => c.b > 200 && c.r < 50);
    expect(reds.length).toBe(1);
    expect(blues.length).toBe(1);
  });

  it('returns gray fallback if pixel count is zero', () => {
    const img = buildImageData([]);
    const centroids = kmeans(img, 3, mulberry32(1));
    expect(centroids.length).toBe(3);
    for (const c of centroids) {
      expect(c.r).toBe(128);
    }
  });

  it('produces deterministic output for a fixed seed', () => {
    const img = buildImageData([
      [255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128],
    ]);
    const a = kmeans(img, 2, mulberry32(7));
    const b = kmeans(img, 2, mulberry32(7));
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:run -- quantize`
Expected: FAIL — modules not defined.

- [ ] **Step 3: Implement `src/colorflow/pipeline/random.ts`**

```ts
/**
 * Mulberry32 PRNG — small, fast, seeded. Returns a function that yields [0, 1).
 * https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Implement `src/colorflow/pipeline/quantize.ts`**

```ts
export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface Centroid extends RGB {
  /** Index into the palette array; the same index used in the assignments map. */
  index: number;
}

/**
 * K-means++ color quantization. `random()` should return [0, 1).
 * Adapted from STRATA / public-domain implementations.
 */
export function kmeans(imageData: ImageData, k: number, random: () => number): Centroid[] {
  const data = imageData.data;
  const total = imageData.width * imageData.height;
  const pixels = new Float32Array(total * 3);
  let count = 0;
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] < 200) continue;
    pixels[count * 3] = data[i * 4];
    pixels[count * 3 + 1] = data[i * 4 + 1];
    pixels[count * 3 + 2] = data[i * 4 + 2];
    count++;
  }

  if (count === 0) {
    return Array.from({ length: k }, (_, i) => ({ r: 128, g: 128, b: 128, index: i }));
  }

  const cents = new Float32Array(k * 3);
  const firstIdx = Math.floor(random() * count);
  cents[0] = pixels[firstIdx * 3];
  cents[1] = pixels[firstIdx * 3 + 1];
  cents[2] = pixels[firstIdx * 3 + 2];

  const distSq = new Float32Array(count);
  for (let c = 1; c < k; c++) {
    let totalDist = 0;
    for (let i = 0; i < count; i++) {
      let best = Infinity;
      for (let j = 0; j < c; j++) {
        const dr = pixels[i * 3] - cents[j * 3];
        const dg = pixels[i * 3 + 1] - cents[j * 3 + 1];
        const db = pixels[i * 3 + 2] - cents[j * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < best) best = d;
      }
      distSq[i] = best;
      totalDist += best;
    }
    if (totalDist === 0) {
      cents[c * 3] = cents[(c - 1) * 3];
      cents[c * 3 + 1] = cents[(c - 1) * 3 + 1];
      cents[c * 3 + 2] = cents[(c - 1) * 3 + 2];
      continue;
    }
    let r = random() * totalDist;
    for (let i = 0; i < count; i++) {
      r -= distSq[i];
      if (r <= 0) {
        cents[c * 3] = pixels[i * 3];
        cents[c * 3 + 1] = pixels[i * 3 + 1];
        cents[c * 3 + 2] = pixels[i * 3 + 2];
        break;
      }
    }
  }

  const assign = new Uint8Array(count);
  const sums = new Float32Array(k * 3);
  const counts = new Uint32Array(k);
  const MAX_ITER = 20;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let changed = 0;
    for (let i = 0; i < count; i++) {
      let best = Infinity, bestIdx = 0;
      for (let j = 0; j < k; j++) {
        const dr = pixels[i * 3] - cents[j * 3];
        const dg = pixels[i * 3 + 1] - cents[j * 3 + 1];
        const db = pixels[i * 3 + 2] - cents[j * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < best) { best = d; bestIdx = j; }
      }
      if (assign[i] !== bestIdx) { assign[i] = bestIdx; changed++; }
    }
    if (iter > 0 && changed === 0) break;
    sums.fill(0); counts.fill(0);
    for (let i = 0; i < count; i++) {
      const a = assign[i];
      sums[a * 3] += pixels[i * 3];
      sums[a * 3 + 1] += pixels[i * 3 + 1];
      sums[a * 3 + 2] += pixels[i * 3 + 2];
      counts[a]++;
    }
    for (let j = 0; j < k; j++) {
      if (counts[j] > 0) {
        cents[j * 3] = sums[j * 3] / counts[j];
        cents[j * 3 + 1] = sums[j * 3 + 1] / counts[j];
        cents[j * 3 + 2] = sums[j * 3 + 2] / counts[j];
      }
    }
  }

  const result: Centroid[] = [];
  for (let j = 0; j < k; j++) {
    result.push({
      r: Math.round(cents[j * 3]),
      g: Math.round(cents[j * 3 + 1]),
      b: Math.round(cents[j * 3 + 2]),
      index: j,
    });
  }
  return result;
}

/**
 * Assigns each pixel to the nearest centroid; returns a Uint16Array
 * where 0xFFFF means "skip" (mask says outside outline, or alpha low).
 */
export function assignAll(
  imageData: ImageData,
  centroids: Centroid[],
  mask: Uint8Array | null,
): Uint16Array {
  const data = imageData.data;
  const n = imageData.width * imageData.height;
  const out = new Uint16Array(n);
  const k = centroids.length;
  const cr = new Float32Array(k), cg = new Float32Array(k), cb = new Float32Array(k);
  for (let j = 0; j < k; j++) { cr[j] = centroids[j].r; cg[j] = centroids[j].g; cb[j] = centroids[j].b; }
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) { out[i] = 0xFFFF; continue; }
    if (data[i * 4 + 3] < 200) { out[i] = 0xFFFF; continue; }
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    let best = Infinity, bestIdx = 0;
    for (let j = 0; j < k; j++) {
      const dr = r - cr[j], dg = g - cg[j], db = b - cb[j];
      const d = dr * dr + dg * dg + db * db;
      if (d < best) { best = d; bestIdx = j; }
    }
    out[i] = bestIdx;
  }
  return out;
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test:run -- quantize`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/colorflow/pipeline/random.ts src/colorflow/pipeline/quantize.ts src/colorflow/__tests__/quantize.test.ts
git commit -m "Add k-means++ quantization with seeded PRNG

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Mode filter (categorical smoothing)

**Files:**
- Create: `src/colorflow/pipeline/modeFilter.ts`
- Test: `src/colorflow/__tests__/modeFilter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/colorflow/__tests__/modeFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { modeFilter, SIMPLIFY_KERNELS } from '../pipeline/modeFilter';

describe('modeFilter', () => {
  it('returns the input unchanged when kernel is 0', () => {
    const a = new Uint16Array([0, 1, 1, 0, 0xFFFF]);
    const out = modeFilter(a, 5, 1, 0, 2);
    expect(Array.from(out)).toEqual(Array.from(a));
  });

  it('replaces a single-pixel outlier with surrounding majority (3×3)', () => {
    // 3x3 grid, center pixel (1,1) is 1, all neighbors are 0
    const a = new Uint16Array([
      0, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ]);
    const out = modeFilter(a, 3, 3, 3, 2);
    expect(out[4]).toBe(0); // center should now be 0 (majority)
  });

  it('preserves transparent (0xFFFF) when it is the majority', () => {
    const T = 0xFFFF;
    const a = new Uint16Array([
      T, T, T,
      T, 0, T,
      T, T, T,
    ]);
    const out = modeFilter(a, 3, 3, 3, 2);
    expect(out[4]).toBe(T);
  });

  it('SIMPLIFY_KERNELS maps simplify level 0..4 to kernel sizes 0,3,5,9,15', () => {
    expect(SIMPLIFY_KERNELS).toEqual([0, 3, 5, 9, 15]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:run -- modeFilter`
Expected: FAIL.

- [ ] **Step 3: Implement `src/colorflow/pipeline/modeFilter.ts`**

```ts
/** Kernel sizes for simplify levels 0..4. Matches STRATA's labels (off / light / medium / strong / max). */
export const SIMPLIFY_KERNELS: readonly number[] = [0, 3, 5, 9, 15];

/**
 * Sliding-window categorical mode filter. For each pixel, output the
 * most common category in a kernelSize x kernelSize window. Treats 0xFFFF
 * (transparent) as its own category so it can be smoothed too.
 *
 * Returns a new Uint16Array (input is unchanged).
 */
export function modeFilter(
  assignments: Uint16Array,
  w: number,
  h: number,
  kernelSize: number,
  numCategories: number,
): Uint16Array {
  if (kernelSize === 0) return assignments;
  const radius = (kernelSize - 1) >> 1;
  const out = new Uint16Array(assignments.length);
  const TRANS = numCategories;
  const numBuckets = numCategories + 1;

  for (let y = 0; y < h; y++) {
    const hist = new Uint32Array(numBuckets);
    for (let dy = -radius; dy <= radius; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = dx;
        if (nx < 0 || nx >= w) continue;
        let v = assignments[ny * w + nx];
        if (v === 0xFFFF) v = TRANS;
        hist[v]++;
      }
    }

    let bestCount = 0, mode = 0;
    for (let b = 0; b < numBuckets; b++) {
      if (hist[b] > bestCount) { bestCount = hist[b]; mode = b; }
    }
    out[y * w] = (mode === TRANS) ? 0xFFFF : mode;

    for (let x = 1; x < w; x++) {
      const xRem = x - 1 - radius;
      const xAdd = x + radius;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        if (xRem >= 0) {
          let v = assignments[ny * w + xRem];
          if (v === 0xFFFF) v = TRANS;
          hist[v]--;
        }
        if (xAdd < w) {
          let v = assignments[ny * w + xAdd];
          if (v === 0xFFFF) v = TRANS;
          hist[v]++;
        }
      }
      bestCount = 0; mode = 0;
      for (let b = 0; b < numBuckets; b++) {
        if (hist[b] > bestCount) { bestCount = hist[b]; mode = b; }
      }
      out[y * w + x] = (mode === TRANS) ? 0xFFFF : mode;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test:run -- modeFilter`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/colorflow/pipeline/modeFilter.ts src/colorflow/__tests__/modeFilter.test.ts
git commit -m "Add categorical mode filter for assignment simplification

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Trace + polygonize (ImageTracer → polygons with holes)

**Files:**
- Create: `src/colorflow/pipeline/trace.ts`
- Create: `src/colorflow/pipeline/polygonize.ts`
- Test: `src/colorflow/__tests__/polygonize.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/colorflow/__tests__/polygonize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { layerToPolygons } from '../pipeline/polygonize';
import type { TracedLayer } from '../vendor/imagetracer';

describe('layerToPolygons', () => {
  it('returns empty for an empty layer', () => {
    expect(layerToPolygons([])).toEqual([]);
  });

  it('skips hole paths at top level (they attach to parents)', () => {
    const layer: TracedLayer = [
      { isholepath: true, segments: [
        { type: 'L', x1: 0, y1: 0, x2: 1, y2: 0 },
        { type: 'L', x1: 1, y1: 0, x2: 1, y2: 1 },
        { type: 'L', x1: 1, y1: 1, x2: 0, y2: 1 },
      ], boundingbox: [0, 0, 1, 1], holechildren: [] },
    ];
    expect(layerToPolygons(layer)).toEqual([]);
  });

  it('converts an L-only outer path into a 3+ point polygon', () => {
    const layer: TracedLayer = [
      { isholepath: false, segments: [
        { type: 'L', x1: 0, y1: 0, x2: 10, y2: 0 },
        { type: 'L', x1: 10, y1: 0, x2: 10, y2: 10 },
        { type: 'L', x1: 10, y1: 10, x2: 0, y2: 10 },
        { type: 'L', x1: 0, y1: 10, x2: 0, y2: 0 },
      ], boundingbox: [0, 0, 10, 10], holechildren: [] },
    ];
    const polys = layerToPolygons(layer);
    expect(polys.length).toBe(1);
    expect(polys[0].outer.length).toBeGreaterThanOrEqual(3);
    expect(polys[0].holes.length).toBe(0);
  });

  it('expands a Q segment by sampling', () => {
    const layer: TracedLayer = [
      { isholepath: false, segments: [
        { type: 'L', x1: 0, y1: 0, x2: 10, y2: 0 },
        { type: 'Q', x1: 10, y1: 0, x2: 15, y2: 5, x3: 10, y3: 10 },
        { type: 'L', x1: 10, y1: 10, x2: 0, y2: 10 },
        { type: 'L', x1: 0, y1: 10, x2: 0, y2: 0 },
      ], boundingbox: [0, 0, 15, 10], holechildren: [] },
    ];
    const polys = layerToPolygons(layer, 6);
    expect(polys[0].outer.length).toBeGreaterThan(4); // sampled curve
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:run -- polygonize`
Expected: FAIL.

- [ ] **Step 3: Implement `src/colorflow/pipeline/trace.ts`**

```ts
import imagetracer, { type Tracedata, type TracerOptions } from '../vendor/imagetracer';

export interface TraceOpts {
  /** 0 = sharp, 1 = balanced, 2 = smooth. */
  detail: number;
  smooth: boolean;
}

const DETAIL_PRESETS = [
  { ltres: 0.5, qtres: 0.5, pathomit: 4 },
  { ltres: 1.0, qtres: 1.0, pathomit: 8 },
  { ltres: 2.0, qtres: 2.0, pathomit: 16 },
];

/**
 * Trace an ImageData (representing a single color binary mask, OR a multi-color
 * quantized image) into ImageTracer tracedata.
 *
 * `pal` is the palette to feed ImageTracer. Pass [{r,g,b,a:255}] palette to get
 * one layer per color. Prepend a transparent entry (a:0) to route out-of-mask
 * pixels into a skip layer.
 */
export function trace(
  imageData: ImageData,
  pal: Array<{ r: number; g: number; b: number; a: number }>,
  opts: TraceOpts,
): Tracedata {
  const preset = DETAIL_PRESETS[Math.max(0, Math.min(2, opts.detail))];
  const tracerOpts: TracerOptions = {
    ...preset,
    rightangleenhance: true,
    colorquantcycles: 1,
    colorsampling: 0,
    mincolorratio: 0,
    strokewidth: 0,
    linefilter: opts.smooth,
    scale: 1,
    roundcoords: 1,
    viewbox: true,
    desc: false,
    pal,
  };
  return imagetracer.imagedataToTracedata(imageData, tracerOpts);
}
```

- [ ] **Step 4: Implement `src/colorflow/pipeline/polygonize.ts`**

```ts
import type { TracedLayer, TracedSubPath } from '../vendor/imagetracer';

export interface LayerPolygon {
  outer: Array<[number, number]>;
  holes: Array<Array<[number, number]>>;
}

function pathToPoints(path: TracedSubPath, sampleQ: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  if (!path.segments.length) return pts;
  pts.push([path.segments[0].x1, path.segments[0].y1]);
  for (const seg of path.segments) {
    if (seg.type === 'L') {
      pts.push([seg.x2, seg.y2]);
    } else {
      for (let i = 1; i <= sampleQ; i++) {
        const t = i / sampleQ, mt = 1 - t;
        pts.push([
          mt * mt * seg.x1 + 2 * mt * t * seg.x2 + t * t * seg.x3,
          mt * mt * seg.y1 + 2 * mt * t * seg.y2 + t * t * seg.y3,
        ]);
      }
    }
  }
  if (pts.length > 2) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001) pts.pop();
  }
  return pts;
}

/**
 * Convert one tracedata layer (array of subpaths with hole metadata) into
 * a list of polygons-with-holes suitable for earcut.
 */
export function layerToPolygons(layer: TracedLayer, sampleQ = 6): LayerPolygon[] {
  const out: LayerPolygon[] = [];
  for (const path of layer) {
    if (path.isholepath) continue;
    const outer = pathToPoints(path, sampleQ);
    if (outer.length < 3) continue;
    const holes = (path.holechildren ?? [])
      .map((idx) => pathToPoints(layer[idx], sampleQ))
      .filter((h) => h.length >= 3);
    out.push({ outer, holes });
  }
  return out;
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test:run -- polygonize`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/colorflow/pipeline/trace.ts src/colorflow/pipeline/polygonize.ts src/colorflow/__tests__/polygonize.test.ts
git commit -m "Add trace wrapper and polygonize layer-to-polygons conversion

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Extrude (polygons + holes → BufferGeometry via earcut)

**Files:**
- Create: `src/colorflow/pipeline/extrude.ts`
- Test: `src/colorflow/__tests__/extrude.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/colorflow/__tests__/extrude.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extrudePolygon } from '../pipeline/extrude';

describe('extrudePolygon', () => {
  it('returns null for a degenerate polygon (collinear)', () => {
    const result = extrudePolygon(
      [[0, 0], [1, 0], [2, 0]],
      [],
      0,
      1,
    );
    expect(result).toBeNull();
  });

  it('extrudes a unit square into a manifold mesh', () => {
    const result = extrudePolygon(
      [[0, 0], [1, 0], [1, 1], [0, 1]],
      [],
      0,
      1,
    );
    expect(result).not.toBeNull();
    // 2 top + 2 bottom + 8 side triangles = 12 triangles
    expect(result!.indices.length).toBe(36);
    expect(result!.positions.length).toBe(24); // 8 vertices × 3 coords
  });

  it('extrudes a square with a square hole', () => {
    const result = extrudePolygon(
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      [[[3, 3], [7, 3], [7, 7], [3, 7]]],
      0,
      1,
    );
    expect(result).not.toBeNull();
    // 8 top + 8 bottom + 16 side triangles = 32 triangles
    expect(result!.indices.length).toBe(96);
  });

  it('places top vertices at zTop and bottom at zBottom', () => {
    const result = extrudePolygon([[0, 0], [1, 0], [1, 1], [0, 1]], [], 2, 5);
    const zs = new Set<number>();
    for (let i = 2; i < result!.positions.length; i += 3) zs.add(result!.positions[i]);
    expect(zs.has(2)).toBe(true);
    expect(zs.has(5)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:run -- extrude`
Expected: FAIL.

- [ ] **Step 3: Implement `src/colorflow/pipeline/extrude.ts`**

```ts
import earcut from '../vendor/earcut';

export interface ExtrudedGeometry {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Extrude a 2D polygon (with optional holes) between two Z planes.
 * Returns null if the polygon is degenerate (earcut produces no triangles).
 */
export function extrudePolygon(
  outer: Array<[number, number]>,
  holes: Array<Array<[number, number]>>,
  zBottom: number,
  zTop: number,
): ExtrudedGeometry | null {
  const flat: number[] = [];
  for (const [x, y] of outer) flat.push(x, y);
  const holeStarts: number[] = [];
  for (const hole of holes) {
    if (hole.length < 3) continue;
    holeStarts.push(flat.length / 2);
    for (const [x, y] of hole) flat.push(x, y);
  }
  const triIndices = earcut(flat, holeStarts, 2);
  if (triIndices.length === 0) return null;
  const n = flat.length / 2;

  const positions = new Float32Array(n * 6); // n bottom + n top, each xyz
  for (let i = 0; i < n; i++) {
    positions[i * 3]     = flat[i * 2];
    positions[i * 3 + 1] = flat[i * 2 + 1];
    positions[i * 3 + 2] = zBottom;
    positions[(n + i) * 3]     = flat[i * 2];
    positions[(n + i) * 3 + 1] = flat[i * 2 + 1];
    positions[(n + i) * 3 + 2] = zTop;
  }

  const indices: number[] = [];
  // Top face — use top vertex indices, original winding
  for (let i = 0; i < triIndices.length; i += 3) {
    indices.push(n + triIndices[i], n + triIndices[i + 1], n + triIndices[i + 2]);
  }
  // Bottom face — bottom vertex indices, reversed winding (faces down)
  for (let i = 0; i < triIndices.length; i += 3) {
    indices.push(triIndices[i + 2], triIndices[i + 1], triIndices[i]);
  }

  // Side walls — one quad per edge of each ring
  const ringStarts = [0, ...holeStarts];
  const ringEnds = [...holeStarts, n];
  for (let r = 0; r < ringStarts.length; r++) {
    const s = ringStarts[r], e = ringEnds[r];
    for (let i = s; i < e; i++) {
      const next = (i + 1 >= e) ? s : (i + 1);
      indices.push(i, next, n + next);
      indices.push(i, n + next, n + i);
    }
  }

  return { positions, indices: new Uint32Array(indices) };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test:run -- extrude`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/colorflow/pipeline/extrude.ts src/colorflow/__tests__/extrude.test.ts
git commit -m "Add polygon-with-holes extrusion via earcut

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 3MF writer (assembly + sub-parts, packed via JSZip)

**Files:**
- Create: `src/colorflow/threeMfWriter.ts`
- Test: `src/colorflow/__tests__/threeMfWriter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/colorflow/__tests__/threeMfWriter.test.ts`:

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
      { name: 'base', mesh: cubeMesh() },
      { name: 'color_1_ff0000', mesh: cubeMesh() },
    ], 'footpad_assembly');
    expect(blob.size).toBeGreaterThan(100);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
    expect(zip.file('_rels/.rels')).toBeTruthy();
    expect(zip.file('3D/3dmodel.model')).toBeTruthy();
  });

  it('emits one <object> per mesh plus one assembly object', async () => {
    const blob = await build3MF([
      { name: 'base', mesh: cubeMesh() },
      { name: 'color_1', mesh: cubeMesh() },
      { name: 'color_2', mesh: cubeMesh() },
    ], 'assembly');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    // 3 meshes + 1 assembly = 4 <object> entries
    const objectMatches = xml.match(/<object\s/g) ?? [];
    expect(objectMatches.length).toBe(4);
    // Assembly references 3 components
    const componentMatches = xml.match(/<component\s/g) ?? [];
    expect(componentMatches.length).toBe(3);
    // <build> picks the assembly
    expect(xml).toMatch(/<build>\s*<item objectid="4"/);
  });

  it('escapes XML special chars in names', async () => {
    const blob = await build3MF([
      { name: 'a&b<c>"d\'e', mesh: cubeMesh() },
    ], 'parent<x>');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    expect(xml).toContain('a&amp;b&lt;c&gt;&quot;d&apos;e');
    expect(xml).toContain('parent&lt;x&gt;');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:run -- threeMfWriter`
Expected: FAIL.

- [ ] **Step 3: Implement `src/colorflow/threeMfWriter.ts`**

```ts
import JSZip from 'jszip';
import type { ExtrudedGeometry } from './pipeline/extrude';

export interface MeshPart {
  name: string;
  mesh: ExtrudedGeometry;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  } as Record<string, string>)[c]);
}

function buildModelXml(parts: MeshPart[], assemblyName: string): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n';
  xml += '<metadata name="Application">GrippySheet ColorFlow</metadata>\n';
  xml += '<resources>\n';

  parts.forEach((p, i) => {
    const id = i + 1;
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
      xml += `<triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}"/>`;
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
 * Pack a list of named meshes + a parent assembly into a Bambu-compatible 3MF blob.
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

- [ ] **Step 4: Run the tests**

Run: `pnpm test:run -- threeMfWriter`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/colorflow/threeMfWriter.ts src/colorflow/__tests__/threeMfWriter.test.ts
git commit -m "Add 3MF writer producing Bambu assembly + sub-parts via JSZip

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Web Worker entry + typed message protocol

**Files:**
- Create: `src/colorflow/worker.ts`
- Create: `src/colorflow/workerProtocol.ts`
- Modify: `src/vite-env.d.ts` (if needed for `?worker` import)

(No unit test; worker is exercised by the integration smoke test later.)

- [ ] **Step 1: Define the message protocol**

Create `src/colorflow/workerProtocol.ts`:

```ts
import type { Centroid } from './pipeline/quantize';
import type { LayerPolygon } from './pipeline/polygonize';
import type { ExtrudedGeometry } from './pipeline/extrude';

export interface RGBA { r: number; g: number; b: number; a: number }

export interface QuantizeOpts {
  colorCount: number;
  simplify: number;     // 0..4
  seed: number;
}

export interface TraceOptsWire {
  detail: number;       // 0..2
  smooth: boolean;
}

/** Same shape as ExtrudedGeometry; aliased here so the worker protocol stays
 *  decoupled from the pipeline implementation. */
export type TransferredGeom = ExtrudedGeometry;

export type Request =
  | { id: number; kind: 'quantize'; image: ImageBitmap; mask: Uint8Array | null;
      width: number; height: number; opts: QuantizeOpts }
  | { id: number; kind: 'trace'; assignments: Uint16Array; palette: Centroid[];
      width: number; height: number; opts: TraceOptsWire }
  | { id: number; kind: 'extrude'; layers: LayerPolygon[]; outline: LayerPolygon;
      baseMm: number; totalMm: number };

export type Response =
  | { id: number; kind: 'progress'; phase: string }
  | { id: number; kind: 'quantized'; palette: Centroid[]; assignments: Uint16Array;
      previewSvg: string }
  | { id: number; kind: 'traced'; layers: LayerPolygon[]; layerSvgs: Record<number, string>;
      combinedSvg: string }
  | { id: number; kind: 'extruded'; baseGeom: TransferredGeom; layerGeoms: TransferredGeom[] }
  | { id: number; kind: 'error'; phase: string; message: string };
```

- [ ] **Step 2: Implement `src/colorflow/worker.ts`**

```ts
/// <reference lib="webworker" />
import imagetracer from './vendor/imagetracer';
import { kmeans, assignAll, type Centroid } from './pipeline/quantize';
import { modeFilter, SIMPLIFY_KERNELS } from './pipeline/modeFilter';
import { trace } from './pipeline/trace';
import { layerToPolygons, type LayerPolygon } from './pipeline/polygonize';
import { extrudePolygon } from './pipeline/extrude';
import { mulberry32 } from './pipeline/random';
import type { Request, Response, TransferredGeom } from './workerProtocol';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: Response, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

async function handleQuantize(req: Extract<Request, { kind: 'quantize' }>) {
  const { image, mask, width, height, opts, id } = req;
  post({ id, kind: 'progress', phase: 'sampling' });

  // Build a downsampled sample for k-means
  const sampleMax = 200;
  const ss = Math.min(1, sampleMax / Math.max(width, height));
  const sw = Math.max(1, Math.round(width * ss));
  const sh = Math.max(1, Math.round(height * ss));

  const offscreen = new OffscreenCanvas(width, height);
  const ctx2 = offscreen.getContext('2d')!;
  ctx2.drawImage(image, 0, 0, width, height);
  const fullData = ctx2.getImageData(0, 0, width, height);

  const sampleCanvas = new OffscreenCanvas(sw, sh);
  const sctx = sampleCanvas.getContext('2d')!;
  sctx.drawImage(image, 0, 0, sw, sh);
  const sampleData = sctx.getImageData(0, 0, sw, sh);

  // If outline mask is provided, mark sample-resolution pixels outside it as transparent.
  if (mask) {
    for (let i = 0; i < sw * sh; i++) {
      const sx = Math.min(width - 1, Math.floor((i % sw) / ss));
      const sy = Math.min(height - 1, Math.floor(Math.floor(i / sw) / ss));
      if (!mask[sy * width + sx]) sampleData.data[i * 4 + 3] = 0;
    }
  }

  post({ id, kind: 'progress', phase: 'clustering' });
  const palette = kmeans(sampleData, opts.colorCount, mulberry32(opts.seed));
  post({ id, kind: 'progress', phase: 'assigning' });
  let assignments = assignAll(fullData, palette, mask);

  if (opts.simplify > 0) {
    post({ id, kind: 'progress', phase: 'simplifying' });
    const k = SIMPLIFY_KERNELS[opts.simplify];
    assignments = modeFilter(assignments, width, height, k, palette.length);
  }

  // Build a quick combined preview from assignments
  const preview = new ImageData(width, height);
  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    if (a === 0xFFFF) { preview.data[i * 4 + 3] = 0; continue; }
    const c = palette[a];
    preview.data[i * 4]     = c.r;
    preview.data[i * 4 + 1] = c.g;
    preview.data[i * 4 + 2] = c.b;
    preview.data[i * 4 + 3] = 255;
  }
  // Cheap SVG: skip — leave combined SVG to the 'trace' step.

  post({ id, kind: 'quantized', palette, assignments, previewSvg: '' },
       [assignments.buffer]);
}

async function handleTrace(req: Extract<Request, { kind: 'trace' }>) {
  const { assignments, palette, width, height, opts, id } = req;
  post({ id, kind: 'progress', phase: 'tracing' });

  // Build the quantized RGBA image with a leading transparent palette slot,
  // so out-of-mask pixels route to layer 0 (skipped downstream).
  const img = new ImageData(width, height);
  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    if (a === 0xFFFF) { img.data[i * 4 + 3] = 0; continue; }
    const c = palette[a];
    img.data[i * 4]     = c.r;
    img.data[i * 4 + 1] = c.g;
    img.data[i * 4 + 2] = c.b;
    img.data[i * 4 + 3] = 255;
  }
  const pal = [{ r: 0, g: 0, b: 0, a: 0 }, ...palette.map((c) => ({ r: c.r, g: c.g, b: c.b, a: 255 }))];
  const td = trace(img, pal, opts);

  // Build the combined SVG (palette without the leading transparent slot
  // since ImageTracer's getsvgstring still emits all layers).
  const combinedSvg = imagetracer.imagedataToSVG(img, {
    pal: palette.map((c) => ({ r: c.r, g: c.g, b: c.b, a: 255 })),
    viewbox: true,
    strokewidth: 0,
    roundcoords: 1,
    linefilter: opts.smooth,
  });

  // Polygons per layer (skip layer 0 = transparent slot)
  const layerPolys: LayerPolygon[] = [];
  const layerSvgs: Record<number, string> = {};
  for (let li = 1; li < td.layers.length; li++) {
    const polys = layerToPolygons(td.layers[li]);
    // Flatten ONE outer per polygon into the wire-level array; preserve holes.
    for (const p of polys) layerPolys.push(p);
    // For per-layer SVG, regenerate using a 2-color palette (background white, region centroid)
    const binary = new ImageData(width, height);
    const centroid = palette[li - 1];
    if (!centroid) continue;
    for (let i = 0; i < assignments.length; i++) {
      const isMatch = assignments[i] === centroid.index;
      const v = isMatch ? 0 : 255;
      binary.data[i * 4]     = v;
      binary.data[i * 4 + 1] = v;
      binary.data[i * 4 + 2] = v;
      binary.data[i * 4 + 3] = 255;
    }
    const layerSvg = imagetracer.imagedataToSVG(binary, {
      pal: [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }],
      viewbox: true, strokewidth: 0, roundcoords: 1, linefilter: opts.smooth,
    });
    layerSvgs[centroid.index] = layerSvg;
  }

  post({ id, kind: 'traced', layers: layerPolys, layerSvgs, combinedSvg });
}

async function handleExtrude(req: Extract<Request, { kind: 'extrude' }>) {
  const { layers, outline, baseMm, totalMm, id } = req;
  post({ id, kind: 'progress', phase: 'extruding' });

  const baseMesh = extrudePolygon(outline.outer, outline.holes, 0, baseMm);
  if (!baseMesh) {
    post({ id, kind: 'error', phase: 'extrude', message: 'Could not triangulate outline' });
    return;
  }
  const layerGeoms: TransferredGeom[] = [];
  for (const p of layers) {
    const m = extrudePolygon(p.outer, p.holes, baseMm, totalMm);
    if (!m) continue;
    layerGeoms.push(m);
  }

  const transfer: Transferable[] = [baseMesh.positions.buffer, baseMesh.indices.buffer];
  for (const g of layerGeoms) {
    transfer.push(g.positions.buffer, g.indices.buffer);
  }
  post({ id, kind: 'extruded', baseGeom: baseMesh, layerGeoms }, transfer);
}

ctx.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    if (req.kind === 'quantize') await handleQuantize(req);
    else if (req.kind === 'trace') await handleTrace(req);
    else if (req.kind === 'extrude') await handleExtrude(req);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    post({ id: (req as { id: number }).id, kind: 'error', phase: req.kind, message });
  }
};
```

- [ ] **Step 3: Add a worker module declaration if needed**

Open `src/vite-env.d.ts`. If it doesn't already declare `*?worker` imports, append:

```ts
declare module '*?worker' {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
```

- [ ] **Step 4: Smoke-build to confirm Vite bundles the worker**

Run: `pnpm build`
Expected: build succeeds, no missing-module errors. The worker file is bundled but not yet imported anywhere — that's fine.

- [ ] **Step 5: Commit**

```bash
git add src/colorflow/worker.ts src/colorflow/workerProtocol.ts src/vite-env.d.ts
git commit -m "Add ColorFlow Web Worker entry and typed message protocol

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: useColorFlowWorker hook (lifecycle + typed request/response)

**Files:**
- Create: `src/colorflow/useColorFlowWorker.ts`

- [ ] **Step 1: Implement the hook**

Create `src/colorflow/useColorFlowWorker.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Request, Response } from './workerProtocol';
import ColorFlowWorker from './worker?worker';

export interface WorkerStatus {
  phase: string | null;
  error: string | null;
}

let nextId = 1;

export function useColorFlowWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void }>>(new Map());
  const [status, setStatus] = useState<WorkerStatus>({ phase: null, error: null });

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const w = new ColorFlowWorker();
    w.onmessage = (e: MessageEvent<Response>) => {
      const msg = e.data;
      if (msg.kind === 'progress') {
        setStatus({ phase: msg.phase, error: null });
        return;
      }
      const pending = pendingRef.current.get(msg.id);
      if (!pending) return;
      pendingRef.current.delete(msg.id);
      if (msg.kind === 'error') {
        setStatus({ phase: null, error: msg.message });
        pending.reject(new Error(`${msg.phase}: ${msg.message}`));
      } else {
        setStatus({ phase: null, error: null });
        pending.resolve(msg);
      }
    };
    w.onerror = (e) => {
      setStatus({ phase: null, error: e.message });
      // Reject any in-flight requests; tear down so next request spawns a fresh worker.
      for (const [, pending] of pendingRef.current) {
        pending.reject(new Error(e.message));
      }
      pendingRef.current.clear();
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

  const request = useCallback(<R extends Response>(req: Omit<Request, 'id'>, transfer: Transferable[] = []): Promise<R> => {
    const w = ensureWorker();
    const id = nextId++;
    return new Promise<R>((resolve, reject) => {
      pendingRef.current.set(id, { resolve: resolve as (r: Response) => void, reject });
      w.postMessage({ ...req, id }, transfer);
    });
  }, [ensureWorker]);

  return { request, status };
}
```

- [ ] **Step 2: Smoke-build to confirm imports resolve**

Run: `pnpm build`
Expected: success. (If Vite complains about `?worker` syntax, ensure `vite-env.d.ts` from Task 11 has the declaration.)

- [ ] **Step 3: Commit**

```bash
git add src/colorflow/useColorFlowWorker.ts
git commit -m "Add useColorFlowWorker hook for typed worker comms

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Add top-level mode state and segmented control to App.tsx

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/ui/ModeToggle.tsx`

- [ ] **Step 1: Create the mode toggle UI**

Create `src/components/ui/ModeToggle.tsx`:

```tsx
import React from 'react';

export type StudioMode = 'pattern' | 'colorflow';

interface Props {
  mode: StudioMode;
  onChange: (mode: StudioMode) => void;
}

export const ModeToggle: React.FC<Props> = ({ mode, onChange }) => {
  return (
    <div className="inline-flex border border-gray-700 rounded overflow-hidden bg-gray-900">
      <button
        onClick={() => onChange('pattern')}
        className={`px-4 py-2 text-xs font-medium tracking-wider uppercase transition-colors ${
          mode === 'pattern'
            ? 'bg-gradient-to-r from-purple-500 to-cyan-500 text-white'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        Pattern
      </button>
      <button
        onClick={() => onChange('colorflow')}
        className={`px-4 py-2 text-xs font-medium tracking-wider uppercase transition-colors ${
          mode === 'colorflow'
            ? 'bg-gradient-to-r from-purple-500 to-cyan-500 text-white'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        ColorFlow
      </button>
    </div>
  );
};
```

- [ ] **Step 2: Wire mode state into `App.tsx`**

Open `src/App.tsx`. Add the new state and toggle. The full updated file should look approximately like this (preserving existing logic, adding the mode-related pieces):

```tsx
import React, { useState, useRef } from "react";
import ModelViewer from "./components/ModelViewer";
import Controls from "./components/Controls";
import OutputPanel from "./components/OutputPanel";
import * as THREE from 'three';
import { AlertProvider } from './context/AlertContext';
import { BaseSettings, InlaySettings, GeometrySettings } from './types/schemas';
import { defaultBaseSettings, defaultInlaySettings, defaultGeometrySettings } from './utils/schemaDefaults';
import WelcomeModal from "./components/WelcomeModal";
import { ModeToggle, type StudioMode } from "./components/ui/ModeToggle";
import { defaultColorFlowSettings, type ColorFlowSettings } from "./colorflow/schema";

const App = () => {
  const [mode, setMode] = useState<StudioMode>('pattern');

  const [baseSettings, setBaseSettings] = useState<BaseSettings>(defaultBaseSettings);
  const [geometrySettings, setGeometrySettings] = useState<GeometrySettings>(defaultGeometrySettings);
  const [inlaySettings, setInlaySettings] = useState<InlaySettings>(defaultInlaySettings);
  const [colorFlowSettings, setColorFlowSettings] = useState<ColorFlowSettings>(defaultColorFlowSettings);

  const [selectedInlayId, setSelectedInlayId] = useState<string | null>(null);
  const [previewInlay, setPreviewInlay] = useState<any>(null);

  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('welcome_modal_dismissed'));
  const [isControlsCollapsed, setIsControlsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'base' | 'inlay' | 'geometry'>('base');

  const meshRef = useRef<THREE.Group>(null);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && (event.key === 'd' || event.key === 'D')) {
        event.preventDefault();
        setGeometrySettings(prev => ({ ...prev, debugMode: !prev.debugMode }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleReset = () => {
    setBaseSettings(defaultBaseSettings);
    setGeometrySettings(defaultGeometrySettings);
    setInlaySettings(defaultInlaySettings);
    setColorFlowSettings(defaultColorFlowSettings);
    setSelectedInlayId(null);
  };

  return (
    <AlertProvider>
      <div className="h-[100dvh] flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
        <div className="absolute top-4 right-4 z-30">
          <ModeToggle mode={mode} onChange={setMode} />
        </div>

        <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <div className="h-1/2 md:h-auto flex-1 flex flex-col p-4 min-w-0">
            <div className="flex-1 relative bg-gray-900 rounded-lg border border-gray-800 overflow-hidden shadow-inner">
              <ModelViewer
                mode={mode}
                baseSettings={baseSettings}
                inlaySettings={inlaySettings}
                onInlayChange={setInlaySettings}
                geometrySettings={geometrySettings}
                meshRef={meshRef}
                activeTab={activeTab}
                selectedInlayId={selectedInlayId}
                setSelectedInlayId={setSelectedInlayId}
                previewInlay={previewInlay}
                setPreviewInlay={setPreviewInlay}
              />
            </div>
          </div>

          <div className={`md:h-auto w-full md:w-96 overflow-hidden flex flex-col md:p-4 bg-gray-950 md:bg-transparent transition-all duration-300 ease-in-out ${isControlsCollapsed ? 'h-auto flex-shrink-0 md:flex-none' : 'h-1/2 flex-1 md:flex-none'}`}>
            {mode === 'pattern' ? (
              <Controls
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                baseSettings={baseSettings}
                setBaseSettings={setBaseSettings}
                inlaySettings={inlaySettings}
                setInlaySettings={setInlaySettings}
                geometrySettings={geometrySettings}
                setGeometrySettings={setGeometrySettings}
                onReset={handleReset}
                selectedInlayId={selectedInlayId}
                setSelectedInlayId={setSelectedInlayId}
                onOpenWelcome={() => setShowWelcome(true)}
                isCollapsed={isControlsCollapsed}
                onToggleCollapse={() => setIsControlsCollapsed(!isControlsCollapsed)}
                exportControls={
                  <OutputPanel
                    meshRef={meshRef}
                    debugMode={geometrySettings.debugMode ?? false}
                    className="bg-transparent border-0 shadow-none p-0 !p-0"
                  />
                }
              />
            ) : (
              <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 text-gray-300 text-sm">
                ColorFlow controls coming next task…
              </div>
            )}
          </div>
        </main>

        {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
      </div>
    </AlertProvider>
  );
};

export default App;
```

- [ ] **Step 3: Add the `mode` prop to `ModelViewer.tsx`** (minimal — no behavior change yet)

Open `src/components/ModelViewer.tsx`. Update the `ModelViewerProps` interface near the top of the file:

```ts
interface ModelViewerProps {
  mode?: 'pattern' | 'colorflow';
  baseSettings: BaseSettings;
  inlaySettings: InlaySettings;
  geometrySettings: GeometrySettings;
  meshRef: React.RefObject<THREE.Group | null>;
  onInlayChange?: (settings: InlaySettings) => void;
  selectedInlayId?: string | null;
  setSelectedInlayId?: (id: string | null) => void;
  previewInlay?: any;
  setPreviewInlay?: (item: any) => void;
  activeTab?: string;
}
```

And in the function signature, accept the prop with a default. No behavior change yet — Task 16 wires it up.

```tsx
const ModelViewer: React.FC<ModelViewerProps> = ({
  mode = 'pattern',
  baseSettings,
  /* ... */
}) => { /* ... */ };
```

- [ ] **Step 4: Smoke-test**

Run: `pnpm dev`
Expected: app loads, top-right toggle visible, toggling to ColorFlow shows the placeholder message in the right panel. Pattern mode unchanged. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/ui/ModeToggle.tsx src/components/ModelViewer.tsx
git commit -m "Add Pattern/ColorFlow segmented control and mode state

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: ColorFlowControls component (adaptive disclosure UI)

**Files:**
- Create: `src/colorflow/ColorFlowControls.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Implement `ColorFlowControls.tsx`**

Create `src/colorflow/ColorFlowControls.tsx`:

```tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { type BaseSettings } from '../types/schemas';
import { type ColorFlowSettings } from './schema';
import { OUTLINE_LIBRARY, getOutlineBySlug } from './outlineLibrary';
import { parseShapeFile } from '../utils/shapeLoader';
import { useColorFlowWorker } from './useColorFlowWorker';
import { shapeToPolygon, fitOutlineInImage, buildOutlineMask, type OutlinePolygon } from './outlineToPolygon';
import type { Centroid } from './pipeline/quantize';
import type { LayerPolygon } from './pipeline/polygonize';
import type { ExtrudedGeometry } from './pipeline/extrude';
import { build3MF } from './threeMfWriter';
import { useAlert } from '../context/AlertContext';

interface Props {
  baseSettings: BaseSettings;
  setBaseSettings: React.Dispatch<React.SetStateAction<BaseSettings>>;
  settings: ColorFlowSettings;
  setSettings: React.Dispatch<React.SetStateAction<ColorFlowSettings>>;
  /** Called when extrusion completes so the 3D viewer can render the result. */
  onGeometryReady?: (data: { base: ExtrudedGeometry; layers: { centroid: Centroid; geom: ExtrudedGeometry }[] }) => void;
}

const SIMPLIFY_LABELS = ['off', 'light', 'medium', 'strong', 'max'] as const;
const DETAIL_LABELS = ['sharp', 'balanced', 'smooth'] as const;
const MAX_IMG_DIM = 1500;

export const ColorFlowControls: React.FC<Props> = ({ baseSettings, setBaseSettings, settings, setSettings, onGeometryReady }) => {
  const { request, status } = useColorFlowWorker();
  const { showAlert } = useAlert();

  const [imageBitmap, setImageBitmap] = useState<ImageBitmap | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(null);

  const [palette, setPalette] = useState<Centroid[]>([]);
  const [assignments, setAssignments] = useState<Uint16Array | null>(null);
  const [layers, setLayers] = useState<LayerPolygon[]>([]);
  const [layerSvgs, setLayerSvgs] = useState<Record<number, string>>({});
  const [combinedSvg, setCombinedSvg] = useState<string>('');

  const outlinePolygon = useMemo<OutlinePolygon | null>(() => {
    const shape = baseSettings.cutoutShapes?.[0];
    return shape ? shapeToPolygon(shape, 64) : null;
  }, [baseSettings.cutoutShapes]);

  const hasOutline = outlinePolygon !== null;
  const hasImage = imageBitmap !== null;

  // --- Outline picker handlers ---
  const handlePickPreset = useCallback(async (slug: string) => {
    const entry = getOutlineBySlug(slug);
    if (!entry) return;
    try {
      const res = await fetch(entry.file);
      const text = await res.text();
      const parsed = parseShapeFile(text, 'dxf');
      if (!parsed.success) throw new Error(parsed.error);
      setBaseSettings((b) => ({ ...b, cutoutShapes: parsed.shapes as THREE.Shape[] }));
      setSettings((s) => ({ ...s, outlineSlug: slug }));
    } catch (err) {
      showAlert({ title: 'Failed to load outline', message: String(err), type: 'error' });
    }
  }, [setBaseSettings, setSettings, showAlert]);

  // --- Image drop handler ---
  const handleImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showAlert({ title: 'Not an image', message: 'Drop a PNG, JPG, or WebP file.', type: 'error' });
      return;
    }
    setImageName(file.name);
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    if (Math.max(width, height) > MAX_IMG_DIM) {
      const scale = MAX_IMG_DIM / Math.max(width, height);
      const downsized = await createImageBitmap(bitmap, { resizeWidth: Math.round(width * scale), resizeHeight: Math.round(height * scale) });
      width = downsized.width;
      height = downsized.height;
      setImageBitmap(downsized);
      bitmap.close();
    } else {
      setImageBitmap(bitmap);
    }
    setImageDims({ w: width, h: height });
  }, [showAlert]);

  // --- Quantize whenever inputs change ---
  useEffect(() => {
    if (!hasImage || !hasOutline || !imageBitmap || !imageDims || !outlinePolygon) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const placement = fitOutlineInImage(outlinePolygon, imageDims.w, imageDims.h);
        const mask = buildOutlineMask(outlinePolygon, placement, imageDims.w, imageDims.h);
        const resp: any = await request({
          kind: 'quantize',
          image: imageBitmap,
          mask,
          width: imageDims.w,
          height: imageDims.h,
          opts: { colorCount: settings.colorCount, simplify: settings.simplify, seed: 42 },
        });
        if (cancelled || resp.kind !== 'quantized') return;
        setPalette(resp.palette);
        setAssignments(resp.assignments);
      } catch (err) {
        showAlert({ title: 'Quantization failed', message: String(err), type: 'error' });
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [hasImage, hasOutline, imageBitmap, imageDims, outlinePolygon, settings.colorCount, settings.simplify, request, showAlert]);

  // --- Trace whenever assignments / detail / smooth change ---
  useEffect(() => {
    if (!assignments || !palette.length || !imageDims) return;
    let cancelled = false;
    (async () => {
      try {
        const resp: any = await request({
          kind: 'trace',
          assignments,
          palette,
          width: imageDims.w,
          height: imageDims.h,
          opts: { detail: settings.detail, smooth: settings.smooth },
        });
        if (cancelled || resp.kind !== 'traced') return;
        setLayers(resp.layers);
        setLayerSvgs(resp.layerSvgs);
        setCombinedSvg(resp.combinedSvg);
      } catch (err) {
        showAlert({ title: 'Tracing failed', message: String(err), type: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [assignments, palette, imageDims, settings.detail, settings.smooth, request, showAlert]);

  // --- Extrude whenever layers / thickness change ---
  useEffect(() => {
    if (!layers.length || !outlinePolygon || !imageDims) return;
    let cancelled = false;
    (async () => {
      try {
        // Convert pixel-space polygon coords back to mm-space for the 3D model.
        const placement = fitOutlineInImage(outlinePolygon, imageDims.w, imageDims.h);
        const layersInMm: LayerPolygon[] = layers.map((p) => ({
          outer: p.outer.map(([x, y]) => [(x - placement.offsetX) / placement.scale + outlinePolygon.minX,
                                            (y - placement.offsetY) / placement.scale + outlinePolygon.minY] as [number, number]),
          holes: p.holes.map((h) => h.map(([x, y]) => [(x - placement.offsetX) / placement.scale + outlinePolygon.minX,
                                                       (y - placement.offsetY) / placement.scale + outlinePolygon.minY] as [number, number])),
        }));
        const outlineInMm: LayerPolygon = {
          outer: outlinePolygon.outer.map(([x, y]) => [x, y] as [number, number]),
          holes: outlinePolygon.holes.map((h) => h.map(([x, y]) => [x, y] as [number, number])),
        };
        const resp: any = await request({
          kind: 'extrude',
          layers: layersInMm,
          outline: outlineInMm,
          baseMm: settings.baseMm,
          totalMm: settings.totalMm,
        });
        if (cancelled || resp.kind !== 'extruded') return;
        if (onGeometryReady) {
          // Pair each layer geom with its centroid. layers and palette align by index when
          // we built one polygon per traced layer above, but layers can contain >1 polygon
          // per color — for now we map best-effort by sequence; refine in Task 17 once we
          // also surface centroid indices from the worker side.
          const pairs = resp.layerGeoms.map((geom: ExtrudedGeometry, i: number) => ({
            centroid: palette[i % palette.length],
            geom,
          }));
          onGeometryReady({ base: resp.baseGeom, layers: pairs });
        }
      } catch (err) {
        showAlert({ title: 'Extrusion failed', message: String(err), type: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [layers, outlinePolygon, imageDims, settings.baseMm, settings.totalMm, request, palette, onGeometryReady, showAlert]);

  // --- 3MF export ---
  const handleExport3MF = useCallback(async () => {
    if (!layers.length || !outlinePolygon || !imageDims) return;
    try {
      const placement = fitOutlineInImage(outlinePolygon, imageDims.w, imageDims.h);
      const layersInMm: LayerPolygon[] = layers.map((p) => ({
        outer: p.outer.map(([x, y]) => [(x - placement.offsetX) / placement.scale + outlinePolygon.minX,
                                          (y - placement.offsetY) / placement.scale + outlinePolygon.minY] as [number, number]),
        holes: p.holes.map((h) => h.map(([x, y]) => [(x - placement.offsetX) / placement.scale + outlinePolygon.minX,
                                                     (y - placement.offsetY) / placement.scale + outlinePolygon.minY] as [number, number])),
      }));
      const outlineInMm: LayerPolygon = {
        outer: outlinePolygon.outer.map(([x, y]) => [x, y] as [number, number]),
        holes: outlinePolygon.holes.map((h) => h.map(([x, y]) => [x, y] as [number, number])),
      };
      const resp: any = await request({
        kind: 'extrude', layers: layersInMm, outline: outlineInMm,
        baseMm: settings.baseMm, totalMm: settings.totalMm,
      });
      const parts = [{ name: 'base', mesh: resp.baseGeom }];
      resp.layerGeoms.forEach((g: ExtrudedGeometry, i: number) => {
        const c = palette[i % palette.length];
        const hex = c ? `${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}` : 'unk';
        parts.push({ name: `color_${i + 1}_${hex}`, mesh: g });
      });
      const blob = await build3MF(parts, 'footpad_assembly');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(imageName || 'design').replace(/\.[^.]+$/, '')}_${settings.outlineSlug || 'outline'}.3mf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      showAlert({ title: '3MF export failed', message: String(err), type: 'error' });
    }
  }, [layers, outlinePolygon, imageDims, settings, palette, imageName, request, showAlert]);

  // --- Render ---
  const dropRef = useRef<HTMLDivElement>(null);

  return (
    <div className="bg-gray-800 md:rounded-lg md:border border-gray-700 shadow-lg flex-1 min-h-0 flex flex-col overflow-y-auto">
      <div className="p-6 space-y-6">
        <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
          GrippySheet · ColorFlow
        </h2>

        <section>
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">① Outline</h3>
          <select
            value={settings.outlineSlug ?? ''}
            onChange={(e) => handlePickPreset(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm"
          >
            <option value="">— pick an outline —</option>
            {(['xr','gt','pint','other'] as const).map((g) => (
              <optgroup key={g} label={g.toUpperCase()}>
                {OUTLINE_LIBRARY.filter((o) => o.group === g).map((o) => (
                  <option key={o.slug} value={o.slug}>{o.name} · {o.widthMm}×{o.heightMm}mm</option>
                ))}
              </optgroup>
            ))}
          </select>
          {hasOutline && <p className="text-xs text-green-400 mt-2">✓ outline loaded</p>}
        </section>

        <section className={hasOutline ? '' : 'opacity-40 pointer-events-none'}>
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">② Image</h3>
          <div
            ref={dropRef}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleImageFile(f); };
              input.click();
            }}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImageFile(f); }}
            className="border-2 border-dashed border-gray-700 rounded p-6 text-center text-gray-400 text-sm cursor-pointer hover:border-blue-500 hover:bg-gray-900/50"
          >
            {hasImage
              ? <span className="text-green-400">✓ {imageName} · {imageDims?.w}×{imageDims?.h}</span>
              : <span>drag image / click to browse</span>}
          </div>
        </section>

        <section className={hasImage ? '' : 'opacity-40 pointer-events-none'}>
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">③ Colors</h3>
          <div className="space-y-3">
            <label className="block text-xs text-gray-400">
              colors <span className="text-purple-400 font-mono">{settings.colorCount}</span>
              <input type="range" min={2} max={10} value={settings.colorCount}
                onChange={(e) => setSettings((s) => ({ ...s, colorCount: +e.target.value }))}
                className="w-full mt-1" />
            </label>
            <label className="block text-xs text-gray-400">
              simplify <span className="text-purple-400 font-mono">{SIMPLIFY_LABELS[settings.simplify]}</span>
              <input type="range" min={0} max={4} value={settings.simplify}
                onChange={(e) => setSettings((s) => ({ ...s, simplify: +e.target.value }))}
                className="w-full mt-1" />
            </label>
            <label className="block text-xs text-gray-400">
              trace detail <span className="text-purple-400 font-mono">{DETAIL_LABELS[settings.detail]}</span>
              <input type="range" min={0} max={2} value={settings.detail}
                onChange={(e) => setSettings((s) => ({ ...s, detail: +e.target.value }))}
                className="w-full mt-1" />
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input type="checkbox" checked={settings.smooth}
                onChange={(e) => setSettings((s) => ({ ...s, smooth: e.target.checked }))} />
              smoothing
            </label>
          </div>
        </section>

        <section className={layers.length > 0 ? '' : 'opacity-40 pointer-events-none'}>
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">④ Print</h3>
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
            <label>total mm
              <input type="number" step={0.1} min={0.4} max={10} value={settings.totalMm}
                onChange={(e) => setSettings((s) => ({ ...s, totalMm: +e.target.value }))}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1" />
            </label>
            <label>base mm
              <input type="number" step={0.1} min={0.2} max={5} value={settings.baseMm}
                onChange={(e) => setSettings((s) => ({ ...s, baseMm: +e.target.value }))}
                className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-1" />
            </label>
          </div>
        </section>

        <section className={layers.length > 0 ? '' : 'opacity-40 pointer-events-none'}>
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">⑤ Export</h3>
          <button
            onClick={handleExport3MF}
            className="w-full bg-gradient-to-r from-purple-500 to-cyan-500 text-white py-3 rounded font-bold hover:brightness-110 disabled:opacity-50"
            disabled={layers.length === 0}
          >
            ⬇ Export 3MF (Bambu)
          </button>
        </section>

        <div className="text-xs text-gray-500 min-h-[20px]">
          {status.phase && <span>working: {status.phase}</span>}
          {status.error && <span className="text-red-400">error: {status.error}</span>}
          {!status.phase && !status.error && palette.length > 0 && <span>ready · {palette.length} colors traced</span>}
        </div>

        {palette.length > 0 && (
          <section>
            <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">Layers</h3>
            <div className="grid grid-cols-2 gap-2">
              {palette.map((c) => (
                <div key={c.index} className="bg-gray-900 border border-gray-700 rounded p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded" style={{ background: `rgb(${c.r},${c.g},${c.b})` }} />
                    <div className="font-mono">#{c.r.toString(16).padStart(2,'0')}{c.g.toString(16).padStart(2,'0')}{c.b.toString(16).padStart(2,'0')}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Swap the placeholder in `App.tsx` for the real component**

Replace the placeholder ColorFlow div in `App.tsx`:

```tsx
{mode === 'pattern' ? (
  <Controls /* ...existing props... */ />
) : (
  <ColorFlowControls
    baseSettings={baseSettings}
    setBaseSettings={setBaseSettings}
    settings={colorFlowSettings}
    setSettings={setColorFlowSettings}
  />
)}
```

And add the import at the top:

```tsx
import { ColorFlowControls } from './colorflow/ColorFlowControls';
```

- [ ] **Step 3: Smoke-test**

Run: `pnpm dev`
Expected: ColorFlow mode shows the new panel with all 5 sections. Picking an outline + dropping an image triggers worker activity in the status line. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/colorflow/ColorFlowControls.tsx src/App.tsx
git commit -m "Add ColorFlow adaptive disclosure controls panel

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: ColorFlowModel imperative 3D builder

**Files:**
- Create: `src/colorflow/ColorFlowModel.tsx`

- [ ] **Step 1: Implement the imperative model**

Create `src/colorflow/ColorFlowModel.tsx`:

```tsx
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Centroid } from './pipeline/quantize';
import type { ExtrudedGeometry } from './pipeline/extrude';

interface Props {
  baseGeom: ExtrudedGeometry | null;
  layers: Array<{ centroid: Centroid; geom: ExtrudedGeometry }>;
  displayMode?: 'normal' | 'toon';
}

function makeBufferGeom(g: ExtrudedGeometry): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
  geom.setIndex(new THREE.BufferAttribute(g.indices, 1));
  geom.computeVertexNormals();
  return geom;
}

export const ColorFlowModel = React.forwardRef<THREE.Group, Props>(({ baseGeom, layers, displayMode = 'normal' }, ref) => {
  const localGroupRef = useRef<THREE.Group>(null);

  React.useImperativeHandle(ref, () => localGroupRef.current!, []);

  useEffect(() => {
    const group = localGroupRef.current;
    if (!group) return;
    // Dispose & clear
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) obj.material.dispose();
      }
    });
    while (group.children.length) group.remove(group.children[0]);
    group.name = 'ColorFlowAssembly';

    if (baseGeom) {
      const mesh = new THREE.Mesh(
        makeBufferGeom(baseGeom),
        displayMode === 'toon'
          ? new THREE.MeshToonMaterial({ color: 0xdddddd })
          : new THREE.MeshStandardMaterial({ color: 0xdddddd }),
      );
      mesh.name = 'Base';
      group.add(mesh);
    }
    for (let i = 0; i < layers.length; i++) {
      const { centroid: c, geom } = layers[i];
      const hex = `${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`;
      const mat = displayMode === 'toon'
        ? new THREE.MeshToonMaterial({ color: new THREE.Color(c.r / 255, c.g / 255, c.b / 255) })
        : new THREE.MeshStandardMaterial({ color: new THREE.Color(c.r / 255, c.g / 255, c.b / 255) });
      const mesh = new THREE.Mesh(makeBufferGeom(geom), mat);
      mesh.name = `Color_${i + 1}_${hex}`;
      group.add(mesh);
    }
  }, [baseGeom, layers, displayMode]);

  return <group ref={localGroupRef} />;
});
```

- [ ] **Step 2: Smoke-build**

Run: `pnpm build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/colorflow/ColorFlowModel.tsx
git commit -m "Add ColorFlowModel imperative 3D builder

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Wire ModelViewer to route to ColorFlowModel in ColorFlow mode

**Files:**
- Modify: `src/components/ModelViewer.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Lift the extruded geometry state into App.tsx**

In `src/App.tsx`, add state for the latest ColorFlow geometry and pass it down:

```tsx
import type { Centroid } from './colorflow/pipeline/quantize';
import type { ExtrudedGeometry } from './colorflow/pipeline/extrude';

// inside App component, near other state:
const [colorFlowGeom, setColorFlowGeom] = useState<{ base: ExtrudedGeometry; layers: { centroid: Centroid; geom: ExtrudedGeometry }[] } | null>(null);
```

Pass it down:

```tsx
<ModelViewer
  mode={mode}
  /* ...existing props... */
  colorFlowGeom={colorFlowGeom}
/>

{mode === 'pattern' ? (/* ... */) : (
  <ColorFlowControls
    /* ...existing props... */
    onGeometryReady={setColorFlowGeom}
  />
)}
```

- [ ] **Step 2: Route in `ModelViewer.tsx`**

Add the new prop and the conditional render. Add this near the other imports:

```tsx
import { ColorFlowModel } from '../colorflow/ColorFlowModel';
import type { Centroid } from '../colorflow/pipeline/quantize';
import type { ExtrudedGeometry } from '../colorflow/pipeline/extrude';
```

Extend `ModelViewerProps`:

```ts
interface ModelViewerProps {
  mode?: 'pattern' | 'colorflow';
  // ...existing props...
  colorFlowGeom?: { base: ExtrudedGeometry; layers: { centroid: Centroid; geom: ExtrudedGeometry }[] } | null;
}
```

Inside the `<Canvas>` block, replace the `<ImperativeModel … />` instantiation with a switch:

```tsx
{mode === 'colorflow' ? (
  <ColorFlowModel
    ref={meshRef}
    baseGeom={colorFlowGeom?.base ?? null}
    layers={colorFlowGeom?.layers ?? []}
    displayMode={displayMode}
  />
) : (
  <ImperativeModel
    ref={meshRef}
    /* ...all the existing pattern-mode props... */
  />
)}
```

Also hide the pattern-mode-only toolbar bits in ColorFlow mode: the debug `Cutter` menu (already gated by `geometryDebugMode`, but also hide the `<InlayInteractionHandles>` block when `mode !== 'pattern'`):

```tsx
{mode === 'pattern' && activeTab === 'inlay' && onInlayChange && (
  <InlayInteractionHandles /* ... */ />
)}
```

- [ ] **Step 3: Smoke-test**

Run: `pnpm dev`
Expected: in ColorFlow mode, after picking an outline + dropping an image, you should see the base outline rendered as a flat slab plus color regions on top, all in 3D. Pattern mode still works. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/ModelViewer.tsx
git commit -m "Route ModelViewer to ColorFlowModel when mode is colorflow

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: End-to-end smoke test (manual) — ship the working v1 to a usable state

This task has no code changes. It's the gate that proves the pipeline works end-to-end before adding persistence and library polish.

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`

- [ ] **Step 2: Run the manual happy path**

In a browser at `http://localhost:5173`:

1. Toggle to ColorFlow mode (top-right segmented control).
2. Pick "Pint" outline from the dropdown.
3. Drop a 4-color image (use any PNG with distinct color regions — a simple flag image is ideal).
4. Wait for the status line to read "ready · N colors traced".
5. Confirm the 3D viewer shows a flat slab (base) with raised color regions on top, each in its centroid color.
6. Adjust `colors` slider — preview updates within a couple of seconds.
7. Adjust `simplify` to `strong` — smoother color regions.
8. Adjust `total mm` to 3.0 — color regions get taller in the 3D view.
9. Click "Export 3MF (Bambu)".
10. Open the downloaded `.3mf` in Bambu Studio (or your slicer of choice).
11. Verify: object lands as `footpad_assembly` parent, expands to `base` + N `color_*` sub-parts, Z heights match the settings.

- [ ] **Step 3: Capture issues**

If any step fails, capture the issue and file it as a follow-up task before proceeding. Common likely issues:
- Worker `?worker` import path not resolved → revisit Task 11's vite-env.d.ts declaration.
- 3MF file opens but Bambu doesn't recognize the assembly → diff `model.xml` against STRATA's known-good output and fix the XML structure in Task 10.
- Color regions misaligned with outline → revisit `pixelToMm` math in Task 14's effect bodies.

- [ ] **Step 4: Commit a smoke-test log**

If the smoke test passed, no commit. If you fixed something during smoke testing, commit that fix with a message describing what was wrong.

---

## Task 18: Image asset bundling in projectUtils

**Files:**
- Modify: `src/utils/projectUtils.ts`
- Modify: `src/colorflow/ColorFlowControls.tsx`

- [ ] **Step 1: Extend `ProjectAssets` and the bundle writer**

Open `src/utils/projectUtils.ts`. Update the `Asset` and `ProjectAssets` types:

```ts
export interface Asset {
  name: string;
  content: string | ArrayBuffer;
  type: 'dxf' | 'svg' | 'stl' | 'image';
}

export interface ProjectAssets {
  baseOutline?: Asset;
  pattern?: Asset;
  inlays?: Record<string, Asset>;
  image?: Asset;  // ColorFlow image bytes
}
```

In `exportProjectBundle`, after adding inlays, add the image entry:

```ts
if (assets.image) {
  zip.file(`assets/image/${assets.image.name}`, assets.image.content);
}
```

And update the project data construction to include mode + imageMode:

```ts
const projectData = {
  version: 2 as const,
  timestamp: Date.now(),
  mode,
  base: { ...base, cutoutShapes: null },
  inlay: { ...inlay },
  geometry: { ...geometry, patternShapes: null },
  imageMode,
} satisfies ProjectDataV2;
```

You'll need to extend the function signature to accept `mode` and `imageMode`:

```ts
export const exportProjectBundle = async (
  mode: 'pattern' | 'colorflow',
  base: BaseSettings,
  inlay: InlaySettings,
  geometry: GeometrySettings,
  imageMode: ColorFlowSettings | undefined,
  assets: ProjectAssets,
) => { /* ... */ };
```

Update imports at the top:

```ts
import {
  ProjectSchema, ProjectSchemaV1, ProjectSchemaV2,
  ProjectData, ProjectDataV2,
  BaseSettings, InlaySettings, GeometrySettings,
  migrateV1ToV2,
} from '../types/schemas';
import { ColorFlowSettings } from '../colorflow/schema';
```

Update `importProjectBundle` to:

1. Read the image asset folder if present.
2. Handle v1 zips via `migrateV1ToV2`.

```ts
// In importProjectBundle, after reading the inlays folder:
const imageFolder = zip.folder('assets/image');
if (imageFolder) {
  const files = await imageFolder.file(/.*/);
  if (files.length > 0) {
    assets.image = await processEntry(files[0], 'image');
    assets.image.type = 'image';
  }
}

// Replace the safeParse logic so v1 bundles route through the migrator:
if (rawData.version === 1) {
  const migrated = migrateV1ToV2(rawData);
  return { data: migrated, versionMismatch: false, importedVersion: 1, importedAssets: assets };
}

const result = ProjectSchema.safeParse(rawData);
if (!result.success) {
  throw new Error('Invalid project file format or version mismatch.');
}
return { data: result.data, versionMismatch: false, importedVersion: 2, importedAssets: assets };
```

Also adjust the `ImportResult` shape to return a `ProjectDataV2` (which contains `mode` and optional `imageMode`).

```ts
export interface ImportResult {
  data: ProjectDataV2;
  versionMismatch?: boolean;
  importedVersion?: number;
  importedAssets?: ProjectAssets;
}
```

- [ ] **Step 2: Surface the image bytes from ColorFlowControls**

In `ColorFlowControls.tsx`, after `handleImageFile` decodes the bitmap, also stash the raw bytes for the bundle. Add a prop callback so `App.tsx` can keep the asset around:

```tsx
// in Props:
onImageAssetChanged?: (asset: { name: string; bytes: ArrayBuffer } | null) => void;

// in handleImageFile, before setImageBitmap:
const bytes = await file.arrayBuffer();
onImageAssetChanged?.({ name: file.name, bytes });
```

- [ ] **Step 3: Wire the asset in `App.tsx`**

Add asset state and pass through to `exportProjectBundle` when the user clicks the existing "Export Project" button:

```tsx
import type { ProjectAssets } from './utils/projectUtils';
// state:
const [projectAssets, setProjectAssets] = useState<ProjectAssets>({ inlays: {} });

// pass to ColorFlowControls:
onImageAssetChanged={(a) => setProjectAssets((p) => ({
  ...p,
  image: a ? { name: a.name, content: a.bytes, type: 'image' } : undefined,
}))}
```

(The existing pattern-mode `Controls` already maintains its own `projectAssets` state internally. For the unified bundle we want one source of truth — this task accepts the duplication and lets pattern mode keep handling its own asset wiring. A follow-up can unify if needed.)

- [ ] **Step 4: Run tests + build**

Run: `pnpm test:run && pnpm build`
Expected: schema tests still pass, build succeeds. Existing project import/export tests (none exist yet — schema tests only) still pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/projectUtils.ts src/colorflow/ColorFlowControls.tsx src/App.tsx
git commit -m "Bundle ColorFlow image assets and migrate v1 projects on import

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Image hydration on import

**Files:**
- Modify: `src/colorflow/ColorFlowControls.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Surface the imported image to ColorFlowControls**

When a project bundle is imported, `importedAssets.image` will contain the raw bytes. We need to push this into `ColorFlowControls` so it decodes into an `ImageBitmap` and triggers the pipeline.

Add a prop to `ColorFlowControls`:

```tsx
interface Props {
  /* ...existing... */
  initialImageAsset?: { name: string; bytes: ArrayBuffer } | null;
}
```

In the component body, after the existing state declarations, add a hydrate effect:

```tsx
useEffect(() => {
  if (!initialImageAsset) return;
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

- [ ] **Step 2: Wire in App.tsx**

`App.tsx` should pass `initialImageAsset` whenever a project import lands. Add the prop on the `<ColorFlowControls>` instantiation:

```tsx
<ColorFlowControls
  /* ...existing props... */
  initialImageAsset={projectAssets.image
    ? { name: projectAssets.image.name, bytes: projectAssets.image.content as ArrayBuffer }
    : null}
/>
```

- [ ] **Step 3: Manual smoke test**

Run: `pnpm dev`
1. Switch to ColorFlow mode, pick an outline, drop an image, tune settings.
2. From the pattern-mode footer (Controls.tsx) click "Export Project" — produces a zip.
3. Click "Import Project" — pick the same zip.
4. Mode resets to pattern (existing Controls own that flow). For now the round-trip won't restore mode automatically — that's the next half of this task. Move on.

- [ ] **Step 4: Restore mode + imageMode settings on import**

We need to lift the import handler out of `Controls.tsx` so it can also set `mode` and `colorFlowSettings`. Two options here for a future refactor; for now, surface a callback:

In `App.tsx`, intercept the import by passing an `onProjectImported` callback through `Controls`:

```tsx
// in App.tsx, hoisted import handler:
const handleProjectImported = useCallback((data: ProjectDataV2, assets: ProjectAssets) => {
  setBaseSettings(data.base as BaseSettings);
  setInlaySettings(data.inlay as InlaySettings);
  setGeometrySettings(data.geometry as GeometrySettings);
  if (data.imageMode) setColorFlowSettings(data.imageMode);
  setMode(data.mode);
  setProjectAssets(assets);
}, []);
```

This pushes the import logic out of `Controls.tsx` and into `App.tsx`. For v1 you have two paths:
  - **Minimal (this task)**: Add a second "Import" button inside `ColorFlowControls` that calls `importProjectBundle` directly + invokes `onProjectImported`. The existing pattern-mode import in `Controls.tsx` keeps working for pattern-mode projects.
  - **Unified (follow-up)**: Move import/export to `App.tsx`-level so both modes share the buttons. Defer.

Pick the minimal path: add an "Import / Export Project" footer to `ColorFlowControls.tsx`:

```tsx
import { importProjectBundle, exportProjectBundle } from '../utils/projectUtils';

// in the JSX, after the layer grid:
<div className="grid grid-cols-2 gap-2 mt-6 pt-4 border-t border-gray-700">
  <button onClick={async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.onchange = async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      try {
        const { data, importedAssets } = await importProjectBundle(f);
        onProjectImported?.(data, importedAssets ?? {});
      } catch (err) {
        showAlert({ title: 'Import failed', message: String(err), type: 'error' });
      }
    };
    input.click();
  }} className="text-xs bg-gray-700 hover:bg-gray-600 rounded py-2">Import Project</button>
  <button onClick={() => onExportProject?.()} className="text-xs bg-gray-700 hover:bg-gray-600 rounded py-2">Export Project</button>
</div>
```

Add `onProjectImported` and `onExportProject` to the `Props`. In `App.tsx`, pass through:

```tsx
onProjectImported={(data, imported) => {
  setBaseSettings(data.base as BaseSettings);
  setInlaySettings(data.inlay as InlaySettings);
  setGeometrySettings(data.geometry as GeometrySettings);
  if (data.imageMode) setColorFlowSettings(data.imageMode);
  setMode(data.mode);
  setProjectAssets(imported);
}}
onExportProject={() => exportProjectBundle(mode, baseSettings, inlaySettings, geometrySettings, colorFlowSettings, projectAssets)}
```

- [ ] **Step 5: Manual round-trip test**

Run `pnpm dev`. In ColorFlow mode: pick outline → drop image → tune → "Export Project" → reload → "Import Project" → confirm outline, image, and settings restore.

- [ ] **Step 6: Commit**

```bash
git add src/colorflow/ColorFlowControls.tsx src/App.tsx
git commit -m "Hydrate ColorFlow project bundles on import

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: Add outline library dropdown to pattern-mode BaseControls

**Files:**
- Modify: `src/components/controls/BaseControls.tsx`

- [ ] **Step 1: Read the current BaseControls**

Open `src/components/controls/BaseControls.tsx` to see the existing layout. We're adding a dropdown above the existing `ShapeUploader` invocation that selects a preset and triggers the same `onOutlineLoaded` callback.

- [ ] **Step 2: Add the dropdown**

Near the top of the JSX, before the existing uploader UI, add:

```tsx
import { OUTLINE_LIBRARY, getOutlineBySlug } from '../../colorflow/outlineLibrary';
import { parseShapeFile } from '../../utils/shapeLoader';

// Inside the component, before the existing JSX:
const handlePickPreset = async (slug: string) => {
  if (!slug) return;
  const entry = getOutlineBySlug(slug);
  if (!entry) return;
  const res = await fetch(entry.file);
  const text = await res.text();
  const parsed = parseShapeFile(text, 'dxf');
  if (parsed.success) onOutlineLoaded(parsed.shapes);
};

// JSX:
<div className="mb-3">
  <label className="block text-xs text-gray-400 mb-1">Outline Library</label>
  <select
    onChange={(e) => handlePickPreset(e.target.value)}
    defaultValue=""
    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm"
  >
    <option value="">— upload your own DXF below —</option>
    {(['xr','gt','pint','other'] as const).map((g) => (
      <optgroup key={g} label={g.toUpperCase()}>
        {OUTLINE_LIBRARY.filter((o) => o.group === g).map((o) => (
          <option key={o.slug} value={o.slug}>{o.name} · {o.widthMm}×{o.heightMm}mm</option>
        ))}
      </optgroup>
    ))}
  </select>
</div>
```

- [ ] **Step 3: Smoke-test**

Run: `pnpm dev`. In Pattern mode → Base tab, the new dropdown appears. Picking an outline loads it just like uploading the DXF would. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/components/controls/BaseControls.tsx
git commit -m "Add outline library dropdown to pattern-mode BaseControls

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 21: WelcomeModal copy refresh

**Files:**
- Modify: `src/components/WelcomeModal.tsx`

- [ ] **Step 1: Add a short note about ColorFlow**

Open `src/components/WelcomeModal.tsx`. In the content section (after the existing tagline), add a one-paragraph note:

```tsx
<p className="text-gray-300 text-sm leading-relaxed mb-4">
  Get started by uploading your grip outline and configuring your shapes — or
  switch to <span className="text-purple-400 font-bold">ColorFlow</span> mode
  (top right) to design a multi-color flat print from a raster image.
</p>
```

(Replace the existing first paragraph that says "Get started by uploading your grip outline and configuring your shapes.")

- [ ] **Step 2: Smoke-test**

Run: `pnpm dev`, clear localStorage so the welcome modal appears (in DevTools: `localStorage.removeItem('welcome_modal_dismissed'); location.reload()`). Confirm the new copy renders. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add src/components/WelcomeModal.tsx
git commit -m "Update WelcomeModal copy to mention ColorFlow mode

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 22: Update CLAUDE.md with the new module

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a ColorFlow section**

Open `CLAUDE.md` and append a new section after "Architecture":

```md
### ColorFlow mode (`src/colorflow/`)

A peer mode to the existing pattern/inlay workflow. Selected via the top-right segmented control in `App.tsx` (`mode: 'pattern' | 'colorflow'`).

- **Pipeline lives in a Web Worker** (`colorflow/worker.ts`). Main thread sends `quantize` / `trace` / `extrude` requests via the `useColorFlowWorker` hook; worker returns transferable typed-array geometries.
- **The 3D viewer is reused**. `ModelViewer` gets a `mode` prop and routes to `ColorFlowModel.tsx` (a small imperative builder) when in ColorFlow.
- **Output is a multi-part 3MF assembly** (`base` + N `color_*` sub-parts at stacked Z heights) packed via the existing JSZip dep — see `threeMfWriter.ts`. The pattern-mode 3MF export remains via `three-3mf-exporter`.
- **Outlines** come from `colorflow/outlineLibrary.ts` (a 16-entry manifest referencing the existing DXFs in `public/outlines/`). The same dropdown is also surfaced in pattern-mode `BaseControls`.
- **Vendored libs** in `colorflow/vendor/` (ImageTracer + earcut, public-domain). Don't add them as npm deps — the upstream versions are unmaintained.
- **Vitest** covers the pure pipeline utils only. No React testing. `pnpm test` / `pnpm test:run`.
- **An `<ErrorBoundary>` wraps the Canvas in both modes** — a crash in geometry construction no longer kills the studio.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Document ColorFlow mode in CLAUDE.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review checklist (for the executing engineer)

Before declaring the feature done, walk this list:

- [ ] All 23 tasks (0..22) committed in order.
- [ ] `pnpm test:run` passes with at least 30+ tests across pipeline utils.
- [ ] `pnpm lint` passes without new warnings.
- [ ] `pnpm build` produces a working production bundle.
- [ ] Manual smoke test from Task 17 still passes (pick outline → drop image → tune → export 3MF → import into Bambu Studio → see assembly + sub-parts).
- [ ] Pattern mode unchanged: load any existing v1 project bundle, verify it imports with `mode='pattern'` and renders correctly.
- [ ] Mode toggle preserves state in both directions (switch to ColorFlow, then back, pattern settings still there).
- [ ] ErrorBoundary verified by deliberately forcing an exception (e.g., set `geometrySettings.patternScale = -Infinity` from the console) — the studio shows the fallback panel and recovers via "Try again" instead of crashing the whole page.
