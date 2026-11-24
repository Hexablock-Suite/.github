// These tests run build.mjs through its command line.
// Each test keeps its files in a fresh system temp directory.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGeometry, routedCount } from '../geom.mjs';

const DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MINI = path.join(DIR, '..', 'fixtures', 'mini.model.json');
const scratch = mkdtempSync(path.join(tmpdir(), 'drawio-clases-page-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let seq = 0;
const tmp = (name) => {
  seq += 1;
  return path.join(scratch, `${seq}-${name}`);
};
const run = (args) => spawnSync(process.execPath, [path.join(DIR, 'build.mjs'), ...args], { cwd: DIR, encoding: 'utf8' });
const lines = (text) => text.split('\n').filter(Boolean);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

// bigModel is a model with one large folder group: 14 classes in two views, joined by a chain of extends.
// A large group draws one frame for each view.
function bigModel() {
  const type = (i) => ({
    id: `Big${i}`, name: `Big${i}`, kind: 'class', abstract: i === 0, status: 'code', sprint: null, stereotypes: [],
    layer: 1, part: 'core', file: `src/domain/big/big-${i}.ts`, line: 1, typeParams: [],
    attrs: [], ops: [{ vis: '+', name: 'run', typeParams: [], params: [], ret: 'void', abstract: false, static: false }],
    values: [], alias: null, views: [i % 2 ? 'big-1-odd' : 'big-2-even'], requirement: null,
  });
  const types = Array.from({ length: 14 }, (_, i) => type(i));
  const edges = types.slice(1).map((t, i) => ({ from: t.id, to: types[i].id, kind: 'extends', label: null, pattern: null, status: 'code', views: [] }));
  return { repo: 'hexablock-big', head: '0000000', parts: [{ id: 'core', title: 'Core' }], types, edges };
}

function writeJson(name, value) {
  const file = tmp(name);
  writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function build(models, extra = []) {
  const out = tmp('site');
  const r = run([...models, '--out', out, ...extra]);
  assert.equal(r.status, 0, r.stderr);
  return { out, r };
}

// filesOf reads every file of a directory, by name.
const filesOf = (dir) => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(path.join(dir, f))]));

test('S1: the build writes the page, and one model file and one positions file per repository', () => {
  const big = writeJson('big.model.json', bigModel());
  const { out, r } = build([MINI, big]);
  assert.equal(r.stderr, '');
  assert.deepEqual(readdirSync(out).sort(), ['hexablock-big.model.json', 'hexablock-big.positions.json', 'index.html', 'mini.model.json', 'mini.positions.json']);
  assert.deepEqual(readFileSync(path.join(out, 'mini.model.json')), readFileSync(MINI));
  const html = readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(html, /^<!doctype html>\n<html lang="en">\n<head>\n/);
  assert.match(html, /<\/body>\n<\/html>\n$/);
  // The repository switch has one button per model, in the order of the arguments.
  const buttons = [...html.matchAll(/<button type="button" role="radio" aria-checked="false" data-r="([a-z0-9]+)" data-file="([^"]+)">([^<]+)<\/button>/g)];
  assert.deepEqual(buttons.map((m) => m.slice(1)), [['mini', 'mini', 'Mini'], ['big', 'hexablock-big', 'Big']]);
});

test('S1: every type has a box in both densities, and no box overlaps another', () => {
  const big = writeJson('big.model.json', bigModel());
  const { out } = build([MINI, big]);
  for (const [repo, file] of [['mini', MINI], ['hexablock-big', big]]) {
    const model = readJson(file);
    const pos = readJson(path.join(out, `${repo}.positions.json`));
    for (const density of ['compact', 'full']) {
      const P = pos[density];
      assert.deepEqual(Object.keys(P.boxes).sort(), model.types.map((t) => t.id).sort(), `${repo} ${density}`);
      const g = checkGeometry(model, P);
      assert.equal(g.overlaps, 0, `${repo} ${density}: ${g.overlapList.join(' ')}`);
    }
  }
});

test('S1: every structure and attribute line has a route, and no route crosses a box that it does not join', () => {
  const big = writeJson('big.model.json', bigModel());
  const { out } = build([MINI, big]);
  for (const [repo, file] of [['mini', MINI], ['hexablock-big', big]]) {
    const model = readJson(file);
    const pos = readJson(path.join(out, `${repo}.positions.json`));
    for (const density of ['compact', 'full']) {
      const g = checkGeometry(model, pos[density]);
      assert.equal(g.lines, routedCount(model), `${repo} ${density}`);
      assert.equal(g.crossings, 0, `${repo} ${density}: ${g.crossList.join(' ')}`);
      assert.equal(g.badEnds, 0, `${repo} ${density}`);
    }
  }
});

