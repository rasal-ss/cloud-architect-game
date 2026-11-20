import type { Design, Level } from '@cloud-architect/content';
import type { SimResult, TickSnapshot } from '@cloud-architect/engine';

export type WorkerRequest = { type: 'run'; runId: number; design: Design; level: Level };

export type WorkerResponse =
  | { type: 'result'; runId: number; snapshots: TickSnapshot[]; result: SimResult; elapsedMs: number }
  | { type: 'error'; runId: number; message: string };
