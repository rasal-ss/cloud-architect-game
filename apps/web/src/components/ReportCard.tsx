import type { Pillar } from '@cloud-architect/content';
import { formatMinute } from '@cloud-architect/engine';
import { useEffect } from 'react';
import { money, percent } from '../lib/catalogue';
import { SANDBOX_ID } from '../lib/sandbox';
import { nextLevelId, useGame } from '../store/gameStore';

const PILLAR_LABEL: Record<Pillar, string> = {
  reliability: 'Reliability',
  performance: 'Performance',
  cost: 'Cost',
  security: 'Security',
  operations: 'Operational excellence',
  sustainability: 'Sustainability',
};

export function ReportCard() {
  const result = useGame((s) => s.result);
  const level = useGame((s) => s.level);
  const show = useGame((s) => s.showReport);
  const close = useGame((s) => s.setShowReport);
  const openLevel = useGame((s) => s.openLevel);
  const run = useGame((s) => s.run);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, close]);

  if (!show || !result || !level) return null;
  const m = result.metrics;
  const next = level.id !== SANDBOX_ID ? nextLevelId(level.id) : undefined;
  const postMortem = result.events.filter((e) => e.severity === 'critical' || e.severity === 'warning');

  return (
    <div className="modal-backdrop" onClick={() => close(false)}>
      <section
        className="modal report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="report-head">
          <div>
            <p className="eyebrow">Report card</p>
            <h2 id="report-title">{level.title}</h2>
          </div>
          <div className={`verdict ${result.passed ? 'pass' : 'fail'}`}>
            <div className="stars" aria-label={`${result.stars} of 3 stars`}>
              {[1, 2, 3].map((i) => (
                <span key={i} className={i <= result.stars ? 'on' : ''}>
                  ★
                </span>
              ))}
            </div>
            <strong>{result.valid ? `${result.score}/100` : 'Invalid design'}</strong>
            <span>{result.passed ? 'Level passed' : 'Objectives not met'}</span>
          </div>
        </header>

        {!result.valid ? (
          <ul className="errors">
            {result.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : (
          <div className="report-grid">
            <section>
              <h3>Objectives</h3>
              <ul className="objective-results">
                {result.objectives.map((o) => (
                  <li key={o.label} className={o.pass ? 'pass' : 'fail'}>
                    <span>{o.pass ? '✔' : '✘'}</span> {o.label} <em>{o.actual}</em>
                  </li>
                ))}
              </ul>

              <h3>Well-Architected pillars</h3>
              <ul className="pillars">
                {(Object.keys(PILLAR_LABEL) as Pillar[])
                  .filter((p) => (level.weights[p] ?? 0) > 0)
                  .map((p) => (
                    <li key={p}>
                      <span>{PILLAR_LABEL[p]}</span>
                      <div className="bar">
                        <div
                          style={{ width: `${result.pillars[p]}%` }}
                          className={result.pillars[p] < 60 ? 'low' : ''}
                        />
                      </div>
                      <strong>{result.pillars[p]}</strong>
                    </li>
                  ))}
              </ul>

              <h3>Key metrics</h3>
              <div className="kv">
                <span>Availability</span>
                <strong>{percent(m.availability, 3)}</strong>
                <span>Latency p50 / p95 / p99</span>
                <strong>
                  {Math.round(m.p50)} / {Math.round(m.p95)} / {Math.round(m.p99)} ms
                </strong>
                <span>Requests served</span>
                <strong>{Math.round(m.totalRequests - m.failedRequests).toLocaleString()}</strong>
                <span>Requests failed</span>
                <strong>{Math.round(m.failedRequests).toLocaleString()}</strong>
                <span>Orders lost</span>
                <strong className={m.dataLoss ? 'bad' : ''}>{m.lostWrites.toLocaleString()}</strong>
              </div>
            </section>

            <section>
              <h3>Cost: {money(m.monthlyCost)}/month</h3>
              <ul className="costs">
                {m.costBreakdown
                  .filter((c) => c.monthly >= 0.01)
                  .map((c) => (
                    <li key={c.nodeId}>
                      <span>{c.label}</span>
                      <div className="bar">
                        <div
                          style={{ width: `${(c.monthly / Math.max(m.monthlyCost, level.budget)) * 100}%` }}
                        />
                      </div>
                      <strong>{money(c.monthly)}</strong>
                    </li>
                  ))}
              </ul>

              {result.bottlenecks.length > 0 && (
                <>
                  <h3>Bottlenecks</h3>
                  <ul className="bottlenecks">
                    {result.bottlenecks.map((b) => (
                      <li key={b.nodeId} className={b.peakUtil > 1 ? 'bad' : 'warn-text'}>
                        {b.label}: peak load {Math.round(b.peakUtil * 100)}%
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {result.hints.length > 0 && (
                <>
                  <h3>Hints</h3>
                  <ul className="hints">
                    {result.hints.slice(0, 6).map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </>
              )}

              {postMortem.length > 0 && (
                <>
                  <h3>Post-mortem timeline</h3>
                  <ol className="event-log full">
                    {postMortem.slice(0, 12).map((e, i) => (
                      <li key={i} className={e.severity}>
                        <time>{formatMinute(e.minute)}</time> {e.message}
                      </li>
                    ))}
                  </ol>
                  {level.incidents.map((inc) => (
                    <p key={inc.id} className="small lesson">
                      <strong>{inc.title}:</strong> {inc.lesson}
                    </p>
                  ))}
                </>
              )}
            </section>
          </div>
        )}

        <footer className="report-actions">
          <button className="btn" onClick={() => close(false)}>
            Improve the design
          </button>
          {result.valid && (
            <button className="btn" onClick={run}>
              Replay
            </button>
          )}
          {result.passed && next && (
            <button className="btn primary" onClick={() => openLevel(next)}>
              Next level →
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
