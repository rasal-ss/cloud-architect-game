import type { Design, Level, Objective, Pillar } from '@cloud-architect/content';
import { type Catalogue, isCompute, nodeLabel } from './catalog';
import {
  type Finding,
  buildGraph,
  computeTier,
  operationsChecks,
  securityIssues,
  singlePointsOfFailure,
} from './graph';
import { formatMinute } from './traffic';
import type { Bottleneck, Metrics, ObjectiveResult, SimEvent, SimResult } from './types';

const PILLARS: readonly Pillar[] = [
  'reliability',
  'performance',
  'cost',
  'security',
  'operations',
  'sustainability',
];

export const STAR_THRESHOLDS = { two: 70, three: 85 } as const;
const DEFAULT_AVAILABILITY_TARGET = 0.99;
const DEFAULT_P95_TARGET_MS = 400;

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const pct = (x: number, digits = 2) => `${(x * 100).toFixed(digits)}%`;
const ms = (x: number) => `${Math.round(x)} ms`;
const usd = (x: number) => `$${x.toFixed(2)}`;

interface ScoreInput {
  design: Design;
  level: Level;
  catalogue: Catalogue;
  metrics: Metrics;
  events: SimEvent[];
  validation: { errors: string[]; warnings: string[] };
  seed: number;
}

export function scoreRun(input: ScoreInput): SimResult {
  const { design, level, catalogue, metrics, events, validation, seed } = input;
  const security = securityIssues(design, catalogue);
  const spofs = singlePointsOfFailure(design, catalogue);
  const operations = operationsChecks(design, catalogue);
  const valid = validation.errors.length === 0;

  const objectives: ObjectiveResult[] = level.objectives.map((o) =>
    evaluateObjective(o, design, catalogue, metrics, security),
  );
  objectives.push({
    objective: { type: 'budget', max: level.budget },
    label: `Monthly cost under ${usd(level.budget)}`,
    pass: metrics.monthlyCost <= level.budget,
    actual: usd(metrics.monthlyCost),
  });
  if (!valid) for (const o of objectives) o.pass = false;

  const pillars = pillarScores(level, design, catalogue, metrics, security, spofs, operations);
  const totalWeight = PILLARS.reduce((s, p) => s + (level.weights[p] ?? 0), 0) || 1;
  const score = valid
    ? Math.round(PILLARS.reduce((s, p) => s + pillars[p] * (level.weights[p] ?? 0), 0) / totalWeight)
    : 0;
  const passed = valid && objectives.every((o) => o.pass);
  const stars: SimResult['stars'] = !passed
    ? 0
    : score >= STAR_THRESHOLDS.three
      ? 3
      : score >= STAR_THRESHOLDS.two
        ? 2
        : 1;

  const bottlenecks: Bottleneck[] = Object.entries(metrics.peakUtil)
    .filter(([, u]) => u >= 0.8)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([nodeId, peakUtil]) => {
      const node = design.nodes.find((n) => n.id === nodeId)!;
      return { nodeId, label: nodeLabel(node, catalogue), peakUtil };
    });

  const hints = buildHints({
    level,
    design,
    catalogue,
    metrics,
    security,
    spofs,
    objectives,
    events,
    stars,
    valid,
  });

  return {
    levelId: level.id,
    seed,
    valid,
    errors: validation.errors,
    warnings: validation.warnings,
    metrics,
    objectives,
    pillars,
    score,
    stars,
    passed,
    securityIssues: security,
    spofs,
    operations,
    bottlenecks,
    hints,
    events,
  };
}

export function objectiveLabel(o: Objective, catalogue?: Catalogue): string {
  switch (o.type) {
    case 'availability':
      return `Availability of at least ${pct(o.min, o.min >= 0.999 ? 2 : 1)}`;
    case 'p95':
      return o.requestType
        ? `p95 latency for ${o.requestType} requests under ${ms(o.maxMs)}`
        : `p95 latency under ${ms(o.maxMs)}`;
    case 'noDataLoss':
      return 'No orders lost';
    case 'noSecurityIssues':
      return 'No security issues';
    case 'uses':
      return `Use ${catalogue ? catalogue.get(o.kind).name : o.kind}`;
    case 'config':
      return {
        elasticIp: 'Every EC2 instance has an Elastic IP',
        backups: 'Automated database backups are on',
        healthChecks: 'Load balancer health checks are on',
        alarms: 'Every server has CloudWatch alarms',
        multiAz: 'Web servers span two Availability Zones',
      }[o.check];
  }
}

