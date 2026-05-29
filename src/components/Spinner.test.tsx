import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Spinner from './Spinner';

describe('Spinner Component', () => {
  it('renders correctly with default props', () => {
    const { container } = render(<Spinner />);
    const spinnerDiv = container.firstChild as HTMLElement;
    expect(spinnerDiv).not.toBeNull();
    expect(spinnerDiv.className).toContain('animate-spin');
  });

  it('applies custom className and size', () => {
    const { container } = render(<Spinner className="custom-class" size={32} />);
    const spinnerDiv = container.firstChild as HTMLElement;
    expect(spinnerDiv.className).toContain('custom-class');
    // Lucide Loader2 should have size 32
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('32');
  });
});
