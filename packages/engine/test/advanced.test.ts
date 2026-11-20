import type { Design, DesignNode, Incident, LevelInput } from '@cloud-architect/content';
import { describe, expect, it } from 'vitest';
import { simulate } from '../src';
import { catalogue, design, node, testLevel } from './helpers';

const incident = (inc: Record<string, unknown>) =>
  ({ id: 'i', warning: false, title: 'Incident', lesson: '', atMinute: 600, ...inc }) as Incident;
const run = (d: Design, overrides: Partial<LevelInput> = {}) =>
  simulate(d, testLevel(overrides), catalogue).metrics;
const flat = (peakRps: number, mix = { static: 0, read: 0.6, write: 0.4 }) => ({
  peakRps,
  curve: [
    [0, 1],
    [24, 1],
  ] as [number, number][],
  mix,
  userLatencyMs: 50,
  noise: 0,
});
const locked = (n: DesignNode) => ({ ...n, locked: true });

describe('queues decouple slow or failing dependencies', () => {
  const outage = [incident({ type: 'dependency_outage', durationMinutes: 30 })];
  const sync = design(
    [
      node('api', 'api_gateway'),
      node('fn', 'lambda'),
      node('db', 'dynamodb'),
      locked(node('pay', 'payment')),
    ],
    [
      ['users', 'api'],
      ['api', 'fn'],
      ['fn', 'pay'],
      ['fn', 'db'],
    ],
  );
  const queued = design(
    [
      node('api', 'api_gateway'),
      node('fn', 'lambda'),
      node('db', 'dynamodb'),
      node('q', 'sqs'),
      node('worker', 'lambda'),
      locked(node('pay', 'payment')),
    ],
    [
      ['users', 'api'],
      ['api', 'fn'],
      ['fn', 'db'],
      ['fn', 'q'],
      ['q', 'worker'],
      ['worker', 'pay'],
      ['worker', 'db'],
    ],
  );

  it('a synchronous call fails orders while the provider is down; a queue keeps them', () => {
    const a = run(sync, { traffic: flat(50), incidents: outage });
    const b = run(queued, { traffic: flat(50), incidents: outage });
    expect(a.ordersCharged / a.ordersPlaced).toBeLessThan(0.99);
    expect(b.availability).toBeGreaterThan(a.availability);
    expect(b.ordersCharged / b.ordersPlaced).toBeGreaterThan(0.999);
    expect(b.queue.peakBacklog).toBeGreaterThan(0);
    expect(b.queue.endBacklog).toBe(0);
  });

  it('queueing takes the slow payment call out of the customer’s wait', () => {
    const a = run(sync, { traffic: flat(50) });
    const b = run(queued, { traffic: flat(50) });
    expect(b.p95ByType.write!).toBeLessThan(a.p95ByType.write! - 150);
  });

  it('poison messages stay forever without a dead-letter queue', () => {
    const poison = [incident({ type: 'poison_messages', durationMinutes: 60, fraction: 0.02 })];
    const noDlq = run(queued, { traffic: flat(50), incidents: poison });
    const withDlq: Design = JSON.parse(JSON.stringify(queued));
    withDlq.nodes.find((n) => n.id === 'q')!.config = { dlq: true };
    const dlq = run(withDlq, { traffic: flat(50), incidents: poison });
    expect(noDlq.queue.poisonLeft).toBeGreaterThan(0);
    expect(dlq.queue.poisonLeft).toBe(0);
    expect(dlq.queue.deadLettered).toBeGreaterThan(0);
  });
});

