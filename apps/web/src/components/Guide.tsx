import { type ServiceKind, concepts } from '@cloud-architect/content';
import { useEffect, useRef } from 'react';
import { catalogue } from '../lib/catalogue';
import { useGame } from '../store/gameStore';
import { Glyph } from './Glyph';
import { IconClose } from './icons';
import { ServiceCard } from './ServiceCard';

/** Services in the order a player meets them. */
const ORDER: ServiceKind[] = [
  'users',
  'ec2',
  's3',
  'cloudfront',
  'rds',
  'alb',
  'asg',
  'rds_replica',
  'elasticache',
];

/** The service guide: basics plus one card per service. Opens over any screen. */
export function Guide() {
  const topic = useGame((s) => s.guide);
  const open = useGame((s) => s.openGuide);
  const close = useGame((s) => s.closeGuide);
  const content = useRef<HTMLDivElement>(null);

  const isService = !!topic && (ORDER as string[]).includes(topic);
  const current = isService ? (topic as ServiceKind) : 'basics';

  useEffect(() => {
    if (!topic) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [topic, close]);

  useEffect(() => {
    if (!topic || !content.current) return;
    const target = !isService && topic !== 'basics' ? document.getElementById(`concept-${topic}`) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else content.current.scrollTop = 0;
  }, [topic, isService]);

  if (!topic) return null;

  return (
    <div className="scrim" onClick={close}>
      <div
        className="guide"
        role="dialog"
        aria-modal="true"
        aria-label="Service guide"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="guide-nav" aria-label="Guide topics">
          <span className="panel-label">Service guide</span>
          <button className={current === 'basics' ? 'on' : ''} onClick={() => open('basics')}>
            <span className="guide-basics" aria-hidden>
              ?
            </span>
            The basics
          </button>
          <span className="panel-label guide-sub">Components</span>
          {ORDER.map((k) => (
            <button key={k} className={current === k ? 'on' : ''} onClick={() => open(k)}>
              <Glyph kind={k} />
              {k === 'users' ? 'Customers' : catalogue.get(k).shortName}
            </button>
          ))}
        </nav>

        <div className="guide-content" ref={content}>
          <button className="icon-btn guide-close" onClick={close} aria-label="Close guide">
            <IconClose />
          </button>
          {isService ? (
            <ServiceCard kind={current as ServiceKind} />
          ) : (
            <article className="basics">
              <h2>The basics</h2>
              <p className="basics-lead">
                You design how a website runs on AWS. Customers send requests, your components handle them,
                and the game plays out a full day to see what holds up. These ideas come up in every level.
              </p>
              {concepts.map((c) => (
                <section key={c.id} id={`concept-${c.id}`} className="concept">
                  <h3>{c.title}</h3>
                  <p className="concept-summary">{c.summary}</p>
                  <p>{c.body}</p>
                </section>
              ))}
              <button className="btn" onClick={() => open('users')}>
                Next: meet the components
              </button>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