test('S1: a large folder group draws one frame for each view', () => {
  const big = writeJson('big.model.json', bigModel());
  const { out } = build([big]);
  const pos = readJson(path.join(out, 'hexablock-big.positions.json'));
  const views = pos.compact.frames.filter((f) => f.kind === 'v').map((f) => f.title).sort();
  assert.deepEqual(views, ['view big-1-odd', 'view big-2-even']);
  assert.deepEqual(pos.compact.frames.filter((f) => f.kind === 'g').map((f) => f.title), ['domain/big']);
  assert.deepEqual(pos.compact.bands.map((b) => b.layer), [4, 3, 2, 1]);
});

test('S1: two builds of the same models give the same bytes', () => {
  const big = writeJson('big.model.json', bigModel());
  const a = build([MINI, big]);
  const b = build([MINI, big]);
  assert.deepEqual(filesOf(b.out), filesOf(a.out));
  const c = build([MINI, big], ['--artifact']);
  const d = build([MINI, big], ['--artifact']);
  assert.deepEqual(filesOf(d.out), filesOf(c.out));
});

test('S1: --artifact writes the same page as a fragment, beside the same data files', () => {
  const site = build([MINI]);
  const art = build([MINI], ['--artifact']);
  assert.deepEqual(readdirSync(art.out).sort(), ['diagrama-clases-hexablock.html', 'mini.model.json', 'mini.positions.json']);
  const frag = readFileSync(path.join(art.out, 'diagrama-clases-hexablock.html'), 'utf8');
  assert.doesNotMatch(frag, /<!doctype|<html[\s>]|<\/html>|<head>|<\/head>|<body[\s>]|<\/body>/i);
  assert.match(frag, /^<title>HexaBlock class diagram<\/title>\n/);
  for (const f of ['mini.model.json', 'mini.positions.json']) assert.deepEqual(readFileSync(path.join(art.out, f)), readFileSync(path.join(site.out, f)));
  // The fragment is the body of the full page with the head content in front.
  const full = readFileSync(path.join(site.out, 'index.html'), 'utf8');
  const strip = (s) => s.replace(/<!doctype html>\n<html lang="en">\n<head>\n|<\/head>\n<body>\n|<\/body>\n<\/html>\n/g, '');
  assert.equal(strip(full), frag);
});

test('S1: a wrong argument gives one error line, exit code 1 and no file', () => {
  const notJson = tmp('bad.json');
  writeFileSync(notJson, '{ not json');
  const noTypes = writeJson('no-types.json', { repo: 'mini', head: '0', parts: [], edges: [] });
  const badEdge = writeJson('bad-edge.json', { ...readJson(MINI), edges: [{ from: 'Nope', to: 'Engine', kind: 'use', label: null, pattern: null, status: 'code', views: [] }] });
  const badRepo = writeJson('bad-repo.json', { ...readJson(MINI), repo: 'Mini Repo' });
  const missing = path.join(scratch, 'missing.model.json');
  const cases = [
    { args: [], why: /usage/ },
    { args: [MINI], why: /--out/ },
    { args: [MINI, '--out'], why: /--out/ },
    { args: ['--out', tmp('x')], why: /model/ },
    { args: [MINI, '--out', tmp('x'), '--zoom'], why: /--zoom/ },
    { args: [missing, '--out', tmp('x')], why: /missing\.model\.json/ },
    { args: [notJson, '--out', tmp('x')], why: /not JSON/ },
    { args: [noTypes, '--out', tmp('x')], why: /types/ },
    { args: [badEdge, '--out', tmp('x')], why: /Nope/ },
    { args: [badRepo, '--out', tmp('x')], why: /Mini Repo/ },
    { args: [MINI, MINI, '--out', tmp('x')], why: /twice/ },
  ];
  for (const c of cases) {
    const r = run(c.args);
    assert.equal(r.status, 1, `${c.args.join(' ')}: ${r.stderr}`);
    assert.equal(r.stdout, '');
    const err = lines(r.stderr);
    assert.equal(err.length, 1, r.stderr);
    assert.match(err[0], /^error: /);
    assert.match(err[0], c.why);
    const out = c.args[c.args.indexOf('--out') + 1];
    if (c.args.includes('--out') && out) assert.equal(existsSync(out), false, out);
  }
});
