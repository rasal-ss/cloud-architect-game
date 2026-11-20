import { z } from 'zod';
import actsJson from '../data/acts.json';
import act1 from '../data/levels/act1.json';
import act2 from '../data/levels/act2.json';
import act3 from '../data/levels/act3.json';
import servicesJson from '../data/services.json';
import { Act, Catalogue, type Level, Level as LevelSchema } from './schemas';

export * from './schemas';

/** The service catalogue, validated at load time. */
export const services = Catalogue.parse(servicesJson);

/** Campaign levels, validated at load time. Invalid content fails fast in tests and CI. */
export const levels: Level[] = z.array(LevelSchema).parse([...act1, ...act2, ...act3]);

export const acts: Act[] = z.array(Act).parse(actsJson);

export function getLevel(id: string): Level | undefined {
  return levels.find((l) => l.id === id);
}

export function levelsInAct(act: number): Level[] {
  return levels.filter((l) => l.act === act).sort((a, b) => a.index - b.index);
}
