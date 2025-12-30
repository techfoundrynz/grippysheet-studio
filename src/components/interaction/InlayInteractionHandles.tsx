import React, { useMemo, useState, useRef } from 'react';
import * as THREE from 'three';
import { useThree, ThreeEvent, useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { BaseSettings, InlaySettings } from '../../types/schemas';
import { calculateInlayOffset, getShapesBounds } from '../../utils/patternUtils';

interface InlayInteractionHandlesProps {
    baseSettings: BaseSettings;
    inlaySettings: InlaySettings;
    onInlayChange: (settings: InlaySettings) => void;
    setIsDragging: (isDragging: boolean) => void;
    thickness: number; // To position handles slightly above
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
    thickness
}) => {
    const { camera, gl } = useThree();
    const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
    const [hovered, setHovered] = useState<'none' | 'body' | 'tl' | 'tr' | 'bl' | 'br' | 'rot'>('none');
    
    // Refs to hold latest props
    const latestProps = useRef({ baseSettings, inlaySettings, onInlayChange });
    latestProps.current = { baseSettings, inlaySettings, onInlayChange };

    // Helper to get CURRENT effective position (handles auto-alignment)
    const getEffectivePosition = () => {
         const { x, y } = calculateInlayOffset(
            inlaySettings.inlayShapes,
            baseSettings.cutoutShapes,
            baseSettings.size,
            inlaySettings
        );
        return new THREE.Vector3(x, y, 0);
    };

    const effectivePos = getEffectivePosition();

    // Track drag state
    const dragStartRef = useRef<{
        type: 'move' | 'scale' | 'rotate';
        startPoint: THREE.Vector3; 
        startPos: { x: number, y: number }; 
        startScale: number; 
        startRotation?: number;
        startDistance: number; 
    } | null>(null);


    // 1. Unrotated Bounds (unchanged logic)
    const bounds = useMemo(() => {
        if (!inlaySettings.inlayShapes || inlaySettings.inlayShapes.length === 0) {
            return { min: new THREE.Vector2(-50, -50), max: new THREE.Vector2(50, 50), size: new THREE.Vector2(100, 100), center: new THREE.Vector2(0,0) };
        }
        const shapes = (inlaySettings.inlayShapes || []).map((s: any) => s.shape || s);
        return getShapesBounds(shapes);
    }, [inlaySettings.inlayShapes]); 

    // ... Helper functions (getHitPointNative, getHitPointR3F) ...
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

        const { inlaySettings: currentSettings, onInlayChange: currentOnChange } = latestProps.current;

        if (state.type === 'move') {
            const dx = point.x - state.startPoint.x;
            const dy = point.y - state.startPoint.y;
            
            // Switch to manual and apply new position
            currentOnChange({
                ...currentSettings,
                inlayPosition: 'manual',
                inlayPositionX: state.startPos.x + dx,
                inlayPositionY: state.startPos.y + dy
            });
        } else if (state.type === 'scale') {
            const center = new THREE.Vector3(state.startPos.x, state.startPos.y, 0);
            const curDist = point.distanceTo(center);
            
            if (state.startDistance > 0.1) {
                const ratio = curDist / state.startDistance;
                let newScale = state.startScale * ratio;
                newScale = Math.max(0.1, newScale);
                
                // Switch to manual? Maybe not for Scaling?
                // Scaling doesn't strictly require switching to manual position, 
                // but usually direct manipulation implies taking control.
                // However, scaling center-aligned object just scales it in place.
                // We will KEEP current position mode if just scaling.
                
                currentOnChange({
                    ...currentSettings,
                    inlayScale: newScale
                });
            }
        } else if (state.type === 'rotate') {
             const center = new THREE.Vector3(state.startPos.x, state.startPos.y, 0);
             const currentAngle = Math.atan2(point.y - center.y, point.x - center.x);
             const startAngle = Math.atan2(state.startPoint.y - center.y, state.startPoint.x - center.x);
             
             let angleDiff = currentAngle - startAngle;
             // Convert to degrees
             let degDiff = THREE.MathUtils.radToDeg(angleDiff);
             
             let newRotation = (state.startRotation || 0) + degDiff;
             
             currentOnChange({
                 ...currentSettings,
                 inlayRotation: newRotation
             });
        }
    }).current;

    const handleWindowUp = useRef((e: PointerEvent) => {
        setIsDragging(false);
        dragStartRef.current = null;
        window.removeEventListener('pointermove', handleWindowMove);
        window.removeEventListener('pointerup', handleWindowUp);
    }).current;


    // 4. Initial Trigger
    const handlePointerDown = (e: ThreeEvent<PointerEvent>, type: 'move' | 'scale' | 'rotate') => {
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);

        const point = getHitPointR3F(e);
        if (!point) return;

        setIsDragging(true);
        
        // Calculate center based on CURRENT EFFECTIVE position, not just manual props
        // This is crucial for 'center' mode etc.
        const currentEffectivePos = getEffectivePosition();
        const dist = point.distanceTo(currentEffectivePos);

        dragStartRef.current = {
            type,
            startPoint: point,
            startPos: { x: currentEffectivePos.x, y: currentEffectivePos.y },
            startScale: inlaySettings.inlayScale || 1,
            startRotation: inlaySettings.inlayRotation || 0,
            startDistance: dist
        };

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

    // ROTATION HANDLE
    const invScale = 1 / (inlaySettings.inlayScale || 1);
    const rotHandleY = halfH + (30 * 0.02) * invScale; 

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

    return (
        <group
            position={[effectivePos.x, effectivePos.y, thickness]} 
            rotation={[0, 0, (inlaySettings.inlayRotation || 0) * (Math.PI / 180)]}
            scale={[inlaySettings.inlayScale || 1, inlaySettings.inlayScale || 1, 1]}
            // No R3F listeners here anymore
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
                inlayScale={inlaySettings.inlayScale || 1}
            />
            
            {corners.map((c) => (
                <Handle
                    key={c.id}
                    id={c.id}
                    position={[c.x, c.y, 0]}
                    setHovered={setHovered}
                    onDown={handlePointerDown}
                    inlayScale={inlaySettings.inlayScale || 1}
                />
            ))}
        </group>
    );
};
