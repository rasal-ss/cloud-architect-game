import type { Design, DesignNode, Level, RequestType, ServiceKind } from '@cloud-architect/content';
import {
  ASG_DETECT_MINUTES,
  CACHE_WARMUP_MINUTES,
  CONNECTIONS_PER_INSTANCE,
  type Catalogue,
  DB_RECOVERY_MINUTES,
  DYNAMO_ON_DEMAND,
  EC2_RECOVERY_MINUTES,
  EMBEDDED_DB,
  FIFO_LIMIT,
  HOT_KEY_SHARE,
  LAMBDA_GB_SECOND,
  LAMBDA_GB_SECONDS_PER_UNIT,
  MAX_RECEIVES,
  PARTITION_LIMIT,
  PITR,
  PROXY_CONNECTIONS,
  SCALE_IN_COOLDOWN,
  SERVER_STATIC_EGRESS_PER_MILLION,
  VIRAL_COUPON_SHARE,
  WARMUP_MINUTES,
  cacheHitRatio,
  cdnHitRatio,
  isAsync,
  isCompute,
  isRelational,
  isWorker,
  nodeLabel,
} from './catalog';
import { type Graph, buildGraph, validateDesign } from './graph';
import { type Dist, Histogram, convolve, loadMultiplier, mix, percentileOfDist, shift } from './latency';
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

interface Route {
  to: string;
  frac: number;
}

/** How a node handles one request type: answer it here, pass it to children, or fail it. */
interface Plan {
  /** Fraction answered at this node. */
  terminal: number;
  /** First hop: each request goes to one of these children. */
  forwards: Route[];
  /**
   * Further calls every request makes in order, e.g. charge the card, then save the order, then
   * publish an event. Each step picks one child; all steps must succeed.
   */
  then: Route[][];
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
  /** Requests per second last minute (to size session losses). */
  lastRps: number;
}

interface QueueState {
  backlog: number;
  poison: number;
  deadLettered: number;
  /** Minutes the oldest waiting message has been queued (approximate). */
  delay: number;
}

interface NodeCalc {
  plans: Record<RequestType, Plan>;
  load: number;
  capacity: number;
  util: number;
  accept: number;
  demand: Flow;
  /** Lambda: concurrent executions in use. */
  concurrency?: number;
  /** SQS: messages handed to consumers this minute, and poison receives. */
  drain?: number;
  poisonRps?: number;
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
  private readonly dbDownUntil = new Map<string, number>();
  private readonly dbWrites = new Map<string, number[]>();
  private readonly lambdaWarm = new Map<string, number>();
  private readonly queues = new Map<string, QueueState>();
  private readonly busRetry = new Map<string, number>();
  private readonly cacheWarmStart = new Map<string, number>();
  private readonly canServeMemo = new Map<string, boolean>();
  private readonly events: SimEvent[] = [];
  private readonly overloaded = new Set<string>();
  private readonly connWarned = new Set<string>();
  private azDown: { az: string; until: number } | null = null;
  private paymentDownUntil = -1;
  private hotKeyUntil = -1;
  private poison: { until: number; fraction: number } | null = null;

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
  private readonly connectionPeak: Record<string, number> = {};
  private readonly unroutable = zeroFlow();
  private staticOnServers = 0;
  private dataLoss = false;
  private lostWrites = 0;
  private rpoMinutes = 0;
  private stalenessSec = 0;
  private lostMessages = 0;
  private ordersPlaced = 0;
  private ordersCharged = 0;
  private sessionsLost = 0;
  private coldInvocations = 0;
  private invocations = 0;
  private throttled = 0;
  private queuePeak = 0;
  private queueMaxDelay = 0;

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
      if (n.kind === 'sqs') this.queues.set(n.id, { backlog: 0, poison: 0, deadLettered: 0, delay: 0 });
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
        lastRps: 0,
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
    this.ordersPlaced += users.write * 60;

    // 2. Forward pass: push demand down the graph in topological order.
    const calc = new Map<string, NodeCalc>();
    const replicationLoad = new Map<string, number>();
    const connectionsOut = new Map<string, number>();
    const edgeFlow = new Map<string, Flow>();
    const addFlow = (from: string, to: string, type: RequestType, amount: number) => {
      if (amount <= 0) return;
      demand.get(to)![type] += amount;
      const eid = graph.edgeId.get(`${from}->${to}`)!;
      if (!edgeFlow.has(eid)) edgeFlow.set(eid, zeroFlow());
      edgeFlow.get(eid)![type] += amount;
    };

