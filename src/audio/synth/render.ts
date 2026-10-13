import type { RawBeatEvent } from '../../input/sequences';
import type { SongManifest, StemManifest } from '../../song/manifest';

export interface SynthInput {
  manifest: SongManifest;
  stem: StemManifest;
  /** Beat-map events that target this stem (empty for auto stems). */
  events: RawBeatEvent[];
}

/** Schedules a stem's notes into `out` on an OfflineAudioContext. */
export type SynthGenerator = (ctx: OfflineAudioContext, out: AudioNode, input: SynthInput) => void;

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** Render one mono stem offline and peak-normalize it. */
export async function renderStem(
  generator: SynthGenerator,
  input: SynthInput,
  sampleRate: number,
  peak = 0.5,
): Promise<AudioBuffer> {
  const length = Math.ceil((input.manifest.durationMs / 1000) * sampleRate);
  const ctx = new OfflineAudioContext(1, length, sampleRate);
  generator(ctx, ctx.destination, input);
  const buffer = await ctx.startRendering();
  normalize(buffer, peak);
  return buffer;
}

export function normalize(buffer: AudioBuffer, peak: number): void {
  let max = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    for (const v of buffer.getChannelData(c)) max = Math.max(max, Math.abs(v));
  }
  if (max === 0) return;
  const k = peak / max;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] *= k;
  }
}

/** Deterministic PRNG so the generated demo is identical on every load. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed = 1): AudioBuffer {
  const rand = seededRandom(seed);
  const buf = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
  return buf;
}

/** Exponentially decaying noise impulse response for a simple plate-ish reverb. */
export function reverbImpulse(ctx: BaseAudioContext, seconds: number, decay: number, seed = 7): AudioBuffer {
  const rand = seededRandom(seed);
  const buf = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate;
    data[i] = (rand() * 2 - 1) * Math.exp(-t / decay);
  }
  return buf;
}
