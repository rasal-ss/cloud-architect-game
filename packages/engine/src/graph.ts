import type { Design, DesignNode, Level } from '@cloud-architect/content';
import { type Catalogue, isCompute, nodeLabel } from './catalog';

export interface Graph {
  nodes: Map<string, DesignNode>;
  children: Map<string, DesignNode[]>;
  parents: Map<string, DesignNode[]>;
  /** Edge id for a from->to pair. */
  edgeId: Map<string, string>;
  /** Node ids in topological order (parents before children). */
  order: string[];
  usersId: string;
  /** Nodes reachable from the users node. */
  reachable: Set<string>;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export function validateDesign(design: Design, catalogue: Catalogue, level?: Level): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  const users = design.nodes.filter((n) => n.kind === 'users');
  if (users.length !== 1) errors.push('A design needs exactly one Users node.');

  for (const n of design.nodes) {
    if (level && n.kind !== 'users' && !n.locked && !level.palette.includes(n.kind)) {
      errors.push(`${catalogue.get(n.kind).shortName} is not unlocked in this level.`);
    }
    try {
      catalogue.sizeOf(n);
    } catch (e) {
      errors.push((e as Error).message);
    }
    if (n.kind === 'asg') {
      const c = catalogue.configOf(n);
      if (c.min > c.max)
        errors.push(`${nodeLabel(n, catalogue)}: min (${c.min}) is larger than max (${c.max}).`);
    }
  }

  const seen = new Set<string>();
  for (const e of design.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) {
      errors.push(`Connection ${e.id} points at a missing component.`);
      continue;
    }
    const key = `${e.from}->${e.to}`;
    if (seen.has(key))
      errors.push(`Duplicate connection ${nodeLabel(from, catalogue)} → ${nodeLabel(to, catalogue)}.`);
    seen.add(key);
    if (!catalogue.canConnect(from.kind, to.kind)) {
      errors.push(
        `${catalogue.get(from.kind).shortName} cannot send requests to ${catalogue.get(to.kind).shortName}.`,
      );
    }
  }

  if (errors.length === 0) {
    const g = buildGraph(design);
    if (g.order.length !== design.nodes.length) errors.push('Connections form a loop.');
    for (const n of design.nodes) {
      if (n.kind !== 'users' && !g.reachable.has(n.id)) {
        warnings.push(
          `${nodeLabel(n, catalogue)} is not connected to your users; it costs money but serves nothing.`,
        );
      }
      if (n.kind === 'elasticache' && !(g.children.get(n.id) ?? []).length) {
        warnings.push(`${nodeLabel(n, catalogue)} has no database behind it, so cache misses will fail.`);
      }
      if (n.kind === 'rds_replica' && !(g.parents.get(n.id) ?? []).some((p) => p.kind === 'rds')) {
        warnings.push(`${nodeLabel(n, catalogue)} is not replicating from a primary database.`);
      }
      if (n.kind === 'alb' && !(g.children.get(n.id) ?? []).length) {
        warnings.push(`${nodeLabel(n, catalogue)} has no targets.`);
      }
    }
  }
  return { errors, warnings };
}

export function buildGraph(design: Design): Graph {
  const nodes = new Map(design.nodes.map((n) => [n.id, n]));
  const children = new Map<string, DesignNode[]>();
  const parents = new Map<string, DesignNode[]>();
  const edgeId = new Map<string, string>();
  for (const n of design.nodes) {
    children.set(n.id, []);
    parents.set(n.id, []);
  }
  for (const e of design.edges) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (!from || !to) continue;
    children.get(e.from)!.push(to);
    parents.get(e.to)!.push(from);
    edgeId.set(`${e.from}->${e.to}`, e.id);
  }

  // Kahn's algorithm. Children are sorted by id so the order is deterministic.
  const indeg = new Map(design.nodes.map((n) => [n.id, parents.get(n.id)!.length]));
  const queue = design.nodes
    .filter((n) => indeg.get(n.id) === 0)
    .map((n) => n.id)
    .sort();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const c of [...children.get(id)!].sort((a, b) => a.id.localeCompare(b.id))) {
      const d = indeg.get(c.id)! - 1;
      indeg.set(c.id, d);
      if (d === 0) queue.push(c.id);
    }
  }

  const usersId = design.nodes.find((n) => n.kind === 'users')?.id ?? '';
  const reachable = new Set<string>();
  const stack = usersId ? [usersId] : [];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const c of children.get(id) ?? []) stack.push(c.id);
  }
  return { nodes, children, parents, edgeId, order, usersId, reachable };
}

