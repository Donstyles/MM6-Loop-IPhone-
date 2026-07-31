// Numeric audit for the procedural audio system.
//
// Nobody can listen to this in CI, so instead we render every SFX and 16 bars
// of every music track offline in a real browser audio graph and measure them:
// duration, peak, RMS, DC offset, clipping, silence. Anything that fails is a
// bug in a synth patch, not a taste question.
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

const LIMITS = {
  sfxMaxDur: 8.0,
  silentRms: 0.001,
  clipPeak: 0.99,
  maxDc: 0.01,
  minPeak: 0.02,    // something that quiet is a broken patch, not a design choice
};

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5177', '--strictPort'], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let done = false;
    const onData = (b) => {
      const s = b.toString();
      if (!done && /Local:.*http/.test(s)) { done = true; resolve({ proc, url: 'http://127.0.0.1:5177/' }); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    setTimeout(() => { if (!done) { done = true; resolve({ proc, url: 'http://127.0.0.1:5177/' }); } }, 6000);
    proc.on('error', reject);
  });
}

function fmt(n, w, d = 3) { return (n == null ? '-' : Number(n).toFixed(d)).padStart(w); }

function judge(s, kind) {
  const f = [];
  if (!s || s.error) return ['ERROR'];
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await page.goto(base + PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#start');
  const t0 = Date.now();
  await page.click('#start');                    // the user gesture iOS demands
  await page.waitForFunction('window.__ready === true', { timeout: 30000 });
  const initMs = await page.evaluate('window.__audio.initMs');

  const groups = await page.evaluate(`(async () => {
    const m = await import('/src/core/audio.js');
    return m.SFX_GROUPS;
  })()`);
  const trackIds = await page.evaluate(`(async () => (await import('/src/core/music.js')).TRACK_IDS)()`);

  const rows = [];
  let fails = 0;

  console.log(`\nMM6 procedural audio audit   (context init ${initMs.toFixed(1)} ms)\n`);
  console.log('SFX'.padEnd(20) + 'dur'.padStart(8) + 'peak'.padStart(8) + 'rms'.padStart(9) + 'dc'.padStart(11) + '  flags');
  console.log('-'.repeat(70));

  for (const [group, ids] of Object.entries(groups)) {
    console.log(`[${group}]`);
    for (const id of ids) {
      const s = await page.evaluate((x) => window.__sfxStats(x), id);
      const flags = judge(s, 'sfx');
      if (flags.length) fails++;
      rows.push({ kind: 'sfx', group, id, ...s, flags });
      console.log(
        '  ' + id.padEnd(18) + fmt(s.duration, 8) + fmt(s.peak, 8) + fmt(s.rms, 9, 5) +
        fmt(s.dc, 11, 6) + '  ' + (flags.length ? flags.join(',') : 'ok')
      );
    }
  }

  console.log('\nMUSIC (' + MUSIC_BARS + ' bars, offline @22.05k)');
  console.log('track'.padEnd(20) + 'dur'.padStart(8) + 'peak'.padStart(8) + 'rms'.padStart(9) + 'dc'.padStart(11) + '  flags');
  console.log('-'.repeat(70));
  for (const id of trackIds) {
    const s = await page.evaluate(([x, b]) => window.__trackStats(x, b), [id, MUSIC_BARS]);
    const flags = judge(s, 'music');
    if (flags.length) fails++;
    rows.push({ kind: 'music', id, ...s, flags });
    console.log(
      '  ' + id.padEnd(18) + fmt(s.duration, 8) + fmt(s.peak, 8) + fmt(s.rms, 9, 5) +
      fmt(s.dc, 11, 6) + '  ' + (flags.length ? flags.join(',') : 'ok')
    );
  }

  // Musical sanity: are the notes actually in key, and do phrases repeat?
  console.log('\nMUSICAL SANITY');
  console.log('-'.repeat(70));
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
      const pitched = evs.filter((e) => e.midi != null);
      const key = ((def.key % 12) + 12) % 12;
      const inKey = pitched.filter((e) => SC.includes((((e.midi - key) % 12) + 12) % 12)).length;
      const mel = evs.filter((e) => e.layer === 'melody');
      const sig = (b) => mel.filter((e) => e.bar === b).map((e) => e.step + ':' + e.midi).join(',');
      const bars0 = [...new Set(evs.map((e) => e.bar))];
      const sigs = bars0.map(sig);
      const uniq = new Set(sigs.filter((s) => s.length));
      const steps = [...new Set(evs.map((e) => e.step))].sort((a, b) => a - b);
      const grid = evs.every((e) => e.step >= 0 && e.step < def.spb);
      const lo = Math.min(...pitched.map((e) => e.midi));
      const hi = Math.max(...pitched.map((e) => e.midi));
      return {
        events: evs.length, pitched: pitched.length, melodyNotes: mel.length,
        inKeyPct: pitched.length ? Math.round((inKey / pitched.length) * 1000) / 10 : 0,
        distinctMelodyBars: uniq.size, totalBars: bars0.length,
        range: [lo, hi], onGrid: grid, distinctSteps: steps.length,
      };
    }, [id, MUSIC_BARS]);
    sanity[id] = r;
    const problems = [];
    if (r.inKeyPct < 92) problems.push('OUT-OF-KEY');
    if (r.melodyNotes && r.distinctMelodyBars >= r.totalBars) problems.push('NO-REPEAT');
    if (!r.onGrid) problems.push('OFF-GRID');
    if (r.range[1] - r.range[0] > 46) problems.push('RANGE');
    if (problems.length) fails++;
    console.log(
      '  ' + id.padEnd(14) + String(r.events).padStart(5) + ' ev  ' +
      String(r.inKeyPct).padStart(5) + '% in key  melody ' + String(r.melodyNotes).padStart(4) +
      '  distinct-bars ' + String(r.distinctMelodyBars).padStart(2) + '/' + r.totalBars +
      '  range ' + r.range[0] + '-' + r.range[1] +
      '  ' + (problems.length ? problems.join(',') : 'ok')
    );
  }

  if (WANT_EVENTS) {
    mkdirSync('shots', { recursive: true });
    for (const id of ['town', 'combat']) {
      const evs = await page.evaluate(([x, b]) => window.__debugEvents(x, b), [id, MUSIC_BARS]);
      const lines = evs.map((e) =>
        `b${String(e.bar).padStart(2)} s${String(e.step).padStart(2)} ${String(e.chord).padEnd(7)} ` +
        `${e.layer.padEnd(7)} ${String(e.voice).padEnd(8)} ${String(e.note).padEnd(5)} len${String(e.len).padStart(3)} v${e.vel}`
      );
      const f = path.join('shots', `notes-${id}.txt`);
      writeFileSync(f, lines.join('\n'));
      console.log(`\nwrote ${f} (${evs.length} events)`);
      console.log(lines.slice(0, 40).join('\n'));
    }
  }

  // Timing budget: how long does baking everything actually take?
  const bakeMs = await page.evaluate(`(async () => {
    const t = performance.now();
    await window.__audio.prerenderAll();
    return performance.now() - t;
  })()`);
  console.log(`\nbake-all (every sound, cold cache misses only): ${bakeMs.toFixed(0)} ms`);
  console.log(`eager init (hot set only):                       ${initMs.toFixed(1)} ms`);

  mkdirSync('shots', { recursive: true });
  writeFileSync('shots/audio-audit.json', JSON.stringify({ initMs, bakeMs, rows, sanity }, null, 2));

  if (errors.length) {
    console.log('\n--- PAGE ERRORS ---');
    for (const e of errors.slice(0, 30)) console.log(e);
    fails += errors.length;
  }

  console.log(`\n${fails ? '!! ' + fails + ' FAILURE(S)' : 'all checks passed'}   (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  await browser.close();
  if (server) server.proc.kill();
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(3); });
