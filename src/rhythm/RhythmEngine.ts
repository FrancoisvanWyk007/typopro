import {
  DEFAULT_WINDOWS,
  HANDS,
  type BeatEvent,
  type Hand,
  type HitGrade,
  type Judgment,
  type RhythmInput,
  type TimingWindows,
} from './types';

interface HandTrack {
  events: BeatEvent[];
  results: (Judgment | undefined)[];
  /** Every event before `head` has been judged. */
  head: number;
}

/**
 * Deterministic, framework-free matcher between keystrokes and beat events.
 *
 * Time only moves forward through `advance()` / `judge()` calls with song times
 * supplied by the caller (derived from the audio clock), so the engine never
 * reads a clock itself and is fully reproducible in tests.
 */
export class RhythmEngine {
  readonly windows: TimingWindows;
  private readonly tracks: Record<Hand, HandTrack>;
  private readonly results = new Map<string, Judgment>();

  constructor(events: readonly BeatEvent[], windows: TimingWindows = DEFAULT_WINDOWS) {
    this.windows = windows;
    const byHand = (hand: Hand): HandTrack => {
      const list = events.filter((e) => e.hand === hand).sort((a, b) => a.timeMs - b.timeMs);
      return { events: list, results: new Array(list.length), head: 0 };
    };
    this.tracks = { left: byHand('left'), right: byHand('right') };
  }

  /** Events for one hand, in time order. */
  eventsFor(hand: Hand): readonly BeatEvent[] {
    return this.tracks[hand].events;
  }

  resultFor(eventId: string): Judgment | undefined {
    return this.results.get(eventId);
  }

  /** Index (within the hand's events) of the earliest event still awaiting judgment. */
  nextPendingIndex(hand: Hand): number {
    const t = this.tracks[hand];
    let i = t.head;
    while (i < t.events.length && t.results[i]) i++;
    return i;
  }

  get isComplete(): boolean {
    return HANDS.every((h) => this.nextPendingIndex(h) >= this.tracks[h].events.length);
  }

  /** Mark every pending event whose window closed before `nowMs` as missed. */
  advance(nowMs: number): Judgment[] {
    const out: Judgment[] = [];
    for (const hand of HANDS) {
      const t = this.tracks[hand];
      while (t.head < t.events.length) {
        if (t.results[t.head]) {
          t.head++;
          continue;
        }
        const event = t.events[t.head];
        if (event.timeMs + this.windows.good >= nowMs) break;
        out.push(this.record(t, t.head, { kind: 'miss', event }));
        t.head++;
      }
    }
    return out;
  }

  /**
   * Judge one keystroke. Returns misses that expired before the keystroke,
   * followed by exactly one judgment for the keystroke itself.
   *
   * Matching rules:
   *  - only pending events of the same hand within ±good are eligible;
   *  - eligible events with the typed character are preferred;
   *  - among the preferred pool the closest in time wins (ties → earlier);
   *  - a keystroke with no character match consumes the closest event as `wrong`;
   *  - a keystroke with no eligible event is a `stray` and consumes nothing.
   */
  judge(input: RhythmInput): Judgment[] {
    const out = this.advance(input.timeMs);
    const t = this.tracks[input.hand];
    const { good } = this.windows;

    let bestMatch = -1;
    let bestAny = -1;
    for (let i = t.head; i < t.events.length; i++) {
      const event = t.events[i];
      const dt = input.timeMs - event.timeMs;
      if (dt < -good) break;
      if (t.results[i] || dt > good) continue;
      if (bestAny < 0 || Math.abs(dt) < Math.abs(input.timeMs - t.events[bestAny].timeMs)) bestAny = i;
      if (event.char === input.char) {
        if (bestMatch < 0 || Math.abs(dt) < Math.abs(input.timeMs - t.events[bestMatch].timeMs)) bestMatch = i;
      }
    }

    if (bestMatch >= 0) {
      const event = t.events[bestMatch];
      const offsetMs = input.timeMs - event.timeMs;
      out.push(
        this.record(t, bestMatch, {
          kind: 'hit',
          grade: this.grade(offsetMs),
          event,
          offsetMs,
          inputTimeMs: input.timeMs,
        }),
      );
    } else if (bestAny >= 0) {
      const event = t.events[bestAny];
      out.push(
        this.record(t, bestAny, {
          kind: 'wrong',
          event,
          offsetMs: input.timeMs - event.timeMs,
          inputTimeMs: input.timeMs,
          typed: input.char,
        }),
      );
    } else {
      out.push({ kind: 'stray', hand: input.hand, inputTimeMs: input.timeMs, typed: input.char });
    }
    return out;
  }

  /** Clear all judgments (used on restart). */
  reset(): void {
    this.results.clear();
    for (const hand of HANDS) {
      const t = this.tracks[hand];
      t.results = new Array(t.events.length);
      t.head = 0;
    }
  }

  private grade(offsetMs: number): HitGrade {
    const a = Math.abs(offsetMs);
    if (a <= this.windows.perfect) return 'perfect';
    if (a <= this.windows.great) return 'great';
    return 'good';
  }

  private record(t: HandTrack, index: number, j: Judgment): Judgment {
    t.results[index] = j;
    if (j.kind !== 'stray') this.results.set(j.event.id, j);
    return j;
  }
}
