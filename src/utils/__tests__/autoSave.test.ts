import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveAutoSnapshot, loadAutoSnapshot, clearAutoSnapshot, flushAutoSnapshot } from '../autoSave';
import { ProjectSchema, type ProjectDataV2 } from '../../types/schemas';

// ---------------------------------------------------------------------------
// Storage / window shims
// ---------------------------------------------------------------------------
// `autoSave.ts` reaches for `localStorage`, `window.setTimeout`, and
// `window.clearTimeout`. The vitest config uses environment: 'node' so
// none of those exist — install in-memory shims here. The localStorage
// shim is reinstalled fresh per test so writes never leak.

const STORAGE_KEY = 'grippy_autosave_v1';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

type WindowLike = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

const g = globalThis as unknown as {
  window?: WindowLike;
  localStorage?: Storage;
};

if (typeof g.window === 'undefined') {
  g.window = {
    setTimeout: ((...args: Parameters<typeof setTimeout>) => setTimeout(...args)) as typeof setTimeout,
    clearTimeout: ((...args: Parameters<typeof clearTimeout>) => clearTimeout(...args)) as typeof clearTimeout,
  };
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeValidProject(): ProjectDataV2 {
  return ProjectSchema.parse({
    version: 2,
    timestamp: 1234,
    mode: 'pattern',
    base: {},
    inlay: {},
    geometry: {},
  });
}

// ---------------------------------------------------------------------------
// Lifecycle: fresh in-memory storage per test, clear timers cleanly.
// ---------------------------------------------------------------------------

beforeEach(() => {
  g.localStorage = new MemoryStorage();
  // Make sure no debounced write leaks between tests.
  flushAutoSnapshot();
  (g.localStorage as Storage).removeItem(STORAGE_KEY);
});

afterEach(() => {
  // If a test was running with fake timers, make sure pending writes
  // can complete on real timers before the next test starts.
  vi.useRealTimers();
  flushAutoSnapshot();
});

// ---------------------------------------------------------------------------
// saveAutoSnapshot — debounced write
// ---------------------------------------------------------------------------

describe('saveAutoSnapshot', () => {
  it('writes a JSON snapshot to localStorage after the debounce window', () => {
    vi.useFakeTimers();
    const project = makeValidProject();
    saveAutoSnapshot({ project });

    // Nothing yet — debounce is 500ms.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    vi.advanceTimersByTime(500);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.project.version).toBe(2);
    expect(typeof parsed.savedAt).toBe('number');
  });

  it('coalesces rapid calls within the debounce window into a single write', () => {
    vi.useFakeTimers();
    // `Storage` isn't a global in node, so spy on the shim instance directly.
    const setSpy = vi.spyOn(g.localStorage as Storage, 'setItem');
    const project = makeValidProject();

    saveAutoSnapshot({ project });
    vi.advanceTimersByTime(100);
    saveAutoSnapshot({ project });
    vi.advanceTimersByTime(100);
    saveAutoSnapshot({ project });
    vi.advanceTimersByTime(100);
    saveAutoSnapshot({ project });

    // Nothing has fired yet because each call reset the timer.
    expect(setSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(setSpy).toHaveBeenCalledTimes(1);
    setSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// loadAutoSnapshot — happy path + corruption recovery
// ---------------------------------------------------------------------------

describe('loadAutoSnapshot', () => {
  it('returns the parsed payload when the storage has a valid v2 schema', () => {
    const project = makeValidProject();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ project, savedAt: 999 }));

    const loaded = loadAutoSnapshot();
    expect(loaded).not.toBeNull();
    expect(loaded?.savedAt).toBe(999);
    expect(loaded?.project.version).toBe(2);
    expect(loaded?.project.mode).toBe('pattern');
  });

  it('returns null AND clears the key when the storage has corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(loadAutoSnapshot()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('returns null AND clears the key when the schema does not match', () => {
    // Swallow the expected validation warning so it doesn't pollute test output.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        project: { version: 0, timestamp: 1, base: {}, inlay: {}, geometry: {} },
        savedAt: 1,
      }),
    );
    expect(loadAutoSnapshot()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    warnSpy.mockRestore();
  });

  it('returns null without throwing when storage is empty', () => {
    expect(loadAutoSnapshot()).toBeNull();
  });

  it('returns null and clears when the wrapper is structurally wrong (no savedAt)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ project: {} }));
    expect(loadAutoSnapshot()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clearAutoSnapshot
// ---------------------------------------------------------------------------

describe('clearAutoSnapshot', () => {
  it('removes the autosave key from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, 'whatever');
    clearAutoSnapshot();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('is safe to call when nothing is stored', () => {
    expect(() => clearAutoSnapshot()).not.toThrow();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
