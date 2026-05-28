import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { tileKey, filterRemovedTiles, generateTilePositions, toggleSpikeAt, SpikePosition } from '../patternUtils';
import { normalizeExtraLayerIds, PatternLayerSchema, GeometrySettingsSchema, getPatternLayers } from '../../types/schemas';

describe('tileKey', () => {
    it('quantises to 0.01 mm precision', () => {
        expect(tileKey(1.001, 2.009)).toBe('1.00,2.01');
        expect(tileKey(-12.345, 67.891)).toBe('-12.35,67.89');
    });

    it('collapses near-zero magnitudes so ±0 round to the same key', () => {
        // The exact bug from the original implementation: `(-0.001).toFixed(2)`
        // → "-0.00" but `(0.001).toFixed(2)` → "0.00". A radial tile centred
        // at the origin must produce one stable key regardless of float drift.
        expect(tileKey(0, 0)).toBe('0.00,0.00');
        expect(tileKey(-0.001, 0.001)).toBe('0.00,0.00');
        expect(tileKey(0.004, -0.0049)).toBe('0.00,0.00');
    });

    it('is deterministic — same input always returns the same key', () => {
        for (let i = 0; i < 100; i++) {
            const x = Math.sin(i) * 37.42;
            const y = Math.cos(i) * 89.71;
            expect(tileKey(x, y)).toBe(tileKey(x, y));
        }
    });
});

describe('filterRemovedTiles', () => {
    const mk = (x: number, y: number) => ({ position: new THREE.Vector2(x, y) });

    it('returns the input array unchanged when nothing is removed', () => {
        const tiles = [mk(0, 0), mk(10, 10)];
        expect(filterRemovedTiles(tiles, null)).toBe(tiles);
        expect(filterRemovedTiles(tiles, [])).toBe(tiles);
        expect(filterRemovedTiles(tiles, undefined)).toBe(tiles);
    });

    it('drops tiles whose tileKey is in the removal set', () => {
        const tiles = [mk(0, 0), mk(10, 10), mk(-5, 5)];
        const filtered = filterRemovedTiles(tiles, ['10.00,10.00']);
        expect(filtered).toHaveLength(2);
        expect(filtered.map((t) => tileKey(t.position.x, t.position.y))).toEqual(['0.00,0.00', '-5.00,5.00']);
    });

    it('matches keys despite float drift on the input position', () => {
        const tiles = [mk(10.0001, 9.9999)];
        const filtered = filterRemovedTiles(tiles, ['10.00,10.00']);
        expect(filtered).toHaveLength(0);
    });
});

describe('generateTilePositions × tileKey — round-trip across distributions', () => {
    const bounds = new THREE.Box2(new THREE.Vector2(-50, -50), new THREE.Vector2(50, 50));
    const tileSize = 5;
    const spacing = 10;

    // `random` distribution uses Math.random() — the keys can't be deterministic
    // by design. The others are pure functions of inputs.
    const deterministic: ReadonlyArray<Parameters<typeof generateTilePositions>[7]> = [
        'grid', 'offset', 'hex', 'radial', 'wave', 'zigzag', 'warped-grid',
    ];

    for (const distribution of deterministic) {
        it(`produces stable, unique keys for distribution=${distribution}`, () => {
            const tiles = generateTilePositions(
                bounds, tileSize, tileSize, spacing,
                null, 0, false,
                distribution, 'none', 'horizontal',
            );
            expect(tiles.length).toBeGreaterThan(0);
            const keys = tiles.map((t) => tileKey(t.position.x, t.position.y));
            // No two tiles collide on the same key.
            expect(new Set(keys).size).toBe(keys.length);
            // Re-running the generator yields the exact same key list.
            const tiles2 = generateTilePositions(
                bounds, tileSize, tileSize, spacing,
                null, 0, false,
                distribution, 'none', 'horizontal',
            );
            const keys2 = tiles2.map((t) => tileKey(t.position.x, t.position.y));
            expect(keys2).toEqual(keys);
        });
    }

    // Per-tile rotation (`orientation`) must not perturb tile positions — the
    // generator separates "where" (the tile origin) from "how the tile sits
    // on that origin." The reviewer flagged this as a coord-space risk: if
    // the click reader and the generator ever disagreed on whether to rotate
    // the position, every "remove this tile" click would silently miss.
    it.each(['none', 'alternate', 'aligned'] as const)(
        'is rotation-insensitive: orientation=%s does not move tile origins',
        (orientation) => {
            const reference = generateTilePositions(
                bounds, tileSize, tileSize, spacing,
                null, 0, false,
                'grid', 'none', 'horizontal',
            );
            const rotated = generateTilePositions(
                bounds, tileSize, tileSize, spacing,
                null, 0, false,
                'grid', orientation, 'horizontal',
            );
            const refKeys = reference.map((t) => tileKey(t.position.x, t.position.y)).sort();
            const rotKeys = rotated.map((t) => tileKey(t.position.x, t.position.y)).sort();
            expect(rotKeys).toEqual(refKeys);
        },
    );
});

