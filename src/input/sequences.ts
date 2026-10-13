import type { BeatEvent, Hand } from '../rhythm/types';

export interface RawBeatEvent {
  t: number;
  hand: Hand;
  instrument: string;
}

export function sequenceWords(sequence: string): string[] {
  return sequence.split(/\s+/).filter(Boolean);
}

/**
 * Assign each hand's typing sequence to that hand's events in time order.
 * The sequence repeats if the beat map has more events than characters.
 */
export function assignCharacters(raw: readonly RawBeatEvent[], sequences: Record<Hand, string>): BeatEvent[] {
  const sorted = raw.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i);
  const cursor: Record<Hand, { words: string[]; word: number; char: number; count: number }> = {
    left: { words: sequenceWords(sequences.left), word: 0, char: 0, count: 0 },
    right: { words: sequenceWords(sequences.right), word: 0, char: 0, count: 0 },
  };

  return sorted.map(({ e }) => {
    const c = cursor[e.hand];
    if (c.words.length === 0) throw new Error(`No typing sequence for ${e.hand} hand`);
    const word = c.words[c.word % c.words.length];
    const event: BeatEvent = {
      id: `${e.hand[0].toUpperCase()}${String(c.count).padStart(3, '0')}`,
      timeMs: e.t,
      hand: e.hand,
      instrument: e.instrument,
      char: word[c.char].toLowerCase(),
      word: c.word,
    };
    c.count++;
    c.char++;
    if (c.char >= word.length) {
      c.char = 0;
      c.word++;
    }
    return event;
  });
}

/**
 * Assign one text, in order, to all events regardless of hand. The beat map
 * is expected to already route each event to the hand that types its
 * character (the manifest validator checks this).
 */
export function assignSentence(raw: readonly RawBeatEvent[], text: string): BeatEvent[] {
  const chars = sequenceWords(text).flatMap((word, w) => [...word.toLowerCase()].map((char) => ({ char, word: w })));
  const sorted = raw.map((e, i) => ({ e, i })).sort((a, b) => a.e.t - b.e.t || a.i - b.i);
  const count: Record<Hand, number> = { left: 0, right: 0 };
  return sorted.map(({ e }, i) => {
    const c = chars[i % chars.length];
    return {
      id: `${e.hand[0].toUpperCase()}${String(count[e.hand]++).padStart(3, '0')}`,
      timeMs: e.t,
      hand: e.hand,
      instrument: e.instrument,
      char: c.char,
      word: c.word,
    };
  });
}

export interface WordView {
  word: number;
  events: BeatEvent[];
}

/** Group a hand's (time-ordered) events into words for display. */
export function groupWords(events: readonly BeatEvent[]): WordView[] {
  const words: WordView[] = [];
  for (const e of events) {
    const last = words[words.length - 1];
    if (last && last.word === e.word) last.events.push(e);
    else words.push({ word: e.word, events: [e] });
  }
  return words;
}
