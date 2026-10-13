import type { Hand } from '../rhythm/types';

/**
 * Physical key → hand for a standard QWERTY touch-typing split.
 * Keyed by KeyboardEvent.code, which is layout-independent (it names the
 * physical key position), so the hand split stays correct on any layout.
 */
const LEFT_KEYS: Record<string, string> = {
  Backquote: '`', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5',
  KeyQ: 'q', KeyW: 'w', KeyE: 'e', KeyR: 'r', KeyT: 't',
  KeyA: 'a', KeyS: 's', KeyD: 'd', KeyF: 'f', KeyG: 'g',
  KeyZ: 'z', KeyX: 'x', KeyC: 'c', KeyV: 'v', KeyB: 'b',
};

const RIGHT_KEYS: Record<string, string> = {
  Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0', Minus: '-', Equal: '=',
  KeyY: 'y', KeyU: 'u', KeyI: 'i', KeyO: 'o', KeyP: 'p', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  KeyH: 'h', KeyJ: 'j', KeyK: 'k', KeyL: 'l', Semicolon: ';', Quote: "'",
  KeyN: 'n', KeyM: 'm', Comma: ',', Period: '.', Slash: '/',
};

const HAND_BY_CODE = new Map<string, Hand>([
  ...Object.keys(LEFT_KEYS).map((code) => [code, 'left'] as const),
  ...Object.keys(RIGHT_KEYS).map((code) => [code, 'right'] as const),
]);

const HAND_BY_QWERTY_CHAR = new Map<string, Hand>([
  ...Object.values(LEFT_KEYS).map((ch) => [ch, 'left'] as const),
  ...Object.values(RIGHT_KEYS).map((ch) => [ch, 'right'] as const),
]);

export function handForCode(code: string): Hand | null {
  return HAND_BY_CODE.get(code) ?? null;
}

/** Which hand types this (unshifted) character on a QWERTY layout. */
export function qwertyHandForChar(char: string): Hand | null {
  return HAND_BY_QWERTY_CHAR.get(char.toLowerCase()) ?? null;
}
