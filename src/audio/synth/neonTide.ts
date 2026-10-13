/**
 * "Neon Tide": an original synthetic demo song (A minor, 100 BPM).
 *
 * Bass and keys are rendered from the manifest's beat map, so every playable
 * event has an audible note on exactly that timestamp. Voice and pulse are
 * fixed parts that play regardless of input.
 */
import { midiToHz, noiseBuffer, reverbImpulse, seededRandom, type SynthGenerator, type SynthInput } from './render';

interface Chord {
  root: number;
  voicing: [number, number, number];
}

const AM: Chord = { root: 45, voicing: [57, 60, 64] };
const F: Chord = { root: 41, voicing: [57, 60, 65] };
const C: Chord = { root: 48, voicing: [55, 60, 64] };
const G: Chord = { root: 43, voicing: [55, 59, 62] };
/** Am F C G loop, aligned so the verse (bar 2) lands on Am. */
const PROGRESSION = [AM, F, C, G];

const SECTION_BARS = { lift: 10, chorus: 18, final: 26 } as const;

function timing(input: SynthInput) {
  const beat = 60 / input.manifest.bpm;
  const bar = beat * 4;
  return {
    beat,
    bar,
    barOf: (sec: number) => Math.floor(sec / bar + 1e-6),
    /** Eighth-note slot (0..7) within the bar. */
    slotOf: (sec: number) => Math.round((sec % bar) / (beat / 2)) % 8,
    chordAt: (barIndex: number) => PROGRESSION[(((barIndex - 2) % 4) + 4) % 4],
  };
}

// ---------------------------------------------------------------- bass (left hand)

export const bass: SynthGenerator = (ctx, out, input) => {
  const { barOf, slotOf, chordAt } = timing(input);
  const times = input.events.map((e) => e.t / 1000);

  times.forEach((t, i) => {
    const barIndex = barOf(t);
    const slot = slotOf(t);
    const chord = chordAt(barIndex);
    let midi = chord.root;
    if (slot % 2 === 1) midi += 12;
    else if (slot === 6 && barIndex >= SECTION_BARS.chorus) midi += 7;
    const last = barIndex >= SECTION_BARS.final;
    const next = times[i + 1] ?? t + 2;
    const dur = last ? 2.2 : Math.min(0.55, Math.max(0.12, next - t - 0.03));
    const hz = midiToHz(midi);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 5;
    filter.frequency.setValueAtTime(2000, t);
    filter.frequency.setTargetAtTime(320, t + 0.005, 0.07);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.9, t + 0.004);
    amp.gain.setTargetAtTime(0.55, t + 0.004, 0.12);
    amp.gain.setTargetAtTime(0, t + dur, 0.03);

    for (const detune of [-7, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz;
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + dur + 0.25);
    }
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = hz / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.7;
    sub.connect(subGain).connect(amp);
    sub.start(t);
    sub.stop(t + dur + 0.25);

    filter.connect(amp).connect(out);
  });
};

// ---------------------------------------------------------------- keys (right hand)

export const keys: SynthGenerator = (ctx, out, input) => {
  const { barOf, chordAt } = timing(input);

  // Shared dotted-eighth echo for a bit of space.
  const bus = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = (60 / input.manifest.bpm) * 0.75;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.28;
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  bus.connect(out);
  bus.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(wet).connect(out);

  let arpStep = 0;
  let arpBar = -1;
  for (const e of input.events) {
    const t = e.t / 1000;
    const barIndex = barOf(t);
    const chord = chordAt(barIndex);
    let notes: number[];
    let dur: number;
    let bright: number;
    if (barIndex >= SECTION_BARS.final) {
      notes = [...chord.voicing, chord.voicing[0] + 12];
      dur = 2.4;
      bright = 3200;
    } else if (barIndex >= SECTION_BARS.chorus) {
      if (barIndex !== arpBar) {
        arpBar = barIndex;
        arpStep = 0;
      }
      const tones = [...chord.voicing, ...chord.voicing.map((n) => n + 12)];
      notes = [tones[arpStep++ % tones.length] + 12];
      dur = 0.26;
      bright = 5200;
    } else if (barIndex >= SECTION_BARS.lift) {
      notes = chord.voicing.map((n) => n + 12);
      dur = 0.16;
      bright = 4200;
    } else {
      notes = chord.voicing;
      dur = 0.4;
      bright = 3000;
    }
    playKeysNote(ctx, bus, t, notes, dur, bright, 0.9 / Math.sqrt(notes.length));
  }
};

