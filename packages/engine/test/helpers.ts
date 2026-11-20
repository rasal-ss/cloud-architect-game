import type { Design, DesignNode, Level, LevelInput } from '@cloud-architect/content';
import { Level as LevelSchema, services } from '@cloud-architect/content';
import { Catalogue } from '../src';

export const catalogue = new Catalogue(services);

export const node = (
  id: string,
  kind: DesignNode['kind'],
  config: DesignNode['config'] = {},
): DesignNode => ({
  id,
  kind,
  x: 0,
  y: 0,
  config,
});

export function design(nodes: DesignNode[], edges: [string, string][]): Design {
  return {
    nodes: [node('users', 'users'), ...nodes],
    edges: edges.map(([from, to]) => ({ id: `${from}-${to}`, from, to })),
  };
}

/** A flat-traffic test level with everything unlocked. */
export function testLevel(overrides: Partial<LevelInput> = {}): Level {
  return LevelSchema.parse({
    id: '0-1',
    act: 1,
    index: 1,
    title: 'Test',
    brief: 'Test',
    from: 'Test',
    lesson: 'Test',
    budget: 10_000,
    traffic: {
      peakRps: 100,
      curve: [
        [0, 1],
        [24, 1],
      ],
      mix: { static: 0.5, read: 0.4, write: 0.1 },
      userLatencyMs: 50,
      noise: 0,
    },
    objectives: [{ type: 'availability', min: 0.99 }],
    palette: ['ec2', 'asg', 'alb', 'cloudfront', 's3', 'rds', 'rds_replica', 'elasticache'],
    startingDesign: { nodes: [], edges: [] },
    weights: { reliability: 1, performance: 1, cost: 1, security: 1, operations: 1, sustainability: 1 },
    ...overrides,
  });
}
