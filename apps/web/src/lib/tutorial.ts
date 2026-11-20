import { type Level, type ServiceKind, levels } from '@cloud-architect/content';

/** Services a campaign level unlocks for the first time (not in any earlier level's palette). */
export function introducedKinds(level: Level): ServiceKind[] {
  const index = levels.findIndex((l) => l.id === level.id);
  if (index < 0) return [];
  const earlier = new Set(levels.slice(0, index).flatMap((l) => l.palette));
  return level.palette.filter((k) => !earlier.has(k));
}

export interface LevelIntro {
  howToPlay: boolean;
  kinds: ServiceKind[];
}

const SEEN_KEY = 'cag.seen.v1';

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function markSeen(ids: string[]): void {
  try {
    const seen = readSeen();
    for (const id of ids) seen.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    // Storage blocked: the intro will just show again next time.
  }
}

/** The intro to show when a level opens, or null if the player has seen everything in it. */
export function introFor(level: Level): LevelIntro | null {
  const seen = readSeen();
  const howToPlay = level.id === levels[0]?.id && !seen.has('how-to-play');
  const kinds = introducedKinds(level).filter((k) => !seen.has(`service:${k}`));
  return howToPlay || kinds.length ? { howToPlay, kinds } : null;
}
