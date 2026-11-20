import type { Incident, Traffic } from '@cloud-architect/content';

export const MINUTES_PER_DAY = 1440;

/** Fraction of peak traffic at a minute of the day, by linear interpolation of the curve. */
export function curveAt(curve: Traffic['curve'], minute: number): number {
  const h = minute / 60;
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (h <= first[0]) return first[1];
  if (h >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [h1, v1] = curve[i]!;
    if (h <= h1) {
      const [h0, v0] = curve[i - 1]!;
      return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
    }
  }
  return last[1];
}

/** Combined traffic multiplier from all spikes active at this minute. */
export function spikeFactor(incidents: readonly Incident[], minute: number): number {
  let factor = 1;
  for (const inc of incidents) {
    if (inc.type !== 'traffic_spike') continue;
    const t = minute - inc.atMinute;
    if (t < 0) continue;
    const ramp = Math.max(1, inc.rampMinutes);
    const decay = Math.max(5, inc.rampMinutes);
    let f: number;
    if (t < inc.rampMinutes) f = 1 + ((inc.multiplier - 1) * (t + 1)) / ramp;
    else if (t < inc.rampMinutes + inc.holdMinutes) f = inc.multiplier;
    else {
      const d = t - inc.rampMinutes - inc.holdMinutes;
      if (d >= decay) continue;
      f = inc.multiplier - ((inc.multiplier - 1) * (d + 1)) / decay;
    }
    factor *= f;
  }
  return factor;
}

export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
