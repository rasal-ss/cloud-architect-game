import { formatMinute } from '@cloud-architect/engine';
import { money, percent } from '../lib/catalogue';
import { type Speed, useGame, useSnapshot } from '../store/gameStore';

const SPEEDS: Speed[] = [1, 4, 16];

export function TopBar() {
  const level = useGame((s) => s.level);
  const status = useGame((s) => s.status);
  const speed = useGame((s) => s.speed);
  const run = useGame((s) => s.run);
  const togglePlay = useGame((s) => s.togglePlay);
  const setSpeed = useGame((s) => s.setSpeed);
  const backToMenu = useGame((s) => s.backToMenu);
  const result = useGame((s) => s.result);
  const setShowReport = useGame((s) => s.setShowReport);
  const snap = useSnapshot();
  if (!level) return null;

  const overBudget = !!snap && snap.costPerMonth > level.budget;
  const hasRun = status !== 'idle' && status !== 'computing';

  return (
    <header className="topbar">
      <button className="btn ghost" onClick={backToMenu} aria-label="Back to level select">
        ← Levels
      </button>
      <div className="topbar-title">
        <strong>{level.title}</strong>
        <span className="muted small">Budget {money(level.budget)}/mo</span>
      </div>

      <div className="topbar-controls">
        <button className="btn primary" onClick={run} disabled={status === 'computing'}>
          {status === 'computing' ? 'Simulating…' : hasRun ? '↻ Re-run' : '▶ Run simulation'}
        </button>
        {hasRun && (
          <button className="btn" onClick={togglePlay} aria-label={status === 'playing' ? 'Pause' : 'Play'}>
            {status === 'playing' ? '❚❚' : '▶'}
          </button>
        )}
        <div className="speed" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={`btn small ${speed === s ? 'active' : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
        {result?.valid && status !== 'computing' && (
          <button className="btn" onClick={() => setShowReport(true)}>
            Report card
          </button>
        )}
      </div>

      <dl className="hud">
        <div>
          <dt>Time</dt>
          <dd>{snap ? formatMinute(snap.minute) : '--:--'}</dd>
        </div>
        <div>
          <dt>Traffic</dt>
          <dd>{snap ? `${Math.round(snap.rps).toLocaleString()}/s` : '-'}</dd>
        </div>
        <div>
          <dt>p95</dt>
          <dd>{snap ? `${Math.round(snap.p95)} ms` : '-'}</dd>
        </div>
        <div>
          <dt>Errors</dt>
          <dd className={snap && snap.failedRps > 0.5 ? 'bad' : ''}>
            {snap ? `${snap.failedRps < 10 ? snap.failedRps.toFixed(1) : Math.round(snap.failedRps)}/s` : '-'}
          </dd>
        </div>
        <div>
          <dt>Availability</dt>
          <dd>{snap ? percent(snap.availability, 2) : '-'}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd className={overBudget ? 'bad' : ''}>{snap ? `${money(snap.costPerMonth)}/mo` : '-'}</dd>
        </div>
      </dl>
    </header>
  );
}
