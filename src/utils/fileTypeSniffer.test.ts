import { describe, it, expect } from 'vitest';
import { detectAssetType } from './fileTypeSniffer';

describe('fileTypeSniffer utility', () => {
  const encoder = new TextEncoder();

  it('trusts extension if present in filename', () => {
    const emptyBuffer = new ArrayBuffer(0);
    expect(detectAssetType(emptyBuffer, 'test.stl')).toBe('stl');
    expect(detectAssetType(emptyBuffer, 'test.DXF')).toBe('dxf');
    expect(detectAssetType(emptyBuffer, 'test.svg')).toBe('svg');
    expect(detectAssetType(emptyBuffer, 'path/to/somefile.stl')).toBe('stl');
  });

  it('detects SVG content by sniffing XML/SVG tags', () => {
    const svgContent = encoder.encode('  <svg xmlns="http://www.w3.org/2000/svg"></svg>').buffer;
    expect(detectAssetType(svgContent, 'unknown-file')).toBe('svg');

    const xmlContent = encoder.encode('<?xml version="1.0"?><g></g>').buffer;
    expect(detectAssetType(xmlContent, 'unknown-file')).toBe('svg');
  });

  it('detects ASCII STL content starting with solid', () => {
    const stlContent = encoder.encode('solid MyModel\nfacet normal ...').buffer;
    expect(detectAssetType(stlContent, 'unknown-file')).toBe('stl');
  });

  it('detects DXF content starting with SECTION, 0, or 999', () => {
    const dxfSection = encoder.encode('SECTION\nHEADER\n  0').buffer;
    expect(detectAssetType(dxfSection, 'unknown-file')).toBe('dxf');

    const dxfZero = encoder.encode('0\nSECTION\n  2').buffer;
    expect(detectAssetType(dxfZero, 'unknown-file')).toBe('dxf');

    const dxf999 = encoder.encode('999\ncomment here\n  0').buffer;
    expect(detectAssetType(dxf999, 'unknown-file')).toBe('dxf');
  });

  it('detects binary STL by searching for null bytes in buffer', () => {
    const binaryBuffer = new Uint8Array(100);
    binaryBuffer[0] = 80;
    binaryBuffer[20] = 0; // null byte
    expect(detectAssetType(binaryBuffer.buffer, 'unknown-file')).toBe('stl');
  });

  it('falls back to dxf if content cannot be determined and is not binary', () => {
    const randomText = encoder.encode('random text content without matching markers').buffer;
    expect(detectAssetType(randomText, 'unknown-file')).toBe('dxf');
  });
});
