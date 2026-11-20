import { formatMinute, objectiveLabel } from '@cloud-architect/engine';
import { catalogue, money, percent } from '../lib/catalogue';
import { SANDBOX_ID } from '../lib/sandbox';
import { useGame } from '../store/gameStore';

export function BriefPanel() {
  const level = useGame((s) => s.level);
  const sandbox = useGame((s) => s.sandbox);
  const updateSandbox = useGame((s) => s.updateSandbox);
  const resetDesign = useGame((s) => s.resetDesign);
  if (!level) return null;
  const isSandbox = level.id === SANDBOX_ID;
  const t = level.traffic;

  return (
    <aside className="inspector brief" aria-label="Level brief">
      <p className="eyebrow">{isSandbox ? 'Free play' : `Act ${level.act} · Level ${level.index}`}</p>
      <h2>{level.title}</h2>
      <blockquote>
        <p>{level.brief}</p>
        <footer>{level.from}</footer>
      </blockquote>

      {isSandbox && (
        <section className="sandbox-controls">
          <label className="field">
            <span>Peak traffic: {sandbox.peakRps.toLocaleString()} req/s</span>
            <input
              type="range"
              min={10}
              max={5000}
              step={10}
              value={sandbox.peakRps}
              onChange={(e) => updateSandbox({ peakRps: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Budget: {money(sandbox.budget)}/month</span>
            <input
              type="range"
              min={20}
              max={5000}
              step={10}
              value={sandbox.budget}
              onChange={(e) => updateSandbox({ budget: Number(e.target.value) })}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={sandbox.spike}
              onChange={(e) => updateSandbox({ spike: e.target.checked })}
            />
            <span>Traffic spike (5x at lunch)</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={sandbox.crash}
              onChange={(e) => updateSandbox({ crash: e.target.checked })}
            />
            <span>Instance crash (at dinner)</span>
          </label>
        </section>
      )}

      <h4>Objectives</h4>
      <ul className="objectives">
        {level.objectives.map((o, i) => (
          <li key={i}>{objectiveLabel(o, catalogue)}</li>
        ))}
        <li>Monthly cost under {money(level.budget)}</li>
      </ul>

      <h4>Traffic</h4>
      <p className="small">
        Peaks at <strong>{t.peakRps.toLocaleString()} req/s</strong> around dinner time:{' '}
        {percent(t.mix.static, 0)} static files, {percent(t.mix.read, 0)} reads, {percent(t.mix.write, 0)}{' '}
        writes (orders). Customers are {t.userLatencyMs} ms from the AWS region.
      </p>

      {level.incidents.some((i) => i.warning) && (
        <>
          <h4>Forecast</h4>
          <ul className="forecast">
            {level.incidents
              .filter((i) => i.warning)
              .map((i) => (
                <li key={i.id}>
                  <strong>{formatMinute(i.atMinute)}</strong> {i.title}
                </li>
              ))}
          </ul>
        </>
      )}
      {level.incidents.some((i) => !i.warning) && (
        <p className="small warn-text">Expect the unexpected: this level has unannounced incidents.</p>
      )}

      <details>
        <summary>What this level teaches</summary>
        <p className="small">{level.lesson}</p>
      </details>

      <p className="muted small">
        Select a component to configure it. Drag from a component's right handle to another to connect them.
      </p>
      <button className="btn ghost" onClick={resetDesign}>
        Reset to starting design
      </button>
    </aside>
  );
}
