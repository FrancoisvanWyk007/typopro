import type { AudioEngine } from '../audio/AudioEngine';
import { GuidanceController, type GuidanceMode } from '../guidance/GuidanceController';
import type { BiasEstimatorOptions } from '../guidance/TimingBiasEstimator';
import type { GameKeyInput } from '../input/KeyboardInput';
import { RhythmEngine } from '../rhythm/RhythmEngine';
import { ScoreTracker, gainForScore, type ScoreConfig, type ScoreSummary } from '../rhythm/scoring';
import { HANDS, judgmentHand, type BeatEvent, type Hand, type HitGrade, type Judgment, type TimingWindows } from '../rhythm/types';
import type { TypingMode } from '../song/manifest';
import type { LoadedSong } from '../song/loadSong';

export type SessionStatus = 'ready' | 'playing' | 'paused' | 'finished';

/** The slice of AudioEngine the session drives (lets tests substitute a fake). */
export type SessionAudio = Pick<
  AudioEngine,
  'play' | 'pause' | 'resume' | 'stop' | 'setStemGain' | 'songTimeAt' | 'state' | 'onEnded'
>;

export interface InstrumentView {
  id: string;
  label: string;
  hand: Hand | null;
  score: number;
  /** Current gain as a fraction of the stem's base gain. */
  level: number;
}

export interface BiasView {
  estimateMs: number;
  samples: number;
  ready: boolean;
}

/** Immutable view for React; replaced whenever something visible changes. */
export interface HudSnapshot {
  status: SessionStatus;
  summary: ScoreSummary;
  instruments: InstrumentView[];
  /** Index of each hand's next unjudged event. */
  nextPending: Record<Hand, number>;
  guidanceMode: GuidanceMode;
  calibrationMs: number;
  bias: Record<Hand, BiasView>;
  cueShiftMs: Record<Hand, number>;
  /** Words finished (every letter judged) and how many of those had every letter hit. */
  words: { clean: number; done: number; total: number };
}

/** Per-lane feedback read by the canvas every frame (not React state). */
export interface LaneFlash {
  judgment: Judgment | null;
  /** performance.now() of the last judgment / keypress. */
  judgedAt: number;
  pressedAt: number;
  /** Most recent hits, oldest first, for the early/late timing bar. */
  recent: { offsetMs: number; grade: HitGrade; at: number }[];
}

const RECENT_HITS = 12;
const emptyFlash = (): LaneFlash => ({ judgment: null, judgedAt: -Infinity, pressedAt: -Infinity, recent: [] });

export interface SessionOptions {
  windows?: TimingWindows;
  scoreConfig?: ScoreConfig;
  biasOptions?: Partial<BiasEstimatorOptions>;
  guidanceMode?: GuidanceMode;
  calibrationMs?: number;
  /** Misses are declared this long after a window closes, so late-delivered key events still count. */
  missGraceMs?: number;
}

export const CALIBRATION_RANGE_MS = 300;

/**
 * Coordinates audio, rhythm matching, scoring and guidance for one song.
 * Framework-free: React subscribes via subscribe/getSnapshot and the canvas
 * polls `tick()` each animation frame. Song time always comes from the audio
 * clock; the animation frame only decides how often it is sampled.
 */
export class GameSession {
  readonly song: LoadedSong;
  readonly engine: RhythmEngine;
  readonly guidance: GuidanceController;
  readonly flash: Record<Hand, LaneFlash> = { left: emptyFlash(), right: emptyFlash() };

  private readonly audio: SessionAudio;
  private readonly tracker: ScoreTracker;
  private readonly missGraceMs: number;
  private status: SessionStatus = 'ready';
  private calibrationMs: number;
  private listeners = new Set<() => void>();
  private snapshot: HudSnapshot;
  private readonly wordGroups: BeatEvent[][];

