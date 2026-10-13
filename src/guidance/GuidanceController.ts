import type { Hand } from '../rhythm/types';
import { TimingBiasEstimator, type BiasEstimatorOptions } from './TimingBiasEstimator';

export type GuidanceMode = 'fixed' | 'adaptive';

/**
 * Visual-only timing guidance.
 *
 * In adaptive mode each lane's cues are drawn `cueShift(hand)` ms earlier
 * (positive) or later (negative) than the true event time, where the shift
 * is the player's measured bias on that hand. Scoring and the audio timeline
 * never see this shift.
 *
 * Bias is measured against true event times, not against the shifted cues.
 * That keeps the shift equal to the player's actual habit and stable for
 * players who follow the music. Measuring against the cues would fully
 * correct players who follow only the visuals, but for everyone who follows
 * the audio it chases its own correction until it hits the bound. The
 * trade-off: a purely visual player settles at about half their lag.
 */
export class GuidanceController {
  mode: GuidanceMode;
  private readonly estimators: Record<Hand, TimingBiasEstimator>;

  constructor(mode: GuidanceMode = 'fixed', options: Partial<BiasEstimatorOptions> = {}) {
    this.mode = mode;
    this.estimators = { left: new TimingBiasEstimator(options), right: new TimingBiasEstimator(options) };
  }

  /** Feed a valid hit (offset = input − event, ms). */
  recordHit(hand: Hand, offsetMs: number): void {
    this.estimators[hand].add(offsetMs);
  }

  /** ms by which cues are drawn ahead of the true event time. Bounded by the estimator. */
  cueShift(hand: Hand): number {
    return this.mode === 'adaptive' ? this.estimators[hand].estimate() : 0;
  }

  /** Current bias estimate regardless of mode. */
  bias(hand: Hand): { estimateMs: number; samples: number; ready: boolean } {
    const e = this.estimators[hand];
    return { estimateMs: e.estimate(), samples: e.sampleCount, ready: e.ready };
  }

  reset(): void {
    this.estimators.left.reset();
    this.estimators.right.reset();
  }
}
