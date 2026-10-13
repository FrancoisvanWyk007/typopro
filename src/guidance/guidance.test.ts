import { describe, expect, it } from 'vitest';
import { GuidanceController } from './GuidanceController';
import { TimingBiasEstimator } from './TimingBiasEstimator';

describe('TimingBiasEstimator', () => {
  it('reports nothing until it has enough samples', () => {
    const e = new TimingBiasEstimator({ minSamples: 4 });
    [30, 30, 30].forEach((v) => e.add(v));
    expect(e.ready).toBe(false);
    expect(e.estimate()).toBe(0);
    e.add(30);
    expect(e.estimate()).toBe(30);
  });

  it('uses a trimmed mean that ignores outliers', () => {
    const e = new TimingBiasEstimator({ minSamples: 5, windowSize: 10, trimFraction: 0.2, maxBiasMs: 500 });
    [20, 22, 18, 21, 19, 20, 22, 18, 130, -120].forEach((v) => e.add(v));
    expect(e.estimate()).toBeCloseTo(20, 0);
  });

  it('only considers the most recent window of samples', () => {
    const e = new TimingBiasEstimator({ minSamples: 2, windowSize: 4, trimFraction: 0 });
    [-40, -40, -40, -40, 10, 10, 10, 10].forEach((v) => e.add(v));
    expect(e.estimate()).toBe(10);
    expect(e.sampleCount).toBe(4);
  });

  it('bounds the estimate', () => {
    const e = new TimingBiasEstimator({ minSamples: 2, maxBiasMs: 50 });
    [120, 120, 120].forEach((v) => e.add(v));
    expect(e.estimate()).toBe(50);
    e.reset();
    [-120, -120].forEach((v) => e.add(v));
    expect(e.estimate()).toBe(-50);
  });

  it('ignores non-finite samples', () => {
    const e = new TimingBiasEstimator({ minSamples: 1 });
    e.add(Number.NaN);
    e.add(Infinity);
    expect(e.sampleCount).toBe(0);
  });
});

describe('GuidanceController', () => {
  it('never shifts cues in fixed mode but still estimates bias', () => {
    const g = new GuidanceController('fixed', { minSamples: 3 });
    for (let i = 0; i < 5; i++) g.recordHit('left', 35);
    expect(g.cueShift('left')).toBe(0);
    expect(g.bias('left')).toMatchObject({ estimateMs: 35, ready: true });
  });

  it('keeps hands independent', () => {
    const g = new GuidanceController('adaptive', { minSamples: 3 });
    for (let i = 0; i < 5; i++) {
      g.recordHit('left', 30);
      g.recordHit('right', -20);
    }
    expect(g.cueShift('left')).toBe(30);
    expect(g.cueShift('right')).toBe(-20);
  });

  it('stays put for a player who follows the audio and ignores the cues', () => {
    const g = new GuidanceController('adaptive', { minSamples: 4, windowSize: 8 });
    for (let i = 0; i < 60; i++) g.recordHit('right', 12); // same habit whatever the cues do
    expect(g.cueShift('right')).toBe(12);
  });

  it('settles without oscillating for a player who follows the shifted cues', () => {
    // Presses 40ms after whatever cue is drawn; the cue is drawn `shift` ms early.
    const g = new GuidanceController('adaptive', { minSamples: 4, windowSize: 8, trimFraction: 0 });
    const shifts: number[] = [];
    for (let i = 0; i < 120; i++) {
      g.recordHit('right', 40 - g.cueShift('right'));
      shifts.push(g.cueShift('right'));
    }
    const tail = shifts.slice(-20);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(1);
    expect(tail.at(-1)).toBeCloseTo(20, 0); // half compensation by design
  });

  it('respects the bound', () => {
    const g = new GuidanceController('adaptive', { minSamples: 2, maxBiasMs: 25 });
    for (let i = 0; i < 20; i++) g.recordHit('left', 90);
    expect(g.cueShift('left')).toBe(25);
  });
});