    for (const id of graph.order) {
      if (!graph.reachable.has(id)) continue;
      const node = graph.nodes.get(id)!;
      const d = demand.get(id)!;
      const plans = {} as Record<RequestType, Plan>;
      for (const type of TYPES) plans[type] = this.plan(node, type, m);

      const spec = catalogue.get(node.kind);
      const capacity = this.capacity(node, m);
      const alive = this.aliveFraction(node, m);
      let load = replicationLoad.get(id) ?? 0;
      for (const type of TYPES) {
        if (d[type] <= 0) continue;
        const unit = (spec.cost[type] ?? 0) + plans[type].extraCost;
        load += d[type] * alive * unit;
      }
      const util = node.kind === 'users' ? 0 : capacity > 0 ? load / capacity : load > 0 ? Infinity : 0;
      let accept = node.kind === 'users' ? 1 : alive * (util > 1 ? 1 / util : 1);
      if (node.kind === 'dynamodb' && util > 1) this.throttled += (d.read + d.write) * (1 - 1 / util) * 60;

      // Relational databases refuse connections above their limit.
      if (isRelational(node.kind) && load > 0) {
        const limit = catalogue.sizeOf(node).maxConnections ?? Infinity;
        const conns = (graph.parents.get(id) ?? []).reduce((s, p) => s + (connectionsOut.get(p.id) ?? 0), 0);
        const ratio = conns / limit;
        this.connectionPeak[id] = Math.max(this.connectionPeak[id] ?? 0, ratio);
        if (ratio > 1) {
          accept *= 1 / ratio;
          if (!this.connWarned.has(id)) {
            this.connWarned.add(id);
            this.events.push({
              minute: m,
              severity: 'critical',
              nodeId: id,
              message: `${nodeLabel(node, catalogue)} ran out of connections (${Math.round(conns)} of ${limit}). New requests are refused.`,
            });
          }
        }
      }

      const nc: NodeCalc = { plans, load, capacity, util, accept, demand: d };
      calc.set(id, nc);

      // Connections this node holds open to the databases it talks to.
      if (node.kind === 'lambda') {
        const perExec = catalogue.sizeOf(node).capacity;
        nc.concurrency = Math.min(load, capacity) / perExec;
        connectionsOut.set(id, nc.concurrency);
      } else if (node.kind === 'ec2') {
        connectionsOut.set(id, this.state.get(id)!.down ? 0 : CONNECTIONS_PER_INSTANCE);
      } else if (node.kind === 'asg') {
        connectionsOut.set(id, this.state.get(id)!.inService * CONNECTIONS_PER_INSTANCE);
      } else if (node.kind === 'rds_proxy') {
        connectionsOut.set(id, load > 0 ? PROXY_CONNECTIONS : 0);
      } else if (node.kind === 'elasticache') {
        connectionsOut.set(id, CONNECTIONS_PER_INSTANCE);
      }

      for (const type of TYPES) {
        const accepted = d[type] * accept;
        if (accepted <= 0) continue;
        const plan = plans[type];
        this.unroutable[type] += accepted * plan.unroutable * 60;
        for (const f of plan.forwards) addFlow(id, f.to, type, accepted * f.frac);
        const routed = accepted * (1 - plan.unroutable);
        for (const stepRoutes of plan.then)
          for (const r of stepRoutes) addFlow(id, r.to, type, routed * r.frac);
        if (isCompute(node.kind)) {
          if (type === 'static') this.staticOnServers += accepted * plan.terminal * 60;
          if (type === 'write' && plan.extraCost > 0) {
            this.state.get(id)!.localWrites += accepted * plan.terminal * 60;
          }
        }
        if (node.kind === 'payment' && type === 'write') this.ordersCharged += accepted * 60;
      }
      if (isCompute(node.kind)) this.state.get(id)!.lastRps = d.static + d.read + d.write;
      if (node.kind === 'rds') this.recordDbWrites(id, d.write * accept * 60);

      // A primary database replays every write on its replicas.
      if (node.kind === 'rds') {
        for (const c of graph.children.get(id) ?? []) {
          if (c.kind === 'rds_replica') {
            replicationLoad.set(c.id, (replicationLoad.get(c.id) ?? 0) + d.write * accept * 0.5);
          }
        }
      }

      // Asynchronous hand-offs: deliver messages to consumers outside the customer's request.
      if (isAsync(node.kind)) this.dispatchAsync(node, nc, m, addFlow);
    }

