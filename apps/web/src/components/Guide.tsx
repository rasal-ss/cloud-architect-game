import { type Concept, type ServiceKind, concepts } from '@cloud-architect/content';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GROUPS, catalogue } from '../lib/catalogue';
import { useGame } from '../store/gameStore';
import { Glyph } from './Glyph';
import { IconClose } from './icons';
import { ServiceCard } from './ServiceCard';

const CONCEPT_GROUPS: { id: Concept['group']; title: string; intro: string }[] = [
  {
    id: 'basics',
    title: 'The basics',
    intro:
      'You design how a website runs on AWS. Customers send requests, your components handle them, and the game plays out a full day to see what holds up. These ideas come up in every level.',
  },
  {
    id: 'reliability',
    title: 'Staying up',
    intro:
      'Things fail: servers, zones, databases, other companies. These ideas keep the site running when they do.',
  },
  {
    id: 'data',
    title: 'Data',
    intro: 'Where data lives, how many copies exist, and how fresh each copy is.',
  },
  {
    id: 'architecture',
    title: 'Architecture patterns',
    intro: 'How services talk to each other: waiting for answers, handing work off, and broadcasting events.',
  },
];

const SECTIONS: { label: string; kinds: ServiceKind[] }[] = [
  { label: 'Traffic', kinds: ['users'] },
  ...GROUPS,
  { label: 'Outside services', kinds: ['payment'] },
];
const ALL_KINDS = SECTIONS.flatMap((s) => s.kinds);
const isGroup = (t: string): t is Concept['group'] => CONCEPT_GROUPS.some((g) => g.id === t);

/** The service guide: concept pages and one card per service. Opens over any screen. */
export function Guide() {
  const topic = useGame((s) => s.guide);
  const open = useGame((s) => s.openGuide);
  const close = useGame((s) => s.closeGuide);
  const content = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');

  // A topic is a service kind, a concept group, or a single concept (shown on its group's page).
  const concept = concepts.find((c) => c.id === topic);
  const isService = !!topic && (ALL_KINDS as string[]).includes(topic);
  const group: Concept['group'] = concept ? concept.group : topic && isGroup(topic) ? topic : 'basics';

  useEffect(() => {
    if (!topic) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [topic, close]);

  useEffect(() => {
    if (!topic || !content.current) return;
    const target = concept ? document.getElementById(`concept-${concept.id}`) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else content.current.scrollTop = 0;
  }, [topic, concept]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;
    const services = ALL_KINDS.filter((k) => {
      const s = catalogue.get(k);
      return [s.name, s.shortName, s.analogy, s.overview, ...s.keyTerms.map((t) => t.term)].some((x) =>
        x.toLowerCase().includes(q),
      );
    });
    const ideas = concepts.filter((c) =>
      [c.title, c.summary, c.body].some((x) => x.toLowerCase().includes(q)),
    );
    return { services, ideas };
  }, [query]);

  if (!topic) return null;
  const page = CONCEPT_GROUPS.find((g) => g.id === group)!;

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
          <input
            className="guide-search"
            type="search"
            placeholder="Search the guide"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the guide"
          />
          {results ? (
            <div className="guide-results">
              {!results.services.length && !results.ideas.length && (
                <p className="muted">Nothing matches “{query}”.</p>
              )}
              {results.ideas.map((c) => (
                <button key={c.id} onClick={() => open(c.id)}>
                  <span className="guide-dot" aria-hidden />
                  {c.title}
                </button>
              ))}
              {results.services.map((k) => (
                <button key={k} className={topic === k ? 'on' : ''} onClick={() => open(k)}>
                  <Glyph kind={k} />
                  {k === 'users' ? 'Customers' : catalogue.get(k).shortName}
                </button>
              ))}
            </div>
          ) : (
            <>
              <h3 className="guide-heading">Ideas</h3>
              {CONCEPT_GROUPS.map((g) => (
                <button
                  key={g.id}
                  className={!isService && group === g.id ? 'on' : ''}
                  onClick={() => open(g.id)}
                >
                  <span className="guide-dot" aria-hidden />
                  {g.title}
                </button>
              ))}
              {SECTIONS.map((sec) => (
                <div key={sec.label} className="guide-section">
                  <h3 className="guide-heading">{sec.label}</h3>
                  {sec.kinds.map((k) => (
                    <button key={k} className={topic === k ? 'on' : ''} onClick={() => open(k)}>
                      <Glyph kind={k} />
                      {k === 'users' ? 'Customers' : catalogue.get(k).shortName}
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </nav>

        <div className="guide-content" ref={content}>
          <button className="icon-btn guide-close" onClick={close} aria-label="Close guide">
            <IconClose />
          </button>
          {isService ? (
            <ServiceCard kind={topic as ServiceKind} />
          ) : (
            <article className="basics">
              <h2>{page.title}</h2>
              <p className="basics-lead">{page.intro}</p>
              {concepts
                .filter((c) => c.group === group)
                .map((c) => (
                  <section
                    key={c.id}
                    id={`concept-${c.id}`}
                    className={`concept${concept?.id === c.id ? ' focus' : ''}`}
                  >
                    <h3>{c.title}</h3>
                    <p className="concept-summary">{c.summary}</p>
                    {c.body.split('\n\n').map((p) => (
                      <p key={p.slice(0, 24)}>{p}</p>
                    ))}
                  </section>
                ))}
              <NextPage group={group} />
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

function NextPage({ group }: { group: Concept['group'] }) {
  const open = useGame((s) => s.openGuide);
  const i = CONCEPT_GROUPS.findIndex((g) => g.id === group);
  const next = CONCEPT_GROUPS[i + 1];
  return next ? (
    <button className="btn" onClick={() => open(next.id)}>
      Next: {next.title.toLowerCase()}
    </button>
  ) : (
    <button className="btn" onClick={() => open('users')}>
      Next: meet the components
    </button>
  );
}
