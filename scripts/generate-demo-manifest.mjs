// Generates public/songs/neon-tide/manifest.json: the declarative manifest and
// explicit beat maps for the synthetic demo song. The output JSON is committed;
// rerun with `npm run beatmap` after changing the patterns below.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BPM = 100;
const EIGHTH_MS = 60000 / BPM / 2; // 300
const BAR_MS = EIGHTH_MS * 8; // 2400
const DURATION_MS = 27.5 * BAR_MS;

const INSTRUMENT = { left: 'bass', right: 'keys' };

// QWERTY touch-typing split (unshifted characters), mirrors src/input/keyboardLayout.ts.
const LEFT_CHARS = new Set('`12345qwertasdfgzxcvb');
const RIGHT_CHARS = new Set("67890-=yuiop[]\\hjkl;'nm,./");
const handOf = (ch) => (LEFT_CHARS.has(ch) ? 'left' : RIGHT_CHARS.has(ch) ? 'right' : null);

const byTime = (a, b) => a.t - b.t || (a.hand === 'left' ? -1 : 1);

// ---------------------------------------------------------------- chart 1: two lanes

// Eighth-note slots (0..7) per bar for each hand, by section.
const SPLIT_SECTIONS = [
  { bars: [2, 9], left: [0, 4], right: [2, 6] },
  { bars: [10, 17], left: [0, 3, 4, 6], right: [1, 3, 5, 7] },
  { bars: [18, 25], left: [0, 2, 3, 4, 6], right: [1, 3, 5, 6, 7] },
  { bars: [26, 26], left: [0], right: [0] },
];
const SPLIT_TEXT = {
  left: 'brave waves crest after stars fade we wear sweaters as street beats drag a sweet west breeze we see vast seas',
  right: 'jolly moon pony hum on in my pumpkin kimono only you hop upon lily pool oh my plum opinion yummy lollipop moon',
};

function splitChart() {
  const beatMap = [];
  for (const s of SPLIT_SECTIONS) {
    for (let bar = s.bars[0]; bar <= s.bars[1]; bar++) {
      for (const hand of ['left', 'right']) {
        for (const slot of s[hand]) beatMap.push({ t: bar * BAR_MS + slot * EIGHTH_MS, hand, instrument: INSTRUMENT[hand] });
      }
    }
  }
  beatMap.sort(byTime);
  for (const hand of ['left', 'right']) {
    const n = beatMap.filter((e) => e.hand === hand).length;
    const chars = SPLIT_TEXT[hand].replace(/\s+/g, '').length;
    if (n !== chars) throw new Error(`two lanes: ${hand} has ${n} events but ${chars} characters`);
  }
  return {
    id: 'two-lanes',
    label: 'Two lanes',
    typing: { mode: 'split', left: SPLIT_TEXT.left, right: SPLIT_TEXT.right },
    beatMap,
  };
}

// ---------------------------------------------------------------- chart 2: one sentence

// One letter per slot, a one-slot rest between words. Quarter notes in the
// verse to settle in, eighth notes from the lift on.
const SENTENCE =
  'the tide rolls in under neon light and every wave hums a song so keep the rhythm in your hands and let the city sing along with you until the morning comes';

function sentenceSlots() {
  const slots = [];
  for (let bar = 2; bar <= 9; bar++) for (let q = 0; q < 4; q++) slots.push(bar * BAR_MS + q * 2 * EIGHTH_MS);
  for (let bar = 10; bar <= 25; bar++) for (let e = 0; e < 8; e++) slots.push(bar * BAR_MS + e * EIGHTH_MS);
  return slots;
}

function sentenceChart() {
  const slots = sentenceSlots();
  const beatMap = [];
  let s = 0;
  for (const word of SENTENCE.split(' ')) {
    for (const ch of word) {
      const hand = handOf(ch);
      if (!hand) throw new Error(`one sentence: no QWERTY key for "${ch}"`);
      if (s >= slots.length) throw new Error('one sentence: text does not fit the song');
      beatMap.push({ t: slots[s++], hand, instrument: INSTRUMENT[hand] });
    }
    s++; // rest where the space goes
  }
  console.log(`one sentence: ${beatMap.length} letters, ${s - 1} of ${slots.length} slots used`);
  return { id: 'one-sentence', label: 'One sentence', typing: { mode: 'sentence', text: SENTENCE }, beatMap };
}

// ---------------------------------------------------------------- manifest

const charts = [splitChart(), sentenceChart()];

const manifest = {
  version: 2,
  id: 'neon-tide',
  title: 'Neon Tide',
  artist: 'Typopro synthetic demo',
  bpm: BPM,
  durationMs: DURATION_MS,
  synthetic: true,
  credits: 'Original composition. All audio is synthesized in the browser at load time; no recorded or third-party music.',
  stems: [
    { id: 'vocals', label: 'Voice', role: 'auto', source: { type: 'synth', generator: 'neon-tide/vocals' }, gain: 0.8 },
    { id: 'pulse', label: 'Pulse', role: 'auto', source: { type: 'synth', generator: 'neon-tide/pulse' }, gain: 0.7 },
    { id: 'bass', label: 'Bass', role: 'instrument', source: { type: 'synth', generator: 'neon-tide/bass' }, gain: 1 },
    { id: 'keys', label: 'Keys', role: 'instrument', source: { type: 'synth', generator: 'neon-tide/keys' }, gain: 0.85, pan: 0.12 },
  ],
  hands: { left: { instrument: INSTRUMENT.left }, right: { instrument: INSTRUMENT.right } },
  charts,
};

// Pretty-print with one beat event per line.
const indent = (s, n) => s.replace(/\n/g, '\n' + ' '.repeat(n));
const chartJson = (c) => {
  const { beatMap, ...head } = c;
  return (
    indent(JSON.stringify(head, null, 2), 4).replace(/\n {4}}$/, ',\n') +
    '      "beatMap": [\n' +
    beatMap.map((e) => '        ' + JSON.stringify(e)).join(',\n') +
    '\n      ]\n    }'
  );
};
const { charts: _charts, ...head } = manifest;
const json =
  JSON.stringify(head, null, 2).replace(/\n}$/, ',\n') +
  '  "charts": [\n    ' +
  charts.map(chartJson).join(',\n    ') +
  '\n  ]\n}\n';
JSON.parse(json); // sanity check

const out = fileURLToPath(new URL('../public/songs/neon-tide/manifest.json', import.meta.url));
writeFileSync(out, json);
console.log(`wrote ${charts.map((c) => `${c.id} (${c.beatMap.length} events)`).join(', ')} → ${out}`);
