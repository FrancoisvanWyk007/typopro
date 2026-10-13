import { describe, expect, it } from 'vitest';
import { ev } from '../test/factories';
import { RhythmEngine } from './RhythmEngine';
import { DEFAULT_WINDOWS, type Judgment } from './types';

const last = (js: Judgment[]) => js[js.length - 1];

describe('RhythmEngine matching', () => {
  it('grades hits by absolute offset and reports early/late sign', () => {
    const e = new RhythmEngine([ev(1000, 'left', 'a'), ev(2000, 'left', 'b'), ev(3000, 'left', 'c'), ev(4000, 'left', 'd')]);
    const perfect = last(e.judge({ timeMs: 1020, hand: 'left', char: 'a' }));
    const great = last(e.judge({ timeMs: 1940, hand: 'left', char: 'b' }));
    const good = last(e.judge({ timeMs: 3120, hand: 'left', char: 'c' }));
    expect(perfect).toMatchObject({ kind: 'hit', grade: 'perfect', offsetMs: 20 });
    expect(great).toMatchObject({ kind: 'hit', grade: 'great', offsetMs: -60 });
    expect(good).toMatchObject({ kind: 'hit', grade: 'good', offsetMs: 120 });
  });

  it('treats the window edge as inclusive and anything beyond as stray', () => {
    const e = new RhythmEngine([ev(1000, 'left', 'a'), ev(2000, 'left', 'a')]);
    expect(last(e.judge({ timeMs: 1000 + DEFAULT_WINDOWS.good, hand: 'left', char: 'a' }))).toMatchObject({ kind: 'hit' });
    expect(last(e.judge({ timeMs: 2000 - DEFAULT_WINDOWS.good - 1, hand: 'left', char: 'a' }))).toMatchObject({ kind: 'stray' });
  });

  it('matches each keystroke to at most one event and each event at most once', () => {
    const target = ev(1000, 'left', 'a');
    const e = new RhythmEngine([target]);
    const first = e.judge({ timeMs: 1000, hand: 'left', char: 'a' });
    const second = e.judge({ timeMs: 1010, hand: 'left', char: 'a' });
    expect(first).toHaveLength(1);
    expect(second).toEqual([expect.objectContaining({ kind: 'stray' })]);
    expect(e.resultFor(target.id)).toMatchObject({ kind: 'hit' });
  });

  it('prefers the event with the typed character over a closer one', () => {
    const a = ev(1000, 'left', 'a');
    const s = ev(1150, 'left', 's');
    const e = new RhythmEngine([a, s]);
    const j = last(e.judge({ timeMs: 1040, hand: 'left', char: 's' }));
    expect(j).toMatchObject({ kind: 'hit', event: s, offsetMs: -110 });
    expect(e.resultFor(a.id)).toBeUndefined(); // still pending, may still be hit or missed
  });

  it('picks the closest of several same-character candidates', () => {
    const first = ev(1000, 'right', 'o');
    const second = ev(1200, 'right', 'o');
    const e = new RhythmEngine([first, second]);
    expect(last(e.judge({ timeMs: 1130, hand: 'right', char: 'o' }))).toMatchObject({ kind: 'hit', event: second });
  });

  it('consumes the closest event as wrong when the character does not match', () => {
    const a = ev(1000, 'left', 'a');
    const e = new RhythmEngine([a]);
    expect(last(e.judge({ timeMs: 1010, hand: 'left', char: 'x' }))).toMatchObject({ kind: 'wrong', event: a, typed: 'x' });
    // A correction afterwards cannot re-use the event.
    expect(last(e.judge({ timeMs: 1030, hand: 'left', char: 'a' }))).toMatchObject({ kind: 'stray' });
  });

  it('handles repeated presses of the same key across consecutive events', () => {
    const e1 = ev(1000, 'right', 'l');
    const e2 = ev(1300, 'right', 'l');
    const e = new RhythmEngine([e1, e2]);
    expect(last(e.judge({ timeMs: 1005, hand: 'right', char: 'l' }))).toMatchObject({ event: e1, grade: 'perfect' });
    expect(last(e.judge({ timeMs: 1290, hand: 'right', char: 'l' }))).toMatchObject({ event: e2, grade: 'perfect' });
    expect(last(e.judge({ timeMs: 1320, hand: 'right', char: 'l' }))).toMatchObject({ kind: 'stray' });
  });
});

