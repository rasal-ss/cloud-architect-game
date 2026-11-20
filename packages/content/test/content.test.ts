import { describe, expect, it } from 'vitest';
import { Level, acts, concepts, levels, services } from '../src';
import { solutions } from '../src/solutions';

describe('service catalogue', () => {
  it('covers the core and serverless services', () => {
    expect(services).toHaveLength(17);
    for (const k of ['sqs', 'sns', 'eventbridge', 'lambda', 'api_gateway', 'dynamodb', 'rds_proxy']) {
      expect(
        services.some((s) => s.kind === k),
        k,
      ).toBe(true);
    }
  });

  it('only allows connections to known services', () => {
    const kinds = new Set(services.map((s) => s.kind));
    for (const s of services) for (const to of s.connectsTo) expect(kinds.has(to)).toBe(true);
  });
});

describe('teaching content', () => {
  it('explains every service in plain English and how it behaves in the game', () => {
    for (const s of services) {
      expect(s.analogy.length, s.kind).toBeGreaterThan(20);
      expect(s.inGame.length, s.kind).toBeGreaterThan(40);
    }
  });

  it('gives every service an overview, key terms, an example, mistakes and real pairings', () => {
    const kinds = new Set(services.map((s) => s.kind));
    for (const s of services) {
      expect(s.overview.split('\n\n').length, s.kind).toBeGreaterThanOrEqual(2);
      expect(s.keyTerms.length, s.kind).toBeGreaterThanOrEqual(3);
      expect(s.example.length, s.kind).toBeGreaterThan(80);
      expect(s.mistakes.length, s.kind).toBeGreaterThanOrEqual(2);
      for (const p of s.pairsWith) expect(kinds.has(p.kind as never), `${s.kind} -> ${p.kind}`).toBe(true);
    }
  });

  it('has the basic concepts with unique ids', () => {
    expect(concepts.length).toBeGreaterThanOrEqual(20);
    expect(new Set(concepts.map((c) => c.group))).toEqual(
      new Set(['basics', 'reliability', 'data', 'architecture']),
    );
    expect(new Set(concepts.map((c) => c.id)).size).toBe(concepts.length);
  });
});

describe('campaign levels', () => {
  it('has Acts 1-3 with 5 levels each, the 5th being a boss', () => {
    expect(acts.map((a) => a.act)).toEqual([1, 2, 3]);
    for (const act of [1, 2, 3]) {
      const inAct = levels.filter((l) => l.act === act).sort((a, b) => a.index - b.index);
      expect(inAct.map((l) => l.index)).toEqual([1, 2, 3, 4, 5]);
      expect(inAct.map((l) => l.boss)).toEqual([false, false, false, false, true]);
    }
  });

  it('has unique ids that match act-index', () => {
    expect(new Set(levels.map((l) => l.id)).size).toBe(levels.length);
    for (const l of levels) expect(l.id).toBe(`${l.act}-${l.index}`);
  });

  it('includes both Phase 1 chaos events', () => {
    const types = new Set(levels.flatMap((l) => l.incidents.map((i) => i.type)));
    expect(types).toEqual(new Set(['traffic_spike', 'instance_crash']));
  });

  it('every starting design has exactly one Users node', () => {
    for (const l of levels) expect(l.startingDesign.nodes.filter((n) => n.kind === 'users')).toHaveLength(1);
  });

  it('rejects malformed content', () => {
    const bad = {
      ...levels[0],
      traffic: { ...levels[0]!.traffic, mix: { static: 0.5, read: 0.5, write: 0.5 } },
    };
    expect(Level.safeParse(bad).success).toBe(false);
  });
});

describe('reference solutions', () => {
  it('exist for every level', () => {
    expect(Object.keys(solutions).sort()).toEqual(levels.map((l) => l.id).sort());
  });

  it('only use services unlocked in their level', () => {
    for (const l of levels) {
      for (const n of solutions[l.id]!.nodes) {
        if (n.kind !== 'users') expect(l.palette, `${l.id} uses ${n.kind}`).toContain(n.kind);
      }
    }
  });
});
