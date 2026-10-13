export interface BiasEstimatorOptions {
  /** How many recent samples to keep. */
  windowSize: number;
  /** Samples required before an estimate is reported. */
  minSamples: number;
  /** Absolute bound on the reported estimate (ms). */
  maxBiasMs: number;
  /** Fraction of samples dropped from each end before averaging (outlier guard). */
  trimFraction: number;
}

export const DEFAULT_BIAS_OPTIONS: BiasEstimatorOptions = {
  windowSize: 16,
  minSamples: 6,
  maxBiasMs: 60,
  trimFraction: 0.2,
};

/**
 * Estimates a player's systematic timing bias (positive = late) as the
 * trimmed mean of recent valid hit offsets, clamped to ±maxBiasMs.
 */
export class TimingBiasEstimator {
  readonly options: BiasEstimatorOptions;
  private samples: number[] = [];

  constructor(options: Partial<BiasEstimatorOptions> = {}) {
    this.options = { ...DEFAULT_BIAS_OPTIONS, ...options };
  }

  add(offsetMs: number): void {
    if (!Number.isFinite(offsetMs)) return;
    this.samples.push(offsetMs);
    if (this.samples.length > this.options.windowSize) this.samples.shift();
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  get ready(): boolean {
    return this.samples.length >= this.options.minSamples;
  }

  /** Trimmed-mean bias in ms, or 0 until enough samples exist. */
  estimate(): number {
    if (!this.ready) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const k = Math.floor(sorted.length * this.options.trimFraction);
    const kept = sorted.slice(k, sorted.length - k);
    const mean = kept.reduce((s, v) => s + v, 0) / kept.length;
    const max = this.options.maxBiasMs;
    return Math.min(max, Math.max(-max, mean));
  }

  reset(): void {
    this.samples = [];
  }
}
