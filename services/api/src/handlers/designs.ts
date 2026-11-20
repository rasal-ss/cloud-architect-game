import { Design, getLevel } from '@cloud-architect/content';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DynamoRepository } from '../dynamo';
import { type Handler, HttpError, body, json, playerId, router } from '../http';
import type { Repository } from '../repository';

const CreateBody = z.object({
  levelId: z.string().regex(/^\d+-\d+$/),
  title: z.string().trim().min(1).max(60),
  design: Design,
});

const ID = /^[A-Za-z0-9_-]{12}$/;

export function createDesignsHandler(repo: Repository, now = () => new Date()): Handler {
  return router({
    /** Share a design by link (read-only for everyone else). */
    'POST /designs': async (event) => {
      const ownerId = playerId(event);
      const input = CreateBody.parse(body(event));
      if (!getLevel(input.levelId)) throw new HttpError(404, `Unknown level ${input.levelId}`);
      const id = randomBytes(9).toString('base64url');
      await repo.putDesign({ id, ownerId, ...input, createdAt: now().toISOString() });
      return json(201, { id });
    },

    'GET /designs/{id}': async (event) => {
      const id = event.pathParameters?.id ?? '';
      if (!ID.test(id)) throw new HttpError(404, 'Design not found');
      const design = await repo.getDesign(id);
      if (!design) throw new HttpError(404, 'Design not found');
      const { ownerId: _owner, ...publicFields } = design;
      return json(200, publicFields);
    },
  });
}

let instance: Handler | undefined;
export const handler: Handler = (event) => {
  instance ??= createDesignsHandler(new DynamoRepository(process.env.TABLE_NAME!));
  return instance(event);
};
