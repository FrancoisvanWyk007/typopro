import type { LaneFlash } from '../game/GameSession';
import type { BeatEvent, Hand, Judgment, TimingWindows } from '../rhythm/types';
import { clamp01, drawJudgment, drawTimingBar, roundRect, shade, withAlpha } from './canvas';
import { FONTS, PALETTE, judgmentColor } from './palette';

export const LOOKAHEAD_MS = 1500;
/** Below the hit line is the feedback zone: judgment label + early/late bar. */
const HIT_FROM_BOTTOM = 126;
/** Keep consecutive eighth notes clear of each other on short screens. */
const MIN_PX_PER_MS = 0.17;
const CAP_W = 46;
const CAP_H = 40;
const BURST_MS = 280;
const PRESS_MS = 140;

export interface LaneFrame {
  w: number;
  h: number;
  dpr: number;
  hand: Hand;
  /** Calibrated song time (ms). */
  t: number;
  /** performance.now() of this frame. */
  now: number;
  events: readonly BeatEvent[];
  resultFor: (id: string) => Judgment | undefined;
  nextPendingId: string | null;
  /** Adaptive guidance: cues are drawn this many ms early. Visual only. */
  cueShiftMs: number;
  bpm: number;
  flash: LaneFlash;
  windows: TimingWindows;
}

export function drawLane(g: CanvasRenderingContext2D, f: LaneFrame): void {
  const { w, h, hand } = f;
  const color = PALETTE.hand[hand];
  const cx = w / 2;
  const hitY = h - HIT_FROM_BOTTOM;
  const pxPerMs = Math.max((hitY - CAP_H / 2) / LOOKAHEAD_MS, MIN_PX_PER_MS);
  const yFor = (timeMs: number) => hitY - (timeMs - f.cueShiftMs - f.t) * pxPerMs;

  g.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  // Beat grid (moves with the cues so it always agrees with them).
  const beatMs = 60000 / f.bpm;
  const tTop = f.t + f.cueShiftMs + hitY / pxPerMs;
  const tBottom = f.t + f.cueShiftMs - (h - hitY) / pxPerMs;
  for (let k = Math.max(0, Math.ceil(tBottom / beatMs)); k * beatMs <= tTop; k++) {
    const y = Math.round(yFor(k * beatMs)) + 0.5;
    g.fillStyle = k % 4 === 0 ? 'rgba(232,227,211,0.11)' : 'rgba(232,227,211,0.04)';
    g.fillRect(0, y, w, 1);
  }

  // Hit line, brightened briefly by any keypress on this hand.
  const pressAge = f.now - f.flash.pressedAt;
  const press = pressAge >= 0 && pressAge < PRESS_MS ? 1 - pressAge / PRESS_MS : 0;
  if (press > 0) {
    const grad = g.createLinearGradient(0, hitY - 26, 0, hitY + 26);
    grad.addColorStop(0, withAlpha(color, 0));
    grad.addColorStop(0.5, withAlpha(color, 0.2 * press));
    grad.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, hitY - 26, w, 52);
  }
  g.fillStyle = withAlpha(color, 0.35 + 0.5 * press);
  g.fillRect(0, hitY - 1, w, 2);
  // Target slot outline where the keycap should land.
  g.strokeStyle = withAlpha(color, 0.28 + 0.4 * press);
  g.lineWidth = 1;
  roundRect(g, cx - CAP_W / 2 - 4.5, hitY - CAP_H / 2 - 4.5, CAP_W + 9, CAP_H + 9, 9);
  g.stroke();

  // Notes.
  for (const e of f.events) {
    const y = yFor(e.timeMs);
    const r = f.resultFor(e.id);
    if (!r) {
      if (y < -CAP_H || y > h + CAP_H) continue;
      drawCap(g, cx, y, e.char, e.id === f.nextPendingId ? 'next' : 'pending', color, 1);
    } else if (r.kind === 'hit') {
      const age = f.t - r.inputTimeMs;
      if (age < 0 || age > BURST_MS) continue;
      const k = age / BURST_MS;
      g.strokeStyle = withAlpha(judgmentColor(r.grade, hand), (1 - k) * 0.9);
      g.lineWidth = 3 * (1 - k) + 1;
      roundRect(g, cx - CAP_W / 2 - k * 18, hitY - CAP_H / 2 - k * 18, CAP_W + k * 36, CAP_H + k * 36, 8 + k * 10);
      g.stroke();
    } else if (r.kind === 'miss' || r.kind === 'wrong') {
      const fade = clamp01(1 - (y - hitY) / 90) * 0.75;
      if (fade <= 0 || y > h + CAP_H) continue;
      drawCap(g, cx, y, e.char, 'failed', color, fade);
    }
  }

  // Judgment label, under the line so incoming keys never cover it.
  if (f.flash.judgment) drawJudgment(g, f.flash.judgment, hand, f.now - f.flash.judgedAt, cx, hitY + CAP_H / 2 + 24);

  drawTimingBar(g, {
    cx,
    y: h - (w < 300 ? 38 : 30),
    availableWidth: w,
    windows: f.windows,
    now: f.now,
    recent: f.flash.recent.map((r) => ({ ...r, hand })),
  });
}

function drawCap(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  char: string,
  state: 'pending' | 'next' | 'failed',
  color: string,
  alpha: number,
): void {
  const x = cx - CAP_W / 2;
  const y = cy - CAP_H / 2;
  g.globalAlpha = alpha;
  // Keycap skirt, then the top face.
  g.fillStyle = state === 'next' ? shade(color, -0.45) : PALETTE.capEdge;
  roundRect(g, x, y + 3, CAP_W, CAP_H, 7);
  g.fill();
  g.fillStyle = state === 'next' ? color : PALETTE.cap;
  roundRect(g, x, y, CAP_W, CAP_H - 2, 7);
  g.fill();
  if (state === 'failed') {
    g.strokeStyle = PALETTE.clip;
    g.lineWidth = 1.5;
    roundRect(g, x + 0.75, y + 0.75, CAP_W - 1.5, CAP_H - 3.5, 6.5);
    g.stroke();
  }
  g.fillStyle = state === 'next' ? '#16130e' : state === 'failed' ? PALETTE.clip : color;
  g.font = `600 19px ${FONTS.mono}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(char, cx, cy - 1);
  g.globalAlpha = 1;
}
