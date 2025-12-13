import React from 'react';
import { Download, Layers, Box } from 'lucide-react';
import { STLExporter } from 'three-stdlib';
import { exportTo3MF } from 'three-3mf-exporter';
import * as THREE from 'three';

interface OutputPanelProps {
  meshRef: React.RefObject<THREE.Group | null>;
  debugMode?: boolean;
}

const OutputPanel: React.FC<OutputPanelProps> = ({ meshRef, debugMode = false }) => {
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
             alert("Base mesh not found!");
             return;
        }
        objectToExport = baseMesh.clone(false);
        filename = 'grippysheet-base.stl';
    } else if (mode === 'pattern') {
        if (!patternMesh) {
             alert("Pattern mesh not found!");
             return;
        }
        objectToExport = patternMesh.clone(false);
        filename = 'grippysheet-pattern.stl';
    } else {
        // Merged
        const exportGroup = new THREE.Group();
        group.children.forEach(child => {
             // For Base and Pattern, we ONLY want the mesh geometry, not the CSG children (which include the subtraction box)
             if (child.name === 'Base' || child.name === 'Pattern') {
                 exportGroup.add(child.clone(false));
             } else if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh || child instanceof THREE.Group) {
                 // For others (like STL instances which might be nested), deep clone is safer, 
                 // or iterate if we know the structure.
                 exportGroup.add(child.clone(true));
             }
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
        if (!meshRef.current) return;

        const group = meshRef.current; // ... existing clone logic ...
        
        const exportGroup = new THREE.Group();
        
        group.children.forEach(child => {
            if (child.name === 'Base' || child.name === 'Pattern') {
                 // Shallow clone to avoid CSG children
                 exportGroup.add(child.clone(false));
            } else if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh || child instanceof THREE.Group) {
               const clone = child.clone(true);
               exportGroup.add(clone);
            }
        });
        
        if (exportGroup.children.length === 0) {
            alert("Nothing to export!");
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
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4 shadow-lg">
      <h2 className="text-xl font-semibold text-white">Output</h2>
      
      <div className="space-y-2">
        <p className="text-sm text-gray-400">
          Export options:
        </p>
        
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
