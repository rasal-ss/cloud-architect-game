import { type Design, getLevel, services } from '@cloud-architect/content';
import { Catalogue, simulate } from '@cloud-architect/engine';
import { HttpError } from './http';

const catalogue = new Catalogue(services);

/**
 * Re-runs the simulation on the server. The client only sends its design; stars, score and cost
 * are computed here with the same deterministic engine, so leaderboards cannot be forged.
 */
export function verifyRun(levelId: string, design: Design) {
  const level = getLevel(levelId);
  if (!level) throw new HttpError(404, `Unknown level ${levelId}`);
  const result = simulate(design, level, catalogue);
  if (!result.valid) throw new HttpError(422, `Invalid design: ${result.errors[0]}`);
  return {
    stars: result.stars,
    score: result.score,
    costCents: Math.round(result.metrics.monthlyCost * 100),
  };
}
