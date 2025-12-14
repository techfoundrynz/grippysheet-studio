import React from 'react';
import { Download, Layers, Box } from 'lucide-react';
import { STLExporter } from 'three-stdlib';
import { useAlert } from '../context/AlertContext';
import { exportTo3MF } from 'three-3mf-exporter';
import * as THREE from 'three';

interface OutputPanelProps {
  meshRef: React.RefObject<THREE.Group | null>;
  debugMode?: boolean;
  className?: string;
}

const OutputPanel: React.FC<OutputPanelProps> = ({ meshRef, debugMode = false, className = '' }) => {
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
      // Special handling for Base and Pattern (CSG results) - clone shallow to drop CSG children
      if (source.name === 'Base' || source.name === 'Pattern') {
          return source.clone(false);
      }
      
      if (source instanceof THREE.InstancedMesh) {
          return expandInstancedMesh(source);
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
        objectToExport = patternMesh.clone(false);
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

  const handleExport3MF = async () => {
    try {
        if (!meshRef.current) return;

        const group = meshRef.current; // ... existing clone logic ...
        
        const exportGroup = new THREE.Group();
        
        group.children.forEach(child => {
             const processed = prepareForExport(child);
             if (processed) exportGroup.add(processed);
        });
        
        if (exportGroup.children.length === 0) {
            showAlert({ title: "Export Error", message: "Nothing to export! The scene appears empty.", type: "warning" });
            return;
        }

        exportGroup.updateMatrixWorld(true);

        // Async export
        const blob = await exportTo3MF(exportGroup, {});
        
        const link = document.createElement('a');
        link.style.display = 'none';
        document.body.appendChild(link);
        
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = 'grippysheet-model.3mf';
        link.click();
        
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error("3MF Export Error:", e);
        showAlert({ 
            title: "Export Failed", 
            message: `Failed to export 3MF: ${e instanceof Error ? e.message : String(e)}`, 
            type: "error" ,
            confirmText: "OK",
        });
    }
  };

  return (
    <div className={`bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4 shadow-lg ${className}`}>
      <div className="space-y-2">        
        <div className="grid grid-cols-1 gap-2">
            <button
            onClick={handleExport3MF}
            // Primary Style (Blue, Large)
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors shadow-sm"
            >
            <Box size={20} />
            Export 3MF (Bambu/Orca)
            </button>

            <button
            onClick={() => handleExport('merged')}
            // Secondary Style (Gray, Smaller text/padding matches Base/Pattern)
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors border border-gray-600"
            >
            <Layers size={16} />
            Export Merged STL
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
