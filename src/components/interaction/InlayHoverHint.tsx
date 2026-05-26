import React, { useState, useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';

interface InlayHoverHintProps {
    meshRef: React.RefObject<THREE.Group | null>;
    selectedInlayId: string | null;
    setSelectedInlayId?: (id: string | null) => void;
    isDragging: boolean;
}

const HOVER_COLOR = '#ff6b1a'; // brand-500 — reads as "available action"

/**
 * Hover affordance for inlay meshes in 3D. Without this, users have no visual
 * hint that the imperative Inlay_* meshes built by ImperativeModel are
 * interactive — the green InlayInteractionHandles only appear after click.
 *
 * Strategy:
 *   - Raycast on every frame using R3F's `state.pointer`. The InlayGroup lives
 *     under meshRef; we intersect against its descendants only.
 *   - Hovered mesh name follows the convention `Inlay_<id>_<tileIdx>_<shapeIdx>`
 *     — pull the id out so we can render the outline + dispatch select.
 *   - Render a THREE.LineSegments (via EdgesGeometry) overlaid on the hovered
 *     mesh. EdgesGeometry only emits sharp edges, so the outline reads as a
 *     silhouette of an inlay rather than wireframe noise.
 *   - Suppress when: an inlay is already selected (handles take over), the
 *     user is mid-drag, or meshRef hasn't mounted yet. 2D mode is handled by
 *     the parent (this component isn't rendered at all in 2D).
 *   - Sets `cursor: pointer` on the Canvas DOM element via inline style; resets
 *     to '' (inherit) when not hovering. We avoid `document.body` so we don't
 *     fight InlayInteractionHandles' selected-state cursor logic.
 */
export const InlayHoverHint: React.FC<InlayHoverHintProps> = ({
    meshRef,
    selectedInlayId,
    setSelectedInlayId,
    isDragging,
}) => {
    const { camera, gl } = useThree();
    const raycaster = useMemo(() => new THREE.Raycaster(), []);
    const [hovered, setHovered] = useState<{ id: string; geometry: THREE.BufferGeometry } | null>(null);
    const hoveredRef = useRef<{ id: string; geometry: THREE.BufferGeometry } | null>(null);
    hoveredRef.current = hovered;

    // EdgesGeometry derived from the hovered mesh's geometry. Memoized so we
    // don't rebuild on every render — only when the underlying geometry ref
    // changes (i.e. when a different inlay is hovered).
    const edges = useMemo(() => {
        if (!hovered) return null;
        // 30° threshold — picks up clear silhouette edges without leaking
        // interior triangulation lines from ExtrudeGeometry's top/bottom caps.
        return new THREE.EdgesGeometry(hovered.geometry, 30);
    }, [hovered]);

    // Dispose stale EdgesGeometry. Skipping this leaks GPU buffers per
    // hover transition.
    useEffect(() => {
        return () => {
            if (edges) edges.dispose();
        };
    }, [edges]);

    // Raycast each frame. Bail early on the suppress conditions so we don't
    // burn cycles when the hint shouldn't show.
    useFrame((state) => {
        if (selectedInlayId || isDragging || !meshRef.current) {
            if (hoveredRef.current) setHovered(null);
            return;
        }

        const inlayGroup = meshRef.current.getObjectByName('InlayGroup');
        if (!inlayGroup) {
            if (hoveredRef.current) setHovered(null);
            return;
        }

        raycaster.setFromCamera(state.pointer, camera);
        const hits = raycaster.intersectObject(inlayGroup, true);
        // Skip our own outline line + any non-inlay debris.
        const hit = hits.find((h) => h.object.name?.startsWith('Inlay_'));

        if (!hit) {
            if (hoveredRef.current) setHovered(null);
            return;
        }

        // Name shape: Inlay_<id>_<tileIdx>_<shapeIdx>. The id itself may
        // contain underscores (it's user-generated), so slice off the last
        // two segments instead of splitting and taking [1].
        const parts = hit.object.name.split('_');
        const id = parts.slice(1, -2).join('_');
        const geometry = (hit.object as THREE.Mesh).geometry;

        if (!hoveredRef.current || hoveredRef.current.id !== id || hoveredRef.current.geometry !== geometry) {
            setHovered({ id, geometry });
        }
    });

    // Cursor management. Inline style on the Canvas DOM element instead of
    // document.body so InlayInteractionHandles' own document.body cursor
    // logic (when an inlay is selected) isn't trampled.
    useEffect(() => {
        const el = gl.domElement;
        if (hovered) {
            el.style.cursor = 'pointer';
        } else {
            el.style.cursor = '';
        }
        return () => {
            el.style.cursor = '';
        };
    }, [hovered, gl]);

    // Click-to-select. R3F won't auto-deliver onClick to the imperative inlay
    // meshes (they're not in the React tree), so we listen on the canvas DOM
    // element and check the latest hover state. We only act when something
    // is currently hovered — guarantees we don't intercept clicks on empty
    // canvas space (let OrbitControls own those).
    useEffect(() => {
        if (!setSelectedInlayId) return;
        const el = gl.domElement;
        const onClick = () => {
            const h = hoveredRef.current;
            if (!h) return;
            // Don't override an active selection (also gated by the useFrame
            // bail above, but belt-and-braces in case of race).
            if (selectedInlayId) return;
            setSelectedInlayId(h.id);
        };
        el.addEventListener('click', onClick);
        return () => el.removeEventListener('click', onClick);
    }, [gl, setSelectedInlayId, selectedInlayId]);

    if (!hovered || !edges) return null;

    return (
        <lineSegments geometry={edges} renderOrder={997}>
            <lineBasicMaterial
                color={HOVER_COLOR}
                linewidth={2}
                transparent
                opacity={0.95}
                depthTest={false}
                depthWrite={false}
            />
        </lineSegments>
    );
};
