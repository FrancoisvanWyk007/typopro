import { describe, expect, it, vi } from 'vitest';
import type { PlaybackState } from '../audio/AudioEngine';
import type { ChartManifest, SongManifest } from '../song/manifest';
import { buildChart, type LoadedSong } from '../song/loadSong';
import { GameSession, type SessionAudio } from './GameSession';

const chart: ChartManifest = {
  id: 'lanes',
  label: 'Two lanes',
  typing: { mode: 'split', left: 'fad', right: 'jk' },
  beatMap: [
    { t: 1000, hand: 'left', instrument: 'bass' },
    { t: 1000, hand: 'right', instrument: 'keys' },
    { t: 1600, hand: 'left', instrument: 'bass' },
    { t: 2200, hand: 'left', instrument: 'bass' },
    { t: 2200, hand: 'right', instrument: 'keys' },
  ],
};

const manifest: SongManifest = {
  version: 2,
  id: 't',
  title: 'T',
  artist: 'A',
  bpm: 100,
  durationMs: 5000,
  stems: [
    { id: 'vocals', label: 'Voice', role: 'auto', source: { type: 'synth', generator: 'x' }, gain: 0.8 },
    { id: 'bass', label: 'Bass', role: 'instrument', source: { type: 'synth', generator: 'x' } },
    { id: 'keys', label: 'Keys', role: 'instrument', source: { type: 'synth', generator: 'x' } },
  ],
  hands: { left: { instrument: 'bass' }, right: { instrument: 'keys' } },
  charts: [chart],
};

/** Fake audio whose song clock is set directly by the test (1 perf ms = 1 song ms). */
class FakeAudio implements SessionAudio {
  state: PlaybackState = 'idle';
  onEnded: (() => void) | null = null;
  origin = 0;
  gains = new Map<string, number>();
  play = vi.fn(async (_from?: number) => {
    this.state = 'playing';
  });
  pause = vi.fn(() => {
    this.state = 'paused';
  });
  resume = vi.fn(async () => {
    this.state = 'playing';
  });
  stop = vi.fn(() => {
    this.state = 'idle';
  });
  setStemGain = vi.fn((id: string, v: number) => {
    this.gains.set(id, v);
  });
  songTimeAt = (perfMs: number) => (perfMs - this.origin) / 1000;
}

function setup(opts = {}, c: ChartManifest = chart) {
  const song: LoadedSong = { manifest: { ...manifest, charts: [c] }, chart: c, events: buildChart(c), buffers: new Map() };
  const audio = new FakeAudio();
  const session = new GameSession(song, audio, opts);
  const key = (hand: 'left' | 'right', char: string, at: number) =>
    session.handleKey({ hand, char, code: '', timeStamp: at });
  return { session, audio, key };
}

