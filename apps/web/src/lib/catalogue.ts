import { services } from '@cloud-architect/content';
import { Catalogue } from '@cloud-architect/engine';

export const catalogue = new Catalogue(services);

/** Category colours loosely inspired by AWS architecture diagrams. */
export const CATEGORY_COLOR: Record<string, string> = {
  client: '#64748b',
  compute: '#ed7100',
  networking: '#8c4fff',
  database: '#3b82f6',
  caching: '#c925d1',
  storage: '#7aa116',
};

export const KIND_GLYPH: Record<string, string> = {
  users: 'WWW',
  ec2: 'EC2',
  asg: 'ASG',
  alb: 'ALB',
  cloudfront: 'CF',
  s3: 'S3',
  rds: 'RDS',
  rds_replica: 'RR',
  elasticache: 'EC',
};

export const REQUEST_COLOR = {
  static: '#38bdf8',
  read: '#4ade80',
  write: '#fb923c',
} as const;

export const money = (x: number) =>
  x >= 10_000 ? `$${(x / 1000).toFixed(1)}k` : `$${x.toFixed(x < 100 ? 2 : 0)}`;
export const percent = (x: number, digits = 2) => `${(x * 100).toFixed(digits)}%`;
