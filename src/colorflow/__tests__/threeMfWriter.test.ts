import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { build3MF } from '../threeMfWriter';

const cubeMesh = () => ({
  positions: new Float32Array([
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
    0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
  ]),
  indices: new Uint32Array([
    0, 1, 2,  0, 2, 3,
    4, 6, 5,  4, 7, 6,
  ]),
});

describe('build3MF', () => {
  it('produces a Blob with the expected zip entries', async () => {
    const blob = await build3MF([
      { name: 'base', mesh: cubeMesh() },
      { name: 'color_1_ff0000', mesh: cubeMesh() },
    ], 'footpad_assembly');
    expect(blob.size).toBeGreaterThan(100);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
    expect(zip.file('_rels/.rels')).toBeTruthy();
    expect(zip.file('3D/3dmodel.model')).toBeTruthy();
  });

  it('emits one <object> per mesh plus one assembly object', async () => {
    const blob = await build3MF([
      { name: 'base', mesh: cubeMesh() },
      { name: 'color_1', mesh: cubeMesh() },
      { name: 'color_2', mesh: cubeMesh() },
    ], 'assembly');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    // 3 meshes + 1 assembly = 4 <object> entries
    const objectMatches = xml.match(/<object\s/g) ?? [];
    expect(objectMatches.length).toBe(4);
    // Assembly references 3 components
    const componentMatches = xml.match(/<component\s/g) ?? [];
    expect(componentMatches.length).toBe(3);
    // <build> picks the assembly
    expect(xml).toMatch(/<build>\s*<item objectid="4"/);
  });

  it('escapes XML special chars in names', async () => {
    const blob = await build3MF([
      { name: 'a&b<c>"d\'e', mesh: cubeMesh() },
    ], 'parent<x>');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    expect(xml).toContain('a&amp;b&lt;c&gt;&quot;d&apos;e');
    expect(xml).toContain('parent&lt;x&gt;');
  });
});