function playKeysNote(
  ctx: OfflineAudioContext,
  out: AudioNode,
  t: number,
  notes: number[],
  dur: number,
  bright: number,
  level: number,
) {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 2;
  filter.frequency.setValueAtTime(bright, t);
  filter.frequency.setTargetAtTime(700, t + 0.003, 0.09 + dur * 0.2);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(level, t + 0.003); // stem is peak-normalized afterwards
  amp.gain.setTargetAtTime(level * 0.35, t + 0.003, 0.08);
  amp.gain.setTargetAtTime(0, t + dur, 0.06);
  filter.connect(amp).connect(out);
  for (const n of notes) {
    for (const [type, detune] of [
      ['square', -5],
      ['sawtooth', 6],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midiToHz(n);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + dur + 0.4);
    }
  }
}

// ---------------------------------------------------------------- voice (auto)

type Vowel = 'ah' | 'eh' | 'ee' | 'oh' | 'oo';
/** [barInPhrase, beat, beats, midi, vowel] */
type Note = [number, number, number, number, Vowel];

const FORMANTS: Record<Vowel, [number, number, number]> = {
  ah: [800, 1150, 2900],
  eh: [400, 1700, 2600],
  ee: [300, 2100, 2900],
  oh: [450, 800, 2830],
  oo: [325, 700, 2700],
};

const VERSE: Note[] = [
  [0, 0, 1.5, 64, 'oo'], [0, 1.5, 0.5, 62, 'oo'], [0, 2, 2, 60, 'ah'],
  [1, 0, 1, 57, 'ah'], [1, 1, 1, 60, 'eh'], [1, 2, 1, 62, 'ah'], [1, 3, 1, 60, 'oo'],
  [2, 0, 2, 64, 'ah'], [2, 2, 1, 67, 'eh'], [2, 3, 1, 64, 'ah'],
  [3, 0, 3, 62, 'oo'],
];
const LIFT: Note[] = [
  [0, 0, 1, 69, 'ah'], [0, 1, 1, 67, 'eh'], [0, 2, 2, 64, 'ah'],
  [1, 0, 1, 65, 'oh'], [1, 1, 1, 64, 'ah'], [1, 2, 2, 60, 'oo'],
  [2, 0, 1.5, 67, 'ah'], [2, 1.5, 0.5, 64, 'eh'], [2, 2, 1, 67, 'ah'], [2, 3, 1, 69, 'ee'],
  [3, 0, 2, 71, 'ah'], [3, 2, 2, 67, 'oo'],
];
const CHORUS: Note[] = [
  [0, 0, 2, 72, 'ah'], [0, 2, 1, 71, 'eh'], [0, 3, 1, 69, 'ah'],
  [1, 0, 1, 69, 'oh'], [1, 1, 1, 72, 'ah'], [1, 2, 2, 69, 'oo'],
  [2, 0, 1, 67, 'ah'], [2, 1, 1, 64, 'eh'], [2, 2, 1, 67, 'ah'], [2, 3, 1, 72, 'ee'],
  [3, 0, 2, 74, 'ah'], [3, 2, 2, 71, 'oo'],
];
/** [first bar, phrase] — each phrase is 4 bars. */
const VOCAL_ARRANGEMENT: [number, Note[]][] = [
  [2, VERSE], [6, VERSE],
  [10, LIFT], [14, LIFT],
  [18, CHORUS], [22, CHORUS],
  [26, [[0, 0, 4, 69, 'ah']]],
];

/**
 * A single legato "singer": two detuned saws + breath noise through three
 * formant band-passes, with vibrato and portamento. Clearly synthetic.
 */
