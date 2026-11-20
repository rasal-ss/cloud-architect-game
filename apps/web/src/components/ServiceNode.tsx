import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import { CATEGORY_COLOR, KIND_GLYPH, catalogue } from '../lib/catalogue';
import type { ServiceFlowNode } from '../lib/design';
import { useGame } from '../store/gameStore';

function subtitle(node: ServiceFlowNode['data']): string {
  const c = node.config;
  switch (node.kind) {
    case 'ec2':
      return `${c.size} · AZ ${c.az?.toUpperCase()}`;
    case 'asg':
      return `${c.size} · ${c.min}-${c.max} · ${c.azs} AZ`;
    case 'rds':
    case 'rds_replica':
    case 'elasticache':
      return c.size ?? '';
    case 'cloudfront':
      return `TTL ${c.ttlSeconds! >= 3600 ? `${c.ttlSeconds! / 3600}h` : `${c.ttlSeconds}s`}`;
    case 'alb':
      return c.healthChecks ? 'health checks on' : 'health checks OFF';
    case 'users':
      return 'the internet';
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
  const color = CATEGORY_COLOR[spec.category];
  const util = tick ? Math.min(tick.util, 1.5) : 0;
  const isUsers = data.kind === 'users';

  return (
    <div
      className={`svc-node status-${status} ${selected ? 'selected' : ''}`}
      style={{ ['--accent' as string]: color }}
      title={spec.name}
    >
      {!isUsers && <Handle type="target" position={Position.Left} />}
      <div className="svc-icon" aria-hidden>
        {KIND_GLYPH[data.kind]}
      </div>
      <div className="svc-body">
        <div className="svc-label">
          {data.label ?? spec.shortName}
          {data.locked && (
            <span className="svc-lock" title="Placed by the level">
              {' '}
              ●
            </span>
          )}
        </div>
        <div className="svc-sub">{subtitle(data)}</div>
        {tick && !isUsers && (
          <div className="svc-meter" aria-label={`load ${Math.round(tick.util * 100)}%`}>
            <div className="svc-meter-fill" style={{ width: `${(util / 1.5) * 100}%` }} />
            <span>
              {status === 'down'
                ? 'DOWN'
                : `${Math.round(tick.util * 100)}%${tick.instances !== undefined ? ` · ${tick.instances}×${tick.pending ? ` +${tick.pending}` : ''}` : ''}`}
            </span>
          </div>
        )}
        {tick && isUsers && <div className="svc-sub">{Math.round(tick.rps).toLocaleString()} req/s</div>}
      </div>
      {spec.connectsTo.length > 0 && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

export const ServiceNode = memo(ServiceNodeView);
