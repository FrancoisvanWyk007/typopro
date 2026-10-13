import { createContext, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { AudioEngine } from '../audio/AudioEngine';
import type { GameSession, HudSnapshot } from '../game/GameSession';

export type FrameFn = (songTimeMs: number, perfNow: number) => void;

/**
 * One requestAnimationFrame loop per session. Each frame samples the audio
 * clock once via session.tick() and hands the song time to every drawer.
 * rAF only sets the sampling rate; it never defines time.
 */
export class FrameLoop {
  private readonly session: GameSession;
  private readonly fns = new Set<FrameFn>();
  private raf = 0;

  constructor(session: GameSession) {
    this.session = session;
  }

  add(fn: FrameFn): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  start(): void {
    const frame = () => {
      const now = performance.now();
      const t = this.session.tick(now);
      for (const fn of this.fns) fn(t, now);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}

/** Song setup chosen before playing: which chart, at what speed. */
export interface Setup {
  chartId?: string;
  speed: number;
}

export interface GameContextValue {
  session: GameSession;
  audio: AudioEngine;
  loop: FrameLoop;
  setup: Setup;
  onSetupChange: (patch: Partial<Setup>) => void;
}

export const GameContext = createContext<GameContextValue | null>(null);

export function useGame(): GameContextValue {
  const value = useContext(GameContext);
  if (!value) throw new Error('useGame must be used inside <GameContext>');
  return value;
}

/** HUD state; re-renders only when the session publishes a new snapshot. */
export function useHud(): HudSnapshot {
  const { session } = useGame();
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

/** Run `fn` every animation frame without re-rendering. */
export function useFrame(fn: FrameFn): void {
  const { loop } = useGame();
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  useEffect(() => loop.add((t, now) => ref.current(t, now)), [loop]);
}
