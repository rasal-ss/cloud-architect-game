import { levels } from '@cloud-architect/content';
import { solutions } from '@cloud-architect/content/solutions';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDesignsHandler } from '../src/handlers/designs';
import { createLeaderboardHandler } from '../src/handlers/leaderboard';
import { createProgressHandler } from '../src/handlers/progress';
import type { ApiEvent } from '../src/http';
import { MemoryRepository } from '../src/memory';
import { leaderboardSortKey } from '../src/repository';

function event(
  routeKey: string,
  opts: {
    sub?: string;
    name?: string;
    path?: Record<string, string>;
    body?: unknown;
    query?: Record<string, string>;
  } = {},
): ApiEvent {
  return {
    routeKey,
    pathParameters: opts.path,
    queryStringParameters: opts.query,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      authorizer: opts.sub
        ? {
            jwt: {
              claims: { sub: opts.sub, ...(opts.name ? { preferred_username: opts.name } : {}) },
              scopes: [],
            },
          }
        : undefined,
    },
  } as unknown as ApiEvent;
}

const parse = (r: { body?: string }) => JSON.parse(r.body ?? '{}');
const level = levels[0]!;
const goodDesign = solutions[level.id]!;

describe('API', () => {
  let repo: MemoryRepository;
  let progress: ReturnType<typeof createProgressHandler>;
  let leaderboard: ReturnType<typeof createLeaderboardHandler>;
  let designs: ReturnType<typeof createDesignsHandler>;

  beforeEach(() => {
    repo = new MemoryRepository();
    let t = 0;
    const clock = () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++));
    progress = createProgressHandler(repo, clock);
    leaderboard = createLeaderboardHandler(repo);
    designs = createDesignsHandler(repo, clock);
  });

  it('requires sign-in for progress', async () => {
    const r = await progress(event('GET /progress'));
    expect(r.statusCode).toBe(401);
  });

  it('scores submissions on the server, ignoring any score the client claims', async () => {
    const r = await progress(
      event('PUT /progress/{levelId}', {
        sub: 'alice',
        path: { levelId: level.id },
        body: { design: goodDesign, stars: 3, score: 100 },
      }),
    );
    expect(r.statusCode).toBe(200);
    const b = parse(r);
    expect(b.saved).toBe(true);
    expect(b.best.stars).toBe(3);
    expect(b.best.score).toBeLessThan(100);
  });

  it('keeps only the best result and updates the leaderboard', async () => {
    const put = (design: unknown) =>
      progress(
        event('PUT /progress/{levelId}', {
          sub: 'alice',
          name: 'Alice',
          path: { levelId: level.id },
          body: { design },
        }),
      );
    await put(level.startingDesign); // fails: 0 stars
    await put(goodDesign); // 3 stars
    const again = parse(await put(level.startingDesign));
    expect(again.saved).toBe(false);

    const list = parse(await progress(event('GET /progress', { sub: 'alice' })));
    expect(list.progress).toHaveLength(1);
    expect(list.progress[0].stars).toBe(3);

    const board = parse(
      await leaderboard(event('GET /leaderboard/{levelId}', { path: { levelId: level.id } })),
    );
    expect(board.entries).toHaveLength(1);
    expect(board.entries[0]).toMatchObject({ rank: 1, name: 'Alice', stars: 3 });
  });

  it('ranks by stars, then score, then cost; and by cost on the cost board', async () => {
    const a = { levelId: '1-1', stars: 3, score: 90, costCents: 1500, updatedAt: 'x' };
    const b = { ...a, score: 95, costCents: 2000 };
    const c = { ...a, stars: 2, score: 99, costCents: 100 };
    const keys = [a, b, c].map((r, i) => leaderboardSortKey('score', r, `p${i}`)).sort();
    expect(keys.map((k) => k.split('#').pop())).toEqual(['p1', 'p0', 'p2']);
    const costKeys = [a, b, c].map((r, i) => leaderboardSortKey('cost', r, `p${i}`)).sort();
    expect(costKeys.map((k) => k.split('#').pop())).toEqual(['p2', 'p0', 'p1']);
  });

  it('rejects invalid designs and unknown levels', async () => {
    const bad = await progress(
      event('PUT /progress/{levelId}', {
        sub: 'a',
        path: { levelId: level.id },
        body: { design: { nodes: 'x' } },
      }),
    );
    expect(bad.statusCode).toBe(400);
    const unknown = await progress(
      event('PUT /progress/{levelId}', { sub: 'a', path: { levelId: '99-1' }, body: { design: goodDesign } }),
    );
    expect(unknown.statusCode).toBe(404);
  });

  it('shares designs by id without exposing the owner', async () => {
    const created = await designs(
      event('POST /designs', {
        sub: 'bob',
        body: { levelId: level.id, title: 'My design', design: goodDesign },
      }),
    );
    expect(created.statusCode).toBe(201);
    const { id } = parse(created);
    const fetched = await designs(event('GET /designs/{id}', { path: { id } }));
    expect(fetched.statusCode).toBe(200);
    const body = parse(fetched);
    expect(body.title).toBe('My design');
    expect(body.ownerId).toBeUndefined();
    expect((await designs(event('GET /designs/{id}', { path: { id: 'nope' } }))).statusCode).toBe(404);
  });

  it('returns 404 for unknown routes', async () => {
    expect((await leaderboard(event('DELETE /everything'))).statusCode).toBe(404);
  });
});
