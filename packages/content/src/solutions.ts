import { z } from 'zod';
import act1 from '../data/solutions/act1.json';
import act2 from '../data/solutions/act2.json';
import act3 from '../data/solutions/act3.json';
import { Design } from './schemas';

/**
 * Reference solutions, one per level. The engine's test suite runs every one of them to prove
 * each level is solvable. They are kept out of the main entry point so the game does not ship them.
 */
export const solutions: Record<string, Design> = z
  .record(z.string(), Design)
  .parse({ ...act1, ...act2, ...act3 });
