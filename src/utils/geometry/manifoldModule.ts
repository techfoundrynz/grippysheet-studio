import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
// Vite resolves this to the emitted/served wasm URL (hashed in prod, dev URL in dev).
import wasmUrl from 'manifold-3d/manifold.wasm?url';

/**
 * Lazily initialize the Manifold WASM module exactly once and cache the promise.
 * Manifold ops are synchronous, but the module must be loaded + `setup()` run first.
 *
 * In the browser/worker we must tell Emscripten where the wasm lives via `locateFile`:
 * otherwise its internal `new URL('manifold.wasm', import.meta.url)` misses and the Vite
 * dev server answers with index.html (wrong MIME -> "expected magic word" compile error).
 * In Node (vitest) the default loader reads the file from node_modules, so we skip it.
 */
let modulePromise: Promise<ManifoldToplevel> | null = null;

export function getManifold(): Promise<ManifoldToplevel> {
  if (!modulePromise) {
    const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
    const isNode = !!proc?.versions?.node;
    const config = isNode ? undefined : { locateFile: () => wasmUrl };
    modulePromise = Module(config).then((wasm) => {
      wasm.setup();
      return wasm;
    });
  }
  return modulePromise;
}
