import React, { useState, useEffect, useRef } from 'react';
import { useAlert } from '../context/AlertContext';
import { X, Check, Pipette, Palette, Droplet, Pencil, Square, Circle, Eraser, Ban } from 'lucide-react';
import * as THREE from 'three';
import { COLORS } from '../constants/colors';
import { flattenColors } from '../utils/colorUtils';
import { generateSVGPath } from '../utils/dxfUtils';
import { getShapesBounds } from '../utils/patternUtils';

interface SVGPaintModalProps {
    isOpen: boolean;
    onClose: () => void;
    shapes: any[]; // Array of { shape: THREE.Shape, color: string }
    onSave: (shapes: any[]) => void;
    baseColor: string;
}

const SVGPaintModal: React.FC<SVGPaintModalProps> = ({ isOpen, onClose, shapes, onSave, baseColor }) => {
    const { showAlert } = useAlert();
    const [localShapes, setLocalShapes] = useState<any[]>([]);
    const [selectedColor, setSelectedColor] = useState<string>(COLORS.White);
    const [isEyedropperActive, setIsEyedropperActive] = useState(false);

    
    // Viewport State
    // Viewport State
    const [vbParams, setVbParams] = useState({ x: 0, y: 0, w: 500, h: 500 });
    const [activeTool, setActiveTool] = useState<'paint' | 'draw' | 'rectangle' | 'circle' | 'eraser' | 'text' | 'exclude'>('paint');
    const [currentPath, setCurrentPath] = useState<THREE.Vector2[]>([]);
    
    // Zoom/Pan State
    const isPanning = useRef(false);
    const panStart = useRef({ x: 0, y: 0 });
    const viewBoxStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
    
    const svgRef = useRef<SVGSVGElement>(null);

    useEffect(() => {
        if (isOpen) {
            // Deep clone to avoid mutating props directly
            const initialShapes = shapes ? shapes.map(s => ({ ...s, color: s.color || '#ffffff' })) : [];
            setLocalShapes(initialShapes);
            
            // Calculate ViewBox from ORIGINAL shapes if available, else current, else default
            // Use shapes since originalShapes is gone
            const targetShapes = (initialShapes.length > 0 ? initialShapes : shapes) || [];
            const rawShapes = targetShapes.map(s => s.shape || s);
            
            if (rawShapes.length > 0) {
                const bounds = getShapesBounds(rawShapes);
                const padding = Math.max(bounds.size.x, bounds.size.y) * 0.1;
                
                setVbParams({
                    x: bounds.min.x - padding,
                    y: bounds.min.y - padding,
                    w: bounds.size.x + padding * 2,
                    h: bounds.size.y + padding * 2
                });
            } else {
                // Default ViewBox for empty canvas (Standalone Mode)
                setVbParams({ x: 0, y: 0, w: 500, h: 500 });
            }
        }
    }, [isOpen, shapes]);

    const viewBoxString = `${vbParams.x} ${vbParams.y} ${vbParams.w} ${vbParams.h}`;

    const handleShapeClick = (index: number) => {
        if (isEyedropperActive) {
            const chosen = localShapes[index];
            if (chosen && chosen.color) {
                setSelectedColor(chosen.color);
                setIsEyedropperActive(false);
            }
            return;
        }

        if (activeTool === 'paint') {
            const newShapes = [...localShapes];
            newShapes[index] = { ...newShapes[index], color: selectedColor };
            setLocalShapes(newShapes);
        } else if (activeTool === 'eraser') {
            const newShapes = [...localShapes];
            newShapes.splice(index, 1);
            setLocalShapes(newShapes);
        } else if (activeTool === 'exclude') {
            const newShapes = [...localShapes];
            const currentMode = newShapes[index].gripMode;
            let nextMode: 'exclude' | 'include' | undefined;
            
            if (!currentMode && !newShapes[index].excludePattern) {
                // First click -> Exclude
                nextMode = 'exclude';
            } else if (currentMode === 'exclude' || newShapes[index].excludePattern) {
                // Second click -> Include
                nextMode = 'include';
            } else {
                // Third click -> Reset
                nextMode = undefined;
            }
            
            // Clear legacy property if present, rely on gripMode
            if (newShapes[index].excludePattern) delete newShapes[index].excludePattern;
            
            newShapes[index] = { ...newShapes[index], gripMode: nextMode };
            setLocalShapes(newShapes);
        }
    };

    const getSVGPoint = (e: React.PointerEvent) => {
        if (!svgRef.current) return null;
        const pt = svgRef.current.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const transform = svgRef.current.getScreenCTM()?.inverse();
        if (transform) {
            const svgPt = pt.matrixTransform(transform);
            // Flip Y for Shape Space (because of scale(1, -1) on group)
            return new THREE.Vector2(svgPt.x, -svgPt.y);
        }
        return null;
    };

    // ... existing handlers ...

    const handlePointerDown = (e: React.PointerEvent) => {
        (e.target as Element).setPointerCapture(e.pointerId);

        // Handle Pan (Middle Mouse or Right Mouse)
        if (e.button === 1 || e.button === 2) {
            e.preventDefault();
            isPanning.current = true;
            panStart.current = { x: e.clientX, y: e.clientY };
            viewBoxStart.current = { ...vbParams };
            return;
        }
        
        if (activeTool === 'paint' || activeTool === 'eraser' || activeTool === 'exclude') return;

        if (activeTool === 'draw' || activeTool === 'rectangle' || activeTool === 'circle') {
            const pt = getSVGPoint(e);
            if (pt) {
                setCurrentPath([pt, pt]); // Start point twice for shape start
            }
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        // Handle Panning
        if (isPanning.current && svgRef.current) {
            const dx = e.clientX - panStart.current.x;
            const dy = e.clientY - panStart.current.y;
            
            const rect = svgRef.current.getBoundingClientRect();
            // Scale screen pixels to viewBox units
            const scaleX = viewBoxStart.current.w / rect.width;
            const scaleY = viewBoxStart.current.h / rect.height;
            
            setVbParams({
                ...viewBoxStart.current,
                x: viewBoxStart.current.x - dx * scaleX,
                y: viewBoxStart.current.y - dy * scaleY
            });
            return;
        }
        if (currentPath.length > 0) {
            const pt = getSVGPoint(e);
            if (!pt) return;

            if (activeTool === 'draw') {
                const last = currentPath[currentPath.length - 1];
                if (pt.distanceToSquared(last) > 1) { 
                    setCurrentPath(prev => [...prev, pt]);
                }
            } else if (activeTool === 'rectangle' || activeTool === 'circle') {
                // Update 2nd point (end point)
                setCurrentPath(prev => [prev[0], pt]);
            }
        }
    };
    
    const handleWheel = (e: React.WheelEvent) => {
        if (!svgRef.current) return;
        e.stopPropagation();
        e.preventDefault();

        const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
        
        // Calculate mouse position ratio mainly to zoom towards mouse
        const rect = svgRef.current.getBoundingClientRect();
        const rx = (e.clientX - rect.left) / rect.width;
        const ry = (e.clientY - rect.top) / rect.height;
        
        setVbParams(prev => {
            const newW = prev.w * zoomFactor;
            const newH = prev.h * zoomFactor;
            const newX = prev.x + (prev.w - newW) * rx;
            const newY = prev.y + (prev.h - newH) * ry;
            
            return {
                x: newX,
                y: newY,
                w: newW,
                h: newH
            };
        });
    };

    // Font Loading
    const fontRef = useRef<any>(null);
    const [showShapeMenu, setShowShapeMenu] = useState(false);
    const [isFontLoading, setIsFontLoading] = useState(false);

    useEffect(() => {
        if (!fontRef.current && !isFontLoading) {
            setIsFontLoading(true);
            import('three/examples/jsm/loaders/FontLoader.js').then(({ FontLoader }) => {
                const loader = new FontLoader();
                // Use a standard font from CDN or local if available. 
                // Using standard three.js example font for reliability.
                loader.load('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json', (font) => {
                    fontRef.current = font;
                    setIsFontLoading(false);
                }, undefined, (err) => {
                    console.error("Failed to load font", err);
                    setIsFontLoading(false);
                });
            }).catch(e => {
                 // Fallback for different environments or if dynamic import fails
                 // Try three-stdlib if installed
                 import('three-stdlib').then(({ FontLoader }) => {
                     const loader = new FontLoader();
                     loader.load('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json', (font) => {
                        fontRef.current = font;
                        setIsFontLoading(false);
                     });
                 }).catch(err => console.error("Could not load FontLoader", err));
            });
        }
    }, [isFontLoading]);

    const handlePointerUp = (e: React.PointerEvent) => {
        (e.target as Element).releasePointerCapture(e.pointerId);

        if (isPanning.current) {
            isPanning.current = false;
            return;
        }

        if (activeTool === 'text') {
            // Prevent text tool from triggering on mouse leave
            if (e.type === 'pointerleave') return;

             const pt = getSVGPoint(e);
             if (pt && fontRef.current) {
                 showAlert({
                     title: "Add Text",
                     message: "Enter text to add:",
                     inputType: 'text',
                     inputPlaceholder: "Text",
                     defaultValue: "Text",
                     confirmText: "Add",
                     onConfirm: (text) => {
                         if (text) {
                             const shapes = fontRef.current.generateShapes(text, 20); // Size 20 default
                             // Shape is generated at 0,0. Move to pt.
                             const geometry = new THREE.ShapeGeometry(shapes);
                             geometry.computeBoundingBox();
                             const xMid = -0.5 * (geometry.boundingBox!.max.x - geometry.boundingBox!.min.x);
                             // Translate shapes manually
                             const translatedShapes = shapes.map((s: THREE.Shape) => {
                                 const pts = s.getPoints();
                                 const holes = s.holes;
                                 const newS = new THREE.Shape();
                                 const moveX = pt.x + xMid; // Center horizontally
                                 const moveY = pt.y;       // Baseline at click
                                 
                                 pts.forEach((p, i) => {
                                     if (i === 0) newS.moveTo(p.x + moveX, p.y + moveY);
                                     else newS.lineTo(p.x + moveX, p.y + moveY);
                                 });
                                 
                                 if (holes) {
                                     holes.forEach(h => {
                                         const hPts = h.getPoints();
                                         const newH = new THREE.Path();
                                         hPts.forEach((p, i) => {
                                             if (i === 0) newH.moveTo(p.x + moveX, p.y + moveY);
                                             else newH.lineTo(p.x + moveX, p.y + moveY);
                                         });
                                         newS.holes.push(newH);
                                     });
                                 }
                                 return newS;
                             });
                             
                             // Add all shapes (letters are separate shapes)
                             // Combine them or add as separate objects?
                             // SVGPaintModal expects array of {shape, color}.
                             translatedShapes.forEach((s: THREE.Shape) => {
                                setLocalShapes(prev => [...prev, { shape: s, color: selectedColor }]);
                             });
                         }
                     }
                 });
             } else if (activeTool === 'text' && !fontRef.current) {
                 showAlert({
                     title: "Loading Font",
                     message: "Font is still loading...",
                     type: 'warning'
                 });
             }
        } 
        
        if (currentPath.length >= 2) {
             let shape: THREE.Shape | null = null;
             
             if (activeTool === 'draw' && currentPath.length > 2) {
                // ... Draw Logic ...
                const simplified = [currentPath[0]];
                for (let i = 1; i < currentPath.length; i++) {
                     if (currentPath[i].distanceToSquared(simplified[simplified.length - 1]) > 5) { // Increased threshold
                         simplified.push(currentPath[i]);
                     }
                }
                
                // Ensure last point is included
                if (simplified[simplified.length - 1] !== currentPath[currentPath.length - 1]) {
                    simplified.push(currentPath[currentPath.length - 1]);
                }

                if (simplified.length > 2) {
                    const curve = new THREE.SplineCurve(simplified);
                    // significantly increased sampling for smoother curve
                    const points = curve.getPoints(Math.max(50, simplified.length * 5)); 
                    
                    shape = new THREE.Shape();
                    shape.moveTo(points[0].x, points[0].y);
                    for (let i = 1; i < points.length; i++) {
                        shape.lineTo(points[i].x, points[i].y);
                    }
                    shape.closePath();
                }
             } else if (activeTool === 'rectangle') {
                 // Rect
                 const start = currentPath[0];
                 const end = currentPath[1];
                 const w = end.x - start.x;
                 const h = end.y - start.y;
                 if (Math.abs(w) > 0.1 && Math.abs(h) > 0.1) {
                    shape = new THREE.Shape();
                    shape.moveTo(start.x, start.y);
                    shape.lineTo(start.x + w, start.y);
                    shape.lineTo(start.x + w, start.y + h);
                    shape.lineTo(start.x, start.y + h);
                    shape.closePath();
                 }
             } else if (activeTool === 'circle') {
                 // Circle (Center/Radius)
                 const center = currentPath[0];
                 const radius = center.distanceTo(currentPath[1]);
                 if (radius > 0.1) {
                     shape = new THREE.Shape();
                     shape.absarc(center.x, center.y, radius, 0, Math.PI * 2, false);
                 }
             }

             if (shape) {
                 setLocalShapes(prev => [...prev, { shape, color: selectedColor }]);
             }
        }
        setCurrentPath([]);
    };

    // ... save handler ...
    const handleSave = () => {
        onSave(localShapes);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col animate-in fade-in zoom-in duration-200">
                
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
                            <Droplet size={24} />
                        </div>
                        <h2 className="text-xl font-bold text-white">Paint Inlay</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={onClose}
                            className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Left: Canvas */}
                    <div className="flex-1 bg-gray-950/50 p-4 relative overflow-hidden flex items-center justify-center touch-none">
                         <div className="w-full h-full border border-gray-800 rounded-lg bg-gray-900 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTAgMGgxMHYxMEgwek0xMCAxMGgxMHYxMEgxMHoiIGZpbGw9IiMzNzQxNTEiIGZpbGwtb3BhY2l0eT0iMC40Ii8+PC9zdmc+')]">
                            <svg 
                                ref={svgRef}
                                viewBox={viewBoxString} 
                                className={`w-full h-full ${activeTool === 'draw' ? 'cursor-crosshair' : activeTool === 'text' ? 'cursor-text' : isEyedropperActive ? 'cursor-none' : 'cursor-default'}`} 
                                style={{ cursor: isEyedropperActive ? 'crosshair' : undefined }}
                                onPointerDown={handlePointerDown}
                                onPointerMove={handlePointerMove}
                                onPointerUp={handlePointerUp}
                                onPointerLeave={handlePointerUp} // Use Up handler to clean state
                                onWheel={handleWheel}
                                onContextMenu={(e) => e.preventDefault()}
                            >
                                <g transform="scale(1, -1)">
                                    {localShapes.map((item, index) => {
                                        const d = generateSVGPath([item.shape || item]);
                                        const isTransparent = item.color === 'transparent';
                                        const displayColor = item.color === 'base' ? baseColor : item.color;
                                        
                                        // Determine visual style based on gripMode (or legacy excludePattern)
                                        const mode = item.gripMode || (item.excludePattern ? 'exclude' : undefined);
                                        const isExcluded = mode === 'exclude';
                                        const isIncluded = mode === 'include';
                                        
                                        let strokeColor = (selectedColor === 'transparent' ? '#ffffff' : (isTransparent ? '#4b5563' : displayColor));
                                        if (isExcluded) strokeColor = '#f97316'; // Orange
                                        if (isIncluded) strokeColor = '#22c55e'; // Green

                                        return (
                                            <path 
                                                key={index}
                                                d={d}
                                                fill={isTransparent ? 'rgba(0,0,0,0)' : displayColor}
                                                stroke={strokeColor}
                                                strokeWidth={(isExcluded || isIncluded) ? 3 : (isTransparent ? 1 : 0)}
                                                strokeDasharray={(isExcluded || isIncluded) ? "4,2" : (isTransparent ? "2,2" : "none")}
                                                // Make interactive only if NOT handling text or draw active
                                                className={`transition-opacity ${(activeTool === 'paint' || activeTool === 'eraser' || activeTool === 'exclude' || isEyedropperActive) ? 'cursor-pointer hover:opacity-80' : 'pointer-events-none'}`}
                                                onClick={() => handleShapeClick(index)}
                                                vectorEffect="non-scaling-stroke"
                                                pointerEvents="all"
                                            />
                                        );
                                    })}
                                    {currentPath.length > 0 && activeTool === 'draw' && (
                                        <path
                                            d={`M ${currentPath.map(p => `${p.x} ${p.y}`).join(' L ')}`}
                                            fill="none"
                                            stroke={selectedColor === 'transparent' ? '#ffffff' : selectedColor === 'base' ? baseColor : selectedColor}
                                            strokeWidth={2}
                                            vectorEffect="non-scaling-stroke"
                                        />
                                    )}
                                    {currentPath.length >= 2 && activeTool === 'rectangle' && (
                                        <rect
                                            x={Math.min(currentPath[0].x, currentPath[1].x)}
                                            y={Math.min(currentPath[0].y, currentPath[1].y)}
                                            width={Math.abs(currentPath[1].x - currentPath[0].x)}
                                            height={Math.abs(currentPath[1].y - currentPath[0].y)}
                                            fill="none"
                                            stroke={selectedColor === 'transparent' ? '#ffffff' : selectedColor === 'base' ? baseColor : selectedColor}
                                            strokeWidth={2}
                                            vectorEffect="non-scaling-stroke"
                                        />
                                    )}
                                    {currentPath.length >= 2 && activeTool === 'circle' && (
                                        <circle
                                            cx={currentPath[0].x}
                                            cy={currentPath[0].y}
                                            r={currentPath[0].distanceTo(currentPath[1])}
                                            fill="none"
                                            stroke={selectedColor === 'transparent' ? '#ffffff' : selectedColor === 'base' ? baseColor : selectedColor}
                                            strokeWidth={2}
                                            vectorEffect="non-scaling-stroke"
                                        />
                                    )}
                                </g>
                            </svg>
                         </div>
                    </div>

                    {/* Right: Palette */}
                    <div className="w-64 bg-gray-900 border-l border-gray-800 p-4 overflow-y-auto">
                        <div className="mb-6 space-y-3">
                             <h3 className="text-sm font-medium text-gray-300">Tools</h3>
                             <div className="grid grid-cols-2 gap-2 bg-gray-800 p-1 rounded-lg">
                                 <button
                                     onClick={() => setActiveTool('paint')}
                                     className={`flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${activeTool === 'paint' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                                 >
                                     <Droplet size={16} />
                                     Paint
                                 </button>
                                 <button
                                     onClick={() => setActiveTool('draw')}
                                     className={`flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${activeTool === 'draw' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                                 >
                                     <Pencil size={16} />
                                     Draw
                                 </button>

                                 <button
                                     onClick={() => setActiveTool('eraser')}
                                     className={`flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${activeTool === 'eraser' ? 'bg-red-500/20 text-red-400 shadow-sm border border-red-500/50' : 'text-gray-400 hover:text-red-400 hover:bg-red-500/10'}`}
                                 >
                                     <Eraser size={16} />
                                     Erase
                                 </button>

                                 <button
                                     onClick={() => setActiveTool('exclude')}
                                     className={`flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${activeTool === 'exclude' ? 'bg-orange-500/20 text-orange-400 shadow-sm border border-orange-500/50' : 'text-gray-400 hover:text-orange-400 hover:bg-orange-500/10'}`}
                                     title="Toggle Grip Exclusion Zone"
                                 >
                                     <Ban size={16} />
                                     Exclude
                                 </button>
                                 
                                 {/* Shape Menu Toggle */}
                                 <div className="relative">
                                     <button
                                         onClick={() => setShowShapeMenu(!showShapeMenu)}
                                         className={`w-full flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${(activeTool === 'rectangle' || activeTool === 'circle') ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                                     >
                                         {activeTool === 'circle' ? <Circle size={16} /> : <Square size={16} />}
                                         {activeTool === 'circle' ? 'Circle' : (activeTool === 'rectangle' ? 'Rect' : 'Shapes')}
                                     </button>
                                     {showShapeMenu && (
                                         <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg overflow-hidden z-20 flex flex-col">
                                             <button
                                                 onClick={() => { setActiveTool('rectangle'); setShowShapeMenu(false); }}
                                                 className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-700 ${activeTool === 'rectangle' ? 'text-white bg-gray-700' : 'text-gray-400'}`}
                                             >
                                                 <Square size={14} /> Rect
                                             </button>
                                             <button
                                                 onClick={() => { setActiveTool('circle'); setShowShapeMenu(false); }}
                                                 className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-700 ${activeTool === 'circle' ? 'text-white bg-gray-700' : 'text-gray-400'}`}
                                             >
                                                 <Circle size={14} /> Circle
                                             </button>
                                         </div>
                                     )}
                                 </div>
                                 
                                 <button
                                     onClick={() => setActiveTool('text' as any)}
                                     className={`flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${activeTool === 'text' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                                     title="Add Text"
                                 >
                                      <span className="font-serif font-bold text-lg leading-none">T</span>
                                      Text
                                  </button>
                                  <button
                                      onClick={() => {
                                          showAlert({
                                              title: "Flatten Colors",
                                              message: "Enter color similarity threshold (0-100). Higher values merge more colors.",
                                              inputType: 'number',
                                              defaultValue: "10",
                                              inputPlaceholder: "10",
                                              onConfirm: (val) => {
                                                  const threshold = Number(val);
                                                  if (!isNaN(threshold)) {
                                                      const newShapes = flattenColors(localShapes, threshold);
                                                      setLocalShapes(newShapes);
                                                  }
                                              }
                                          });
                                      }}
                                      className={`h-10 px-3 rounded-lg flex items-center justify-center gap-2 transition-all hover:bg-gray-700 text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500`}
                                      title="Merge similar colors"
                                  >
                                      <Palette size={18} />
                                      <span className="text-sm font-medium">Flatten</span>
                                  </button>
                              </div>
                          </div>

                         <h3 className="text-sm font-medium text-gray-300 mb-2 mt-4">Custom Color</h3>
                         <div className="flex items-center gap-2 mb-4 bg-gray-800 p-1.5 rounded-lg border border-gray-700">
                             <button
                                 onClick={() => setIsEyedropperActive(!isEyedropperActive)}
                                 className={`p-2 rounded-md hover:bg-gray-700 transition-colors ${isEyedropperActive ? 'bg-purple-600/20 text-purple-400 ring-1 ring-purple-500/50' : 'text-gray-400'}`}
                                 title="Pick color from shape"
                             >
                                 <Pipette size={18} />
                             </button>
                             <div className="h-6 w-px bg-gray-700" />
                             <div className="flex-1 flex items-center gap-2 px-2">
                                 <span className="text-gray-500 text-xs font-mono">#</span>
                                 <input
                                     type="text"
                                     value={selectedColor === 'transparent' || selectedColor === 'base' ? '' : selectedColor.replace('#', '')}
                                     onChange={(e) => {
                                         const val = e.target.value;
                                         if (/^[0-9A-Fa-f]{0,6}$/.test(val)) {
                                              setSelectedColor(val ? `#${val}` : '#000000');
                                         }
                                     }}
                                     className="flex-1 bg-transparent border-none focus:outline-none text-sm font-mono text-white uppercase placeholder-gray-600"
                                     placeholder={selectedColor === 'base' ? "BASE" : "HEX"}
                                     disabled={selectedColor === 'base'}
                                 />
                             </div>
                             <div 
                                 className="w-8 h-8 rounded border border-gray-600 shadow-inner" 
                                 style={{ backgroundColor: selectedColor === 'transparent' ? 'transparent' : (selectedColor === 'base' ? baseColor : selectedColor) }}
                             />
                         </div>

                         <h3 className="text-sm font-medium text-gray-300 mb-4">Select Color</h3>
                         <div className="grid grid-cols-4 gap-2">
                                   <button
                                       onClick={() => setSelectedColor('base')}
                                       className={`col-span-2 flex items-center justify-center gap-2 h-10 rounded-lg transition-all border ${selectedColor === 'base' ? 'border-white ring-1 ring-white' : 'border-gray-600 hover:border-gray-500'}`}
                                       style={{ backgroundColor: baseColor }}
                                       title="Match Base Color"
                                   >
                                       <span className="text-xs font-bold uppercase text-white drop-shadow-md">Base</span>
                                   </button>
                                   <button
                                       onClick={() => setSelectedColor('transparent')}
                                className={`w-10 h-10 rounded-lg transition-all relative overflow-hidden ${selectedColor === 'transparent' ? 'ring-2 ring-white scale-110 z-10' : 'hover:scale-105 hover:ring-1 hover:ring-white/30'}`}
                                title="Transparent (Hole)"
                            >
                                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjUiIGhlaWdodD0iNSIgeD0iMCIgeT0iMCIgZmlsbD0iIzMzMyIvPjxyZWN0IHdpZHRoPSI1IiBoZWlnaHQ9IjUiIHg9IjUiIHk9IjUiIGZpbGw9IiMzMzMiLz48L3N2Zz4=')] opacity-50" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-full h-px bg-red-500 rotate-45" />
                                </div>
                            </button>
                            {Object.entries(COLORS).map(([name, value]) => (
                                <button
                                    key={value}
                                    onClick={() => setSelectedColor(value)}
                                    className={`w-10 h-10 rounded-lg transition-all ${selectedColor === value ? 'ring-2 ring-white scale-110 z-10' : 'hover:scale-105 hover:ring-1 hover:ring-white/30'}`}
                                    style={{ backgroundColor: value }}
                                    title={name}
                                />
                            ))}
                        </div>
                        
                        <div className="mt-6 p-4 bg-gray-800 rounded-lg">
                            <div className="flex items-center gap-3 mb-2">
                                <div 
                                    className="w-12 h-12 rounded-lg border border-gray-600 shadow-inner relative overflow-hidden"
                                >
                                    {selectedColor === 'transparent' ? (
                                        <>
                                            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjUiIGhlaWdodD0iNSIgeD0iMCIgeT0iMCIgZmlsbD0iIzMzMyIvPjxyZWN0IHdpZHRoPSI1IiBoZWlnaHQ9IjUiIHg9IjUiIHk9IjUiIGZpbGw9IiMzMzMiLz48L3N2Zz4=')] opacity-50" />
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <div className="w-[150%] h-0.5 bg-red-500 rotate-45" />
                                            </div>
                                        </>
                                    ) : (
                                        <div className="w-full h-full" style={{ backgroundColor: selectedColor }} />
                                    )}
                                </div>
                                <div>
                                    <div className="text-xs text-gray-400">Active Color</div>
                                    <div className="text-sm font-mono text-white">{selectedColor}</div>
                                </div>
                            </div>
                            <p className="text-xs text-gray-500 leading-relaxed">
                                Click any shape in the preview to apply this color.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-800 flex justify-end gap-3 bg-gray-900">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex items-center gap-2 px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-purple-900/20"
                    >
                        <Check size={18} />
                        Save Changes
                    </button>
                </div>

            </div>
        </div>
    );
};

export default SVGPaintModal;