export interface Finding {
  nodeId?: string;
  message: string;
}

/** Security problems scored by the Security pillar. */
export function securityIssues(design: Design, catalogue: Catalogue): Finding[] {
  const g = buildGraph(design);
  const out: Finding[] = [];
  for (const n of design.nodes) {
    const c = catalogue.configOf(n);
    const label = nodeLabel(n, catalogue);
    if (isCompute(n.kind) && c.securityGroup === 'open-all') {
      out.push({
        nodeId: n.id,
        message: `${label}: security group allows SSH and every port from 0.0.0.0/0.`,
      });
    }
    if (n.kind === 'rds' && c.publiclyAccessible) {
      out.push({ nodeId: n.id, message: `${label}: database is publicly accessible from the internet.` });
    }
    if (n.kind === 's3' && (g.parents.get(n.id) ?? []).some((p) => p.kind === 'users')) {
      out.push({
        nodeId: n.id,
        message: `${label}: bucket must be public for users to reach it. Serve it through CloudFront with Origin Access Control instead.`,
      });
    }
  }
  return out;
}

/** The web tier as a list of instance "slots" (one per EC2, min-count per ASG) with their AZs. */
export function computeTier(design: Design, catalogue: Catalogue): { count: number; azs: Set<string> } {
  const g = buildGraph(design);
  let count = 0;
  const azs = new Set<string>();
  for (const n of design.nodes) {
    if (!isCompute(n.kind) || !g.reachable.has(n.id)) continue;
    const c = catalogue.configOf(n);
    if (n.kind === 'ec2') {
      count += 1;
      azs.add(c.az);
    } else {
      count += c.min;
      if (c.min >= 2 && c.azs === 2) {
        azs.add('a');
        azs.add('b');
      } else if (c.min >= 1) azs.add('a');
    }
  }
  return { count, azs };
}

/** Single points of failure in the parts of the system the player can make redundant. */
export function singlePointsOfFailure(design: Design, catalogue: Catalogue): Finding[] {
  const out: Finding[] = [];
  const tier = computeTier(design, catalogue);
  if (tier.count === 1) {
    out.push({ message: 'Only one web server: if it fails, the whole site is down.' });
  } else if (tier.count > 1 && tier.azs.size < 2) {
    out.push({ message: 'All web servers are in one Availability Zone: an AZ problem takes them all out.' });
  }
  const g = buildGraph(design);
  for (const n of design.nodes) {
    if (!isCompute(n.kind) || !g.reachable.has(n.id)) continue;
    const hasDb = (g.children.get(n.id) ?? []).some((c) => c.kind === 'rds');
    if (!hasDb) {
      out.push({
        nodeId: n.id,
        message: `${nodeLabel(n, catalogue)} keeps its database on the instance's own disk. Data is lost if it dies.`,
      });
    }
  }
  return out;
}

export interface OpsCheck {
  label: string;
  pass: boolean;
}

/** Operational excellence checklist: monitoring, health checks and backups. */
export function operationsChecks(design: Design, catalogue: Catalogue): OpsCheck[] {
  const g = buildGraph(design);
  const out: OpsCheck[] = [];
  for (const n of design.nodes) {
    if (!g.reachable.has(n.id)) continue;
    const c = catalogue.configOf(n);
    const label = nodeLabel(n, catalogue);
    if (isCompute(n.kind)) out.push({ label: `${label}: CloudWatch alarms`, pass: c.alarms });
    if (n.kind === 'alb') out.push({ label: `${label}: target health checks`, pass: c.healthChecks });
    if (n.kind === 'rds') out.push({ label: `${label}: automated backups`, pass: c.backupRetentionDays > 0 });
  }
  return out;
}
