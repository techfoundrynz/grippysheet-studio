import React from 'react';
import { Download, Layers, Box } from 'lucide-react';
import { STLExporter } from 'three-stdlib';
import * as THREE from 'three';

interface OutputPanelProps {
  meshRef: React.RefObject<THREE.Group | null>;
}

const OutputPanel: React.FC<OutputPanelProps> = ({ meshRef }) => {
  const handleExport = (mode: 'merged' | 'base' | 'pattern') => {
    if (!meshRef.current) return;

    const group = meshRef.current;
    
    // Find meshes by name
    const baseMesh = group.getObjectByName("Base") as THREE.Mesh;
    const patternMesh = group.getObjectByName("Pattern") as THREE.Mesh;
    
    let objectToExport: THREE.Object3D | null = null;
    let filename = 'printgrip-model.stl';

    if (mode === 'base') {
        if (!baseMesh) {
             alert("Base mesh not found!");
             return;
        }
        objectToExport = baseMesh.clone(false);
        filename = 'printgrip-base.stl';
    } else if (mode === 'pattern') {
        if (!patternMesh) {
             alert("Pattern mesh not found!");
             return;
        }
        objectToExport = patternMesh.clone(false);
        filename = 'printgrip-pattern.stl';
    } else {
        // Merged
        const exportGroup = new THREE.Group();
        if (baseMesh) exportGroup.add(baseMesh.clone(false));
        if (patternMesh) exportGroup.add(patternMesh.clone(false));
        objectToExport = exportGroup;
        filename = 'printgrip-merged.stl';
    }

    if (!objectToExport) return;

    const exporter = new STLExporter();
    const result = exporter.parse(objectToExport, { binary: true });
    
    const blob = new Blob([result], { type: 'application/octet-stream' });
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

  return (
    <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 space-y-4 shadow-lg">
      <h2 className="text-xl font-semibold text-white">Output</h2>
      
      <div className="space-y-2">
        <p className="text-sm text-gray-400">
          Export options:
        </p>
        
        <div className="grid grid-cols-1 gap-2">
            <button
            onClick={() => handleExport('merged')}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
            <Layers size={20} />
            Export Merged STL
            </button>
            
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
        </div>
      </div>
    </div>
  );
};

export default OutputPanel;
