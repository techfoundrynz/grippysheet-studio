/**
 * Strongly-typed event bus. Adding a new event is a two-step process:
 *   1. Extend `EventMap` below with the event name → payload type.
 *   2. Add an `emit*` helper next to the payload's interface.
 *
 * Subscribers go through `eventBus.on(name, cb)` and get the payload type
 * automatically narrowed from `EventMap` — no inline casts, no shape
 * duplication. `emit` is private to the bus instance so all publishes must
 * route through the typed `emit*` helpers exported below, keeping ad-hoc
 * `eventBus.emit('whatever', { ... })` calls out of the codebase.
 */

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

/**
 * Processing-state protocol. Any heavy async/sync work in the app should emit
 * `processing` events with a unique `key` + busy boolean. The 3D viewer
 * subscribes and shows a spinner overlay if at least one key is active.
 */
export interface ProcessingEvent {
    key: string;
    busy: boolean;
    label?: string;
}

/**
 * Toast-feedback protocol. Lightweight ephemeral confirmation for actions
 * that don't open a modal but the user still benefits from "I did the thing"
 * acknowledgement — reset, project save, screenshot capture, etc.
 *
 * `tone` defaults to `'ready'` if the emitter omits it; the helper below
 * resolves the default so subscribers always see a concrete tone and don't
 * have to branch on `undefined`.
 */
export interface ToastEvent {
    /** Headline displayed in the toast pill. */
    message: string;
    /** Optional second line — file name, count, etc. */
    detail?: string;
    /** Visual treatment. `ready` = neon-green confirm; `info` = cyan; `error` = red. */
    tone: 'ready' | 'info' | 'error';
}

/**
 * Canvas-to-controls file-drop bridge. When a user drops a file onto the
 * viewer (instead of into the right-panel dropzone), the viewer emits
 * this event so the appropriate control panel can claim the file.
 *
 *   `image:colorflow`  → ColorFlowControls hydrates it as the trace source
 *   `shape:base`       → BaseControls hydrates it as the deck outline
 *
 * Discriminated by `kind` so consumers can `switch` and the type narrows
 * to the right arm.
 */
export type FileDropEvent =
    | { kind: 'image:colorflow'; file: File }
    | { kind: 'shape:base'; file: File };

/** Right-panel tab identifier — also used by `set-active-tab` payloads. */
export type AppTab = 'base' | 'inlay' | 'colorflow' | 'geometry';

/** Inlay direct-manipulation handles broadcast their drag state via the bus
 *  so `ImperativeModel` can render a live preview without committing to
 *  state every frame. Promoted out of the historic untyped ad-hoc emit. */
export interface InlayTransformEvent {
    id: string;
    x: number;
    y: number;
    rotation?: number;
    scale?: number;
}

/** Fired when the canvas-drop project loader (or future "Open" surfaces)
 *  has parsed a `.3mf` or legacy `.zip` and is ready to hand the payload
 *  to App-level state. Decoupled from `file-drop` because project loads
 *  are async + the parsing happens off the canvas surface. */
export interface ProjectLoadedEvent {
    data: import('../types/schemas').ProjectDataV2;
    assets: import('./projectUtils').ProjectAssets;
}

/**
 * The central event map. Adding a new event without extending this becomes
 * a TS error at the emit-helper definition site.
 */
export interface EventMap {
    'processing': ProcessingEvent;
    'toast': ToastEvent;
    'file-drop': FileDropEvent;
    'open-outline-library': void;
    'set-active-tab': { tab: AppTab };
    'inlay-transform': InlayTransformEvent;
    'project-loaded': ProjectLoadedEvent;
}

// ---------------------------------------------------------------------------
// Bus implementation
// ---------------------------------------------------------------------------

type Listener<K extends keyof EventMap> = (data: EventMap[K]) => void;

class EventBus {
    // Internal storage stays loosely-typed for the listener cast at dispatch
    // time, but the public surface (on/emit) is parameterized by EventMap.
    private listeners: { [K in keyof EventMap]?: Listener<K>[] } = {};

    on<K extends keyof EventMap>(event: K, callback: Listener<K>): () => void {
        const arr = (this.listeners[event] ?? []) as Listener<K>[];
        arr.push(callback);
        this.listeners[event] = arr as never;
        return () => this.off(event, callback);
    }

    off<K extends keyof EventMap>(event: K, callback: Listener<K>): void {
        const arr = this.listeners[event] as Listener<K>[] | undefined;
        if (!arr) return;
        this.listeners[event] = arr.filter((cb) => cb !== callback) as never;
    }

    /** @internal — module-private; do not call directly. Use the `emit*`
     *  helpers below so every publish goes through a typed entry point. */
    _emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
        const arr = this.listeners[event] as Listener<K>[] | undefined;
        if (!arr) return;
        // Copy before iterating in case a listener subscribes/unsubscribes.
        [...arr].forEach((cb) => cb(data));
    }
}

export const eventBus = new EventBus();

// ---------------------------------------------------------------------------
// Typed emitters — the only sanctioned way to publish
// ---------------------------------------------------------------------------

export function emitProcessing(event: ProcessingEvent): void {
    eventBus._emit('processing', event);
}

/** Emit a toast. `tone` defaults to `'ready'` when omitted. */
export function emitToast(event: { message: string; detail?: string; tone?: ToastEvent['tone'] }): void {
    eventBus._emit('toast', { tone: 'ready', ...event });
}

export function emitFileDrop(event: FileDropEvent): void {
    pendingFileDrop = event;
    if (pendingFileDropTimer !== null) window.clearTimeout(pendingFileDropTimer);
    pendingFileDropTimer = window.setTimeout(() => {
        if (pendingFileDrop === event) pendingFileDrop = null;
        pendingFileDropTimer = null;
    }, 1500);
    eventBus._emit('file-drop', event);
}

export function emitOpenOutlineLibrary(): void {
    eventBus._emit('open-outline-library', undefined);
}

export function emitSetActiveTab(tab: AppTab): void {
    eventBus._emit('set-active-tab', { tab });
}

export function emitInlayTransform(event: InlayTransformEvent): void {
    eventBus._emit('inlay-transform', event);
}

export function emitProjectLoaded(event: ProjectLoadedEvent): void {
    eventBus._emit('project-loaded', event);
}

// ---------------------------------------------------------------------------
// File-drop replay buffer — see the `<Freeze>` race discussion in
// `BaseControls.tsx` / `ColorFlowControls.tsx` drop subscribers.
// ---------------------------------------------------------------------------

let pendingFileDrop: FileDropEvent | null = null;
let pendingFileDropTimer: number | null = null;

/**
 * Subscribers call this on mount to claim any in-flight drop that fired
 * before they had a chance to subscribe (e.g. first drop after page load,
 * when the inactive tab panel was Frozen). Returns the buffered event and
 * clears it so two subscribers can't both consume the same file.
 *
 *   `expectedKind` lets the caller filter — pass the kind it handles so
 *   a Base subscriber doesn't accidentally consume an image-targeted drop.
 */
export function consumePendingFileDrop(expectedKind?: FileDropEvent['kind']): FileDropEvent | null {
    const e = pendingFileDrop;
    if (!e) return null;
    if (expectedKind && e.kind !== expectedKind) return null;
    pendingFileDrop = null;
    if (pendingFileDropTimer !== null) {
        window.clearTimeout(pendingFileDropTimer);
        pendingFileDropTimer = null;
    }
    return e;
}
