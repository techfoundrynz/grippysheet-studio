import { describe, it, expect, vi } from 'vitest';
import { eventBus } from './eventBus';

describe('eventBus utility', () => {
  it('registers listener and emits events with payload', () => {
    const callback = vi.fn();
    eventBus.on('test-event', callback);

    eventBus.emit('test-event', { message: 'hello' });
    expect(callback).toHaveBeenCalledWith({ message: 'hello' });
  });

  it('unregisters listener using off', () => {
    const callback = vi.fn();
    eventBus.on('test-event-off', callback);
    eventBus.off('test-event-off', callback);

    eventBus.emit('test-event-off', 'data');
    expect(callback).not.toHaveBeenCalled();
  });

  it('unregisters listener using the returned unsubscribe function', () => {
    const callback = vi.fn();
    const unsubscribe = eventBus.on('test-event-unsub', callback);
    unsubscribe();

    eventBus.emit('test-event-unsub', 'data');
    expect(callback).not.toHaveBeenCalled();
  });

  it('handles multiple listeners for same event', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    eventBus.on('multi-event', cb1);
    eventBus.on('multi-event', cb2);

    eventBus.emit('multi-event', 'data');
    expect(cb1).toHaveBeenCalledWith('data');
    expect(cb2).toHaveBeenCalledWith('data');
  });

  it('handles emitting events with no listeners', () => {
    expect(() => eventBus.emit('non-existent-event', 'data')).not.toThrow();
  });

  it('handles off for non-existent events', () => {
    const callback = vi.fn();
    expect(() => eventBus.off('non-existent-event-off', callback)).not.toThrow();
  });
});
