import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { tileKey, filterRemovedTiles, generateTilePositions } from '../patternUtils';

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
