import type { Design, NodeConfig, ServiceKind } from '@cloud-architect/content';
import type { Edge, Node } from '@xyflow/react';

export const DRAG_MIME = 'application/x-cloud-architect-service';

export type ServiceNodeData = {
  kind: ServiceKind;
  label?: string;
  config: NodeConfig;
  locked?: boolean;
};
export type ServiceFlowNode = Node<ServiceNodeData, 'service'>;
export type TrafficFlowEdge = Edge<Record<string, never>, 'traffic'>;

export function toFlow(design: Design): { nodes: ServiceFlowNode[]; edges: TrafficFlowEdge[] } {
  return {
    nodes: design.nodes.map((n) => ({
      id: n.id,
      type: 'service',
      position: { x: n.x, y: n.y },
      deletable: !n.locked,
      data: { kind: n.kind, label: n.label, config: { ...n.config }, locked: n.locked },
    })),
    edges: design.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, type: 'traffic' })),
  };
}

export function fromFlow(nodes: ServiceFlowNode[], edges: TrafficFlowEdge[]): Design {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      ...(n.data.label ? { label: n.data.label } : {}),
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      config: n.data.config,
      ...(n.data.locked ? { locked: true } : {}),
    })),
    edges: edges.map((e) => ({ id: e.id, from: e.source, to: e.target })),
  };
}

export function nextId(kind: string, existing: Iterable<string>): string {
  const ids = new Set(existing);
  let i = 1;
  while (ids.has(`${kind}-${i}`)) i++;
  return `${kind}-${i}`;
}
