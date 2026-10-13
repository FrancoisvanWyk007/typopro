import { useEffect, useMemo } from 'react';
import type { AudioEngine } from '../audio/AudioEngine';
import type { GameSession } from '../game/GameSession';
import { KeyboardInput } from '../input/KeyboardInput';
import { ChannelStrip } from './ChannelStrip';
import { FrameLoop, GameContext, type Setup } from './GameContext';
import { Lane } from './Lane';
import { SentenceStage } from './SentenceStage';
import { MasterSection } from './MasterSection';
import { Overlay } from './Overlay';
import { SettingsBar } from './SettingsBar';
import { Transport } from './Transport';

export type { Setup };

interface Props {
  session: GameSession;
  audio: AudioEngine;
  setup: Setup;
  onSetupChange: (patch: Partial<Setup>) => void;
}

export function GameScreen({ session, audio, setup, onSetupChange }: Props) {
  const loop = useMemo(() => new FrameLoop(session), [session]);

  useEffect(() => {
    loop.start();
    return () => loop.stop();
  }, [loop]);

  // Gameplay keys go straight to the session with their event timestamps.
  useEffect(() => {
    const keyboard = new KeyboardInput((input) => session.handleKey(input), {
      isActive: () => session.state === 'playing',
    });
    return keyboard.attach(window);
  }, [session]);

  // Transport keys and auto-pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const status = session.state;
      if (e.key === 'Escape') {
        if (status === 'playing') session.pause();
        else if (status === 'paused') void session.resume();
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      // Mid-song, Enter/Space must never activate a focused control or scroll.
      if (status === 'playing') {
        e.preventDefault();
        return;
      }
      const onControl = e.target instanceof Element && e.target.closest('button, input, select, textarea');
      if (e.key === 'Enter' && !onControl && (status === 'ready' || status === 'finished')) {
        e.preventDefault();
        void session.start();
      }
    };
    const onHidden = () => {
      if (document.hidden) session.pause();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [session]);

  return (
    <GameContext.Provider value={{ session, audio, loop, setup, onSetupChange }}>
      <main className="console">
        <Transport />
        <div className="deck" data-mode={session.mode}>
          <ChannelStrip hand="left" />
          {session.mode === 'sentence' ? (
            <SentenceStage />
          ) : (
            <>
              <Lane hand="left" />
              <Lane hand="right" />
            </>
          )}
          <MasterSection />
          <ChannelStrip hand="right" />
          <Overlay />
        </div>
        <SettingsBar />
      </main>
    </GameContext.Provider>
  );
}
