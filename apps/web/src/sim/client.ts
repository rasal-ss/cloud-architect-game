import type { Design, Level } from '@cloud-architect/content';
import type { WorkerResponse } from './protocol';

type Done = Extract<WorkerResponse, { type: 'result' }>;

let worker: Worker | undefined;
let runCounter = 0;

/** Runs a full simulated day in the Web Worker and resolves with every tick snapshot. */
export function runSimulation(design: Design, level: Level): Promise<Done> {
  worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const runId = ++runCounter;
  const w = worker;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.runId !== runId) return;
      w.removeEventListener('message', onMessage);
      if (e.data.type === 'result') resolve(e.data);
      else reject(new Error(e.data.message));
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'run', runId, design, level });
  });
}
