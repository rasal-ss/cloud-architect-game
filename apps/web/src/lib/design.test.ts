import { levels } from '@cloud-architect/content';
import { describe, expect, it } from 'vitest';
import { isValidConnection } from '../store/gameStore';
import { fromFlow, nextId, toFlow } from './design';

describe('design <-> React Flow conversion', () => {
  it('round-trips every starting design', () => {
    for (const level of levels) {
      const { nodes, edges } = toFlow(level.startingDesign);
      expect(fromFlow(nodes, edges)).toEqual(level.startingDesign);
    }
  });

  it('locked nodes cannot be deleted on the canvas', () => {
    const { nodes } = toFlow(levels[0]!.startingDesign);
    expect(nodes.find((n) => n.data.kind === 'users')?.deletable).toBe(false);
  });

  it('generates unique ids', () => {
    expect(nextId('ec2', ['ec2-1', 'ec2-2'])).toBe('ec2-3');
  });
});

describe('isValidConnection', () => {
  const { nodes } = toFlow({
    nodes: [
      { id: 'u', kind: 'users', x: 0, y: 0, config: {} },
      { id: 'w', kind: 'ec2', x: 0, y: 0, config: {} },
      { id: 'd', kind: 'rds', x: 0, y: 0, config: {} },
    ],
    edges: [],
  });
  it('follows the service catalogue rules', () => {
    expect(isValidConnection(nodes, { source: 'u', target: 'w' })).toBe(true);
    expect(isValidConnection(nodes, { source: 'w', target: 'd' })).toBe(true);
    expect(isValidConnection(nodes, { source: 'u', target: 'd' })).toBe(false);
    expect(isValidConnection(nodes, { source: 'w', target: 'w' })).toBe(false);
  });
});
