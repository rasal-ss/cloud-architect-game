import { type ServiceKind, levels } from '@cloud-architect/content';
import { catalogue, money } from '../lib/catalogue';
import { Glyph } from './Glyph';

const CATEGORY_LABEL: Record<string, string> = {
  client: 'Traffic',
  compute: 'Compute',
  networking: 'Networking',
  database: 'Database',
  caching: 'Caching',
  storage: 'Storage',
};

export function unlockLabel(kind: ServiceKind): string {
  if (kind === 'users') return 'Every level';
  const level = levels.find((l) => l.palette.includes(kind as never));
  return level ? `Level ${level.id} · ${level.title.replace(/^Boss: /, '')}` : 'Sandbox now · campaign Act 4';
}

/** Everything a newcomer needs to know about one service. `compact` drops the reference details. */
export function ServiceCard({ kind, compact = false }: { kind: ServiceKind; compact?: boolean }) {
  const spec = catalogue.get(kind);
  const connects = spec.connectsTo.map((k) => catalogue.get(k).shortName);

  return (
    <article className="service-card">
      <header>
        <Glyph kind={kind} size="lg" />
        <div>
          <span className="eyebrow">{CATEGORY_LABEL[spec.category]}</span>
          <h3>{spec.name}</h3>
        </div>
      </header>

      <p className="analogy">{spec.analogy}</p>

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
          {spec.sizes ? (
            <section>
              <h4>Sizes</h4>
              <table className="sizes">
                <thead>
                  <tr>
                    <th>Size</th>
                    <th>Work / second</th>
                    <th>Per month</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.sizes.map((s) => (
                    <tr key={s.id}>
                      <td>{s.id}</td>
                      <td>{s.capacity.toLocaleString()}</td>
                      <td>{money(s.monthlyCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : (
            kind !== 'users' && (
              <section>
                <h4>Price</h4>
                <p>
                  {spec.monthlyCost > 0 ? `${money(spec.monthlyCost)} per month` : 'No fixed cost'}
                  {spec.perMillionRequests > 0 && ` + ${money(spec.perMillionRequests)} per million requests`}
                </p>
              </section>
            )
          )}
          <dl className="card-facts">
            <div>
              <dt>Sends requests to</dt>
              <dd>{connects.length ? connects.join(', ') : 'Nothing: requests end here'}</dd>
            </div>
            <div>
              <dt>First appears</dt>
              <dd>{unlockLabel(kind)}</dd>
            </div>
          </dl>
          {spec.docsUrl && (
            <a href={spec.docsUrl} target="_blank" rel="noreferrer">
              Read the AWS documentation ↗
            </a>
          )}
        </>
      )}
    </article>
  );
}