describe('GameSession', () => {
  it('sets initial gains: auto stems at base gain, instruments from the initial score', () => {
    const { audio } = setup();
    expect(audio.gains.get('vocals')).toBe(0.8);
    expect(audio.gains.get('bass')).toBeLessThan(0.3);
    expect(audio.gains.get('bass')).toBe(audio.gains.get('keys'));
  });

  it('ignores keys until playing', () => {
    const { session, key } = setup();
    key('left', 'f', 1000);
    expect(session.getSnapshot().summary.judged).toBe(0);
  });

  it('mixes each hand instrument independently', async () => {
    const { session, audio, key } = setup();
    await session.start();
    const keysBefore = audio.gains.get('keys')!;
    const bassBefore = audio.gains.get('bass')!;
    key('left', 'f', 1005);
    key('left', 'a', 1598); // right-hand event at 1000 expires unplayed by now
    key('left', 'd', 2210);
    expect(audio.gains.get('bass')).toBeGreaterThan(bassBefore);
    expect(audio.gains.get('keys')).toBeLessThan(keysBefore);
    const { hands } = session.getSnapshot().summary;
    expect(hands.left).toMatchObject({ judged: 3, accuracy: 1 });
    expect(hands.right).toMatchObject({ judged: 1, accuracy: 0 });
  });

  it('lowers an instrument when its events are missed with no input', async () => {
    const { session, audio } = setup();
    await session.start();
    const before = audio.gains.get('keys')!;
    session.tick(1300);
    expect(audio.gains.get('keys')).toBeLessThan(before);
    expect(session.getSnapshot().summary.counts.miss).toBe(2); // L and R at 1000
  });

  it('applies calibration to the song clock', async () => {
    const { session, key } = setup({ calibrationMs: 100 });
    await session.start();
    key('left', 'f', 1100); // heard 1100, calibrated to 1000
    expect(session.flash.left.judgment).toMatchObject({ kind: 'hit', grade: 'perfect', offsetMs: 0 });
  });

  it('feeds valid hits to the guidance estimator and only shifts cues in adaptive mode', async () => {
    const { session, key } = setup({ biasOptions: { minSamples: 2 } });
    await session.start();
    key('left', 'f', 1030);
    key('left', 'a', 1630);
    expect(session.getSnapshot().bias.left).toMatchObject({ estimateMs: 30, ready: true });
    expect(session.getSnapshot().cueShiftMs.left).toBe(0);
    session.setGuidanceMode('adaptive');
    expect(session.getSnapshot().cueShiftMs.left).toBe(30);
    // Scoring is unaffected by the visual shift.
    key('left', 'd', 2200);
    expect(session.flash.left.judgment).toMatchObject({ grade: 'perfect', offsetMs: 0 });
  });

  it('folds measured bias into calibration', async () => {
    const { session, key } = setup({ biasOptions: { minSamples: 2 } });
    await session.start();
    key('left', 'f', 1040);
    key('left', 'a', 1640);
    expect(session.calibrateFromBias()).toBe(40);
    expect(session.getSnapshot().bias.left.samples).toBe(0);
    key('left', 'd', 2240); // same habit, now judged on time
    expect(session.flash.left.judgment).toMatchObject({ grade: 'perfect', offsetMs: 0 });
    expect(session.flash.left.recent.map((r) => r.offsetMs)).toEqual([40, 40, 0]);
    expect(session.calibrateFromBias()).toBeNull(); // estimator was reset
  });

  it('pauses, resumes and finishes, marking remaining events as missed', async () => {
    const { session, audio } = setup();
    const listener = vi.fn();
    session.subscribe(listener);
    await session.start();
    session.pause();
    expect(audio.pause).toHaveBeenCalled();
    expect(session.state).toBe('paused');
    await session.resume();
    expect(session.state).toBe('playing');
    session.tick(5000);
    expect(session.state).toBe('finished');
    expect(session.getSnapshot().summary.judged).toBe(5);
    expect(audio.stop).toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();
  });

  it('finishes when the audio ends and restarts cleanly', async () => {
    const { session, audio, key } = setup();
    await session.start();
    key('right', 'j', 1000);
    audio.state = 'ended';
    audio.onEnded?.();
    expect(session.state).toBe('finished');
    await session.restart();
    expect(audio.play).toHaveBeenLastCalledWith(0);
    expect(session.getSnapshot().summary).toMatchObject({ judged: 0, combo: 0 });
    expect(session.engine.resultFor(session.song.events[0].id)).toBeUndefined();
  });

  it('reports the next letter across both hands in sentence mode', async () => {
    const sentence: ChartManifest = {
      id: 'sentence',
      label: 'One sentence',
      typing: { mode: 'sentence', text: 'hi ya' },
      beatMap: [
        { t: 1000, hand: 'right', instrument: 'keys' },
        { t: 1300, hand: 'right', instrument: 'keys' },
        { t: 1900, hand: 'right', instrument: 'keys' },
        { t: 2200, hand: 'left', instrument: 'bass' },
      ],
    };
    const { session, key } = setup({}, sentence);
    expect(session.mode).toBe('sentence');
    await session.start();
    expect(session.nextEvent()).toMatchObject({ char: 'h', hand: 'right' });
    key('right', 'h', 1000);
    key('right', 'i', 1300);
    key('right', 'y', 1900);
    expect(session.nextEvent()).toMatchObject({ char: 'a', hand: 'left' });
    key('left', 'a', 2200);
    expect(session.nextEvent()).toBeNull();
    expect(session.getSnapshot().summary.combo).toBe(4);
    expect(session.getSnapshot().words).toEqual({ clean: 2, done: 2, total: 2 });
  });

  it('counts clean words: finished words whose letters were all hit', async () => {
    const { session, key } = setup(); // left "fad" (one word), right "jk" (one word)
    expect(session.getSnapshot().words).toEqual({ clean: 0, done: 0, total: 2 });
    await session.start();
    key('left', 'f', 1000);
    key('right', 'j', 1000);
    key('left', 'a', 1600);
    expect(session.getSnapshot().words).toEqual({ clean: 0, done: 0, total: 2 });
    key('left', 'd', 2200);
    key('right', 'x', 2200); // wrong key spoils the right-hand word
    expect(session.getSnapshot().words).toEqual({ clean: 1, done: 2, total: 2 });
    expect(session.getSnapshot().summary.counts).toMatchObject({ perfect: 4, wrong: 1, miss: 0 });
  });
});
