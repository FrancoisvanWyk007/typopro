import { qwertyHandForChar } from '../input/keyboardLayout';
import { sequenceWords, type RawBeatEvent } from '../input/sequences';
import { HANDS, type Hand } from '../rhythm/types';

export type StemSource = { type: 'synth'; generator: string } | { type: 'url'; url: string };

export interface StemManifest {
  id: string;
  label: string;
  /** `auto` stems always play at their base gain; `instrument` stems follow rhythm performance. */
  role: 'auto' | 'instrument';
  source: StemSource;
  /** Base linear gain (default 1). */
  gain?: number;
  /** Stereo position −1..1 (default 0). */
  pan?: number;
}

export interface HandManifest {
  /** Instrument stem this hand plays (also used to attribute stray keystrokes). */
  instrument: string;
}

/**
 * How characters are assigned to a chart's events.
 * - `split`: each hand types its own word sequence; both run at once.
 * - `sentence`: one text typed in order; each letter's QWERTY side decides
 *   the hand (and so the instrument) of its event.
 */
export type TypingSpec = { mode: 'split'; left: string; right: string } | { mode: 'sentence'; text: string };

export type TypingMode = TypingSpec['mode'];

export interface ChartManifest {
  id: string;
  label: string;
  typing: TypingSpec;
  beatMap: RawBeatEvent[];
}

export interface SongManifest {
  version: 2;
  id: string;
  title: string;
  artist: string;
  bpm: number;
  durationMs: number;
  /** True when the audio is generated rather than recorded. */
  synthetic?: boolean;
  credits?: string;
  stems: StemManifest[];
  hands: Record<Hand, HandManifest>;
  charts: ChartManifest[];
}

export type ValidationResult = { ok: true; manifest: SongManifest } | { ok: false; errors: string[] };

export interface ValidationOptions {
  /** Minimum spacing between two events on the same hand (ms). */
  minSameHandGapMs?: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const typedChars = (text: string) => [...text.replace(/\s+/g, '').toLowerCase()];

/** Structural and semantic validation of an untrusted song manifest. */
export function validateManifest(input: unknown, options: ValidationOptions = {}): ValidationResult {
  const minGap = options.minSameHandGapMs ?? 100;
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);

  if (!isObj(input)) return { ok: false, errors: ['manifest: expected an object'] };
  const m = input;

  if (m.version !== 2) err('version', 'expected 2');
  for (const key of ['id', 'title', 'artist'] as const) {
    if (!isNonEmptyString(m[key])) err(key, 'expected a non-empty string');
  }
  if (!isFiniteNum(m.bpm) || m.bpm <= 0) err('bpm', 'expected a positive number');
  if (!isFiniteNum(m.durationMs) || m.durationMs <= 0) err('durationMs', 'expected a positive number');
  if (m.synthetic !== undefined && typeof m.synthetic !== 'boolean') err('synthetic', 'expected a boolean');
  if (m.credits !== undefined && typeof m.credits !== 'string') err('credits', 'expected a string');

  // Stems
  const instrumentIds = new Set<string>();
  if (!Array.isArray(m.stems) || m.stems.length === 0) {
    err('stems', 'expected a non-empty array');
  } else {
    const seen = new Set<string>();
    m.stems.forEach((s: unknown, i) => {
      const p = `stems[${i}]`;
      if (!isObj(s)) return err(p, 'expected an object');
      if (!isNonEmptyString(s.id)) err(`${p}.id`, 'expected a non-empty string');
      else if (seen.has(s.id)) err(`${p}.id`, `duplicate stem id "${s.id}"`);
      else seen.add(s.id);
      if (!isNonEmptyString(s.label)) err(`${p}.label`, 'expected a non-empty string');
      if (s.role !== 'auto' && s.role !== 'instrument') err(`${p}.role`, 'expected "auto" or "instrument"');
      else if (s.role === 'instrument' && isNonEmptyString(s.id)) instrumentIds.add(s.id);
      if (!isObj(s.source)) err(`${p}.source`, 'expected an object');
      else if (s.source.type === 'synth') {
        if (!isNonEmptyString(s.source.generator)) err(`${p}.source.generator`, 'expected a non-empty string');
      } else if (s.source.type === 'url') {
        if (!isNonEmptyString(s.source.url)) err(`${p}.source.url`, 'expected a non-empty string');
      } else err(`${p}.source.type`, 'expected "synth" or "url"');
      if (s.gain !== undefined && (!isFiniteNum(s.gain) || s.gain < 0 || s.gain > 2)) err(`${p}.gain`, 'expected 0..2');
      if (s.pan !== undefined && (!isFiniteNum(s.pan) || s.pan < -1 || s.pan > 1)) err(`${p}.pan`, 'expected -1..1');
    });
    if (instrumentIds.size === 0) err('stems', 'at least one stem must have role "instrument"');
  }

