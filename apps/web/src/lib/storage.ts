import { Design } from '@cloud-architect/content';

/**
 * Progress and designs are stored in the browser for Phase 1. Every access is wrapped because
 * storage can be unavailable (private mode, blocked site data). The cloud backend in
 * services/api takes over this job in the "cloud backend launch" phase.
 */
export interface LevelProgress {
  stars: number;
  score: number;
  cost: number;
}

const PROGRESS_KEY = 'cag.progress.v1';
const designKey = (levelId: string) => `cag.design.v1.${levelId}`;

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the game still works, progress just isn't kept.
  }
}

export function loadProgress(): Record<string, LevelProgress> {
  return read<Record<string, LevelProgress>>(PROGRESS_KEY) ?? {};
}

/** Keeps the best result per level. Returns the updated map. */
export function recordResult(levelId: string, result: LevelProgress): Record<string, LevelProgress> {
  const all = loadProgress();
  const prev = all[levelId];
  if (!prev || result.stars > prev.stars || (result.stars === prev.stars && result.score > prev.score)) {
    all[levelId] = result;
    write(PROGRESS_KEY, all);
  }
  return all;
}

export function loadDesign(levelId: string): Design | undefined {
  const parsed = Design.safeParse(read(designKey(levelId)));
  return parsed.success ? parsed.data : undefined;
}

export function saveDesign(levelId: string, design: Design | null): void {
  write(designKey(levelId), design);
}
