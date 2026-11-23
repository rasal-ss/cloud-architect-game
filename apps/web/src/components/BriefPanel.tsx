import { formatMinute, objectiveLabel } from '@cloud-architect/engine';
import { catalogue, money, percent } from '../lib/catalogue';
import { SANDBOX_ID } from '../lib/sandbox';
import { useGame } from '../store/gameStore';
import { IconCheck, IconCross } from './icons';

/** The default side panel: who wants what, the goals, and what to expect. */
export function BriefPanel() {
  const level = useGame((s) => s.level);
  const result = useGame((s) => s.result);
  const sandbox = useGame((s) => s.sandbox);
  const updateSandbox = useGame((s) => s.updateSandbox);
  const resetDesign = useGame((s) => s.resetDesign);
  const setWalkthrough = useGame((s) => s.setWalkthrough);
  const failedRuns = useGame((s) => s.failedRuns);
  if (!level) return null;
  const isSandbox = level.id === SANDBOX_ID;
  const t = level.traffic;
  const goals = [
    ...level.objectives.map((o) => objectiveLabel(o, catalogue)),
    `Monthly cost under ${money(level.budget)}`,
  ];
  // Result objectives come back in the same order: level objectives, then budget.
  const outcome = result?.valid ? result.objectives : undefined;
  const announced = level.incidents.filter((i) => i.warning);
  const surprises = level.incidents.length - announced.length;

  return (
    <div className="panel-body">
      <figure className="brief">
        <blockquote>{level.brief}</blockquote>
        <figcaption>{level.from}</figcaption>
      </figure>

      {isSandbox && (
        <section className="panel-section">
          <h3 className="panel-label">Scenario</h3>
          <label className="field">
            <span>
              Peak traffic <b>{sandbox.peakRps.toLocaleString()} req/s</b>
            </span>
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
            <span>
              Budget <b>{money(sandbox.budget)}/month</b>
            </span>
            <input
              type="range"
              min={20}
              max={5000}
              step={10}
              value={sandbox.budget}
              onChange={(e) => updateSandbox({ budget: Number(e.target.value) })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={sandbox.spike}
              onChange={(e) => updateSandbox({ spike: e.target.checked })}
            />
            Lunchtime traffic spike
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={sandbox.crash}
              onChange={(e) => updateSandbox({ crash: e.target.checked })}
            />
            A server crashes at dinner
          </label>
        </section>
      )}

      <section className="panel-section">
        <h3 className="panel-label">Goals</h3>
        <ul className="goals">
          {goals.map((g, i) => {
            const o = outcome?.[i];
            return (
              <li key={g} className={o ? (o.pass ? 'pass' : 'fail') : ''}>
                <span className="goal-mark" aria-label={o ? (o.pass ? 'Met' : 'Not met') : undefined}>
                  {o ? o.pass ? <IconCheck /> : <IconCross /> : null}
                </span>
                <span>
                  {g}
                  {o && !o.pass && <small>{o.actual}</small>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel-section">
        <h3 className="panel-label">The day ahead</h3>
        <dl className="facts">
          <div className="fact-row">
            <dt>Peak</dt>
            <dd>{t.peakRps.toLocaleString()} req/s at dinner</dd>
          </div>
          <div className="fact-row">
            <dt>Mix</dt>
            <dd>
              {percent(t.mix.static, 0)} files, {percent(t.mix.read, 0)} reads, {percent(t.mix.write, 0)}{' '}
              orders
            </dd>
          </div>
          {announced.map((i) => (
            <div key={i.id} className="fact-row">
              <dt>{formatMinute(i.atMinute)}</dt>
              <dd>{i.title}</dd>
            </div>
          ))}
          {surprises > 0 && (
            <div className="fact-row">
              <dt>Anytime</dt>
              <dd>Something unannounced</dd>
            </div>
          )}
        </dl>
      </section>

      {level.hints.length > 0 && (
        <details className="panel-section disclosure">
          <summary>Stuck? Get a hint</summary>
          <ul className="hint-list">
            {level.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <p className="muted">{level.lesson}</p>
          <button className="link-btn" onClick={() => setWalkthrough(true)}>
            Still stuck? See the walkthrough
          </button>
        </details>
      )}

      {!isSandbox && failedRuns >= 2 && (
        <button className="stuck" onClick={() => setWalkthrough(true)}>
          <b>Two tries without passing.</b> The walkthrough shows one design that works, and why.
        </button>
      )}

      <button className="link-btn subtle" onClick={resetDesign}>
        Reset to the starting design
      </button>
    </div>
  );
}
