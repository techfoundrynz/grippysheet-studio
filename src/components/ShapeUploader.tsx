import React from 'react';
import { X, Upload, Box } from 'lucide-react';
import { parseDxfToShapes, generateSVGPath } from '../utils/dxfUtils';
import { centerShapes } from '../utils/patternUtils';
import { SVGLoader, STLLoader } from 'three-stdlib';
import * as THREE from 'three';
import ControlField from './ui/ControlField';

interface ShapeUploaderProps {
  label: string;
  onShapesLoaded: (shapes: any[], type?: 'dxf' | 'svg' | 'stl') => void;
  onClear: () => void;
  className?: string;
  allowedTypes?: ('dxf' | 'svg' | 'stl')[];
  extractColors?: boolean;
  adornment?: React.ReactNode;
  externalShapes?: any[];
  externalFileName?: string | null;
}

const ShapeUploader: React.FC<ShapeUploaderProps> = (props) => {
  const { 
      label, 
      onShapesLoaded, 
      onClear, 
      className,
      allowedTypes = ['dxf', 'svg', 'stl'],
      adornment,
      externalShapes,
      externalFileName
  } = props;
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
           let shapes: any[] = []; // Changed to any[] to support { shape, color }
           
           if (isSvg) {
               const loader = new SVGLoader();
               const data = loader.parse(text);
               
               // Flatten SVG paths to Shapes
               data.paths.forEach((path) => {
                   const fillColor = path.userData?.style?.fill;
                   const color = (fillColor && fillColor !== 'none') ? fillColor : (path.color && path.color.getStyle()); // fallback to path color
                   
                   const subShapes = path.toShapes(true); // isCCW
                   
                   subShapes.forEach(s => {
                       if (props.extractColors) {
                           shapes.push({ shape: s, color: color || '#000000' });
                       } else {
                           shapes.push(s);
                       }
                   });
               });
               
               // Center shapes logic needs to handle objects or shapes
               if (props.extractColors) {
                   // Separate shapes for centering calculation
                   const rawShapes = shapes.map(item => item.shape);
                   const centered = centerShapes(rawShapes, true);
                   // Re-attach centerd shapes
                   shapes = shapes.map((item, i) => ({ ...item, shape: centered[i] }));
               } else {
                   shapes = centerShapes(shapes as THREE.Shape[], true);
               }
               
           } else {
               // DXF
               shapes = parseDxfToShapes(text); if (props.extractColors) { shapes = shapes.map(s => ({ shape: s, color: '#000000' })); }
           }
           
           // If returning objects, map to shapes for preview generation
           const previewShapes = props.extractColors ? shapes.map(s => s.shape) : shapes;

           onShapesLoaded(shapes, isSvg ? 'svg' : 'dxf');
           
           if (previewShapes.length > 0) {
               const path = generateSVGPath(previewShapes as THREE.Shape[]);
               setPreviewPath(path);
               
               // Calculate bounds for ViewBox
               const min = new THREE.Vector2(Infinity, Infinity);
               const max = new THREE.Vector2(-Infinity, -Infinity);
               (previewShapes as THREE.Shape[]).forEach(shape => {
                   shape.getPoints().forEach((p: THREE.Vector2) => {
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
    reader.readAsText(file);
  };

  // Effect to update preview if externalShapes change
  React.useEffect(() => {
     if (externalShapes && externalShapes.length > 0) {
         // Generate preview from external edits
         // Ensure we only try to generate SVG paths from valid 2D Shapes (which have .getPoints)
         const shapesToRender = externalShapes
            .map(s => s.shape || s)
            .filter(s => s && typeof s.getPoints === 'function');

         if (shapesToRender.length > 0) {
             const path = generateSVGPath(shapesToRender);
             setPreviewPath(path);
             
             const bounds = new THREE.Box2();
             shapesToRender.forEach(s => {
                 s.getPoints().forEach((p: THREE.Vector2) => {
                     bounds.expandByPoint(p);
                 });
             });
             
             if (!bounds.isEmpty()) {
                 const min = bounds.min;
                 const max = bounds.max;
                 const padding = Math.max((max.x - min.x), (max.y - min.y)) * 0.1;
                 setSvgViewBox(`${min.x - padding} ${-max.y - padding} ${max.x - min.x + padding * 2} ${max.y - min.y + padding * 2}`);
             }
         } else {
             // If we have external shapes but no valid 2D shapes (e.g. 3D geometry), 
             // we can't show a 2D path preview.
             setPreviewPath(null);
         }
     } else if (!fileName) {
         // Reset if no file and no external shapes
         setPreviewPath(null);
     }
  }, [externalShapes, fileName]);



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
      <ControlField label={label} action={adornment} className={className}>
        <div className="flex items-center justify-center w-full">
            <label 
                htmlFor={inputId}
                className={`flex flex-col items-center justify-center w-full h-[150px] border-2 border-dashed rounded-lg cursor-pointer transition-colors ${(fileName || externalFileName) ? 'border-green-500 bg-gray-700/50 py-2' : 'border-gray-600 bg-gray-700 hover:bg-gray-600'}`}
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

                    {!previewPath && (fileName || externalFileName) && (
                         <div className="h-[65px] w-full flex items-center justify-center mb-2 pointer-events-none text-green-500">
                             <Box size={64} strokeWidth={1} />
                         </div>
                    )}
                    
                    {(fileName || (externalShapes && externalShapes.length > 0)) ? (
                        <div className="flex items-center gap-2 bg-gray-800/80 px-4 py-2 rounded-full backdrop-blur-sm shadow-sm border border-gray-600">
                            <span className={`text-sm font-medium truncate max-w-[180px] ${(fileName || externalFileName) ? 'text-green-400' : 'text-purple-400'}`}>
                                {fileName || externalFileName || "Custom Drawing"}
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
                {!fileName && !(externalShapes && externalShapes.length > 0) && <input id={inputId} type="file" className="hidden" accept={acceptString} onChange={handleFileChange} />}
            </label>
        </div> 
      </ControlField>
  );
};

export default ShapeUploader;
