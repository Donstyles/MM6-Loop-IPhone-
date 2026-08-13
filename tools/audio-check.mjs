// Numeric audit for the procedural audio system.
//
// Nobody can listen to this in CI, so instead we render every SFX and 16 bars
// of every music track offline in a real browser audio graph and measure them:
// duration, peak, RMS, DC offset, clipping, silence. Then we check the score is
// actually in key and repeats its phrases, that the ambience beds loop without
// a seam, and that the live scheduler holds its voice cap. Anything that fails
// is a bug in a synth patch, not a taste question.
//
//   node tools/audio-check.mjs             # boots its own vite dev server
//   MM6_URL=http://127.0.0.1:5173/ node tools/audio-check.mjs
//   node tools/audio-check.mjs --events    # also dump town/combat note events

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const PAGE = 'tools/preview/audio.html';
const MUSIC_BARS = 16;
const WANT_EVENTS = process.argv.includes('--events');

// One-shot stings, not loops: the victory fanfare and the defeat dirge are
// deliberately sparse (the dirge is a bell toll over a drone - music.js
// 316-331), so the "does it have a rhythm" lint does not apply to them.
// They are tagged in the report instead of silently skipped.
const STING_TRACKS = new Set(['victory', 'defeat']);

const LIMITS = {
  sfxMaxDur: 8.0,
  silentRms: 0.001,
  clipPeak: 0.99,
  maxDc: 0.01,
  minPeak: 0.02,      // that quiet means a broken patch, not a design choice
  initMs: 600,        // ARCHITECTURE budget for a user-gesture init
  seamRatio: 6,       // loop wrap step vs. average sample step
  melodySpan: 26,     // semitones a single melodic line may cover
  sfxVoiceCap: 24,
  musicVoiceCap: 20,
  inKeyPct: 92,
};

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5177', '--strictPort'], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let done = false;
    const onData = (b) => {
      if (!done && /Local:.*http/.test(b.toString())) { done = true; resolve({ proc, url: 'http://127.0.0.1:5177/' }); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    setTimeout(() => { if (!done) { done = true; resolve({ proc, url: 'http://127.0.0.1:5177/' }); } }, 6000);
    proc.on('error', reject);
  });
}

const fmt = (n, w, d = 3) => (n == null ? '-' : Number(n).toFixed(d)).padStart(w);

function judge(s, kind) {
  if (!s || s.error) return ['ERROR'];
  const f = [];
  if (s.silent || s.rms < LIMITS.silentRms) f.push('SILENT');
  if (s.peak > LIMITS.clipPeak) f.push('CLIP');
  if (Math.abs(s.dc) > LIMITS.maxDc) f.push('DC');
  if (kind === 'sfx' && s.duration > LIMITS.sfxMaxDur) f.push('TOO-LONG');
  if (s.peak < LIMITS.minPeak) f.push('TOO-QUIET');
  return f;
}

