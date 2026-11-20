import { services } from '@cloud-architect/content';
import { Catalogue } from '@cloud-architect/engine';

export const catalogue = new Catalogue(services);

/** Category colours, kept muted so health colours (green/amber/red) stand out. */
export const CATEGORY_COLOR: Record<string, string> = {
  client: '#5f6470',
  compute: '#c4620c',
  networking: '#6a4fc4',
  database: '#2b62c9',
  caching: '#a8327f',
  storage: '#4d7d14',
};

export const KIND_GLYPH: Record<string, string> = {
  users: 'WWW',
  ec2: 'EC2',
  asg: 'ASG',
  alb: 'ALB',
  cloudfront: 'CDN',
  s3: 'S3',
  rds: 'RDS',
  rds_replica: 'RR',
  elasticache: 'RC',
};

export const REQUEST_COLOR = {
  static: '#2f7de1',
  read: '#16935a',
  write: '#d9751c',
} as const;

export const FAIL_COLOR = '#d23b2e';

export const money = (x: number) =>
  x >= 10_000 ? `$${(x / 1000).toFixed(1)}k` : `$${x.toFixed(x < 100 ? 2 : 0)}`;
export const percent = (x: number, digits = 2) => `${(x * 100).toFixed(digits)}%`;
