/**
 * Mapping between the performance.now() timeline (where input event
 * timestamps live) and the AudioContext timeline (where audio is scheduled).
 */

export interface OutputStamp {
  /** Context time of the sample currently leaving the speakers. */
  contextTime: number;
  /** performance.now() at which that sample was output. */
  performanceTime: number;
}

export interface ClockReading {
  /** From AudioContext.getOutputTimestamp(), if available. */
  stamp?: OutputStamp;
  /** AudioContext.currentTime at the moment of reading. */
  currentTime: number;
  /** performance.now() at the moment of reading. */
  nowMs: number;
  /** outputLatency + baseLatency (s), used only when no output stamp is available. */
  latencySec: number;
}

/** A stamp is unusable before the device starts reporting or if it drifts implausibly far. */
function usableStamp(r: ClockReading): OutputStamp | null {
  const s = r.stamp;
  if (!s || !(s.contextTime > 0) || !(s.performanceTime > 0)) return null;
  const extrapolated = s.contextTime + (r.nowMs - s.performanceTime) / 1000;
  return Math.abs(extrapolated - r.currentTime) < 1 ? s : null;
}

/**
 * The context time *heard* by the player at performance time `perfMs`.
 * Prefers the device-reported output timestamp; otherwise estimates it as
 * currentTime minus reported latency.
 */
export function heardContextTime(perfMs: number, r: ClockReading): number {
  const s = usableStamp(r);
  if (s) return s.contextTime + (perfMs - s.performanceTime) / 1000;
  return r.currentTime - r.latencySec + (perfMs - r.nowMs) / 1000;
}
