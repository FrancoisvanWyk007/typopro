import { useRef } from 'react';
import type { Hand } from '../rhythm/types';
import { useFrame, useGame, useHud } from './GameContext';

const FADER_FLOOR_DB = -30;
const FADER_TICKS_DB = [0, -6, -12, -18, -24];

/** Fader travel (0..1) for a linear gain, on a dB scale like a real console. */
export function faderPosition(gain: number): number {
  const db = 20 * Math.log10(Math.max(gain, 1e-4));
  return Math.min(1, Math.max(0, (db - FADER_FLOOR_DB) / -FADER_FLOOR_DB));
}

/** RMS → meter height (0..1) over roughly −50..−8 dBFS. */
export function meterLevel(rms: number): number {
  const db = 20 * Math.log10(rms + 1e-9);
  return Math.min(1, Math.max(0, (db + 50) / 42));
}

/** Ballistics: instant attack, steady fall. */
export function useMeter(stemId: string) {
  const { audio } = useGame();
  const ref = useRef<HTMLElement>(null);
  const shown = useRef(0);
  useFrame(() => {
    shown.current = Math.max(meterLevel(audio.getStemLevel(stemId)), shown.current - 0.022);
    ref.current?.style.setProperty('--lvl', shown.current.toFixed(3));
  });
  return ref;
}

export function ChannelStrip({ hand }: { hand: Hand }) {
  const hud = useHud();
  const inst = hud.instruments.find((i) => i.hand === hand)!;
  const meterRef = useMeter(inst.id);
  const pos = faderPosition(inst.level);
  const db = 20 * Math.log10(inst.level);
  const capOffset = (p: number) => `calc(${p} * (100% - 18px))`;

  return (
    <section className="strip" data-hand={hand} aria-label={`${inst.label} channel`}>
      <div>
        <div className="strip-name">{inst.label}</div>
        <div className="label strip-hand">{hand} hand</div>
      </div>
      <div className="strip-body">
        <div
          className="fader"
          role="meter"
          aria-label={`${inst.label} level`}
          aria-valuemin={FADER_FLOOR_DB}
          aria-valuemax={0}
          aria-valuenow={Math.round(db)}
        >
          <div className="fader-slot" />
          {FADER_TICKS_DB.map((t) => {
            const bottom = `calc(${capOffset(faderPosition(10 ** (t / 20)))} + 9px)`;
            return (
              <span key={t}>
                <i className="fader-tick" style={{ bottom }} />
                <i className="fader-tick right" style={{ bottom }} />
              </span>
            );
          })}
          <div className="fader-cap" style={{ bottom: capOffset(pos) }} />
        </div>
        <div className="meter" aria-hidden>
          <div className="meter-lit" ref={meterRef as React.RefObject<HTMLDivElement>} />
        </div>
      </div>
      <div className="strip-readout mono">{db > -0.05 ? '0.0' : db.toFixed(1)} dB</div>
    </section>
  );
}
