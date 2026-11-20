import { z } from 'zod';

/** Every component a player can place, plus the fixed "users" entry node. */
export const ServiceKind = z.enum([
  'users',
  'ec2',
  'asg',
  'alb',
  'cloudfront',
  's3',
  'rds',
  'rds_replica',
  'elasticache',
]);
export type ServiceKind = z.infer<typeof ServiceKind>;

export const RequestType = z.enum(['static', 'read', 'write']);
export type RequestType = z.infer<typeof RequestType>;
export const REQUEST_TYPES: readonly RequestType[] = RequestType.options;

export const Az = z.enum(['a', 'b']);
export type Az = z.infer<typeof Az>;

// ---------------------------------------------------------------------------
// Service catalogue
// ---------------------------------------------------------------------------

/** An instance size with in-game throughput and price. Tuned for gameplay, not copied from AWS pricing. */
export const InstanceSize = z.object({
  id: z.string(),
  label: z.string(),
  /** Work units per second the node can process before it saturates. */
  capacity: z.number().positive(),
  monthlyCost: z.number().nonnegative(),
});
export type InstanceSize = z.infer<typeof InstanceSize>;

export const ServiceCategory = z.enum(['client', 'compute', 'networking', 'database', 'caching', 'storage']);

export const ServiceSpec = z.object({
  kind: ServiceKind,
  name: z.string(),
  shortName: z.string(),
  category: ServiceCategory,
  description: z.string(),
  whenToUse: z.string(),
  whenNotToUse: z.string(),
  docsUrl: z.string().url().optional(),
  /** Allowed outgoing connections. */
  connectsTo: z.array(ServiceKind),
  sizes: z.array(InstanceSize).optional(),
  defaultSize: z.string().optional(),
  /** Fixed capacity for services without sizes (units/sec). */
  capacity: z.number().positive().optional(),
  /** Fixed monthly cost for services without sizes. */
  monthlyCost: z.number().nonnegative().default(0),
  /** Price per million requests that reach the node. */
  perMillionRequests: z.number().nonnegative().default(0),
  /** Work units consumed per request, by request type. Missing type = cannot handle it. */
  cost: z.record(RequestType, z.number().nonnegative()),
  /** Base processing latency in ms, by request type. */
  latencyMs: z.record(RequestType, z.number().nonnegative()),
});
export type ServiceSpec = z.infer<typeof ServiceSpec>;

export const Catalogue = z.array(ServiceSpec).superRefine((services, ctx) => {
  const seen = new Set<string>();
  for (const s of services) {
    if (seen.has(s.kind)) ctx.addIssue({ code: 'custom', message: `duplicate service ${s.kind}` });
    seen.add(s.kind);
    if (s.sizes && s.defaultSize && !s.sizes.some((sz) => sz.id === s.defaultSize)) {
      ctx.addIssue({ code: 'custom', message: `${s.kind}: defaultSize ${s.defaultSize} not in sizes` });
    }
    if (!s.sizes && s.capacity === undefined && s.kind !== 'users') {
      ctx.addIssue({ code: 'custom', message: `${s.kind}: needs sizes or a fixed capacity` });
    }
  }
});

// ---------------------------------------------------------------------------
// Designs (what the player builds)
// ---------------------------------------------------------------------------

export const SecurityGroup = z.enum(['web-only', 'open-all']);

export const NodeConfig = z
  .object({
    size: z.string(),
    az: Az,
    /** ASG: number of AZs instances are spread over. */
    azs: z.union([z.literal(1), z.literal(2)]),
    min: z.number().int().min(0).max(50),
    max: z.number().int().min(1).max(50),
    /** ASG target CPU utilisation (0-1). */
    targetUtilization: z.number().min(0.2).max(0.95),
    securityGroup: SecurityGroup,
    elasticIp: z.boolean(),
    alarms: z.boolean(),
    healthChecks: z.boolean(),
    backupRetentionDays: z.union([z.literal(0), z.literal(7), z.literal(35)]),
    publiclyAccessible: z.boolean(),
    /** CloudFront / ElastiCache TTL in seconds. Longer = higher hit ratio but staler data. */
    ttlSeconds: z.number().int().positive(),
  })
  .partial();
export type NodeConfig = z.infer<typeof NodeConfig>;

export const DesignNode = z.object({
  id: z.string().min(1).max(64),
  kind: ServiceKind,
  label: z.string().max(40).optional(),
  x: z.number(),
  y: z.number(),
  config: NodeConfig.default({}),
  /** Pre-placed by the level; the player cannot delete it. */
  locked: z.boolean().optional(),
});
export type DesignNode = z.infer<typeof DesignNode>;

export const DesignEdge = z.object({
  id: z.string().min(1).max(140),
  from: z.string(),
  to: z.string(),
});
export type DesignEdge = z.infer<typeof DesignEdge>;