  constructor(song: LoadedSong, audio: SessionAudio, opts: SessionOptions = {}) {
    this.song = song;
    this.audio = audio;
    this.engine = new RhythmEngine(song.events, opts.windows);
    const instruments = song.manifest.stems.filter((s) => s.role === 'instrument').map((s) => s.id);
    this.tracker = new ScoreTracker(
      instruments,
      { left: song.manifest.hands.left.instrument, right: song.manifest.hands.right.instrument },
      opts.scoreConfig,
    );
    this.guidance = new GuidanceController(opts.guidanceMode ?? 'fixed', opts.biasOptions);
    this.calibrationMs = clampCalibration(opts.calibrationMs ?? 0);
    this.missGraceMs = opts.missGraceMs ?? 50;
    // Word indices are per hand in two-lane charts and shared in a sentence.
    const groups = new Map<string, BeatEvent[]>();
    for (const e of song.events) {
      const key = song.chart.typing.mode === 'split' ? `${e.hand}:${e.word}` : String(e.word);
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    this.wordGroups = [...groups.values()];
    audio.onEnded = () => this.finish();
    this.applyAllGains();
    this.snapshot = this.buildSnapshot();
  }

  get state(): SessionStatus {
    return this.status;
  }

  get mode(): TypingMode {
    return this.song.chart.typing.mode;
  }

  /** The earliest unjudged event across both hands (the next letter of a sentence). */
  nextEvent(): BeatEvent | null {
    let next: BeatEvent | null = null;
    for (const hand of HANDS) {
      const e = this.engine.eventsFor(hand)[this.engine.nextPendingIndex(hand)];
      if (e && (!next || e.timeMs < next.timeMs)) next = e;
    }
    return next;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): HudSnapshot => this.snapshot;

  // ------------------------------------------------------------ lifecycle

  async start(): Promise<void> {
    if (this.status === 'playing' || this.status === 'paused') return;
    if (this.status === 'finished') this.resetScores();
    this.status = 'playing';
    this.emit();
    await this.audio.play(0);
  }

  pause(): void {
    if (this.status !== 'playing') return;
    this.audio.pause();
    this.status = 'paused';
    this.emit();
  }

  async resume(): Promise<void> {
    if (this.status !== 'paused') return;
    this.status = 'playing';
    this.emit();
    await this.audio.resume();
  }

  async restart(): Promise<void> {
    this.resetScores();
    this.status = 'playing';
    this.emit();
    await this.audio.play(0);
  }

  dispose(): void {
    this.audio.onEnded = null;
    this.listeners.clear();
  }

  // ------------------------------------------------------------ timing

  /** Calibrated song time (ms) the player was hearing at performance time `perfMs`. */
  songTimeMs(perfMs: number): number {
    return this.audio.songTimeAt(perfMs) * 1000 - this.calibrationMs;
  }

  /**
   * Sample the audio clock: declare expired events missed and detect the end
   * of the song. Returns the current song time for rendering.
   */
  tick(perfNow: number): number {
    const t = this.songTimeMs(perfNow);
    if (this.status === 'playing') {
      const misses = this.engine.advance(t - this.missGraceMs);
      if (misses.length) this.applyJudgments(misses, perfNow);
      if (t >= this.song.manifest.durationMs || this.audio.state === 'ended') this.finish();
    }
    return t;
  }

  handleKey(input: GameKeyInput): void {
    if (this.status !== 'playing') return;
    this.flash[input.hand].pressedAt = input.timeStamp;
    const judgments = this.engine.judge({
      timeMs: this.songTimeMs(input.timeStamp),
      hand: input.hand,
      char: input.char,
    });
    this.applyJudgments(judgments, input.timeStamp);
  }

  // ------------------------------------------------------------ settings

  setGuidanceMode(mode: GuidanceMode): void {
    this.guidance.mode = mode;
    this.emit();
  }

  setCalibration(ms: number): void {
    this.calibrationMs = clampCalibration(ms);
    this.emit();
  }

  /**
   * Fold the measured timing bias into the calibration offset. Returns the
   * new calibration, or null if there is not enough data yet.
   */
  calibrateFromBias(): number | null {
    const ready = HANDS.map((h) => this.guidance.bias(h)).filter((b) => b.ready);
    if (ready.length === 0) return null;
    const mean = ready.reduce((sum, b) => sum + b.estimateMs, 0) / ready.length;
    this.calibrationMs = clampCalibration(this.calibrationMs + mean);
    this.guidance.reset();
    this.emit();
    return this.calibrationMs;
  }

  // ------------------------------------------------------------ internals

  private finish(): void {
    if (this.status === 'finished') return;
    const rest = this.engine.advance(Infinity);
    for (const j of rest) this.tracker.apply(j);
    this.status = 'finished';
    if (this.audio.state === 'playing') this.audio.stop();
    this.emit();
  }

  private resetScores(): void {
    this.engine.reset();
    this.tracker.reset();
    for (const hand of HANDS) this.flash[hand] = emptyFlash();
    this.applyAllGains();
  }

  private applyJudgments(judgments: Judgment[], perfMs: number): void {
    const touched = new Set<string>();
    for (const j of judgments) {
      touched.add(this.tracker.apply(j));
      const hand = judgmentHand(j);
      const flash = this.flash[hand];
      if (j.kind === 'hit') {
        this.guidance.recordHit(hand, j.offsetMs);
        flash.recent.push({ offsetMs: j.offsetMs, grade: j.grade, at: perfMs });
        if (flash.recent.length > RECENT_HITS) flash.recent.shift();
      }
      flash.judgment = j;
      flash.judgedAt = perfMs;
    }
    for (const id of touched) this.applyGain(id);
    this.emit();
  }

  private applyAllGains(): void {
    for (const stem of this.song.manifest.stems) this.applyGain(stem.id);
  }

  private applyGain(stemId: string): void {
    const stem = this.song.manifest.stems.find((s) => s.id === stemId);
    if (!stem) return;
    const base = stem.gain ?? 1;
    const level = stem.role === 'instrument' ? gainForScore(this.tracker.instrumentScore(stem.id)) : 1;
    this.audio.setStemGain(stem.id, base * level);
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  private buildSnapshot(): HudSnapshot {
    const { manifest } = this.song;
    const handOf = (id: string): Hand | null =>
      HANDS.find((h) => manifest.hands[h].instrument === id) ?? null;
    return {
      status: this.status,
      summary: this.tracker.summary(),
      instruments: manifest.stems
        .filter((s) => s.role === 'instrument')
        .map((s) => {
          const score = this.tracker.instrumentScore(s.id);
          return { id: s.id, label: s.label, hand: handOf(s.id), score, level: gainForScore(score) };
        }),
      nextPending: { left: this.engine.nextPendingIndex('left'), right: this.engine.nextPendingIndex('right') },
      guidanceMode: this.guidance.mode,
      calibrationMs: this.calibrationMs,
      bias: { left: this.guidance.bias('left'), right: this.guidance.bias('right') },
      cueShiftMs: { left: this.guidance.cueShift('left'), right: this.guidance.cueShift('right') },
      words: this.wordStats(),
    };
  }

  private wordStats(): HudSnapshot['words'] {
    let clean = 0;
    let done = 0;
    for (const word of this.wordGroups) {
      const results = word.map((e) => this.engine.resultFor(e.id));
      if (!results.every(Boolean)) continue;
      done++;
      if (results.every((r) => r!.kind === 'hit')) clean++;
    }
    return { clean, done, total: this.wordGroups.length };
  }
}

function clampCalibration(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.round(Math.min(CALIBRATION_RANGE_MS, Math.max(-CALIBRATION_RANGE_MS, ms)));
}
