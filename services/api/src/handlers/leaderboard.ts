import { getLevel } from '@cloud-architect/content';
import { z } from 'zod';
import { DynamoRepository } from '../dynamo';
import { type Handler, HttpError, json, router } from '../http';
import type { Repository } from '../repository';

const Query = z.object({
  board: z.enum(['score', 'cost']).default('score'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function createLeaderboardHandler(repo: Repository): Handler {
  return router({
    'GET /leaderboard/{levelId}': async (event) => {
      const levelId = event.pathParameters?.levelId ?? '';
      if (!getLevel(levelId)) throw new HttpError(404, `Unknown level ${levelId}`);
      const { board, limit } = Query.parse(event.queryStringParameters ?? {});
      const entries = await repo.topEntries(levelId, board, limit);
      return {
        ...json(200, {
          levelId,
          board,
          entries: entries.map((e, i) => ({
            rank: i + 1,
            name: e.displayName,
            stars: e.stars,
            score: e.score,
            monthlyCost: e.costCents / 100,
          })),
        }),
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=30' },
      };
    },

    'GET /health': async () => json(200, { ok: true }),
  });
}

let instance: Handler | undefined;
export const handler: Handler = (event) => {
  instance ??= createLeaderboardHandler(new DynamoRepository(process.env.TABLE_NAME!));
  return instance(event);
};