function evaluateObjective(
  o: Objective,
  design: Design,
  catalogue: Catalogue,
  metrics: Metrics,
  security: Finding[],
): ObjectiveResult {
  const label = objectiveLabel(o, catalogue);
  const g = buildGraph(design);
  const reachable = design.nodes.filter((n) => g.reachable.has(n.id));
  const all = (kinds: string[], pred: (cfg: ReturnType<Catalogue['configOf']>) => boolean) => {
    const nodes = reachable.filter((n) => kinds.includes(n.kind));
    const ok = nodes.filter((n) => pred(catalogue.configOf(n))).length;
    return { pass: nodes.length > 0 && ok === nodes.length, actual: `${ok} of ${nodes.length}` };
  };
  switch (o.type) {
    case 'availability':
      return {
        objective: o,
        label,
        pass: metrics.availability >= o.min,
        actual: pct(metrics.availability, 3),
      };
    case 'p95': {
      const v = o.requestType ? (metrics.p95ByType[o.requestType] ?? Infinity) : metrics.p95;
      return { objective: o, label, pass: v <= o.maxMs, actual: Number.isFinite(v) ? ms(v) : 'no traffic' };
    }
    case 'noDataLoss':
      return {
        objective: o,
        label,
        pass: !metrics.dataLoss,
        actual: metrics.dataLoss ? `${metrics.lostWrites.toLocaleString('en-US')} lost` : 'none lost',
      };
    case 'noSecurityIssues':
      return { objective: o, label, pass: security.length === 0, actual: `${security.length} issue(s)` };
    case 'uses': {
      const used = reachable.some((n) => n.kind === o.kind);
      return { objective: o, label, pass: used, actual: used ? 'yes' : 'no' };
    }
    case 'config': {
      let r: { pass: boolean; actual: string };
      switch (o.check) {
        case 'elasticIp':
          r = all(['ec2'], (c) => c.elasticIp);
          break;
        case 'backups':
          r = all(['rds'], (c) => c.backupRetentionDays > 0);
          break;
        case 'healthChecks':
          r = all(['alb'], (c) => c.healthChecks);
          break;
        case 'alarms':
          r = all(['ec2', 'asg'], (c) => c.alarms);
          break;
        case 'multiAz': {
          const tier = computeTier(design, catalogue);
          r = { pass: tier.azs.size >= 2, actual: `${tier.azs.size} AZ(s)` };
          break;
        }
      }
      return { objective: o, label, ...r };
    }
  }
}

function pillarScores(
  level: Level,
  design: Design,
  catalogue: Catalogue,
  m: Metrics,
  security: Finding[],
  spofs: Finding[],
  ops: { pass: boolean }[],
): Record<Pillar, number> {
  // Reliability: availability against target, minus single points of failure.
  const availTarget =
    level.objectives.find((o): o is Extract<Objective, { type: 'availability' }> => o.type === 'availability')
      ?.min ?? DEFAULT_AVAILABILITY_TARGET;
  let reliability =
    m.availability >= availTarget
      ? 100
      : 100 * (1 - (0.5 * (availTarget - m.availability)) / Math.max(1e-4, 1 - availTarget));
  reliability -= 8 * spofs.length;
  if (m.dataLoss) reliability = 0;

  // Performance: p95 against target.
  const p95Target =
    level.objectives.find((o): o is Extract<Objective, { type: 'p95' }> => o.type === 'p95' && !o.requestType)
      ?.maxMs ?? DEFAULT_P95_TARGET_MS;
  const r = m.p95 / p95Target;
  const performance = r <= 0.6 ? 100 : r <= 1 ? 100 - 25 * (r - 0.6) : 90 - 120 * (r - 1);

  // Cost: 75 at budget, up to 100 the further under; drops fast when over.
  const c = m.monthlyCost / level.budget;
  const cost = c <= 1 ? 75 + 25 * (1 - c) : 75 - 150 * (c - 1);

  const securityScore = 100 - 30 * security.length;
  const operations = ops.length ? (100 * ops.filter((o) => o.pass).length) / ops.length : 100;

  // Sustainability: busy, right-sized resources. A node already at its smallest size is never "too big".
  const g = buildGraph(design);
  let weighted = 0;
  let totalCost = 0;
  for (const n of design.nodes) {
    if (n.kind === 'users') continue;
    const spec = catalogue.get(n.kind);
    if (!spec.sizes?.length) continue;
    const size = catalogue.sizeOf(n);
    const smallest = size.id === spec.sizes[0]!.id;
    const u = m.p95Util[n.id] ?? 0;
    let s: number;
    if (!g.reachable.has(n.id)) s = 0;
    else if (n.kind === 'asg') {
      const cfg = catalogue.configOf(n);
      s = smallest || u >= 0.3 || cfg.min <= 2 ? 100 : 40 + 200 * u;
    } else s = smallest || u >= 0.3 ? 100 : 40 + 200 * u;
    const w = size.monthlyCost * (isCompute(n.kind) && n.kind === 'asg' ? catalogue.configOf(n).min : 1);
    weighted += s * w;
    totalCost += w;
  }
  const sustainability = totalCost > 0 ? weighted / totalCost : 100;

  return {
    reliability: Math.round(clamp(reliability)),
    performance: Math.round(clamp(performance)),
    cost: Math.round(clamp(cost)),
    security: Math.round(clamp(securityScore)),
    operations: Math.round(clamp(operations)),
    sustainability: Math.round(clamp(sustainability)),
  };
}

