import React from 'react';
import { Download, Layers, Box } from 'lucide-react';
import { STLExporter } from 'three-stdlib';
import { useAlert } from '../context/AlertContext';
import { exportTo3MF } from 'three-3mf-exporter';
import * as THREE from 'three';
import type { Centroid } from '../colorflow/pipeline/quantize';
import type { ExtrudedGeometry } from '../colorflow/pipeline/extrude';
import { build3MF, type MeshPart } from '../colorflow/threeMfWriter';
import { emitProcessing } from '../utils/eventBus';

interface OutputPanelProps {
  meshRef: React.RefObject<THREE.Group | null>;
  debugMode?: boolean;
  className?: string;
  /** When non-null, the 3MF export uses threeMfWriter with multi-part assembly. */
  colorFlowGeom?: {
    base: ExtrudedGeometry;
    layers: { centroid: Centroid; position: number; geom: ExtrudedGeometry }[];
    spikes: { centroidIndex: number; geom: ExtrudedGeometry; color: string }[];
  } | null;
  /** Optional filename prefix for the 3MF download. */
  colorFlowImageName?: string;
  /** Optional outline slug (used for filename suffix). */
  colorFlowOutlineSlug?: string | null;
  /** Hex color for the base mesh, used as the displaycolor in the 3MF
   *  Materials block. e.g. "#333333". */
  baseColor?: string;
}

