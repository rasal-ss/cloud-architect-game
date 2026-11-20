import { z } from 'zod';
import actsJson from '../data/acts.json';
import conceptsJson from '../data/concepts.json';
import act1 from '../data/levels/act1.json';
import act2 from '../data/levels/act2.json';
import act3 from '../data/levels/act3.json';
import act4 from '../data/levels/act4.json';
import act5 from '../data/levels/act5.json';
import act6 from '../data/levels/act6.json';
import act7 from '../data/levels/act7.json';
import servicesJson from '../data/services.json';
import { Act, Catalogue, Concept, type Level, Level as LevelSchema } from './schemas';

export * from './schemas';

/** The service catalogue, validated at load time. */
export const services = Catalogue.parse(servicesJson);

/** Campaign levels, validated at load time. Invalid content fails fast in tests and CI. */
export const levels: Level[] = z
  .array(LevelSchema)
  .parse([...act1, ...act2, ...act3, ...act4, ...act5, ...act6, ...act7]);

export const acts: Act[] = z.array(Act).parse(actsJson);

/** The basics every player needs, shown first in the service guide. */
export const concepts: Concept[] = z.array(Concept).parse(conceptsJson);

export function getLevel(id: string): Level | undefined {
  return levels.find((l) => l.id === id);
}

export function levelsInAct(act: number): Level[] {
  return levels.filter((l) => l.act === act).sort((a, b) => a.index - b.index);
}
