import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AlertProvider, useAlert } from './AlertContext';

// Mock the AlertModal component to keep context testing focused
vi.mock('../components/AlertModal', () => {
  return {
    default: ({ isOpen, title, message, onClose }: any) => {
      if (!isOpen) return null;
      return (
        <div data-testid="alert-modal">
          <h1 data-testid="alert-title">{title}</h1>
          <p data-testid="alert-message">{message}</p>
          <button data-testid="alert-close" onClick={onClose}>
            Close
          </button>
        </div>
      );
    },
  };
});

// A dummy component to trigger showAlert
const TestComponent = ({ alertOptions }: { alertOptions: any }) => {
  const { showAlert } = useAlert();
  return (
    <button data-testid="trigger-btn" onClick={() => showAlert(alertOptions)}>
      Show Alert
    </button>
  );
};

describe('AlertContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('throws error when useAlert is used outside AlertProvider', () => {
    // Suppress console.error for expected error boundary test
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => render(<TestComponent alertOptions={{}} />)).toThrow(
      'useAlert must be used within an AlertProvider'
    );

    consoleError.mockRestore();
  });

  it('renders children correctly', () => {
    render(
      <AlertProvider>
        <div data-testid="child">Hello World</div>
      </AlertProvider>
    );

    expect(screen.queryByTestId('child')).not.toBeNull();
  });

  it('opens alert modal when showAlert is called', async () => {
    const alertOptions = {
      title: 'Success!',
      message: 'Your file has been exported.',
    };

    render(
      <AlertProvider>
        <TestComponent alertOptions={alertOptions} />
      </AlertProvider>
    );

    // Modal should not be visible initially
    expect(screen.queryByTestId('alert-modal')).toBeNull();

    // Click button to show alert
    const btn = screen.getByTestId('trigger-btn');
    act(() => {
      btn.click();
    });

    // Modal should be visible now
    expect(screen.queryByTestId('alert-modal')).not.toBeNull();
    expect(screen.getByTestId('alert-title').textContent).toBe('Success!');
    expect(screen.getByTestId('alert-message').textContent).toBe('Your file has been exported.');
  });

  it('closes alert modal after animation delay', async () => {
    const alertOptions = {
      title: 'Confirm',
      message: 'Are you sure?',
    };

    render(
      <AlertProvider>
        <TestComponent alertOptions={alertOptions} />
      </AlertProvider>
    );

    // Show alert
    act(() => {
      screen.getByTestId('trigger-btn').click();
    });
    expect(screen.queryByTestId('alert-modal')).not.toBeNull();

    // Close alert
    act(() => {
      screen.getByTestId('alert-close').click();
    });

    // The modal's isOpen prop becomes false, but it only unmounts after 300ms timeout in AlertContext
    expect(screen.queryByTestId('alert-modal')).toBeNull();

    // Run fake timers to clear options state
    act(() => {
      vi.advanceTimersByTime(300);
    });
  });
});
