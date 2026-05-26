# GrippySheet Studio

Design and 3D-print your own grip-tape pads for Onewheel and other electric skateboards — all in the browser. Pick a deck, drop in artwork, export a multi-color 3MF, slice, print.

Live: **https://techfoundrynz.github.io/grippysheet-studio**

<!-- screenshot: docs/screenshot.png -->

## What it does

- **16 stock deck outlines** baked in (Pint, XR, Floatwheel, GT variants, and more), or upload your own DXF for a custom shape.
- **Two creative modes:**
  - *Pattern* — tile tactile bumps (dots, hex, custom STL) across the pad, with logo/badge inlays that can cut, mask, or carve avoid zones.
  - *ColorFlow* — drop an image, the worker quantizes it into a printable color stack, and you get a per-color stair-step 3MF ready for AMS / MMU.
- **Drag and drop anywhere on the canvas** — images (JPG/PNG/SVG), DXF outlines, or full 3MF projects. The app figures out what kind of file you handed it.
- **Multi-color 3MF export** with part names that Bambu Studio and OrcaSlicer pick up for automatic filament assignment.
- **3MF round-trip** — the same file you send to the slicer can be dragged back in and rehydrated as an editable project, including the original uploaded assets.
- **Auto-save to localStorage** — refresh, crash, or close the tab; your work is still there when you come back.

## Try it

1. Open **https://techfoundrynz.github.io/grippysheet-studio**.
2. Pick a deck outline in the **Base** tab.
3. Either tile a pattern (**Geometry** tab) or drop an image into the **ColorFlow** tab.
4. Hit **Export 3MF** and load it into your slicer.

## Keyboard shortcuts

Shortcuts work whenever a text field isn't focused.

```
2 / 3     Toggle 2D / 3D viewer
O         Orthographic camera (3D only)
I         Isometric camera (3D only)
F         Toggle FPS counter
Esc       Close the active dialog or context menu
```

Right-click the viewer for a context menu (screenshot, reset view, common toggles).

## For developers

React 19 + TypeScript + Vite, Three.js via `@react-three/fiber`, Tailwind for the UI, Zod for settings schemas, JSZip for project + 3MF I/O, Vitest for tests. The heavy work (image quantize / trace / extrude for ColorFlow, CSG cuts for pattern mode) runs in a Web Worker so the main thread stays responsive.

```bash
pnpm install     # install dependencies
pnpm dev         # start the Vite dev server
pnpm test:run    # run the Vitest suite (ColorFlow pipeline only — no React tests)
pnpm build       # type-check + production build into dist/
pnpm deploy:gh   # publish dist/ to the gh-pages branch
```

A few things worth knowing before you touch the code:

- **React Compiler is on** (target 19). Don't sprinkle `useMemo` / `useCallback` for perf — the compiler handles memoization. Existing memos exist because of referential-identity requirements (Three.js objects shared across effects), not as a habit.
- **The ColorFlow pipeline lives in `src/colorflow/worker.ts`** and is driven from the main thread via `useColorFlowWorker`. Pure modules under `src/colorflow/` are the only things with unit tests.
- **Mesh names are load-bearing** for export — `Base`, `Pattern`, `InlayGroup`, and the `Debug_` / `Inlay_` / `Color_` prefixes get looked up by string. Don't rename without an audit.
- **Tests cover the ColorFlow pipeline, not the UI.** UI changes get verified by running `pnpm dev`.

Deeper architecture notes — state shape, the imperative model factory, the export pipeline, the processing-overlay protocol, the ColorFlow stack model — live in [`CLAUDE.md`](./CLAUDE.md).

## Contributing

- Open an issue before starting on anything big so we can sketch out the design together.
- Keep commits focused; messages follow a loose conventional style (look at `git log` for examples).
- `pnpm test:run` and `pnpm build` should both pass before you open a PR.
- If you're adding a new setting, extend the Zod schema in `src/types/schemas.ts` (or `src/colorflow/schema.ts`) — defaults flow from there.

## License

No license file is present yet. Until one is added, no permissions are granted beyond viewing the source. If you'd like to fork, remix, or redistribute, please open an issue so we can sort out a license.

## Credits

Built by Siwoz.
