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
