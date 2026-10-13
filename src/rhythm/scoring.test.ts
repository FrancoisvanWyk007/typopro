import { describe, expect, it } from 'vitest';
import { ev } from '../test/factories';
import { RhythmEngine } from './RhythmEngine';
import { ScoreTracker, gainForScore, gradeFor } from './scoring';

const hands = { left: 'bass', right: 'keys' } as const;
const config = { alpha: 0.25, strayAlpha: 0.1, initialScore: 0.5 };

describe('ScoreTracker', () => {
  it('raises an instrument score on hits and lowers it on misses', () => {
    const t = new ScoreTracker(['bass', 'keys'], hands, config);
    const e = ev(1000, 'left', 'a');
    t.apply({ kind: 'hit', grade: 'perfect', event: e, offsetMs: 0, inputTimeMs: 1000 });
    expect(t.instrumentScore('bass')).toBeCloseTo(0.625);
    t.apply({ kind: 'miss', event: ev(2000, 'left', 's') });
    expect(t.instrumentScore('bass')).toBeCloseTo(0.46875);
    expect(t.instrumentScore('keys')).toBe(0.5);
  });

  it('lowers scores through clock-driven misses with no keyboard input at all', () => {
    const events = [1000, 1600, 2200, 2800].map((t) => ev(t, 'right', 'j'));
    const engine = new RhythmEngine(events);
    const t = new ScoreTracker(['bass', 'keys'], hands, config);
    const before = t.instrumentScore('keys');
    for (const j of engine.advance(10_000)) t.apply(j);
    expect(t.instrumentScore('keys')).toBeLessThan(before * 0.4);
    expect(t.summary().counts.miss).toBe(4);
    expect(t.summary().accuracy).toBe(0);
  });

  it('tracks combo, max combo and weighted accuracy', () => {
    const t = new ScoreTracker(['bass', 'keys'], hands, config);
    const hit = (grade: 'perfect' | 'great' | 'good') =>
      t.apply({ kind: 'hit', grade, event: ev(0, 'left', 'a'), offsetMs: 10, inputTimeMs: 0 });
    hit('perfect');
    hit('great');
    hit('good');
    t.apply({ kind: 'wrong', event: ev(0, 'right', 'j'), offsetMs: 0, inputTimeMs: 0, typed: 'k' });
    hit('perfect');
    const s = t.summary();
    expect(s.combo).toBe(1);
    expect(s.maxCombo).toBe(3);
    expect(s.accuracy).toBeCloseTo((1 + 0.85 + 0.6 + 0 + 1) / 5);
    expect(s.hands.left.meanOffsetMs).toBe(10);
    expect(s.hands.right.accuracy).toBe(0);
  });

  it('penalizes stray keystrokes on the hand instrument without breaking combo or accuracy', () => {
    const t = new ScoreTracker(['bass', 'keys'], hands, config);
    t.apply({ kind: 'hit', grade: 'perfect', event: ev(0, 'right', 'j'), offsetMs: 0, inputTimeMs: 0 });
    const before = t.instrumentScore('keys');
    t.apply({ kind: 'stray', hand: 'right', inputTimeMs: 500, typed: 'k' });
    expect(t.instrumentScore('keys')).toBeLessThan(before);
    expect(t.summary()).toMatchObject({ combo: 1, judged: 1, accuracy: 1 });
    expect(t.summary().counts.stray).toBe(1);
  });

  it('resets to the initial state', () => {
    const t = new ScoreTracker(['bass', 'keys'], hands, config);
    t.apply({ kind: 'miss', event: ev(0, 'left', 'a') });
    t.reset();
    expect(t.instrumentScore('bass')).toBe(0.5);
    expect(t.summary()).toMatchObject({ judged: 0, accuracy: null, combo: 0, maxCombo: 0 });
  });
});

describe('gainForScore', () => {
  it('is monotonic, bounded and keeps a floor', () => {
    expect(gainForScore(0)).toBeCloseTo(0.05);
    expect(gainForScore(1)).toBe(1);
    expect(gainForScore(2)).toBe(1);
    expect(gainForScore(-1)).toBeCloseTo(0.05);
    let prev = 0;
    for (let s = 0; s <= 1; s += 0.05) {
      expect(gainForScore(s)).toBeGreaterThanOrEqual(prev);
      prev = gainForScore(s);
    }
  });

  it('maps accuracy to grades', () => {
    expect(gradeFor(null)).toBe('–');
    expect(gradeFor(0.97)).toBe('S');
    expect(gradeFor(0.5)).toBe('D');
  });
});
