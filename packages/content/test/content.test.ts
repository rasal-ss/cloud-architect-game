import { describe, expect, it } from 'vitest';
import { Level, acts, levels, services } from '../src';
import { solutions } from '../src/solutions';

describe('service catalogue', () => {
  it('covers the Phase 1 services', () => {
    expect(services.map((s) => s.kind).sort()).toEqual(
      ['alb', 'asg', 'cloudfront', 'ec2', 'elasticache', 'rds', 'rds_replica', 's3', 'users'].sort(),
    );
  });

  it('only allows connections to known services', () => {
    const kinds = new Set(services.map((s) => s.kind));
    for (const s of services) for (const to of s.connectsTo) expect(kinds.has(to)).toBe(true);
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
