import { type Design, levels } from '@cloud-architect/content';
import { solutions } from '@cloud-architect/content/solutions';
import { describe, expect, it } from 'vitest';
import { simulate } from '../src';
import { catalogue } from './helpers';

const level = (id: string) => levels.find((l) => l.id === id)!;
const solution = (id: string): Design => JSON.parse(JSON.stringify(solutions[id]!)) as Design;
const failed = (r: ReturnType<typeof simulate>) => r.objectives.filter((o) => !o.pass).map((o) => o.label);

describe.each(levels.map((l) => [l.id, l.title, l] as const))('level %s: %s', (id, _title, lvl) => {
  it('is solvable: the reference solution passes every objective with 3 stars', () => {
    const result = simulate(solutions[id]!, lvl, catalogue);
    expect(result.errors).toEqual([]);
    expect(failed(result)).toEqual([]);
    expect(result.stars).toBe(3);
  });

  it('is a real puzzle: the starting design does not pass', () => {
    expect(simulate(lvl.startingDesign, lvl, catalogue).passed).toBe(false);
  });

  it('the reference solution survives other random seeds', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(failed(simulate(solutions[id]!, lvl, catalogue, { seed }))).toEqual([]);
    }
  });
});

describe('levels teach their lesson', () => {
  it('1-4: the default CloudFront TTL misses too often for the static latency target', () => {
    const d = solution('1-4');
    d.nodes.find((n) => n.kind === 'cloudfront')!.config.ttlSeconds = 3600;
    expect(failed(simulate(d, level('1-4'), catalogue))).toContain(
      'p95 latency for static requests under 60 ms',
    );
  });

  it('1-5: a bigger server instead of CloudFront blows the $20 budget', () => {
    const d: Design = {
      nodes: [
        ...solution('1-5').nodes.filter((n) => n.kind === 'users'),
        { id: 'web', kind: 'ec2', x: 0, y: 0, config: { size: 't3.medium' } },
      ],
      edges: [{ id: 'e', from: 'users', to: 'web' }],
    };
    const r = simulate(d, level('1-5'), catalogue);
    expect(r.passed).toBe(false);
    expect(failed(r).join()).toMatch(/Monthly cost/);
  });

  it('2-3: over-provisioning the database fails the budget', () => {
    const d = solution('2-3');
    d.nodes.find((n) => n.kind === 'rds')!.config.size = 'db.r6g.large';
    expect(failed(simulate(d, level('2-3'), catalogue)).join()).toMatch(/Monthly cost/);
  });

  it('3-4: without health checks a dead server keeps receiving traffic', () => {
    const d = solution('3-4');
    d.nodes.find((n) => n.kind === 'alb')!.config.healthChecks = false;
    const r = simulate(d, level('3-4'), catalogue);
    expect(r.metrics.availability).toBeLessThan(
      simulate(solution('3-4'), level('3-4'), catalogue).metrics.availability,
    );
  });

  it('3-5: a default Auto Scaling Group and a small database cannot absorb a 10x spike', () => {
    const d = solution('3-5');
    const fleet = d.nodes.find((n) => n.kind === 'asg')!;
    fleet.config = { ...fleet.config, size: 't3.medium', targetUtilization: 0.7, max: 6 };
    d.nodes.find((n) => n.kind === 'rds')!.config.size = 'db.r6g.large';
    expect(simulate(d, level('3-5'), catalogue).passed).toBe(false);
  });
});
