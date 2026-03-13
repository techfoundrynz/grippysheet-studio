import React, { useState, useEffect, useRef, useCallback } from 'react';
import { HexColorPicker } from 'react-colorful';
import * as opentype from 'opentype.js';
import { useAlert } from '../context/AlertContext';
import {
    X, Check, Pipette, Palette, Droplet, Pencil, Square, Circle, Eraser,
    Undo2, Redo2, MousePointer2, Triangle, Copy, Trash2, ZoomIn, ZoomOut,
    Type, Upload, ChevronDown
} from 'lucide-react';
import * as THREE from 'three';
import { COLORS } from '../constants/colors';
import { flattenColors } from '../utils/colorUtils';
import { generateSVGPath } from '../utils/dxfUtils';
import { getShapesBounds } from '../utils/patternUtils';

// ── Preset fonts — WOFF v1 via fontsource/jsDelivr (opentype.js supports TTF/OTF/WOFF, NOT WOFF2) ──
interface PresetFont { name: string; label: string; url: string; }
const CDN = 'https://cdn.jsdelivr.net/npm/@fontsource';
const PRESET_FONTS: PresetFont[] = [
    { name: 'roboto',       label: 'Roboto',            url: `${CDN}/roboto/files/roboto-latin-400-normal.woff` },
    { name: 'roboto-bold',  label: 'Roboto Bold',       url: `${CDN}/roboto/files/roboto-latin-700-normal.woff` },
    { name: 'lato',         label: 'Lato',              url: `${CDN}/lato/files/lato-latin-400-normal.woff` },
    { name: 'lato-bold',    label: 'Lato Bold',         url: `${CDN}/lato/files/lato-latin-700-normal.woff` },
    { name: 'oswald',       label: 'Oswald',            url: `${CDN}/oswald/files/oswald-latin-400-normal.woff` },
    { name: 'bebas',        label: 'Bebas Neue',        url: `${CDN}/bebas-neue/files/bebas-neue-latin-400-normal.woff` },
    { name: 'montserrat',   label: 'Montserrat',        url: `${CDN}/montserrat/files/montserrat-latin-400-normal.woff` },
    { name: 'playfair',     label: 'Playfair Display',  url: `${CDN}/playfair-display/files/playfair-display-latin-400-normal.woff` },
    { name: 'jetbrains',    label: 'JetBrains Mono',    url: `${CDN}/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff` },
];

// ── Convert an opentype.js font to THREE.Shape[] for text ────────────────────
function generateTextShapesFromOpentype(
    font: opentype.Font,
    text: string,
    fontSize: number
): THREE.Shape[] {
    const scale = fontSize / font.unitsPerEm;
    const glyphs = font.stringToGlyphs(text);
    const allShapes: THREE.Shape[] = [];
    let x = 0;

    for (const glyph of glyphs) {
        const path = glyph.getPath(x, 0, fontSize);
        x += (glyph.advanceWidth ?? 0) * scale;

        if (!path.commands || path.commands.length === 0) continue;

        // Use ShapePath so toShapes() can detect holes via winding
        const shapePath = new THREE.ShapePath();
        for (const cmd of path.commands) {
            switch (cmd.type) {
                case 'M': shapePath.moveTo(cmd.x,  -cmd.y); break;
                case 'L': shapePath.lineTo(cmd.x,  -cmd.y); break;
                case 'Q': shapePath.quadraticCurveTo(cmd.x1, -cmd.y1, cmd.x, -cmd.y); break;
                case 'C': shapePath.bezierCurveTo(cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y); break;
                case 'Z': break; // sub-path closing handled by toShapes() winding detection
            }
        }
        allShapes.push(...shapePath.toShapes(true));
    }
    return allShapes;
}

interface ShapeEntry {
    shape: THREE.Shape;
    color: string;
    opacity?: number;
    strokeWidth?: number;
    strokeColor?: string;
}

interface SVGPaintModalProps {
    isOpen: boolean;
    onClose: () => void;
    shapes: any[];
    onSave: (shapes: any[]) => void;
    baseColor: string;
}

type ActiveTool = 'select' | 'paint' | 'draw' | 'rectangle' | 'circle' | 'triangle' | 'eraser' | 'text';

// Compute the bounding box of a THREE.Shape in shape-space (Y is NOT flipped)
function getShapeBBox(shape: THREE.Shape): { minX: number; minY: number; maxX: number; maxY: number } {
    const pts = shape.getPoints(16);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
}

