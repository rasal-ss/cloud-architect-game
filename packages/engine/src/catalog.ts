import type { Design, DesignNode, NodeConfig, ServiceKind, ServiceSpec } from '@cloud-architect/content';

export const COMPUTE_KINDS: readonly ServiceKind[] = ['ec2', 'asg'];
export const DB_KINDS: readonly ServiceKind[] = ['rds', 'rds_replica'];

export const isCompute = (k: ServiceKind) => k === 'ec2' || k === 'asg';

/** Add-on prices (per month) for configuration options. */
export const ADDON_COST = {
  elasticIp: 3.6,
  alarms: 1,
  backups7: 3,
  backups35: 10,
} as const;

/** Extra $/million for static files served straight off a server (bandwidth heavy). */
export const SERVER_STATIC_EGRESS_PER_MILLION = 1.2;

/** Extra work and latency when a server also hosts its own database. */
export const EMBEDDED_DB = {
  cost: { read: 1.5, write: 2.5 },
  latencyMs: { read: 15, write: 30 },
} as const;

/** Minutes it takes a new instance to boot and pass health checks. */
export const WARMUP_MINUTES = 3;
/** Standalone EC2 recovery time, with and without a CloudWatch alarm recover action. */
export const EC2_RECOVERY_MINUTES = { withAlarm: 3, withoutAlarm: 10 } as const;
/** Time for an ASG to notice a dead instance (EC2 status checks). */
export const ASG_DETECT_MINUTES = 2;
/** Consecutive low-load minutes before an ASG removes an instance. */
export const SCALE_IN_COOLDOWN = 10;
/** Minutes for an empty cache to reach its steady-state hit ratio. */
export const CACHE_WARMUP_MINUTES = 20;

export class Catalogue {
  private readonly byKind: Map<ServiceKind, ServiceSpec>;

  constructor(readonly services: readonly ServiceSpec[]) {
    this.byKind = new Map(services.map((s) => [s.kind, s]));
  }

  get(kind: ServiceKind): ServiceSpec {
    const spec = this.byKind.get(kind);
    if (!spec) throw new Error(`Unknown service kind: ${kind}`);
    return spec;
  }

  canConnect(from: ServiceKind, to: ServiceKind): boolean {
    return this.get(from).connectsTo.includes(to);
  }

  /** Per-instance capacity and price for a node, resolving its size. */
  sizeOf(node: DesignNode): { capacity: number; monthlyCost: number; id: string } {
    const spec = this.get(node.kind);
    if (spec.sizes?.length) {
      const id = node.config.size ?? spec.defaultSize ?? spec.sizes[0]!.id;
      const size = spec.sizes.find((s) => s.id === id);
      if (!size) throw new Error(`${node.id}: unknown size ${id} for ${node.kind}`);
      return size;
    }
    return { id: 'standard', capacity: spec.capacity ?? Infinity, monthlyCost: spec.monthlyCost };
  }

  /** Full config for a node with defaults filled in. */
  configOf(node: DesignNode): Required<NodeConfig> {
    return { ...defaultConfig(node.kind, this.get(node.kind)), ...node.config } as Required<NodeConfig>;
  }

  /** Monthly cost of add-ons such as Elastic IPs, alarms and backups. */
  addonCost(node: DesignNode): number {
    const c = this.configOf(node);
    let cost = 0;
    if (node.kind === 'ec2' && c.elasticIp) cost += ADDON_COST.elasticIp;
    if (isCompute(node.kind) && c.alarms) cost += ADDON_COST.alarms;
    if (node.kind === 'rds') {
      if (c.backupRetentionDays === 7) cost += ADDON_COST.backups7;
      if (c.backupRetentionDays === 35) cost += ADDON_COST.backups35;
    }
    return cost;
  }
}

export function defaultConfig(kind: ServiceKind, spec?: ServiceSpec): NodeConfig {
  const size = spec?.defaultSize;
  switch (kind) {
    case 'ec2':
      return { size, az: 'a', securityGroup: 'web-only', elasticIp: false, alarms: false };
    case 'asg':
      return {
        size,
        min: 2,
        max: 6,
        targetUtilization: 0.6,
        azs: 2,
        securityGroup: 'web-only',
        alarms: false,
      };
    case 'alb':
      return { healthChecks: true };
    case 'cloudfront':
      return { ttlSeconds: 3600 };
    case 'rds':
      return { size, az: 'a', backupRetentionDays: 7, publiclyAccessible: false };
    case 'rds_replica':
      return { size, az: 'b' };
    case 'elasticache':
      return { size, ttlSeconds: 300 };
    default:
      return {};
  }
}

/** CloudFront static hit ratio by TTL: 60 s ~ 83%, 1 h ~ 91%, 1 day ~ 97%. */
export function cdnHitRatio(ttlSeconds: number): number {
  return Math.min(0.97, 0.75 + 0.045 * Math.log10(Math.max(1, ttlSeconds)));
}

/** ElastiCache steady-state hit ratio by TTL: 30 s ~ 57%, 5 min ~ 75%, 1 h ~ 94%. */
export function cacheHitRatio(ttlSeconds: number): number {
  return Math.min(0.97, 0.3 + 0.18 * Math.log10(Math.max(1, ttlSeconds)));
}

export function nodeLabel(node: DesignNode, catalogue: Catalogue): string {
  return node.label ?? catalogue.get(node.kind).shortName;
}

export function findUsers(design: Design): DesignNode | undefined {
  return design.nodes.find((n) => n.kind === 'users');
}
