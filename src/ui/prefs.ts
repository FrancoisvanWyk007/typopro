import type { GuidanceMode } from '../guidance/GuidanceController';

export const SPEEDS = [0.7, 0.85, 1] as const;

export interface Prefs {
  guidance: GuidanceMode;
  calibrationMs: number;
  /** Chart id; undefined = the song's first chart. */
  chartId?: string;
  /** Tempo multiplier for synthetic songs. */
  speed: number;
}

const KEY = 'typopro.prefs';
const DEFAULTS: Prefs = { guidance: 'fixed', calibrationMs: 0, speed: 1 };

/** Per-browser conveniences only; the game works the same without storage. */
export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      guidance: raw.guidance === 'adaptive' ? 'adaptive' : 'fixed',
      calibrationMs: Number.isFinite(raw.calibrationMs) ? raw.calibrationMs : 0,
      chartId: typeof raw.chartId === 'string' ? raw.chartId : undefined,
      speed: (SPEEDS as readonly number[]).includes(raw.speed) ? raw.speed : 1,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(patch: Partial<Prefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    // storage unavailable (private mode etc.)
  }
}
