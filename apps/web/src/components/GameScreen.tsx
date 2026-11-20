import { ReactFlowProvider } from '@xyflow/react';
import { useEffect } from 'react';
import { useGame } from '../store/gameStore';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { LevelIntro } from './LevelIntro';
import { Palette } from './Palette';
import { ReportCard } from './ReportCard';
import { RunDock } from './RunDock';
import { TopBar } from './TopBar';

/** Drives playback with requestAnimationFrame while a run is playing. */
function usePlayback() {
  const playing = useGame((s) => s.status === 'playing');
  const advance = useGame((s) => s.advance);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function loop(now) {
      advance(Math.min(0.1, (now - last) / 1000));
      last = now;
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, advance]);
}

export function GameScreen() {
  usePlayback();
  const togglePlay = useGame((s) => s.togglePlay);
  const toast = useGame((s) => s.toast);
  const notify = useGame((s) => s.notify);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(tag)) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => notify(null), 3500);
    return () => clearTimeout(t);
  }, [toast, notify]);

  return (
    <ReactFlowProvider>
      <div className="game">
        <TopBar />
        <div className="workspace">
          <Palette />
          <main className="stage">
            <Canvas />
            <RunDock />
          </main>
          <Inspector />
        </div>
        <ReportCard />
        <LevelIntro />
        {toast && (
          <div className="toast" role="alert">
            {toast}
          </div>
        )}
      </div>
    </ReactFlowProvider>
  );
}