    // 3. Backward pass: success probability and latency distribution per node and type.
    const outcome = new Map<string, Record<RequestType, { succ: number; dist: Dist }>>();
    for (let i = graph.order.length - 1; i >= 0; i--) {
      const id = graph.order[i]!;
      const c = calc.get(id);
      if (!c) continue;
      const node = graph.nodes.get(id)!;
      const mult = loadMultiplier(c.util);
      const res = {} as Record<RequestType, { succ: number; dist: Dist }>;
      const coldShare = this.coldShare(node, c);
      for (const type of TYPES) {
        const plan = c.plans[type];
        const local = (this.baseLatency(node, type) + plan.extraLatency) * mult;
        const localDist: Dist =
          coldShare > 0
            ? [
                { p: 1 - coldShare, ms: local },
                { p: coldShare, ms: local + this.coldStartMs(node) },
              ]
            : [{ p: 1, ms: local }];
        const parts: { weight: number; dist: Dist }[] = [];
        let succ = plan.terminal;
        if (plan.terminal > 0) parts.push({ weight: plan.terminal, dist: localDist });
        for (const f of plan.forwards) {
          const child = outcome.get(f.to)?.[type];
          if (!child) continue;
          const hop = this.hopMs(node, graph.nodes.get(f.to)!);
          succ += f.frac * child.succ;
          parts.push({ weight: f.frac * child.succ, dist: convolve(localDist, shift(child.dist, hop)) });
        }
        let dist = mix(parts);
        for (const stepRoutes of plan.then) {
          const stepParts: { weight: number; dist: Dist }[] = [];
          let stepSucc = 0;
          for (const r of stepRoutes) {
            const child = outcome.get(r.to)?.[type];
            if (!child) continue;
            stepSucc += r.frac * child.succ;
            stepParts.push({
              weight: r.frac * child.succ,
              dist: shift(child.dist, this.hopMs(node, graph.nodes.get(r.to)!)),
            });
          }
          succ *= stepSucc;
          if (stepSucc > 0) dist = convolve(dist, mix(stepParts));
        }
        res[type] = { succ: c.accept * succ, dist };
      }
      outcome.set(id, res);
    }

    // 4. Asynchronous results: processed, retried, dead-lettered or lost.
    this.settleAsync(calc, outcome, m);

    // 5. Record metrics.
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
    this.trackStaleness(calc);

