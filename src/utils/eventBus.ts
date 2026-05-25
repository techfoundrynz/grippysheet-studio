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

export function emitFileDrop(event: FileDropEvent) {
    eventBus.emit('file-drop', event);
}
