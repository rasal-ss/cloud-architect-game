import { GameScreen } from './components/GameScreen';
import { LevelSelect } from './components/LevelSelect';
import { useGame } from './store/gameStore';

export function App() {
  const screen = useGame((s) => s.screen);
  return screen === 'menu' ? <LevelSelect /> : <GameScreen />;
}
