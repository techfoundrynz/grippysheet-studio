
// Helper to sniff file type from buffer
export const detectAssetType = (buffer: ArrayBuffer, fileName: string): 'stl' | 'dxf' | 'svg' => {
    // 1. Trust extension if present
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.stl')) return 'stl';
    if (lowerName.endsWith('.dxf')) return 'dxf';
    if (lowerName.endsWith('.svg')) return 'svg';

    // 2. Sniff content
    const view = new DataView(buffer);
    const decoder = new TextDecoder('utf-8');

    // Check for Binary STL (80 bytes header + 4 byte count)
    // Hard to be 100% sure, but usually starts with arbitrary bytes. 
    // ASCII STL starts with "solid".
    // DXF starts with "  0" or "SECTION" (often with leading whitespace).
    // SVG starts with "<" or "<?xml".

    // Let's read the first few chars
    const firstChars = decoder.decode(buffer.slice(0, 100)).trim();

    if (firstChars.startsWith('<') || firstChars.includes('<svg')) return 'svg';
    if (firstChars.startsWith('solid')) return 'stl'; // ASCII STL
    if (firstChars.startsWith('SECTION') || firstChars.startsWith('0') || firstChars.startsWith('999')) return 'dxf';

    // Binary STL?
    // If it's not text-like, assume binary STL?
    // Or check if it contains null bytes which are rare in DXF/SVG?
    // Quick check for binary char:
    const uint8 = new Uint8Array(buffer.slice(0, 1024));
    let isBinary = false;
    for (let i = 0; i < uint8.length; i++) {
        if (uint8[i] === 0) { isBinary = true; break; }
    }

    if (isBinary) return 'stl';

    // Default fallback
    return 'dxf';
};
