import type { Design, DesignNode, Level, RequestType, ServiceKind } from '@cloud-architect/content';
import {
  ASG_DETECT_MINUTES,
  CACHE_WARMUP_MINUTES,
  type Catalogue,
  EC2_RECOVERY_MINUTES,
  EMBEDDED_DB,
  SCALE_IN_COOLDOWN,
  SERVER_STATIC_EGRESS_PER_MILLION,
  WARMUP_MINUTES,
  cacheHitRatio,
  cdnHitRatio,
  isCompute,
  nodeLabel,
} from './catalog';
import { type Graph, buildGraph, validateDesign } from './graph';
import { type Dist, Histogram, loadMultiplier, mix, percentileOfDist, shift } from './latency';
import { type Rng, createRng, weightedPick } from './rng';
import { scoreRun } from './score';
import { MINUTES_PER_DAY, curveAt, formatMinute, spikeFactor } from './traffic';
import type {
  EdgeTick,
  Flow,
  Metrics,
  NodeStatus,
  NodeTick,
  SimEvent,
  SimResult,
  TickSnapshot,
} from './types';

const TYPES: readonly RequestType[] = ['static', 'read', 'write'];
const zeroFlow = (): Flow => ({ static: 0, read: 0, write: 0 });
const MINUTES_PER_MONTH = 30 * MINUTES_PER_DAY;

/** How a node handles one request type: answer it here, pass it to children, or fail it. */
interface Plan {
  /** Fraction answered at this node. */
  terminal: number;
  forwards: { to: string; frac: number }[];
  /** Fraction with nowhere to go. */
  unroutable: number;
  /** Extra work units and latency (a server that also hosts its own database). */
  extraCost: number;
  extraLatency: number;
}

interface ComputeState {
  // Standalone EC2
  down: boolean;
  downSince: number;
  downUntil: number;
  // Auto Scaling Group
  inService: number;
  pending: number[];
  zombies: { since: number; until: number }[];
  lowTicks: number;
  /** Writes stored on the instance's own disk (lost if it dies). */
  localWrites: number;
}

interface NodeCalc {
  plans: Record<RequestType, Plan>;
  load: number;
  capacity: number;
  util: number;
  accept: number;
  demand: Flow;
}

export interface SimulationOptions {
  /** Override the level's seed (used by tests and daily challenges). */
  seed?: number;
  /** Number of simulated minutes (defaults to a full day). */
  minutes?: number;
}

/**
 * A step-by-step simulation of one design against one level. Each step is one simulated
 * minute. It is deterministic: the same design, level and seed always give the same result.
 */
export class Simulation {
  readonly graph: Graph;
  readonly validation: { errors: string[]; warnings: string[] };
  readonly totalMinutes: number;
  readonly seed: number;
  minute = 0;

  private readonly rng: Rng;
  private readonly state = new Map<string, ComputeState>();
  private readonly canServeMemo = new Map<string, boolean>();
  private readonly events: SimEvent[] = [];
  private readonly overloaded = new Set<string>();

  // Accumulators
  private total = 0;
  private failed = 0;
  private readonly hist = new Histogram();
  private readonly histByType: Record<RequestType, Histogram> = {
    static: new Histogram(),
    read: new Histogram(),
    write: new Histogram(),
  };
  private readonly fixedCost = new Map<string, number>();
  private readonly varCost = new Map<string, number>();
  private readonly utilSeries = new Map<string, number[]>();
  private readonly unroutable = zeroFlow();
  private staticOnServers = 0;
  private dataLoss = false;
  private lostWrites = 0;

  constructor(
    readonly design: Design,
    readonly level: Level,
    readonly catalogue: Catalogue,
    options: SimulationOptions = {},
  ) {
    this.validation = validateDesign(design, catalogue, level);
    this.graph = buildGraph(design);
    this.seed = options.seed ?? level.seed;
    this.rng = createRng(this.seed);
    this.totalMinutes = this.validation.errors.length ? 0 : (options.minutes ?? MINUTES_PER_DAY);

    for (const n of design.nodes) {
      if (!isCompute(n.kind)) continue;
      const c = catalogue.configOf(n);
      this.state.set(n.id, {
        down: false,
        downSince: -1,
        downUntil: -1,
        inService: n.kind === 'asg' ? c.min : 1,
        pending: [],
        zombies: [],
        lowTicks: 0,
        localWrites: 0,
      });
    }
    for (const inc of level.incidents) {
      if (inc.warning) {
        this.events.push({
          minute: inc.atMinute,
          severity: 'info',
          message: `Forecast: ${inc.title} at ${formatMinute(inc.atMinute)}.`,
        });
      }
    }
  }

