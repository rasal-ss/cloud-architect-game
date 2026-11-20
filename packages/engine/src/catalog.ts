import type { Design, DesignNode, NodeConfig, ServiceKind, ServiceSpec } from '@cloud-architect/content';

export const COMPUTE_KINDS: readonly ServiceKind[] = ['ec2', 'asg'];
export const DB_KINDS: readonly ServiceKind[] = ['rds', 'rds_replica'];

/** Servers you run yourself (can crash, scale, hold sessions). */
export const isCompute = (k: ServiceKind) => k === 'ec2' || k === 'asg';
/** Anything that runs application code: servers or Lambda functions. */
export const isWorker = (k: ServiceKind) => k === 'ec2' || k === 'asg' || k === 'lambda';
/** Hand-off points: the caller is done once the message is accepted. */
export const isAsync = (k: ServiceKind) => k === 'sqs' || k === 'sns' || k === 'eventbridge';
/** Relational databases with connection limits and AZ placement. */
export const isRelational = (k: ServiceKind) => k === 'rds' || k === 'rds_replica';

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
/** Database pool size each server instance keeps open. */
export const CONNECTIONS_PER_INSTANCE = 10;
/** Connections RDS Proxy keeps open to the database, however many clients it serves. */
export const PROXY_CONNECTIONS = 50;
/** Database recovery after the primary fails. */
export const DB_RECOVERY_MINUTES = { multiAz: 1, singleAz: 20 } as const;
/** Point-in-time restore: how long it takes and how much recent data is lost. */
export const PITR = { restoreMinutes: 20, rpoMinutes: 5 } as const;
/** DynamoDB: work units per second a single partition (one key) can absorb. */
export const PARTITION_LIMIT = 500;
/** Share of DynamoDB traffic on the busiest key, by partition key design. */
export const HOT_KEY_SHARE = {
  'order-id': 0.0005,
  'customer-id': 0.005,
  'coupon-code': 0.06,
  'coupon-code-sharded': 0.006,
} as const;
/** Share of coupon traffic on one key while a coupon is viral. */
export const VIRAL_COUPON_SHARE = 0.7;
/** SQS FIFO throughput limit (messages per second, without batching). */
export const FIFO_LIMIT = 300;
/** Receives before SQS moves a failing message to the dead-letter queue. */
export const MAX_RECEIVES = 3;
/** Price per GB-second of Lambda compute. */
export const LAMBDA_GB_SECOND = 0.0000167;
/** GB-seconds billed per unit of work (more memory runs proportionally faster, so this is memory-neutral). */
export const LAMBDA_GB_SECONDS_PER_UNIT = 0.025;
/** On-demand DynamoDB price per million requests by type. */
export const DYNAMO_ON_DEMAND = { read: 0.25, write: 1.25 } as const;
/** Provisioned DynamoDB price per unit per month. */
export const DYNAMO_UNIT_MONTH = 0.35;

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
  sizeOf(node: DesignNode): {
    capacity: number;
    monthlyCost: number;
    id: string;
    memoryMb?: number;
    maxConnections?: number;
  } {
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
      // A Multi-AZ standby is a second, identical instance.
      if (c.multiAz) cost += this.sizeOf(node).monthlyCost;
    }
    if (node.kind === 'dynamodb' && c.capacityMode === 'provisioned') {
      cost += c.provisionedUnits * DYNAMO_UNIT_MONTH;
    }
    return cost;
  }
}

export function defaultConfig(kind: ServiceKind, spec?: ServiceSpec): NodeConfig {
  const size = spec?.defaultSize;
  switch (kind) {
    case 'ec2':
      return {
        size,
        az: 'a',
        securityGroup: 'web-only',
        elasticIp: false,
        alarms: false,
        sessionStore: 'instance',
      };
    case 'asg':
      return {
        size,
        min: 2,
        max: 6,
        targetUtilization: 0.6,
        azs: 2,
        securityGroup: 'web-only',
        alarms: false,
        sessionStore: 'instance',
      };
    case 'alb':
      return { healthChecks: true };
    case 'cloudfront':
      return { ttlSeconds: 3600 };
    case 'rds':
      return { size, az: 'a', backupRetentionDays: 7, publiclyAccessible: false, multiAz: false };
    case 'rds_replica':
      return { size, az: 'b' };
    case 'elasticache':
      return { size, ttlSeconds: 300 };
    case 'lambda':
      return { size, concurrency: 1000 };
    case 'dynamodb':
      return { capacityMode: 'on-demand', provisionedUnits: 1000, partitionKey: 'order-id' };
    case 'sqs':
      return { dlq: false, fifo: false };
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
