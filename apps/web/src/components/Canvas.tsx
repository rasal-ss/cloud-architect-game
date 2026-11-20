import type { ServiceKind } from '@cloud-architect/content';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import { type DragEvent, useCallback } from 'react';
import { CATEGORY_COLOR, catalogue } from '../lib/catalogue';
import type { ServiceFlowNode, TrafficFlowEdge } from '../lib/design';
import { isValidConnection, useGame } from '../store/gameStore';
import { ServiceNode } from './ServiceNode';
import { TrafficEdge } from './TrafficEdge';

export const DRAG_MIME = 'application/x-cloud-architect-service';

const nodeTypes = { service: ServiceNode };
const edgeTypes = { traffic: TrafficEdge };
const defaultEdgeOptions = { type: 'traffic', markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' } };

export function Canvas() {
  const nodes = useGame((s) => s.nodes);
  const edges = useGame((s) => s.edges);
  const onNodesChange = useGame((s) => s.onNodesChange);
  const onEdgesChange = useGame((s) => s.onEdgesChange);
  const connect = useGame((s) => s.connect);
  const addService = useGame((s) => s.addService);
  const select = useGame((s) => s.select);
  const { screenToFlowPosition } = useReactFlow();

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData(DRAG_MIME) as ServiceKind;
      if (!kind) return;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addService(kind, { x: pos.x - 80, y: pos.y - 28 });
    },
    [addService, screenToFlowPosition],
  );

  const validate = useCallback(
    (c: { source: string; target: string }) => isValidConnection(useGame.getState().nodes, c),
    [],
  );

  return (
    <div className="canvas" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <ReactFlow<ServiceFlowNode, TrafficFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={connect}
        isValidConnection={(c) => validate({ source: c.source, target: c.target })}
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => select(null)}
        snapToGrid
        snapGrid={[20, 20]}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1.1 }}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: false }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            CATEGORY_COLOR[catalogue.get((n as ServiceFlowNode).data.kind).category] ?? '#64748b'
          }
          maskColor="rgba(2, 6, 23, 0.7)"
        />
      </ReactFlow>
    </div>
  );
}
