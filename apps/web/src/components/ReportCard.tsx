import type { Pillar } from '@cloud-architect/content';
import { formatMinute } from '@cloud-architect/engine';
import { useEffect, useRef } from 'react';
import { money, percent } from '../lib/catalogue';
import { SANDBOX_ID } from '../lib/sandbox';
import { nextLevelId, useGame } from '../store/gameStore';
import { IconCheck, IconClose, IconCross, Stars } from './icons';

const PILLAR_LABEL: Record<Pillar, string> = {
  reliability: 'Reliability',
  performance: 'Performance',
  cost: 'Cost',
  security: 'Security',
  operations: 'Operations',
  sustainability: 'Sustainability',
};

export function ReportCard() {
  const result = useGame((s) => s.result);
  const level = useGame((s) => s.level);
  const show = useGame((s) => s.showReport);
  const close = useGame((s) => s.setShowReport);
  const openLevel = useGame((s) => s.openLevel);
  const seek = useGame((s) => s.seek);
  const togglePlay = useGame((s) => s.togglePlay);
  const setWalkthrough = useGame((s) => s.setWalkthrough);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, close]);

  if (!show || !result || !level) return null;
  const m = result.metrics;
  const next = level.id !== SANDBOX_ID ? nextLevelId(level.id) : undefined;
  const timeline = result.events.filter((e) => e.severity === 'critical' || e.severity === 'warning');
  const tip = result.hints[0];

  const replay = () => {
    close(false);
    seek(0);
    togglePlay();
  };

  return (
    <div className="scrim" onClick={() => close(false)}>
      <div
        ref={dialog}
        tabIndex={-1}
        className="report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn report-close" onClick={() => close(false)} aria-label="Close">
          <IconClose />
        </button>

        <header className={`verdict ${result.passed ? 'pass' : 'fail'}`}>
          <p className="intro-kicker">{level.title.replace(/^Boss: /, '')}</p>
          <h2 id="report-title">
            {!result.valid ? 'The design can’t run yet' : result.passed ? 'You made it.' : 'Not this time.'}
          </h2>
          {result.valid && (
            <div className="verdict-score">
              <Stars count={result.stars} size={22} />
              <span>
                <b>{result.score}</b> / 100
              </span>
            </div>
          )}
        </header>

        {!result.valid ? (
          <ul className="report-list">
            {result.errors.map((e) => (
              <li key={e} className="fail">
                <IconCross /> {e}
              </li>
            ))}
          </ul>
        ) : (
          <>
            <ul className="report-list">
              {result.objectives.map((o) => (
                <li key={o.label} className={o.pass ? 'pass' : 'fail'}>
                  {o.pass ? <IconCheck /> : <IconCross />}
                  <span>{o.label}</span>
                  <em>{o.actual}</em>
                </li>
              ))}
            </ul>

            {!result.passed && level.id !== SANDBOX_ID && (
              <button
                className="link-btn walkthrough-link"
                onClick={() => {
                  close(false);
                  setWalkthrough(true);
                }}
              >
                Stuck? See the walkthrough for this level
              </button>
            )}

            {tip && result.stars < 3 && (
              <p className="tip">
                <b>Try next</b>
                {tip}
              </p>
            )}

            <details className="breakdown">
              <summary>Full breakdown</summary>

              <h3 className="panel-label">Well-Architected score</h3>
              <ul className="bars">
                {(Object.keys(PILLAR_LABEL) as Pillar[])
                  .filter((p) => (level.weights[p] ?? 0) > 0)
                  .map((p) => (
                    <li key={p}>
                      <span>{PILLAR_LABEL[p]}</span>
                      <span className="bar">
                        <span
                          style={{ width: `${result.pillars[p]}%` }}
                          className={result.pillars[p] < 60 ? 'low' : ''}
                        />
                      </span>
                      <b>{result.pillars[p]}</b>
                    </li>
                  ))}
              </ul>

              <h3 className="panel-label">The day in numbers</h3>
              <dl className="facts grid">
                <div className="fact-row">
                  <dt>Availability</dt>
                  <dd>{percent(m.availability, 3)}</dd>
                </div>
                <div className="fact-row">
                  <dt>Latency p50 / p95 / p99</dt>
                  <dd>
                    {Math.round(m.p50)} / {Math.round(m.p95)} / {Math.round(m.p99)} ms
                  </dd>
                </div>
                <div className="fact-row">
                  <dt>Failed requests</dt>
                  <dd>{Math.round(m.failedRequests).toLocaleString()}</dd>
                </div>
                <div className="fact-row">
                  <dt>Orders lost</dt>
                  <dd>{m.lostWrites.toLocaleString()}</dd>
                </div>
                {m.ordersCharged > 0 && (
                  <div className="fact-row">
                    <dt>Orders charged</dt>
                    <dd>{percent(m.ordersCharged / Math.max(1, m.ordersPlaced), 2)}</dd>
                  </div>
                )}
                {m.queue.peakBacklog > 0 && (
                  <div className="fact-row">
                    <dt>Largest queue backlog</dt>
                    <dd>{m.queue.peakBacklog.toLocaleString()}</dd>
                  </div>
                )}
                {m.queue.peakBacklog > 0 && (
                  <div className="fact-row">
                    <dt>Still queued at midnight</dt>
                    <dd>{(m.queue.endBacklog + m.queue.poisonLeft).toLocaleString()}</dd>
                  </div>
                )}
                {m.queue.deadLettered > 0 && (
                  <div className="fact-row">
                    <dt>Sent to the dead-letter queue</dt>
                    <dd>{m.queue.deadLettered.toLocaleString()}</dd>
                  </div>
                )}
                {m.lostMessages > 0 && (
                  <div className="fact-row">
                    <dt>Events lost</dt>
                    <dd>{m.lostMessages.toLocaleString()}</dd>
                  </div>
                )}
                {m.sessionsLost > 0 && (
                  <div className="fact-row">
                    <dt>Customers logged out</dt>
                    <dd>{m.sessionsLost.toLocaleString()}</dd>
                  </div>
                )}
                {m.stalenessSec > 0 && (
                  <div className="fact-row">
                    <dt>Oldest data shown</dt>
                    <dd>{Math.round(m.stalenessSec)} s</dd>
                  </div>
                )}
                {m.coldStartShare > 0 && (
                  <div className="fact-row">
                    <dt>Lambda cold starts</dt>
                    <dd>{percent(m.coldStartShare, 1)}</dd>
                  </div>
                )}
                {m.throttled > 0 && (
                  <div className="fact-row">
                    <dt>Throttled by DynamoDB</dt>
                    <dd>{m.throttled.toLocaleString()}</dd>
                  </div>
                )}
              </dl>

              <h3 className="panel-label">Cost: {money(m.monthlyCost)} per month</h3>
              <ul className="bars">
                {m.costBreakdown
                  .filter((c) => c.monthly >= 0.01)
                  .map((c) => (
                    <li key={c.nodeId}>
                      <span>{c.label}</span>
                      <span className="bar">
                        <span
                          className="cost"
                          style={{ width: `${(c.monthly / Math.max(m.monthlyCost, level.budget)) * 100}%` }}
                        />
                      </span>
                      <b>{money(c.monthly)}</b>
                    </li>
                  ))}
              </ul>

              {result.hints.length > 1 && (
                <>
                  <h3 className="panel-label">More suggestions</h3>
                  <ul className="hint-list">
                    {result.hints.slice(1, 5).map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </>
              )}

              {timeline.length > 0 && (
                <>
                  <h3 className="panel-label">What happened</h3>
                  <ol className="timeline">
                    {timeline.slice(0, 10).map((e, i) => (
                      <li key={i} className={e.severity}>
                        <time>{formatMinute(e.minute)}</time>
                        {e.message}
                      </li>
                    ))}
                  </ol>
                  {level.incidents.map((inc) => (
                    <p key={inc.id} className="lesson">
                      <b>{inc.title}.</b> {inc.lesson}
                    </p>
                  ))}
                </>
              )}
            </details>
          </>
        )}

        <footer className="report-actions">
          {result.valid && (
            <button className="btn ghost" onClick={replay}>
              Watch replay
            </button>
          )}
          <button
            className={`btn ${result.passed && next ? 'ghost' : 'primary'}`}
            onClick={() => close(false)}
          >
            Back to design
          </button>
          {result.passed && next && (
            <button className="btn primary" onClick={() => openLevel(next)}>
              Next level
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
