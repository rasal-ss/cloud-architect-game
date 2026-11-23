const KEY = 'cag.course.v1';

/** Lesson ids the player has finished, kept in this browser. */
export function loadCompleted(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveCompleted(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage blocked: progress just isn't remembered.
  }
}