export const Design = z
  .object({
    nodes: z.array(DesignNode).max(80),
    edges: z.array(DesignEdge).max(200),
  })
  .superRefine((d, ctx) => {
    const ids = new Set<string>();
    for (const n of d.nodes) {
      if (ids.has(n.id)) ctx.addIssue({ code: 'custom', message: `duplicate node id ${n.id}` });
      ids.add(n.id);
    }
    for (const e of d.edges) {
      if (!ids.has(e.from) || !ids.has(e.to)) {
        ctx.addIssue({ code: 'custom', message: `edge ${e.id} references a missing node` });
      }
    }
  });
export type Design = z.infer<typeof Design>;

// ---------------------------------------------------------------------------
// Levels, traffic and incidents
// ---------------------------------------------------------------------------

/** Piecewise-linear daily traffic curve: [hourOfDay, fractionOfPeak]. */
export const TrafficCurve = z
  .array(z.tuple([z.number().min(0).max(24), z.number().min(0).max(1)]))
  .min(2)
  .refine((pts) => pts.every((p, i) => i === 0 || p[0] > pts[i - 1]![0]), 'hours must increase');

export const Traffic = z.object({
  peakRps: z.number().positive(),
  curve: TrafficCurve,
  mix: z
    .object({ static: z.number().min(0), read: z.number().min(0), write: z.number().min(0) })
    .refine((m) => Math.abs(m.static + m.read + m.write - 1) < 1e-6, 'mix must sum to 1'),
  /** Round-trip from users to the AWS region (ms). CloudFront edge hits skip it. */
  userLatencyMs: z.number().nonnegative(),
  /** +/- random noise applied per tick (0.05 = 5%). */
  noise: z.number().min(0).max(0.5).default(0.05),
});
export type Traffic = z.infer<typeof Traffic>;

const IncidentBase = z.object({
  id: z.string(),
  /** Minute of the simulated day when the incident starts. */
  atMinute: z.number().int().min(0).max(1439),
  /** Shown to the player before the run. Later levels give no warning. */
  warning: z.boolean().default(false),
  title: z.string(),
  lesson: z.string(),
});

export const TrafficSpikeIncident = IncidentBase.extend({
  type: z.literal('traffic_spike'),
  multiplier: z.number().min(1).max(50),
  rampMinutes: z.number().int().min(0),
  holdMinutes: z.number().int().min(1),
});

export const InstanceCrashIncident = IncidentBase.extend({
  type: z.literal('instance_crash'),
  /** Which instance dies; "random" picks a running compute instance with the seeded RNG. */
  target: z.literal('random').default('random'),
});

export const Incident = z.discriminatedUnion('type', [TrafficSpikeIncident, InstanceCrashIncident]);
export type Incident = z.infer<typeof Incident>;

export const ConfigCheck = z.enum(['elasticIp', 'backups', 'healthChecks', 'alarms', 'multiAz']);
export type ConfigCheck = z.infer<typeof ConfigCheck>;

export const Objective = z.discriminatedUnion('type', [
  z.object({ type: z.literal('availability'), min: z.number().min(0).max(1) }),
  z.object({ type: z.literal('p95'), maxMs: z.number().positive(), requestType: RequestType.optional() }),
  z.object({ type: z.literal('noDataLoss') }),
  z.object({ type: z.literal('noSecurityIssues') }),
  z.object({ type: z.literal('uses'), kind: ServiceKind }),
  z.object({ type: z.literal('config'), check: ConfigCheck }),
]);
export type Objective = z.infer<typeof Objective>;

export const Pillar = z.enum([
  'reliability',
  'performance',
  'cost',
  'security',
  'operations',
  'sustainability',
]);
export type Pillar = z.infer<typeof Pillar>;
export const PILLARS: readonly Pillar[] = Pillar.options;

export const Level = z.object({
  id: z.string().regex(/^\d+-\d+$/),
  act: z.number().int().min(1),
  index: z.number().int().min(1).max(5),
  boss: z.boolean().default(false),
  title: z.string(),
  /** The client's message. */
  brief: z.string(),
  from: z.string(),
  /** What the level teaches. */
  lesson: z.string(),
  budget: z.number().positive(),
  traffic: Traffic,
  incidents: z.array(Incident).default([]),
  objectives: z.array(Objective).min(1),
  palette: z.array(ServiceKind.exclude(['users'])).min(1),
  startingDesign: Design,
  weights: z.record(Pillar, z.number().min(0)),
  hints: z.array(z.string()).default([]),
  seed: z.number().int().default(42),
});
export type Level = z.infer<typeof Level>;
export type LevelInput = z.input<typeof Level>;

export const Act = z.object({
  act: z.number().int().min(1),
  title: z.string(),
  stage: z.string(),
  scale: z.string(),
});
export type Act = z.infer<typeof Act>;