describe('normalizeExtraLayerIds', () => {
    const mk = (id: string) => PatternLayerSchema.parse({ id });

    it('passes through layers with already-unique ids', () => {
        const layers = [mk('aaa'), mk('bbb'), mk('ccc')];
        const { layers: out, idMap } = normalizeExtraLayerIds(layers);
        expect(out).toEqual(layers);
        expect([...idMap.entries()]).toEqual([['aaa', 'aaa'], ['bbb', 'bbb'], ['ccc', 'ccc']]);
    });

    it('rewrites the reserved __primary__ id', () => {
        const layers = [mk('__primary__'), mk('safe')];
        const { layers: out, idMap } = normalizeExtraLayerIds(layers);
        expect(out[0].id).not.toBe('__primary__');
        expect(out[0].id).toMatch(/^[0-9a-f-]{36}$/);
        expect(out[1].id).toBe('safe');
        expect(idMap.get('__primary__')).toBe(out[0].id);
    });

    it('rewrites duplicate ids and keeps the first occurrence as the asset-bundle anchor', () => {
        // [A, A, A] — the asset bundle can only carry one set of bytes for
        // id "A", so the first layer KEEPS id "A" and the bundle's bytes
        // stay attached to it. The 2nd and 3rd duplicates each get fresh
        // uuids but no asset; they'll show up empty in the UI.
        const layers = [mk('dup'), mk('dup'), mk('dup')];
        const { layers: out, idMap } = normalizeExtraLayerIds(layers);
        const ids = out.map((l) => l.id);
        expect(ids[0]).toBe('dup');
        expect(ids[1]).not.toBe('dup');
        expect(ids[2]).not.toBe('dup');
        expect(ids[1]).not.toBe(ids[2]);
        // Critical: idMap.get('dup') resolves to the first occurrence's id
        // so the asset rekey loop attaches the bundled bytes to layer 0,
        // not layer 2 (which was the prior buggy behaviour).
        expect(idMap.get('dup')).toBe('dup');
    });

    it('handles an empty extras array', () => {
        const { layers, idMap } = normalizeExtraLayerIds([]);
        expect(layers).toEqual([]);
        expect(idMap.size).toBe(0);
    });
});

describe('addedSpikes schema + getPatternLayers', () => {
    it('defaults addedSpikes to an empty array on GeometrySettings', () => {
        const g = GeometrySettingsSchema.parse({});
        expect(g.addedSpikes).toEqual([]);
    });

    it('round-trips addedSpikes coordinates', () => {
        const g = GeometrySettingsSchema.parse({ addedSpikes: [{ x: 1.5, y: -2.25 }] });
        expect(g.addedSpikes).toEqual([{ x: 1.5, y: -2.25 }]);
    });

    it('synthesizes the primary layer with addedSpikes from the flat field', () => {
        const g = GeometrySettingsSchema.parse({
            patternShapes: null,
            addedSpikes: [{ x: 3, y: 4 }],
        });
        expect(getPatternLayers(g)[0].addedSpikes).toEqual([{ x: 3, y: 4 }]);
    });

    it('defaults a PatternLayer addedSpikes to empty', () => {
        const g = GeometrySettingsSchema.parse({ extraLayers: [{ id: 'x' }] });
        expect(g.extraLayers[0].addedSpikes).toEqual([]);
    });
});

describe('toggleSpikeAt', () => {
    const R = 5;
    const grid: SpikePosition[] = [
        { x: 0, y: 0, origin: 'grid' },
        { x: 20, y: 0, origin: 'grid' },
    ];

    it('removes a grid spike when the click lands within R of it', () => {
        const res = toggleSpikeAt(1, 1, grid, [], [], R);
        expect(res.removedTiles).toEqual([tileKey(0, 0)]);
        expect(res.addedSpikes).toEqual([]);
    });

    it('adds a free spike at the exact point when the click is in a gap', () => {
        const res = toggleSpikeAt(10, 10, grid, [], [], R);
        expect(res.removedTiles).toEqual([]);
        expect(res.addedSpikes).toEqual([{ x: 10, y: 10 }]);
    });

    it('removes an existing added spike when clicked', () => {
        const positions: SpikePosition[] = [{ x: 50, y: 50, origin: 'added' }];
        const res = toggleSpikeAt(50.5, 49.5, positions, [], [{ x: 50, y: 50 }], R);
        expect(res.addedSpikes).toEqual([]);
        expect(res.removedTiles).toEqual([]);
    });

    it('does not duplicate a removedTiles key already present', () => {
        const res = toggleSpikeAt(0, 0, grid, [tileKey(0, 0)], [], R);
        expect(res.removedTiles).toEqual([tileKey(0, 0)]);
    });

    it('prefers the nearest spike when two are in range', () => {
        const close: SpikePosition[] = [
            { x: 0, y: 0, origin: 'grid' },
            { x: 4, y: 0, origin: 'added' },
        ];
        const res = toggleSpikeAt(3, 0, close, [], [{ x: 4, y: 0 }], R);
        expect(res.addedSpikes).toEqual([]);
        expect(res.removedTiles).toEqual([]);
    });

    it('adds a spike when there are no existing positions at all', () => {
        const res = toggleSpikeAt(7, 8, [], [], [], R);
        expect(res.removedTiles).toEqual([]);
        expect(res.addedSpikes).toEqual([{ x: 7, y: 8 }]);
    });
});