describe('RhythmEngine misses', () => {
  it('declares misses from the clock alone, without any input', () => {
    const a = ev(1000, 'left', 'a');
    const b = ev(2000, 'right', 'j');
    const e = new RhythmEngine([a, b]);
    expect(e.advance(1000 + DEFAULT_WINDOWS.good)).toEqual([]);
    expect(e.advance(1000 + DEFAULT_WINDOWS.good + 1)).toEqual([{ kind: 'miss', event: a }]);
    expect(e.advance(5000)).toEqual([{ kind: 'miss', event: b }]);
    expect(e.isComplete).toBe(true);
  });

  it('reports misses that expired before a keystroke ahead of its judgment', () => {
    const a = ev(1000, 'left', 'a');
    const s = ev(1600, 'left', 's');
    const e = new RhythmEngine([a, s]);
    const js = e.judge({ timeMs: 1590, hand: 'left', char: 's' });
    expect(js.map((j) => j.kind)).toEqual(['miss', 'hit']);
  });

  it('leaves events skipped over by an early hit to be missed later', () => {
    const a = ev(1000, 'left', 'a');
    const s = ev(1120, 'left', 's');
    const e = new RhythmEngine([a, s]);
    e.judge({ timeMs: 1000, hand: 'left', char: 's' }); // hits s early
    expect(e.nextPendingIndex('left')).toBe(0);
    expect(e.advance(2000)).toEqual([{ kind: 'miss', event: a }]);
    expect(e.nextPendingIndex('left')).toBe(2);
  });
});

describe('RhythmEngine hand independence', () => {
  it('only matches events of the keystroke hand', () => {
    const left = ev(1000, 'left', 'a');
    const right = ev(1000, 'right', 'j');
    const e = new RhythmEngine([left, right]);
    // Right hand typing the left character is wrong for the right event; left event untouched.
    expect(last(e.judge({ timeMs: 1000, hand: 'right', char: 'a' }))).toMatchObject({ kind: 'wrong', event: right });
    expect(e.resultFor(left.id)).toBeUndefined();
    expect(last(e.judge({ timeMs: 1010, hand: 'left', char: 'a' }))).toMatchObject({ kind: 'hit', event: left });
  });

  it('judges simultaneous events on both hands independently', () => {
    const e = new RhythmEngine([ev(1000, 'left', 'f'), ev(1000, 'right', 'j')]);
    expect(last(e.judge({ timeMs: 995, hand: 'left', char: 'f' }))).toMatchObject({ kind: 'hit', grade: 'perfect' });
    expect(last(e.judge({ timeMs: 1003, hand: 'right', char: 'j' }))).toMatchObject({ kind: 'hit', grade: 'perfect' });
  });

  it('is deterministic and resettable', () => {
    const events = [ev(1000, 'left', 'a'), ev(1500, 'right', 'k'), ev(1800, 'left', 's')];
    const run = (engine: RhythmEngine) => [
      ...engine.judge({ timeMs: 1030, hand: 'left', char: 'a' }),
      ...engine.judge({ timeMs: 1490, hand: 'right', char: 'x' }),
      ...engine.advance(3000),
    ].map((j) => (j.kind === 'stray' ? 'stray' : `${j.kind}:${j.event.id}`));
    const engine = new RhythmEngine(events);
    const first = run(engine);
    engine.reset();
    expect(run(engine)).toEqual(first);
    expect(first).toEqual([`hit:${events[0].id}`, `wrong:${events[1].id}`, `miss:${events[2].id}`]);
  });
});