const OutputPanel: React.FC<OutputPanelProps> = ({ meshRef, debugMode = false, className = '', colorFlowGeom, colorFlowImageName, colorFlowOutlineSlug, baseColor = '#888888' }) => {
  const { showAlert } = useAlert();

  const expandInstancedMesh = (instancedMesh: THREE.InstancedMesh): THREE.Group => {
    const group = new THREE.Group();
    group.name = instancedMesh.name;
    group.position.copy(instancedMesh.position);
    group.rotation.copy(instancedMesh.rotation);
    group.scale.copy(instancedMesh.scale);
    
    const count = instancedMesh.count;
    const matrix = new THREE.Matrix4();
    const geom = instancedMesh.geometry.clone();
    const material = instancedMesh.material;

    // Apply instance matrices
    for (let i = 0; i < count; i++) {
        instancedMesh.getMatrixAt(i, matrix);
        const mesh = new THREE.Mesh(geom, material);
        mesh.applyMatrix4(matrix);
        group.add(mesh);
    }
    return group;
  };

  const prepareForExport = (source: THREE.Object3D): THREE.Object3D | null => {
      // Check for InstancedMesh FIRST to ensure it gets expanded
      if (source instanceof THREE.InstancedMesh) {
          return expandInstancedMesh(source as THREE.InstancedMesh);
      }

      // Special handling for Base and Pattern (CSG results) - clone shallow to drop CSG children
      if (source.name === 'Base' || source.name === 'Pattern') {
          return source.clone(false);
      }
      
      // Filter out Debug and Waste meshes
      if (source.name.startsWith('Debug_')) {
          return null;
      }
      
      if (source instanceof THREE.Group) {
          const newGroup = new THREE.Group();
          newGroup.name = source.name;
          newGroup.position.copy(source.position);
          newGroup.rotation.copy(source.rotation);
          newGroup.scale.copy(source.scale);
          
          source.children.forEach(child => {
              const processed = prepareForExport(child);
              if (processed) newGroup.add(processed);
          });
          return newGroup;
      }
      
      if (source instanceof THREE.Mesh) {
          return source.clone(true);
      }
      
      return null;
  };

  const handleExport = (mode: 'merged' | 'base' | 'pattern') => {
    if (!meshRef.current) return;

    const group = meshRef.current;
    
    // Find meshes by name
    const baseMesh = group.getObjectByName("Base") as THREE.Mesh;
    const patternMesh = group.getObjectByName("Pattern") as THREE.Mesh;
    
    let objectToExport: THREE.Object3D | null = null;
    let filename = 'grippysheet-model.stl';

    if (mode === 'base') {
        if (!baseMesh) {
             showAlert({ title: "Export Error", message: "Base mesh not found!", type: "error" });
             return;
        }
        objectToExport = baseMesh.clone(false);
        filename = 'grippysheet-base.stl';
    } else if (mode === 'pattern') {
        if (!patternMesh) {
             showAlert({ title: "Export Error", message: "Pattern mesh not found!", type: "error" });
             return;
        }
        // Use prepareForExport to handle InstancedMesh expansion if needed
        objectToExport = prepareForExport(patternMesh); 
        filename = 'grippysheet-pattern.stl';
    } else {
        // Merged
        const exportGroup = new THREE.Group();
        group.children.forEach(child => {
             const processed = prepareForExport(child);
             if (processed) exportGroup.add(processed);
        });
        objectToExport = exportGroup;
        filename = 'grippysheet-merged.stl';
    }

    if (!objectToExport) return;

    // Fix orientation for export
    // We want Z-up (flat), which matches our Three.js scene. 
    // So we don't need to rotate.
    objectToExport.updateMatrixWorld(true);

    const exporter = new STLExporter();
    const result = exporter.parse(objectToExport, { binary: true });
    
    const blob = new Blob([result], { type: 'application/octet-stream' } as BlobPropertyBag);
    const link = document.createElement('a');
    link.style.display = 'none';
    document.body.appendChild(link);
    
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  function downloadBlob(blob: Blob, filename: string) {
    const link = document.createElement('a');
    link.style.display = 'none';
    document.body.appendChild(link);
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const handleExport3MF = async () => {
    emitProcessing({ key: 'export:3mf', busy: true, label: 'exporting 3MF' });
    try {
      if (colorFlowGeom) {
        // ColorFlow path — multi-part assembly via threeMfWriter
        const parts: MeshPart[] = [{ name: 'base', mesh: colorFlowGeom.base, color: baseColor }];
        colorFlowGeom.layers.forEach((entry) => {
          const c = entry.centroid;
          const hex = `${c.r.toString(16).padStart(2,'0')}${c.g.toString(16).padStart(2,'0')}${c.b.toString(16).padStart(2,'0')}`;
          parts.push({
            name: `color_${entry.position + 1}_${hex}`,
            mesh: entry.geom,
            color: `#${hex}`,
          });
        });
        colorFlowGeom.spikes.forEach((spike, i) => {
          const suffix = spike.centroidIndex >= 0 ? `c${spike.centroidIndex}` : `u${i}`;
          parts.push({
            name: `spikes_${suffix}`,
            mesh: spike.geom,
            color: spike.color,
          });
        });
        const blob = await build3MF(parts, 'footpad_assembly');
        const stem = (colorFlowImageName || 'design').replace(/\.[^.]+$/, '');
        const suffix = colorFlowOutlineSlug || 'outline';
        downloadBlob(blob, `${stem}_${suffix}.3mf`);
        return;
      }

      // Pattern path — existing three-3mf-exporter walk
      if (!meshRef.current) return;

      const group = meshRef.current;
      const exportGroup = new THREE.Group();

      group.children.forEach((child) => {
        const processed = prepareForExport(child);
        if (processed) exportGroup.add(processed);
      });

      if (exportGroup.children.length === 0) {
        showAlert({ title: "Export Error", message: "Nothing to export! The scene appears empty.", type: "warning" });
        return;
      }

      exportGroup.updateMatrixWorld(true);

      const blob = await exportTo3MF(exportGroup, {});
      downloadBlob(blob, 'grippysheet-model.3mf');
    } catch (e) {
      console.error("3MF Export Error:", e);
      showAlert({
        title: "Export Failed",
        message: `Failed to export 3MF: ${e instanceof Error ? e.message : String(e)}`,
        type: "error",
        confirmText: "OK",
      });
    } finally {
      emitProcessing({ key: 'export:3mf', busy: false });
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="space-y-1.5">
        <div className="grid grid-cols-1 gap-1.5">
            <button
            onClick={handleExport3MF}
            // Primary CTA — the goal action of the whole tool.
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-sm"
            >
            <Box size={18} />
            Export 3MF
            <span className="text-blue-200 text-xs font-normal">· Bambu / Orca</span>
            </button>

            <button
            onClick={() => handleExport('merged')}
            // Secondary — single-mesh STL fallback.
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-gray-400 hover:text-white text-xs font-medium rounded-md hover:bg-gray-700/50 transition-colors"
            >
            <Layers size={13} />
            Export merged STL
            </button>
            
            {debugMode && (
              <div className="grid grid-cols-2 gap-2">
                  <button
                  onClick={() => handleExport('base')}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors border border-gray-600"
                  >
                  <Box size={16} />
                  Base Only
                  </button>
                  <button
                  onClick={() => handleExport('pattern')}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors border border-gray-600"
                  >
                  <Download size={16} />
                  Pattern Only
                  </button>
              </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default OutputPanel;
