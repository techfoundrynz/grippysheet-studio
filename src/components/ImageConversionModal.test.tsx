import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageConversionModal from './ImageConversionModal';
import { loadDownsampledImage } from '../utils/imageUtils';
import { MAX_DITHER_DETAIL } from '../utils/image/ditherImage';

vi.mock('../utils/imageUtils', () => ({ loadDownsampledImage: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('image inlay conversion controls', () => {
  it('loads a higher resolution source and commits only the selected fill colour', async () => {
    vi.mocked(loadDownsampledImage).mockResolvedValue({
      width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
    });
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ImageConversionModal isOpen imageUrl="data:image/png;base64,test" fileName="photo.png" onConfirm={onConfirm} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Image conversion mode'), { target: { value: 'dither' } });
    await waitFor(() => expect(loadDownsampledImage).toHaveBeenLastCalledWith('data:image/png;base64,test', MAX_DITHER_DETAIL));
    fireEvent.change(screen.getByLabelText('Dithering method'), { target: { value: 'bayer8' } });
    fireEvent.change(screen.getByLabelText('Dither fill colour'), { target: { value: '#ff6600' } });
    fireEvent.change(screen.getByLabelText(/Pixel detail/), { target: { value: '480' } });
    expect(screen.getByText('480 pixels on longest edge')).toBeTruthy();

    await waitFor(() => expect((screen.getByRole('button', { name: 'Add Inlay' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Add Inlay' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    const [shapes, name, svg] = onConfirm.mock.calls[0];
    expect(name).toBe('photo.png');
    expect(shapes).toHaveLength(1);
    expect(shapes[0].color).toBe('#ff6600');
    expect(svg).toContain('fill="#ff6600"');
    expect(svg).not.toContain('#ffffff');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
