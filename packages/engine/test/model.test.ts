import { describe, expect, it } from 'vitest';
import { Histogram, curveAt, loadMultiplier, spikeFactor } from '../src';
import { mix, percentileOfDist } from '../src/latency';

describe('loadMultiplier', () => {
  it('is nearly flat at low load and rises sharply past 80%', () => {
    expect(loadMultiplier(0.5)).toBeLessThan(1.2);
    const knee = loadMultiplier(0.95) - loadMultiplier(0.8);
    const flat = loadMultiplier(0.65) - loadMultiplier(0.5);
    expect(knee).toBeGreaterThan(flat * 5);
    expect(loadMultiplier(1.5)).toBeGreaterThan(loadMultiplier(1));
  });
});

describe('latency distributions', () => {
  it('keeps bimodal shapes, e.g. 90% cache hits at 2 ms and 10% misses at 50 ms', () => {
    const d = mix([
      { weight: 0.9, dist: [{ p: 1, ms: 2 }] },
      { weight: 0.1, dist: [{ p: 1, ms: 50 }] },
    ]);
    expect(percentileOfDist(d, 0.5)).toBe(2);
    expect(percentileOfDist(d, 0.95)).toBe(50);
  });

  it('histogram percentiles are within a bucket (5%) of the truth', () => {
    const h = new Histogram();
    for (let ms = 1; ms <= 100; ms++) h.add(ms, 1);
    expect(h.percentile(0.95)).toBeGreaterThan(90);
    expect(h.percentile(0.95)).toBeLessThan(100);
  });
});

describe('traffic', () => {
  const curve: [number, number][] = [
    [0, 0],
    [12, 1],
    [24, 0],
  ];
  it('interpolates the daily curve', () => {
    expect(curveAt(curve, 6 * 60)).toBeCloseTo(0.5);
    expect(curveAt(curve, 12 * 60)).toBe(1);
  });

  it('ramps, holds and decays a spike', () => {
    const spike = [
      {
        id: 's',
        type: 'traffic_spike' as const,
        atMinute: 100,
        multiplier: 10,
        rampMinutes: 4,
        holdMinutes: 10,
        warning: false,
        title: 'Spike',
        lesson: '',
      },
    ];
    expect(spikeFactor(spike, 99)).toBe(1);
    expect(spikeFactor(spike, 101)).toBeGreaterThan(1);
    expect(spikeFactor(spike, 101)).toBeLessThan(10);
    expect(spikeFactor(spike, 108)).toBe(10);
    expect(spikeFactor(spike, 200)).toBe(1);
  });
});
