import { Design, getLevel } from '@cloud-architect/content';
import { z } from 'zod';
import { DynamoRepository } from '../dynamo';
import { type Handler, HttpError, body, displayName, json, playerId, router } from '../http';
import { type Repository, isBetter } from '../repository';
import { verifyRun } from '../verify';

const SubmitBody = z.object({ design: Design });

export function createProgressHandler(repo: Repository, now = () => new Date()): Handler {
  return router({
    'GET /progress': async (event) => {
      const items = await repo.listProgress(playerId(event));
      return json(200, { progress: items });
    },

    'PUT /progress/{levelId}': async (event) => {
      const player = playerId(event);
      const levelId = event.pathParameters?.levelId ?? '';
      if (!getLevel(levelId)) throw new HttpError(404, `Unknown level ${levelId}`);
      const { design } = SubmitBody.parse(body(event));
      const verified = verifyRun(levelId, design);
      const record = { levelId, ...verified, updatedAt: now().toISOString() };

      const previous = await repo.getProgress(player, levelId);
      if (!isBetter(record, previous)) {
        return json(200, { saved: false, best: previous, result: record });
      }
      const saved = await repo.saveBestResult(player, displayName(event), record, previous);
      if (!saved) throw new HttpError(409, 'Progress changed while saving, please retry');
      return json(200, { saved: true, best: record, result: record });
    },
  });
}

let instance: Handler | undefined;
export const handler: Handler = (event) => {
  instance ??= createProgressHandler(new DynamoRepository(process.env.TABLE_NAME!));
  return instance(event);
};