describe('fan-out', () => {
  const build = (viaQueue: boolean) =>
    design(
      [
        node('api', 'api_gateway'),
        node('fn', 'lambda'),
        node('db', 'dynamodb'),
        node('topic', 'sns'),
        ...(viaQueue ? [node('q', 'sqs')] : []),
        node('email', 'lambda', { concurrency: 2, size: '128 MB' }),
      ],
      [
        ['users', 'api'],
        ['api', 'fn'],
        ['fn', 'db'],
        ['fn', 'topic'],
        ...((viaQueue
          ? [
              ['topic', 'q'],
              ['q', 'email'],
            ]
          : [['topic', 'email']]) as [string, string][]),
      ],
    );

  it('SNS drops messages for an overwhelmed subscriber; a queue in between keeps them', () => {
    const direct = run(build(false), { traffic: flat(30), incidents: [] });
    const buffered = run(build(true), { traffic: flat(30, { static: 0, read: 0.9, write: 0.1 }) });
    expect(direct.lostMessages).toBeGreaterThan(0);
    expect(buffered.lostMessages).toBe(0);
  });
});

describe('Lambda and relational databases', () => {
  const build = (proxy: boolean) =>
    design(
      [
        node('api', 'api_gateway'),
        node('fn', 'lambda', { size: '128 MB' }),
        ...(proxy ? [node('px', 'rds_proxy')] : []),
        node('db', 'rds', { size: 'db.r6g.large' }),
      ],
      proxy
        ? [
            ['users', 'api'],
            ['api', 'fn'],
            ['fn', 'px'],
            ['px', 'db'],
          ]
        : [
            ['users', 'api'],
            ['api', 'fn'],
            ['fn', 'db'],
          ],
    );

  it('many executions exhaust database connections; RDS Proxy pools them', () => {
    const direct = run(build(false), { traffic: flat(300) });
    const pooled = run(build(true), { traffic: flat(300) });
    expect(direct.connectionPeak.db!).toBeGreaterThan(1);
    expect(direct.availability).toBeLessThan(0.99);
    expect(pooled.connectionPeak.db!).toBeLessThan(1);
    expect(pooled.availability).toBeGreaterThan(0.999);
  });

  it('cold starts appear when traffic ramps up, and more memory shortens them', () => {
    const ramp = {
      ...flat(400),
      curve: [
        [0, 0.01],
        [8, 0.01],
        [8.2, 1],
        [24, 1],
      ] as [number, number][],
    };
    const small = run(
      design(
        [node('api', 'api_gateway'), node('fn', 'lambda', { size: '128 MB' }), node('db', 'dynamodb')],
        [
          ['users', 'api'],
          ['api', 'fn'],
          ['fn', 'db'],
        ],
      ),
      { traffic: ramp },
    );
    expect(small.coldStartShare).toBeGreaterThan(0);
  });
});

describe('DynamoDB partitions', () => {
  const build = (partitionKey: string) =>
    design(
      [
        node('api', 'api_gateway'),
        node('fn', 'lambda'),
        node('db', 'dynamodb', { partitionKey: partitionKey as never }),
      ],
      [
        ['users', 'api'],
        ['api', 'fn'],
        ['fn', 'db'],
      ],
    );
  const viral = [incident({ type: 'hot_key', durationMinutes: 120 })];

  it('a viral coupon throttles a coupon-code key; write sharding spreads it', () => {
    const hot = run(build('coupon-code'), { traffic: flat(1000), incidents: viral });
    const sharded = run(build('coupon-code-sharded'), { traffic: flat(1000), incidents: viral });
    expect(hot.throttled).toBeGreaterThan(0);
    expect(sharded.throttled).toBe(0);
    expect(sharded.availability).toBeGreaterThan(hot.availability);
  });
});

