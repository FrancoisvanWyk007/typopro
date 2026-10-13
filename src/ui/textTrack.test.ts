import { describe, expect, it } from 'vitest';
import { assignSentence } from '../input/sequences';
import { buildTextTrack, columnAt } from './textTrack';

// "the tide": letters every 300ms with a one-slot rest between words.
const events = assignSentence(
  [0, 300, 600, 1200, 1500, 1800, 2100].map((t, i) => ({
    t: t + 1000,
    hand: (['left', 'right', 'left', 'left', 'right', 'left', 'left'] as const)[i],
    instrument: 'x',
  })),
  'the tide',
);

describe('text track', () => {
  it('lays words out in columns with one space column between them', () => {
    const track = buildTextTrack(events);
    expect(track.letters.map((l) => l.col)).toEqual([0, 1, 2, 4, 5, 6, 7]);
    expect(track.words.map((w) => [w.firstCol, w.lastCol])).toEqual([
      [0, 2],
      [4, 7],
    ]);
  });

  it('puts every letter under the now line exactly at its beat', () => {
    const track = buildTextTrack(events);
    for (const l of track.letters) expect(columnAt(track, l.event.timeMs)).toBeCloseTo(l.col);
  });

  it('crosses the space during the rest and interpolates linearly', () => {
    const track = buildTextTrack(events);
    // "e" is col 2 at 1600 ms, "t" is col 4 at 2200 ms: a quarter of the way through, half the space is crossed.
    expect(columnAt(track, 1750)).toBeCloseTo(2.5);
    expect(columnAt(track, 1650)).toBeCloseTo(2 + 50 / 300);
  });

  it('keeps scrolling at the edge pace before the first and after the last letter', () => {
    const track = buildTextTrack(events);
    expect(columnAt(track, 0)).toBeCloseTo(-1000 / 300);
    expect(columnAt(track, 3100 + 600)).toBeCloseTo(7 + 2);
  });

  it('handles tiny tracks', () => {
    expect(columnAt(buildTextTrack([]), 500)).toBe(0);
    expect(columnAt(buildTextTrack(events.slice(0, 1)), 1300)).toBeCloseTo(1);
  });
});
