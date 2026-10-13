import type { BeatEvent } from '../rhythm/types';

/**
 * Sentence mode lays the text out in monospace columns (one column per
 * letter, one per space) and scrolls it past a fixed "now" line so that each
 * letter crosses the line exactly at its beat time. Between letters the
 * position is interpolated linearly, so scroll speed follows the rhythm and
 * the space between words is crossed during the rest.
 */

export interface TrackLetter {
  event: BeatEvent;
  col: number;
}

export interface TrackWord {
  word: number;
  letters: TrackLetter[];
  firstCol: number;
  lastCol: number;
}

export interface TextTrack {
  letters: TrackLetter[];
  words: TrackWord[];
}

/** Columns for time-ordered sentence events; words are separated by one space column. */
export function buildTextTrack(events: readonly BeatEvent[]): TextTrack {
  const sorted = [...events].sort((a, b) => a.timeMs - b.timeMs);
  const letters: TrackLetter[] = [];
  const words: TrackWord[] = [];
  let col = 0;
  for (const event of sorted) {
    let word = words[words.length - 1];
    if (!word || word.word !== event.word) {
      if (word) col++; // the space
      word = { word: event.word, letters: [], firstCol: col, lastCol: col };
      words.push(word);
    }
    const letter = { event, col };
    letters.push(letter);
    word.letters.push(letter);
    word.lastCol = col;
    col++;
  }
  return { letters, words };
}

/** Fallback pace (ms per column) when the track has fewer than two distinct times. */
const DEFAULT_MS_PER_COL = 300;

/** The (fractional) column under the now line at song time `t`. */
export function columnAt(track: TextTrack, t: number): number {
  const L = track.letters;
  if (L.length === 0) return 0;
  const slope = (a: TrackLetter, b: TrackLetter) =>
    b.event.timeMs > a.event.timeMs ? (b.col - a.col) / (b.event.timeMs - a.event.timeMs) : 1 / DEFAULT_MS_PER_COL;
  if (L.length === 1) return L[0].col + (t - L[0].event.timeMs) / DEFAULT_MS_PER_COL;

  // Before the first / after the last letter, keep the nearest segment's pace.
  if (t <= L[0].event.timeMs) return L[0].col + (t - L[0].event.timeMs) * slope(L[0], L[1]);
  const last = L.length - 1;
  if (t >= L[last].event.timeMs) return L[last].col + (t - L[last].event.timeMs) * slope(L[last - 1], L[last]);

  // Binary search for the segment containing t.
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (L[mid].event.timeMs <= t) lo = mid;
    else hi = mid;
  }
  return L[lo].col + (t - L[lo].event.timeMs) * slope(L[lo], L[hi]);
}
