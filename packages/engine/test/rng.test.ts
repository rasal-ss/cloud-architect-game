import { describe, expect, it } from 'vitest';
import { createRng, weightedPick } from '../src';

describe('createRng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(7);
    const b = createRng(7);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
  });

  it('differs between seeds and stays in [0, 1)', () => {
    const a = Array.from({ length: 100 }, createRng(1));
    const b = Array.from({ length: 100 }, createRng(2));
    expect(a).not.toEqual(b);
    expect(a.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('weightedPick', () => {
  it('never picks zero-weight items and returns -1 for no weight', () => {
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) expect(weightedPick(rng, [0, 1, 0])).toBe(1);
    expect(weightedPick(rng, [0, 0])).toBe(-1);
  });
});