    const nodes: Record<string, NodeTick> = {};
    for (const n of this.design.nodes) {
      const c = calc.get(n.id);
      const st = this.state.get(n.id);
      // Costs accrue for every node, connected or not.
      this.fixedCost.set(n.id, (this.fixedCost.get(n.id) ?? 0) + this.monthlyFixed(n));
      this.varCost.set(n.id, (this.varCost.get(n.id) ?? 0) + this.variableCost(n, c));
      const incoming = c ? c.demand.static + c.demand.read + c.demand.write : 0;

      if (n.kind === 'users') {
        nodes[n.id] = { util: 0, rps: rps, status: 'ok' };
        continue;
      }
      const util = c ? (Number.isFinite(c.util) ? c.util : 10) : 0;
      if (!this.utilSeries.has(n.id)) this.utilSeries.set(n.id, []);
      this.utilSeries.get(n.id)!.push(util);
      const down =
        (n.kind === 'ec2' && st?.down) ||
        (n.kind === 'asg' && st?.inService === 0 && (st.pending.length > 0 || st.zombies.length > 0)) ||
        (isRelational(n.kind) && (this.dbDownUntil.get(n.id) ?? -1) > m) ||
        (n.kind === 'payment' && this.paymentDownUntil > m);
      let status: NodeStatus = 'idle';
      if (down) status = 'down';
      else if (incoming > 0) status = util > 1 ? 'hot' : util >= 0.8 ? 'warm' : 'ok';
      nodes[n.id] = { util, rps: incoming, status };
      if (n.kind === 'asg' && st) {
        nodes[n.id]!.instances = st.inService;
        nodes[n.id]!.pending = st.pending.length;
      }
      if (n.kind === 'sqs') nodes[n.id]!.backlog = this.queues.get(n.id)!.backlog;
      if (n.kind === 'lambda' && c?.concurrency !== undefined) nodes[n.id]!.concurrency = c.concurrency;
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

    // 6. Autoscaling, warm Lambda environments and recovery for the next minute.
    this.updateCompute(calc, m);
    for (const [id, c] of calc) {
      if (c.concurrency === undefined) continue;
      this.lambdaWarm.set(id, Math.max(c.concurrency, (this.lambdaWarm.get(id) ?? 0) * 0.85));
    }

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
    const qs = [...this.queues.values()];
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
      stalenessSec: this.stalenessSec,
      rpoMinutes: this.rpoMinutes,
      queue: {
        peakBacklog: Math.round(this.queuePeak),
        endBacklog: Math.round(qs.reduce((s, q) => s + q.backlog, 0)),
        maxDelayMin: this.queueMaxDelay,
        deadLettered: Math.round(qs.reduce((s, q) => s + q.deadLettered, 0)),
        poisonLeft: Math.round(qs.reduce((s, q) => s + q.poison, 0)),
      },
      lostMessages: Math.round(this.lostMessages),
      ordersPlaced: Math.round(this.ordersPlaced),
      ordersCharged: Math.round(Math.min(this.ordersCharged, this.ordersPlaced)),
      sessionsLost: Math.round(this.sessionsLost),
      connectionPeak: { ...this.connectionPeak },
      coldStartShare: this.invocations > 0 ? this.coldInvocations / this.invocations : 0,
      throttled: Math.round(this.throttled),
    };
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  private plan(node: DesignNode, type: RequestType, m: number): Plan {
    const plan: Plan = { terminal: 0, forwards: [], then: [], unroutable: 0, extraCost: 0, extraLatency: 0 };
    const children = this.graph.children.get(node.id) ?? [];
    const cfg = this.catalogue.configOf(node);
    const fail = () => ({ ...plan, unroutable: 1 });
    const of = (...kinds: ServiceKind[]) => children.filter((c) => kinds.includes(c.kind));

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
      case 'api_gateway': {
        if (type === 'static') return fail();
        const fns = of('lambda', 'alb');
        if (fns.length) plan.forwards = this.split(fns);
        else if (type === 'write' && of('sqs').length) plan.forwards = this.split(of('sqs'));
        else return fail();
        return plan;
      }
      case 'ec2':
      case 'asg':
      case 'lambda': {
        if (type === 'static') return { ...plan, terminal: 1 };
        const caches = of('elasticache');
        const replicas = of('rds_replica');
        const primaries = of('rds', 'rds_proxy');
        const dynamo = of('dynamodb');
        if (type === 'read') {
          if (caches.length) plan.forwards = this.split(caches);
          else if (replicas.length) plan.forwards = this.split(replicas, true);
          else if (primaries.length) plan.forwards = this.split(primaries);
          else if (dynamo.length) plan.forwards = this.split(dynamo);
          else if (node.kind === 'lambda') return fail();
          if (!plan.forwards.length) this.embed(plan, type);
          return plan;
        }
        // Writes: charge the card, save the order, then hand off to queues and topics.
        const payment = of('payment');
        const db = primaries.length ? primaries : dynamo;
        const handoffs = children.filter((c) => isAsync(c.kind));
        const steps: Route[][] = [];
        if (payment.length) steps.push(this.split(payment));
        if (db.length) steps.push(this.split(db));
        for (const h of handoffs) steps.push([{ to: h.id, frac: 1 }]);
        if (!db.length && !handoffs.length) {
          if (node.kind === 'lambda' || replicas.length || caches.length) return fail(); // nowhere to save it
          this.embed(plan, type);
          plan.then = steps;
          return plan;
        }
        plan.forwards = steps[0]!;
        plan.then = steps.slice(1);
        return plan;
      }
      case 'elasticache': {
        if (type !== 'read') return fail();
        const warm = Math.min(1, (m - (this.cacheWarmStart.get(node.id) ?? 0)) / CACHE_WARMUP_MINUTES);
        plan.terminal = cacheHitRatio(cfg.ttlSeconds) * warm;
        const miss = 1 - plan.terminal;
        const replicas = of('rds_replica');
        const primaries = of('rds', 'rds_proxy');
        const targets = replicas.length
          ? this.split(replicas, true)
          : primaries.length
            ? this.split(primaries)
            : this.split(of('dynamodb'));
        if (!targets.length) return { ...plan, unroutable: miss };
        plan.forwards = targets.map((f) => ({ to: f.to, frac: f.frac * miss }));
        return plan;
      }
      case 'rds_proxy': {
        if (type === 'static') return fail();
        const dbs = of('rds');
        if (!dbs.length) return fail();
        plan.forwards = this.split(dbs);
        return plan;
      }
      case 'rds':
      case 'dynamodb':
        return type === 'static' ? fail() : { ...plan, terminal: 1 };
      case 'rds_replica':
        return type === 'read' ? { ...plan, terminal: 1 } : fail();
      case 's3':
        return type === 'static' ? { ...plan, terminal: 1 } : fail();
      case 'payment':
        return type === 'write' ? { ...plan, terminal: 1 } : fail();
      case 'sqs':
      case 'sns':
      case 'eventbridge':
        // The sender is done once the message is stored; delivery happens asynchronously.
        return type === 'write' ? { ...plan, terminal: 1 } : fail();
    }
  }

  /** No database connected: the server keeps its own database on local disk. */
  private embed(plan: Plan, type: RequestType): void {
    if (type === 'static') return;
    plan.terminal = 1;
    plan.extraCost = EMBEDDED_DB.cost[type];
    plan.extraLatency = EMBEDDED_DB.latencyMs[type];
  }

  private split(targets: DesignNode[], byCapacity = false): Route[] {
    const weights = targets.map((t) => (byCapacity ? this.catalogue.sizeOf(t).capacity : 1));
    const total = weights.reduce((s, w) => s + w, 0);
    return targets.map((t, i) => ({ to: t.id, frac: weights[i]! / total }));
  }

  /** How well a node suits a request type when picked by Users or CloudFront. */
  private static readonly ENTRY_SCORE: Record<'static' | 'dynamic', Partial<Record<ServiceKind, number>>> = {
    static: { cloudfront: 4, s3: 3, alb: 2, ec2: 1 },
    dynamic: { cloudfront: 4, alb: 3, api_gateway: 3, ec2: 1 },
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
      case 'lambda':
        ok = true;
        break;
      case 's3':
        ok = type === 'static';
        break;
      case 'alb':
        ok = children.some((c) => isCompute(c.kind));
        break;
      case 'api_gateway':
        ok =
          type !== 'static' &&
          children.some(
            (c) => c.kind === 'lambda' || c.kind === 'alb' || (type === 'write' && c.kind === 'sqs'),
          );
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

  private capacity(node: DesignNode, m: number): number {
    if (node.kind === 'users') return Infinity;
    const size = this.catalogue.sizeOf(node);
    const cfg = this.catalogue.configOf(node);
    const st = this.state.get(node.id);
    switch (node.kind) {
      case 'ec2':
        return st!.down ? 0 : size.capacity;
      case 'asg':
        return st!.inService * size.capacity;
      case 'lambda':
        return size.capacity * cfg.concurrency;
      case 'rds':
      case 'rds_replica':
        return (this.dbDownUntil.get(node.id) ?? -1) > m ? 0 : size.capacity;
      case 'payment':
        return this.paymentDownUntil > m ? 0 : size.capacity;
      case 'sqs':
        return cfg.fifo ? FIFO_LIMIT : size.capacity;
      case 'dynamodb': {
        const base = cfg.capacityMode === 'provisioned' ? cfg.provisionedUnits : size.capacity;
        return Math.min(base, PARTITION_LIMIT / this.hotShare(cfg.partitionKey, m));
      }
      default:
        return size.capacity;
    }
  }

  private hotShare(key: keyof typeof HOT_KEY_SHARE, m: number): number {
    const viral = this.hotKeyUntil > m;
    if (key === 'coupon-code') return viral ? VIRAL_COUPON_SHARE : HOT_KEY_SHARE[key];
    if (key === 'coupon-code-sharded') return viral ? VIRAL_COUPON_SHARE / 10 : HOT_KEY_SHARE[key];
    return HOT_KEY_SHARE[key];
  }

  private baseLatency(node: DesignNode, type: RequestType): number {
    const base = this.catalogue.get(node.kind).latencyMs[type] ?? 0;
    if (node.kind !== 'lambda') return base;
    const mem = this.catalogue.sizeOf(node).memoryMb ?? 512;
    return base * Math.sqrt(512 / mem); // more memory also means more CPU
  }

  private coldStartMs(node: DesignNode): number {
    const mem = this.catalogue.sizeOf(node).memoryMb ?? 512;
    return mem <= 128 ? 700 : mem <= 512 ? 400 : mem <= 1024 ? 300 : 250;
  }

  /** Share of Lambda invocations this minute that need a fresh (cold) execution environment. */
  private coldShare(node: DesignNode, c: NodeCalc): number {
    if (node.kind !== 'lambda' || !c.concurrency) return 0;
    const warm = this.lambdaWarm.get(node.id) ?? 0;
    const share = Math.max(0, c.concurrency - warm) / c.concurrency;
    const invocations = c.demand.static + c.demand.read + c.demand.write;
    this.invocations += invocations * 60;
    this.coldInvocations += invocations * 60 * share;
    return share;
  }

  private hopMs(from: DesignNode, to: DesignNode): number {
    const userLatency = this.level.traffic.userLatencyMs;
    if (from.kind === 'users') return to.kind === 'cloudfront' ? 8 : userLatency;
    if (from.kind === 'cloudfront') return userLatency * 0.6; // origin fetch over the AWS backbone
    if (to.kind === 'payment') return 20; // over the internet to a third party
    return 1;
  }

  // -------------------------------------------------------------------------
  // Asynchronous messaging
  // -------------------------------------------------------------------------

  private dispatchAsync(
    node: DesignNode,
    nc: NodeCalc,
    m: number,
    addFlow: (from: string, to: string, type: RequestType, amount: number) => void,
  ): void {
    const consumers = this.graph.children.get(node.id) ?? [];
    const arrivals = nc.demand.write * nc.accept; // messages per second
    if (node.kind === 'sns') {
      for (const c of consumers) addFlow(node.id, c.id, 'write', arrivals);
      return;
    }
    if (node.kind === 'eventbridge') {
      const out = arrivals + (this.busRetry.get(node.id) ?? 0);
      for (const c of consumers) addFlow(node.id, c.id, 'write', out);
      return;
    }
    // SQS: consumers pull what they can handle; the rest waits in the queue.
    const q = this.queues.get(node.id)!;
    const poisonNow = this.poison && this.poison.until > m ? this.poison.fraction : 0;
    q.poison += arrivals * 60 * poisonNow;
    q.backlog += arrivals * 60 * (1 - poisonNow);
    const workers = consumers.filter((c) => isWorker(c.kind));
    const drainCapacity = workers.reduce((s, c) => {
      const unit = this.catalogue.get(c.kind).cost.write ?? 1;
      return s + this.capacity(c, m) / unit;
    }, 0);
    const poisonRps = (q.poison * 2) / 60; // each poison message is received about twice a minute
    const drain = Math.min(q.backlog / 60, Math.max(0, drainCapacity * 0.9 - poisonRps));
    nc.drain = drain;
    nc.poisonRps = poisonRps;
    for (const r of this.split(workers, true)) addFlow(node.id, r.to, 'write', (drain + poisonRps) * r.frac);
  }

  private settleAsync(
    calc: Map<string, NodeCalc>,
    outcome: Map<string, Record<RequestType, { succ: number; dist: Dist }>>,
    _m: number,
  ): void {
    for (const [id, c] of calc) {
      const node = this.graph.nodes.get(id)!;
      if (!isAsync(node.kind)) continue;
      const consumers = this.graph.children.get(id) ?? [];
      const succOf = (cid: string) => outcome.get(cid)?.write.succ ?? 0;
      if (node.kind === 'sqs') {
        const q = this.queues.get(id)!;
        const workers = consumers.filter((x) => isWorker(x.kind));
        const routes = this.split(workers, true);
        const ok = routes.reduce((s, r) => s + r.frac * succOf(r.to), 0);
        q.backlog = Math.max(0, q.backlog - (c.drain ?? 0) * 60 * ok);
        if (this.catalogue.configOf(node).dlq && q.poison > 0) {
          const moved = q.poison * Math.min(1, 2 / MAX_RECEIVES);
          q.poison -= moved;
          q.deadLettered += moved;
        }
        this.queuePeak = Math.max(this.queuePeak, q.backlog + q.poison);
        const drainPerMin = (c.drain ?? 0) * 60 * ok;
        q.delay = q.backlog < 1 ? 0 : drainPerMin > 0 ? q.backlog / drainPerMin : q.delay + 1;
        this.queueMaxDelay = Math.max(this.queueMaxDelay, Math.min(q.delay, MINUTES_PER_DAY));
        continue;
      }
      const sent =
        c.demand.write * c.accept + (node.kind === 'eventbridge' ? (this.busRetry.get(id) ?? 0) : 0);
      let failedRetryable = 0;
      for (const child of consumers) {
        const missed = sent * (1 - succOf(child.id));
        if (missed <= 0) continue;
        if (node.kind === 'eventbridge') failedRetryable = Math.max(failedRetryable, missed);
        else this.lostMessages += missed * 60; // SNS gives up after a few quick retries
      }
      // EventBridge retries failed deliveries for up to 24 hours.
      if (node.kind === 'eventbridge') this.busRetry.set(id, failedRetryable);
    }
  }

  // -------------------------------------------------------------------------
  // Incidents, autoscaling and recovery
  // -------------------------------------------------------------------------

  private applyIncidents(m: number): void {
    for (const inc of this.level.incidents) {
      if (inc.atMinute !== m) continue;
      switch (inc.type) {
        case 'traffic_spike':
          this.events.push({
            minute: m,
            severity: 'warning',
            message: `${inc.title}: traffic heading to ${inc.multiplier}x.`,
          });
          break;
        case 'instance_crash':
          this.crashInstance(inc.title, m);
          break;
        case 'az_outage':
          this.azOutage(inc.title, inc.az, inc.durationMinutes, m);
          break;
        case 'db_failover': {
          const db = this.primaryDb();
          if (!db) break;
          const multi = this.catalogue.configOf(db).multiAz;
          const minutes = multi ? DB_RECOVERY_MINUTES.multiAz : DB_RECOVERY_MINUTES.singleAz;
          this.dbDownUntil.set(db.id, m + minutes);
          this.events.push({
            minute: m,
            severity: 'critical',
            nodeId: db.id,
            message: multi
              ? `${inc.title}: ${nodeLabel(db, this.catalogue)} failed. Multi-AZ promotes the standby within a minute.`
              : `${inc.title}: ${nodeLabel(db, this.catalogue)} failed. With no standby, recovery takes ${minutes} minutes.`,
          });
          break;
        }
        case 'dependency_outage':
          this.paymentDownUntil = m + inc.durationMinutes;
          this.events.push({
            minute: m,
            severity: 'critical',
            message: `${inc.title}: the payment provider is not responding for ${inc.durationMinutes} minutes.`,
          });
          break;
        case 'cache_flush':
          for (const n of this.design.nodes) if (n.kind === 'elasticache') this.cacheWarmStart.set(n.id, m);
          this.events.push({
            minute: m,
            severity: 'warning',
            message: `${inc.title}: every cache is empty. Reads fall through to the database until it warms up.`,
          });
          break;
        case 'hot_key':
          this.hotKeyUntil = m + inc.durationMinutes;
          this.events.push({
            minute: m,
            severity: 'warning',
            message: `${inc.title}: one coupon code is getting most of the orders.`,
          });
          break;
        case 'poison_messages':
          this.poison = { until: m + inc.durationMinutes, fraction: inc.fraction };
          this.events.push({
            minute: m,
            severity: 'warning',
            message: `${inc.title}: some messages are malformed and fail every time.`,
          });
          break;
        case 'data_corruption':
          this.corruptData(inc.title, m);
          break;
      }
    }
    if (this.hotKeyUntil === m)
      this.events.push({ minute: m, severity: 'good', message: 'The viral coupon has cooled down.' });
  }

  private primaryDb(): DesignNode | undefined {
    return this.design.nodes.find((n) => n.kind === 'rds' && this.graph.reachable.has(n.id));
  }

  private crashInstance(title: string, m: number): void {
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
      this.events.push({ minute: m, severity: 'info', message: `${title}: no running instance to crash.` });
      return;
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
        message: `${title}: ${label} crashed. ${alarms ? 'An alarm triggers recovery' : 'No alarm; recovery is slow'} (back at ${formatMinute(st.downUntil)}).`,
      });
      this.loseLocalData(target, st, st.localWrites, m);
      this.loseSessions(target, 1, m);
    } else {
      const share = 1 / st.inService;
      const lost = st.localWrites * share;
      st.inService -= 1;
      st.zombies.push({ since: m, until: m + ASG_DETECT_MINUTES });
      st.pending.push(m + ASG_DETECT_MINUTES + WARMUP_MINUTES);
      this.events.push({
        minute: m,
        severity: 'critical',
        nodeId: target.id,
        message: `${title}: an instance in ${label} crashed. The group launches a replacement.`,
      });
      this.loseLocalData(target, st, lost, m);
      this.loseSessions(target, share, m);
    }
  }

  private azOutage(title: string, az: string, duration: number, m: number): void {
    const until = m + duration;
    this.azDown = { az, until };
    this.events.push({
      minute: m,
      severity: 'critical',
      message: `${title}: Availability Zone ${az.toUpperCase()} is offline for ${duration} minutes.`,
    });
    for (const n of this.design.nodes) {
      if (!this.graph.reachable.has(n.id)) continue;
      const cfg = this.catalogue.configOf(n);
      const label = nodeLabel(n, this.catalogue);
      if (n.kind === 'ec2' && cfg.az === az) {
        const st = this.state.get(n.id)!;
        st.down = true;
        st.downSince = m;
        st.downUntil = until;
        this.loseLocalData(n, st, st.localWrites, m);
        this.loseSessions(n, 1, m);
      } else if (n.kind === 'asg') {
        const st = this.state.get(n.id)!;
        const inZone = cfg.azs === 2 ? Math.ceil(st.inService / 2) : az === 'a' ? st.inService : 0;
        if (!inZone) continue;
        const share = inZone / Math.max(1, st.inService);
        st.inService -= inZone;
        for (let i = 0; i < inZone; i++) {
          st.zombies.push({ since: m, until: m + ASG_DETECT_MINUTES });
          // With a second AZ the group relaunches there; with one AZ it waits for the zone.
          st.pending.push(cfg.azs === 2 ? m + ASG_DETECT_MINUTES + WARMUP_MINUTES : until + WARMUP_MINUTES);
        }
        this.loseLocalData(n, st, st.localWrites * share, m);
        this.loseSessions(n, share, m);
        this.events.push({
          minute: m,
          severity: 'critical',
          nodeId: n.id,
          message: `${label}: lost ${inZone} instance${inZone > 1 ? 's' : ''} in AZ ${az.toUpperCase()}.`,
        });
      } else if (n.kind === 'rds' && cfg.az === az) {
        const minutes = cfg.multiAz ? DB_RECOVERY_MINUTES.multiAz : duration;
        this.dbDownUntil.set(n.id, m + minutes);
        this.events.push({
          minute: m,
          severity: 'critical',
          nodeId: n.id,
          message: cfg.multiAz
            ? `${label}: primary lost; the standby in the other AZ takes over within a minute.`
            : `${label}: down with the zone. There is no standby elsewhere.`,
        });
      } else if (n.kind === 'rds_replica' && cfg.az === az) {
        this.dbDownUntil.set(n.id, until);
      }
    }
  }

  private corruptData(title: string, m: number): void {
    const db = this.primaryDb();
    if (!db) return;
    const cfg = this.catalogue.configOf(db);
    const label = nodeLabel(db, this.catalogue);
    const history = this.dbWrites.get(db.id) ?? [];
    if (cfg.backupRetentionDays <= 0) {
      this.dataLoss = true;
      this.rpoMinutes = Infinity;
      this.lostWrites += history.reduce((s, x) => s + x, 0);
      this.events.push({
        minute: m,
        severity: 'critical',
        nodeId: db.id,
        message: `${title}: the orders table is gone and there are no backups. Every order so far is lost.`,
      });
      return;
    }
    this.rpoMinutes = Math.max(this.rpoMinutes, PITR.rpoMinutes);
    this.lostWrites += history.slice(-PITR.rpoMinutes).reduce((s, x) => s + x, 0);
    this.dbDownUntil.set(db.id, m + PITR.restoreMinutes);
    this.events.push({
      minute: m,
      severity: 'critical',
      nodeId: db.id,
      message: `${title}: restoring ${label} to ${PITR.rpoMinutes} minutes ago from backups (about ${PITR.restoreMinutes} minutes).${cfg.multiAz ? ' Multi-AZ could not help: the standby copied the mistake.' : ''}`,
    });
  }

  private recordDbWrites(id: string, writes: number): void {
    if (!this.dbWrites.has(id)) this.dbWrites.set(id, []);
    this.dbWrites.get(id)!.push(writes);
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

  /** Customers logged in on instances that disappear lose their session (and their basket). */
  private loseSessions(node: DesignNode, share: number, m: number): void {
    if (this.sessionsShared(node)) return;
    const st = this.state.get(node.id)!;
    const lost = st.lastRps * 60 * share;
    if (lost < 1) return;
    this.sessionsLost += lost;
    this.events.push({
      minute: m,
      severity: 'warning',
      nodeId: node.id,
      message: `About ${Math.round(lost).toLocaleString('en-US')} customers were logged out: their sessions lived on the lost server.`,
    });
  }

  private sessionsShared(node: DesignNode): boolean {
    const cfg = this.catalogue.configOf(node);
    return (
      cfg.sessionStore === 'cache' &&
      (this.graph.children.get(node.id) ?? []).some((c) => c.kind === 'elasticache')
    );
  }

  private trackStaleness(calc: Map<string, NodeCalc>): void {
    for (const [id, c] of calc) {
      const node = this.graph.nodes.get(id)!;
      if (c.demand.read <= 0) continue;
      if (node.kind === 'elasticache') {
        this.stalenessSec = Math.max(this.stalenessSec, this.catalogue.configOf(node).ttlSeconds);
      } else if (node.kind === 'rds_replica') {
        const primary = (this.graph.parents.get(id) ?? []).find((p) => p.kind === 'rds');
        const util = primary ? (calc.get(primary.id)?.util ?? 0) : 0;
        this.stalenessSec = Math.max(this.stalenessSec, 1 + 40 * Math.max(0, util - 0.6));
      }
    }
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
      // A group confined to one zone cannot launch anywhere while that zone is down.
      const zoneBlocked = cfg.azs === 1 && this.azDown?.az === 'a' && this.azDown.until > next;
      if (desired > total) {
        const launch = desired - total;
        const readyAt = zoneBlocked ? this.azDown!.until + WARMUP_MINUTES : next + WARMUP_MINUTES;
        for (let i = 0; i < launch; i++) st.pending.push(readyAt);
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
        message:
          n.kind === 'dynamodb'
            ? `${label} is throttling requests (${Math.round(util * 100)}% of what one partition can take).`
            : n.kind === 'lambda'
              ? `${label} hit its concurrency limit; extra invocations are throttled.`
              : `${label} is overloaded (${Math.round(util * 100)}% load); requests are being dropped.`,
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
    if (n.kind === 'users' || n.kind === 'lambda') return addons;
    if (n.kind === 'asg') {
      const st = this.state.get(n.id)!;
      return (st.inService + st.pending.length + st.zombies.length) * size.monthlyCost + addons;
    }
    return size.monthlyCost + addons;
  }

  /** Per-request charges this minute, in dollars. */
  private variableCost(n: DesignNode, c: NodeCalc | undefined): number {
    if (!c) return 0;
    const spec = this.catalogue.get(n.kind);
    const d = c.demand;
    const perMinute = (perMillion: number, rps: number) => (perMillion * rps * 60) / 1e6;
    let cost = perMinute(spec.perMillionRequests, d.static + d.read + d.write);
    if (isCompute(n.kind)) cost += perMinute(SERVER_STATIC_EGRESS_PER_MILLION, d.static * c.accept);
    if (n.kind === 'lambda') {
      const gbSeconds = Math.min(c.load, c.capacity) * LAMBDA_GB_SECONDS_PER_UNIT * 60;
      cost += gbSeconds * LAMBDA_GB_SECOND;
    }
    if (n.kind === 'dynamodb' && this.catalogue.configOf(n).capacityMode === 'on-demand') {
      cost += perMinute(DYNAMO_ON_DEMAND.read, d.read) + perMinute(DYNAMO_ON_DEMAND.write, d.write);
    }
    return cost;
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