function boxesOverlap(
    a: { minX: number; minY: number; maxX: number; maxY: number },
    b: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

const MAX_HISTORY = 50;

const SVGPaintModal: React.FC<SVGPaintModalProps> = ({ isOpen, onClose, shapes, onSave, baseColor }) => {
    const { showAlert } = useAlert();
    const [localShapes, setLocalShapes] = useState<ShapeEntry[]>([]);
    const [selectedColor, setSelectedColor] = useState<string>(COLORS.White);
    const [isEyedropperActive, setIsEyedropperActive] = useState(false);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [activeOpacity, setActiveOpacity] = useState(1);
    const [activeStrokeWidth, setActiveStrokeWidth] = useState(0);

    // Font state
    const [activeFontKey, setActiveFontKey] = useState<string>(PRESET_FONTS[0].name);
    const [fontSize, setFontSize] = useState(20);
    const fontCacheRef = useRef<Map<string, opentype.Font>>(new Map());
    const [loadingFontKey, setLoadingFontKey] = useState<string | null>(null);
    const [customFonts, setCustomFonts] = useState<Array<{ name: string; label: string }>>([]);
    const customFontCacheRef = useRef<Map<string, opentype.Font>>(new Map());

    // Viewport State
    const [vbParams, setVbParams] = useState({ x: 0, y: 0, w: 500, h: 500 });
    const [activeTool, setActiveTool] = useState<ActiveTool>('paint');
    const [currentPath, setCurrentPath] = useState<THREE.Vector2[]>([]);

    // Selection state
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

    // Marquee state
    const marqueeStart = useRef<THREE.Vector2 | null>(null);
    const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

    // Drag-move state
    const isDraggingSelection = useRef(false);
    const dragLastPt = useRef<THREE.Vector2 | null>(null);
    // Accumulated offset during drag — applied as SVG translate so shape coords never change mid-drag
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const [dragRenderOffset, setDragRenderOffset] = useState({ x: 0, y: 0 });
    const rafRef = useRef<number | null>(null);

    // History
    const history = useRef<ShapeEntry[][]>([]);
    const historyIndex = useRef(-1);

    // Zoom/Pan State
    const isPanning = useRef(false);
    const panStart = useRef({ x: 0, y: 0 });
    const viewBoxStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

    const svgRef = useRef<SVGSVGElement>(null);

    // ── History helpers ────────────────────────────────────────────────────────
    const pushHistory = useCallback((shapes: ShapeEntry[]) => {
        const next = history.current.slice(0, historyIndex.current + 1);
        next.push(shapes.map(s => ({ ...s })));
        if (next.length > MAX_HISTORY) next.shift();
        history.current = next;
        historyIndex.current = next.length - 1;
    }, []);

    const undo = useCallback(() => {
        if (historyIndex.current > 0) {
            historyIndex.current--;
            setLocalShapes(history.current[historyIndex.current].map(s => ({ ...s })));
            setSelectedIndices(new Set());
        }
    }, []);

    const redo = useCallback(() => {
        if (historyIndex.current < history.current.length - 1) {
            historyIndex.current++;
            setLocalShapes(history.current[historyIndex.current].map(s => ({ ...s })));
            setSelectedIndices(new Set());
        }
    }, []);

    const commitShapes = (newShapes: ShapeEntry[]) => {
        setLocalShapes(newShapes);
        pushHistory(newShapes);
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (isOpen) {
            history.current = [];
            historyIndex.current = -1;
            const initialShapes: ShapeEntry[] = shapes
                ? shapes.map(s => ({
                    shape: s.shape || s,
                    color: s.color || '#ffffff',
                    opacity: s.opacity ?? 1,
                    strokeWidth: s.strokeWidth ?? 0,
                    strokeColor: s.strokeColor,
                }))
                : [];
            setLocalShapes(initialShapes);
            setSelectedIndices(new Set());
            pushHistory(initialShapes);

            const rawShapes = initialShapes.map(s => s.shape);
            if (rawShapes.length > 0) {
                const bounds = getShapesBounds(rawShapes);
                const padding = Math.max(bounds.size.x, bounds.size.y) * 0.15;
                setVbParams({
                    x: bounds.min.x - padding,
                    y: bounds.min.y - padding,
                    w: bounds.size.x + padding * 2,
                    h: bounds.size.y + padding * 2,
                });
            } else {
                setVbParams({ x: 0, y: 0, w: 500, h: 500 });
            }
        }
    }, [isOpen, shapes]);

    const viewBoxString = `${vbParams.x} ${vbParams.y} ${vbParams.w} ${vbParams.h}`;

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName.toLowerCase();
            if (tag === 'input' || tag === 'textarea') return;
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); return; }
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); setSelectedIndices(new Set(localShapes.map((_, i) => i))); return; }
            if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); duplicateSelected(); return; }
            if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
            if (e.key === 'Escape') { setSelectedIndices(new Set()); setActiveTool('paint'); return; }
            if (e.key === 'p' || e.key === 'P') setActiveTool('paint');
            if (e.key === 'd' || e.key === 'D') setActiveTool('draw');
            if (e.key === 'e' || e.key === 'E') setActiveTool('eraser');
            if (e.key === 'r' || e.key === 'R') setActiveTool('rectangle');
            if (e.key === 'c' || e.key === 'C') setActiveTool('circle');
            if (e.key === 't' || e.key === 'T') setActiveTool('text');
            if (e.key === 's' || e.key === 'S') setActiveTool('select');
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, localShapes, selectedIndices, undo, redo]);

    // ── Selection helpers ─────────────────────────────────────────────────────
    const deleteSelected = useCallback(() => {
        if (selectedIndices.size === 0) return;
        const next = localShapes.filter((_, i) => !selectedIndices.has(i));
        commitShapes(next);
        setSelectedIndices(new Set());
    }, [localShapes, selectedIndices]);

    const duplicateSelected = useCallback(() => {
        if (selectedIndices.size === 0) return;
        const offset = vbParams.w * 0.03;
        const copies: ShapeEntry[] = [...selectedIndices].sort().map(i => {
            const s = localShapes[i];
            const newShape = new THREE.Shape();
            const pts = s.shape.getPoints(32);
            pts.forEach((p, idx) => {
                if (idx === 0) newShape.moveTo(p.x + offset, p.y + offset);
                else newShape.lineTo(p.x + offset, p.y + offset);
            });
            newShape.closePath();
            return { ...s, shape: newShape };
        });
        const next = [...localShapes, ...copies];
        commitShapes(next);
        const newSel = new Set(copies.map((_, i) => localShapes.length + i));
        setSelectedIndices(newSel);
    }, [localShapes, selectedIndices, vbParams.w]);

    const recolorSelected = useCallback((color: string) => {
        if (selectedIndices.size === 0) return;
        const next = localShapes.map((s, i) =>
            selectedIndices.has(i) ? { ...s, color, opacity: activeOpacity } : s
        );
        commitShapes(next);
    }, [localShapes, selectedIndices, activeOpacity]);

    // ── SVG point utility ─────────────────────────────────────────────────────
    const getSVGPoint = (e: React.PointerEvent): THREE.Vector2 | null => {
        if (!svgRef.current) return null;
        const pt = svgRef.current.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const transform = svgRef.current.getScreenCTM()?.inverse();
        if (transform) {
            const svgPt = pt.matrixTransform(transform);
            return new THREE.Vector2(svgPt.x, -svgPt.y);
        }
        return null;
    };

    // ── Shape click (paint/erase/select single) ───────────────────────────────
    const handleShapeClick = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();

        if (isEyedropperActive) {
            const chosen = localShapes[index];
            if (chosen?.color) { setSelectedColor(chosen.color); setIsEyedropperActive(false); }
            return;
        }

        if (activeTool === 'select') {
            if (e.shiftKey) {
                setSelectedIndices(prev => {
                    const next = new Set(prev);
                    next.has(index) ? next.delete(index) : next.add(index);
                    return next;
                });
            } else {
                setSelectedIndices(new Set([index]));
            }
            isDraggingSelection.current = false;
            return;
        }

        if (activeTool === 'paint') {
            if (selectedIndices.size > 0) {
                recolorSelected(selectedColor);
            } else {
                const next = [...localShapes];
                next[index] = { ...next[index], color: selectedColor, opacity: activeOpacity };
                commitShapes(next);
            }
        } else if (activeTool === 'eraser') {
            const next = localShapes.filter((_, i) => !selectedIndices.has(i) && i !== index);
            commitShapes(next);
            setSelectedIndices(new Set());
        }
    };

    // ── Pointer handlers ──────────────────────────────────────────────────────
    const handlePointerDown = (e: React.PointerEvent) => {
        (e.target as Element).setPointerCapture(e.pointerId);

        if (e.button === 1 || e.button === 2) {
            e.preventDefault();
            isPanning.current = true;
            panStart.current = { x: e.clientX, y: e.clientY };
            viewBoxStart.current = { ...vbParams };
            return;
        }

        if (activeTool === 'paint' || activeTool === 'eraser') return;

        const pt = getSVGPoint(e);
        if (!pt) return;

        if (activeTool === 'select') {
            marqueeStart.current = pt;
            setMarqueeRect(null);
            dragLastPt.current = pt;
            isDraggingSelection.current = false;

            // If the click lands inside any currently-selected shape's bbox → drag-move
            if (selectedIndices.size > 0) {
                for (const i of selectedIndices) {
                    const bb = getShapeBBox(localShapes[i].shape);
                    if (pt.x >= bb.minX && pt.x <= bb.maxX && pt.y >= bb.minY && pt.y <= bb.maxY) {
                        isDraggingSelection.current = true;
                        break;
                    }
                }
            }
            return;
        }

        if (activeTool === 'text') return;

        if (['draw', 'rectangle', 'circle', 'triangle'].includes(activeTool)) {
            setCurrentPath([pt, pt]);
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (isPanning.current && svgRef.current) {
            const dx = e.clientX - panStart.current.x;
            const dy = e.clientY - panStart.current.y;
            const rect = svgRef.current.getBoundingClientRect();
            const sx = viewBoxStart.current.w / rect.width;
            const sy = viewBoxStart.current.h / rect.height;
            setVbParams({
                ...viewBoxStart.current,
                x: viewBoxStart.current.x - dx * sx,
                y: viewBoxStart.current.y - dy * sy,
            });
            return;
        }

        const pt = getSVGPoint(e);
        if (!pt) return;

        // Marquee / drag-move for select tool
        if (activeTool === 'select') {
            if (marqueeStart.current && e.buttons === 1) {
                if (isDraggingSelection.current && selectedIndices.size > 0 && dragLastPt.current) {
                    // Accumulate offset in a ref — no setLocalShapes, no React re-render
                    const dx = pt.x - dragLastPt.current.x;
                    const dy = pt.y - dragLastPt.current.y;
                    dragLastPt.current = pt;
                    dragOffsetRef.current.x += dx;
                    dragOffsetRef.current.y += dy;
                    // Throttle render update to one per animation frame
                    if (rafRef.current === null) {
                        rafRef.current = requestAnimationFrame(() => {
                            setDragRenderOffset({ ...dragOffsetRef.current });
                            rafRef.current = null;
                        });
                    }
                } else {
                    // Draw marquee
                    const rx = Math.min(marqueeStart.current.x, pt.x);
                    const ry = Math.min(marqueeStart.current.y, pt.y);
                    const rw = Math.abs(pt.x - marqueeStart.current.x);
                    const rh = Math.abs(pt.y - marqueeStart.current.y);
                    setMarqueeRect({ x: rx, y: ry, w: rw, h: rh });
                }
            }
            return;
        }

        if (currentPath.length > 0) {
            if (activeTool === 'draw') {
                const last = currentPath[currentPath.length - 1];
                if (pt.distanceToSquared(last) > 1) {
                    setCurrentPath(prev => [...prev, pt]);
                }
            } else if (['rectangle', 'circle', 'triangle'].includes(activeTool)) {
                setCurrentPath(prev => [prev[0], pt]);
            }
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        (e.target as Element).releasePointerCapture(e.pointerId);

        if (isPanning.current) { isPanning.current = false; return; }

        const pt = getSVGPoint(e);

        // Select tool finalization
        if (activeTool === 'select') {
            if (isDraggingSelection.current) {
                // Commit accumulated offset to actual shape coords — called ONCE on drop
                const { x: ox, y: oy } = dragOffsetRef.current;
                dragOffsetRef.current = { x: 0, y: 0 };
                setDragRenderOffset({ x: 0, y: 0 });
                if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
                isDraggingSelection.current = false;
                if (Math.abs(ox) > 0.001 || Math.abs(oy) > 0.001) {
                    setLocalShapes(prev => {
                        const next = prev.map((s, i) => {
                            if (!selectedIndices.has(i)) return s;
                            const pts = s.shape.getPoints(32);
                            const newShape = new THREE.Shape();
                            pts.forEach((p, idx) => {
                                if (idx === 0) newShape.moveTo(p.x + ox, p.y + oy);
                                else newShape.lineTo(p.x + ox, p.y + oy);
                            });
                            return { ...s, shape: newShape };
                        });
                        pushHistory(next);
                        return next;
                    });
                }
            } else if (marqueeRect && (marqueeRect.w > 2 || marqueeRect.h > 2)) {
                // Marquee select: find all shapes intersecting rect
                const selBox = {
                    minX: marqueeRect.x,
                    minY: marqueeRect.y,
                    maxX: marqueeRect.x + marqueeRect.w,
                    maxY: marqueeRect.y + marqueeRect.h,
                };
                const newSel = new Set<number>();
                localShapes.forEach((s, i) => {
                    const bb = getShapeBBox(s.shape);
                    // bbox is in shape-space (Y not flipped) — marquee is in shape-space too
                    if (boxesOverlap(bb, selBox)) newSel.add(i);
                });
                if (e.shiftKey) {
                    setSelectedIndices(prev => new Set([...prev, ...newSel]));
                } else {
                    setSelectedIndices(newSel);
                }
            } else if (!isDraggingSelection.current && marqueeRect === null && e.type !== 'pointerleave') {
                // Click on empty canvas (genuine pointerup only) → deselect
                setSelectedIndices(new Set());
            }
            marqueeStart.current = null;
            setMarqueeRect(null);
            dragLastPt.current = null;
            return;
        }

        // Text tool
        if (activeTool === 'text') {
            if (e.type === 'pointerleave') return;
            if (pt) {
                showAlert({
                    title: "Add Text",
                    message: "Enter text to add:",
                    inputType: 'text',
                    inputPlaceholder: "Hello",
                    defaultValue: "Text",
                    confirmText: "Add",
                    onConfirm: async (text) => {
                        if (!text) return;
                        const font = await loadFont(activeFontKey)
                            ?? await loadFont(PRESET_FONTS[0].name)  // fallback
                            ?? customFontCacheRef.current.values().next().value;
                        if (!font) {
                            showAlert({ title: 'Font Error', message: 'No font loaded. Check your internet connection.', type: 'error' });
                            return;
                        }
                        const rawShapes = generateTextShapesFromOpentype(font, text, fontSize);
                        // Centre the text block on the click point
                        if (rawShapes.length === 0) return;
                        const allPts = rawShapes.flatMap(s => s.getPoints(8));
                        const minX = Math.min(...allPts.map(p => p.x));
                        const maxX = Math.max(...allPts.map(p => p.x));
                        const offsetX = pt.x - (minX + maxX) / 2;
                        const offsetY = pt.y;
                        const translated = rawShapes.map(s => {
                            const pts2 = s.getPoints(32);
                            const newS = new THREE.Shape();
                            pts2.forEach((p, i) => {
                                if (i === 0) newS.moveTo(p.x + offsetX, p.y + offsetY);
                                else newS.lineTo(p.x + offsetX, p.y + offsetY);
                            });
                            s.holes.forEach(h => {
                                const hPts = h.getPoints(16);
                                const newH = new THREE.Path();
                                hPts.forEach((p, i) => {
                                    if (i === 0) newH.moveTo(p.x + offsetX, p.y + offsetY);
                                    else newH.lineTo(p.x + offsetX, p.y + offsetY);
                                });
                                newS.holes.push(newH);
                            });
                            return newS;
                        });
                        const newEntries: ShapeEntry[] = translated.map(s => ({
                            shape: s, color: selectedColor, opacity: activeOpacity,
                        }));
                        commitShapes([...localShapes, ...newEntries]);
                    }
                });
            }
            return;
        }

        // Drawing tools
        if (currentPath.length >= 2) {
            let shape: THREE.Shape | null = null;

            if (activeTool === 'draw' && currentPath.length > 2) {
                const simplified = [currentPath[0]];
                for (let i = 1; i < currentPath.length; i++) {
                    if (currentPath[i].distanceToSquared(simplified[simplified.length - 1]) > 5) {
                        simplified.push(currentPath[i]);
                    }
                }
                if (simplified[simplified.length - 1] !== currentPath[currentPath.length - 1]) {
                    simplified.push(currentPath[currentPath.length - 1]);
                }
                if (simplified.length > 2) {
                    const curve = new THREE.SplineCurve(simplified);
                    const pts = curve.getPoints(Math.max(50, simplified.length * 5));
                    shape = new THREE.Shape();
                    shape.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
                    shape.closePath();
                }
            } else if (activeTool === 'rectangle') {
                const start = currentPath[0], end = currentPath[1];
                const w = end.x - start.x, h = end.y - start.y;
                if (Math.abs(w) > 0.1 && Math.abs(h) > 0.1) {
                    shape = new THREE.Shape();
                    shape.moveTo(start.x, start.y);
                    shape.lineTo(start.x + w, start.y);
                    shape.lineTo(start.x + w, start.y + h);
                    shape.lineTo(start.x, start.y + h);
                    shape.closePath();
                }
            } else if (activeTool === 'circle') {
                const center = currentPath[0];
                const radius = center.distanceTo(currentPath[1]);
                if (radius > 0.1) {
                    shape = new THREE.Shape();
                    shape.absarc(center.x, center.y, radius, 0, Math.PI * 2, false);
                }
            } else if (activeTool === 'triangle') {
                const start = currentPath[0], end = currentPath[1];
                const w = end.x - start.x, h = end.y - start.y;
                if (Math.abs(w) > 0.1 || Math.abs(h) > 0.1) {
                    shape = new THREE.Shape();
                    shape.moveTo(start.x + w / 2, start.y + h);
                    shape.lineTo(start.x, start.y);
                    shape.lineTo(start.x + w, start.y);
                    shape.closePath();
                }
            }

            if (shape) {
                commitShapes([...localShapes, {
                    shape,
                    color: selectedColor,
                    opacity: activeOpacity,
                    strokeWidth: activeStrokeWidth,
                }]);
            }
        }
        setCurrentPath([]);
    };

    const handleWheel = (e: React.WheelEvent) => {
        if (!svgRef.current) return;
        e.stopPropagation();
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
        const rect = svgRef.current.getBoundingClientRect();
        const rx = (e.clientX - rect.left) / rect.width;
        const ry = (e.clientY - rect.top) / rect.height;
        setVbParams(prev => {
            const newW = prev.w * zoomFactor;
            const newH = prev.h * zoomFactor;
            return {
                x: prev.x + (prev.w - newW) * rx,
                y: prev.y + (prev.h - newH) * ry,
                w: newW,
                h: newH,
            };
        });
    };

    // ── Font loading via opentype.js ─────────────────────────────────────────
    const loadFont = useCallback(async (key: string): Promise<opentype.Font | null> => {
        // Check custom font cache first
        if (customFontCacheRef.current.has(key)) return customFontCacheRef.current.get(key)!;
        // Check preset cache
        if (fontCacheRef.current.has(key)) return fontCacheRef.current.get(key)!;
        const preset = PRESET_FONTS.find(f => f.name === key);
        if (!preset) return null;
        setLoadingFontKey(key);
        try {
            const resp = await fetch(preset.url);
            const buf  = await resp.arrayBuffer();
            const font = opentype.parse(buf);
            fontCacheRef.current.set(key, font);
            return font;
        } catch (e) {
            console.error('[FontLoader] Failed to load', key, e);
            return null;
        } finally {
            setLoadingFontKey(null);
        }
    }, []);

    // Pre-load the default font on mount
    useEffect(() => { loadFont(PRESET_FONTS[0].name); }, []);

    const handleCustomFontUpload = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ttf,.otf,.woff,.woff2';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const buf = await file.arrayBuffer();
                const font = opentype.parse(buf);
                const key = `custom:${file.name}`;
                customFontCacheRef.current.set(key, font);
                const label = file.name.replace(/\.[^/.]+$/, '');
                setCustomFonts(prev => [...prev.filter(f => f.name !== key), { name: key, label }]);
                setActiveFontKey(key);
            } catch (err) {
                console.error('[FontLoader] Failed to parse custom font:', err);
                showAlert({ title: 'Font Error', message: 'Could not load this font file. Try a different .ttf or .otf file.', type: 'error' });
            }
        };
        input.click();
    };

    const handleSave = () => {
        onSave(localShapes);
        onClose();
    };

    const handleColorChange = (hex: string) => {
        setSelectedColor(hex);
        // If shapes are selected, immediately apply color to them
        if (selectedIndices.size > 0) {
            recolorSelected(hex);
        }
    };

    // Zoom controls
    const zoomBy = (factor: number) => {
        setVbParams(prev => {
            const newW = prev.w * factor;
            const newH = prev.h * factor;
            return {
                x: prev.x + (prev.w - newW) * 0.5,
                y: prev.y + (prev.h - newH) * 0.5,
                w: newW,
                h: newH,
            };
        });
    };

    const resetZoom = () => {
        const rawShapes = localShapes.map(s => s.shape);
        if (rawShapes.length > 0) {
            const bounds = getShapesBounds(rawShapes);
            const padding = Math.max(bounds.size.x, bounds.size.y) * 0.15;
            setVbParams({
                x: bounds.min.x - padding,
                y: bounds.min.y - padding,
                w: bounds.size.x + padding * 2,
                h: bounds.size.y + padding * 2,
            });
        }
    };

    // Cursor based on selected tool
    const getCursor = () => {
        if (isEyedropperActive) return 'crosshair';
        switch (activeTool) {
            case 'select': return 'default';
            case 'draw': case 'rectangle': case 'circle': case 'triangle': return 'crosshair';
            case 'paint': return 'cell';
            case 'eraser': return 'not-allowed';
            case 'text': return 'text';
            default: return 'default';
        }
    };

    // Selected shape highlight overlay — rendered inside scale(1,-1) group, use THREE.js coords directly
    const renderSelectionOverlay = () => {
        return [...selectedIndices].map(i => {
            const s = localShapes[i];
            if (!s) return null;
            const bb = getShapeBBox(s.shape);
            // dragRenderOffset shifts selected shapes visually during drag
            const ox = isDraggingSelection.current ? dragRenderOffset.x : 0;
            const oy = isDraggingSelection.current ? dragRenderOffset.y : 0;
            return (
                <rect
                    key={`sel-${i}`}
                    x={bb.minX - 1 + ox}
                    y={bb.minY - 1 + oy}
                    width={bb.maxX - bb.minX + 2}
                    height={bb.maxY - bb.minY + 2}
                    fill="none"
                    stroke="#a78bfa"
                    strokeWidth={1.5}
                    strokeDasharray="4,2"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                />
            );
        });
    };

    // Tool button style helper
    const toolBtn = (tool: ActiveTool, extraActive?: boolean) =>
        `flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${
            activeTool === tool || extraActive
                ? 'bg-purple-600/30 text-purple-300 ring-1 ring-purple-500/50'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
        }`;

    if (!isOpen) return null;

    const canUndo = historyIndex.current > 0;
    const canRedo = historyIndex.current < history.current.length - 1;
    const hasSelection = selectedIndices.size > 0;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200">

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-purple-500/10 rounded-lg text-purple-400">
                            <Droplet size={20} />
                        </div>
                        <h2 className="text-lg font-bold text-white">Paint Inlay</h2>
                        {hasSelection && (
                            <span className="text-xs px-2 py-0.5 bg-purple-600/20 text-purple-300 rounded-full border border-purple-500/30">
                                {selectedIndices.size} selected
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        {/* Undo / Redo */}
                        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
                            className={`p-1.5 rounded-lg transition-colors ${canUndo ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 cursor-not-allowed'}`}>
                            <Undo2 size={16} />
                        </button>
                        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)"
                            className={`p-1.5 rounded-lg transition-colors ${canRedo ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 cursor-not-allowed'}`}>
                            <Redo2 size={16} />
                        </button>
                        <div className="h-4 w-px bg-gray-700 mx-1" />
                        <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 flex min-h-0 overflow-hidden">

                    {/* Canvas Area */}
                    <div className="flex-1 bg-gray-950/50 relative overflow-hidden flex flex-col touch-none">
                        {/* Zoom toolbar */}
                        <div className="absolute top-2 right-2 z-10 flex gap-1 bg-gray-900/80 backdrop-blur-sm border border-gray-700 rounded-lg p-1">
                            <button onClick={() => zoomBy(0.8)} title="Zoom In" className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"><ZoomIn size={14} /></button>
                            <button onClick={() => zoomBy(1.25)} title="Zoom Out" className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"><ZoomOut size={14} /></button>
                            <button onClick={resetZoom} title="Reset Zoom" className="px-2 py-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white text-xs transition-colors">Fit</button>
                        </div>

                        <div className="flex-1 p-4">
                            <div className="w-full h-full border border-gray-800 rounded-lg bg-gray-900 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTAgMGgxMHYxMEgwek0xMCAxMGgxMHYxMEgxMHoiIGZpbGw9IiMzNzQxNTEiIGZpbGwtb3BhY2l0eT0iMC40Ii8+PC9zdmc+')]">
                                <svg
                                    ref={svgRef}
                                    viewBox={viewBoxString}
                                    className="w-full h-full"
                                    style={{ cursor: getCursor() }}
                                    onPointerDown={handlePointerDown}
                                    onPointerMove={handlePointerMove}
                                    onPointerUp={handlePointerUp}
                                    onPointerLeave={handlePointerUp}
                                    onWheel={handleWheel}
                                    onContextMenu={(e) => e.preventDefault()}
                                >
                                    {/* Shapes group - Y flipped */}
                                    <g transform="scale(1, -1)">
                                        {localShapes.map((item, index) => {
                                            const d = generateSVGPath([item.shape]);
                                            const isTransparent = item.color === 'transparent';
                                            const displayColor = item.color === 'base' ? baseColor : item.color;
                                            const opacity = item.opacity ?? 1;
                                            const isSelected = selectedIndices.has(index);
                                            const sw = item.strokeWidth ?? 0;
                                            const sc = item.strokeColor ?? displayColor;

                                            const isDragging = isDraggingSelection.current;
                                            const pathEl = (
                                                <path
                                                    d={d}
                                                    fill={isTransparent ? 'none' : displayColor}
                                                    fillOpacity={opacity}
                                                    fillRule="evenodd"
                                                    stroke={isTransparent ? '#4b5563' : (isSelected ? '#a78bfa' : (sw > 0 ? sc : 'none'))}
                                                    strokeWidth={isTransparent ? 1 : (isSelected ? 1.5 : sw)}
                                                    strokeDasharray={isTransparent ? "2,2" : "none"}
                                                    filter={isSelected ? 'brightness(1.2)' : undefined}
                                                    className={`transition-colors duration-75 ${
                                                        (activeTool === 'paint' || activeTool === 'eraser' || isEyedropperActive)
                                                            ? 'cursor-pointer hover:brightness-110'
                                                            : activeTool === 'select'
                                                                ? isSelected
                                                                    ? 'cursor-grab active:cursor-grabbing hover:brightness-110'
                                                                    : 'cursor-pointer hover:brightness-110'
                                                                : 'pointer-events-none'
                                                    }`}
                                                    onClick={(ev) => handleShapeClick(index, ev)}
                                                    vectorEffect="non-scaling-stroke"
                                                    pointerEvents="all"
                                                />
                                            );

                                            // During drag, wrap selected paths in a translate group so
                                            // shape coords never change mid-drag (no setLocalShapes)
                                            if (isSelected && isDragging) {
                                                return (
                                                    <g key={index} transform={`translate(${dragRenderOffset.x}, ${dragRenderOffset.y})`}>
                                                        {pathEl}
                                                    </g>
                                                );
                                            }
                                            return React.cloneElement(pathEl, { key: index });
                                        })}

                                        {/* Selection overlays */}
                                        {renderSelectionOverlay()}

                                        {/* Live draw preview */}
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
                                                strokeWidth={2} vectorEffect="non-scaling-stroke"
                                            />
                                        )}
                                        {currentPath.length >= 2 && activeTool === 'circle' && (
                                            <circle
                                                cx={currentPath[0].x} cy={currentPath[0].y}
                                                r={currentPath[0].distanceTo(currentPath[1])}
                                                fill="none"
                                                stroke={selectedColor === 'transparent' ? '#ffffff' : selectedColor === 'base' ? baseColor : selectedColor}
                                                strokeWidth={2} vectorEffect="non-scaling-stroke"
                                            />
                                        )}
                                        {currentPath.length >= 2 && activeTool === 'triangle' && (() => {
                                            const s = currentPath[0], e = currentPath[1];
                                            const w = e.x - s.x, h = e.y - s.y;
                                            return (
                                                <polygon
                                                    points={`${s.x + w / 2},${s.y + h} ${s.x},${s.y} ${s.x + w},${s.y}`}
                                                    fill="none"
                                                    stroke={selectedColor === 'transparent' ? '#ffffff' : selectedColor === 'base' ? baseColor : selectedColor}
                                                    strokeWidth={2} vectorEffect="non-scaling-stroke"
                                                />
                                            );
                                        })()}
                                        {/* Marquee — inside the flipped group, uses THREE.js coords directly */}
                                        {marqueeRect && (
                                            <rect
                                                x={marqueeRect.x}
                                                y={marqueeRect.y}
                                                width={marqueeRect.w}
                                                height={marqueeRect.h}
                                                fill="rgba(167,139,250,0.08)"
                                                stroke="#a78bfa"
                                                strokeWidth={1}
                                                strokeDasharray="4,2"
                                                vectorEffect="non-scaling-stroke"
                                                pointerEvents="none"
                                            />
                                        )}
                                    </g>
                                </svg>
                            </div>
                        </div>
                    </div>

                    {/* Right Panel */}
                    <div className="w-64 bg-gray-900 border-l border-gray-800 flex flex-col overflow-y-auto">
                        <div className="p-4 space-y-5">

                            {/* ── Tools ── */}
                            <div>
                                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Tools</h3>
                                <div className="grid grid-cols-3 gap-1.5">
                                    <button onClick={() => setActiveTool('select')} title="Select (S)" className={toolBtn('select')}>
                                        <MousePointer2 size={15} /><span className="text-xs">Select</span>
                                    </button>
                                    <button onClick={() => setActiveTool('paint')} title="Paint (P)" className={toolBtn('paint')}>
                                        <Droplet size={15} /><span className="text-xs">Paint</span>
                                    </button>
                                    <button onClick={() => setActiveTool('draw')} title="Draw (D)" className={toolBtn('draw')}>
                                        <Pencil size={15} /><span className="text-xs">Draw</span>
                                    </button>
                                    <button onClick={() => setActiveTool('rectangle')} title="Rectangle (R)" className={toolBtn('rectangle', activeTool === 'rectangle')}>
                                        <Square size={15} /><span className="text-xs">Rect</span>
                                    </button>
                                    <button onClick={() => setActiveTool('circle')} title="Circle (C)" className={toolBtn('circle')}>
                                        <Circle size={15} /><span className="text-xs">Circle</span>
                                    </button>
                                    <button onClick={() => setActiveTool('triangle')} title="Triangle" className={toolBtn('triangle')}>
                                        <Triangle size={15} /><span className="text-xs">Tri</span>
                                    </button>
                                    <button onClick={() => setActiveTool('text' as any)} title="Text (T)" className={toolBtn('text' as any)}>
                                        <Type size={15} /><span className="text-xs">Text</span>
                                    </button>
                                    <button onClick={() => setActiveTool('eraser')} title="Eraser (E)"
                                        className={`flex items-center justify-center gap-1 py-2 rounded-md text-xs font-medium transition-all ${activeTool === 'eraser' ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/50' : 'text-gray-400 hover:text-red-400 hover:bg-red-500/10'}`}>
                                        <Eraser size={15} /><span>Erase</span>
                                    </button>
                                    <button onClick={() => setIsEyedropperActive(v => !v)} title="Eyedropper"
                                        className={`flex items-center justify-center gap-1 py-2 rounded-md text-xs font-medium transition-all ${isEyedropperActive ? 'bg-purple-600/20 text-purple-400 ring-1 ring-purple-500/50' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'}`}>
                                        <Pipette size={15} /><span>Pick</span>
                                    </button>
                                </div>
                            </div>

                            {/* ── Font Settings (text tool) ── */}
                            {activeTool === ('text' as any) && (
                                <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Font</h3>
                                        {loadingFontKey && <span className="text-xs text-purple-400 animate-pulse">Loading…</span>}
                                    </div>

                                    {/* Preset + custom selector */}
                                    <div className="relative">
                                        <select
                                            value={activeFontKey}
                                            onChange={e => { setActiveFontKey(e.target.value); loadFont(e.target.value); }}
                                            className="w-full bg-gray-700 border border-gray-600 rounded-md pl-2 pr-7 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500 appearance-none"
                                        >
                                            <optgroup label="Preset Fonts">
                                                {PRESET_FONTS.map(f => (
                                                    <option key={f.name} value={f.name}>{f.label}</option>
                                                ))}
                                            </optgroup>
                                            {customFonts.length > 0 && (
                                                <optgroup label="Custom Fonts">
                                                    {customFonts.map(f => (
                                                        <option key={f.name} value={f.name}>{f.label}</option>
                                                    ))}
                                                </optgroup>
                                            )}
                                        </select>
                                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                    </div>

                                    {/* Upload custom font */}
                                    <button
                                        onClick={handleCustomFontUpload}
                                        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors border border-gray-600 border-dashed"
                                    >
                                        <Upload size={12} /> Upload Font (.ttf / .otf / .woff)
                                    </button>

                                    {/* Font size */}
                                    <div>
                                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                                            <span>Size</span>
                                            <span className="font-mono">{fontSize}mm</span>
                                        </div>
                                        <input type="range" min="4" max="100" step="1" value={fontSize}
                                            onChange={e => setFontSize(Number(e.target.value))}
                                            className="w-full accent-purple-500 cursor-pointer" />
                                    </div>

                                    <p className="text-xs text-gray-500 leading-relaxed">Click on the canvas to place text at that position.</p>
                                </div>
                            )}

                            {/* ── Selection Actions ── */}
                            {hasSelection && (
                                <div>
                                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Selection ({selectedIndices.size})</h3>
                                    <div className="flex gap-1.5">
                                        <button onClick={duplicateSelected} title="Duplicate (Ctrl+D)"
                                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-700 transition-all border border-gray-700">
                                            <Copy size={12} /> Duplicate
                                        </button>
                                        <button onClick={deleteSelected} title="Delete (Del)"
                                            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium text-red-400 hover:text-white hover:bg-red-500/20 transition-all border border-red-500/30">
                                            <Trash2 size={12} /> Delete
                                        </button>
                                    </div>
                                    <button onClick={() => setSelectedIndices(new Set())}
                                        className="w-full mt-1.5 text-xs text-gray-500 hover:text-gray-300 py-1 hover:bg-gray-800 rounded-md transition-colors">
                                        Deselect (Esc)
                                    </button>
                                </div>
                            )}

                            {/* ── Opacity & Stroke ── */}
                            <div>
                                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Brush Settings</h3>
                                <div className="space-y-3">
                                    <div>
                                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                                            <span>Opacity</span>
                                            <span className="font-mono">{Math.round(activeOpacity * 100)}%</span>
                                        </div>
                                        <input type="range" min="0" max="1" step="0.05" value={activeOpacity}
                                            onChange={e => {
                                                const v = parseFloat(e.target.value);
                                                setActiveOpacity(v);
                                                if (hasSelection) {
                                                    const next = localShapes.map((s, i) => selectedIndices.has(i) ? { ...s, opacity: v } : s);
                                                    commitShapes(next);
                                                }
                                            }}
                                            className="w-full accent-purple-500 cursor-pointer" />
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                                            <span>Stroke Width</span>
                                            <span className="font-mono">{activeStrokeWidth}px</span>
                                        </div>
                                        <input type="range" min="0" max="10" step="0.5" value={activeStrokeWidth}
                                            onChange={e => setActiveStrokeWidth(parseFloat(e.target.value))}
                                            className="w-full accent-purple-500 cursor-pointer" />
                                    </div>
                                </div>
                            </div>

                            {/* ── Color ── */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Color</h3>
                                    <button
                                        onClick={() => setShowColorPicker(v => !v)}
                                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                                    >
                                        <div className="w-4 h-4 rounded border border-gray-600"
                                            style={{ backgroundColor: selectedColor === 'transparent' ? 'transparent' : selectedColor === 'base' ? baseColor : selectedColor }} />
                                        <Palette size={12} />
                                    </button>
                                </div>

                                {showColorPicker && (
                                    <div className="mb-3">
                                        <HexColorPicker
                                            color={selectedColor === 'transparent' || selectedColor === 'base' ? '#ffffff' : selectedColor}
                                            onChange={handleColorChange}
                                            style={{ width: '100%', height: '160px' }}
                                        />
                                        {/* Hex input */}
                                        <div className="flex items-center gap-2 mt-2 bg-gray-800 px-2 py-1.5 rounded-lg border border-gray-700">
                                            <span className="text-gray-500 text-xs font-mono">#</span>
                                            <input
                                                type="text"
                                                value={selectedColor === 'transparent' || selectedColor === 'base' ? '' : selectedColor.replace('#', '')}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    if (/^[0-9A-Fa-f]{0,6}$/.test(val)) {
                                                        const hex = val ? `#${val}` : '#000000';
                                                        handleColorChange(hex);
                                                    }
                                                }}
                                                className="flex-1 bg-transparent text-white text-xs font-mono focus:outline-none uppercase"
                                                placeholder="FFFFFF"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Swatches */}
                                <div className="grid grid-cols-5 gap-1.5">
                                    <button
                                        onClick={() => handleColorChange(baseColor)}
                                        className={`col-span-2 h-8 rounded-lg border text-xs font-bold text-white drop-shadow-sm transition-all ${selectedColor === baseColor || selectedColor === 'base' ? 'ring-2 ring-white' : 'hover:ring-1 hover:ring-white/50 border-gray-600'}`}
                                        style={{ backgroundColor: baseColor }}
                                        title="Base Color"
                                    >Base</button>
                                    <button
                                        onClick={() => setSelectedColor('transparent')}
                                        className={`h-8 rounded-lg border relative overflow-hidden transition-all ${selectedColor === 'transparent' ? 'ring-2 ring-white' : 'hover:ring-1 hover:ring-white/50 border-gray-600'}`}
                                        title="Transparent"
                                    >
                                        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjUiIGhlaWdodD0iNSIgeD0iMCIgeT0iMCIgZmlsbD0iIzMzMyIvPjxyZWN0IHdpZHRoPSI1IiBoZWlnaHQ9IjUiIHg9IjUiIHk9IjUiIGZpbGw9IiMzMzMiLz48L3N2Zz4=')] opacity-60" />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <div className="w-full h-px bg-red-500 rotate-45" />
                                        </div>
                                    </button>
                                    {Object.entries(COLORS).map(([name, value]) => (
                                        <button
                                            key={value}
                                            onClick={() => handleColorChange(value)}
                                            className={`h-8 rounded-lg transition-all ${selectedColor === value ? 'ring-2 ring-white scale-110 z-10' : 'hover:scale-105 hover:ring-1 hover:ring-white/30'}`}
                                            style={{ backgroundColor: value }}
                                            title={name}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* ── Utilities ── */}
                            <div>
                                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Utilities</h3>
                                <div className="flex flex-col gap-1.5">
                                    <button
                                        onClick={() => setSelectedIndices(new Set(localShapes.map((_, i) => i)))}
                                        className="w-full py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded-md transition-colors border border-gray-700"
                                    >Select All (Ctrl+A)</button>
                                    <button
                                        onClick={() => {
                                            showAlert({
                                                title: "Flatten Colors",
                                                message: "Enter color similarity threshold (0-100):",
                                                inputType: 'number',
                                                defaultValue: "10",
                                                inputPlaceholder: "10",
                                                onConfirm: (val) => {
                                                    const threshold = Number(val);
                                                    if (!isNaN(threshold)) {
                                                        commitShapes(flattenColors(localShapes, threshold));
                                                    }
                                                }
                                            });
                                        }}
                                        className="w-full py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded-md transition-colors border border-gray-700"
                                    >Flatten Colors…</button>
                                    <button
                                        onClick={() => {
                                            showAlert({
                                                title: "Clear All Shapes",
                                                message: "Remove all shapes from the canvas?",
                                                type: "warning",
                                                confirmText: "Clear",
                                                onConfirm: () => { commitShapes([]); setSelectedIndices(new Set()); }
                                            });
                                        }}
                                        className="w-full py-1.5 text-xs text-red-400 hover:text-white hover:bg-red-500/20 rounded-md transition-colors border border-red-500/20"
                                    >Clear All</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-between gap-3 bg-gray-900 shrink-0">
                    <div className="text-xs text-gray-500">
                        {localShapes.length} shape{localShapes.length !== 1 ? 's' : ''} · {activeTool} tool · scroll/2-finger to zoom
                    </div>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors">
                            Cancel
                        </button>
                        <button onClick={handleSave} className="flex items-center gap-2 px-5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-purple-900/20">
                            <Check size={16} /> Save Changes
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SVGPaintModal;
