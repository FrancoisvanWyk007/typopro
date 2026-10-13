import { heardContextTime, type ClockReading } from './clock';

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'ended' | 'disposed';

export interface StemInput {
  id: string;
  buffer: AudioBuffer;
  /** Initial linear gain. */
  gain?: number;
  pan?: number;
}

interface Channel {
  id: string;
  buffer: AudioBuffer;
  gain: GainNode;
  panner: StereoPannerNode;
  analyser: AnalyserNode;
  source: AudioBufferSourceNode | null;
}

/**
 * Synchronized multi-stem player on a single AudioContext.
 *
 * Graph: source → gain → panner → analyser → master → limiter → destination.
 * Every stem's AudioBufferSourceNode is started with the same `when` and
 * `offset`, so they stay sample-aligned. Pause stops the sources and remembers
 * the position; resume creates fresh sources (they are one-shot) at that offset.
 *
 * The AudioContext clock is the only source of truth for song position.
 */
export class AudioEngine {
  /** Scheduling lead so every source starts on the same, not-yet-rendered frame. */
  static readonly LEAD_IN_SEC = 0.06;
  /** Master fade used on start/stop to avoid clicks. */
  static readonly FADE_SEC = 0.012;

  readonly ctx: AudioContext;
  state: PlaybackState = 'idle';
  onEnded: (() => void) | null = null;

  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private channels = new Map<string, Channel>();
  private startAt = 0;
  private startOffset = 0;
  private pausedAt = 0;
  private generation = 0;
  private levelScratch: Float32Array<ArrayBuffer> = new Float32Array(256);

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -4;
    this.limiter.knee.value = 4;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
  }

  /** Song length = longest stem. */
  get duration(): number {
    let d = 0;
    for (const ch of this.channels.values()) d = Math.max(d, ch.buffer.duration);
    return d;
  }

  setStems(stems: readonly StemInput[]): void {
    this.assertUsable();
    this.stopSources();
    for (const ch of this.channels.values()) this.disconnectChannel(ch);
    this.channels.clear();
    for (const s of stems) {
      const gain = this.ctx.createGain();
      gain.gain.value = s.gain ?? 1;
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = s.pan ?? 0;
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 256;
      gain.connect(panner);
      panner.connect(analyser);
      analyser.connect(this.master);
      this.channels.set(s.id, { id: s.id, buffer: s.buffer, gain, panner, analyser, source: null });
    }
    this.state = 'idle';
    this.pausedAt = 0;
  }

  async play(fromSec = 0): Promise<void> {
    this.assertUsable();
    await this.ensureRunning();
    this.stopSources();
    this.startSources(fromSec);
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.pausedAt = this.getPosition();
    this.stopSources();
    this.state = 'paused';
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    await this.ensureRunning();
    if (this.state !== 'paused') return; // paused/disposed again while awaiting
    this.startSources(this.pausedAt);
  }

  restart(): Promise<void> {
    return this.play(0);
  }

  stop(): void {
    if (this.state === 'disposed') return;
    this.stopSources();
    this.pausedAt = 0;
    this.state = 'idle';
  }

  /** Smoothly move a stem's gain toward `value` (exponential approach). */
  setStemGain(id: string, value: number, timeConstant = 0.05): void {
    const ch = this.channels.get(id);
    if (!ch || this.state === 'disposed') return;
    ch.gain.gain.setTargetAtTime(value, this.ctx.currentTime, timeConstant);
  }

  /** RMS level (0..1) of a stem's post-gain signal, for activity meters. */
  getStemLevel(id: string): number {
    const ch = this.channels.get(id);
    if (!ch) return 0;
    if (this.levelScratch.length !== ch.analyser.fftSize) this.levelScratch = new Float32Array(ch.analyser.fftSize);
    ch.analyser.getFloatTimeDomainData(this.levelScratch);
    let sum = 0;
    for (const v of this.levelScratch) sum += v * v;
    return Math.sqrt(sum / this.levelScratch.length);
  }

  /** Song position (s) of the audio currently being *rendered* (not yet heard). */
  getPosition(): number {
    switch (this.state) {
      case 'playing':
        return Math.max(0, this.ctx.currentTime - this.startAt + this.startOffset);
      case 'paused':
        return this.pausedAt;
      case 'ended':
        return this.duration;
      default:
        return 0;
    }
  }

  /**
   * Song position (s) the player was *hearing* at performance time `perfMs`
   * (e.g. a KeyboardEvent.timeStamp). Accounts for output latency.
   */
  songTimeAt(perfMs: number): number {
    if (this.state !== 'playing') return this.getPosition();
    // Until the first scheduled frame is audible the heard position is the start offset.
    return Math.max(this.startOffset, heardContextTime(perfMs, this.clockReading()) - this.startAt + this.startOffset);
  }

  async dispose(): Promise<void> {
    if (this.state === 'disposed') return;
    this.stopSources();
    for (const ch of this.channels.values()) this.disconnectChannel(ch);
    this.channels.clear();
    this.master.disconnect();
    this.limiter.disconnect();
    this.state = 'disposed';
    this.onEnded = null;
    if (this.ctx.state !== 'closed') await this.ctx.close();
  }

  private clockReading(): ClockReading {
    const ctx = this.ctx;
    const stamp = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : undefined;
    return {
      stamp: stamp && stamp.contextTime !== undefined && stamp.performanceTime !== undefined
        ? { contextTime: stamp.contextTime, performanceTime: stamp.performanceTime }
        : undefined,
      currentTime: ctx.currentTime,
      nowMs: performance.now(),
      latencySec: (ctx.outputLatency || 0) + (ctx.baseLatency || 0),
    };
  }

  private async ensureRunning(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  private startSources(offset: number): void {
    const gen = ++this.generation;
    const when = this.ctx.currentTime + AudioEngine.LEAD_IN_SEC;
    const g = this.master.gain;
    // Keep any fade-out scheduled before `when`; fade back in from silence.
    g.cancelScheduledValues(when);
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(1, when + AudioEngine.FADE_SEC);

    let longest: AudioBufferSourceNode | null = null;
    let longestDuration = -1;
    for (const ch of this.channels.values()) {
      const src = this.ctx.createBufferSource();
      src.buffer = ch.buffer;
      src.connect(ch.gain);
      if (offset < ch.buffer.duration) src.start(when, offset);
      ch.source = src;
      if (ch.buffer.duration > longestDuration) {
        longestDuration = ch.buffer.duration;
        longest = src;
      }
    }
    if (longest) {
      longest.onended = () => {
        // Sources also fire `ended` when stopped on pause/restart; ignore stale generations.
        if (gen !== this.generation || this.state !== 'playing') return;
        this.state = 'ended';
        this.onEnded?.();
      };
    }
    this.startAt = when;
    this.startOffset = offset;
    this.state = 'playing';
  }

  private stopSources(): void {
    this.generation++;
    const now = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + AudioEngine.FADE_SEC);
    for (const ch of this.channels.values()) {
      const src = ch.source;
      if (!src) continue;
      src.onended = null;
      try {
        src.stop(now + AudioEngine.FADE_SEC + 0.005);
      } catch {
        // never started (offset beyond buffer end)
      }
      setTimeoutSafe(() => src.disconnect(), 100);
      ch.source = null;
    }
  }

  private disconnectChannel(ch: Channel): void {
    ch.gain.disconnect();
    ch.panner.disconnect();
    ch.analyser.disconnect();
  }

  private assertUsable(): void {
    if (this.state === 'disposed') throw new Error('AudioEngine has been disposed');
  }
}

function setTimeoutSafe(fn: () => void, ms: number): void {
  setTimeout(() => {
    try {
      fn();
    } catch {
      // node already disconnected
    }
  }, ms);
}
