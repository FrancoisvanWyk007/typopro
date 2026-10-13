import { describe, expect, it, vi } from 'vitest';
import { classifyKey, type KeyLike } from './classifyKey';
import { KeyboardInput } from './KeyboardInput';
import { handForCode, qwertyHandForChar } from './keyboardLayout';
import { assignCharacters, assignSentence, groupWords } from './sequences';

const key = (code: string, k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  code,
  key: k,
  repeat: false,
  isComposing: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});

describe('keyboard layout', () => {
  it('splits QWERTY physical keys between hands', () => {
    expect(handForCode('KeyA')).toBe('left');
    expect(handForCode('KeyB')).toBe('left');
    expect(handForCode('KeyY')).toBe('right');
    expect(handForCode('Semicolon')).toBe('right');
    expect(handForCode('Space')).toBeNull();
    expect(qwertyHandForChar('T')).toBe('left');
    expect(qwertyHandForChar('n')).toBe('right');
  });
});

describe('classifyKey', () => {
  it('uses code for the hand and key for the character', () => {
    expect(classifyKey(key('KeyF', 'f'))).toEqual({ kind: 'gameplay', hand: 'left', char: 'f' });
    expect(classifyKey(key('KeyJ', 'J'))).toEqual({ kind: 'gameplay', hand: 'right', char: 'j' });
    // AZERTY: the physical Q key produces "a"; still the left hand, validated as "a".
    expect(classifyKey(key('KeyQ', 'a'))).toEqual({ kind: 'gameplay', hand: 'left', char: 'a' });
  });

  it('ignores repeats, composition, modifier shortcuts and non-gameplay keys', () => {
    expect(classifyKey(key('KeyA', 'a', { repeat: true }))).toMatchObject({ reason: 'repeat' });
    expect(classifyKey(key('KeyA', 'a', { isComposing: true }))).toMatchObject({ reason: 'composition' });
    expect(classifyKey(key('KeyA', 'Process', { keyCode: 229 }))).toMatchObject({ reason: 'composition' });
    expect(classifyKey(key('KeyC', 'c', { ctrlKey: true }))).toMatchObject({ reason: 'modifier' });
    expect(classifyKey(key('KeyV', 'v', { metaKey: true }))).toMatchObject({ reason: 'modifier' });
    expect(classifyKey(key('KeyE', '€', { altKey: true }))).toMatchObject({ reason: 'modifier' });
    expect(classifyKey(key('Space', ' '))).toMatchObject({ reason: 'non-gameplay' });
    expect(classifyKey(key('Escape', 'Escape'))).toMatchObject({ reason: 'non-gameplay' });
    expect(classifyKey(key('BracketLeft', 'Dead'))).toMatchObject({ reason: 'non-character' });
  });
});

describe('KeyboardInput', () => {
  const setup = (active = true) => {
    const onInput = vi.fn();
    const kb = new KeyboardInput(onInput, { isActive: () => active, now: () => 1000 });
    const down = (code: string, k: string, extra: Partial<KeyLike & { timeStamp: number }> = {}) => {
      const preventDefault = vi.fn();
      kb.handleKeyDown({ ...key(code, k), timeStamp: 990, preventDefault, ...extra });
      return preventDefault;
    };
    return { kb, onInput, down };
  };

  it('forwards gameplay keys with the event timestamp', () => {
    const { onInput, down } = setup();
    const prevent = down('KeyD', 'd');
    expect(onInput).toHaveBeenCalledWith({ hand: 'left', char: 'd', code: 'KeyD', timeStamp: 990 });
    expect(prevent).toHaveBeenCalled();
  });

  it('counts a held key once even when the platform omits the repeat flag', () => {
    const { kb, onInput, down } = setup();
    down('KeyK', 'k');
    down('KeyK', 'k');
    expect(onInput).toHaveBeenCalledTimes(1);
    kb.handleKeyUp({ code: 'KeyK' });
    down('KeyK', 'k');
    expect(onInput).toHaveBeenCalledTimes(2);
  });

  it('forgets held keys on blur', () => {
    const { kb, onInput, down } = setup();
    down('KeyK', 'k');
    kb.handleBlur();
    down('KeyK', 'k');
    expect(onInput).toHaveBeenCalledTimes(2);
  });

  it('does nothing while inactive', () => {
    const { onInput, down } = setup(false);
    const prevent = down('KeyD', 'd');
    expect(onInput).not.toHaveBeenCalled();
    expect(prevent).not.toHaveBeenCalled();
  });

  it('falls back to now for implausible timestamps', () => {
    const { onInput, down } = setup();
    down('KeyD', 'd', { timeStamp: 1_700_000_000_000 });
    expect(onInput).toHaveBeenCalledWith(expect.objectContaining({ timeStamp: 1000 }));
  });
});

describe('typing sequences', () => {
  it('assigns characters per hand in time order, independent of the other hand', () => {
    const events = assignCharacters(
      [
        { t: 0, hand: 'left', instrument: 'bass' },
        { t: 100, hand: 'right', instrument: 'keys' },
        { t: 200, hand: 'left', instrument: 'bass' },
        { t: 300, hand: 'left', instrument: 'bass' },
        { t: 400, hand: 'right', instrument: 'keys' },
      ],
      { left: 'ab c', right: 'jk' },
    );
    expect(events.map((e) => `${e.hand[0]}${e.char}${e.word}`)).toEqual(['la0', 'rj0', 'lb0', 'lc1', 'rk0']);
    expect(new Set(events.map((e) => e.id)).size).toBe(5);
  });

  it('cycles a sequence shorter than the beat map', () => {
    const events = assignCharacters(
      [0, 1, 2, 3].map((t) => ({ t, hand: 'right' as const, instrument: 'keys' })),
      { left: 'a', right: 'hi' },
    );
    expect(events.map((e) => e.char).join('')).toBe('hihi');
    expect(groupWords(events).map((w) => w.events.length)).toEqual([2, 2]);
  });

  it('assigns one sentence across both hands in time order with shared word indices', () => {
    const events = assignSentence(
      [
        { t: 0, hand: 'left', instrument: 'bass' },
        { t: 300, hand: 'right', instrument: 'keys' },
        { t: 600, hand: 'left', instrument: 'bass' },
        { t: 1200, hand: 'right', instrument: 'keys' },
      ],
      'The O',
    );
    expect(events.map((e) => `${e.hand[0]}${e.char}${e.word}`)).toEqual(['lt0', 'rh0', 'le0', 'ro1']);
    expect(groupWords(events).map((w) => w.events.map((e) => e.char).join(''))).toEqual(['the', 'o']);
  });
});
