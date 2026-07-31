// ---------------------------------------------------------------------------
// Procedural score.
//
// Every track is a generative piece with a fixed seed, so "the town theme" is
// the same tune every time you walk into a town - it just never ends and never
// loops audibly. The generator is deliberately old-fashioned: pick a key and a
// chord progression, build two-bar motifs, lay them out as A A B A, and let a
// small General-MIDI-ish synth stack play them.
//
// Nothing here is random noodling. Melodies are motifs transposed diatonically
// under the progression, which is what makes a phrase sound *written*.
//
// Timing comes from a 50 ms lookahead scheduler that queues ~250 ms of events
// ahead of the clock; nothing is ever scheduled from a rAF callback.
// ---------------------------------------------------------------------------

import { Rand, hashStr, clamp } from './rng.js';
import { renderOffline } from './audio.js';

const A4 = 69;
export const mtof = (m) => 440 * Math.pow(2, (m - A4) / 12);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

// ---------------------------------------------------------------------------
// Theory tables.
// ---------------------------------------------------------------------------

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmMinor: [0, 2, 3, 5, 7, 8, 11],
};

const CHORDS = {
  min: [0, 3, 7], maj: [0, 4, 7], dim: [0, 3, 6], aug: [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7], five: [0, 7, 12],
  min7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dom7: [0, 4, 7, 10], min9: [0, 3, 7, 14],
};

/** Absolute midi notes of `scale` rooted at `root`, spanning [lo, hi]. */
function scaleNotes(root, scaleName, lo = 24, hi = 108) {
  const sc = SCALES[scaleName] || SCALES.minor;
  const out = [];
  const base = root % 12;
  for (let m = lo; m <= hi; m++) {
    if (sc.includes(((m - base) % 12 + 12) % 12)) out.push(m);
  }
  return out;
}

/** Pitch classes of a chord written as [semitonesAboveKey, type]. */
function chordPcs(root, chord) {
  const [off, type] = chord;
  const iv = CHORDS[type] || CHORDS.min;
  return iv.map((s) => (((root + off + s) % 12) + 12) % 12);
}

