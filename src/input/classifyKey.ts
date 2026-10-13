import type { Hand } from '../rhythm/types';
import { handForCode } from './keyboardLayout';

/** The subset of KeyboardEvent the classifier needs (easy to fake in tests). */
export interface KeyLike {
  code: string;
  key: string;
  repeat: boolean;
  isComposing: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  keyCode?: number;
}

export type IgnoreReason = 'repeat' | 'composition' | 'modifier' | 'non-gameplay' | 'non-character';

export type KeyClassification =
  | { kind: 'gameplay'; hand: Hand; char: string }
  | { kind: 'ignored'; reason: IgnoreReason };

/**
 * Classify a keydown. `code` decides the hand (physical position);
 * `key` supplies the character that is validated against the beat map.
 */
export function classifyKey(e: KeyLike): KeyClassification {
  if (e.repeat) return { kind: 'ignored', reason: 'repeat' };
  // keyCode 229 / "Process" is how IME composition shows up on keydown.
  if (e.isComposing || e.key === 'Process' || e.keyCode === 229) return { kind: 'ignored', reason: 'composition' };
  if (e.ctrlKey || e.metaKey || e.altKey) return { kind: 'ignored', reason: 'modifier' };
  const hand = handForCode(e.code);
  if (!hand) return { kind: 'ignored', reason: 'non-gameplay' };
  // Dead keys, "Unidentified" etc. carry no character to validate.
  if ([...e.key].length !== 1) return { kind: 'ignored', reason: 'non-character' };
  return { kind: 'gameplay', hand, char: e.key.toLowerCase() };
}
