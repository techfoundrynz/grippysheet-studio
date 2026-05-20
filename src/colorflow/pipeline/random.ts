/**
 * Mulberry32 PRNG — small, fast, seeded. Returns a function that yields [0, 1).
 * https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
