import type { ServiceKind } from '@cloud-architect/content';
import { useState } from 'react';
import { useGame } from '../store/gameStore';
import { IconArrow } from './icons';
import { ServiceCard } from './ServiceCard';

type Page = { type: 'how' } | { type: 'service'; kind: ServiceKind };

const STEPS = [
  {
    title: 'Build',
    body: 'Drag components onto the canvas and connect them from left to right. Requests flow along the connections, starting from your customers.',
  },
  {
    title: 'Run',
    body: 'Press Run the day to play 24 hours of traffic in about a minute. Components turn green, amber or red as they get busy.',
  },
  {
    title: 'Improve',
    body: 'Meet the goals to pass and earn up to three stars. Change sizes and settings, add components, and run again.',
  },
];

/** Shown when a level opens with something new: how to play, then each newly unlocked service. */
export function LevelIntro() {
  const intro = useGame((s) => s.intro);
  const dismiss = useGame((s) => s.dismissIntro);
  const openGuide = useGame((s) => s.openGuide);
  const [index, setIndex] = useState(0);
  if (!intro) return null;

  const pages: Page[] = [
    ...(intro.howToPlay ? [{ type: 'how' as const }] : []),
    ...intro.kinds.map((kind) => ({ type: 'service' as const, kind })),
  ];
  const page = pages[Math.min(index, pages.length - 1)]!;
  const last = index >= pages.length - 1;
  const finish = () => {
    setIndex(0);
    dismiss();
  };

  return (
    <div className="scrim">
      <div className="intro" role="dialog" aria-modal="true" aria-labelledby="intro-title">
        {page.type === 'how' ? (
          <>
            <span className="eyebrow">Welcome</span>
            <h2 id="intro-title">How to play</h2>
            <p className="intro-lead">
              You’re the cloud architect for NimbusCart, a grocery-delivery startup. Each level is a request
              from the team, with a budget and a day of traffic.
            </p>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="step-num">{i + 1}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <span className="eyebrow" id="intro-title">
              New component unlocked
            </span>
            <ServiceCard kind={page.kind} compact />
          </>
        )}

        <footer className="intro-actions">
          {pages.length > 1 && (
            <span className="dots" aria-label={`Page ${index + 1} of ${pages.length}`}>
              {pages.map((_, i) => (
                <i key={i} className={i === index ? 'on' : ''} />
              ))}
            </span>
          )}
          <button
            className="link-btn subtle"
            onClick={() => {
              finish();
              openGuide(page.type === 'service' ? page.kind : 'basics');
            }}
          >
            Open the full guide
          </button>
          {index > 0 && (
            <button className="btn ghost" onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          <button className="btn primary" onClick={last ? finish : () => setIndex(index + 1)} autoFocus>
            {last ? 'Start building' : 'Next'}
            <IconArrow />
          </button>
        </footer>
      </div>
    </div>
  );
}
