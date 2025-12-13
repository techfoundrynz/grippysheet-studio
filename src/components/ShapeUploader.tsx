import React from 'react';
import { X, Upload, Box } from 'lucide-react';
import { parseDxfToShapes, generateSVGPath } from '../utils/dxfUtils';
import { SVGLoader, STLLoader } from 'three-stdlib';
import * as THREE from 'three';

interface ShapeUploaderProps {
  label: string;
  onShapesLoaded: (shapes: any[], type?: 'dxf' | 'svg' | 'stl') => void;
  onClear: () => void;
  className?: string;
  allowedTypes?: ('dxf' | 'svg' | 'stl')[];
}

const ShapeUploader: React.FC<ShapeUploaderProps> = ({ 
    label, 
    onShapesLoaded, 
    onClear, 
    className,
    allowedTypes = ['dxf', 'svg', 'stl'] 
}) => {
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const [svgViewBox, setSvgViewBox] = React.useState<string>("0 0 100 100");

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

    setFileName(file.name);

    if (isStl) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const buffer = e.target?.result as ArrayBuffer;
            if (buffer) {
                const loader = new STLLoader();
                const geometry = loader.parse(buffer);
                geometry.center(); // Center the geometry
                // Pass as array of 1 geometry, marked as 'stl'
                onShapesLoaded([geometry], 'stl');
                setPreviewPath(null); // No preview for STL
                setSvgViewBox("0 0 100 100");
            }
        };
        reader.readAsArrayBuffer(file);
        return;
    }

    const reader = new FileReader();
    
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
           let shapes: THREE.Shape[] = [];
           
           if (isSvg) {
               const loader = new SVGLoader();
               const data = loader.parse(text);
               
               // Flatten SVG paths to Shapes
               data.paths.forEach((path) => {
                   const subShapes = path.toShapes(true); // isCCW
                   subShapes.forEach(s => shapes.push(s));
               });
               
               // Center shapes
               shapes = centerShapes(shapes);
               
           } else {
               // DXF
               shapes = parseDxfToShapes(text);
           }

           onShapesLoaded(shapes, isSvg ? 'svg' : 'dxf');
           
           if (shapes.length > 0) {
               const path = generateSVGPath(shapes);
               setPreviewPath(path);
               
               // Calculate bounds for ViewBox
               const min = new THREE.Vector2(Infinity, Infinity);
               const max = new THREE.Vector2(-Infinity, -Infinity);
               shapes.forEach(shape => {
                   shape.getPoints().forEach(p => {
                       // Match generateSVGPath (no flip)
                       const y = p.y;
                       if (p.x < min.x) min.x = p.x;
                       if (y < min.y) min.y = y;
                       if (p.x > max.x) max.x = p.x;
                       if (y > max.y) max.y = y;
                   });
               });
               
               const padding = Math.max((max.x - min.x), (max.y - min.y)) * 0.1;
               // Flip Y for ViewBox calculation because we use scale(1, -1)
               // The transformed Y range is [-max.y, -min.y]
               setSvgViewBox(`${min.x - padding} ${-max.y - padding} ${max.x - min.x + padding * 2} ${max.y - min.y + padding * 2}`);
           } else {
               setPreviewPath(null);
           }
      }
    };
    reader.readAsText(file);
  };

  const centerShapes = (shapes: THREE.Shape[]): THREE.Shape[] => {
      if (shapes.length === 0) return shapes;
      
      const min = new THREE.Vector2(Infinity, Infinity);
      const max = new THREE.Vector2(-Infinity, -Infinity);
      
      shapes.forEach(shape => {
           shape.getPoints().forEach(p => {
               min.min(p);
               max.max(p);
           });
      });
      
      const center = new THREE.Vector2().addVectors(min, max).multiplyScalar(0.5);
      
      // If already centered (close enough), return
      if (center.lengthSq() < 0.001) return shapes;

      return shapes.map(shape => {
          const newShape = new THREE.Shape();
          
          // Move Shape Points
          const pts = shape.getPoints();
          
          // Enforce CCW for outer shape
          if (THREE.ShapeUtils.area(pts) < 0) {
              pts.reverse();
          }

          pts.forEach((p, i) => {
              const tx = p.x - center.x;
              const ty = -(p.y - center.y); // Flip Y
              if (i === 0) newShape.moveTo(tx, ty);
              else newShape.lineTo(tx, ty);
          });

          // Move Holes
          if (shape.holes && shape.holes.length > 0) {
              shape.holes.forEach(hole => {
                  const newHole = new THREE.Path();
                  const hPts = hole.getPoints();
                  hPts.forEach((p, i) => {
                      const tx = p.x - center.x;
                      const ty = -(p.y - center.y); // Flip Y
                      if (i === 0) newHole.moveTo(tx, ty);
                      else newHole.lineTo(tx, ty);
                  });
                  newShape.holes.push(newHole);
              });
          }
          
          return newShape;
      });
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
    setFileName(null);
    onShapesLoaded([]); // Clear shapes
    setPreviewPath(null);
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

  return (
      <div className={`space-y-2 ${className}`}>
        <label className="block text-sm font-medium text-gray-300">
          {label}
        </label>
        <div className="flex items-center justify-center w-full">
            <label 
                htmlFor={inputId}
                className={`flex flex-col items-center justify-center w-full h-[150px] border-2 border-dashed rounded-lg cursor-pointer transition-colors ${fileName ? 'border-green-500 bg-gray-700/50 py-2' : 'border-gray-600 bg-gray-700 hover:bg-gray-600'}`}
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

                    {!previewPath && fileName && (
                         <div className="h-[65px] w-full flex items-center justify-center mb-2 pointer-events-none text-green-500">
                             <Box size={64} strokeWidth={1} />
                         </div>
                    )}
                    
                    {fileName ? (
                        <div className="flex items-center gap-2 z-10 bg-gray-800/80 px-4 py-2 rounded-full backdrop-blur-sm shadow-sm border border-gray-600">
                            <span className="text-sm text-green-400 font-medium truncate max-w-[180px]">{fileName}</span>
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
                {!fileName && <input id={inputId} type="file" className="hidden" accept={acceptString} onChange={handleFileChange} />}
            </label>
        </div> 
      </div>
  );
};

export default ShapeUploader;
