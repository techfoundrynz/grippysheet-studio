import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { toggleSpikeAt, type SpikePosition } from '../../utils/patternUtils';
import type { GeometrySettings } from '../../types/schemas';

interface TileRemovalHintProps {
    meshRef: React.RefObject<THREE.Group | null>;
    enabled: boolean;
    onGeometryChange: (updater: (prev: GeometrySettings) => GeometrySettings) => void;
}

const REMOVE_COLOR = '#ef4444'; // signal-error — "this will be removed"
const ADD_COLOR = '#ff6b1a';    // brand-500 — "a spike will be added here"

interface PrimarySpikes {
    positions: SpikePosition[];
    tileR: number;
    topZ: number;
}

/**
 * Hover-affordance + click/drag-to-toggle for primary-layer spikes.
 *
 * Click detection intersects the pointer ray with a horizontal plane at the
 * spike-top surface (not the CSG mesh, which returns no raycast hits). The
 * resulting world (x,y) drives `toggleSpikeAt`: nearest spike within tileR is
 * removed (grid → removedTiles, added → splice addedSpikes); an empty gap adds
 * a free spike at the exact point. Pointer down+drag paints a stroke.
 *
 * Reads the rendered primary-layer spikes from `Pattern_0`'s
 * `userData.tilePositions` (origin-tagged) + `userData.tileR`.
 */
export const TileRemovalHint: React.FC<TileRemovalHintProps> = ({
    meshRef,
    enabled,
    onGeometryChange,
}) => {
    const { camera, gl } = useThree();
    const raycaster = useMemo(() => new THREE.Raycaster(), []);
    const plane = useMemo(() => new THREE.Plane(), []);
    const planeNormal = useMemo(() => new THREE.Vector3(0, 0, 1), []);
    const hitPoint = useMemo(() => new THREE.Vector3(), []);
    const [hover, setHover] = useState<{ position: THREE.Vector3; size: number; mode: 'add' | 'remove' } | null>(null);
    const dragging = useRef(false);
    const draggedPoints = useRef<Array<{ x: number; y: number }>>([]);

    // Read the primary spike set (Pattern_0) from the imperative group.
    const readPrimary = (): PrimarySpikes | null => {
        const group = meshRef.current;
        if (!group) return null;
        let mesh: THREE.Mesh | null = null;
        group.traverse((o) => {
            if (o.name === 'Pattern_0' || o.name === 'Pattern') mesh = o as unknown as THREE.Mesh;
        });
        if (!mesh) return null;
        const m: THREE.Mesh = mesh;
        const cached = m.userData?.tilePositions as SpikePosition[] | undefined;
        const tileR = (m.userData?.tileR as number | undefined) ?? 6;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const topZ = m.geometry.boundingBox ? m.geometry.boundingBox.max.z : 5;
        return { positions: cached ?? [], tileR, topZ };
    };

    // Per-frame hover preview using the R3F pointer.
    useFrame((state) => {
        if (!enabled || !meshRef.current) {
            if (hover) setHover(null);
            return;
        }
        const primary = readPrimary();
        if (!primary) {
            if (hover) setHover(null);
            return;
        }
        plane.setFromNormalAndCoplanarPoint(planeNormal, new THREE.Vector3(0, 0, primary.topZ));
        raycaster.setFromCamera(state.pointer, camera);
        if (!raycaster.ray.intersectPlane(plane, hitPoint)) {
            if (hover) setHover(null);
            return;
        }
        let best: SpikePosition | null = null;
        let bestD2 = primary.tileR * primary.tileR;
        for (const p of primary.positions) {
            const dx = p.x - hitPoint.x;
            const dy = p.y - hitPoint.y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= bestD2) { bestD2 = d2; best = p; }
        }
        const mode: 'add' | 'remove' = best ? 'remove' : 'add';
        const px = best ? best.x : hitPoint.x;
        const py = best ? best.y : hitPoint.y;
        const size = primary.tileR * 1.4;
        if (!hover || hover.position.x !== px || hover.position.y !== py || hover.mode !== mode) {
            setHover({ position: new THREE.Vector3(px, py, primary.topZ + 0.5), size, mode });
        }
    });

    // Cursor styling while active.
    useEffect(() => {
        const el = gl.domElement;
        if (enabled) el.style.cursor = 'crosshair';
        else if (el.style.cursor === 'crosshair') el.style.cursor = '';
        return () => { if (el.style.cursor === 'crosshair') el.style.cursor = ''; };
    }, [enabled, gl]);

    // Project a clientX/clientY screen coord onto the spike-top plane → world (x,y).
    // Uses its own scratch result vector (not the frame loop's `hitPoint`) so the
    // pointer path and the per-frame hover path never read each other's writes.
    const clientToWorld = (clientX: number, clientY: number, primary: PrimarySpikes): { x: number; y: number } | null => {
        const rect = gl.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
        );
        plane.setFromNormalAndCoplanarPoint(planeNormal, new THREE.Vector3(0, 0, primary.topZ));
        raycaster.setFromCamera(ndc, camera);
        const out = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, out)) return null;
        return { x: out.x, y: out.y };
    };

    // One toggle at a world point, deduped against the current drag stroke.
    const applyToggle = (wx: number, wy: number, primary: PrimarySpikes) => {
        for (const d of draggedPoints.current) {
            const dx = d.x - wx, dy = d.y - wy;
            if (dx * dx + dy * dy <= primary.tileR * primary.tileR) return;
        }
        draggedPoints.current.push({ x: wx, y: wy });
        onGeometryChange((prev) => {
            const result = toggleSpikeAt(
                wx, wy, primary.positions,
                prev.removedTiles ?? [], prev.addedSpikes ?? [], primary.tileR,
            );
            return { ...prev, removedTiles: result.removedTiles, addedSpikes: result.addedSpikes };
        });
    };

    // Pointer down/move/up drive click + drag-paint.
    useEffect(() => {
        if (!enabled) return;
        const el = gl.domElement;
        const onDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            const primary = readPrimary();
            if (!primary) return;
            dragging.current = true;
            draggedPoints.current = [];
            const w = clientToWorld(e.clientX, e.clientY, primary);
            if (w) applyToggle(w.x, w.y, primary);
        };
        const onMove = (e: PointerEvent) => {
            if (!dragging.current) return;
            const primary = readPrimary();
            if (!primary) return;
            const w = clientToWorld(e.clientX, e.clientY, primary);
            if (w) applyToggle(w.x, w.y, primary);
        };
        const onUp = () => { dragging.current = false; draggedPoints.current = []; };
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        // pointercancel: touch interrupted by a browser gesture would otherwise
        // leave the drag "stuck on" until the next pointerdown.
        window.addEventListener('pointercancel', onUp);
        return () => {
            el.removeEventListener('pointerdown', onDown);
            el.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, gl, onGeometryChange, camera]);

    if (!hover || !enabled) return null;
    const color = hover.mode === 'remove' ? REMOVE_COLOR : ADD_COLOR;
    return (
        <group position={hover.position} renderOrder={998}>
            <mesh>
                <ringGeometry args={[hover.size * 0.45, hover.size * 0.55, 32]} />
                <meshBasicMaterial color={color} transparent opacity={0.95} depthTest={false} depthWrite={false} />
            </mesh>
        </group>
    );
};
