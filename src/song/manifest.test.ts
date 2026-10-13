import { describe, expect, it } from 'vitest';
import demo from '../../public/songs/neon-tide/manifest.json';
import { qwertyHandForChar } from '../input/keyboardLayout';
import { buildChart, scaleManifest } from './loadSong';
import { validateManifest, type SongManifest } from './manifest';

const clone = (): SongManifest => structuredClone(demo) as SongManifest;

const minimal = (): Record<string, any> => ({
  version: 2,
  id: 'x',
  title: 'X',
  artist: 'Y',
  bpm: 120,
  durationMs: 10000,
  stems: [
    { id: 'drums', label: 'Drums', role: 'instrument', source: { type: 'url', url: 'drums.ogg' } },
    { id: 'vox', label: 'Vox', role: 'auto', source: { type: 'url', url: 'vox.ogg' } },
  ],
  hands: { left: { instrument: 'drums' }, right: { instrument: 'drums' } },
  charts: [
    {
      id: 'lanes',
      label: 'Two lanes',
      typing: { mode: 'split', left: 'fast', right: 'only' },
      beatMap: [
        { t: 500, hand: 'left', instrument: 'drums' },
        { t: 500, hand: 'right', instrument: 'drums' },
        { t: 1000, hand: 'left', instrument: 'drums' },
      ],
    },
    {
      id: 'sentence',
      label: 'One sentence',
      typing: { mode: 'sentence', text: 'hi you' },
      beatMap: [
        { t: 500, hand: 'right', instrument: 'drums' },
        { t: 800, hand: 'right', instrument: 'drums' },
        { t: 1400, hand: 'right', instrument: 'drums' },
        { t: 1700, hand: 'right', instrument: 'drums' },
        { t: 2000, hand: 'right', instrument: 'drums' },
      ],
    },
  ],
});

const errorsOf = (m: unknown) => {
  const r = validateManifest(m);
  return r.ok ? [] : r.errors;
};

describe('validateManifest', () => {
  it('accepts the demo song', () => {
    expect(errorsOf(demo)).toEqual([]);
  });

  it('accepts a minimal manifest', () => {
    expect(errorsOf(minimal())).toEqual([]);
  });

  it('rejects non-objects and wrong versions', () => {
    expect(errorsOf(null)).toEqual(['manifest: expected an object']);
    expect(errorsOf({ ...minimal(), version: 1 })).toContain('version: expected 2');
  });

  it('reports missing required fields with paths', () => {
    const m = minimal();
    delete m.title;
    m.bpm = -1;
    expect(errorsOf(m)).toEqual(expect.arrayContaining(['title: expected a non-empty string', 'bpm: expected a positive number']));
  });

  it('rejects duplicate stems, bad roles, sources, gains and pans', () => {
    const m = minimal();
    m.stems = [
      { id: 'a', label: 'A', role: 'instrument', source: { type: 'url', url: 'a.ogg' }, gain: 3 },
      { id: 'a', label: 'A2', role: 'lead', source: { type: 'ftp' }, pan: 2 },
    ];
    expect(errorsOf(m)).toEqual(
      expect.arrayContaining([
        'stems[0].gain: expected 0..2',
        'stems[1].id: duplicate stem id "a"',
        'stems[1].role: expected "auto" or "instrument"',
        'stems[1].source.type: expected "synth" or "url"',
        'stems[1].pan: expected -1..1',
      ]),
    );
  });

  it('requires at least one instrument stem and hands that reference one', () => {
    const m = minimal();
    m.hands.left.instrument = 'vox';
    expect(errorsOf(m)).toContain('hands.left.instrument: expected the id of an instrument stem');
    (m.stems as { role: string }[]).forEach((s) => (s.role = 'auto'));
    expect(errorsOf(m)).toContain('stems: at least one stem must have role "instrument"');
  });

  it('requires unique, labelled charts', () => {
    const m = minimal();
    m.charts[1].id = 'lanes';
    m.charts[1].label = '';
    expect(errorsOf(m)).toEqual(
      expect.arrayContaining(['charts[1].id: duplicate chart id "lanes"', 'charts[1].label: expected a non-empty string']),
    );
    expect(errorsOf({ ...minimal(), charts: [] })).toContain('charts: expected a non-empty array');
  });

  it('rejects split sequences containing the other hand’s characters', () => {
    const m = minimal();
    m.charts[0].typing.right = 'only you and me';
    expect(errorsOf(m).find((e) => e.startsWith('charts[0].typing.right'))).toMatch(/a d e/);
  });

  it('checks sentence length and that each event is on the hand that types its letter', () => {
    const m = minimal();
    m.charts[1].beatMap[2].hand = 'left';
    expect(errorsOf(m)).toContain('charts[1].beatMap[2].hand: "y" is typed by the right hand');
    m.charts[1].typing.text = 'hi yo';
    expect(errorsOf(m)).toContain('charts[1].typing.text: has 4 letters but the beat map has 5 events');
    m.charts[1].typing.text = 'hi yo?';
    expect(errorsOf(m)).toContain('charts[1].typing.text: characters with no QWERTY key (unshifted): ?');
  });

  it('rejects unsorted, out-of-range, unknown-instrument and crowded beat events', () => {
    const m = minimal();
    m.charts[0].beatMap = [
      { t: 1000, hand: 'left', instrument: 'drums' },
      { t: 500, hand: 'left', instrument: 'drums' },
      { t: 520, hand: 'left', instrument: 'drums' },
      { t: 600, hand: 'middle', instrument: 'drums' },
      { t: 700, hand: 'right', instrument: 'vox' },
      { t: 20000, hand: 'right', instrument: 'drums' },
    ];
    expect(errorsOf(m)).toEqual(
      expect.arrayContaining([
        'charts[0].beatMap[1].t: beat map must be sorted by time',
        'charts[0].beatMap[2].t: only 20ms after the previous left-hand event (min 100ms)',
        'charts[0].beatMap[3].hand: expected "left" or "right"',
        'charts[0].beatMap[4].instrument: expected the id of an instrument stem',
        'charts[0].beatMap[5].t: after durationMs',
      ]),
    );
  });
});

