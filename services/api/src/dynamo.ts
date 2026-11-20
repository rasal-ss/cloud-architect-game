import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  type Board,
  type LeaderboardEntry,
  type ProgressRecord,
  type Repository,
  type SharedDesign,
  boardsFor,
  leaderboardSortKey,
} from './repository';

const playerPk = (id: string) => `PLAYER#${id}`;
const progressSk = (levelId: string) => `PROGRESS#${levelId}`;
const lbPk = (levelId: string, board: Board) => `LB#${levelId}#${board}`;

export class DynamoRepository implements Repository {
  private readonly db: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async listProgress(playerId: string): Promise<ProgressRecord[]> {
    const out = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': playerPk(playerId), ':sk': 'PROGRESS#' },
      }),
    );
    return (out.Items ?? []).map(toProgress);
  }

  async getProgress(playerId: string, levelId: string): Promise<ProgressRecord | undefined> {
    const out = await this.db.send(
      new GetCommand({ TableName: this.table, Key: { PK: playerPk(playerId), SK: progressSk(levelId) } }),
    );
    return out.Item ? toProgress(out.Item) : undefined;
  }

  async saveBestResult(
    playerId: string,
    displayName: string,
    r: ProgressRecord,
    previous: ProgressRecord | undefined,
  ): Promise<boolean> {
    const items: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']> = [
      {
        Put: {
          TableName: this.table,
          Item: { PK: playerPk(playerId), SK: progressSk(r.levelId), entity: 'progress', ...r },
          // Optimistic concurrency: only overwrite the version we read.
          ConditionExpression: previous ? 'updatedAt = :prev' : 'attribute_not_exists(PK)',
          ...(previous ? { ExpressionAttributeValues: { ':prev': previous.updatedAt } } : {}),
        },
      },
    ];
    if (previous) {
      for (const board of boardsFor(previous)) {
        items.push({
          Delete: {
            TableName: this.table,
            Key: { PK: lbPk(r.levelId, board), SK: leaderboardSortKey(board, previous, playerId) },
          },
        });
      }
    }
    for (const board of boardsFor(r)) {
      items.push({
        Put: {
          TableName: this.table,
          Item: {
            PK: lbPk(r.levelId, board),
            SK: leaderboardSortKey(board, r, playerId),
            entity: 'leaderboard',
            playerId,
            displayName,
            stars: r.stars,
            score: r.score,
            costCents: r.costCents,
            updatedAt: r.updatedAt,
          },
        },
      });
    }
    try {
      await this.db.send(new TransactWriteCommand({ TransactItems: items }));
      return true;
    } catch (err) {
      if ((err as Error).name === 'TransactionCanceledException') return false;
      throw err;
    }
  }

  async putDesign(d: SharedDesign): Promise<void> {
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          PK: `DESIGN#${d.id}`,
          SK: 'META',
          GSI1PK: playerPk(d.ownerId),
          GSI1SK: `DESIGN#${d.createdAt}`,
          entity: 'design',
          ...d,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async getDesign(id: string): Promise<SharedDesign | undefined> {
    const out = await this.db.send(
      new GetCommand({ TableName: this.table, Key: { PK: `DESIGN#${id}`, SK: 'META' } }),
    );
    if (!out.Item) return undefined;
    const { id: designId, ownerId, levelId, title, design, createdAt } = out.Item as SharedDesign;
    return { id: designId, ownerId, levelId, title, design, createdAt };
  }

  async topEntries(levelId: string, board: Board, limit: number): Promise<LeaderboardEntry[]> {
    const out = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': lbPk(levelId, board) },
        Limit: limit,
      }),
    );
    return (out.Items ?? []).map((i) => ({
      playerId: i.playerId as string,
      displayName: i.displayName as string,
      stars: i.stars as number,
      score: i.score as number,
      costCents: i.costCents as number,
      updatedAt: i.updatedAt as string,
    }));
  }
}

function toProgress(i: Record<string, unknown>): ProgressRecord {
  return {
    levelId: i.levelId as string,
    stars: i.stars as number,
    score: i.score as number,
    costCents: i.costCents as number,
    updatedAt: i.updatedAt as string,
  };
}
