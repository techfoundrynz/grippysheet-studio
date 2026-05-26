import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { tileKey } from '../../utils/patternUtils';
import type { GeometrySettings } from '../../types/schemas';

interface TileRemovalHintProps {
    meshRef: React.RefObject<THREE.Group | null>;
    enabled: boolean;
    /**
     * Callback to mutate the GeometrySettings — same signature as the
     * setGeometrySettings React dispatcher in App.tsx. The hint owns the
     * read/write of `removedTiles` per layer, so it computes the next
     * settings object and passes it through this single channel.
     */
    onGeometryChange: (updater: (prev: GeometrySettings) => GeometrySettings) => void;
}

const HINT_COLOR = '#ef4444'; // signal-error — reads as "destructive action"

/**
 * Hover-affordance + click-to-remove for individual pattern tiles. Mirrors
 * `InlayHoverHint` in shape (in-Canvas R3F frame loop, cursor styling on the
 * Canvas DOM element, click listener installed on the canvas) but targets
 * the pattern meshes named `Pattern` (legacy single-layer) and `Pattern_<i>`
 * (compound-layer build, see the parallel agent's ImperativeModel pass).
 *
 * Identifying which tile was hit:
 *   - For `THREE.InstancedMesh`, raycast intersections include `instanceId`.
 *     We pull the instance's world position out of the matrix and convert
 *     the resulting (x,y) to a `tileKey` for the removedTiles array. The
 *     same `tileKey` is computed against `position` by the construction loop
 *     after `filterRemovedTiles` is applied, so the round-trip stays stable.
 *   - For CSG-merged patterns (clip-to-outline path) the mesh is a single
 *     `Mesh`. We use the world-space hit `point` directly and snap it to
 *     the nearest tile origin by inspecting the tile-positions list cached
 *     on the mesh's `userData.tilePositions`. ImperativeModel populates
 *     this so the click handler has a deterministic source of truth.
 *
 * Mutually exclusive with `InlayHoverHint`: only mounts in pattern-mode and
 * only when the parent toggles `enabled`. While active, the cursor is set
 * to `crosshair` so the mode is visually distinct from the inlay-hover
 * `pointer` and the default `default`.
 */
