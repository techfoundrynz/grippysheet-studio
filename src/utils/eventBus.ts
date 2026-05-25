type Listener = (data: any) => void;

class EventBus {
    private listeners: { [key: string]: Listener[] } = {};

    on(event: string, callback: Listener) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
        return () => this.off(event, callback);
    }

    off(event: string, callback: Listener) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    emit(event: string, data: any) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(cb => cb(data));
    }
}

export const eventBus = new EventBus();

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

export function emitProcessing(event: ProcessingEvent) {
    eventBus.emit('processing', event);
}

/**
 * Toast-feedback protocol. Lightweight ephemeral confirmation for actions
 * that don't open a modal but the user still benefits from "I did the thing"
 * acknowledgement — reset, project save, screenshot capture, etc.
 */
export interface ToastEvent {
    /** Headline displayed in the toast pill. */
    message: string;
    /** Optional second line — file name, count, etc. */
    detail?: string;
    /** Visual treatment. `ready` = neon-green confirm; `info` = cyan; `error` = red. */
    tone?: 'ready' | 'info' | 'error';
}

export function emitToast(event: ToastEvent) {
    eventBus.emit('toast', event);
}

/**
 * Canvas-to-controls file-drop bridge. When a user drops a file onto the
 * viewer (instead of into the right-panel dropzone), the viewer emits
 * this event so the appropriate control panel can claim the file.
 *
 *   `image:colorflow`  → ColorFlowControls hydrates it as the trace source
 *   `shape:base`       → BaseControls hydrates it as the deck outline
 *
 * App-level state is also responsible for switching the active tab when
 * the kind tells us which surface should now be focused.
 */
export interface FileDropEvent {
    file: File;
    kind: 'image:colorflow' | 'shape:base';
}

// Tab panels are wrapped in <Freeze> so an inactive panel hasn't mounted
// its `file-drop` subscriber yet. When the very first drop on a fresh page
// fires, the relevant subscriber hasn't run its useEffect. We buffer the
// latest drop here so the subscriber can replay it on mount via
// `consumePendingFileDrop`. The buffer auto-expires so a stale drop doesn't
// re-fire much later from an unrelated tab switch.
let pendingFileDrop: FileDropEvent | null = null;
let pendingFileDropTimer: number | null = null;

export function emitFileDrop(event: FileDropEvent) {
    pendingFileDrop = event;
    if (pendingFileDropTimer !== null) window.clearTimeout(pendingFileDropTimer);
    pendingFileDropTimer = window.setTimeout(() => {
        if (pendingFileDrop === event) pendingFileDrop = null;
        pendingFileDropTimer = null;
    }, 1500);
    eventBus.emit('file-drop', event);
}

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

/**
 * Viewer-to-controls bridge: opens the Outline Library picker on the
 * Base tab. Emitted by the viewer's right-click context menu so the
 * user can jump straight from the 3D canvas to picking a deck shape
 * without hunting for the tab. BaseControls subscribes to flip its
 * own `showLibrary` state; App subscribes to switch the active tab.
 */
export function emitOpenOutlineLibrary() {
    eventBus.emit('open-outline-library', {});
}

/**
 * Imperatively switch the right-panel active tab from anywhere in the
 * tree. Used by the viewer context menu's "Open Library" item so the
 * user lands on the Base tab as the library modal opens.
 */
export type AppTab = 'base' | 'inlay' | 'colorflow' | 'geometry';
export function emitSetActiveTab(tab: AppTab) {
    eventBus.emit('set-active-tab', { tab });
}
