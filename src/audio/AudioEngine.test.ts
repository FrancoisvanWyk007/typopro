import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioContext, fakeBuffer, type FakeGain, type FakeSource } from '../test/fakeAudio';
import { AudioEngine } from './AudioEngine';
import { heardContextTime } from './clock';

const LEAD = AudioEngine.LEAD_IN_SEC;

function setup() {
  const ctx = new FakeAudioContext();
  const engine = new AudioEngine(ctx as unknown as AudioContext);
  engine.setStems([
    { id: 'vocals', buffer: fakeBuffer(60) },
    { id: 'bass', buffer: fakeBuffer(60), gain: 0.4 },
    { id: 'keys', buffer: fakeBuffer(59) },
  ]);
  const live = () => ctx.sources.slice(-3) as FakeSource[];
  return { ctx, engine, live };
}

describe('AudioEngine lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts every stem on the same clock time and offset', async () => {
    const { ctx, engine, live } = setup();
    ctx.currentTime = 1;
    await engine.play();
    expect(ctx.state).toBe('running');
    expect(engine.state).toBe('playing');
    const starts = live().map((s) => s.startArgs);
    expect(new Set(starts.map((s) => JSON.stringify(s))).size).toBe(1);
    expect(starts[0]).toEqual([1 + LEAD, 0]);
  });

  it('derives position from the audio clock', async () => {
    const { ctx, engine } = setup();
    await engine.play();
    ctx.currentTime = LEAD + 12.5;
    expect(engine.getPosition()).toBeCloseTo(12.5);
  });

  it('pauses by stopping sources and resumes all stems from the paused offset', async () => {
    const { ctx, engine, live } = setup();
    await engine.play();
    ctx.currentTime = LEAD + 10;
    const first = live();
    engine.pause();
    expect(engine.state).toBe('paused');
    expect(first.every((s) => s.stopAt !== null && s.stopAt > ctx.currentTime)).toBe(true);
    ctx.currentTime = 50; // time passes while paused
    expect(engine.getPosition()).toBeCloseTo(10);
    await engine.resume();
    const second = live();
    expect(second).not.toEqual(first);
    expect(second.map((s) => s.startArgs)).toEqual(Array(3).fill([50 + LEAD, 10]));
    ctx.currentTime = 50 + LEAD + 2;
    expect(engine.getPosition()).toBeCloseTo(12);
  });

  it('restarts from zero with fresh sources', async () => {
    const { ctx, engine, live } = setup();
    await engine.play();
    ctx.currentTime = 20;
    const old = live();
    await engine.restart();
    expect(old.every((s) => s.stopAt !== null)).toBe(true);
    expect(live().map((s) => s.startArgs![1])).toEqual([0, 0, 0]);
  });

  it('fires onEnded once for the current playback and ignores stale sources', async () => {
    const { engine, live } = setup();
    const onEnded = vi.fn();
    engine.onEnded = onEnded;
    await engine.play();
    const firstLongest = live()[0];
    const staleHandler = firstLongest.onended;
    await engine.restart();
    staleHandler?.(); // a stopped source's ended event from the previous run
    expect(onEnded).not.toHaveBeenCalled();
    live()[0].onended?.();
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(engine.state).toBe('ended');
  });

  it('smooths gain changes with setTargetAtTime', () => {
    const { ctx, engine } = setup();
    ctx.currentTime = 3;
    engine.setStemGain('bass', 0.9, 0.05);
    const bassGain = ctx.gains.find((g: FakeGain) => g.gain.calls.some((c) => c.method === 'setTargetAtTime'));
    expect(bassGain?.gain.calls.at(-1)).toEqual({ method: 'setTargetAtTime', args: [0.9, 3, 0.05] });
  });

  it('fades the master out on stop and back in on start to avoid clicks', async () => {
    const { ctx, engine } = setup();
    const master = ctx.gains[0];
    await engine.play();
    expect(master.gain.calls.slice(-2).map((c) => c.method)).toEqual(['setValueAtTime', 'linearRampToValueAtTime']);
    engine.pause();
    expect(master.gain.calls.at(-1)).toMatchObject({ method: 'linearRampToValueAtTime', args: [0, AudioEngine.FADE_SEC] });
  });

  it('cleans up on dispose', async () => {
    const { ctx, engine, live } = setup();
    await engine.play();
    const sources = live();
    await engine.dispose();
    expect(engine.state).toBe('disposed');
    expect(ctx.state).toBe('closed');
    expect(sources.every((s) => s.stopAt !== null)).toBe(true);
    vi.runAllTimers();
    expect(sources.every((s) => s.disconnected)).toBe(true);
    await expect(engine.play()).rejects.toThrow(/disposed/);
  });

  it('reports post-gain stem levels from the analyser', () => {
    const { engine } = setup();
    expect(engine.getStemLevel('vocals')).toBeCloseTo(0.5);
    expect(engine.getStemLevel('nope')).toBe(0);
  });
});

describe('song time from input timestamps', () => {
  it('maps a performance timestamp through the output timestamp', async () => {
    const { ctx, engine } = setup();
    await engine.play(); // starts at LEAD
    const now = performance.now();
    ctx.currentTime = 10.05;
    ctx.outputStamp = { contextTime: 10, performanceTime: now };
    // Key pressed 100ms after the stamped sample left the speakers.
    expect(engine.songTimeAt(now + 100)).toBeCloseTo(10.1 - LEAD);
  });

  it('falls back to currentTime minus reported latency', () => {
    const r = { currentTime: 10, nowMs: 5000, latencySec: 0.025 };
    expect(heardContextTime(5000, r)).toBeCloseTo(9.975);
    expect(heardContextTime(4900, r)).toBeCloseTo(9.875);
  });

  it('rejects zeroed or implausible output timestamps', () => {
    const base = { currentTime: 10, nowMs: 5000, latencySec: 0 };
    expect(heardContextTime(5000, { ...base, stamp: { contextTime: 0, performanceTime: 0 } })).toBe(10);
    expect(heardContextTime(5000, { ...base, stamp: { contextTime: 2, performanceTime: 4990 } })).toBe(10);
    expect(heardContextTime(5000, { ...base, stamp: { contextTime: 9.97, performanceTime: 4990 } })).toBeCloseTo(9.98);
  });
});
