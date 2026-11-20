import { BaseEdge, type EdgeProps, getBezierPath } from '@xyflow/react';
import { memo } from 'react';
import { FAIL_COLOR, REQUEST_COLOR } from '../lib/catalogue';
import type { TrafficFlowEdge } from '../lib/design';
import { useGame } from '../store/gameStore';

/** Dots grow with the log of the request rate, so 10 and 10,000 req/s both read well. */
const dotCount = (rps: number) => Math.min(5, Math.max(1, Math.ceil(Math.log10(rps + 1) * 1.3)));

function TrafficEdgeView(props: EdgeProps<TrafficFlowEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected } = props;
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const tick = useGame((s) =>
    s.snapshots.length ? s.snapshots[Math.floor(s.cursor)]?.edges[id] : undefined,
  );
  const playing = useGame((s) => s.status === 'playing');
  const speed = useGame((s) => s.speed);

  const active = !!tick && tick.rps > 0.01;
  const failing = !!tick?.failing;
  const dotColor = failing ? FAIL_COLOR : active ? REQUEST_COLOR[tick.type] : undefined;
  const n = active ? dotCount(tick.rps) : 0;
  const dur = 2.6 / Math.pow(speed, 0.35);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={`edge${active ? ' active' : ''}${failing ? ' failing' : ''}${selected ? ' selected' : ''}`}
        style={active ? { strokeWidth: 1.25 + Math.min(2.5, Math.log10(tick.rps + 1) * 0.8) } : undefined}
      />
      {playing &&
        Array.from({ length: n }, (_, i) => (
          <circle key={i} r={3} fill={dotColor}>
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
