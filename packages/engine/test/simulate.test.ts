import { describe, expect, it } from 'vitest';
import { Simulation, simulate } from '../src';
import { catalogue, design, node, testLevel } from './helpers';

const crash = (atMinute: number) => ({
  id: 'c',
  type: 'instance_crash' as const,
  atMinute,
  target: 'random' as const,
  warning: false,
  title: 'Crash',
  lesson: '',
});

describe('simulate', () => {
  const level = testLevel();
  const basic = design(
    [node('web', 'ec2', { size: 'c7g.large' }), node('db', 'rds', { size: 'db.t3.medium' })],
    [
      ['users', 'web'],
      ['web', 'db'],
    ],
  );

  it('is deterministic: the same design and seed give identical results', () => {
    const noisy = testLevel({ traffic: { ...level.traffic, noise: 0.2 }, incidents: [crash(300)] });
    const a = simulate(basic, noisy, catalogue);
    const b = simulate(basic, noisy, catalogue);
    expect(a).toEqual(b);
    const c = simulate(basic, noisy, catalogue, { seed: 999 });
    expect(c.metrics.totalRequests).not.toEqual(a.metrics.totalRequests);
  });

  it('serves everything when capacity is ample', () => {
    const r = simulate(basic, level, catalogue);
    expect(r.metrics.availability).toBeCloseTo(1, 6);
    expect(r.metrics.totalRequests).toBeCloseTo(100 * 60 * 1440, -2);
  });

  it('drops requests above 100% load and reports the bottleneck', () => {
    const tiny = design([node('web', 'ec2', { size: 't3.micro' })], [['users', 'web']]);
    const r = simulate(tiny, level, catalogue);
    expect(r.metrics.availability).toBeLessThan(0.5);
    expect(r.bottlenecks[0]?.nodeId).toBe('web');
    expect(r.passed).toBe(false);
    expect(r.hints.join(' ')).toMatch(/peaked at/);
  });

  it('latency rises with load', () => {
    const light = simulate(basic, testLevel({ traffic: { ...level.traffic, peakRps: 20 } }), catalogue);
    const heavy = simulate(basic, testLevel({ traffic: { ...level.traffic, peakRps: 380 } }), catalogue);
    expect(heavy.metrics.p95).toBeGreaterThan(light.metrics.p95);
  });

  it('CloudFront answers most static requests at the edge', () => {
    const withCdn = design(
      [
        node('cdn', 'cloudfront', { ttlSeconds: 86400 }),
        node('s3', 's3'),
        node('web', 'ec2', { size: 'c7g.large' }),
      ],
      [
        ['users', 'cdn'],
        ['cdn', 's3'],
        ['users', 'web'],
      ],
    );
    const r = simulate(withCdn, level, catalogue);
    expect(r.metrics.p95ByType.static).toBeLessThan(30);
    expect(r.metrics.staticOnServers).toBe(0);
  });

  it('a crash loses orders stored on the instance but not orders in RDS', () => {
    const lvl = testLevel({ incidents: [crash(600)] });
    const local = simulate(
      design([node('web', 'ec2', { size: 'c7g.large' })], [['users', 'web']]),
      lvl,
      catalogue,
    );
    expect(local.metrics.dataLoss).toBe(true);
    expect(local.metrics.lostWrites).toBeGreaterThan(0);
    const rds = simulate(basic, lvl, catalogue);
    expect(rds.metrics.dataLoss).toBe(false);
  });

  it('alarms shorten EC2 recovery', () => {
    const lvl = testLevel({ incidents: [crash(600)] });
    const withAlarm = design(
      [node('web', 'ec2', { size: 'c7g.large', alarms: true }), node('db', 'rds', { size: 'db.t3.medium' })],
      [
        ['users', 'web'],
        ['web', 'db'],
      ],
    );
    const slow = simulate(basic, lvl, catalogue).metrics.availability;
    const fast = simulate(withAlarm, lvl, catalogue).metrics.availability;
    expect(fast).toBeGreaterThan(slow);
  });

  it('ALB health checks route around a dead server', () => {
    const lvl = testLevel({ incidents: [crash(600)] });
    const build = (hc: boolean) =>
      design(
        [
          node('lb', 'alb', { healthChecks: hc }),
          node('a', 'ec2', { size: 'c7g.large', az: 'a' }),
          node('b', 'ec2', { size: 'c7g.large', az: 'b' }),
          node('db', 'rds', { size: 'db.t3.medium' }),
        ],
        [
          ['users', 'lb'],
          ['lb', 'a'],
          ['lb', 'b'],
          ['a', 'db'],
          ['b', 'db'],
        ],
      );
    const without = simulate(build(false), lvl, catalogue).metrics.availability;
    const withHc = simulate(build(true), lvl, catalogue).metrics.availability;
    expect(withHc).toBeGreaterThan(without);
    expect(withHc).toBeGreaterThan(0.999);
  });

  it('an Auto Scaling Group scales out under load and back in when it drops', () => {
    const curve: [number, number][] = [
      [0, 0.1],
      [6, 0.1],
      [8, 1],
      [12, 1],
      [14, 0.1],
      [24, 0.1],
    ];
    const lvl = testLevel({ traffic: { ...level.traffic, peakRps: 1000, curve } });
    const d = design(
      [
        node('lb', 'alb'),
        node('fleet', 'asg', { size: 't3.medium', min: 1, max: 10, targetUtilization: 0.6 }),
        node('db', 'rds', { size: 'db.r6g.xlarge' }),
      ],
      [
        ['users', 'lb'],
        ['lb', 'fleet'],
        ['fleet', 'db'],
      ],
    );
    const sim = new Simulation(d, lvl, catalogue);
    const counts: number[] = [];
    while (!sim.done) counts.push(sim.step().nodes.fleet!.instances!);
    expect(Math.max(...counts)).toBeGreaterThan(3);
    expect(counts[counts.length - 1]).toBeLessThan(Math.max(...counts));
    expect(sim.result().metrics.availability).toBeGreaterThan(0.99);
  });

  it('a cache takes read load off the database once warm, and replicas take reads', () => {
    const lvl = testLevel({ traffic: { ...level.traffic, mix: { static: 0, read: 0.9, write: 0.1 } } });
    const noCache = design(
      [node('web', 'ec2', { size: 'c7g.xlarge' }), node('db', 'rds', { size: 'db.t3.medium' })],
      [
        ['users', 'web'],
        ['web', 'db'],
      ],
    );
    const cached = design(
      [
        node('web', 'ec2', { size: 'c7g.xlarge' }),
        node('cache', 'elasticache', { ttlSeconds: 3600 }),
        node('db', 'rds', { size: 'db.t3.medium' }),
      ],
      [
        ['users', 'web'],
        ['web', 'cache'],
        ['cache', 'db'],
        ['web', 'db'],
      ],
    );
    const replica = design(
      [
        node('web', 'ec2', { size: 'c7g.xlarge' }),
        node('db', 'rds', { size: 'db.t3.medium' }),
        node('rr', 'rds_replica', { size: 'db.t3.medium' }),
      ],
      [
        ['users', 'web'],
        ['web', 'db'],
        ['web', 'rr'],
        ['db', 'rr'],
      ],
    );
    const a = simulate(noCache, lvl, catalogue).metrics;
    const b = simulate(cached, lvl, catalogue).metrics;
    const c = simulate(replica, lvl, catalogue).metrics;
    expect(b.p95Util.db!).toBeLessThan(a.p95Util.db! / 2);
    expect(c.p95Util.db!).toBeLessThan(a.p95Util.db!);
    expect(c.p95Util.rr!).toBeGreaterThan(0);
  });

  it('writes fail if servers only reach a read replica', () => {
    const d = design(
      [node('web', 'ec2', { size: 'c7g.large' }), node('rr', 'rds_replica')],
      [
        ['users', 'web'],
        ['web', 'rr'],
      ],
    );
    const r = simulate(d, level, catalogue);
    expect(r.metrics.unroutable.write).toBeGreaterThan(0);
    expect(r.hints[0]).toMatch(/primary RDS/);
  });

  it('invalid designs do not run and score zero', () => {
    const d = design([node('db', 'rds')], [['users', 'db']]);
    const r = simulate(d, level, catalogue);
    expect(r.valid).toBe(false);
    expect(r.stars).toBe(0);
  });

  it('costs scale with what you run', () => {
    const small = simulate(
      design([node('web', 'ec2', { size: 't3.micro' })], [['users', 'web']]),
      testLevel({ traffic: { ...level.traffic, peakRps: 1 } }),
      catalogue,
    );
    const big = simulate(
      design([node('web', 'ec2', { size: 'c7g.xlarge' })], [['users', 'web']]),
      testLevel({ traffic: { ...level.traffic, peakRps: 1 } }),
      catalogue,
    );
    expect(big.metrics.monthlyCost - small.metrics.monthlyCost).toBeCloseTo(104 - 7.6, 0);
  });
});
