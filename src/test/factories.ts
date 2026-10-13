import type { BeatEvent, Hand } from '../rhythm/types';

let seq = 0;

export function ev(timeMs: number, hand: Hand, char: string, instrument = hand === 'left' ? 'bass' : 'keys'): BeatEvent {
  return { id: `${hand}-${timeMs}-${seq++}`, timeMs, hand, instrument, char, word: 0 };
}