  // Hands
  if (!isObj(m.hands)) {
    err('hands', 'expected an object with "left" and "right"');
  } else {
    for (const hand of HANDS) {
      const h = m.hands[hand];
      if (!isObj(h) || !isNonEmptyString(h.instrument) || !instrumentIds.has(h.instrument)) {
        err(`hands.${hand}.instrument`, 'expected the id of an instrument stem');
      }
    }
  }

  // Charts
  if (!Array.isArray(m.charts) || m.charts.length === 0) {
    err('charts', 'expected a non-empty array');
  } else {
    const seen = new Set<string>();
    m.charts.forEach((c: unknown, i) => {
      const p = `charts[${i}]`;
      if (!isObj(c)) return err(p, 'expected an object');
      if (!isNonEmptyString(c.id)) err(`${p}.id`, 'expected a non-empty string');
      else if (seen.has(c.id)) err(`${p}.id`, `duplicate chart id "${c.id}"`);
      else seen.add(c.id);
      if (!isNonEmptyString(c.label)) err(`${p}.label`, 'expected a non-empty string');
      const beatOk = validateBeatMap(c.beatMap, `${p}.beatMap`, m.durationMs, instrumentIds, minGap, err);
      validateTyping(c.typing, `${p}.typing`, beatOk ? (c.beatMap as RawBeatEvent[]) : null, `${p}.beatMap`, err);
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true, manifest: input as unknown as SongManifest };
}

function validateTyping(
  typing: unknown,
  p: string,
  beatMap: RawBeatEvent[] | null,
  beatPath: string,
  err: (path: string, msg: string) => void,
): void {
  if (!isObj(typing)) return err(p, 'expected an object');

  if (typing.mode === 'split') {
    for (const hand of HANDS) {
      const text = typing[hand];
      if (!isNonEmptyString(text) || sequenceWords(text).length === 0) {
        err(`${p}.${hand}`, 'expected at least one word');
        continue;
      }
      const wrongHand = [...new Set(typedChars(text))].filter((ch) => qwertyHandForChar(ch) !== hand);
      if (wrongHand.length) err(`${p}.${hand}`, `characters not typed by the ${hand} hand on QWERTY: ${wrongHand.join(' ')}`);
    }
    return;
  }

  if (typing.mode === 'sentence') {
    if (!isNonEmptyString(typing.text)) return err(`${p}.text`, 'expected at least one word');
    const chars = typedChars(typing.text);
    const untypeable = [...new Set(chars)].filter((ch) => qwertyHandForChar(ch) === null);
    if (untypeable.length) return err(`${p}.text`, `characters with no QWERTY key (unshifted): ${untypeable.join(' ')}`);
    if (!beatMap) return;
    if (chars.length !== beatMap.length) {
      return err(`${p}.text`, `has ${chars.length} letters but the beat map has ${beatMap.length} events`);
    }
    chars.forEach((ch, i) => {
      const hand = qwertyHandForChar(ch);
      if (beatMap[i].hand !== hand) err(`${beatPath}[${i}].hand`, `"${ch}" is typed by the ${hand} hand`);
    });
    return;
  }

  err(`${p}.mode`, 'expected "split" or "sentence"');
}

/** Returns true if the beat map is structurally valid (so typing can be checked against it). */
function validateBeatMap(
  beatMap: unknown,
  p: string,
  durationMs: unknown,
  instrumentIds: Set<string>,
  minGap: number,
  err: (path: string, msg: string) => void,
): boolean {
  if (!Array.isArray(beatMap) || beatMap.length === 0) {
    err(p, 'expected a non-empty array');
    return false;
  }
  let ok = true;
  const lastByHand: Partial<Record<Hand, number>> = {};
  let prevT = -Infinity;
  beatMap.forEach((e: unknown, i) => {
    const ep = `${p}[${i}]`;
    if (!isObj(e)) {
      ok = false;
      return err(ep, 'expected an object');
    }
    const t = isFiniteNum(e.t) && e.t >= 0 ? e.t : null;
    if (t === null) {
      ok = false;
      err(`${ep}.t`, 'expected a non-negative number (ms)');
    } else if (isFiniteNum(durationMs) && t > durationMs) err(`${ep}.t`, 'after durationMs');
    const handOk = e.hand === 'left' || e.hand === 'right';
    if (!handOk) {
      ok = false;
      err(`${ep}.hand`, 'expected "left" or "right"');
    }
    if (!isNonEmptyString(e.instrument) || !instrumentIds.has(e.instrument)) {
      err(`${ep}.instrument`, 'expected the id of an instrument stem');
    }
    if (t !== null) {
      if (t < prevT) err(`${ep}.t`, 'beat map must be sorted by time');
      prevT = t;
      if (handOk) {
        const hand = e.hand as Hand;
        const last = lastByHand[hand];
        if (last !== undefined && t - last < minGap) {
          err(`${ep}.t`, `only ${Math.round(t - last)}ms after the previous ${hand}-hand event (min ${minGap}ms)`);
        }
        lastByHand[hand] = t;
      }
    }
  });
  return ok;
}

export function findChart(manifest: SongManifest, chartId: string | undefined): ChartManifest {
  return manifest.charts.find((c) => c.id === chartId) ?? manifest.charts[0];
}
