import type { GuidanceMode } from '../guidance/GuidanceController';
import type { BiasView } from '../game/GameSession';
import { HANDS } from '../rhythm/types';
import { useGame, useHud } from './GameContext';
import { savePrefs } from './prefs';

const signed = (ms: number) => `${ms > 0 ? '+' : ms < 0 ? '−' : '±'}${Math.abs(Math.round(ms))} ms`;

function biasText(b: BiasView): string {
  if (!b.ready) return 'measuring…';
  const ms = Math.round(b.estimateMs);
  if (Math.abs(ms) < 3) return 'on time';
  return `${Math.abs(ms)} ms ${ms > 0 ? 'late' : 'early'}`;
}

function shiftText(b: BiasView, shiftMs: number): string {
  if (!b.ready) return 'measuring…';
  if (Math.abs(shiftMs) < 3) return 'none';
  return `${Math.abs(Math.round(shiftMs))} ms ${shiftMs > 0 ? 'earlier' : 'later'}`;
}

export function SettingsBar() {
  const { session } = useGame();
  const hud = useHud();
  const adaptive = hud.guidanceMode === 'adaptive';

  const setMode = (mode: GuidanceMode) => {
    session.setGuidanceMode(mode);
    savePrefs({ guidance: mode });
  };
  const setCalibration = (ms: number) => {
    session.setCalibration(ms);
    savePrefs({ calibrationMs: session.getSnapshot().calibrationMs });
  };
  const calibrateFromBias = () => {
    const ms = session.calibrateFromBias();
    if (ms !== null) savePrefs({ calibrationMs: ms });
  };
  const canCalibrate = HANDS.some((h) => hud.bias[h].ready);

  return (
    <footer className="settings">
      <div className="setting">
        <span className="label" id="guidance-label">
          Visual guidance
        </span>
        <div className="segmented" role="group" aria-labelledby="guidance-label">
          {(['fixed', 'adaptive'] as const).map((m) => (
            <button key={m} aria-pressed={hud.guidanceMode === m} onClick={(e) => (e.currentTarget.blur(), setMode(m))}>
              {m === 'fixed' ? 'Fixed' : 'Adaptive'}
            </button>
          ))}
        </div>
      </div>

      <div className="setting">
        <span className="label">{adaptive ? 'Cues shifted' : 'Your timing'}</span>
        <span className="bias mono">
          <span className="l">L</span>{' '}
          {adaptive ? shiftText(hud.bias.left, hud.cueShiftMs.left) : biasText(hud.bias.left)} ·{' '}
          <span className="r">R</span>{' '}
          {adaptive ? shiftText(hud.bias.right, hud.cueShiftMs.right) : biasText(hud.bias.right)}
        </span>
      </div>

      <div className="setting">
        <span className="label" id="calibration-label">
          Calibration
        </span>
        <div className="stepper" role="group" aria-labelledby="calibration-label">
          <button aria-label="Decrease calibration by 5 ms" onClick={(e) => (e.currentTarget.blur(), setCalibration(hud.calibrationMs - 5))}>
            −
          </button>
          <output className="mono">{signed(hud.calibrationMs)}</output>
          <button aria-label="Increase calibration by 5 ms" onClick={(e) => (e.currentTarget.blur(), setCalibration(hud.calibrationMs + 5))}>
            +
          </button>
        </div>
        <button
          className="link"
          disabled={!canCalibrate}
          title="Shift the game clock by your measured timing"
          onClick={(e) => (e.currentTarget.blur(), calibrateFromBias())}
        >
          Set from my timing
        </button>
      </div>
    </footer>
  );
}
