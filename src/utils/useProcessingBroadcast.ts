import { useEffect } from 'react';
import { emitProcessing } from './eventBus';

/**
 * Broadcast a processing-state for the global spinner overlay. Pass a stable
 * `key` so concurrent sources don't overwrite each other. Emits busy=false on
 * unmount so the overlay clears even if the component goes away mid-work.
 */
export function useProcessingBroadcast(key: string, busy: boolean, label?: string) {
  useEffect(() => {
    emitProcessing({ key, busy, label });
    return () => {
      if (busy) emitProcessing({ key, busy: false });
    };
  }, [key, busy, label]);
}
