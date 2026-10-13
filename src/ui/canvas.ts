import { judgmentKind, type Hand, type HitGrade, type Judgment, type TimingWindows } from '../rhythm/types';
import { FONTS, JUDGMENT_LABEL, PALETTE, judgmentColor } from './palette';

/** Shared canvas pieces for the lanes and the sentence stage. */

export const JUDGMENT_MS = 650;
const RECENT_FADE_MS = 5000;

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp01(a).toFixed(3)})`;
}

export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(Math.min(255, Math.max(0, v * (1 + k))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function judgmentDetail(j: Judgment): string | null {
  if (j.kind === 'wrong') return `typed “${j.typed}”, needed “${j.event.char}”`;
  if (j.kind === 'stray') return `no note for “${j.typed}”`;
  if (j.kind !== 'hit' || j.grade === 'perfect') return null;
  const ms = Math.round(Math.abs(j.offsetMs));
  return `${ms} ms ${j.offsetMs < 0 ? 'early' : 'late'}`;
}

/** "GREAT / 23 ms late", fading out over JUDGMENT_MS. */
export function drawJudgment(
  g: CanvasRenderingContext2D,
  j: Judgment,
  hand: Hand,
  ageMs: number,
  x: number,
  y: number,
): void {
  if (ageMs < 0 || ageMs >= JUDGMENT_MS) return;
  const kind = judgmentKind(j);
  const alpha = 1 - Math.pow(ageMs / JUDGMENT_MS, 2);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = withAlpha(judgmentColor(kind, hand), alpha);
  g.font = `700 13px ${FONTS.label}`;
  g.letterSpacing = '2px';
  g.fillText(JUDGMENT_LABEL[kind], x, y);
  g.letterSpacing = '0px';
  const detail = judgmentDetail(j);
  if (detail) {
    g.font = `500 10.5px ${FONTS.mono}`;
    g.fillStyle = withAlpha(PALETTE.legendDim, alpha);
    g.fillText(detail, x, y + 15);
  }
}

export interface RecentHit {
  offsetMs: number;
  grade: HitGrade;
  at: number;
  hand: Hand;
}

/** Early ← | → late bar with the last few hits, like a hit-error meter. */
export function drawTimingBar(
  g: CanvasRenderingContext2D,
  opts: { cx: number; y: number; availableWidth: number; windows: TimingWindows; now: number; recent: RecentHit[] },
): void {
  const { cx, y, windows, now } = opts;
  // Labels sit beside the bar when there is room, underneath it when narrow.
  const narrow = opts.availableWidth < 300;
  const half = narrow ? opts.availableWidth / 2 - 18 : Math.min(opts.availableWidth / 2 - 62, 110);
  const scale = half / windows.good;
  g.fillStyle = 'rgba(232,227,211,0.06)';
  g.fillRect(cx - half, y - 5, half * 2, 10);
  g.fillStyle = 'rgba(232,227,211,0.08)';
  g.fillRect(cx - windows.great * scale, y - 5, windows.great * scale * 2, 10);
  g.fillStyle = 'rgba(232,227,211,0.12)';
  g.fillRect(cx - windows.perfect * scale, y - 5, windows.perfect * scale * 2, 10);
  g.fillStyle = PALETTE.legendDim;
  g.fillRect(cx - 0.5, y - 9, 1, 18);

  for (const r of opts.recent) {
    const age = now - r.at;
    if (age > RECENT_FADE_MS) continue;
    g.fillStyle = withAlpha(judgmentColor(r.grade, r.hand), 0.9 * (1 - age / RECENT_FADE_MS));
    g.fillRect(Math.round(cx + r.offsetMs * scale) - 1, y - 7, 2, 14);
  }

  g.font = `600 9px ${FONTS.label}`;
  g.letterSpacing = '1.5px';
  g.fillStyle = PALETTE.legendFaint;
  g.textBaseline = 'middle';
  if (narrow) {
    g.textAlign = 'left';
    g.fillText('EARLY', cx - half, y + 17);
    g.textAlign = 'right';
    g.fillText('LATE', cx + half, y + 17);
  } else {
    g.textAlign = 'right';
    g.fillText('EARLY', cx - half - 6, y);
    g.textAlign = 'left';
    g.fillText('LATE', cx + half + 6, y);
  }
  g.letterSpacing = '0px';
}
