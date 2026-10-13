import type { Hand, JudgmentKind } from '../rhythm/types';

/** Canvas mirror of the CSS tokens in styles.css. */
export const PALETTE = {
  groove: '#141615',
  cap: '#2b2f2d',
  capEdge: '#0e0f0f',
  legend: '#e8e3d3',
  legendDim: '#9c9d92',
  legendFaint: '#64675f',
  clip: '#e5574a',
  hand: { left: '#f2a63a', right: '#7db8f2' } as Record<Hand, string>,
};

export const FONTS = {
  label: '"Archivo Variable", Archivo, system-ui, sans-serif',
  mono: '"Martian Mono Variable", ui-monospace, "SF Mono", Menlo, monospace',
};

export const JUDGMENT_LABEL: Record<JudgmentKind, string> = {
  perfect: 'PERFECT',
  great: 'GREAT',
  good: 'GOOD',
  wrong: 'WRONG KEY',
  miss: 'MISS',
  stray: 'EXTRA',
};

export function judgmentColor(kind: JudgmentKind, hand: Hand): string {
  switch (kind) {
    case 'perfect':
      return PALETTE.legend;
    case 'great':
    case 'good':
      return PALETTE.hand[hand];
    case 'stray':
      return PALETTE.legendFaint;
    default:
      return PALETTE.clip;
  }
}