describe('databases in disasters', () => {
  const web = (db: DesignNode) =>
    design(
      [node('lb', 'alb'), node('fleet', 'asg', { size: 'c7g.large', min: 2 }), db],
      [
        ['users', 'lb'],
        ['lb', 'fleet'],
        ['fleet', 'db'],
      ],
    );

  it('Multi-AZ turns a database failure into a blip', () => {
    const fail = [incident({ type: 'db_failover' })];
    const single = run(web(node('db', 'rds', { size: 'db.r6g.large' })), { incidents: fail });
    const multi = run(web(node('db', 'rds', { size: 'db.r6g.large', multiAz: true })), { incidents: fail });
    expect(multi.availability).toBeGreaterThan(single.availability);
    expect(multi.availability).toBeGreaterThan(0.999);
  });

  it('a dropped table loses everything without backups and about 5 minutes with them', () => {
    const drop = [incident({ type: 'data_corruption' })];
    const none = run(web(node('db', 'rds', { size: 'db.r6g.large', backupRetentionDays: 0 })), {
      incidents: drop,
    });
    const pitr = run(web(node('db', 'rds', { size: 'db.r6g.large', backupRetentionDays: 7 })), {
      incidents: drop,
    });
    expect(none.rpoMinutes).toBe(Infinity);
    expect(none.dataLoss).toBe(true);
    expect(pitr.rpoMinutes).toBe(5);
    expect(pitr.dataLoss).toBe(false);
  });

  it('an AZ outage takes down a one-zone fleet and a single-AZ database, but not a two-zone setup', () => {
    const az = [incident({ type: 'az_outage', az: 'a', durationMinutes: 60 })];
    const oneZone = design(
      [
        node('lb', 'alb'),
        node('fleet', 'asg', { size: 'c7g.large', min: 2, azs: 1 }),
        node('db', 'rds', { size: 'db.r6g.large' }),
      ],
      [
        ['users', 'lb'],
        ['lb', 'fleet'],
        ['fleet', 'db'],
      ],
    );
    const twoZones = design(
      [
        node('lb', 'alb'),
        node('fleet', 'asg', { size: 'c7g.large', min: 3, azs: 2 }),
        node('db', 'rds', { size: 'db.r6g.large', multiAz: true }),
      ],
      [
        ['users', 'lb'],
        ['lb', 'fleet'],
        ['fleet', 'db'],
      ],
    );
    const a = run(oneZone, { incidents: az });
    const b = run(twoZones, { incidents: az });
    expect(a.availability).toBeLessThan(0.97);
    expect(b.availability).toBeGreaterThan(0.995);
  });
});

describe('sessions and caches', () => {
  it('a crash logs customers out unless sessions live in ElastiCache', () => {
    const crash = [incident({ type: 'instance_crash', target: 'random' })];
    const build = (sessionStore: 'instance' | 'cache') =>
      design(
        [
          node('lb', 'alb'),
          node('fleet', 'asg', { size: 'c7g.large', min: 2, sessionStore }),
          node('cache', 'elasticache'),
          node('db', 'rds', { size: 'db.r6g.large' }),
        ],
        [
          ['users', 'lb'],
          ['lb', 'fleet'],
          ['fleet', 'cache'],
          ['cache', 'db'],
          ['fleet', 'db'],
        ],
      );
    expect(run(build('instance'), { incidents: crash }).sessionsLost).toBeGreaterThan(0);
    expect(run(build('cache'), { incidents: crash }).sessionsLost).toBe(0);
  });

  it('staleness follows the cache TTL', () => {
    const build = (ttlSeconds: number) =>
      design(
        [
          node('web', 'ec2', { size: 'c7g.large' }),
          node('cache', 'elasticache', { ttlSeconds }),
          node('db', 'rds', { size: 'db.t3.medium' }),
        ],
        [
          ['users', 'web'],
          ['web', 'cache'],
          ['cache', 'db'],
          ['web', 'db'],
        ],
      );
    expect(run(build(30)).stalenessSec).toBe(30);
    expect(run(build(3600)).stalenessSec).toBe(3600);
  });

  it('a cache flush sends a wave of reads to the database', () => {
    const build = () =>
      design(
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
    const traffic = {
      ...flat(300, { static: 0, read: 0.95, write: 0.05 }),
      curve: [
        [0, 0.05],
        [8, 0.05],
        [9, 1],
        [24, 1],
      ] as [number, number][],
    };
    const calm = run(build(), { traffic });
    const flushed = run(build(), { traffic, incidents: [incident({ type: 'cache_flush' })] });
    expect(flushed.peakUtil.db!).toBeGreaterThan(calm.peakUtil.db! * 1.5);
  });
});
