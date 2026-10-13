export type Hand = 'left' | 'right';
export const HANDS: readonly Hand[] = ['left', 'right'];

/** A playable rhythm event: one keystroke, at one time, for one hand. */
export interface BeatEvent {
  id: string;
  /** Song time in milliseconds (song position 0 = first audio sample). */
  timeMs: number;
  hand: Hand;
  /** Stem id of the instrument this event drives. */
  instrument: string;
  /** Expected character (lowercase). */
  char: string;
  /** Index of the word this character belongs to within its hand's sequence. */
  word: number;
}

export type HitGrade = 'perfect' | 'great' | 'good';

/** Half-widths of the timing windows, in ms. Anything outside `good` cannot match. */
export interface TimingWindows {
  perfect: number;
  great: number;
  good: number;
}

export const DEFAULT_WINDOWS: TimingWindows = { perfect: 45, great: 90, good: 140 };

export interface RhythmInput {
  /** Song time of the keystroke (ms), already calibrated. */
  timeMs: number;
  hand: Hand;
  char: string;
}

/** offsetMs = input time − event time. Negative = early, positive = late. */
export type Judgment =
  | { kind: 'hit'; grade: HitGrade; event: BeatEvent; offsetMs: number; inputTimeMs: number }
  | { kind: 'wrong'; event: BeatEvent; offsetMs: number; inputTimeMs: number; typed: string }
  | { kind: 'miss'; event: BeatEvent }
  | { kind: 'stray'; hand: Hand; inputTimeMs: number; typed: string };

export type JudgmentKind = HitGrade | 'wrong' | 'miss' | 'stray';

export function judgmentKind(j: Judgment): JudgmentKind {
  return j.kind === 'hit' ? j.grade : j.kind;
}

export function judgmentHand(j: Judgment): Hand {
  return j.kind === 'stray' ? j.hand : j.event.hand;
}
