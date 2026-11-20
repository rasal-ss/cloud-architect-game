/**
 * Latency distributions are small arrays of {p, ms} points (probability mass at a latency).
 * They let the engine keep real bimodal shapes, such as cache hits vs misses or CDN edge vs
 * origin, without simulating individual requests.
 */
export interface Point {
  p: number;
  ms: number;
}
export type Dist = Point[];

const MAX_POINTS = 24;

export function shift(dist: Dist, ms: number): Dist {
  return dist.map((pt) => ({ p: pt.p, ms: pt.ms + ms }));
}

/** Mixes weighted distributions into one normalised distribution, compressed to MAX_POINTS. */
export function mix(parts: { weight: number; dist: Dist }[]): Dist {
  const total = parts.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return [];
  const out: Point[] = [];
  for (const part of parts) {
    if (part.weight <= 0) continue;
    for (const pt of part.dist) out.push({ p: (pt.p * part.weight) / total, ms: pt.ms });
  }
  return compress(out);
}

export function compress(points: Point[]): Dist {
  const pts = points.filter((x) => x.p > 0).sort((a, b) => a.ms - b.ms);
  while (pts.length > MAX_POINTS) {
    // Merge the two neighbours with the smallest relative gap.
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const gap = (pts[i + 1]!.ms - pts[i]!.ms) / Math.max(1, pts[i]!.ms);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    const a = pts[best]!;
    const b = pts[best + 1]!;
    const p = a.p + b.p;
    pts.splice(best, 2, { p, ms: (a.ms * a.p + b.ms * b.p) / p });
  }
  return pts;
}

/** Distribution of the sum of two independent latencies (one call after another). */
export function convolve(a: Dist, b: Dist): Dist {
  if (!a.length) return b;
  if (!b.length) return a;
  const out: Point[] = [];
  for (const x of a) for (const y of b) out.push({ p: x.p * y.p, ms: x.ms + y.ms });
  return compress(out);
}

export function percentileOfDist(dist: Dist, q: number): number {
  let acc = 0;
  for (const pt of dist) {
    acc += pt.p;
    if (acc >= q - 1e-9) return pt.ms;
  }
  return dist.length ? dist[dist.length - 1]!.ms : 0;
}

/**
 * Log-bucketed histogram for whole-run percentiles. Buckets are ~5% wide between 0.5 ms and 60 s.
 */
export class Histogram {
  private static readonly MIN = 0.5;
  private static readonly RATIO = 1.05;
  private readonly buckets: Float64Array;
  total = 0;

  constructor() {
    const n = Math.ceil(Math.log(60_000 / Histogram.MIN) / Math.log(Histogram.RATIO)) + 1;
    this.buckets = new Float64Array(n);
  }

  add(ms: number, weight: number): void {
    if (weight <= 0 || !Number.isFinite(weight)) return;
    const idx = Math.min(
      this.buckets.length - 1,
      Math.max(
        0,
        Math.floor(Math.log(Math.max(ms, Histogram.MIN) / Histogram.MIN) / Math.log(Histogram.RATIO)),
      ),
    );
    this.buckets[idx]! += weight;
    this.total += weight;
  }

  addDist(dist: Dist, weight: number): void {
    for (const pt of dist) this.add(pt.ms, pt.p * weight);
  }

  percentile(q: number): number {
    if (this.total <= 0) return 0;
    const target = q * this.total;
    let acc = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      acc += this.buckets[i]!;
      if (acc >= target) return Histogram.MIN * Math.pow(Histogram.RATIO, i + 0.5);
    }
    return 60_000;
  }
}

/**
 * Queueing multiplier on a node's own latency. Roughly flat below 80% load, then rises
 * sharply (an M/M/c-style knee), and keeps growing while requests queue above 100%.
 */
export function loadMultiplier(util: number): number {
  const u = Math.max(0, util);
  let m = 1 + 0.3 * Math.min(u, 1);
  if (u > 0.8) m += 25 * Math.pow(Math.min(u, 1) - 0.8, 2);
  if (u > 1) m += 2 * Math.min(u - 1, 2);
  return m;
}
