import { describe, expect, it } from 'vitest';
import { securityIssues, singlePointsOfFailure, validateDesign } from '../src';
import { catalogue, design, node, testLevel } from './helpers';

describe('validateDesign', () => {
  it('accepts a simple valid design', () => {
    const d = design([node('web', 'ec2')], [['users', 'web']]);
    expect(validateDesign(d, catalogue).errors).toEqual([]);
  });

  it('rejects connections AWS would not allow', () => {
    const d = design([node('db', 'rds')], [['users', 'db']]);
    expect(validateDesign(d, catalogue).errors[0]).toMatch(/cannot send requests/);
  });

  it('rejects services that are not unlocked in the level', () => {
    const d = design([node('web', 'ec2')], [['users', 'web']]);
    const level = testLevel({ palette: ['s3'] });
    expect(validateDesign(d, catalogue, level).errors[0]).toMatch(/not unlocked/);
  });

  it('rejects an ASG whose min exceeds its max', () => {
    const d = design(
      [node('lb', 'alb'), node('asg', 'asg', { min: 5, max: 2 })],
      [
        ['users', 'lb'],
        ['lb', 'asg'],
      ],
    );
    expect(validateDesign(d, catalogue).errors.join()).toMatch(/min/);
  });

  it('warns about unconnected components and caches with no database', () => {
    const d = design(
      [node('web', 'ec2'), node('cache', 'elasticache'), node('orphan', 's3')],
      [
        ['users', 'web'],
        ['web', 'cache'],
      ],
    );
    const { warnings } = validateDesign(d, catalogue);
    expect(warnings.some((w) => w.includes('not connected'))).toBe(true);
    expect(warnings.some((w) => w.includes('cache misses'))).toBe(true);
  });
});

describe('findings', () => {
  it('flags a public bucket, open security group and public database', () => {
    const d = design(
      [
        node('s3', 's3'),
        node('web', 'ec2', { securityGroup: 'open-all' }),
        node('db', 'rds', { publiclyAccessible: true }),
      ],
      [
        ['users', 's3'],
        ['users', 'web'],
        ['web', 'db'],
      ],
    );
    expect(securityIssues(d, catalogue)).toHaveLength(3);
  });

  it('flags a single web server as a single point of failure', () => {
    const one = design(
      [node('web', 'ec2'), node('db', 'rds')],
      [
        ['users', 'web'],
        ['web', 'db'],
      ],
    );
    expect(
      singlePointsOfFailure(one, catalogue)
        .map((f) => f.message)
        .join(),
    ).toMatch(/Only one web server/);
    const two = design(
      [node('lb', 'alb'), node('a', 'ec2', { az: 'a' }), node('b', 'ec2', { az: 'b' }), node('db', 'rds')],
      [
        ['users', 'lb'],
        ['lb', 'a'],
        ['lb', 'b'],
        ['a', 'db'],
        ['b', 'db'],
      ],
    );
    expect(singlePointsOfFailure(two, catalogue)).toEqual([]);
  });
});
