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
      { name: 'base', mesh: cubeMesh(), color: '#888888' },
      { name: 'color_1_ff0000', mesh: cubeMesh(), color: '#FF0000' },
    ], 'footpad_assembly');
    expect(blob.size).toBeGreaterThan(100);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
    expect(zip.file('_rels/.rels')).toBeTruthy();
    expect(zip.file('3D/3dmodel.model')).toBeTruthy();
  });

  it('emits one <object> per mesh plus one assembly object', async () => {
    const blob = await build3MF([
      { name: 'base', mesh: cubeMesh(), color: '#888888' },
      { name: 'color_1', mesh: cubeMesh(), color: '#FF0000' },
      { name: 'color_2', mesh: cubeMesh(), color: '#00FF00' },
    ], 'assembly');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    const objectMatches = xml.match(/<object\s/g) ?? [];
    expect(objectMatches.length).toBe(4);
    const componentMatches = xml.match(/<component\s/g) ?? [];
    expect(componentMatches.length).toBe(3);
    expect(xml).toMatch(/<build>\s*<item objectid="4"/);
  });

  it('escapes XML special chars in names', async () => {
    const blob = await build3MF([
      { name: 'a&b<c>"d\'e', mesh: cubeMesh(), color: '#FFFFFF' },
    ], 'parent<x>');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    expect(xml).toContain('a&amp;b&lt;c&gt;&quot;d&apos;e');
    expect(xml).toContain('parent&lt;x&gt;');
  });

  it('declares the material extension on <model> and emits <m:basematerials> with one entry per part', async () => {
    const blob = await build3MF([
      { name: 'base', mesh: cubeMesh(), color: '#888888' },
      { name: 'color_1_ff0000', mesh: cubeMesh(), color: '#FF0000' },
      { name: 'color_2_00ff00', mesh: cubeMesh(), color: '#00FF00' },
    ], 'footpad_assembly');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    // Namespace declared on <model>
    expect(xml).toMatch(/<model[^>]*xmlns:m="http:\/\/schemas\.microsoft\.com\/3dmanufacturing\/material\/2015\/02"/);
    // basematerials block exists with id="1"
    expect(xml).toMatch(/<m:basematerials\s+id="1">/);
    // One <m:base> per part, in part order
    expect(xml).toMatch(/<m:base\s+name="base"\s+displaycolor="#888888"\s*\/>/);
    expect(xml).toMatch(/<m:base\s+name="color_1_ff0000"\s+displaycolor="#FF0000"\s*\/>/);
    expect(xml).toMatch(/<m:base\s+name="color_2_00ff00"\s+displaycolor="#00FF00"\s*\/>/);
  });

  it('binds every <triangle> to its part\'s material index via pid/p1', async () => {
    const blob = await build3MF([
      { name: 'base', mesh: cubeMesh(), color: '#888888' },        // p1=0
      { name: 'color_1', mesh: cubeMesh(), color: '#FF0000' },     // p1=1
    ], 'assembly');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    // Every <triangle> in object id=1 (base) has pid="1" p1="0"
    const baseTriangles = xml.match(/<triangle [^/]*pid="1" p1="0"/g) ?? [];
    expect(baseTriangles.length).toBe(4); // cubeMesh has 4 triangles
    // Every <triangle> in object id=2 has pid="1" p1="1"
    const colorTriangles = xml.match(/<triangle [^/]*pid="1" p1="1"/g) ?? [];
    expect(colorTriangles.length).toBe(4);
  });

  it('escapes XML special chars in colors (defensive)', async () => {
    // Colors are user-supplied strings — if someone passes garbage, it must still
    // produce well-formed XML (escaped) rather than corrupt the model.
    const blob = await build3MF([
      { name: 'evil', mesh: cubeMesh(), color: '#"><script>' },
    ], 'a');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('3D/3dmodel.model')!.async('string');
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&quot;&gt;&lt;script&gt;');
  });
});
