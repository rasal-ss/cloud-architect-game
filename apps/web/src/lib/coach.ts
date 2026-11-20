import { useGame } from '../store/gameStore';
import { catalogue } from './catalogue';

/** The one instruction a new player needs right now, or null once the design is wired up. */
export function useCoachMessage(): string | null {
  const nodes = useGame((s) => s.nodes);
  const edges = useGame((s) => s.edges);
  const level = useGame((s) => s.level);
  const status = useGame((s) => s.status);
  if (status !== 'idle' || !level) return null;

  const users = nodes.find((n) => n.data.kind === 'users');
  if (nodes.length <= 1) {
    const first = level.palette[0];
    return first
      ? `Drag ${catalogue.get(first).shortName} from the left onto the canvas to begin.`
      : 'Drag a component onto the canvas to begin.';
  }
  if (users && !edges.some((e) => e.source === users.id)) {
    return `Now connect them: drag from the dot on the right of ${users.data.label ?? 'Customers'} to your component.`;
  }
  return null;
}
