import { useEffect, useState } from 'react';
import { useGame } from '../store/gameStore';
import { IconClose } from './icons';

/** The worked answer for a level: what to build, step by step, and why it works. */
export function Walkthrough() {
  const open = useGame((s) => s.walkthrough);
  const level = useGame((s) => s.level);
  const close = useGame((s) => s.setWalkthrough);
  const loadSolution = useGame((s) => s.loadSolution);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirming(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open || !level) return null;
  const w = level.walkthrough;

  return (
    <div className="scrim" onClick={() => close(false)}>
      <div
        className="intro walkthrough"
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn report-close" onClick={() => close(false)} aria-label="Close">
          <IconClose />
        </button>
        <p className="intro-kicker">Walkthrough for {level.title.replace(/^Boss: /, '')}</p>
        <h2 id="walkthrough-title">One way to solve it</h2>
        <ol className="steps">
          {w.steps.map((s, i) => (
            <li key={s}>
              <span className="step-num">{i + 1}</span>
              <p>{s}</p>
            </li>
          ))}
        </ol>
        <section className="why">
          <h3>Why this works</h3>
          <p>{w.why}</p>
        </section>
        <footer className="intro-actions">
          {confirming ? (
            <>
              <span className="confirm-text">This replaces your current design.</span>
              <button className="btn ghost" onClick={() => setConfirming(false)}>
                Keep my design
              </button>
              <button className="btn primary" onClick={loadSolution}>
                Replace it
              </button>
            </>
          ) : (
            <>
              <button className="btn ghost" onClick={() => setConfirming(true)}>
                Load this design
              </button>
              <button className="btn primary" onClick={() => close(false)} autoFocus>
                Build it myself
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
