import type { LaneFlash } from '../game/GameSession';
import { HANDS, type BeatEvent, type Hand, type Judgment, type TimingWindows } from '../rhythm/types';
import { drawJudgment, drawTimingBar, withAlpha, type RecentHit } from './canvas';
import { FONTS, PALETTE } from './palette';
import { columnAt, type TextTrack } from './textTrack';

const PRESS_MS = 140;
const POP_MS = 170;
const WORD_FLASH_MS = 380;
const NOW_FRACTION = 0.36;
const DONE_COLOR = '#878980';

export interface StageFrame {
  w: number;
  h: number;
  dpr: number;
  /** Calibrated song time (ms). */
  t: number;
  /** performance.now() of this frame. */
  now: number;
  track: TextTrack;
  resultFor: (id: string) => Judgment | undefined;
  next: BeatEvent | null;
  /** Adaptive guidance: the line is drawn this many ms early. Visual only. */
  cueShiftMs: number;
  flash: Record<Hand, LaneFlash>;
  windows: TimingWindows;
}

let measured = { font: '', width: 0 };

/**
 * Sentence mode: the text scrolls right-to-left through a fixed caret; each
 * letter reaches the caret exactly on its beat.
 */
export function drawSentence(g: CanvasRenderingContext2D, f: StageFrame): void {
  const { w, h, track } = f;
  g.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const size = Math.round(Math.min(46, Math.max(26, w / 20)));
  const font = `500 ${size}px ${FONTS.mono}`;
  g.font = font;
  if (measured.font !== font) measured = { font, width: g.measureText('m').width };
  const colW = measured.width;
  const nowX = Math.round(w * NOW_FRACTION);
  // Text, judgment and timing bar form one cluster, centred vertically, so the eyes stay in one band.
  const caretHalf = size * 0.82;
  const narrow = w < 300;
  const below = caretHalf + 92 + (narrow ? 17 : 0);
  const mid = Math.round(Math.max(caretHalf + 12, h / 2 - (below - caretHalf) / 2));
  const judgmentY = mid + caretHalf + 30;
  const barY = judgmentY + 52;
  const pos = columnAt(track, f.t + f.cueShiftMs);
  const xOf = (col: number) => nowX + (col - pos) * colW;

  // Caret flash in the colour of the hand that last pressed.
  const presser = HANDS.reduce((a, b) => (f.flash[b].pressedAt > f.flash[a].pressedAt ? b : a));
  const pressAge = f.now - f.flash[presser].pressedAt;
  const press = pressAge >= 0 && pressAge < PRESS_MS ? 1 - pressAge / PRESS_MS : 0;
  if (press > 0) {
    g.fillStyle = withAlpha(PALETTE.hand[presser], 0.16 * press);
    g.beginPath();
    g.roundRect(nowX - colW * 0.75, mid - size * 0.95, colW * 1.5, size * 1.9, 8);
    g.fill();
  }

  // Current word bracket.
  const current = f.next ? track.words.find((wd) => wd.word === f.next!.word) : undefined;
  if (current) {
    const x0 = xOf(current.firstCol) - colW / 2;
    const x1 = xOf(current.lastCol) + colW / 2;
    g.fillStyle = 'rgba(232,227,211,0.38)';
    g.fillRect(x0, mid + size * 0.66, x1 - x0, 2);
  }

  // Letters.
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const wd of track.words) {
    if (xOf(wd.lastCol) < -colW || xOf(wd.firstCol) > w + colW) continue;
    const isCurrent = wd === current;
    const flash = cleanWordFlash(wd.letters.map((l) => f.resultFor(l.event.id)), f.t);
    for (const { event, col } of wd.letters) {
      const x = xOf(col);
      const r = f.resultFor(event.id);
      let color: string;
      let alpha = 1;
      let scale = 1;
      if (!r) {
        color = PALETTE.hand[event.hand];
        alpha = event === f.next ? 1 : isCurrent ? 0.85 : 0.5;
      } else if (r.kind === 'hit') {
        const age = f.t - r.inputTimeMs;
        if (age >= 0 && age < POP_MS) {
          color = PALETTE.legend;
          scale = 1 + 0.22 * (1 - age / POP_MS);
        } else {
          color = flash > 0 ? PALETTE.legend : DONE_COLOR;
          alpha = flash > 0 ? 0.55 + 0.45 * flash : 1;
        }
      } else {
        color = PALETTE.clip;
        alpha = 0.85;
      }
      g.font = scale === 1 ? font : `600 ${Math.round(size * scale)}px ${FONTS.mono}`;
      g.fillStyle = withAlpha(color, alpha);
      g.fillText(event.char, x, mid);
    }
  }
  g.font = font;

  // Fade the text into the background at both edges.
  edgeFade(g, 0, w * 0.12, h, 'in');
  edgeFade(g, w * 0.82, w, h, 'out');

  // The caret: an I-beam, i.e. a text cursor, as the hit line.
  const top = mid - caretHalf;
  const bottom = mid + caretHalf;
  const caretColor = press > 0 ? PALETTE.hand[presser] : PALETTE.legend;
  g.fillStyle = withAlpha(caretColor, 0.35 + 0.55 * press);
  g.fillRect(nowX - 1, top, 2, bottom - top);
  g.fillRect(nowX - 6, top, 12, 2);
  g.fillRect(nowX - 6, bottom - 2, 12, 2);

  // Latest judgment from either hand, under the caret.
  const latest = HANDS.reduce((a, b) => (f.flash[b].judgedAt > f.flash[a].judgedAt ? b : a));
  const j = f.flash[latest].judgment;
  if (j) drawJudgment(g, j, latest, f.now - f.flash[latest].judgedAt, nowX, judgmentY);

  const recent: RecentHit[] = HANDS.flatMap((hand) => f.flash[hand].recent.map((r) => ({ ...r, hand })));
  drawTimingBar(g, {
    cx: w < 640 ? w / 2 : nowX,
    y: barY,
    availableWidth: w < 640 ? w : nowX * 2,
    windows: f.windows,
    now: f.now,
    recent,
  });
}

/** 0..1 while a word whose letters were all hit is celebrating, else 0. */
function cleanWordFlash(results: (Judgment | undefined)[], t: number): number {
  let lastHit = -Infinity;
  for (const r of results) {
    if (!r || r.kind !== 'hit') return 0;
    lastHit = Math.max(lastHit, r.inputTimeMs);
  }
  const age = t - lastHit;
  return age >= 0 && age < WORD_FLASH_MS ? 1 - age / WORD_FLASH_MS : 0;
}

function edgeFade(g: CanvasRenderingContext2D, x0: number, x1: number, h: number, dir: 'in' | 'out'): void {
  const grad = g.createLinearGradient(x0, 0, x1, 0);
  const solid = withAlpha(PALETTE.groove, 1);
  const clear = withAlpha(PALETTE.groove, 0);
  grad.addColorStop(0, dir === 'in' ? solid : clear);
  grad.addColorStop(1, dir === 'in' ? clear : solid);
  g.fillStyle = grad;
  g.fillRect(x0, 0, x1 - x0, h);
}
