import { services } from '@cloud-architect/content';
import { Catalogue } from '@cloud-architect/engine';

export const catalogue = new Catalogue(services);

/** Category colours, tuned for a dark background. Health colours (green/amber/red) stay distinct. */
export const CATEGORY_COLOR: Record<string, string> = {
  client: '#9aa3b2',
  compute: '#f2994a',
  networking: '#a990ff',
  database: '#5ea8ff',
  caching: '#f177c4',
  storage: '#9bd25f',
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
  static: '#5aa9ff',
  read: '#3ccf87',
  write: '#ffa04d',
} as const;

export const FAIL_COLOR = '#ff6a5f';

export const money = (x: number) =>
  x >= 10_000 ? `$${(x / 1000).toFixed(1)}k` : `$${x.toFixed(x < 100 ? 2 : 0)}`;
export const percent = (x: number, digits = 2) => `${(x * 100).toFixed(digits)}%`;
