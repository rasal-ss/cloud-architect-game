import type { Objective, Pillar, RequestType } from '@cloud-architect/content';
import type { Finding, OpsCheck } from './graph';

export type Flow = Record<RequestType, number>;
export type NodeStatus = 'idle' | 'ok' | 'warm' | 'hot' | 'down';

export interface NodeTick {
  /** Load as a fraction of capacity (can exceed 1). */
  util: number;
  /** Requests per second arriving at the node. */
  rps: number;
  status: NodeStatus;
  /** In-service instances (Auto Scaling Groups only). */
  instances?: number;
  /** Instances booting (Auto Scaling Groups only). */
  pending?: number;
  /** Messages waiting (SQS only). */
  backlog?: number;
  /** Concurrent executions (Lambda only). */
  concurrency?: number;
}

export interface EdgeTick {
  rps: number;
  /** Request type with the most traffic on the edge. */
  type: RequestType;
  /** True if a noticeable share of this edge's requests fail downstream. */
  failing: boolean;
}

export interface TickSnapshot {
  minute: number;
  rps: number;
  failedRps: number;
  /** p95 latency of requests in this minute (ms). */
  p95: number;
  /** Projected monthly cost so far ($). */
  costPerMonth: number;
  /** Availability so far (0-1). */
  availability: number;
  nodes: Record<string, NodeTick>;
  edges: Record<string, EdgeTick>;
}

export type EventSeverity = 'info' | 'warning' | 'critical' | 'good';

export interface SimEvent {
  minute: number;
  severity: EventSeverity;
  message: string;
  nodeId?: string;
}

export interface CostLine {
  nodeId: string;
  label: string;
  monthly: number;
}

export interface Metrics {
  availability: number;
  totalRequests: number;
  failedRequests: number;
  p50: number;
  p95: number;
  p99: number;
  p95ByType: Partial<Record<RequestType, number>>;
  monthlyCost: number;
  costBreakdown: CostLine[];
  dataLoss: boolean;
  lostWrites: number;
  /** Requests that had nowhere to go, by type. */
  unroutable: Flow;
  /** Static requests served by EC2/ASG instead of S3/CloudFront. */
  staticOnServers: number;
  peakUtil: Record<string, number>;
  /** 95th percentile of per-minute utilisation per node. */
  p95Util: Record<string, number>;
  /** Oldest data a read could return (cache TTL, replica lag), in seconds. */
  stalenessSec: number;
  /** Minutes of orders lost in a disaster; Infinity if everything was lost. */
  rpoMinutes: number;
  /** Queues: largest backlog, backlog left at the end, longest wait, messages sent to a DLQ. */
  queue: {
    peakBacklog: number;
    endBacklog: number;
    maxDelayMin: number;
    deadLettered: number;
    poisonLeft: number;
  };
  /** Events or messages dropped before reaching a consumer. */
  lostMessages: number;
  /** Orders placed by customers and orders successfully charged by the payment provider. */
  ordersPlaced: number;
  ordersCharged: number;
  /** Logged-in customers who lost their session because a server disappeared. */
  sessionsLost: number;
  /** Peak database connections as a share of the limit, per relational node. */
  connectionPeak: Record<string, number>;
  /** Share of Lambda invocations that hit a cold start. */
  coldStartShare: number;
  /** DynamoDB requests rejected because one partition was too hot. */
  throttled: number;
}

export interface ObjectiveResult {
  objective: Objective | { type: 'budget'; max: number };
  label: string;
  pass: boolean;
  actual: string;
}

export interface Bottleneck {
  nodeId: string;
  label: string;
  peakUtil: number;
}

export interface SimResult {
  levelId: string;
  seed: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
  metrics: Metrics;
  objectives: ObjectiveResult[];
  pillars: Record<Pillar, number>;
  score: number;
  stars: 0 | 1 | 2 | 3;
  passed: boolean;
  securityIssues: Finding[];
  spofs: Finding[];
  operations: OpsCheck[];
  bottlenecks: Bottleneck[];
  hints: string[];
  events: SimEvent[];
}