  get done(): boolean {
    return this.minute >= this.totalMinutes;
  }

  /** Advances one simulated minute and returns a snapshot for the UI. */
  step(): TickSnapshot {
    if (this.done) throw new Error('Simulation already finished');
    const m = this.minute;
    const { graph, level, catalogue } = this;

    this.applyIncidents(m);

    // 1. Traffic arriving this minute.
    const t = level.traffic;
    const noise = 1 + t.noise * (this.rng() * 2 - 1);
    const rps = t.peakRps * curveAt(t.curve, m) * spikeFactor(level.incidents, m) * noise;
    const demand = new Map<string, Flow>(this.design.nodes.map((n) => [n.id, zeroFlow()]));
    const users = demand.get(graph.usersId)!;
    for (const type of TYPES) users[type] = rps * t.mix[type];

    // 2. Forward pass: push demand down the graph in topological order.
    const calc = new Map<string, NodeCalc>();
    const replicationLoad = new Map<string, number>();
    const edgeFlow = new Map<string, Flow>();
    for (const id of graph.order) {
      if (!graph.reachable.has(id)) continue;
      const node = graph.nodes.get(id)!;
      const d = demand.get(id)!;
      const plans = {} as Record<RequestType, Plan>;
      for (const type of TYPES) plans[type] = this.plan(node, type, m);

      const spec = catalogue.get(node.kind);
      const capacity = this.capacity(node);
      const alive = this.aliveFraction(node, m);
      let load = replicationLoad.get(id) ?? 0;
      for (const type of TYPES) {
        if (d[type] <= 0) continue;
        const unit = (spec.cost[type] ?? 0) + plans[type].extraCost;
        load += d[type] * alive * unit;
      }
      const util = node.kind === 'users' ? 0 : capacity > 0 ? load / capacity : load > 0 ? Infinity : 0;
      const accept = node.kind === 'users' ? 1 : alive * (util > 1 ? 1 / util : 1);
      calc.set(id, { plans, load, capacity, util, accept, demand: d });

      for (const type of TYPES) {
        const accepted = d[type] * accept;
        if (accepted <= 0) continue;
        const plan = plans[type];
        this.unroutable[type] += accepted * plan.unroutable * 60;
        for (const f of plan.forwards) {
          demand.get(f.to)![type] += accepted * f.frac;
          const eid = graph.edgeId.get(`${id}->${f.to}`)!;
          if (!edgeFlow.has(eid)) edgeFlow.set(eid, zeroFlow());
          edgeFlow.get(eid)![type] += accepted * f.frac;
        }
        if (isCompute(node.kind)) {
          if (type === 'static') this.staticOnServers += accepted * plan.terminal * 60;
          if (type === 'write' && plan.extraCost > 0) {
            this.state.get(id)!.localWrites += accepted * plan.terminal * 60;
          }
        }
      }
      // A primary database replays every write on its replicas.
      if (node.kind === 'rds') {
        for (const c of graph.children.get(id) ?? []) {
          if (c.kind === 'rds_replica') {
            replicationLoad.set(c.id, (replicationLoad.get(c.id) ?? 0) + d.write * accept * 0.5);
          }
        }
      }
    }

    // 3. Backward pass: success probability and latency distribution per node and type.
    const outcome = new Map<string, Record<RequestType, { succ: number; dist: Dist }>>();
    for (let i = graph.order.length - 1; i >= 0; i--) {
      const id = graph.order[i]!;
      const c = calc.get(id);
      if (!c) continue;
      const node = graph.nodes.get(id)!;
      const spec = catalogue.get(node.kind);
      const mult = loadMultiplier(c.util);
      const res = {} as Record<RequestType, { succ: number; dist: Dist }>;
      for (const type of TYPES) {
        const plan = c.plans[type];
        const local = ((spec.latencyMs[type] ?? 0) + plan.extraLatency) * mult;
        const parts: { weight: number; dist: Dist }[] = [];
        let succ = plan.terminal;
        if (plan.terminal > 0) parts.push({ weight: plan.terminal, dist: [{ p: 1, ms: local }] });
        for (const f of plan.forwards) {
          const child = outcome.get(f.to)?.[type];
          if (!child) continue;
          const hop = this.hopMs(node, graph.nodes.get(f.to)!);
          succ += f.frac * child.succ;
          parts.push({ weight: f.frac * child.succ, dist: shift(child.dist, local + hop) });
        }
        res[type] = { succ: c.accept * succ, dist: mix(parts) };
      }
      outcome.set(id, res);
    }

    // 4. Record metrics.
    const top = outcome.get(graph.usersId)!;
    let tickFailed = 0;
    const tickParts: { weight: number; dist: Dist }[] = [];
    for (const type of TYPES) {
      const req = users[type] * 60;
      const { succ, dist } = top[type];
      this.total += req;
      this.failed += req * (1 - succ);
      tickFailed += users[type] * (1 - succ);
      this.hist.addDist(dist, req * succ);
      this.histByType[type].addDist(dist, req * succ);
      tickParts.push({ weight: users[type] * succ, dist });
    }

    const nodes: Record<string, NodeTick> = {};
    for (const n of this.design.nodes) {
      const c = calc.get(n.id);
      const st = this.state.get(n.id);
      const spec = catalogue.get(n.kind);
      // Costs accrue for every node, connected or not.
      this.fixedCost.set(n.id, (this.fixedCost.get(n.id) ?? 0) + this.monthlyFixed(n));
      const incoming = c ? c.demand.static + c.demand.read + c.demand.write : 0;
      let variable = (spec.perMillionRequests * incoming * 60) / 1e6;
      if (c && isCompute(n.kind)) {
        variable += (SERVER_STATIC_EGRESS_PER_MILLION * c.demand.static * c.accept * 60) / 1e6;
      }
      this.varCost.set(n.id, (this.varCost.get(n.id) ?? 0) + variable);

      if (n.kind === 'users') {
        nodes[n.id] = { util: 0, rps: rps, status: 'ok' };
        continue;
      }
      const util = c ? (Number.isFinite(c.util) ? c.util : 10) : 0;
      if (!this.utilSeries.has(n.id)) this.utilSeries.set(n.id, []);
      this.utilSeries.get(n.id)!.push(util);
      const down = (n.kind === 'ec2' && st?.down) || (n.kind === 'asg' && st?.inService === 0);
      let status: NodeStatus = 'idle';
      if (down) status = 'down';
      else if (incoming > 0) status = util > 1 ? 'hot' : util >= 0.8 ? 'warm' : 'ok';
      nodes[n.id] = { util, rps: incoming, status };
      if (n.kind === 'asg' && st) {
        nodes[n.id]!.instances = st.inService;
        nodes[n.id]!.pending = st.pending.length;
      }
      this.trackOverload(n, util, m);
    }

    const edges: Record<string, EdgeTick> = {};
    for (const e of this.design.edges) {
      const f = edgeFlow.get(e.id);
      if (!f) {
        edges[e.id] = { rps: 0, type: 'read', failing: false };
        continue;
      }
      const type = TYPES.reduce((a, b) => (f[b] > f[a] ? b : a), 'static' as RequestType);
      const target = outcome.get(e.to)?.[type];
      edges[e.id] = { rps: f.static + f.read + f.write, type, failing: !!target && target.succ < 0.97 };
    }

    // 5. Autoscaling and recovery for the next minute.
    this.updateCompute(calc, m);

    this.minute++;
    return {
      minute: m,
      rps,
      failedRps: tickFailed,
      p95: percentileOfDist(mix(tickParts), 0.95),
      costPerMonth: this.projectedMonthlyCost(),
      availability: this.total > 0 ? 1 - this.failed / this.total : 1,
      nodes,
      edges,
    };
  }

