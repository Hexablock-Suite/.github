// export.test.mjs runs export.mjs through its command line, on the built fixture site.
// The tests that take images need a headless Chromium, so they skip on a machine with no Chromium.
// Each test keeps its files in a fresh system temp directory.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../cdp.mjs';

const DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MINI = path.join(DIR, '..', 'fixtures', 'mini.model.json');
const SCENARIO_REPO = path.join(DIR, '..', 'fixtures', 'mini-repo');
const SCENARIOS = path.join(SCENARIO_REPO, 'docs', 'architecture', 'scenarios.json');
const skip = findChrome() ? false : 'no Chromium on this machine';
const scratch = mkdtempSync(path.join(tmpdir(), 'drawio-clases-export-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let seq = 0;
const tmp = (name) => {
  seq += 1;
  return path.join(scratch, `${seq}-${name}`);
};
const lines = (text) => text.split('\n').filter(Boolean);
// NO_CHROME gives an environment where findChrome finds no browser: no CHROME_BIN, an empty home and an empty PATH.
const noChrome = () => {
  const empty = tmp('empty');
  mkdirSync(empty);
  return { CHROME_BIN: '', HOME: empty, PATH: empty };
};
const run = (args, env = {}) => spawnSync(process.execPath, [path.join(DIR, 'export.mjs'), ...args], { cwd: DIR, encoding: 'utf8', env: { ...process.env, ...env } });

// site builds the fixture site. With scenarios, scenarios.mjs first writes the checked scenario file next to the model, as the workflow does.
function site(withScenarios) {
  const models = tmp('models');
  mkdirSync(models);
  const mini = path.join(models, 'mini.model.json');
  copyFileSync(MINI, mini);
  if (withScenarios) {
    const s = spawnSync(process.execPath, [path.join(DIR, '..', 'scenarios.mjs'), SCENARIOS, mini, SCENARIO_REPO, models], { encoding: 'utf8' });
    assert.equal(s.status, 0, s.stdout + s.stderr);
  }
  const out = tmp('site');
  const b = spawnSync(process.execPath, [path.join(DIR, 'build.mjs'), mini, '--out', out], { cwd: DIR, encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr);
  return out;
}

// pngSize checks the PNG signature and reads the width and the height of the IHDR chunk, the first chunk after the signature.
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function pngSize(buf, where) {
  assert.deepEqual(buf.subarray(0, 8), SIGNATURE, where);
  assert.equal(buf.toString('latin1', 12, 16), 'IHDR', where);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

// The fixture scenarios, in the order of the scenario file. The repository key of the mini model is mini.
const IMAGES = [['mini-square-rules.png', 'A third rule set: Square Rules'], ['mini-file-store.png', 'A second store: File Store']];

test('#7: export.mjs writes one PNG per scenario of the fixture, at scale 2 of its window, and prints one line per image', { skip }, () => {
  const out = path.join(tmp('images'), 'scenarios');
  const r = run([site(true), out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
  const printed = lines(r.stdout);
  assert.equal(printed.length, IMAGES.length, r.stdout);
  assert.deepEqual(readdirSync(out).sort(), IMAGES.map(([name]) => name).sort());
  IMAGES.forEach(([name, title], i) => {
    // The window keeps the shape 1440 by 900 and grows up to three times that size.
    const head = `${path.join(out, name)}: ${title} `;
    assert.ok(printed[i].startsWith(head), printed[i]);
    const m = /^\(window (\d+)x(\d+), scale 2\)$/.exec(printed[i].slice(head.length));
    assert.ok(m, printed[i]);
    const [w, h] = [+m[1], +m[2]];
    assert.ok(w >= 1440 && w <= 4320 && Math.abs(w / h - 1.6) < 0.01, printed[i]);
    assert.deepEqual(pngSize(readFileSync(path.join(out, name)), name), [2 * w, 2 * h], name);
  });
});

test('#7: with no scenario in the site, export.mjs needs no browser, writes nothing, says so and ends with exit 0', () => {
  const s = site(false);
  const out = path.join(tmp('images'), 'scenarios');
  const r = run([s, out], noChrome());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
  assert.deepEqual(lines(r.stdout), [`${s}: no scenario, no image written`]);
  assert.equal(existsSync(out), false);
});

test('#7: with no Chromium, export.mjs gives one error line, writes no image and ends with exit 1', () => {
  const out = path.join(tmp('images'), 'scenarios');
  const r = run([site(true), out], noChrome());
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'error: no Chromium found: set CHROME_BIN\n');
  assert.equal(existsSync(out), false);
});

test('#7: a scenario that the page does not show gives one error line, writes no image and ends with exit 1', { skip }, () => {
  const s = site(true);
  rmSync(path.join(s, 'mini.scenario-file-store.positions.json'));
  const out = path.join(tmp('images'), 'scenarios');
  const r = run([s, out]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(lines(r.stderr).length, 1, r.stderr);
  assert.match(r.stderr, /^error: the page #mini~file-store did not show its scenario: .*mini\.scenario-file-store\.positions\.json/);
  assert.equal(existsSync(out), false);
});

test('#7: a wrong argument count or a folder with no built page gives one error line and exit 1', () => {
  const usage = 'error: usage: node export.mjs <site-dir> <out-dir>\n';
  for (const args of [[], ['one'], ['one', 'two', 'three']]) {
    const r = run(args);
    assert.equal(r.status, 1, args.join(' '));
    assert.equal(r.stderr, usage, args.join(' '));
  }
  const empty = tmp('nosite');
  mkdirSync(empty);
  const r = run([empty, tmp('out')]);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, `error: ${path.join(empty, 'index.html')} is missing: build the site first\n`);
});

test('findChrome finds the Playwright headless shell, as render.mjs does', () => {
  const home = tmp('home');
  const bin = path.join(home, '.cache', 'ms-playwright', 'chromium_headless_shell-1200', 'chrome-headless-shell-linux64', 'chrome-headless-shell');
  mkdirSync(path.dirname(bin), { recursive: true });
  writeFileSync(bin, '');
  const code = `import { findChrome } from ${JSON.stringify(pathToFileURL(path.join(DIR, 'cdp.mjs')).href)}; console.log(findChrome());`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, CHROME_BIN: '', HOME: home, PATH: home } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, bin + '\n');
});
