import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import { catalogue } from '../lib/catalogue';
import type { ServiceFlowNode } from '../lib/design';
import { useGame } from '../store/gameStore';
import { Glyph } from './Glyph';

function detail(node: ServiceFlowNode['data']): string {
  const c = node.config;
  switch (node.kind) {
    case 'ec2':
      return `${c.size}, AZ ${c.az?.toUpperCase()}`;
    case 'asg':
      return `${c.size}, ${c.min}–${c.max}`;
    case 'rds':
      return `${c.size}${c.multiAz ? ', Multi-AZ' : ''}`;
    case 'rds_replica':
    case 'elasticache':
      return c.size ?? '';
    case 'lambda':
      return `${c.size}, max ${c.concurrency}`;
    case 'dynamodb':
      return `${c.capacityMode === 'provisioned' ? `${c.provisionedUnits} units` : 'on-demand'}, ${c.partitionKey}`;
    case 'sqs':
      return [c.fifo ? 'FIFO' : 'standard', c.dlq ? 'DLQ' : 'no DLQ'].join(', ');
    case 'payment':
      return 'third-party API';
    case 'api_gateway':
      return 'HTTP API';
    case 'rds_proxy':
      return 'connection pool';
    case 'sns':
      return 'topic';
    case 'eventbridge':
      return 'event bus';
    case 'cloudfront':
      return `cache ${c.ttlSeconds! >= 3600 ? `${c.ttlSeconds! / 3600}h` : `${c.ttlSeconds}s`}`;
    case 'alb':
      return c.healthChecks ? 'health checks' : 'no health checks';
    case 'users':
      return 'traffic source';
    default:
      return '';
  }
}

function ServiceNodeView({ id, data, selected }: NodeProps<ServiceFlowNode>) {
  const spec = catalogue.get(data.kind);
  const tick = useGame((s) =>
    s.snapshots.length ? s.snapshots[Math.floor(s.cursor)]?.nodes[id] : undefined,
  );
  const status = tick?.status ?? 'idle';
  const isUsers = data.kind === 'users';
  const pct = tick ? Math.round(tick.util * 100) : 0;

  return (
    <div className={`node status-${status}${selected ? ' selected' : ''}`}>
      {!isUsers && <Handle type="target" position={Position.Left} />}
      <Glyph kind={data.kind} />
      <div className="node-text">
        <span className="node-name">{data.label ?? spec.shortName}</span>
        <span className="node-detail">
          {isUsers && tick ? `${Math.round(tick.rps).toLocaleString()} req/s` : detail(data)}
        </span>
      </div>
      {tick && !isUsers && status !== 'idle' && (
        <span className="node-badge">
          {status === 'down'
            ? 'Down'
            : tick.backlog !== undefined
              ? `${Math.round(tick.backlog).toLocaleString()} waiting`
              : tick.instances !== undefined
                ? `${pct}%, ${tick.instances}×`
                : tick.concurrency !== undefined
                  ? `${pct}%, ${Math.round(tick.concurrency)} running`
                  : `${pct}%`}
        </span>
      )}
      {tick && !isUsers && (
        <span className="node-load" aria-hidden>
          <span style={{ width: `${Math.min(100, pct)}%` }} />
        </span>
      )}
      {spec.connectsTo.length > 0 && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

export const ServiceNode = memo(ServiceNodeView);