  /** Runs to the end (or continues from the current minute) and scores the run. */
  run(onTick?: (snap: TickSnapshot) => void): SimResult {
    while (!this.done) {
      const snap = this.step();
      onTick?.(snap);
    }
    return this.result();
  }

  result(): SimResult {
    const metrics = this.metrics();
    return scoreRun({
      design: this.design,
      level: this.level,
      catalogue: this.catalogue,
      metrics,
      events: [...this.events].sort((a, b) => a.minute - b.minute),
      validation: this.validation,
      seed: this.seed,
    });
  }

  metrics(): Metrics {
    const ticks = Math.max(1, this.minute);
    const costBreakdown = this.design.nodes
      .filter((n) => n.kind !== 'users')
      .map((n) => ({
        nodeId: n.id,
        label: nodeLabel(n, this.catalogue),
        monthly:
          (this.fixedCost.get(n.id) ?? 0) / ticks +
          ((this.varCost.get(n.id) ?? 0) * MINUTES_PER_MONTH) / ticks,
      }))
      .sort((a, b) => b.monthly - a.monthly);
    const peakUtil: Record<string, number> = {};
    const p95Util: Record<string, number> = {};
    for (const [id, series] of this.utilSeries) {
      peakUtil[id] = series.reduce((a, b) => Math.max(a, b), 0);
      const sorted = [...series].sort((a, b) => a - b);
      p95Util[id] = sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0;
    }
    const p95ByType: Metrics['p95ByType'] = {};
    for (const type of TYPES) {
      if (this.histByType[type].total > 0) p95ByType[type] = this.histByType[type].percentile(0.95);
    }
    return {
      availability: this.total > 0 ? 1 - this.failed / this.total : 0,
      totalRequests: this.total,
      failedRequests: this.failed,
      p50: this.hist.percentile(0.5),
      p95: this.hist.percentile(0.95),
      p99: this.hist.percentile(0.99),
      p95ByType,
      monthlyCost: costBreakdown.reduce((s, c) => s + c.monthly, 0),
      costBreakdown,
      dataLoss: this.dataLoss,
      lostWrites: Math.round(this.lostWrites),
      unroutable: { ...this.unroutable },
      staticOnServers: this.staticOnServers,
      peakUtil,
      p95Util,
    };
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  private plan(node: DesignNode, type: RequestType, m: number): Plan {
    const plan: Plan = { terminal: 0, forwards: [], unroutable: 0, extraCost: 0, extraLatency: 0 };
    const children = this.graph.children.get(node.id) ?? [];
    const cfg = this.catalogue.configOf(node);
    const fail = () => ({ ...plan, unroutable: 1 });

    switch (node.kind) {
      case 'users':
      case 'cloudfront': {
        let pass = 1;
        if (node.kind === 'cloudfront' && type === 'static') {
          plan.terminal = cdnHitRatio(cfg.ttlSeconds);
          pass = 1 - plan.terminal;
        }
        const best = this.bestEntries(children, type);
        if (!best.length) return { ...plan, unroutable: pass };
        plan.forwards = best.map((c) => ({ to: c.id, frac: pass / best.length }));
        return plan;
      }
      case 'alb': {
        const targets = children
          .filter((c) => isCompute(c.kind))
          .map((c) => ({ c, w: this.routingWeight(c, cfg.healthChecks, m) }))
          .filter((x) => x.w > 0);
        const total = targets.reduce((s, x) => s + x.w, 0);
        if (total <= 0) return fail();
        plan.forwards = targets.map((x) => ({ to: x.c.id, frac: x.w / total }));
        return plan;
      }
      case 'ec2':
      case 'asg': {
        if (type === 'static') return { ...plan, terminal: 1 };
        const caches = children.filter((c) => c.kind === 'elasticache');
        const replicas = children.filter((c) => c.kind === 'rds_replica');
        const primaries = children.filter((c) => c.kind === 'rds');
        if (type === 'read') {
          if (caches.length) plan.forwards = this.split(caches);
          else if (replicas.length) plan.forwards = this.split(replicas, true);
          else if (primaries.length) plan.forwards = this.split(primaries);
        } else if (primaries.length) {
          plan.forwards = this.split(primaries);
        } else if (replicas.length || caches.length) {
          return fail(); // writes need the primary database
        }
        if (!plan.forwards.length) {
          // No database connected: the server keeps its own database on local disk.
          plan.terminal = 1;
          plan.extraCost = EMBEDDED_DB.cost[type];
          plan.extraLatency = EMBEDDED_DB.latencyMs[type];
        }
        return plan;
      }
      case 'elasticache': {
        if (type !== 'read') return fail();
        const warm = Math.min(1, m / CACHE_WARMUP_MINUTES);
        plan.terminal = cacheHitRatio(cfg.ttlSeconds) * warm;
        const miss = 1 - plan.terminal;
        const replicas = children.filter((c) => c.kind === 'rds_replica');
        const primaries = children.filter((c) => c.kind === 'rds');
        const targets = replicas.length ? this.split(replicas, true) : this.split(primaries);
        if (!targets.length) return { ...plan, unroutable: miss };
        plan.forwards = targets.map((f) => ({ to: f.to, frac: f.frac * miss }));
        return plan;
      }
      case 'rds':
        return type === 'static' ? fail() : { ...plan, terminal: 1 };
      case 'rds_replica':
        return type === 'read' ? { ...plan, terminal: 1 } : fail();
      case 's3':
        return type === 'static' ? { ...plan, terminal: 1 } : fail();
    }
  }

  private split(targets: DesignNode[], byCapacity = false): { to: string; frac: number }[] {
    const weights = targets.map((t) => (byCapacity ? this.catalogue.sizeOf(t).capacity : 1));
    const total = weights.reduce((s, w) => s + w, 0);
    return targets.map((t, i) => ({ to: t.id, frac: weights[i]! / total }));
  }

  /** How well a node suits a request type when picked by Users or CloudFront. */
  private static readonly ENTRY_SCORE: Record<'static' | 'dynamic', Partial<Record<ServiceKind, number>>> = {
    static: { cloudfront: 4, s3: 3, alb: 2, ec2: 1 },
    dynamic: { cloudfront: 4, alb: 3, ec2: 1 },
  };

  private bestEntries(children: DesignNode[], type: RequestType): DesignNode[] {
    const table = Simulation.ENTRY_SCORE[type === 'static' ? 'static' : 'dynamic'];
    let best: DesignNode[] = [];
    let bestScore = 0;
    for (const c of children) {
      const s = table[c.kind] ?? 0;
      if (s <= 0 || !this.canServe(c, type)) continue;
      if (s > bestScore) {
        bestScore = s;
        best = [c];
      } else if (s === bestScore) best.push(c);
    }
    return best;
  }

  /** Whether a node can (eventually) answer a request type, based on topology only. */
  private canServe(node: DesignNode, type: RequestType): boolean {
    const key = `${node.id}:${type}`;
    const memo = this.canServeMemo.get(key);
    if (memo !== undefined) return memo;
    const children = this.graph.children.get(node.id) ?? [];
    let ok = false;
    switch (node.kind) {
      case 'ec2':
      case 'asg':
        ok = true;
        break;
      case 's3':
        ok = type === 'static';
        break;
      case 'alb':
        ok = children.some((c) => isCompute(c.kind));
        break;
      case 'cloudfront':
        ok = children.some((c) => (type !== 'static' ? c.kind !== 's3' : true) && this.canServe(c, type));
        break;
      default:
        ok = false;
    }
    this.canServeMemo.set(key, ok);
    return ok;
  }

  /** ALB weight for a target: its capacity, including dead instances the ALB has not noticed yet. */
  private routingWeight(node: DesignNode, healthChecks: boolean, m: number): number {
    const st = this.state.get(node.id)!;
    const cap = this.catalogue.sizeOf(node).capacity;
    if (node.kind === 'ec2') {
      if (st.down && healthChecks && m > st.downSince) return 0;
      return cap;
    }
    const zombies = st.zombies.filter((z) => !healthChecks || z.since === m).length;
    return (st.inService + zombies) * cap;
  }

  /** Share of incoming requests that land on a live instance. */
  private aliveFraction(node: DesignNode, m: number): number {
    const st = this.state.get(node.id);
    if (!st) return 1;
    if (node.kind === 'ec2') return st.down ? 0 : 1;
    const anyNoHc = (this.graph.parents.get(node.id) ?? []).some(
      (p) => p.kind === 'alb' && !this.catalogue.configOf(p).healthChecks,
    );
    const zombies = st.zombies.filter((z) => anyNoHc || z.since === m).length;
    const total = st.inService + zombies;
    return total > 0 ? st.inService / total : 0;
  }

  private capacity(node: DesignNode): number {
    if (node.kind === 'users') return Infinity;
    const size = this.catalogue.sizeOf(node);
    const st = this.state.get(node.id);
    if (node.kind === 'ec2') return st!.down ? 0 : size.capacity;
    if (node.kind === 'asg') return st!.inService * size.capacity;
    return size.capacity;
  }

  private hopMs(from: DesignNode, to: DesignNode): number {
    const userLatency = this.level.traffic.userLatencyMs;
    if (from.kind === 'users') return to.kind === 'cloudfront' ? 8 : userLatency;
    if (from.kind === 'cloudfront') return userLatency * 0.6; // origin fetch over the AWS backbone
    return 1;
  }

  // -------------------------------------------------------------------------
  // Incidents, autoscaling and recovery
  // -------------------------------------------------------------------------

  private applyIncidents(m: number): void {
    for (const inc of this.level.incidents) {
      if (inc.atMinute !== m) continue;
      if (inc.type === 'traffic_spike') {
        this.events.push({
          minute: m,
          severity: 'warning',
          message: `${inc.title}: traffic heading to ${inc.multiplier}x.`,
        });
        continue;
      }
      // Instance crash: pick a running instance with the seeded RNG.
      const candidates: DesignNode[] = [];
      const weights: number[] = [];
      for (const n of this.design.nodes) {
        const st = this.state.get(n.id);
        if (!st || !this.graph.reachable.has(n.id)) continue;
        const w = n.kind === 'ec2' ? (st.down ? 0 : 1) : st.inService;
        if (w > 0) {
          candidates.push(n);
          weights.push(w);
        }
      }
      const idx = weightedPick(this.rng, weights);
      if (idx < 0) {
        this.events.push({
          minute: m,
          severity: 'info',
          message: `${inc.title}: no running instance to crash.`,
        });
        continue;
      }
      const target = candidates[idx]!;
      const st = this.state.get(target.id)!;
      const label = nodeLabel(target, this.catalogue);
      if (target.kind === 'ec2') {
        const alarms = this.catalogue.configOf(target).alarms;
        st.down = true;
        st.downSince = m;
        st.downUntil = m + (alarms ? EC2_RECOVERY_MINUTES.withAlarm : EC2_RECOVERY_MINUTES.withoutAlarm);
        this.events.push({
          minute: m,
          severity: 'critical',
          nodeId: target.id,
          message: `${inc.title}: ${label} crashed. ${alarms ? 'An alarm triggers recovery' : 'No alarm; recovery is slow'} (back at ${formatMinute(st.downUntil)}).`,
        });
        this.loseLocalData(target, st, st.localWrites, m);
      } else {
        const lost = st.localWrites / st.inService;
        st.inService -= 1;
        st.zombies.push({ since: m, until: m + ASG_DETECT_MINUTES });
        st.pending.push(m + ASG_DETECT_MINUTES + WARMUP_MINUTES);
        this.events.push({
          minute: m,
          severity: 'critical',
          nodeId: target.id,
          message: `${inc.title}: an instance in ${label} crashed. The group launches a replacement.`,
        });
        this.loseLocalData(target, st, lost, m);
      }
    }
  }

  private loseLocalData(node: DesignNode, st: ComputeState, lost: number, m: number): void {
    if (lost <= 0) return;
    st.localWrites -= lost;
    this.dataLoss = true;
    this.lostWrites += lost;
    this.events.push({
      minute: m,
      severity: 'critical',
      nodeId: node.id,
      message: `DATA LOSS: about ${Math.round(lost).toLocaleString('en-US')} orders lived on ${nodeLabel(node, this.catalogue)}'s disk and are gone.`,
    });
  }

  private updateCompute(calc: Map<string, NodeCalc>, m: number): void {
    const next = m + 1;
    for (const n of this.design.nodes) {
      const st = this.state.get(n.id);
      if (!st) continue;
      const label = nodeLabel(n, this.catalogue);
      if (n.kind === 'ec2') {
        if (st.down && next >= st.downUntil) {
          st.down = false;
          this.events.push({ minute: next, severity: 'good', nodeId: n.id, message: `${label} recovered.` });
        }
        continue;
      }
      // Auto Scaling Group
      const cfg = this.catalogue.configOf(n);
      const ready = st.pending.filter((r) => r <= next).length;
      if (ready) {
        st.pending = st.pending.filter((r) => r > next);
        st.inService += ready;
        this.events.push({
          minute: next,
          severity: 'good',
          nodeId: n.id,
          message: `${label}: ${ready} instance${ready > 1 ? 's' : ''} in service (now ${st.inService}).`,
        });
      }
      st.zombies = st.zombies.filter((z) => z.until > next);

      const c = calc.get(n.id);
      const cap = this.catalogue.sizeOf(n).capacity;
      const load = c?.load ?? 0;
      let desired = Math.ceil(load / (cap * cfg.targetUtilization) - 1e-9);
      desired = Math.max(cfg.min, Math.min(cfg.max, desired));
      const total = st.inService + st.pending.length;
      if (desired > total) {
        const launch = desired - total;
        for (let i = 0; i < launch; i++) st.pending.push(next + WARMUP_MINUTES);
        st.lowTicks = 0;
        this.events.push({
          minute: next,
          severity: 'info',
          nodeId: n.id,
          message: `${label}: scaling out, launching ${launch} instance${launch > 1 ? 's' : ''}.`,
        });
      } else if (desired < st.inService && st.pending.length === 0) {
        st.lowTicks += 1;
        if (st.lowTicks >= SCALE_IN_COOLDOWN) {
          st.inService -= 1;
          st.lowTicks = 0;
        }
      } else {
        st.lowTicks = 0;
      }
    }
  }

  private trackOverload(n: DesignNode, util: number, m: number): void {
    const label = nodeLabel(n, this.catalogue);
    if (util > 1 && !this.overloaded.has(n.id)) {
      this.overloaded.add(n.id);
      this.events.push({
        minute: m,
        severity: 'warning',
        nodeId: n.id,
        message: `${label} is overloaded (${Math.round(util * 100)}% load); requests are being dropped.`,
      });
    } else if (util < 0.9 && this.overloaded.has(n.id)) {
      this.overloaded.delete(n.id);
      this.events.push({
        minute: m,
        severity: 'good',
        nodeId: n.id,
        message: `${label} is back under capacity.`,
      });
    }
  }

  private monthlyFixed(n: DesignNode): number {
    const size = this.catalogue.sizeOf(n);
    const addons = this.catalogue.addonCost(n);
    if (n.kind === 'users') return 0;
    if (n.kind === 'asg') {
      const st = this.state.get(n.id)!;
      return (st.inService + st.pending.length + st.zombies.length) * size.monthlyCost + addons;
    }
    return size.monthlyCost + addons;
  }

  private projectedMonthlyCost(): number {
    const ticks = Math.max(1, this.minute + 1);
    let total = 0;
    for (const n of this.design.nodes) {
      total += (this.fixedCost.get(n.id) ?? 0) / ticks;
      total += ((this.varCost.get(n.id) ?? 0) * MINUTES_PER_MONTH) / ticks;
    }
    return total;
  }
}

/** Runs a full simulated day and returns the scored result. */
export function simulate(
  design: Design,
  level: Level,
  catalogue: Catalogue,
  options: SimulationOptions = {},
): SimResult {
  return new Simulation(design, level, catalogue, options).run();
}
