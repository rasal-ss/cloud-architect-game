import { useEffect } from 'react';
import { Course } from './components/Course';
import { GameScreen } from './components/GameScreen';
import { Guide } from './components/Guide';
import { LevelSelect } from './components/LevelSelect';
import { useGame } from './store/gameStore';

export function App() {
  const screen = useGame((s) => s.screen);
  const levelId = useGame((s) => s.level?.id);
  // Each screen starts at the top, not at the previous screen's scroll position.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen, levelId]);
  return (
    <>
      {screen === 'menu' ? <LevelSelect /> : screen === 'course' ? <Course /> : <GameScreen />}
      <Guide />
    </>
  );
}
