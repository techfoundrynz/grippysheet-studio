import { ProjectSchema, type ProjectDataV2 } from '../types/schemas';

/**
 * Browser-local auto-save: pushes the current project settings into
 * `localStorage` on every meaningful change so a tab refresh / accidental
 * close doesn't nuke the user's work. Restored on next visit via the
 * Resume banner.
 *
 * Important constraints:
 *
 *  - **Settings only.** We deliberately do NOT persist `projectAssets`
 *    (the raw uploaded DXF / SVG / image bytes). They'd easily exceed
 *    the 5–10 MB localStorage quota and stringifying ArrayBuffers is
 *    a footgun. The restore flow tells the user to re-upload — the
 *    settings alone (size, palette, transforms, etc.) are 90% of the
 *    "where was I" value.
 *
 *  - **Runtime shapes stripped.** Live `THREE.Shape` / `THREE.Mesh`
 *    instances aren't JSON-safe. The caller is expected to pass a
 *    `ProjectDataV2` with `base.cutoutShapes` / `geometry.patternShapes`
 *    already nulled — same contract as the 3MF sidecar writer.
 *
 *  - **Quota-safe.** A `QuotaExceededError` shouldn't crash the app;
 *    we warn and bail. The next legitimate save attempt will retry.
 *
 *  - **Debounced.** Settings churn during slider drags; the debounce
 *    coalesces a burst of updates into a single write. The wrapper
 *    holds a module-local timer rather than letting each caller wire
 *    up their own `useEffect` cleanup logic.
 */

const STORAGE_KEY = 'grippy_autosave_v1';
const DEBOUNCE_MS = 500;

export interface AutoSaveSnapshot {
  project: ProjectDataV2;
  /** Unix ms timestamp of when the snapshot hit storage. */
  savedAt: number;
}

let debounceTimer: number | null = null;
let pendingSnapshot: AutoSaveSnapshot | null = null;

function writeNow(snapshot: AutoSaveSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    // QuotaExceededError on Safari has name 'QUOTA_EXCEEDED_ERR' (legacy)
    // or 'QuotaExceededError'. We treat any storage failure the same way:
    // warn once, drop the write, keep the app running.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[autoSave] failed to write snapshot:', err);
    }
  }
}

/**
 * Schedule a snapshot write. Coalesces rapid calls within `DEBOUNCE_MS`
 * into a single localStorage hit. Safe to call from a React effect.
 */
export function saveAutoSnapshot(payload: { project: ProjectDataV2 }): void {
  pendingSnapshot = {
    project: payload.project,
    savedAt: Date.now(),
  };
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    if (pendingSnapshot) {
      writeNow(pendingSnapshot);
      pendingSnapshot = null;
    }
  }, DEBOUNCE_MS);
}

/**
 * Read and validate the last persisted snapshot. Returns `null` if
 * nothing's stored, the JSON is corrupt, or the payload fails the
 * current Zod schema — in the latter cases we also remove the bad
 * entry so we don't loop on it forever.
 *
 * Note: import errors (post-restore, e.g. asset missing) are handled
 * by the caller. We deliberately do NOT clear the snapshot in those
 * cases so the user can retry — only schema/JSON corruption clears.
 */
export function loadAutoSnapshot(): AutoSaveSnapshot | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[autoSave] failed to read snapshot:', err);
    }
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearAutoSnapshot();
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    clearAutoSnapshot();
    return null;
  }
  const wrapped = parsed as { project?: unknown; savedAt?: unknown };
  if (typeof wrapped.savedAt !== 'number' || !wrapped.project) {
    clearAutoSnapshot();
    return null;
  }

  const projectParse = ProjectSchema.safeParse(wrapped.project);
  if (!projectParse.success) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[autoSave] snapshot failed schema validation, clearing:', projectParse.error.message);
    }
    clearAutoSnapshot();
    return null;
  }

  return { project: projectParse.data, savedAt: wrapped.savedAt };
}

/** Explicitly drop the snapshot — used by "Start fresh" in the banner. */
export function clearAutoSnapshot(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore — we can't do anything useful here.
  }
}

/**
 * Force any pending debounced write to flush immediately. Exposed for
 * tests + future "Save now" UX (e.g. before navigating away).
 */
export function flushAutoSnapshot(): void {
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (pendingSnapshot) {
    writeNow(pendingSnapshot);
    pendingSnapshot = null;
  }
}
