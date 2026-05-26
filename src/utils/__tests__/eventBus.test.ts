import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  eventBus,
  emitFileDrop,
  emitToast,
  emitOpenOutlineLibrary,
  emitSetActiveTab,
  emitInlayTransform,
  consumePendingFileDrop,
  type ToastEvent,
  type FileDropEvent,
  type InlayTransformEvent,
} from '../eventBus';

// ---------------------------------------------------------------------------
// Test environment shim
// ---------------------------------------------------------------------------
// `eventBus.ts` calls `window.setTimeout` / `window.clearTimeout` for the
// file-drop replay buffer. The vitest config uses environment: 'node' so
// `window` does not exist — install a minimal shim that forwards to the
// global timers (overridable by vi.useFakeTimers()).

type WindowLike = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

const g = globalThis as unknown as { window?: WindowLike };
if (typeof g.window === 'undefined') {
  g.window = {
    setTimeout: ((...args: Parameters<typeof setTimeout>) => setTimeout(...args)) as typeof setTimeout,
    clearTimeout: ((...args: Parameters<typeof clearTimeout>) => clearTimeout(...args)) as typeof clearTimeout,
  };
}

// ---------------------------------------------------------------------------
// Listener cleanup helper
// ---------------------------------------------------------------------------
// The bus is a module-level singleton. Each test collects its unsubscribers
// here and `afterEach` flushes them so listener state never leaks across
// tests. We also drain any leftover pending file-drop buffer.

let unsubs: Array<() => void> = [];

function sub<K extends Parameters<typeof eventBus.on>[0]>(
  event: K,
  cb: Parameters<typeof eventBus.on<K>>[1],
): void {
  const off = eventBus.on(event, cb);
  unsubs.push(off);
}

beforeEach(() => {
  unsubs = [];
});

afterEach(() => {
  unsubs.forEach((off) => off());
  unsubs = [];
  // Drain any pending file-drop the test left behind.
  consumePendingFileDrop();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// on / off / _emit dispatch ordering
// ---------------------------------------------------------------------------

describe('eventBus.on', () => {
  it('returns an unsubscriber that detaches the listener', () => {
    const cb = vi.fn();
    const off = eventBus.on('toast', cb);
    unsubs.push(off); // safety net if assertion fails

    emitToast({ message: 'hi' });
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    emitToast({ message: 'bye' });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('dispatches to all current subscribers in subscription order', () => {
    const order: string[] = [];
    sub('toast', () => order.push('a'));
    sub('toast', () => order.push('b'));
    sub('toast', () => order.push('c'));

    emitToast({ message: 'go' });
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('does not fire a newly-subscribed listener for the in-flight event', () => {
    // _emit copies the listener array before iterating, so a listener that
    // subscribes during dispatch must not see the current event.
    const lateCb = vi.fn();
    sub('toast', () => {
      sub('toast', lateCb);
    });

    emitToast({ message: 'first' });
    expect(lateCb).not.toHaveBeenCalled();

    emitToast({ message: 'second' });
    // The "first" emit registered one late listener; the "second" emit
    // registered another. Each of those late listeners should fire on the
    // subsequent emits, so on this second emit the first late listener
    // (registered during the first emit) should fire exactly once.
    expect(lateCb).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// emitFileDrop replay buffer
// ---------------------------------------------------------------------------

describe('emitFileDrop / consumePendingFileDrop', () => {
  // Minimal stand-in — `File` exists in node 20+ but we only need an
  // object the bus will pass through opaquely.
  const fakeFile = { name: 'thing.png' } as unknown as File;

  it('buffers the most recent drop so a late subscriber can claim it', () => {
    emitFileDrop({ kind: 'image:colorflow', file: fakeFile });
    const claimed = consumePendingFileDrop();
    expect(claimed).not.toBeNull();
    expect(claimed?.kind).toBe('image:colorflow');
    // And buffer is cleared after consumption.
    expect(consumePendingFileDrop()).toBeNull();
  });

  it('filters by expectedKind — returns null when buffered kind differs', () => {
    emitFileDrop({ kind: 'shape:base', file: fakeFile });
    const claimed = consumePendingFileDrop('image:colorflow');
    expect(claimed).toBeNull();
    // The buffer is NOT cleared on filter mismatch — the right subscriber
    // can still pick it up on their next mount.
    const correct = consumePendingFileDrop('shape:base');
    expect(correct?.kind).toBe('shape:base');
  });

  it('auto-expires the buffered drop after 1.5s', () => {
    vi.useFakeTimers();
    emitFileDrop({ kind: 'image:colorflow', file: fakeFile });
    vi.advanceTimersByTime(1499);
    expect(consumePendingFileDrop()).not.toBeNull();

    // Re-emit then let the full timeout fire.
    emitFileDrop({ kind: 'image:colorflow', file: fakeFile });
    vi.advanceTimersByTime(1500);
    expect(consumePendingFileDrop()).toBeNull();
  });

  it('also dispatches synchronously to live subscribers (buffer is a backup, not the primary path)', () => {
    const cb = vi.fn();
    sub('file-drop', cb);
    const event: FileDropEvent = { kind: 'shape:base', file: fakeFile };
    emitFileDrop(event);
    expect(cb).toHaveBeenCalledWith(event);
  });
});

// ---------------------------------------------------------------------------
// Toast default tone
// ---------------------------------------------------------------------------

describe('emitToast', () => {
  it("defaults tone to 'ready' when omitted", () => {
    const received: ToastEvent[] = [];
    sub('toast', (e) => received.push(e));
    emitToast({ message: 'saved', detail: 'project.3mf' });
    expect(received).toHaveLength(1);
    expect(received[0].tone).toBe('ready');
    expect(received[0].message).toBe('saved');
    expect(received[0].detail).toBe('project.3mf');
  });

  it('respects an explicitly provided tone', () => {
    const received: ToastEvent[] = [];
    sub('toast', (e) => received.push(e));
    emitToast({ message: 'oops', tone: 'error' });
    expect(received[0].tone).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Void-payload emitters
// ---------------------------------------------------------------------------

describe('void-payload emitters', () => {
  it('emitOpenOutlineLibrary fires subscribers without payload', () => {
    const cb = vi.fn();
    sub('open-outline-library', cb);
    emitOpenOutlineLibrary();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(undefined);
  });

  it('emitSetActiveTab passes through the tab id', () => {
    const cb = vi.fn();
    sub('set-active-tab', cb);
    emitSetActiveTab('colorflow');
    expect(cb).toHaveBeenCalledWith({ tab: 'colorflow' });
  });

  it('emitInlayTransform passes through the transform payload', () => {
    const received: InlayTransformEvent[] = [];
    sub('inlay-transform', (e) => received.push(e));
    emitInlayTransform({ id: 'a', x: 5, y: 10, rotation: 0.5, scale: 1.2 });
    expect(received[0]).toEqual({ id: 'a', x: 5, y: 10, rotation: 0.5, scale: 1.2 });
  });
});
