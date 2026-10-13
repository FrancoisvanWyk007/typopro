import { SYNTH_GENERATORS, SYNTH_PEAKS } from '../audio/synth';
import { renderStem } from '../audio/synth/render';
import { assignCharacters, assignSentence } from '../input/sequences';
import type { BeatEvent } from '../rhythm/types';
import { findChart, validateManifest, type ChartManifest, type SongManifest, type StemManifest } from './manifest';

export interface LoadedSong {
  manifest: SongManifest;
  chart: ChartManifest;
  events: BeatEvent[];
  buffers: Map<string, AudioBuffer>;
}

export class ManifestError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Invalid song manifest:\n${errors.join('\n')}`);
    this.errors = errors;
  }
}

/** Beat map + typing text → playable events with characters. */
export function buildChart(chart: ChartManifest): BeatEvent[] {
  const { typing } = chart;
  return typing.mode === 'split'
    ? assignCharacters(chart.beatMap, { left: typing.left, right: typing.right })
    : assignSentence(chart.beatMap, typing.text);
}

/**
 * Play a synthetic song at `speed` × its tempo by rescaling every time in
 * the manifest. Only valid for generated audio, which is rendered from these
 * times; recorded stems can't change tempo without changing pitch.
 */
export function scaleManifest(manifest: SongManifest, speed: number): SongManifest {
  if (speed === 1) return manifest;
  if (!manifest.synthetic) throw new Error('Only synthetic songs can change speed');
  return {
    ...manifest,
    bpm: manifest.bpm * speed,
    durationMs: manifest.durationMs / speed,
    charts: manifest.charts.map((c) => ({ ...c, beatMap: c.beatMap.map((e) => ({ ...e, t: e.t / speed })) })),
  };
}

export async function fetchManifest(url: string): Promise<SongManifest> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const result = validateManifest(await res.json());
  if (!result.ok) throw new ManifestError(result.errors);
  return result.manifest;
}

/** Identity of a stem's audio: synth instrument stems depend on the chart and tempo, auto stems only on tempo. */
function stemKey(stem: StemManifest, manifest: SongManifest, chart: ChartManifest): string {
  if (stem.source.type === 'url') return `url:${stem.source.url}`;
  const chartPart = stem.role === 'instrument' ? chart.id : '*';
  return `synth:${manifest.id}:${stem.source.generator}:${manifest.bpm}:${chartPart}`;
}

export type StemCache = Map<string, AudioBuffer>;

/**
 * Decode (url) or render (synth) every stem at the context's sample rate.
 * Buffers found in `cache` under the same key are reused, so switching
 * charts only re-renders the instrument stems.
 */
export async function loadStems(
  manifest: SongManifest,
  chart: ChartManifest,
  manifestUrl: string,
  ctx: BaseAudioContext,
  cache: StemCache = new Map(),
  onProgress?: (done: number, total: number) => void,
): Promise<{ buffers: Map<string, AudioBuffer>; cache: StemCache }> {
  let done = 0;
  const next: StemCache = new Map();
  const entries = await Promise.all(
    manifest.stems.map(async (stem) => {
      const key = stemKey(stem, manifest, chart);
      let buffer = cache.get(key);
      if (!buffer) {
        if (stem.source.type === 'synth') {
          const generator = SYNTH_GENERATORS[stem.source.generator];
          if (!generator) throw new Error(`Unknown synth generator "${stem.source.generator}"`);
          const events = chart.beatMap.filter((e) => e.instrument === stem.id);
          buffer = await renderStem(generator, { manifest, stem, events }, ctx.sampleRate, SYNTH_PEAKS[stem.source.generator]);
        } else {
          const url = new URL(stem.source.url, new URL(manifestUrl, location.href)).href;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Could not load stem ${stem.id} (${res.status})`);
          buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        }
      }
      next.set(key, buffer);
      onProgress?.(++done, manifest.stems.length);
      return [stem.id, buffer] as const;
    }),
  );
  return { buffers: new Map(entries), cache: next };
}

export interface LoadOptions {
  chartId?: string;
  speed?: number;
  cache?: StemCache;
  onProgress?: (done: number, total: number) => void;
}

export async function loadSong(
  manifestUrl: string,
  ctx: BaseAudioContext,
  opts: LoadOptions = {},
): Promise<LoadedSong & { cache: StemCache }> {
  const original = await fetchManifest(manifestUrl);
  const manifest = original.synthetic ? scaleManifest(original, opts.speed ?? 1) : original;
  const chart = findChart(manifest, opts.chartId);
  const { buffers, cache } = await loadStems(manifest, chart, manifestUrl, ctx, opts.cache, opts.onProgress);
  return { manifest, chart, events: buildChart(chart), buffers, cache };
}
