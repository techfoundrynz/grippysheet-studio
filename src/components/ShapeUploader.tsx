import React, { useMemo } from 'react';
import { X, Upload, Box } from 'lucide-react';
import { parseDxfToShapes, generateSVGPath } from '../utils/dxfUtils';
import { centerShapes } from '../utils/patternUtils';
import { SVGLoader, STLLoader } from 'three-stdlib';
import * as THREE from 'three';
import ControlField from './ui/ControlField';

interface ShapeUploaderProps {
  label: string;
  shapes: any[] | null;
  fileName: string | null;
  onUpload: (shapes: any[], fileName: string, type: 'dxf' | 'svg' | 'stl') => void;
  onClear: () => void;
  className?: string;
  allowedTypes?: ('dxf' | 'svg' | 'stl')[];
  extractColors?: boolean;
  adornment?: React.ReactNode;
}

const ShapeUploader: React.FC<ShapeUploaderProps> = (props) => {
  const { 
      label, 
      shapes,
      fileName,
      onUpload, 
      onClear, 
      className,
      allowedTypes = ['dxf', 'svg', 'stl'],
      adornment,
  } = props;

  // Derived state for preview
  const { previewPath, svgViewBox } = useMemo(() => {
    if (!shapes || shapes.length === 0) {
        return { previewPath: null, svgViewBox: "0 0 100 100" };
    }

    // Filter valid 2D shapes
    const shapesToRender = shapes
        .map(s => s.shape || s)
        .filter(s => s && typeof s.getPoints === 'function');

    if (shapesToRender.length === 0) {
        return { previewPath: null, svgViewBox: "0 0 100 100" };
    }

    const path = generateSVGPath(shapesToRender);
    
    // Bounds calculation
    const bounds = new THREE.Box2();
    shapesToRender.forEach(s => {
        s.getPoints().forEach((p: THREE.Vector2) => {
            bounds.expandByPoint(p);
        });
    });

    let box = "0 0 100 100";
    if (!bounds.isEmpty()) {
        const min = bounds.min;
        const max = bounds.max;
        const padding = Math.max((max.x - min.x), (max.y - min.y)) * 0.1;
        // Flip Y for ViewBox calculation because we use scale(1, -1) in SVG
        box = `${min.x - padding} ${-max.y - padding} ${max.x - min.x + padding * 2} ${max.y - min.y + padding * 2}`;
    }

    return { previewPath: path, svgViewBox: box };
  }, [shapes]);


  const processFile = (file: File) => {
    const isSvg = file.name.toLowerCase().endsWith('.svg');
    const isDxf = file.name.toLowerCase().endsWith('.dxf');
    const isStl = file.name.toLowerCase().endsWith('.stl');

    if (isSvg && !allowedTypes.includes('svg')) {
        alert("SVG files are not allowed for this input.");
        return;
    }
    if (isDxf && !allowedTypes.includes('dxf')) {
        alert("DXF files are not allowed for this input.");
        return;
    }
    if (isStl && !allowedTypes.includes('stl')) {
        alert("STL files are not allowed for this input.");
        return;
    }

    // Helper to emit
    const emit = (loadedShapes: any[], type: 'dxf'|'svg'|'stl') => {
        onUpload(loadedShapes, file.name, type);
    };

    if (isStl) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const buffer = e.target?.result as ArrayBuffer;
            if (buffer) {
                const loader = new STLLoader();
                const geometry = loader.parse(buffer);
                geometry.center(); 
                emit([geometry], 'stl');
            }
        };
        reader.readAsArrayBuffer(file);
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
           let loadedShapes: any[] = []; 
           
           if (isSvg) {
               const loader = new SVGLoader();
               const data = loader.parse(text);
               
               data.paths.forEach((path) => {
                   const fillColor = path.userData?.style?.fill;
                   const color = (fillColor && fillColor !== 'none') ? fillColor : (path.color && path.color.getStyle());
                   
                   const subShapes = path.toShapes(true);
                   subShapes.forEach(s => {
                       if (props.extractColors) {
                           loadedShapes.push({ shape: s, color: color || '#000000' });
                       } else {
                           loadedShapes.push(s);
                       }
                   });
               });
               
               if (props.extractColors) {
                   const rawShapes = loadedShapes.map(item => item.shape);
                   const centered = centerShapes(rawShapes, true);
                   loadedShapes = loadedShapes.map((item, i) => ({ ...item, shape: centered[i] }));
               } else {
                   loadedShapes = centerShapes(loadedShapes as THREE.Shape[], true);
               }
               
           } else {
               // DXF
               loadedShapes = parseDxfToShapes(text); 
               if (props.extractColors) { 
                   loadedShapes = loadedShapes.map(s => ({ shape: s, color: '#000000' })); 
               }
           }
           
           emit(loadedShapes, isSvg ? 'svg' : 'dxf');
      }
    };
    reader.readAsText(file);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleRemoveFile = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClear();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) {
         processFile(file);
    }
  };

  const inputId = `file-upload-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const acceptString = allowedTypes.map(t => `.${t}`).join(',');
  const typeLabel = allowedTypes.map(t => t.toUpperCase()).join('/');
  
  const hasContent = shapes && shapes.length > 0;
  const displayLabel = fileName || "Custom Drawing";

  return (
      <ControlField label={label} action={adornment} className={className}>
        <div className="flex items-center justify-center w-full">
            <label 
                htmlFor={inputId}
                className={`flex flex-col items-center justify-center w-full h-[150px] border-2 border-dashed rounded-lg cursor-pointer transition-colors ${hasContent ? 'border-green-500 bg-gray-700/50 py-2' : 'border-gray-600 bg-gray-700 hover:bg-gray-600'}`}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                <div className="flex flex-col items-center justify-center pt-2 pb-2 w-full h-full relative">
                    {previewPath && (
                        <div className="h-[65px] w-full flex items-center justify-center mb-2 pointer-events-none">
                            <svg viewBox={svgViewBox} className="h-full w-auto text-green-500 stroke-current fill-none" style={{ strokeWidth: '1px' }}>
                                <path d={previewPath} vectorEffect="non-scaling-stroke" transform="scale(1, -1)" />
                            </svg>
                        </div>
                    )}

                    {!previewPath && hasContent && (
                         <div className="h-[65px] w-full flex items-center justify-center mb-2 pointer-events-none text-green-500">
                             <Box size={64} strokeWidth={1} />
                         </div>
                    )}
                    
                    {hasContent ? (
                        <div className="flex items-center gap-2 bg-gray-800/80 px-4 py-2 rounded-full backdrop-blur-sm shadow-sm border border-gray-600">
                            <span className={`text-sm font-medium truncate max-w-[180px] text-green-400`}>
                                {displayLabel}
                            </span>
                            <button 
                                onClick={handleRemoveFile}
                                className="p-1 hover:bg-gray-600 rounded-full text-gray-400 hover:text-white transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    ) : (
                        <>
                            <Upload className="w-6 h-6 mb-2 text-gray-400" />
                            <p className="mb-0.5 text-sm text-gray-400"><span className="font-semibold">Click to upload</span></p>
                            <p className="text-xs text-gray-500">{typeLabel}</p>
                        </>
                    )}
                </div>
                {!hasContent && <input id={inputId} type="file" className="hidden" accept={acceptString} onChange={handleFileChange} />}
            </label>
        </div> 
      </ControlField>
  );
};

export default ShapeUploader;