function buildHints(args: {
  level: Level;
  design: Design;
  catalogue: Catalogue;
  metrics: Metrics;
  security: Finding[];
  spofs: Finding[];
  objectives: ObjectiveResult[];
  events: SimEvent[];
  stars: number;
  valid: boolean;
}): string[] {
  const { level, design, catalogue, metrics, security, spofs, objectives, events, stars, valid } = args;
  const hints: string[] = [];
  if (!valid) return ['Fix the design errors before running the simulation.'];

  const u = metrics.unroutable;
  if (u.write > 0)
    hints.push('Some writes had nowhere to go. Connect your servers to the primary RDS database.');
  if (u.read > 0)
    hints.push('Some reads had nowhere to go. Check that caches and replicas have a database behind them.');
  if (u.static > 0 || (u.read > 0 && !design.edges.length)) {
    hints.push('Some requests could not reach any server. Connect Users to an entry point.');
  }
  if (metrics.dataLoss) {
    hints.push(
      "Orders were stored on an EC2 instance's own disk and vanished when it crashed. Move the data to RDS.",
    );
  }
  for (const [id, peak] of Object.entries(metrics.peakUtil).sort((a, b) => b[1] - a[1])) {
    if (peak <= 1) break;
    const node = design.nodes.find((n) => n.id === id)!;
    const first = events.find((e) => e.nodeId === id && e.message.includes('overloaded'));
    const when = first ? ` at ${formatMinute(first.minute)}` : '';
    const fix =
      node.kind === 'asg'
        ? 'Raise its maximum size, use bigger instances or lower the target utilisation for more headroom.'
        : node.kind === 'ec2'
          ? 'Use a bigger instance, add more servers behind a load balancer, or offload static files.'
          : 'Use a bigger instance size or take load off it.';
    hints.push(`${nodeLabel(node, catalogue)} peaked at ${Math.round(peak * 100)}% load${when}. ${fix}`);
    if (hints.length > 6) break;
  }
  if (metrics.totalRequests > 0 && metrics.staticOnServers / metrics.totalRequests > 0.05) {
    hints.push(
      'Your servers spend CPU and bandwidth on images. Serve static files from S3, ideally through CloudFront.',
    );
  }
  for (const s of spofs) hints.push(s.message);
  for (const s of security) hints.push(s.message);
  const budget = objectives.find((o) => o.objective.type === 'budget');
  if (budget && !budget.pass) {
    const top = metrics.costBreakdown[0];
    hints.push(
      `You are over budget. The biggest line item is ${top?.label} at ${usd(top?.monthly ?? 0)}/month. Is it right-sized?`,
    );
  }
  for (const o of objectives) {
    if (o.pass || o.objective.type !== 'config') continue;
    hints.push(`Objective not met: ${o.label}. Select the component and change its settings.`);
  }
  if (stars < 3) hints.push(...level.hints);
  return [...new Set(hints)];
}
