import { describe, it, expect, vi } from 'vitest';
import { delay } from './delay';

describe('delay utility', () => {
  it('resolves after specified milliseconds', async () => {
    vi.useFakeTimers();
    const promise = delay(1000);
    
    // Fast-forward time
    vi.advanceTimersByTime(1000);
    
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
