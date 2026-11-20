import { SANDBOX_ID } from '../lib/sandbox';
import { useGame } from '../store/gameStore';
import { IconBack, IconBook, IconPlay, IconReplay } from './icons';

export function TopBar() {
  const level = useGame((s) => s.level);
  const status = useGame((s) => s.status);
  const run = useGame((s) => s.run);
  const backToMenu = useGame((s) => s.backToMenu);
  const openGuide = useGame((s) => s.openGuide);
  if (!level) return null;
  const hasRun = status !== 'idle' && status !== 'computing';

  return (
    <header className="topbar">
      <button className="icon-btn" onClick={backToMenu} aria-label="Back to levels" title="Back to levels">
        <IconBack />
      </button>
      <div className="topbar-title">
        <span className="eyebrow">
          {level.id === SANDBOX_ID ? 'Sandbox' : `Act ${level.act} · Level ${level.index}`}
        </span>
        <h1>{level.title.replace(/^Boss: /, '')}</h1>
      </div>
      <button className="btn ghost" onClick={() => openGuide()} title="What each component does">
        <IconBook />
        <span className="hide-sm">Guide</span>
      </button>
      <button className="btn primary" onClick={run} disabled={status === 'computing'}>
        {hasRun ? <IconReplay /> : <IconPlay />}
        {status === 'computing' ? (
          'Simulating…'
        ) : (
          <>
            Run<span className="hide-sm">{hasRun ? ' again' : ' the day'}</span>
          </>
        )}
      </button>
    </header>
  );
}
