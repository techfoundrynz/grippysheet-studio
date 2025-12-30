import React, { useMemo, useState, useRef } from 'react';
import * as THREE from 'three';
import { useThree, ThreeEvent, useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { BaseSettings, InlaySettings } from '../../types/schemas';
import { getShapesBounds, calculateInlayOffset } from '../../utils/patternUtils';
import { eventBus } from "../../utils/eventBus";

interface InlayInteractionHandlesProps {
    baseSettings: BaseSettings;
    inlaySettings: InlaySettings;
    onInlayChange: (settings: InlaySettings) => void;
    setIsDragging: (isDragging: boolean) => void;
    thickness: number; // To position handles slightly above
    selectedInlayId: string | null;
    setSelectedInlayId?: (id: string | null) => void;
    setPreviewInlay?: (item: any) => void;
}

const HANDLE_PIXEL_SIZE = 12; // Desired size in screen pixels
const BOX_COLOR = '#00ff00'; // Bright Green (Debug style)

const Handle = ({ position, id, setHovered, onDown, inlayScale }: {
    position: [number, number, number],
    id: string,
    setHovered: (id: any) => void,
    onDown: (e: any, type: 'scale' | 'rotate') => void,
    inlayScale: number
}) => {
    const ref = useRef<THREE.Group>(null);
    const { camera, size } = useThree();
    
    useFrame(() => {
        if (!ref.current) return;
        
        let scaleFactor = 1;

        if (camera.type === 'OrthographicCamera') {
            const cam = camera as THREE.OrthographicCamera;
            const viewHeight = (cam.top - cam.bottom) / cam.zoom;
            const pixelSize = viewHeight / size.height;
            scaleFactor = pixelSize * HANDLE_PIXEL_SIZE;
        } else {
            const worldPos = new THREE.Vector3();
            ref.current.getWorldPosition(worldPos);
            const dist = worldPos.distanceTo(camera.position);
            const cam = camera as THREE.PerspectiveCamera;
            const vFOV = THREE.MathUtils.degToRad(cam.fov);
            const heightAtDist = 2 * dist * Math.tan(vFOV / 2);
            const pixelSize = heightAtDist / size.height;
            scaleFactor = pixelSize * HANDLE_PIXEL_SIZE;
        }
        
        const invScale = 1 / (inlayScale || 1);
        ref.current.scale.set(scaleFactor * invScale, scaleFactor * invScale, 1);
    });

    return (
        <group
            ref={ref}
            position={position} 
            scale={[1/(inlayScale || 1), 1/(inlayScale || 1), 1]}
            onPointerDown={(e) => onDown(e, id === 'rot' ? 'rotate' : 'scale')}
            onPointerOver={(e) => { e.stopPropagation(); setHovered(id); }}
            onPointerOut={() => setHovered('none')}
        >
            <mesh renderOrder={999}>
                 <boxGeometry args={[1, 1, 0.01]} />
                 <meshBasicMaterial 
                    color="white"
                    depthTest={false}
                    depthWrite={false}
                    transparent
                 />
            </mesh>
            <Line
                points={[
                    [-0.5, 0.5, 0],
                    [0.5, 0.5, 0],
                    [0.5, -0.5, 0],
                    [-0.5, -0.5, 0],
                    [-0.5, 0.5, 0]
                ]}
                color="black"
                lineWidth={3}
                depthTest={false}
                depthWrite={false}
                transparent
                renderOrder={999}
            />
        </group>
    );
};

export const InlayInteractionHandles: React.FC<InlayInteractionHandlesProps> = ({
    baseSettings,
    inlaySettings,
    onInlayChange,
    setIsDragging,
    thickness,
    selectedInlayId,
    setSelectedInlayId,
    setPreviewInlay
}) => {
    const { camera, gl } = useThree();
    const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
    const [hovered, setHovered] = useState<'none' | 'body' | 'tl' | 'tr' | 'bl' | 'br' | 'rot'>('none');
    const latestPreviewRef = useRef<any>(null);
    const groupRef = useRef<THREE.Group>(null);
    
    // Refs to hold latest props
    const latestProps = useRef({ baseSettings, inlaySettings, onInlayChange, selectedInlayId });
    latestProps.current = { baseSettings, inlaySettings, onInlayChange, selectedInlayId };

    // Find Selected Item (Committed state)
    const selectedItem = useMemo(() => {
        return inlaySettings.items?.find(i => i.id === selectedInlayId) || null;
    }, [inlaySettings.items, selectedInlayId]);

    // Use preview during drag (with snapped values), otherwise committed item
    const displayItem = latestPreviewRef.current || selectedItem;

    // Update outline box transform directly on every frame during drag (no React re-renders)
    useFrame(() => {
        if (groupRef.current && latestPreviewRef.current) {
            const item = latestPreviewRef.current;
            groupRef.current.position.set(item.x || 0, item.y || 0, thickness);
            groupRef.current.rotation.set(0, 0, (item.rotation || 0) * (Math.PI / 180));
            groupRef.current.scale.set(item.scale || 1, item.scale || 1, 1);
        }
    });


    // Track drag state
    const dragStartRef = useRef<{
        type: 'move' | 'scale' | 'rotate';
        startPoint: THREE.Vector3; 
        startPos: { x: number, y: number }; 
        startScale: number; 
        startRotation?: number;
        startDistance: number; 
    } | null>(null);


    // 1. Unrotated Bounds of the SHAPE itself (at scale 1) - Based on committed shapes
    const bounds = useMemo(() => {
        if (!selectedItem || !selectedItem.shapes || selectedItem.shapes.length === 0) {
             return { min: new THREE.Vector2(-50, -50), max: new THREE.Vector2(50, 50), size: new THREE.Vector2(100, 100), center: new THREE.Vector2(0,0) };
        }
        const shapes = selectedItem.shapes.map((s: any) => s.shape || s);
        return getShapesBounds(shapes);
    }, [selectedItem]); 


    // ... Helper functions ...
    const getHitPointNative = (e: PointerEvent) => {
        const rect = gl.domElement.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
        const target = new THREE.Vector3();
        raycaster.ray.intersectPlane(planeRef.current, target);
        return target;
    };
    
    const getHitPointR3F = (e: ThreeEvent<PointerEvent>) => {
         const raycaster = new THREE.Raycaster();
         raycaster.setFromCamera(new THREE.Vector2(e.pointer.x, e.pointer.y), camera);
         const target = new THREE.Vector3();
         raycaster.ray.intersectPlane(planeRef.current, target);
         return target;
    }

    // 3. Global handlers
    const handleWindowMove = useRef((e: PointerEvent) => {
        const state = dragStartRef.current;
        if (!state) return;

        e.preventDefault();
        const point = getHitPointNative(e);
        if (!point) return;

        const { inlaySettings: currentSettings, selectedInlayId: curId } = latestProps.current;
        
        // Find current item to update
        if (!curId || !currentSettings.items) return;
        const itemIndex = currentSettings.items.findIndex(i => i.id === curId);
        if (itemIndex === -1) return;
        
        const curItem = currentSettings.items[itemIndex];
        let newItem = { ...curItem };
        let hasChanges = false;

        if (state.type === 'move') {
            const dx = point.x - state.startPoint.x;
            const dy = point.y - state.startPoint.y;
            
            // Snap to 0.1mm increments
            newItem.x = Math.round((state.startPos.x + dx) * 10) / 10;
            newItem.y = Math.round((state.startPos.y + dy) * 10) / 10;
            newItem.positionPreset = 'manual'; // Switch to manual when dragging
            hasChanges = true;

        } else if (state.type === 'scale') {
            const center = new THREE.Vector3(state.startPos.x, state.startPos.y, 0);
            const curDist = point.distanceTo(center);
            
            if (state.startDistance > 0.1) {
                const ratio = curDist / state.startDistance;
                let newScale = state.startScale * ratio;
                newItem.scale = Math.max(0.01, Math.round(newScale * 20) / 20);
                
                // Recalculate position if using a preset
                if (newItem.positionPreset && newItem.positionPreset !== 'manual' && newItem.shapes && newItem.shapes.length > 0) {
                    const { baseSettings } = latestProps.current;
                    const offset = calculateInlayOffset(
                        newItem.shapes,
                        null,
                        baseSettings.size,
                        {
                            inlayScale: newItem.scale,
                            inlayRotation: newItem.rotation || 0,
                            inlayMirror: newItem.mirror || false,
                            inlayPosition: newItem.positionPreset,
                        }
                    );
                    newItem.x = offset.x;
                    newItem.y = offset.y;
                }
                
                hasChanges = true;
            }
        } else if (state.type === 'rotate') {
             const center = new THREE.Vector3(state.startPos.x, state.startPos.y, 0);
             const currentAngle = Math.atan2(point.y - center.y, point.x - center.x);
             const startAngle = Math.atan2(state.startPoint.y - center.y, state.startPoint.x - center.x);
             
             let angleDiff = currentAngle - startAngle;
             let degDiff = THREE.MathUtils.radToDeg(angleDiff);
             
             // Snap to 1° increments
             newItem.rotation = Math.round((state.startRotation || 0) + degDiff);
             
             // Recalculate position if using a preset
             if (newItem.positionPreset && newItem.positionPreset !== 'manual' && newItem.shapes && newItem.shapes.length > 0) {
                 const { baseSettings } = latestProps.current;
                 const offset = calculateInlayOffset(
                     newItem.shapes,
                     null,
                     baseSettings.size,
                     {
                         inlayScale: newItem.scale || 1,
                         inlayRotation: newItem.rotation,
                         inlayMirror: newItem.mirror || false,
                         inlayPosition: newItem.positionPreset,
                     }
                 );
                 newItem.x = offset.x;
                 newItem.y = offset.y;
             }
             
             hasChanges = true;
        }

        if (hasChanges) {
            // Only update ref for outline box - don't trigger re-renders during drag
            latestPreviewRef.current = newItem;
            
            // Emit event for live preview in ImperativeModel (High Performance)
            eventBus.emit('INLAY_TRANSFORM', newItem);
        }

    }).current;

    const handleWindowUp = useRef((e: PointerEvent) => {
        setIsDragging(false);
        dragStartRef.current = null;
        window.removeEventListener('pointermove', handleWindowMove);
        window.removeEventListener('pointerup', handleWindowUp);

        // Commit changes if we have a preview
        if (latestPreviewRef.current) {
             const { inlaySettings: currentSettings, onInlayChange: currentOnChange, selectedInlayId: curId } = latestProps.current;
             if (curId && currentSettings.items) {
                 const itemIndex = currentSettings.items.findIndex(i => i.id === curId);
                 if (itemIndex !== -1) {
                     const newItems = [...currentSettings.items];
                     newItems[itemIndex] = latestPreviewRef.current;
                     currentOnChange({
                         ...currentSettings,
                         items: newItems
                     });
                 }
             }
             if (setPreviewInlay) {
                 setPreviewInlay(null);
             }
             latestPreviewRef.current = null;
        }

    }).current;


    // 4. Initial Trigger
    const handlePointerDown = (e: ThreeEvent<PointerEvent>, type: 'move' | 'scale' | 'rotate') => {
        if (!selectedItem) return;
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);

        const point = getHitPointR3F(e);
        if (!point) return;

        setIsDragging(true);
        
        // Center is the item's current position
        const center = new THREE.Vector3(selectedItem.x || 0, selectedItem.y || 0, 0);
        const dist = point.distanceTo(center);

        dragStartRef.current = {
            type,
            startPoint: point,
            startPos: { x: center.x, y: center.y },
            startScale: selectedItem.scale || 1,
            startRotation: selectedItem.rotation || 0,
            startDistance: dist
        };
        
        // Initialize preview
        if (setPreviewInlay) {
            setPreviewInlay({ ...selectedItem });
        }
        latestPreviewRef.current = { ...selectedItem };

        window.addEventListener('pointermove', handleWindowMove);
        window.addEventListener('pointerup', handleWindowUp);
    };

    // Cleanup
    React.useEffect(() => {
        return () => {
            window.removeEventListener('pointermove', handleWindowMove);
            window.removeEventListener('pointerup', handleWindowUp);
        };
    }, []);

    // ROTATION HANDLE
    const invScale = displayItem ? (1 / (displayItem.scale || 1)) : 1;
    
    // --- Custom Cursors ---
    const createCursorUrl = (svgContent: string) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svgContent.trim())}") 16 16, auto`;

    const rotateCursorSvg = `
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g stroke="black" stroke-width="4" stroke-linecap="round">
            <path d="M16 4C9.37 4 4 9.37 4 16S9.37 28 16 28 28 22.63 28 16" stroke-dasharray="4 6"/>
            <path d="M28 16L24 12M28 16L24 20"/>
        </g>
        <g stroke="white" stroke-width="2" stroke-linecap="round">
            <path d="M16 4C9.37 4 4 9.37 4 16S9.37 28 16 28 28 22.63 28 16" stroke-dasharray="4 6"/>
            <path d="M28 16L24 12M28 16L24 20"/>
        </g>
        <circle cx="16" cy="16" r="2.5" fill="white" stroke="black" stroke-width="1.5"/>
    </svg>`;

    const moveCursorSvg = `
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g stroke="black" stroke-width="4" stroke-linecap="round">
            <path d="M16 4V28M4 16H28"/>
            <path d="M16 4L12 8M16 4L20 8"/>
            <path d="M16 28L12 24M16 28L20 24"/>
            <path d="M4 16L8 12M4 16L8 20"/>
            <path d="M28 16L24 12M28 16L24 20"/>
        </g>
        <g stroke="white" stroke-width="2" stroke-linecap="round">
            <path d="M16 4V28M4 16H28"/>
            <path d="M16 4L12 8M16 4L20 8"/>
            <path d="M16 28L12 24M16 28L20 24"/>
            <path d="M4 16L8 12M4 16L8 20"/>
            <path d="M28 16L24 12M28 16L24 20"/>
        </g>
        <circle cx="16" cy="16" r="2.5" fill="white" stroke="black" stroke-width="1.5"/>
    </svg>`;

    const resizeDiag1Svg = `
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g stroke="black" stroke-width="4" stroke-linecap="round">
            <path d="M6 6L26 26"/>
            <path d="M6 6H12M6 6V12"/>
            <path d="M26 26H20M26 26V20"/>
        </g>
        <g stroke="white" stroke-width="2" stroke-linecap="round">
            <path d="M6 6L26 26"/>
            <path d="M6 6H12M6 6V12"/>
            <path d="M26 26H20M26 26V20"/>
        </g>
        <circle cx="16" cy="16" r="2.5" fill="white" stroke="black" stroke-width="1.5"/>
    </svg>`;

    const resizeDiag2Svg = `
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g stroke="black" stroke-width="4" stroke-linecap="round">
            <path d="M26 6L6 26"/>
            <path d="M26 6H20M26 6V12"/>
            <path d="M6 26H12M6 26V20"/>
        </g>
        <g stroke="white" stroke-width="2" stroke-linecap="round">
            <path d="M26 6L6 26"/>
            <path d="M26 6H20M26 6V12"/>
            <path d="M6 26H12M6 26V20"/>
        </g>
        <circle cx="16" cy="16" r="2.5" fill="white" stroke="black" stroke-width="1.5"/>
    </svg>`;

    const cursors = useMemo(() => ({
        rot: createCursorUrl(rotateCursorSvg),
        move: createCursorUrl(moveCursorSvg),
        nwse: createCursorUrl(resizeDiag1Svg),
        nesw: createCursorUrl(resizeDiag2Svg),
    }), []);

    React.useEffect(() => {
        const setCursor = (c: string) => document.body.style.cursor = c;
        if (dragStartRef.current) return;
        
        switch (hovered) {
            case 'body': setCursor(cursors.move); break;
            case 'tl': setCursor(cursors.nwse); break;
            case 'tr': setCursor(cursors.nesw); break;
            case 'bl': setCursor(cursors.nesw); break;
            case 'br': setCursor(cursors.nwse); break;
            case 'rot': setCursor(cursors.rot); break;
            default: setCursor('auto'); break;
        }
        return () => { if (!dragStartRef.current) setCursor('auto'); };
    }, [hovered]);

    if (!displayItem || !displayItem.shapes || displayItem.shapes.length === 0) return null;

    const width = bounds.size.x;
    const height = bounds.size.y;
    // ... corners logic
    const halfW = width / 2;
    const halfH = height / 2;

    const corners = [
        { x: -halfW, y: halfH, cursor: 'nw-resize', id: 'tl' },
        { x: halfW, y: halfH, cursor: 'ne-resize', id: 'tr' },
        { x: -halfW, y: -halfH, cursor: 'sw-resize', id: 'bl' },
        { x: halfW, y: -halfH, cursor: 'se-resize', id: 'br' },
    ];

    const rotHandleY = halfH + (30 * 0.02) * invScale;

    return (
        <group
            ref={groupRef}
            position={[displayItem.x, displayItem.y, thickness]} 
            rotation={[0, 0, (displayItem.rotation || 0) * (Math.PI / 180)]}
            scale={[displayItem.scale || 1, displayItem.scale || 1, 1]}
        >
            <mesh
                onPointerDown={(e) => handlePointerDown(e, 'move')}
                onPointerOver={(e) => { e.stopPropagation(); setHovered('body'); }}
                onPointerOut={() => setHovered('none')}
            >
                <planeGeometry args={[width, height]} />
                <meshBasicMaterial color="orange" opacity={0.001} transparent depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            {/* 2. Visual Box (Dashed) - Now Thicker using Drei Line */}
            <Line
                points={[
                    [-width / 2, height / 2, 0],
                    [width / 2, height / 2, 0],
                    [width / 2, -height / 2, 0],
                    [-width / 2, -height / 2, 0],
                    [-width / 2, height / 2, 0]
                ]}
                color={BOX_COLOR}
                lineWidth={3} 
                opacity={0.8}
                transparent
                depthTest={false}
                depthWrite={false}
                renderOrder={998}
            />
            
            {/* Rotation Line and Handle */}
             <Line
                points={[
                    [0, height / 2, 0],
                    [0, rotHandleY, 0]
                ]}
                color={BOX_COLOR}
                lineWidth={2}
                opacity={0.8}
                transparent
                depthTest={false}
                depthWrite={false}
                renderOrder={998}
            />
             <Handle
                id="rot"
                position={[0, rotHandleY, 0]}
                setHovered={setHovered}
                onDown={handlePointerDown}
                inlayScale={displayItem.scale || 1}
            />
            
            {corners.map((c) => (
                <Handle
                    key={c.id}
                    id={c.id}
                    position={[c.x, c.y, 0]}
                    setHovered={setHovered}
                    onDown={handlePointerDown}
                    inlayScale={displayItem.scale || 1}
                />
            ))}
        </group>
    );
};
