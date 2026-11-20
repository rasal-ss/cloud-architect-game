import { MINUTES_PER_DAY, formatMinute } from '@cloud-architect/engine';
import { useMemo } from 'react';
import { REQUEST_COLOR, money, percent } from '../lib/catalogue';
import { type Speed, useGame, useSnapshot } from '../store/gameStore';
import { useCoachMessage } from '../lib/coach';
import { IconPause, IconPlay } from './icons';

const SPEEDS: Speed[] = [1, 4, 16];

/** Playback controls and the four numbers that matter, floating over the canvas. */
export function RunDock() {
  const status = useGame((s) => s.status);
  const snapshots = useGame((s) => s.snapshots);
  const cursor = useGame((s) => s.cursor);
  const speed = useGame((s) => s.speed);
  const level = useGame((s) => s.level);
  const result = useGame((s) => s.result);
  const togglePlay = useGame((s) => s.togglePlay);
  const setSpeed = useGame((s) => s.setSpeed);
  const seek = useGame((s) => s.seek);
  const setShowReport = useGame((s) => s.setShowReport);
  const snap = useSnapshot();
  const coaching = useCoachMessage() !== null;

  const strip = useMemo(() => {
    if (!snapshots.length) return { traffic: '', fails: [] as { x: number; h: number }[] };
    const max = Math.max(...snapshots.map((s) => s.rps));
    const traffic =
      snapshots
        .map(
          (s, i) =>
            `${i ? 'L' : 'M'}${((i / MINUTES_PER_DAY) * 1000).toFixed(1)},${(24 - (s.rps / max) * 20).toFixed(1)}`,
        )
        .join('') + 'L1000,24L0,24Z';
    const fails = snapshots
      .map((s, i) => ({
        x: (i / MINUTES_PER_DAY) * 1000,
        h: Math.min(1, s.failedRps / Math.max(1e-9, s.rps)),
      }))
      .filter((f) => f.h > 0.01);
    return { traffic, fails };
  }, [snapshots]);

  if (!level || coaching) return null;

  if (status === 'idle' || status === 'computing' || !snap) {
    return (
      <div className="dock dock-idle" role="status">
        {status === 'computing'
          ? 'Simulating 24 hours of traffic…'
          : 'Press Run the day to send a full day of customers through your design.'}
      </div>
    );
  }

  const minute = Math.floor(cursor);
  const latest = result?.events.filter((e) => e.minute <= minute && e.severity !== 'info').at(-1);
  const overBudget = snap.costPerMonth > level.budget;
  const markers = (result?.events ?? []).filter((e) => e.severity === 'critical');

  return (
    <div className="dock" aria-label="Simulation playback">
      <div className="dock-row">
        <button
          className="icon-btn solid"
          onClick={togglePlay}
          aria-label={status === 'playing' ? 'Pause' : 'Play'}
        >
          {status === 'playing' ? <IconPause /> : <IconPlay />}
        </button>
        <span className="clock">{formatMinute(snap.minute)}</span>
        <div className="scrub">
          <svg viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden>
            <path d={strip.traffic} className="scrub-traffic" />
            {strip.fails.map((f, i) => (
              <rect key={i} x={f.x} width={1.2} y={24 - f.h * 24} height={f.h * 24} className="scrub-fail" />
            ))}
            {markers.map((e, i) => (
              <rect
                key={`m${i}`}
                x={(e.minute / MINUTES_PER_DAY) * 1000 - 1}
                width={2}
                y={0}
                height={24}
                className="scrub-marker"
              />
            ))}
          </svg>
          <input
            type="range"
            min={0}
            max={snapshots.length - 1}
            value={minute}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label={`Time of day, ${formatMinute(minute)}`}
          />
        </div>
        <div className="segmented" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={speed === s ? 'on' : ''}
              onClick={() => setSpeed(s)}
              aria-pressed={speed === s}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="dock-row metrics">
        <Metric label="Availability" value={percent(snap.availability, 2)} />
        <Metric label="Latency p95" value={`${Math.round(snap.p95)} ms`} />
        <Metric
          label="Errors"
          value={`${snap.failedRps < 10 ? snap.failedRps.toFixed(1) : Math.round(snap.failedRps)}/s`}
          tone={snap.failedRps > 0.5 ? 'bad' : undefined}
        />
        <Metric
          label="Cost / month"
          value={`${money(snap.costPerMonth)}`}
          sub={`of ${money(level.budget)}`}
          tone={overBudget ? 'bad' : undefined}
        />
        <span className="legend" aria-label="Dot colours">
          <i style={{ background: REQUEST_COLOR.static }} /> files
          <i style={{ background: REQUEST_COLOR.read }} /> reads
          <i style={{ background: REQUEST_COLOR.write }} /> orders
        </span>
      </div>

      {(latest || status === 'finished') && (
        <div className="dock-row event">
          {latest && (
            <span className={`event-line ${latest.severity}`}>
              <time>{formatMinute(latest.minute)}</time> {latest.message}
            </span>
          )}
          {status === 'finished' && (
            <button className="link-btn" onClick={() => setShowReport(true)}>
              See results
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' }) {
  return (
    <span className={`metric${tone ? ` ${tone}` : ''}`}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">
        {value}
        {sub && <small> {sub}</small>}
      </span>
    </span>
  );
}
