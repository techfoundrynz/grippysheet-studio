import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import DebouncedInput from './DebouncedInput';

describe('DebouncedInput Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('renders with initial value', () => {
    render(<DebouncedInput value="initial" onChange={() => {}} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('initial');
  });

  it('updates local state immediately on change but delays calling onChange callback', () => {
    const handleChange = vi.fn();
    render(<DebouncedInput value="initial" onChange={handleChange} debounce={300} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    // Simulate input typing
    fireEvent.change(input, { target: { value: 'new-value' } });
    expect(input.value).toBe('new-value');
    expect(handleChange).not.toHaveBeenCalled();

    // Advance timer by 150ms (less than 300ms)
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(handleChange).not.toHaveBeenCalled();

    // Advance timer to 300ms
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(handleChange).toHaveBeenCalledWith('new-value');
  });

  it('updates internal value when initial value prop changes', () => {
    const { rerender } = render(<DebouncedInput value="first" onChange={() => {}} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('first');

    rerender(<DebouncedInput value="second" onChange={() => {}} />);
    expect(input.value).toBe('second');
  });
});
