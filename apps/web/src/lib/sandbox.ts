import { type Level, Level as LevelSchema } from '@cloud-architect/content';

export interface SandboxSettings {
  peakRps: number;
  spike: boolean;
  crash: boolean;
  budget: number;
}

export const DEFAULT_SANDBOX: SandboxSettings = { peakRps: 500, spike: true, crash: true, budget: 1000 };

export const SANDBOX_ID = '0-1';

/** Builds a free-play level with every Phase 1 service unlocked. */
export function sandboxLevel(s: SandboxSettings): Level {
  return LevelSchema.parse({
    id: SANDBOX_ID,
    act: 1,
    index: 1,
    title: 'Sandbox',
    from: 'You',
    brief:
      'Every service is unlocked. Set your own traffic and budget, build anything, and stress-test it with chaos events. A payment provider is there for you to try queues and workers against.',
    lesson: 'Use the sandbox to try ideas from the guide before the campaign gets to them.',
    budget: s.budget,
    traffic: {
      peakRps: s.peakRps,
      curve: [
        [0, 0.15],
        [3, 0.08],
        [6, 0.2],
        [9, 0.5],
        [12, 0.8],
        [14, 0.6],
        [17, 0.7],
        [19.5, 1],
        [21, 0.8],
        [24, 0.15],
      ],
      mix: { static: 0.5, read: 0.4, write: 0.1 },
      userLatencyMs: 80,
    },
    incidents: [
      ...(s.spike
        ? [
            {
              id: 'spike',
              type: 'traffic_spike',
              atMinute: 720,
              multiplier: 5,
              rampMinutes: 5,
              holdMinutes: 30,
              warning: true,
              title: 'Lunchtime spike',
              lesson: 'Headroom and edge caching absorb spikes while Auto Scaling catches up.',
            },
          ]
        : []),
      ...(s.crash
        ? [
            {
              id: 'crash',
              type: 'instance_crash',
              atMinute: 1170,
              warning: true,
              title: 'Instance crash at dinner',
              lesson: 'Redundancy and health checks turn a crash into a non-event.',
            },
          ]
        : []),
    ],
    objectives: [
      { type: 'availability', min: 0.999 },
      { type: 'p95', maxMs: 250 },
      { type: 'noDataLoss' },
      { type: 'noSecurityIssues' },
    ],
    palette: [
      'ec2',
      'asg',
      'alb',
      'cloudfront',
      's3',
      'rds',
      'rds_replica',
      'elasticache',
      'api_gateway',
      'lambda',
      'dynamodb',
      'rds_proxy',
      'sqs',
      'sns',
      'eventbridge',
    ],
    startingDesign: {
      nodes: [
        { id: 'users', kind: 'users', label: 'Customers', x: 0, y: 220, locked: true },
        { id: 'pay', kind: 'payment', label: 'Payment provider', x: 900, y: 420, locked: true },
      ],
      edges: [],
    },
    weights: { reliability: 1, performance: 1, cost: 1, security: 1, operations: 1, sustainability: 1 },
    walkthrough: {
      steps: ['There is no single answer here.', 'Open the guide for ideas, then build and run.'],
      why: 'The sandbox has no fixed solution. Every service is available so you can test how designs behave under your own traffic, budget and incidents.',
    },
  });
}