/** Index into `notes` of the pitch nearest `target` whose class is in `pcs`. */
function nearestIn(notes, pcs, target) {
  let best = -1, bestD = 1e9;
  for (let i = 0; i < notes.length; i++) {
    if (!pcs.includes(((notes[i] % 12) + 12) % 12)) continue;
    const d = Math.abs(notes[i] - target);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Index of the note nearest `target`, chord tone or not. */
function nearestIdx(notes, target) {
  let best = 0, bestD = 1e9;
  for (let i = 0; i < notes.length; i++) {
    const d = Math.abs(notes[i] - target);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Track definitions.
//
// prog entries are [semitonesAboveTonic, chordType]; one chord per bar.
// `parts` names which generator runs on which layer and with what voice.
// ---------------------------------------------------------------------------

const T = {};
const track = (id, o) => { T[id] = Object.assign({ id, spb: 16, form: ['A', 'A', 'B', 'A'], seed: hashStr('mm6trk:' + id) }, o); };

const i_ = [0, 'min'], v_ = [7, 'min'], iv_ = [5, 'min'];
const VI = [8, 'maj'], III = [3, 'maj'], VII = [10, 'maj'], V5 = [7, 'maj'], bII = [1, 'maj'];
const I_ = [0, 'maj'], IV = [5, 'maj'], vi = [9, 'min'], ii = [2, 'min'], bVII = [10, 'maj'];

track('title', {
  name: 'Main Theme', bpm: 92, key: 62, scale: 'minor', bars: 8,
  progA: [i_, VI, III, VII, i_, VI, VII, i_],
  progB: [VI, VII, i_, v_, VI, VII, III, VII],
  parts: {
    pad: { v: 'choir', center: 58, gain: 0.5 },
    bass: { v: 'bass', pattern: 'root5', center: 38, gain: 0.85 },
    melody: { v: 'brass', center: 74, lo: 65, hi: 86, density: 'med', gain: 0.7 },
    arp: { v: 'bowed', pattern: [0, 2, 1, 2], rate: 4, center: 62, gain: 0.34 },
    perc: { kit: 'march', gain: 0.75 },
    accent: { v: 'brass', mode: 'stabs', center: 50, gain: 0.5 },
  },
});

track('town', {
  name: 'Town', bpm: 116, key: 67, scale: 'major', bars: 8,
  progA: [I_, V5, vi, IV, I_, V5, IV, I_],
  progB: [vi, IV, I_, V5, vi, ii, V5, V5],
  parts: {
    pad: { v: 'bowed', center: 60, gain: 0.28 },
    bass: { v: 'bass', pattern: 'root5', center: 40, gain: 0.7 },
    melody: { v: 'flute', center: 79, lo: 69, hi: 91, density: 'med', gain: 0.6 },
    arp: { v: 'pluck', pattern: [0, 1, 2, 1, 3, 2, 1, 0], rate: 2, center: 64, gain: 0.5 },
    perc: { kit: 'folk', gain: 0.55 },
    accent: { v: 'pluck', mode: 'stabs', center: 55, gain: 0.4 },
  },
});

track('field', {
  name: 'Field', bpm: 100, key: 69, scale: 'minor', bars: 8,
  progA: [i_, VI, VII, i_, iv_, VI, VII, i_],
  progB: [III, VII, i_, v_, VI, III, VII, i_],
  parts: {
    pad: { v: 'bowed', center: 60, gain: 0.42 },
    bass: { v: 'bass', pattern: 'walk', center: 40, gain: 0.7 },
    melody: { v: 'brass', center: 72, lo: 62, hi: 84, density: 'sparse', gain: 0.55 },
    arp: { v: 'bowed', pattern: [0, 1, 2, 1], rate: 4, center: 67, gain: 0.3 },
    perc: { kit: 'sparse', gain: 0.6 },
    accent: { v: 'brass', mode: 'stabs', center: 52, gain: 0.45 },
  },
});

track('forest', {
  name: 'Forest', bpm: 88, key: 64, scale: 'dorian', bars: 8,
  progA: [i_, IV, i_, bVII, i_, IV, bVII, i_],
  progB: [bVII, IV, i_, v_, bVII, IV, i_, i_],
  parts: {
    pad: { v: 'choir', center: 59, gain: 0.3 },
    bass: { v: 'bass', pattern: 'whole', center: 40, gain: 0.6 },
    melody: { v: 'flute', center: 76, lo: 66, hi: 88, density: 'sparse', gain: 0.6 },
    arp: { v: 'pluck', pattern: [0, 2, 1, 3], rate: 4, center: 64, gain: 0.42 },
    perc: { kit: 'sparse', gain: 0.4 },
    accent: { v: 'flute', mode: 'echo', center: 84, gain: 0.3 },
  },
});

track('desert', {
  name: 'Desert', bpm: 84, key: 62, scale: 'phrygian', bars: 8,
  progA: [i_, bII, i_, bVII, i_, bII, bVII, i_],
  progB: [iv_, bII, i_, i_, iv_, bII, bVII, i_],
  parts: {
    pad: { v: 'bowed', center: 50, gain: 0.4, drone: true },
    bass: { v: 'bass', pattern: 'pedal', center: 38, gain: 0.7 },
    melody: { v: 'flute', center: 74, lo: 64, hi: 86, density: 'med', gain: 0.6 },
    arp: { v: 'pluck', pattern: [0, 1, 0, 2], rate: 4, center: 62, gain: 0.32 },
    perc: { kit: 'hand', gain: 0.6 },
    accent: { v: 'bowed', mode: 'swell', center: 68, gain: 0.3 },
  },
});

track('snow', {
  name: 'Snow', bpm: 76, key: 60, scale: 'minor', bars: 8,
  progA: [i_, VI, iv_, VII, i_, VI, III, VII],
  progB: [iv_, VII, III, VI, iv_, v_, i_, i_],
  parts: {
    pad: { v: 'choir', center: 60, gain: 0.4 },
    bass: { v: 'bass', pattern: 'whole', center: 36, gain: 0.6 },
    melody: { v: 'bell', center: 84, lo: 72, hi: 96, density: 'sparse', gain: 0.42 },
    arp: { v: 'bell', pattern: [0, 2, 1], rate: 8, center: 76, gain: 0.26 },
    perc: { kit: 'none', gain: 0.3 },
    accent: { v: 'bowed', mode: 'swell', center: 55, gain: 0.3 },
  },
});

track('dungeon', {
  name: 'Dungeon', bpm: 58, key: 60, scale: 'minor', bars: 8,
  progA: [i_, i_, i_, i_, VI, VI, i_, i_],
  progB: [i_, i_, bII, bII, i_, i_, v_, v_],
  parts: {
    pad: { v: 'bowed', center: 45, gain: 0.4, drone: true },
    bass: { v: 'bass', pattern: 'pedal', center: 31, gain: 0.58 },
    melody: { v: 'choir', center: 62, lo: 55, hi: 72, density: 'vsparse', gain: 0.24 },
    arp: null,
    perc: { kit: 'sparse', gain: 0.6 },
    accent: { v: 'bell', mode: 'toll', center: 55, gain: 0.3 },
  },
});

track('crypt', {
  name: 'Crypt', bpm: 54, key: 59, scale: 'phrygian', bars: 8,
  progA: [i_, i_, bII, bII, i_, i_, bVII, bVII],
  progB: [iv_, iv_, bII, bII, i_, i_, i_, i_],
  parts: {
    pad: { v: 'choir', center: 52, gain: 0.5, drone: true },
    bass: { v: 'bass', pattern: 'pedal', center: 31, gain: 0.7 },
    melody: { v: 'choir', center: 66, lo: 57, hi: 76, density: 'vsparse', gain: 0.3 },
    arp: null,
    perc: { kit: 'sparse', gain: 0.55 },
    accent: { v: 'bell', mode: 'toll', center: 50, gain: 0.38 },
  },
});

track('combat', {
  name: 'Combat', bpm: 152, key: 62, scale: 'minor', bars: 8,
  progA: [i_, i_, VI, VII, i_, i_, VI, V5],
  progB: [VI, VII, i_, i_, VI, VII, v_, V5],
  parts: {
    pad: { v: 'bowed', center: 55, gain: 0.3 },
    bass: { v: 'bass', pattern: 'drive', center: 38, gain: 0.9 },
    melody: { v: 'brass', center: 72, lo: 62, hi: 84, density: 'dense', gain: 0.5 },
    arp: { v: 'bowed', pattern: [0, 0, 1, 0, 2, 0, 1, 0], rate: 1, center: 62, gain: 0.42, short: true },
    perc: { kit: 'combat', gain: 0.85 },
    accent: { v: 'brass', mode: 'stabs', center: 50, gain: 0.6 },
  },
  mix: (i) => ({ pad: 0.7, bass: 0.9 + 0.1 * i, melody: 0.5 + 0.5 * i, arp: 0.7 + 0.3 * i, perc: 0.55 + 0.45 * i, accent: 0.25 + 0.75 * i }),
});

track('boss', {
  name: 'Boss', bpm: 138, key: 62, scale: 'harmMinor', bars: 8,
  progA: [i_, bII, i_, V5, i_, bII, VI, V5],
  progB: [iv_, bII, V5, i_, iv_, bII, V5, V5],
  parts: {
    pad: { v: 'choir', center: 55, gain: 0.45 },
    bass: { v: 'bass', pattern: 'drive', center: 33, gain: 0.95 },
    melody: { v: 'brass', center: 70, lo: 60, hi: 82, density: 'dense', gain: 0.55 },
    arp: { v: 'bowed', pattern: [0, 1, 0, 2], rate: 2, center: 60, gain: 0.38, short: true },
    perc: { kit: 'boss', gain: 0.95 },
    accent: { v: 'brass', mode: 'stabs', center: 46, gain: 0.7 },
  },
  mix: (i) => ({ pad: 0.85, bass: 1, melody: 0.6 + 0.4 * i, arp: 0.8, perc: 0.7 + 0.3 * i, accent: 0.4 + 0.6 * i }),
});

track('temple', {
  name: 'Temple', bpm: 66, key: 65, scale: 'major', bars: 8,
  progA: [I_, IV, vi, V5, I_, IV, ii, V5],
  progB: [vi, ii, V5, I_, IV, I_, V5, I_],
  parts: {
    pad: { v: 'choir', center: 60, gain: 0.55 },
    bass: { v: 'bass', pattern: 'whole', center: 36, gain: 0.55 },
    melody: { v: 'choir', center: 74, lo: 65, hi: 84, density: 'sparse', gain: 0.34 },
    arp: { v: 'bell', pattern: [0, 1, 2], rate: 8, center: 79, gain: 0.24 },
    perc: { kit: 'none', gain: 0.2 },
    accent: { v: 'bell', mode: 'toll', center: 55, gain: 0.3 },
  },
});

track('shop', {
  name: 'Shop', bpm: 120, key: 67, scale: 'major', bars: 8,
  progA: [I_, vi, ii, V5, I_, vi, IV, V5],
  progB: [IV, I_, ii, V5, IV, V5, I_, I_],
  parts: {
    pad: null,
    bass: { v: 'pluck', pattern: 'root5', center: 45, gain: 0.66 },
    melody: { v: 'pluck', center: 79, lo: 69, hi: 91, density: 'med', gain: 0.62, bright: true },
    arp: { v: 'pluck', pattern: [0, 1, 2, 3, 2, 1], rate: 2, center: 67, gain: 0.56, bright: true },
    perc: { kit: 'none', gain: 0.2 },
    accent: { v: 'pluck', mode: 'stabs', center: 60, gain: 0.42, bright: true },
  },
});

track('tavern', {
  name: 'Tavern', bpm: 132, key: 62, scale: 'mixolydian', bars: 8, spb: 12,
  progA: [I_, bVII, I_, V5, I_, bVII, IV, I_],
  progB: [IV, I_, bVII, V5, IV, I_, V5, I_],
  parts: {
    pad: null,
    bass: { v: 'bass', pattern: 'jig', center: 40, gain: 0.75 },
    melody: { v: 'flute', center: 79, lo: 69, hi: 91, density: 'dense', gain: 0.6 },
    arp: { v: 'pluck', pattern: [0, 1, 2, 1], rate: 3, center: 62, gain: 0.5 },
    perc: { kit: 'jig', gain: 0.7 },
    accent: { v: 'pluck', mode: 'stabs', center: 55, gain: 0.35 },
  },
});

track('victory', {
  name: 'Victory', bpm: 120, key: 60, scale: 'major', bars: 4, form: ['A', 'A'],
  progA: [I_, IV, V5, I_],
  progB: [I_, IV, V5, I_],
  parts: {
    pad: { v: 'choir', center: 60, gain: 0.4 },
    bass: { v: 'bass', pattern: 'root5', center: 36, gain: 0.8 },
    melody: { v: 'brass', center: 76, lo: 67, hi: 88, density: 'dense', gain: 0.7 },
    arp: null,
    perc: { kit: 'march', gain: 0.9 },
    accent: { v: 'brass', mode: 'stabs', center: 52, gain: 0.7 },
  },
});

track('defeat', {
  name: 'Defeat', bpm: 58, key: 60, scale: 'minor', bars: 4, form: ['A', 'A'],
  progA: [i_, VI, iv_, i_],
  progB: [i_, VI, iv_, i_],
  parts: {
    pad: { v: 'choir', center: 52, gain: 0.5 },
    bass: { v: 'bass', pattern: 'whole', center: 33, gain: 0.7 },
    melody: { v: 'brass', center: 64, lo: 55, hi: 74, density: 'vsparse', gain: 0.45 },
    arp: null,
    perc: { kit: 'sparse', gain: 0.6 },
    accent: { v: 'bell', mode: 'toll', center: 48, gain: 0.3 },
  },
});

track('night', {
  name: 'Night', bpm: 70, key: 69, scale: 'minor', bars: 8,
  progA: [i_, VI, III, VII, i_, iv_, v_, i_],
  progB: [VI, III, iv_, i_, VI, VII, v_, i_],
  parts: {
    pad: { v: 'choir', center: 57, gain: 0.4 },
    bass: { v: 'bass', pattern: 'whole', center: 38, gain: 0.55 },
    melody: { v: 'flute', center: 74, lo: 64, hi: 86, density: 'sparse', gain: 0.5 },
    arp: { v: 'bell', pattern: [0, 2, 1], rate: 8, center: 81, gain: 0.22 },
    perc: { kit: 'none', gain: 0.2 },
    accent: { v: 'bowed', mode: 'swell', center: 55, gain: 0.28 },
  },
});

export const TRACKS = T;
export const TRACK_IDS = Object.keys(T);

// ---------------------------------------------------------------------------
// Composition.
// ---------------------------------------------------------------------------

const DENSITY = {
  vsparse: { lens: [16, 16, 12, 8], rest: 0.42 },
  sparse: { lens: [8, 8, 4, 12, 16], rest: 0.3 },
  med: { lens: [4, 4, 2, 8, 6, 4], rest: 0.16 },
  dense: { lens: [2, 2, 4, 2, 4, 6], rest: 0.08 },
};

/** A rhythm for one motif cell: note onsets and lengths filling `total` steps. */
function genRhythm(rng, total, spec) {
  const out = [];
  let s = 0;
  let guard = 0;
  while (s < total && guard++ < 200) {
    const len = Math.min(rng.pick(spec.lens), total - s);
    if (rng.bool(spec.rest) && out.length) { s += Math.min(len, 4); continue; }
    out.push({ s, len });
    s += len;
  }
  return out;
}

/**
 * A motif: scale-step offsets relative to whatever chord it lands on. Storing
 * degrees rather than pitches is what lets one cell be re-used under four
 * different chords and still sound deliberate.
 */
function genMotif(rng, total, spec, arc) {
  const rhythm = genRhythm(rng, total, spec);
  let deg = rng.pick([0, 2, 4]);
  const notes = [];
  for (let n = 0; n < rhythm.length; n++) {
    const u = rhythm[n].s / Math.max(1, total);
    // Rise through the first half of the cell, settle in the second.
    const pull = arc * Math.sin(u * Math.PI) * 3;
    const strong = rhythm[n].s % 8 === 0;
    if (strong || rng.bool(0.3)) {
      // Land on a chord tone: 0/2/4 are root/third/fifth in scale steps.
      const cands = [-3, -1, 0, 2, 4, 6];
      let best = 0, bd = 1e9;
      for (const c of cands) {
        const d = Math.abs(c - (deg + pull * 0.5));
        if (d < bd) { bd = d; best = c; }
      }
      deg = best;
    } else {
      deg += rng.pick([-2, -1, -1, 1, 1, 2]);
    }
    deg = clamp(deg, -5, 9);
    notes.push({ s: rhythm[n].s, len: rhythm[n].len, deg, strong });
  }
  // Phrases want to end on something stable.
  if (notes.length) notes[notes.length - 1].deg = rng.pick([0, 0, 4, -3]);
  return notes;
}

const PERC = {
  none: () => [],
  sparse: (spb, bar, rng) => {
    const e = [];
    if (bar % 2 === 0) e.push({ s: 0, d: 'timp_lo', v: 0.9 });
    if (bar % 4 === 3) e.push({ s: spb - 4, d: 'timp_hi', v: 0.6 });
    return e;
  },
  march: (spb, bar, rng) => {
    const e = [];
    e.push({ s: 0, d: 'timp_lo', v: 1 });
    e.push({ s: spb / 2, d: 'timp_lo', v: 0.7 });
    e.push({ s: spb / 4, d: 'snare', v: 0.5 });
    e.push({ s: (spb * 3) / 4, d: 'snare', v: 0.6 });
    if (bar % 4 === 3) { e.push({ s: spb - 4, d: 'timp_hi', v: 0.8 }); e.push({ s: spb - 2, d: 'timp_lo', v: 0.9 }); }
    if (bar % 8 === 0) e.push({ s: 0, d: 'cym', v: 0.5 });
    return e;
  },
  folk: (spb, bar, rng) => {
    const e = [];
    for (let s = 0; s < spb; s += 2) e.push({ s, d: 'tamb', v: s % 8 === 0 ? 0.85 : 0.4 });
    for (let s = 1; s < spb; s += 4) e.push({ s, d: 'shaker', v: 0.35 });
    if (bar % 4 === 3) e.push({ s: spb - 2, d: 'tamb', v: 0.9 });
    return e;
  },
  hand: (spb, bar, rng) => {
    const e = [];
    e.push({ s: 0, d: 'tom', v: 0.9 });
    e.push({ s: 6, d: 'tom', v: 0.5 });
    e.push({ s: spb / 2, d: 'tom', v: 0.7 });
    e.push({ s: spb - 4, d: 'shaker', v: 0.4 });
    if (bar % 2 === 1) e.push({ s: spb - 2, d: 'tom', v: 0.45 });
    return e;
  },
  jig: (spb, bar, rng) => {
    const e = [];
    // 6/8: strong on 0 and 6, tambourine on the off-eighths.
    e.push({ s: 0, d: 'tom', v: 1 });
    e.push({ s: 6, d: 'tom', v: 0.75 });
    for (const s of [2, 4, 8, 10]) e.push({ s, d: 'tamb', v: 0.4 });
    e.push({ s: 3, d: 'shaker', v: 0.3 });
    e.push({ s: 9, d: 'shaker', v: 0.3 });
    return e;
  },
  combat: (spb, bar, rng) => {
    const e = [];
    for (const s of [0, 3, 6, 8, 11, 14]) e.push({ s, d: 'kick', v: s === 0 ? 1 : 0.7 });
    e.push({ s: 4, d: 'snare', v: 0.9 });
    e.push({ s: 12, d: 'snare', v: 0.95 });
    for (let s = 0; s < spb; s += 2) e.push({ s, d: 'shaker', v: 0.28 });
    if (bar % 4 === 3) for (const s of [13, 14, 15]) e.push({ s, d: 'snare', v: 0.4 + s * 0.03 });
    return e;
  },
  boss: (spb, bar, rng) => {
    const e = [];
    for (const s of [0, 2, 6, 8, 10, 14]) e.push({ s, d: 'kick', v: s === 0 ? 1 : 0.75 });
    e.push({ s: 4, d: 'timp_lo', v: 0.9 });
    e.push({ s: 12, d: 'timp_hi', v: 0.85 });
    if (bar % 8 === 0) e.push({ s: 0, d: 'gong', v: 0.8 });
    if (bar % 4 === 3) { e.push({ s: 12, d: 'timp_lo', v: 0.7 }); e.push({ s: 14, d: 'timp_hi', v: 0.8 }); }
    return e;
  },
};

const BASS_PATTERNS = {
  whole: (spb) => [{ s: 0, len: spb, tone: 0 }],
  pedal: (spb) => [{ s: 0, len: spb, tone: 0 }],
  root5: (spb) => [{ s: 0, len: spb / 2, tone: 0 }, { s: spb / 2, len: spb / 2, tone: 2 }],
  walk: (spb) => [{ s: 0, len: 4, tone: 0 }, { s: 4, len: 4, tone: 2 }, { s: 8, len: 4, tone: 1 }, { s: 12, len: 4, tone: 2 }],
  drive: (spb) => {
    const o = [];
    for (let s = 0; s < spb; s += 2) o.push({ s, len: 2, tone: s % 8 === 4 ? 2 : 0 });
    return o;
  },
  jig: (spb) => [{ s: 0, len: 3, tone: 0 }, { s: 3, len: 3, tone: 2 }, { s: 6, len: 3, tone: 0 }, { s: 9, len: 3, tone: 1 }],
};

/**
 * Turn a track definition into a fixed sequence of bars of note events. Runs
 * once per track and is fully determined by the track seed.
 */
export function buildSong(def) {
  const rng = new Rand(def.seed);
  const spb = def.spb;
  const stepSec = 60 / def.bpm / 4;
  const notes = scaleNotes(def.key, def.scale, 21, 108);
  const P = def.parts;

  // One motif per section letter, reused wherever that letter appears.
  const cellSteps = spb * 2;
  const sections = {};
  for (const letter of new Set(def.form)) {
    const d = DENSITY[(P.melody && P.melody.density) || 'med'];
    const nCells = Math.max(1, Math.round(def.bars / 2));
    const cells = [];
    for (let c = 0; c < Math.min(3, nCells); c++) cells.push(genMotif(rng, cellSteps, d, letter === 'B' ? -0.6 : 1));
    // a a b c - the phrase repeats itself before it goes anywhere.
    const order = [0, 0, 1, 2];
    sections[letter] = { cells, order: Array.from({ length: nCells }, (_, k) => cells[Math.min(order[k % 4], cells.length - 1)] ) };
  }

  const bars = [];
  let barNo = 0;
  for (const letter of def.form) {
    const prog = (letter === 'B' && def.progB) ? def.progB : def.progA;
    const sec = sections[letter];
    // Anchor the melody to where the previous bar left off so the line joins up
    // instead of jumping an octave every time the chord root moves. Reset at
    // each section boundary, which is what keeps the two A phrases identical.
    let anchor = P.melody ? P.melody.center : 60;
    let cellRoot = anchor;
    for (let b = 0; b < def.bars; b++) {
      const chord = prog[b % prog.length];
      const pcs = chordPcs(def.key, chord);
      const rootPc = (((def.key + chord[0]) % 12) + 12) % 12;
      const ev = [];

      // -- pad: the chord itself, held.
      if (P.pad) {
        const c = P.pad.center;
        const voicing = [];
        for (let k = 0; k < pcs.length; k++) {
          const idx = nearestIn(notes, [pcs[k]], c + k * 3);
          if (idx >= 0) voicing.push(notes[idx]);
        }
        const half = P.pad.drone ? 1 : (b % 2 === 0 ? 1 : 2);
        for (let h = 0; h < half; h++) {
          for (const m of voicing) ev.push({ s: (h * spb) / half, len: spb / half, m, v: P.pad.v, layer: 'pad', vel: P.pad.gain });
        }
      }

      // -- bass.
      if (P.bass) {
        const pat = BASS_PATTERNS[P.bass.pattern](spb);
        for (const n of pat) {
          const pc = pcs[Math.min(n.tone, pcs.length - 1)];
          const idx = nearestIn(notes, [pc], P.bass.center);
          if (idx >= 0) ev.push({ s: n.s, len: n.len, m: notes[idx], v: P.bass.v, layer: 'bass', vel: P.bass.gain });
        }
      }

      // -- arpeggio / ostinato over the chord tones.
      if (P.arp) {
        const tones = [];
        for (let k = 0; k < 4; k++) {
          const idx = nearestIn(notes, [pcs[k % pcs.length]], P.arp.center + Math.floor(k / pcs.length) * 12 + k * 2);
          if (idx >= 0) tones.push(notes[idx]);
        }
        const pat = P.arp.pattern;
        let k = 0;
        for (let s = 0; s < spb; s += P.arp.rate, k++) {
          const m = tones[pat[k % pat.length] % tones.length];
          if (m == null) continue;
          ev.push({ s, len: P.arp.short ? P.arp.rate : Math.min(P.arp.rate * 2, spb - s), m, v: P.arp.v, layer: 'arp', vel: P.arp.gain * (s % 8 === 0 ? 1 : 0.72) });
        }
      }

      // -- melody: the section motif, transposed onto this bar's chord.
      if (P.melody) {
        const cell = sec.order[Math.floor(b / 2) % sec.order.length];
        const half = b % 2;                      // which bar of the two-bar cell
        // The two bars of a cell share one frame of reference, otherwise the
        // motif's own contour and a re-anchor land on top of each other and the
        // line leaps an octave in the middle of its own phrase.
        const rootIdx = nearestIn(notes, [rootPc], half === 0 ? anchor : cellRoot);
        if (half === 0 && rootIdx >= 0) cellRoot = notes[rootIdx];
        if (rootIdx >= 0) {
          let last = null;
          for (const n of cell) {
            if (Math.floor(n.s / spb) !== half) continue;
            let idx = clamp(rootIdx + n.deg, 0, notes.length - 1);
            if (n.strong) {
              const ci = nearestIn(notes, pcs, notes[idx]);
              if (ci >= 0) idx = ci;
            }
            let m = notes[idx];
            while (m < P.melody.lo) m += 12;
            while (m > P.melody.hi) m -= 12;
            last = m;
            ev.push({ s: n.s - half * spb, len: Math.min(n.len, spb - (n.s - half * spb)), m, v: P.melody.v, layer: 'melody', vel: P.melody.gain * (n.strong ? 1 : 0.78) });
          }
          // Carry the line forward only at cell boundaries, and pull it back
          // towards the register the part lives in - left alone, "nearest chord
          // root to the last note" ratchets the whole phrase down an octave.
          if (half === 1 && last != null) {
            anchor = clamp(Math.round(last * 0.6 + P.melody.center * 0.4), P.melody.center - 7, P.melody.center + 7);
          }
        }
      }

      // -- accents: only heard when the intensity comes up.
      if (P.accent) {
        const mode = P.accent.mode;
        if (mode === 'stabs') {
          const hits = spb === 12 ? [0, 6] : [0, 6, 10];
          for (const s of hits) {
            if (s !== 0 && !(b % 2 === 1)) continue;
            for (let k = 0; k < Math.min(3, pcs.length); k++) {
              const idx = nearestIn(notes, [pcs[k]], P.accent.center + k * 4);
              if (idx >= 0) ev.push({ s, len: 2, m: notes[idx], v: P.accent.v, layer: 'accent', vel: P.accent.gain * (s === 0 ? 1 : 0.7) });
            }
          }
        } else if (mode === 'toll' && b % 4 === 0) {
          const idx = nearestIn(notes, [rootPc], P.accent.center);
          if (idx >= 0) ev.push({ s: 0, len: spb, m: notes[idx], v: P.accent.v, layer: 'accent', vel: P.accent.gain });
        } else if (mode === 'swell' && b % 2 === 1) {
          for (let k = 0; k < Math.min(2, pcs.length); k++) {
            const idx = nearestIn(notes, [pcs[k]], P.accent.center + k * 5);
            if (idx >= 0) ev.push({ s: spb / 2, len: spb / 2, m: notes[idx], v: P.accent.v, layer: 'accent', vel: P.accent.gain });
          }
        } else if (mode === 'echo' && b % 2 === 1) {
          const idx = nearestIn(notes, pcs, P.accent.center);
          if (idx >= 0) ev.push({ s: spb - 4, len: 4, m: notes[idx], v: P.accent.v, layer: 'accent', vel: P.accent.gain });
        }
      }

      // -- percussion.
      if (P.perc && P.perc.kit !== 'none') {
        for (const d of PERC[P.perc.kit](spb, barNo, rng)) {
          ev.push({ s: d.s, len: 1, drum: d.d, layer: 'perc', vel: d.v * P.perc.gain });
        }
      }

      ev.sort((a, b2) => a.s - b2.s);
      const byStep = new Array(spb);
      for (const e of ev) {
        const s = clamp(e.s | 0, 0, spb - 1);
        (byStep[s] || (byStep[s] = [])).push(e);
      }
      bars.push({ events: ev, byStep, chord, bar: barNo });
      barNo++;
    }
  }
  return { def, bars, spb, stepSec, barSec: spb * stepSec, notes };
}

const songCache = new Map();
function songFor(id) {
  let s = songCache.get(id);
  if (!s) { s = buildSong(T[id]); songCache.set(id, s); }
  return s;
}

/** Flat event dump for the audit tool: `bars` bars of `trackId`. */
export function debugEvents(trackId, barCount = 16) {
  const song = songFor(trackId);
  const out = [];
  for (let b = 0; b < barCount; b++) {
    const bar = song.bars[b % song.bars.length];
    for (const e of bar.events) {
      out.push({
        bar: b, step: e.s, beat: +(e.s / 4).toFixed(2), len: e.len,
        layer: e.layer, voice: e.v || e.drum,
        midi: e.m ?? null, note: e.m != null ? midiName(e.m) : e.drum,
        vel: +(e.vel || 0).toFixed(3),
        chord: `${midiName(song.def.key + bar.chord[0]).replace(/\d/, '')}${bar.chord[1]}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Percussion kit - rendered once into buffers, because a drum every 100 ms
// cannot afford to build an oscillator graph each time.
// ---------------------------------------------------------------------------

const DRUMS = {
  kick: { dur: 0.42, peak: 0.95, build: (c, o, rng) => {
    const osc = c.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(160, 0); osc.frequency.exponentialRampToValueAtTime(42, 0.14);
    const g = c.createGain(); g.gain.setValueAtTime(1, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.34);
    osc.connect(g); g.connect(o); osc.start(0); osc.stop(0.4);
    nz(c, o, rng, { dur: 0.03, g: 0.35, type: 'highpass', f: 1200 });
  } },
  tom: { dur: 0.5, peak: 0.8, build: (c, o, rng) => {
    const osc = c.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(300, 0); osc.frequency.exponentialRampToValueAtTime(105, 0.2);
    const g = c.createGain(); g.gain.setValueAtTime(1, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.4);
    osc.connect(g); g.connect(o); osc.start(0); osc.stop(0.48);
    nz(c, o, rng, { dur: 0.09, g: 0.3, type: 'bandpass', f: 900, Q: 1 });
  } },
  timp_lo: { dur: 1.0, peak: 0.95, build: (c, o, rng) => timp(c, o, rng, 98) },
  timp_hi: { dur: 0.9, peak: 0.9, build: (c, o, rng) => timp(c, o, rng, 147) },
  snare: { dur: 0.45, peak: 0.85, build: (c, o, rng) => {
    nz(c, o, rng, { dur: 0.22, g: 0.8, type: 'highpass', f: 1500 });
    nz(c, o, rng, { dur: 0.12, g: 0.4, type: 'bandpass', f: 3200, Q: 0.8 });
    const osc = c.createOscillator(); osc.type = 'triangle';
    osc.frequency.setValueAtTime(230, 0); osc.frequency.exponentialRampToValueAtTime(150, 0.1);
    const g = c.createGain(); g.gain.setValueAtTime(0.5, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.16);
    osc.connect(g); g.connect(o); osc.start(0); osc.stop(0.2);
  } },
  tamb: { dur: 0.45, peak: 0.7, build: (c, o, rng) => {
    for (let i = 0; i < 7; i++) {
      const t = rng.float(0, 0.035);
      nz(c, o, rng, { t, dur: rng.float(0.08, 0.22), g: rng.float(0.14, 0.3), type: 'bandpass', f: rng.float(5200, 9500), Q: 14 });
    }
    nz(c, o, rng, { dur: 0.02, g: 0.25, type: 'highpass', f: 4000 });
  } },
  shaker: { dur: 0.2, peak: 0.5, build: (c, o, rng) => {
    nz(c, o, rng, { dur: 0.07, g: 0.6, type: 'highpass', f: 6000, a: 0.004 });
  } },
  cym: { dur: 1.6, peak: 0.7, build: (c, o, rng) => {
    nz(c, o, rng, { dur: 1.4, g: 0.6, type: 'highpass', f: 4200, a: 0.004 });
    for (let i = 0; i < 6; i++) nz(c, o, rng, { dur: rng.float(0.4, 1.2), g: 0.12, type: 'bandpass', f: rng.float(3000, 11000), Q: 8 });
  } },
  gong: { dur: 2.6, peak: 0.9, build: (c, o, rng) => {
    for (const [m, g] of [[1, 0.3], [1.71, 0.2], [2.39, 0.14], [3.77, 0.08], [5.1, 0.05]]) {
      const car = c.createOscillator(); car.type = 'sine'; car.frequency.value = 78 * m;
      const mod = c.createOscillator(); mod.type = 'sine'; mod.frequency.value = 78 * m * 1.41;
      const mg = c.createGain();
      mg.gain.setValueAtTime(78 * m * 4, 0); mg.gain.exponentialRampToValueAtTime(1, 1.4);
      mod.connect(mg); mg.connect(car.frequency);
      const vg = c.createGain();
      vg.gain.setValueAtTime(0.0001, 0); vg.gain.linearRampToValueAtTime(g, 0.02);
      vg.gain.exponentialRampToValueAtTime(0.0005, 2.4);
      car.connect(vg); vg.connect(o);
      car.start(0); mod.start(0); car.stop(2.55); mod.stop(2.55);
    }
  } },
};

function timp(c, o, rng, f) {
  const osc = c.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(f * 1.5, 0);
  osc.frequency.exponentialRampToValueAtTime(f, 0.09);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(1, 0.006);
  g.gain.exponentialRampToValueAtTime(0.001, 0.85);
  osc.connect(g); g.connect(o); osc.start(0); osc.stop(0.95);
  const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.4;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.18, 0); g2.gain.exponentialRampToValueAtTime(0.001, 0.3);
  o2.connect(g2); g2.connect(o); o2.start(0); o2.stop(0.35);
  nz(c, o, rng, { dur: 0.05, g: 0.22, type: 'bandpass', f: 700, Q: 0.8 });
}

/** Small filtered-noise helper shared by the drum recipes. */
function nz(c, o, rng, { t = 0, dur = 0.1, g = 0.4, type = 'bandpass', f = 1000, Q = 1, a = 0.001 }) {
  const n = Math.ceil(Math.max(0.02, dur) * c.sampleRate);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = rng.float(-1, 1);
  const src = c.createBufferSource(); src.buffer = buf;
  const flt = c.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = Q;
  const vg = c.createGain();
  vg.gain.setValueAtTime(0.0001, t);
  vg.gain.linearRampToValueAtTime(g, t + a);
  vg.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  src.connect(flt); flt.connect(vg); vg.connect(o);
  src.start(t); src.stop(t + dur + 0.02);
}

const kitCache = new Map();
function buildKit(sampleRate) {
  const key = sampleRate | 0;
  let p = kitCache.get(key);
  if (p) return p;
  const OAC = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!OAC) return Promise.resolve({});
  p = Promise.all(Object.keys(DRUMS).map(async (id) => {
    const spec = DRUMS[id];
    const off = new OAC(1, Math.ceil(spec.dur * sampleRate), sampleRate);
    const bus = off.createGain();
    bus.gain.value = 1;
    bus.connect(off.destination);
    spec.build(off, bus, new Rand(hashStr('mm6drum:' + id)));
    const buf = await renderOffline(off);
    const d = buf.getChannelData(0);
    // DC block then normalise, same discipline as the SFX bakery.
    const rc = 1 - 2 * Math.PI * 15 / sampleRate;
    let x1 = 0, y1 = 0, peak = 0;
    for (let i = 0; i < d.length; i++) {
      const x = d[i]; const y = x - x1 + rc * y1; x1 = x; y1 = y; d[i] = y;
      const av = y < 0 ? -y : y; if (av > peak) peak = av;
    }
    const k = peak > 1e-6 ? spec.peak / peak : 1;
    const fo = Math.floor(0.004 * sampleRate);
    for (let i = 0; i < d.length; i++) d[i] *= k;
    for (let i = 0; i < fo; i++) d[d.length - 1 - i] *= i / fo;
    return [id, buf];
  })).then((pairs) => Object.fromEntries(pairs)).catch(() => ({}));
  kitCache.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------
// The player.
// ---------------------------------------------------------------------------

const LAYERS = ['pad', 'bass', 'arp', 'melody', 'accent', 'perc'];
const SEND = { pad: 0.55, bass: 0.06, arp: 0.22, melody: 0.3, accent: 0.28, perc: 0.16 };
const LOOKAHEAD = 0.25;   // seconds of events queued ahead of the clock
const TICK_MS = 50;
// Two caps: melody/pad/arp stop being added first, but the rhythm section is
// allowed past that line so a dropped voice never punches a hole in the beat.
// Nothing gets past the hard cap, which leaves headroom under the ~24 total.
const MUSIC_SOFT_CAP = 14;
const MUSIC_HARD_CAP = 20;

/** Soft-knee limiter curve: linear to 0.7, then tanh into a 0.93 ceiling. */
const LIMIT_CURVE = (() => {
  const n = 2048, c = new Float32Array(n), knee = 0.7;
  for (let k = 0; k < n; k++) {
    const x = (k / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    c[k] = x < 0 ? -y : y;
  }
  return c;
})();

function defaultMix(i) {
  return {
    pad: 1, bass: 0.85 + 0.15 * i, arp: 0.7 + 0.3 * i,
    melody: 1 - 0.4 * i, accent: 0.08 + 0.92 * i, perc: 0.3 + 0.7 * i,
  };
}

export class Music {
  /** @param {BaseAudioContext} audioCtx @param {AudioNode} masterGain */
  constructor(audioCtx, masterGain) {
    this.ctx = audioCtx || null;
    this.ok = !!audioCtx;
    this._current = null;
    this._intensity = 0;
    this.decks = [];
    this.voices = 0;
    this.timer = null;
    this.schedMs = 0;
    this.kit = null;
    if (!this.ok) { this._ready = Promise.resolve(false); return; }

    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    // A soft knee above 0.7 catches the moments when a tutti chord, a timpani
    // roll and the melody all land on beat one. Unity below the knee, so the
    // quiet tracks are untouched.
    this.limiter = ctx.createWaveShaper();
    this.limiter.curve = LIMIT_CURVE;
    this.limiter.oversample = '2x';
    this.out.connect(this.limiter);
    this.limiter.connect(masterGain || ctx.destination);

    // One shared plate for the whole score; layers feed it at fixed amounts so
    // a voice costs no extra nodes to make it sound like a hall.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 2.4, 2.6);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.42;
    this.reverb.connect(this.wet);
    this.wet.connect(this.out);

    // Shared vibrato: one oscillator fanned out to every sustaining voice.
    this.vib = ctx.createOscillator();
    this.vib.type = 'sine';
    this.vib.frequency.value = 5.1;
    this.vibDepth = ctx.createGain();
    this.vibDepth.gain.value = 6;       // cents
    this.vib.connect(this.vibDepth);
    try { this.vib.start(0); } catch (e) { /* offline contexts start at 0 anyway */ }

    this._ready = buildKit(ctx.sampleRate).then((k) => { this.kit = k; return true; });

    // Park the scheduler while the tab is hidden whether or not the shell
    // remembered to wire it up. Offline render contexts have no tab.
    if (!ctx.startRendering && typeof document !== 'undefined') {
      this._onVis = () => { if (document.hidden) this.suspend(); else this.resume(); };
      document.addEventListener('visibilitychange', this._onVis);
    }
  }

  ready() { return this._ready; }
  get current() { return this._current; }

  // -- deck plumbing --------------------------------------------------------

  _makeDeck(trackId) {
    const ctx = this.ctx;
    const song = songFor(trackId);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.out);
    const buses = {};
    const mix = (song.def.mix || defaultMix)(this._intensity);
    for (const L of LAYERS) {
      const g = ctx.createGain();
      g.gain.value = mix[L] ?? 1;
      g.connect(gain);
      const s = ctx.createGain();
      s.gain.value = SEND[L];
      g.connect(s);
      s.connect(this.reverb);
      buses[L] = g;
    }
    return { id: trackId, song, gain, buses, bar: 0, step: 0, nextTime: 0, dead: false };
  }

  _killDeck(deck, fade) {
    const t = this.ctx.currentTime;
    deck.dead = true;
    deck.gain.gain.cancelScheduledValues(t);
    deck.gain.gain.setValueAtTime(deck.gain.gain.value, t);
    deck.gain.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => {
      const k = this.decks.indexOf(deck);
      if (k >= 0) this.decks.splice(k, 1);
      try { deck.gain.disconnect(); for (const L of LAYERS) deck.buses[L].disconnect(); } catch (e) { /* gone */ }
    }, fade * 1000 + 120);
  }

  /** Crossfade to `trackId`. Re-calling with the current track is a no-op. */
  play(trackId, opts = {}) {
    if (!this.ok || !T[trackId]) return;
    if (this._current === trackId && this.decks.some((d) => !d.dead)) return;
    const fade = (opts.fadeMs ?? 900) / 1000;
    for (const d of this.decks) if (!d.dead) this._killDeck(d, fade);
    const deck = this._makeDeck(trackId);
    const t = this.ctx.currentTime;
    deck.gain.gain.setValueAtTime(0, t);
    deck.gain.gain.linearRampToValueAtTime(1, t + fade);
    deck.nextTime = t + 0.06;
    this.decks.push(deck);
    this._current = trackId;
    this._startClock();
  }

  stop(fadeMs = 900) {
    const fade = fadeMs / 1000;
    for (const d of this.decks) if (!d.dead) this._killDeck(d, fade);
    this._current = null;
    setTimeout(() => { if (!this.decks.length) this._stopClock(); }, fadeMs + 200);
  }

  /** 0 = exploring, 1 = swords out. Shifts the instrumentation, not the tune. */
  setIntensity(v) {
    this._intensity = clamp(v, 0, 1);
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    for (const d of this.decks) {
      const mix = (d.song.def.mix || defaultMix)(this._intensity);
      for (const L of LAYERS) d.buses[L].gain.setTargetAtTime(mix[L] ?? 1, t, 0.25);
    }
  }
  get intensity() { return this._intensity; }

  setVolume(v) { if (this.ok) this.out.gain.setTargetAtTime(clamp(v, 0, 1), this.ctx.currentTime, 0.05); }

  // -- scheduling -----------------------------------------------------------

  _startClock() {
    if (this.timer || !this.ok) return;
    if (typeof setInterval !== 'function') return;
    this.timer = setInterval(() => this._tick(), TICK_MS);
    this._tick();
  }
  _stopClock() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  _tick() {
    if (!this.ok || this.ctx.state === 'suspended') return;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const now = this.ctx.currentTime;
    for (const deck of this.decks) {
      const song = deck.song;
      let guard = 0;
      while (deck.nextTime < now + LOOKAHEAD && guard++ < 256) {
        this._scheduleStep(deck, deck.bar, deck.step, deck.nextTime);
        deck.nextTime += song.stepSec;
        deck.step++;
        if (deck.step >= song.spb) { deck.step = 0; deck.bar = (deck.bar + 1) % song.bars.length; }
      }
    }
    this.schedMs = this.schedMs * 0.9 + ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 0.1;
  }

  _scheduleStep(deck, bar, step, time) {
    const events = deck.song.bars[bar].byStep[step];
    if (!events) return;
    for (const e of events) this._note(deck, e, time);
  }

  _note(deck, e, time) {
    if (this.voices >= MUSIC_HARD_CAP) return;
    if (this.voices >= MUSIC_SOFT_CAP && e.layer !== 'perc' && e.layer !== 'bass') return;
    const bus = deck.buses[e.layer] || deck.gain;
    const dur = (e.len || 1) * deck.song.stepSec;
    if (e.drum) {
      const buf = this.kit && this.kit[e.drum];
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = e.vel * 0.6;
      src.connect(g); g.connect(bus);
      src.start(time);
      this._track(src, [g]);
      return;
    }
    const f = mtof(e.m);
    switch (e.v) {
      case 'pluck': return this._pluck(f, time, dur, e.vel, bus, deck.song.def.parts);
      case 'bowed': return this._bowed(f, time, dur, e.vel, bus);
      case 'brass': return this._brass(f, time, dur, e.vel, bus);
      case 'flute': return this._flute(f, time, dur, e.vel, bus);
      case 'choir': return this._choir(f, time, dur, e.vel, bus);
      case 'bell': return this._bell(f, time, dur, e.vel, bus);
      case 'bass': return this._bass(f, time, dur, e.vel, bus);
      default: return this._pluck(f, time, dur, e.vel, bus);
    }
  }

  _track(node, extra) {
    this.voices++;
    node.onended = () => {
      this.voices--;
      try { node.disconnect(); if (extra) for (const n of extra) n.disconnect(); } catch (err) { /* gone */ }
    };
  }

  _pluck(f, t, dur, vel, bus) {
    const ctx = this.ctx;
    const dec = Math.min(Math.max(dur * 1.4, 0.28), 1.6);
    const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f; o2.detune.value = 7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(Math.min(11000, f * 9), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(180, f * 1.8), t + Math.min(0.35, dec));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dec);
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(bus);
    o1.start(t); o2.start(t); o1.stop(t + dec + 0.02); o2.stop(t + dec + 0.02);
    this._track(o1, [o2, lp, g]);
  }

  _bowed(f, t, dur, vel, bus) {
    const ctx = this.ctx;
    const rel = 0.22;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f; o1.detune.value = -5;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f; o2.detune.value = 6;
    this.vibDepth.connect(o1.detune);
    this.vibDepth.connect(o2.detune);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = Math.min(4200, Math.max(700, f * 5));
    lp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.32, t + Math.min(0.11, dur * 0.4));
    g.gain.setValueAtTime(vel * 0.32, t + Math.max(0.02, dur - rel * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur + rel);
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(bus);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + rel + 0.02); o2.stop(t + dur + rel + 0.02);
    this._track(o1, [o2, lp, g]);
  }

  _brass(f, t, dur, vel, bus) {
    const ctx = this.ctx;
    const rel = 0.14;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f; o1.detune.value = -4;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f; o2.detune.value = 5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    // The filter opening late is what makes a saw read as a horn.
    lp.frequency.setValueAtTime(Math.max(300, f * 1.2), t);
    lp.frequency.linearRampToValueAtTime(Math.min(6000, f * 7), t + 0.09);
    lp.frequency.linearRampToValueAtTime(Math.min(3600, f * 4), t + Math.max(0.12, dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.3, t + 0.045);
    g.gain.setValueAtTime(vel * 0.3, t + Math.max(0.06, dur - 0.02));
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur + rel);
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(bus);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + rel + 0.02); o2.stop(t + dur + rel + 0.02);
    this._track(o1, [o2, lp, g]);
  }

  _flute(f, t, dur, vel, bus) {
    const ctx = this.ctx;
    const rel = 0.12;
    const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2; o2.detune.value = 4;
    this.vibDepth.connect(o1.detune);
    const mix = ctx.createGain(); mix.gain.value = 0.22;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.34, t + Math.min(0.06, dur * 0.35));
    g.gain.setValueAtTime(vel * 0.34, t + Math.max(0.05, dur - 0.02));
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur + rel);
    o1.connect(g); o2.connect(mix); mix.connect(g); g.connect(bus);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + rel + 0.02); o2.stop(t + dur + rel + 0.02);
    this._track(o1, [o2, mix, g]);
  }

  _choir(f, t, dur, vel, bus) {
    const ctx = this.ctx;
    const rel = 0.5;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f; o1.detune.value = -7;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f; o2.detune.value = 8;
    this.vibDepth.connect(o1.detune);
    // A single vowel formant is enough to sell "ah" at this distance.
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = clamp(f * 2.6, 400, 1400); bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.34, t + Math.min(0.3, dur * 0.5));
    g.gain.setValueAtTime(vel * 0.34, t + Math.max(0.2, dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur + rel);
    o1.connect(bp); o2.connect(bp); bp.connect(g); g.connect(bus);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + rel + 0.02); o2.stop(t + dur + rel + 0.02);
    this._track(o1, [o2, bp, g]);
  }

  _bell(f, t, dur, vel, bus) {
    const ctx = this.ctx;
    const dec = Math.min(Math.max(dur * 1.6, 0.8), 3);
    const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * 2.76;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 3.2, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.04, t + dec * 0.5);
    mod.connect(mg); mg.connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.4, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dec);
    car.connect(g); g.connect(bus);
    car.start(t); mod.start(t); car.stop(t + dec + 0.02); mod.stop(t + dec + 0.02);
    this._track(car, [mod, mg, g]);
  }

  _bass(f, t, dur, vel, bus) {
    const ctx = this.ctx;
    const rel = 0.12;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(Math.min(2400, f * 8), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120, f * 2.2), t + Math.min(0.3, dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel * 0.42, t + 0.012);
    g.gain.setValueAtTime(vel * 0.36, t + Math.max(0.03, dur - 0.03));
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur + rel);
    o1.connect(lp); lp.connect(g); g.connect(bus);
    o1.start(t); o1.stop(t + dur + rel + 0.02);
    this._track(o1, [lp, g]);
  }

  suspend() { this._stopClock(); }
  resume() { if (this.decks.length) this._startClock(); }
  get voiceCount() { return this.voices; }
}

/** Procedural hall impulse - noise under an exponential decay envelope. */
function makeImpulse(ctx, dur, decay) {
  const n = Math.max(1, Math.floor(dur * ctx.sampleRate));
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  const rng = new Rand(0x5eed17);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] = rng.float(-1, 1) * Math.min(1, t * 220) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Offline verification path.
// ---------------------------------------------------------------------------

/**
 * Render `bars` bars of a track to an AudioBuffer with no timers involved.
 * This is what the audit tool measures; it exercises exactly the same voice
 * code the live scheduler uses.
 */
export async function renderTrackOffline(trackId, bars = 16, sampleRate = 22050, intensity = 0.35) {
  const OAC = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext);
  if (!OAC || !T[trackId]) return null;
  const song = songFor(trackId);
  const tail = 3.0;
  const total = song.barSec * bars + tail;
  const off = new OAC(2, Math.ceil(total * sampleRate), sampleRate);
  const m = new Music(off, off.destination);
  await m.ready();
  m._intensity = intensity;
  const deck = m._makeDeck(trackId);
  deck.gain.gain.value = 1;
  m.decks.push(deck);
  m.voices = 0;
  for (let b = 0; b < bars; b++) {
    const barIdx = b % song.bars.length;
    for (let s = 0; s < song.spb; s++) {
      m.voices = 0;   // offline has no onended callbacks, so never let the cap bite
      m._scheduleStep(deck, barIdx, s, 0.05 + b * song.barSec + s * song.stepSec);
    }
  }
  return renderOffline(off);
}