export const TileRemovalHint: React.FC<TileRemovalHintProps> = ({
    meshRef,
    enabled,
    onGeometryChange,
}) => {
    const { camera, gl } = useThree();
    const raycaster = useMemo(() => new THREE.Raycaster(), []);
    const [hover, setHover] = useState<{
        position: THREE.Vector3;
        tileSize: number;
    } | null>(null);
    const hoverRef = useRef<{ layerIdx: number; key: string } | null>(null);

    // Per-frame raycast. Bails immediately when disabled — no cycles spent
    // while the mode is off. Walks the meshRef looking for any object named
    // `Pattern` or `Pattern_<i>`; collects them into a temp array that we
    // intersect against to keep the raycaster's recursion shallow.
    useFrame((state) => {
        if (!enabled || !meshRef.current) {
            if (hover) setHover(null);
            hoverRef.current = null;
            return;
        }

        // Collect candidate pattern meshes.
        const targets: THREE.Object3D[] = [];
        meshRef.current.traverse((obj) => {
            if (!obj.name) return;
            if (obj.name === 'Pattern' || obj.name.startsWith('Pattern_')) {
                // Skip CSG debug meshes & masked sub-meshes — they share the
                // 'Pattern_' prefix but live in the Debug_ namespace OR were
                // renamed `Pattern_Masked_<i>_<color>`. The construction loop
                // tags removable layers as either `Pattern` or `Pattern_<i>`
                // where <i> is a plain integer.
                if (obj.name.startsWith('Pattern_Masked_')) return;
                // `Pattern_<i>` must be a plain integer suffix.
                if (obj.name !== 'Pattern') {
                    const suffix = obj.name.slice('Pattern_'.length);
                    if (!/^\d+$/.test(suffix)) return;
                }
                targets.push(obj);
            }
        });

        if (targets.length === 0) {
            if (hover) setHover(null);
            hoverRef.current = null;
            return;
        }

        raycaster.setFromCamera(state.pointer, camera);
        const hits = raycaster.intersectObjects(targets, false);
        if (hits.length === 0) {
            if (hover) setHover(null);
            hoverRef.current = null;
            return;
        }

        const hit = hits[0];
        const obj = hit.object;
        const layerIdx = obj.name === 'Pattern' ? 0 : Number(obj.name.slice('Pattern_'.length));

        // Resolve the world position of the hit tile.
        let worldX: number;
        let worldY: number;
        let tileSize = 6; // Visual size of the hint outline (mm).

        if (obj instanceof THREE.InstancedMesh && typeof hit.instanceId === 'number') {
            const m = new THREE.Matrix4();
            obj.getMatrixAt(hit.instanceId, m);
            // Decompose to get position + scale; the InstancedMesh in
            // ImperativeModel writes scale = patternScale, so a tight outline
            // sits ~scale mm tall.
            const pos = new THREE.Vector3();
            const quat = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            m.decompose(pos, quat, scale);
            obj.localToWorld(pos);
            worldX = pos.x;
            worldY = pos.y;
            // Approximate tile XY footprint from the bounding box * scale.
            if (obj.geometry.boundingBox) {
                const bb = obj.geometry.boundingBox;
                const w = (bb.max.x - bb.min.x) * Math.abs(scale.x);
                const h = (bb.max.y - bb.min.y) * Math.abs(scale.y);
                tileSize = Math.max(2, Math.max(w, h));
            }
        } else {
            // CSG-merged pattern: snap world hit to nearest cached tile origin.
            const cached = (obj.userData?.tilePositions as Array<{ x: number; y: number }> | undefined) ?? null;
            if (!cached || cached.length === 0) {
                // Without a cached origin list we can't reliably resolve the
                // tile key. Fall back to a direct (x,y) — the click handler
                // will still write a key, but it may not align with the
                // generator's quantised origin. Conservative: skip the hover.
                if (hover) setHover(null);
                hoverRef.current = null;
                return;
            }
            const wp = hit.point;
            let bestD2 = Infinity;
            let bestX = cached[0].x;
            let bestY = cached[0].y;
            for (const c of cached) {
                const dx = c.x - wp.x;
                const dy = c.y - wp.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < bestD2) {
                    bestD2 = d2;
                    bestX = c.x;
                    bestY = c.y;
                }
            }
            worldX = bestX;
            worldY = bestY;
        }

        const key = tileKey(worldX, worldY);
        const next: { layerIdx: number; key: string } = { layerIdx, key };
        hoverRef.current = next;

        // Position the visual outline 0.5mm above the pad surface so it
        // doesn't z-fight with the tile mesh. We use hit.point.z + 0.5 so the
        // hint follows whatever height the tile already has.
        const zHint = hit.point.z + 0.5;
        if (!hover || hover.position.x !== worldX || hover.position.y !== worldY) {
            setHover({ position: new THREE.Vector3(worldX, worldY, zHint), tileSize });
        }
    });

    // Cursor styling. Crosshair while removal mode is active + hovering
    // something, plain crosshair while active but off-target. The "always
    // crosshair when enabled" behaviour signals the mode visually even when
    // the user is panning over empty pad space.
    useEffect(() => {
        const el = gl.domElement;
        if (enabled) {
            el.style.cursor = 'crosshair';
        } else {
            // Don't clobber other components' cursor logic when we're
            // disabled — only reset if we previously set it.
            if (el.style.cursor === 'crosshair') el.style.cursor = '';
        }
        return () => {
            if (el.style.cursor === 'crosshair') el.style.cursor = '';
        };
    }, [enabled, gl]);

    // Click-to-remove. Identical pattern to InlayHoverHint: listen on the
    // canvas DOM element so R3F's React-tree click handling doesn't
    // interfere with the imperative pattern meshes. Only mutates when a
    // tile is currently hovered (hoverRef.current set by the frame loop).
    useEffect(() => {
        if (!enabled) return;
        const el = gl.domElement;
        const onClick = () => {
            const h = hoverRef.current;
            if (!h) return; // clicking empty space is a no-op
            onGeometryChange((prev) => {
                if (h.layerIdx === 0) {
                    // Primary layer — top-level removedTiles array.
                    const existing = prev.removedTiles ?? [];
                    if (existing.includes(h.key)) return prev;
                    return { ...prev, removedTiles: [...existing, h.key] };
                }
                // Extra layer — mutate the matching entry.
                const extras = prev.extraLayers ?? [];
                const targetIdx = h.layerIdx - 1;
                if (targetIdx < 0 || targetIdx >= extras.length) return prev;
                const target = extras[targetIdx];
                const existing = target.removedTiles ?? [];
                if (existing.includes(h.key)) return prev;
                const nextExtras = extras.slice();
                nextExtras[targetIdx] = { ...target, removedTiles: [...existing, h.key] };
                return { ...prev, extraLayers: nextExtras };
            });
        };
        el.addEventListener('click', onClick);
        return () => el.removeEventListener('click', onClick);
    }, [enabled, gl, onGeometryChange]);

    if (!hover || !enabled) return null;

    // Visual: thin red ring lifted above the pad. Disc + ring combo reads
    // as "this is what will be removed" without obscuring neighbouring tiles
    // or the underlying color region.
    return (
        <group position={hover.position} renderOrder={998}>
            {/* Outer ring stroke */}
            <mesh rotation={[0, 0, 0]}>
                <ringGeometry args={[hover.tileSize * 0.55, hover.tileSize * 0.65, 32]} />
                <meshBasicMaterial color={HINT_COLOR} transparent opacity={0.95} depthTest={false} depthWrite={false} />
            </mesh>
            {/* Center cross for clarity at small tile sizes */}
            <mesh>
                <planeGeometry args={[hover.tileSize * 0.15, hover.tileSize * 0.03]} />
                <meshBasicMaterial color={HINT_COLOR} transparent opacity={0.95} depthTest={false} depthWrite={false} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]}>
                <planeGeometry args={[hover.tileSize * 0.15, hover.tileSize * 0.03]} />
                <meshBasicMaterial color={HINT_COLOR} transparent opacity={0.95} depthTest={false} depthWrite={false} />
            </mesh>
        </group>
    );
};
