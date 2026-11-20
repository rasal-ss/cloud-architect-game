import {
  type Board,
  type LeaderboardEntry,
  type ProgressRecord,
  type Repository,
  type SharedDesign,
  boardsFor,
  leaderboardSortKey,
} from './repository';

/** In-memory repository with the same semantics as DynamoDB, for tests and local development. */
export class MemoryRepository implements Repository {
  private readonly progress = new Map<string, ProgressRecord>();
  private readonly designs = new Map<string, SharedDesign>();
  private readonly boards = new Map<string, Map<string, LeaderboardEntry>>();

  async listProgress(playerId: string) {
    return [...this.progress.entries()].filter(([k]) => k.startsWith(`${playerId}|`)).map(([, v]) => v);
  }

  async getProgress(playerId: string, levelId: string) {
    return this.progress.get(`${playerId}|${levelId}`);
  }

  async saveBestResult(playerId: string, displayName: string, r: ProgressRecord, previous?: ProgressRecord) {
    const key = `${playerId}|${r.levelId}`;
    if (this.progress.get(key)?.updatedAt !== previous?.updatedAt) return false;
    this.progress.set(key, r);
    if (previous) {
      for (const b of boardsFor(previous))
        this.board(r.levelId, b).delete(leaderboardSortKey(b, previous, playerId));
    }
    for (const b of boardsFor(r)) {
      this.board(r.levelId, b).set(leaderboardSortKey(b, r, playerId), {
        playerId,
        displayName,
        stars: r.stars,
        score: r.score,
        costCents: r.costCents,
        updatedAt: r.updatedAt,
      });
    }
    return true;
  }

  async putDesign(d: SharedDesign) {
    this.designs.set(d.id, d);
  }

  async getDesign(id: string) {
    return this.designs.get(id);
  }

  async topEntries(levelId: string, board: Board, limit: number) {
    const b = this.board(levelId, board);
    return [...b.keys()]
      .sort()
      .slice(0, limit)
      .map((k) => b.get(k)!);
  }

  private board(levelId: string, board: Board) {
    const key = `${levelId}#${board}`;
    if (!this.boards.has(key)) this.boards.set(key, new Map());
    return this.boards.get(key)!;
  }
}
