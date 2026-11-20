import { BaseEdge, type EdgeProps, getBezierPath } from '@xyflow/react';
import { memo } from 'react';
import { REQUEST_COLOR } from '../lib/catalogue';
import type { TrafficFlowEdge } from '../lib/design';
import { useGame } from '../store/gameStore';

/** Number of dots grows with the log of the request rate, so 10 and 10,000 req/s both read well. */
const dotCount = (rps: number) => Math.min(6, Math.max(1, Math.ceil(Math.log10(rps + 1) * 1.5)));

function TrafficEdgeView(props: EdgeProps<TrafficFlowEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected } =
    props;
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const tick = useGame((s) =>
    s.snapshots.length ? s.snapshots[Math.floor(s.cursor)]?.edges[id] : undefined,
  );
  const playing = useGame((s) => s.status === 'playing');
  const speed = useGame((s) => s.speed);

  const active = !!tick && tick.rps > 0.01;
  const color = tick?.failing ? '#ef4444' : active ? REQUEST_COLOR[tick.type] : undefined;
  const n = active ? dotCount(tick.rps) : 0;
  const dur = 2.4 / Math.pow(speed, 0.35);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={tick?.failing ? 'edge-failing' : undefined}
        style={{
          stroke: selected ? '#f8fafc' : (color ?? '#475569'),
          strokeWidth: active ? 1 + Math.min(4, Math.log10(tick.rps + 1)) : 1.5,
          opacity: active || !tick ? 1 : 0.35,
        }}
      />
      {playing &&
        Array.from({ length: n }, (_, i) => (
          <circle key={i} r={tick?.failing && i % 2 ? 4 : 3} fill={color} className="traffic-dot">
            <animateMotion
              dur={`${dur}s`}
              repeatCount="indefinite"
              begin={`${(-dur * i) / n}s`}
              path={path}
            />
          </circle>
        ))}
    </>
  );
}

export const TrafficEdge = memo(TrafficEdgeView);