export const vocals: SynthGenerator = (ctx, out, input) => {
  const { beat, bar } = timing(input);
  const notes = VOCAL_ARRANGEMENT.flatMap(([startBar, phrase]) =>
    phrase.map(([b, beatPos, beats, midi, vowel]) => ({
      t: (startBar + b) * bar + beatPos * beat,
      dur: beats * beat * 0.92,
      hz: midiToHz(midi),
      vowel,
    })),
  );
  const end = input.manifest.durationMs / 1000;

  const source = ctx.createGain();
  const oscs = [-6, 6].map((detune) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = detune;
    osc.frequency.value = notes[0].hz;
    osc.connect(source);
    return osc;
  });
  const breath = ctx.createBufferSource();
  breath.buffer = noiseBuffer(ctx, 2, 3);
  breath.loop = true;
  const breathGain = ctx.createGain();
  breathGain.gain.value = 0.05;
  breath.connect(breathGain).connect(source);

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.3;
  const vibrato = ctx.createGain();
  vibrato.gain.value = 0;
  lfo.connect(vibrato);
  for (const o of oscs) vibrato.connect(o.detune);

  const amp = ctx.createGain();
  amp.gain.value = 0;
  const formants = [0, 1, 2].map((i) => {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = FORMANTS.ah[i];
    f.Q.value = [9, 12, 20][i];
    const g = ctx.createGain();
    g.gain.value = [1, 0.55, 0.25][i];
    source.connect(f).connect(g).connect(amp);
    return f;
  });

  const reverb = ctx.createConvolver();
  reverb.buffer = reverbImpulse(ctx, 2.6, 0.7);
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  amp.connect(out);
  amp.connect(reverb).connect(wet).connect(out);

  for (const n of notes) {
    for (const o of oscs) o.frequency.setTargetAtTime(n.hz, n.t - 0.015, 0.025);
    FORMANTS[n.vowel].forEach((hz, i) => formants[i].frequency.setTargetAtTime(hz, n.t - 0.01, 0.04));
    amp.gain.setTargetAtTime(1, n.t, 0.03);
    amp.gain.setTargetAtTime(0, n.t + n.dur, 0.06);
    vibrato.gain.setValueAtTime(0, n.t);
    if (n.dur > 0.4) vibrato.gain.linearRampToValueAtTime(28, n.t + Math.min(0.5, n.dur));
  }

  for (const node of [...oscs, breath, lfo]) {
    node.start(0);
    node.stop(end);
  }
};

// ---------------------------------------------------------------- pulse (auto)

export const pulse: SynthGenerator = (ctx, out, input) => {
  const { beat, bar } = timing(input);
  const noise = noiseBuffer(ctx, 3, 11);
  const rand = seededRandom(42);
  const lastBar = SECTION_BARS.final;

  const kick = (t: number, level = 1) => {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.45);
  };

  const noiseHit = (t: number, type: BiquadFilterType, hz: number, q: number, level: number, decay: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, rand() * 0.5);
    src.stop(t + decay + 0.02);
  };

  for (let b = 0; b <= lastBar; b++) {
    const t0 = b * bar;
    if (b === lastBar) {
      kick(t0);
      noiseHit(t0, 'highpass', 3500, 0.7, 0.35, 2.2);
      break;
    }
    for (let q = 0; q < 4; q++) kick(t0 + q * beat, q === 0 ? 1 : 0.85);
    for (let e = 1; e < 8; e += 2) noiseHit(t0 + (e * beat) / 2, 'highpass', 7500, 0.7, b < 2 ? 0.18 : 0.28, 0.05);
    if (b >= SECTION_BARS.chorus) {
      for (let e = 0; e < 8; e += 2) noiseHit(t0 + (e * beat) / 2, 'highpass', 9000, 0.7, 0.1, 0.03);
    }
    if (b >= SECTION_BARS.lift) {
      for (const q of [1, 3]) noiseHit(t0 + q * beat, 'bandpass', 1600, 0.9, 0.7, 0.18);
    }
    if (b === SECTION_BARS.lift || b === SECTION_BARS.chorus) noiseHit(t0, 'highpass', 3500, 0.7, 0.3, 1.6);
  }
};

export const NEON_TIDE_GENERATORS: Record<string, SynthGenerator> = {
  'neon-tide/vocals': vocals,
  'neon-tide/pulse': pulse,
  'neon-tide/bass': bass,
  'neon-tide/keys': keys,
};

/** Target peaks after normalization, so stem gains in the manifest are the mix. */
export const NEON_TIDE_PEAKS: Record<string, number> = {
  'neon-tide/vocals': 0.42,
  'neon-tide/pulse': 0.5,
  'neon-tide/bass': 0.5,
  'neon-tide/keys': 0.4,
};
