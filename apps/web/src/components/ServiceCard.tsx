import { type ServiceKind, levels } from '@cloud-architect/content';
import { catalogue, money } from '../lib/catalogue';
import { useGame } from '../store/gameStore';
import { Glyph } from './Glyph';

const CATEGORY_LABEL: Record<string, string> = {
  client: 'Your customers',
  compute: 'Runs your code',
  networking: 'Gets requests to the right place',
  database: 'Stores your data',
  caching: 'Answers repeated questions fast',
  storage: 'Stores files',
  messaging: 'Passes messages between services',
  external: 'Someone else’s service',
};

export function unlockLabel(kind: ServiceKind): string {
  if (kind === 'users') return 'Every level';
  const level = levels.find(
    (l) => l.palette.includes(kind as never) || l.startingDesign.nodes.some((n) => n.kind === kind),
  );
  return level ? `Level ${level.id}, ${level.title.replace(/^Boss: /, '')}` : 'The sandbox';
}

/** Everything a newcomer needs to know about one service. `compact` keeps only the essentials. */
export function ServiceCard({ kind, compact = false }: { kind: ServiceKind; compact?: boolean }) {
  const spec = catalogue.get(kind);
  const openGuide = useGame((s) => s.openGuide);
  const paragraphs = spec.overview.split('\n\n');
  const connects = spec.connectsTo.map((k) => catalogue.get(k).shortName);

  return (
    <article className={`service-card${compact ? ' compact' : ''}`}>
      <header>
        <Glyph kind={kind} size="lg" />
        <div>
          <h3>{spec.name}</h3>
          <p className="card-role">{CATEGORY_LABEL[spec.category]}</p>
        </div>
      </header>

      <p className="analogy">{spec.analogy}</p>

      <section>
        <h4>What it is</h4>
        {(compact ? paragraphs.slice(0, 1) : paragraphs).map((p) => (
          <p key={p.slice(0, 24)}>{p}</p>
        ))}
      </section>

      <section>
        <h4>In the game</h4>
        <p>{spec.inGame}</p>
      </section>

      <div className="use-grid">
        <section>
          <h4>Use it for</h4>
          <p>{spec.whenToUse}</p>
        </section>
        <section>
          <h4>Avoid it for</h4>
          <p>{spec.whenNotToUse}</p>
        </section>
      </div>

      {!compact && (
        <>
          <section>
            <h4>Words to know</h4>
            <dl className="terms">
              {spec.keyTerms.map((t) => (
                <div key={t.term}>
                  <dt>{t.term}</dt>
                  <dd>{t.meaning}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="example">
            <h4>At NimbusCart</h4>
            <p>{spec.example}</p>
          </section>

          <section>
            <h4>Common mistakes</h4>
            <ul className="mistakes">
              {spec.mistakes.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </section>

          <section>
            <h4>Works well with</h4>
            <ul className="pairs">
              {spec.pairsWith.map((p) => (
                <li key={p.kind}>
                  <button className="pair" onClick={() => openGuide(p.kind)}>
                    <Glyph kind={p.kind as ServiceKind} />
                    <span>
                      <b>{catalogue.get(p.kind as ServiceKind).shortName}</b>
                      {p.why}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {spec.sizes && spec.sizes.some((s) => s.monthlyCost > 0 || s.memoryMb) ? (
            <section>
              <h4>Sizes</h4>
              <table className="sizes">
                <thead>
                  <tr>
                    <th>Size</th>
                    <th>Work per second</th>
                    {spec.sizes[0]?.maxConnections && <th>Connections</th>}
                    <th>{kind === 'lambda' ? 'Price' : 'Per month'}</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.sizes.map((s) => (
                    <tr key={s.id}>
                      <td>{s.id}</td>
                      <td>
                        {s.capacity.toLocaleString()}
                        {kind === 'lambda' ? ' each' : ''}
                      </td>
                      {s.maxConnections && <td>{s.maxConnections}</td>}
                      <td>{kind === 'lambda' ? 'per request' : money(s.monthlyCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : (
            kind !== 'users' &&
            kind !== 'payment' && (
              <section>
                <h4>Price</h4>
                <p>
                  {spec.monthlyCost > 0 ? `${money(spec.monthlyCost)} a month` : 'Nothing when idle'}
                  {spec.perMillionRequests > 0 &&
                    `, plus ${money(spec.perMillionRequests)} per million requests`}
                  {kind === 'dynamodb' &&
                    ', plus $0.25 per million reads and $1.25 per million writes on demand'}
                </p>
              </section>
            )
          )}

          <dl className="card-facts">
            <div>
              <dt>Sends requests to</dt>
              <dd>{connects.length ? connects.join(', ') : 'Nothing. Requests end here.'}</dd>
            </div>
            <div>
              <dt>First appears in</dt>
              <dd>{unlockLabel(kind)}</dd>
            </div>
          </dl>
          {spec.docsUrl && (
            <a href={spec.docsUrl} target="_blank" rel="noreferrer">
              Read the AWS documentation
            </a>
          )}
        </>
      )}
    </article>
  );
}
