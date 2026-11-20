import { MINUTES_PER_DAY, formatMinute } from '@cloud-architect/engine';
import { useGame } from '../store/gameStore';

export function Timeline() {
  const snapshots = useGame((s) => s.snapshots);
  const cursor = useGame((s) => s.cursor);
  const seek = useGame((s) => s.seek);
  const result = useGame((s) => s.result);
  const level = useGame((s) => s.level);
  if (!snapshots.length || !level) {
    return (
      <footer className="timeline empty">
        <span className="muted small">
          Press <strong>Run simulation</strong> to play one day of traffic (60 seconds at 1x).
        </span>
      </footer>
    );
  }
  const minute = Math.floor(cursor);
  const events = (result?.events ?? [])
    .filter((e) => e.minute <= minute)
    .slice(-4)
    .reverse();
  const markers = (result?.events ?? []).filter((e) => e.severity === 'critical' || e.severity === 'warning');
  const maxRps = Math.max(...snapshots.map((s) => s.rps));
  const traffic = snapshots
    .map(
      (s, i) =>
        `${i ? 'L' : 'M'}${((i / MINUTES_PER_DAY) * 1000).toFixed(1)},${(30 - (s.rps / maxRps) * 28).toFixed(1)}`,
    )
    .join('');
  const failures = snapshots
    .map((s, i) => ({ i, f: s.failedRps / Math.max(1e-9, s.rps) }))
    .filter((x) => x.f > 0.01);

  return (
    <footer className="timeline">
      <div className="timeline-track">
        <svg viewBox="0 0 1000 30" preserveAspectRatio="none" className="timeline-chart" aria-hidden>
          <path d={traffic} className="tl-traffic" />
          {failures.map(({ i, f }) => (
            <rect
              key={i}
              x={(i / MINUTES_PER_DAY) * 1000}
              width={1000 / MINUTES_PER_DAY + 0.5}
              y={30 - Math.min(1, f) * 30}
              height={Math.min(1, f) * 30}
              className="tl-fail"
            />
          ))}
          {markers.map((e, i) => (
            <line
              key={i}
              x1={(e.minute / MINUTES_PER_DAY) * 1000}
              x2={(e.minute / MINUTES_PER_DAY) * 1000}
              y1={0}
              y2={30}
              className={`tl-marker ${e.severity}`}
            />
          ))}
        </svg>
        <input
          type="range"
          min={0}
          max={snapshots.length - 1}
          value={minute}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label={`Replay position ${formatMinute(minute)}`}
          className="timeline-range"
        />
      </div>
      <ol className="event-log" aria-live="polite">
        {events.map((e, i) => (
          <li key={`${e.minute}-${i}`} className={e.severity}>
            <time>{formatMinute(e.minute)}</time> {e.message}
          </li>
        ))}
      </ol>
    </footer>
  );
}
