import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportProjectBundle, importProjectBundle } from './projectUtils';
import { defaultBaseSettings, defaultInlaySettings, defaultGeometrySettings } from './schemaDefaults';
import JSZip from 'jszip';

describe('projectUtils utility', () => {
  let mockLink: any;

  beforeEach(() => {
    mockLink = {
      href: '',
      download: '',
      click: vi.fn(),
    };

    if (typeof window !== 'undefined') {
      vi.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as any);
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as any);
      
      // Mock URL methods
      global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      global.URL.revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exportProjectBundle', () => {
    it('creates zip bundle and triggers download', async () => {
      const assets = {
        baseOutline: { name: 'outline.dxf', content: 'dxf-content', type: 'dxf' as const },
        pattern: { name: 'pattern.svg', content: 'svg-content', type: 'svg' as const },
        inlays: {
          'layer-1': { name: 'inlay.stl', content: new ArrayBuffer(8), type: 'stl' as const }
        }
      };

      await exportProjectBundle(
        defaultBaseSettings,
        defaultInlaySettings,
        defaultGeometrySettings,
        assets
      );

      // Verify DOM methods were called to trigger download
      expect(document.createElement).toHaveBeenCalledWith('a');
      expect(mockLink.download).toContain('grippysheet-bundle-');
      expect(mockLink.download).toContain('.zip');
      expect(mockLink.href).toBe('blob:mock-url');
      expect(document.body.appendChild).toHaveBeenCalledWith(mockLink);
      expect(mockLink.click).toHaveBeenCalled();
      expect(document.body.removeChild).toHaveBeenCalledWith(mockLink);
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
  });

  describe('importProjectBundle', () => {
    it('throws error for non-zip files', async () => {
      const mockFile = new File(['random content'], 'project.json', { type: 'application/json' });
      await expect(importProjectBundle(mockFile)).rejects.toThrow('Only .zip bundles are supported.');
    });

    it('parses valid zip bundle containing project.json', async () => {
      const zip = new JSZip();
      
      const projectData = {
        version: 1,
        timestamp: Date.now(),
        base: { ...defaultBaseSettings, size: 250 },
        inlay: defaultInlaySettings,
        geometry: defaultGeometrySettings,
      };

      zip.file('project.json', JSON.stringify(projectData));
      
      // Add some assets
      zip.file('assets/base/outline.dxf', 'dxf-outline-content');
      zip.file('assets/pattern/pattern.svg', 'svg-pattern-content');
      zip.file('assets/inlays/inlay-1/inlay.stl', new Uint8Array([1, 2, 3]).buffer);

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const mockFile = new File([zipBlob], 'bundle.zip', { type: 'application/zip' });

      const result = await importProjectBundle(mockFile);

      expect(result.data.base.size).toBe(250);
      expect(result.versionMismatch).toBe(false);
      expect(result.importedVersion).toBe(1);
      
      expect(result.importedAssets?.baseOutline?.name).toBe('outline.dxf');
      expect(result.importedAssets?.baseOutline?.content).toBe('dxf-outline-content');
      expect(result.importedAssets?.baseOutline?.type).toBe('dxf');
      
      expect(result.importedAssets?.pattern?.name).toBe('pattern.svg');
      expect(result.importedAssets?.pattern?.content).toBe('svg-pattern-content');
      
      // Verify that the nested inlay asset was parsed with its correct filename
      expect(result.importedAssets?.inlays?.['inlay-1']?.name).toBe('inlay.stl');
    });

    it('throws error if project.json is missing in zip', async () => {
      const zip = new JSZip();
      zip.file('something-else.txt', 'hello');

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const mockFile = new File([zipBlob], 'bundle.zip', { type: 'application/zip' });

      await expect(importProjectBundle(mockFile)).rejects.toThrow('Invalid bundle: project.json missing');
    });

    it('throws error if schema validation fails', async () => {
      const zip = new JSZip();
      const invalidProjectData = {
        version: 1,
        timestamp: Date.now(),
        base: { ...defaultBaseSettings, size: 'invalid-should-be-number' }, // Invalid size
        inlay: defaultInlaySettings,
        geometry: defaultGeometrySettings,
      };

      zip.file('project.json', JSON.stringify(invalidProjectData));
      
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const mockFile = new File([zipBlob], 'bundle.zip', { type: 'application/zip' });

      await expect(importProjectBundle(mockFile)).rejects.toThrow('Invalid project file format or version mismatch.');
    });
  });
});
