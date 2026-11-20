import type { ServiceKind } from '@cloud-architect/content';
import { Background, BackgroundVariant, Controls, ReactFlow, useReactFlow } from '@xyflow/react';
import { type DragEvent, useCallback } from 'react';
import { useCoachMessage } from '../lib/coach';
import { DRAG_MIME, type ServiceFlowNode, type TrafficFlowEdge } from '../lib/design';
import { isValidConnection, useGame } from '../store/gameStore';
import { ServiceNode } from './ServiceNode';
import { TrafficEdge } from './TrafficEdge';

const nodeTypes = { service: ServiceNode };
const edgeTypes = { traffic: TrafficEdge };
const defaultEdgeOptions = { type: 'traffic' };

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
      addService(kind, { x: pos.x - 80, y: pos.y - 24 });
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
        snapGrid={[12, 12]}
        fitView
        minZoom={0.25}
        fitViewOptions={{ padding: 0.12, maxZoom: 1, minZoom: 0.25 }}
        deleteKeyCode={['Backspace', 'Delete']}
        colorMode="light"
      >
        <Background variant={BackgroundVariant.Lines} gap={24} color="#ebe7de" />
        <Controls showInteractive={false} position="top-left" />
      </ReactFlow>
      <CoachMark />
    </div>
  );
}

function CoachMark() {
  const message = useCoachMessage();
  if (!message) return null;
  return (
    <div className="coach" role="status">
      <span className="coach-dot" aria-hidden />
      {message}
    </div>
  );
}