async function main() {
  let server = null;
  let base = process.env.MM6_URL;
  if (!base) { server = await startServer(); base = server.url; }

  const browser = await chromium.launch({
    executablePath: process.env.MM6_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--mute-audio',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('response', (r) => { if (r.status() === 404 && !/favicon/i.test(r.url())) errors.push('404 ' + r.url()); });

  const t0 = Date.now();
  await page.goto(base + PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#start');
  await page.click('#start');                    // the user gesture iOS demands
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });
  const timing = await page.evaluate(`(() => {
    const a = window.__audio;
    return { initMs: a.initMs, ctxMs: a.ctxMs, resumeMs: a.resumeMs, bakeMs: a.bakeMs,
             hot: a.buffers.size, sampleRate: a.ctx.sampleRate };
  })()`);

  const groups = await page.evaluate(`(async () => (await import('/src/core/audio.js')).SFX_GROUPS)()`);
  const trackIds = await page.evaluate(`(async () => (await import('/src/core/music.js')).TRACK_IDS)()`);

  // Cold bake of everything that init did not already cover.
  const bakeAllMs = await page.evaluate(`(async () => {
    const t = performance.now();
    await window.__audio.prerenderAll();
    return performance.now() - t;
  })()`);
  const totalBaked = await page.evaluate('window.__audio.buffers.size');

  const rows = [];
  let fails = 0;
  const fail = (what) => { fails++; return what; };

  console.log('\n============================================================');
  console.log(' MM6 Loop - procedural audio audit');
  console.log('============================================================\n');
  console.log(`context           ${timing.sampleRate} Hz`);
  console.log(`init (gesture)    ${timing.initMs.toFixed(1)} ms   [ctx ${timing.ctxMs.toFixed(1)} + resume ${timing.resumeMs.toFixed(1)} + bake ${timing.bakeMs.toFixed(1)} for ${timing.hot} hot sounds]`);
  console.log(`bake remaining    ${bakeAllMs.toFixed(0)} ms for the other ${totalBaked - timing.hot} (lazy, off the critical path)`);
  if (timing.initMs > LIMITS.initMs) { fails++; console.log(`  !! init exceeds the ${LIMITS.initMs} ms budget`); }

  console.log('\nSFX'.padEnd(22) + 'dur'.padStart(8) + 'peak'.padStart(8) + 'rms'.padStart(9) + 'dc'.padStart(11) + '  flags');
  console.log('-'.repeat(72));

  for (const [group, ids] of Object.entries(groups)) {
    console.log(`[${group}]`);
    for (const id of ids) {
      const s = await page.evaluate((x) => window.__sfxStats(x), id);
      const flags = judge(s, 'sfx');
      if (flags.length) fails++;
      rows.push({ kind: 'sfx', group, id, ...s, flags });
      console.log('  ' + id.padEnd(19) + fmt(s.duration, 8) + fmt(s.peak, 8) + fmt(s.rms, 9, 5) +
        fmt(s.dc, 11, 6) + '  ' + (flags.length ? flags.join(',') : 'ok'));
    }
  }

  console.log('\nAMBIENCE LOOP SEAMS  (wrap-around step vs. average step inside the buffer)');
  console.log('-'.repeat(72));
  for (const id of groups.ambience) {
    const s = await page.evaluate((x) => window.__loopSeam(x), id);
    const bad = s.ratio > LIMITS.seamRatio;
    if (bad) fails++;
    console.log('  ' + id.padEnd(19) + `avg step ${s.avgStep.toFixed(6)}  seam ${s.seam.toFixed(6)}  x${s.ratio.toFixed(2)}  ` + (bad ? fail('SEAM') : 'ok'));
  }

  console.log(`\nMUSIC  (${MUSIC_BARS} bars rendered offline @22.05 kHz, intensity 0.35)`);
  console.log('track'.padEnd(22) + 'dur'.padStart(8) + 'peak'.padStart(8) + 'rms'.padStart(9) + 'dc'.padStart(11) + '  flags');
  console.log('-'.repeat(72));
  for (const id of trackIds) {
    const s = await page.evaluate(([x, b]) => window.__trackStats(x, b), [id, MUSIC_BARS]);
    const flags = judge(s, 'music');
    if (flags.length) fails++;
    rows.push({ kind: 'music', id, ...s, flags });
    console.log('  ' + id.padEnd(19) + fmt(s.duration, 8) + fmt(s.peak, 8) + fmt(s.rms, 9, 5) +
      fmt(s.dc, 11, 6) + '  ' + (flags.length ? flags.join(',') : 'ok'));
  }

  console.log('\nMUSICAL SANITY  (are the notes in key, does the melody repeat, is it on the grid)');
  console.log('-'.repeat(72));
  const sanity = {};
  for (const id of trackIds) {
    const r = await page.evaluate(async ([x, bars]) => {
      const mm = await import('/src/core/music.js');
      const evs = mm.debugEvents(x, bars);
      const def = mm.TRACKS[x];
      const SC = {
        major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
        dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
        mixolydian: [0, 2, 4, 5, 7, 9, 10], harmMinor: [0, 2, 3, 5, 7, 8, 11],
      }[def.scale];
      const key = ((def.key % 12) + 12) % 12;
      const pitched = evs.filter((e) => e.midi != null);
      // A note is legal if it's in the scale OR a tone of the bar's chord -
      // dominant chords in minor keys carry a chromatic leading tone, bII
      // chords a chromatic root, and those are written notes, not bugs.
      const inKey = pitched.filter((e) =>
        SC.includes((((e.midi - key) % 12) + 12) % 12) ||
        (e.chordPcs && e.chordPcs.includes(((e.midi % 12) + 12) % 12))).length;

      // Melody-only measurements: one line, so its span is a real musical fact.
      const mel = evs.filter((e) => e.layer === 'melody');
      const mLo = mel.length ? Math.min(...mel.map((e) => e.midi)) : 0;
      const mHi = mel.length ? Math.max(...mel.map((e) => e.midi)) : 0;
      const barsSeen = [...new Set(evs.map((e) => e.bar))];
      const sig = (b) => mel.filter((e) => e.bar === b).map((e) => e.step + ':' + e.midi).join(',');
      const sigs = barsSeen.map(sig).filter((s) => s.length);
      const repeated = sigs.length - new Set(sigs).size;

      // Do notes actually land on the grid, and do they use more than one value?
      const onGrid = evs.every((e) => Number.isInteger(e.step) && e.step >= 0 && e.step < def.spb);
      const steps = new Set(evs.map((e) => e.step));

      // Rhythm sanity: nothing shorter than a 16th, nothing longer than 2 bars.
      const lens = evs.map((e) => e.len);
      const badLen = lens.filter((l) => l < 1 || l > def.spb * 2).length;

      return {
        events: evs.length, pitched: pitched.length, melodyNotes: mel.length,
        inKeyPct: pitched.length ? Math.round((inKey / pitched.length) * 1000) / 10 : 0,
        melodySpan: mHi - mLo, melodyRange: [mLo, mHi],
        repeatedBars: repeated, melodyBars: sigs.length,
        onGrid, distinctSteps: steps.size, badLen,
        layers: [...new Set(evs.map((e) => e.layer))].sort(),
      };
    }, [id, MUSIC_BARS]);
    sanity[id] = r;
    const sting = STING_TRACKS.has(id);
    const p = [];
    if (r.inKeyPct < LIMITS.inKeyPct) p.push('OUT-OF-KEY');
    if (r.melodyNotes && r.repeatedBars < 2) p.push('NO-REPEAT');
    if (!r.onGrid) p.push('OFF-GRID');
    if (r.melodySpan > LIMITS.melodySpan) p.push('MELODY-SPAN');
    if (r.badLen) p.push('BAD-LEN');
    if (r.distinctSteps < 3 && !sting) p.push('NO-RHYTHM');
    if (p.length) fails++;
    console.log('  ' + id.padEnd(14) + String(r.events).padStart(5) + ' ev  ' +
      String(r.inKeyPct).padStart(5) + '% in key  mel ' + String(r.melodyNotes).padStart(3) +
      ' span ' + String(r.melodySpan).padStart(2) +
      '  repeated-bars ' + String(r.repeatedBars).padStart(2) + '/' + r.melodyBars +
      '  steps ' + String(r.distinctSteps).padStart(2) +
      '  ' + (p.length ? p.join(',') : sting ? 'ok (sting)' : 'ok'));
  }

  console.log('\nRUNTIME  (live scheduler and voice pooling, not offline)');
  console.log('-'.repeat(72));
  const stress = await page.evaluate('window.__stress(96)');
  const stressBad = stress.peakVoices > LIMITS.sfxVoiceCap || stress.settled > 2;
  if (stressBad) fails++;
  console.log(`  sfx burst 96      peak voices ${stress.peakVoices} (cap ${LIMITS.sfxVoiceCap}), settled ${stress.settled}  ${stressBad ? 'FAIL' : 'ok'}`);

  for (const [id, inten] of [['town', 0], ['combat', 1]]) {
    const r = await page.evaluate(([x, i]) => window.__runTrack(x, 3000, i), [id, inten]);
    const bad = r.peakVoices > LIMITS.musicVoiceCap || r.avgSchedMs > 4;
    if (bad) fails++;
    console.log(`  ${id.padEnd(8)} i=${inten}    peak voices ${String(r.peakVoices).padStart(2)} (cap ${LIMITS.musicVoiceCap}), scheduler ${r.avgSchedMs} ms/tick  ${bad ? 'FAIL' : 'ok'}`);
  }

  // Unknown sound ids must not fail silently (that cost 18 broken call sites)
  // but must warn exactly once per id, and never throw.
  const warnRes = await page.evaluate(() => {
    let hits = 0;
    const orig = console.warn;
    console.warn = function (...args) {
      if (String(args[0]).includes('unknown sfx')) hits++;
      return orig.apply(console, args);
    };
    try {
      window.__audio.play('__no_such_sound__');
      window.__audio.play('__no_such_sound__');                          // same id: no second warn
      window.__audio.play('__no_such_sound_2__', { pos: { x: 0, y: 0, z: 0 } }); // positional path warns too
    } finally { console.warn = orig; }
    return hits;
  });
  const warnBad = warnRes !== 2;
  if (warnBad) fails++;
  console.log(`  unknown-id warns  ${warnRes} for 3 bad plays of 2 ids (want 2, once per id)  ${warnBad ? 'FAIL' : 'ok'}`);

  console.log('\nMASTER SAFETY  (worst-case combat pileup through the real master chain)');
  console.log('-'.repeat(72));
  const clipRes = await page.evaluate(async () => {
    const A = await import('/src/core/audio.js');
    const M = await import('/src/core/music.js');
    const a = window.__audio;
    const ids = ['explosion', 'lightning_crack', 'crit', 'hit_flesh', 'monster_die'];
    const bufs = [];
    for (const id of ids) bufs.push(await a.renderToBuffer(id));
    const sr = a.ctx.sampleRate;
    const musicBuf = await M.renderTrackOffline('combat', 4, sr, 1);
    const dur = Math.max(musicBuf.duration, ...bufs.map((b) => b.duration)) + 0.2;
    const render = async (limited) => {
      const off = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
      const master = off.createGain();
      master.gain.value = a.vol.master;
      if (limited) {
        const lim = A.makeSafetyLimiter(off);
        master.connect(lim.input);
        lim.output.connect(off.destination);
      } else {
        master.connect(off.destination);
      }
      const feed = (buf, gain) => {
        const src = off.createBufferSource();
        src.buffer = buf;
        const g = off.createGain();
        g.gain.value = gain;
        src.connect(g); g.connect(master);
        src.start(0);
      };
      for (const b of bufs) feed(b, a.vol.sfx);       // all SFX on the same frame
      feed(musicBuf, a.vol.music);                    // plus combat music at i=1
      const out = await off.startRendering();
      let peak = 0, sq = 0, n = 0;
      for (let c = 0; c < out.numberOfChannels; c++) {
        const d = out.getChannelData(c);
        for (let i = 0; i < d.length; i++) {
          const v = d[i] < 0 ? -d[i] : d[i];
          if (v > peak) peak = v;
          sq += d[i] * d[i]; n++;
        }
      }
      return { peak: +peak.toFixed(4), rms: +Math.sqrt(sq / Math.max(1, n)).toFixed(5) };
    };
    const raw = await render(false);
    const lim = await render(true);
    return { raw, lim, ids };
  });
  const clipBad = clipRes.lim.peak > 1.0;
  if (clipBad) fails++;
  console.log(`  ${clipRes.ids.join('+')}+combat(i=1)`);
  console.log(`  unlimited peak ${clipRes.raw.peak} rms ${clipRes.raw.rms}  ->  limited peak ${clipRes.lim.peak} rms ${clipRes.lim.rms}  ${clipBad ? 'FAIL (>1.0)' : 'ok (<=1.0)'}`);

  if (WANT_EVENTS) {
    mkdirSync('shots', { recursive: true });
    for (const id of ['town', 'combat']) {
      const evs = await page.evaluate(([x, b]) => window.__debugEvents(x, b), [id, MUSIC_BARS]);
      const lines = evs.map((e) =>
        `b${String(e.bar).padStart(2)} s${String(e.step).padStart(2)} ${String(e.chord).padEnd(7)} ` +
        `${e.layer.padEnd(7)} ${String(e.voice).padEnd(8)} ${String(e.note).padEnd(5)} len${String(e.len).padStart(3)} v${e.vel}`);
      const f = path.join('shots', `notes-${id}.txt`);
      writeFileSync(f, lines.join('\n'));
      console.log(`\nwrote ${f} (${evs.length} events)`);
      const mel = lines.filter((l) => l.includes('melody'));
      console.log(`  first 24 melody events of ${id}:`);
      console.log(mel.slice(0, 24).map((l) => '    ' + l).join('\n'));
    }
  }

  mkdirSync('shots', { recursive: true });
  writeFileSync('shots/audio-audit.json', JSON.stringify({ timing, bakeAllMs, rows, sanity }, null, 2));

  if (errors.length) {
    console.log('\n--- PAGE ERRORS ---');
    for (const e of errors.slice(0, 30)) console.log(e);
    fails += errors.length;
  }

  console.log(`\n${fails ? '!! ' + fails + ' FAILURE(S)' : 'ALL CHECKS PASSED'}   (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  await browser.close();
  if (server) server.proc.kill();
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(3); });
