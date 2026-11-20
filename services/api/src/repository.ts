import type { Design } from '@cloud-architect/content';

/**
 * Storage interface for the API. The DynamoDB implementation uses a single table:
 *
 * | Entity            | PK                         | SK                              | GSI1PK        | GSI1SK              |
 * | ----------------- | -------------------------- | ------------------------------- | ------------- | ------------------- |
 * | Level progress    | PLAYER#<playerId>          | PROGRESS#<levelId>              |               |                     |
 * | Shared design     | DESIGN#<designId>          | META                            | PLAYER#<id>   | DESIGN#<createdAt>  |
 * | Leaderboard entry | LB#<levelId>#<board>       | <sortable rank>#<playerId>      |               |                     |
 *
 * Access patterns:
 * 1. Get all progress for a player:            Query PK = PLAYER#id, SK begins_with PROGRESS#
 * 2. Save a better result for a level:          TransactWrite (progress + leaderboard rows, conditional)
 * 3. Load a shared design by id:                GetItem PK = DESIGN#id, SK = META
 * 4. List a player's shared designs:            Query GSI1 PK = PLAYER#id, SK begins_with DESIGN#
 * 5. Top N for a level, by score or by cost:    Query PK = LB#level#board (sort keys sort ascending)
 */

export interface ProgressRecord {
  levelId: string;
  stars: number;
  score: number;
  /** Monthly cost in cents (integers sort and compare exactly). */
  costCents: number;
  updatedAt: string;
}

export interface SharedDesign {
  id: string;
  ownerId: string;
  levelId: string;
  title: string;
  design: Design;
  createdAt: string;
}

export type Board = 'score' | 'cost';

export interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  stars: number;
  score: number;
  costCents: number;
  updatedAt: string;
}

export interface Repository {
  listProgress(playerId: string): Promise<ProgressRecord[]>;
  getProgress(playerId: string, levelId: string): Promise<ProgressRecord | undefined>;
  /**
   * Stores a result if it beats the previous best, and moves the player's leaderboard rows.
   * Returns false if an equal or better result was already stored.
   */
  saveBestResult(
    playerId: string,
    displayName: string,
    record: ProgressRecord,
    previous: ProgressRecord | undefined,
  ): Promise<boolean>;
  putDesign(design: SharedDesign): Promise<void>;
  getDesign(id: string): Promise<SharedDesign | undefined>;
  topEntries(levelId: string, board: Board, limit: number): Promise<LeaderboardEntry[]>;
}

/** True if `next` should replace `prev`: more stars, then higher score, then cheaper. */
export function isBetter(next: ProgressRecord, prev: ProgressRecord | undefined): boolean {
  if (!prev) return true;
  if (next.stars !== prev.stars) return next.stars > prev.stars;
  if (next.score !== prev.score) return next.score > prev.score;
  return next.costCents < prev.costCents;
}

/**
 * Leaderboard sort keys. DynamoDB sorts strings ascending, so the score board stores an inverted,
 * zero-padded score (best first) and the cost board stores zero-padded cents (cheapest first).
 */
export function leaderboardSortKey(board: Board, r: ProgressRecord, playerId: string): string {
  const pad = (n: number, w: number) => String(Math.max(0, Math.round(n))).padStart(w, '0');
  if (board === 'score')
    return `${pad(3 - r.stars, 1)}#${pad(100 - r.score, 3)}#${pad(r.costCents, 10)}#${playerId}`;
  return `${pad(r.costCents, 10)}#${pad(100 - r.score, 3)}#${playerId}`;
}

/** Only passing runs (1+ stars) appear on the cheapest-design board. */
export const boardsFor = (r: ProgressRecord): Board[] => (r.stars > 0 ? ['score', 'cost'] : ['score']);
