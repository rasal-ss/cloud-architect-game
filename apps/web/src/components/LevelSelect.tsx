import { acts, levels, levelsInAct } from '@cloud-architect/content';
import { useGame } from '../store/gameStore';
import { IconArrow, Stars } from './icons';

export function LevelSelect() {
  const progress = useGame((s) => s.progress);
  const openLevel = useGame((s) => s.openLevel);
  const openSandbox = useGame((s) => s.openSandbox);
  const totalStars = Object.values(progress).reduce((s, p) => s + p.stars, 0);
  const next =
    levels.find((l) => !progress[l.id]?.stars) ??
    levels.find((l) => (progress[l.id]?.stars ?? 0) < 3) ??
    levels[0]!;
  const started = totalStars > 0;

  return (
    <div className="menu">
      <header className="menu-bar">
        <span className="wordmark">
          <Logo /> Cloud Architect
        </span>
        <span className="menu-stars" title="Stars earned">
          <Stars count={1} size={13} label={false} /> {totalStars} / {levels.length * 3}
        </span>
      </header>

      <section className="hero">
        <h1>
          Scale <em>or fail.</em>
        </h1>
        <p className="lead">
          Design AWS architectures for a growing startup. Each level gives you a budget and a day of real
          traffic, and something will break. Build it so it doesn’t.
        </p>
        <div className="hero-actions">
          <button className="btn primary lg" onClick={() => openLevel(next.id)}>
            {started ? 'Continue' : 'Start'} · {next.title.replace(/^Boss: /, '')}
            <IconArrow />
          </button>
          <button className="btn ghost lg" onClick={openSandbox}>
            Open sandbox
          </button>
        </div>
      </section>

      {acts.map((act) => (
        <section key={act.act} className="act">
          <div className="act-head">
            <span className="act-num">Act {act.act}</span>
            <h2>{act.title}</h2>
            <p>
              {act.stage} · {act.scale}
            </p>
          </div>
          <ol className="level-row">
            {levelsInAct(act.act).map((l) => {
              const stars = progress[l.id]?.stars ?? 0;
              return (
                <li key={l.id}>
                  <button
                    className={`level-tile${l.boss ? ' boss' : ''}${l.id === next.id ? ' next' : ''}`}
                    onClick={() => openLevel(l.id)}
                  >
                    <span className="tile-id">{l.boss ? 'Boss' : l.id}</span>
                    <span className="tile-title">{l.title.replace(/^Boss: /, '')}</span>
                    <Stars count={stars} size={12} />
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <footer className="menu-foot">
        Prices and capacities are simplified for gameplay. Nothing here touches a real AWS account.
      </footer>
    </div>
  );
}

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="logo">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" />
      <path
        d="M6 15.5h3.5l2-6 2.5 9 2-4.5H18"
        stroke="#f4f2ec"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