describe('demo song content', () => {
  it('has at least two independently controllable instrument stems, one per hand', () => {
    const m = clone();
    const instruments = m.stems.filter((s) => s.role === 'instrument').map((s) => s.id);
    expect(instruments.length).toBeGreaterThanOrEqual(2);
    expect(m.hands.left.instrument).not.toBe(m.hands.right.instrument);
    expect(m.stems.find((s) => s.id === 'vocals')?.role).toBe('auto');
    expect(m.synthetic).toBe(true);
    expect(m.charts.map((c) => c.typing.mode)).toEqual(['split', 'sentence']);
  });

  it('two lanes: each hand’s sequence covers its events exactly once', () => {
    const chart = clone().charts.find((c) => c.typing.mode === 'split')!;
    if (chart.typing.mode !== 'split') throw new Error();
    const events = buildChart(chart);
    expect(events).toHaveLength(chart.beatMap.length);
    for (const hand of ['left', 'right'] as const) {
      const typed = events.filter((e) => e.hand === hand).map((e) => e.char).join('');
      expect(typed).toBe(chart.typing[hand].replace(/\s+/g, ''));
    }
  });

  it('one sentence: the text is typed in order, never two keys at once, each on its own side', () => {
    const chart = clone().charts.find((c) => c.typing.mode === 'sentence')!;
    if (chart.typing.mode !== 'sentence') throw new Error();
    const events = buildChart(chart);
    expect(events.map((e) => e.char).join('')).toBe(chart.typing.text.replace(/\s+/g, ''));
    expect(new Set(events.map((e) => e.timeMs)).size).toBe(events.length);
    for (const e of events) expect(e.hand).toBe(qwertyHandForChar(e.char));
    expect(events.some((e) => e.hand === 'left') && events.some((e) => e.hand === 'right')).toBe(true);
  });

  it('keeps same-character neighbours far enough apart that their windows never overlap', () => {
    for (const chart of clone().charts) {
      const events = buildChart(chart);
      for (const hand of ['left', 'right'] as const) {
        const evs = events.filter((e) => e.hand === hand);
        for (let i = 1; i < evs.length; i++) {
          if (evs[i].char === evs[i - 1].char) expect(evs[i].timeMs - evs[i - 1].timeMs).toBeGreaterThan(280);
        }
      }
    }
  });
});

describe('scaleManifest', () => {
  it('stretches tempo, duration and every beat time together', () => {
    const m = clone();
    const slow = scaleManifest(m, 0.8);
    expect(slow.bpm).toBeCloseTo(80);
    expect(slow.durationMs).toBeCloseTo(m.durationMs / 0.8);
    expect(slow.charts[1].beatMap[3].t).toBeCloseTo(m.charts[1].beatMap[3].t / 0.8);
    expect(errorsOf(slow)).toEqual([]);
    expect(m.bpm).toBe(100); // original untouched
  });

  it('refuses recorded songs, which cannot change tempo without changing pitch', () => {
    expect(() => scaleManifest({ ...clone(), synthetic: false }, 0.8)).toThrow(/synthetic/);
  });
});
