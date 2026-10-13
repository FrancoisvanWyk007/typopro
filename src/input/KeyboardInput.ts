import type { Hand } from '../rhythm/types';
import { classifyKey, type KeyLike } from './classifyKey';

export interface GameKeyInput {
  hand: Hand;
  char: string;
  code: string;
  /** performance.now()-based time the key went down. */
  timeStamp: number;
}

interface KeyEventLike extends KeyLike {
  timeStamp: number;
  preventDefault(): void;
}

export interface KeyboardInputOptions {
  /** Only gameplay keystrokes while active are forwarded (and have their default prevented). */
  isActive: () => boolean;
  now?: () => number;
}

/**
 * Turns raw keyboard events into gameplay keystrokes.
 *
 * Besides the per-event filtering in classifyKey, it tracks held physical
 * keys so a key only counts once per press even on platforms that send
 * repeated keydowns without setting `repeat`.
 */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private readonly onInput: (input: GameKeyInput) => void;
  private readonly opts: KeyboardInputOptions;

  constructor(onInput: (input: GameKeyInput) => void, opts: KeyboardInputOptions) {
    this.onInput = onInput;
    this.opts = opts;
  }

  handleKeyDown(e: KeyEventLike): void {
    const result = classifyKey(e);
    const wasHeld = this.held.has(e.code);
    if (e.code) this.held.add(e.code);
    if (result.kind !== 'gameplay' || !this.opts.isActive()) return;
    // Stop browser shortcuts like Firefox quick-find on ' and /.
    e.preventDefault();
    if (wasHeld) return;
    this.onInput({ hand: result.hand, char: result.char, code: e.code, timeStamp: this.eventTime(e.timeStamp) });
  }

  handleKeyUp(e: { code: string }): void {
    this.held.delete(e.code);
  }

  /** Releases are not delivered while the window is unfocused, so forget held keys. */
  handleBlur(): void {
    this.held.clear();
  }

  attach(target: Window): () => void {
    const down = (e: KeyboardEvent) => this.handleKeyDown(e);
    const up = (e: KeyboardEvent) => this.handleKeyUp(e);
    const blur = () => this.handleBlur();
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    };
  }

  /**
   * KeyboardEvent.timeStamp is a DOMHighResTimeStamp on the performance.now()
   * timeline in all current browsers; fall back to "now" if it looks like an
   * epoch timestamp or is otherwise implausible.
   */
  private eventTime(ts: number): number {
    const now = (this.opts.now ?? (() => performance.now()))();
    return Number.isFinite(ts) && ts > 0 && ts <= now + 5 && ts > now - 5000 ? ts : now;
  }
}
