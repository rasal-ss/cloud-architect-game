import { acts, levelsInAct } from '@cloud-architect/content';
import { money } from '../lib/catalogue';
import { useGame } from '../store/gameStore';

export function LevelSelect() {
  const progress = useGame((s) => s.progress);
  const openLevel = useGame((s) => s.openLevel);
  const openSandbox = useGame((s) => s.openSandbox);
  const totalStars = Object.values(progress).reduce((s, p) => s + p.stars, 0);

  return (
    <main className="menu">
      <header className="hero">
        <p className="eyebrow">A browser puzzle game about AWS architecture</p>
        <h1>
          Cloud Architect: <span>Scale or Fail</span>
        </h1>
        <p className="lead">
          Design, scale and rescue real AWS architectures for NimbusCart, a grocery-delivery startup. Every
          level has a budget, a traffic curve and failures that will happen. Build something that survives.
        </p>
        <div className="hero-stats">
          <span>
            ★ {totalStars} / {acts.length * 15}
          </span>
          <button className="btn" onClick={openSandbox}>
            Open sandbox
          </button>
        </div>
      </header>

      {acts.map((act) => (
        <section key={act.act} className="act">
          <header>
            <h2>
              Act {act.act}: {act.title}
            </h2>
            <span className="muted">
              {act.stage} · {act.scale}
            </span>
          </header>
          <div className="level-grid">
            {levelsInAct(act.act).map((l) => {
              const p = progress[l.id];
              return (
                <button
                  key={l.id}
                  className={`level-card ${l.boss ? 'boss' : ''}`}
                  onClick={() => openLevel(l.id)}
                >
                  <span className="level-num">{l.boss ? 'BOSS' : `${l.act}-${l.index}`}</span>
                  <strong>{l.title.replace(/^Boss: /, '')}</strong>
                  <span className="muted small">
                    Budget {money(l.budget)} · peak {l.traffic.peakRps.toLocaleString()} req/s
                  </span>
                  <span className="stars small" aria-label={`${p?.stars ?? 0} of 3 stars`}>
                    {[1, 2, 3].map((i) => (
                      <span key={i} className={p && i <= p.stars ? 'on' : ''}>
                        ★
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <footer className="menu-foot muted small">
        In-game prices and capacities are tuned for gameplay and are approximate. The game never touches a
        real AWS account. Coming next: Acts 4-15, Data Architect mode and Export to Terraform.
      </footer>
    </main>
  );
}
