/**
 * Mulberry32: a tiny, fast, seedable PRNG. The same seed always yields the same
 * sequence, which is what makes every run replayable.
 */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks an index with probability proportional to its weight. */
export function weightedPick(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return -1;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}
