import { NEON_TIDE_GENERATORS, NEON_TIDE_PEAKS } from './neonTide';
import type { SynthGenerator } from './render';

export const SYNTH_GENERATORS: Record<string, SynthGenerator> = { ...NEON_TIDE_GENERATORS };
export const SYNTH_PEAKS: Record<string, number> = { ...NEON_TIDE_PEAKS };
