import { services } from '@cloud-architect/content';
import { Catalogue, Simulation, type TickSnapshot } from '@cloud-architect/engine';
import type { WorkerRequest, WorkerResponse } from './protocol';

// The engine runs here, off the main thread, so the canvas stays smooth.
const catalogue = new Catalogue(services);
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: WorkerResponse) => void;
};

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type !== 'run') return;
  const start = performance.now();
  try {
    const sim = new Simulation(msg.design, msg.level, catalogue);
    const snapshots: TickSnapshot[] = [];
    const result = sim.run((s) => snapshots.push(s));
    ctx.postMessage({
      type: 'result',
      runId: msg.runId,
      snapshots,
      result,
      elapsedMs: performance.now() - start,
    });
  } catch (err) {
    ctx.postMessage({ type: 'error', runId: msg.runId, message: (err as Error).message });
  }
};
