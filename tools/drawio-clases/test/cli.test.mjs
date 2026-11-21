// These tests run the scripts through their command line.
// Each test keeps its files in a fresh system temp directory.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { absBoxes, labelText, parseXml, readPages } from '../check.mjs';

const DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MINI = path.join(DIR, 'fixtures', 'mini.model.json');
const scratch = mkdtempSync(path.join(tmpdir(), 'drawio-clases-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let seq = 0;
const tmp = (name) => {
  seq += 1;
  return path.join(scratch, `${seq}-${name}`);
};
const run = (script, args) => spawnSync(process.execPath, [path.join(DIR, script), ...args], { cwd: DIR, encoding: 'utf8' });
const lines = (text) => text.split('\n').filter(Boolean);

// The cell ids of the mini model need no encoding, except "|" (_7c_) and "/" (_2f_) in group keys.
const ENGINE = ['Engine', 'Outcome', 'Phase', 'Rules'];
const ENGINE_GROUP = 'core|src/domain/engine';
const LAYER1_GROUPS = ['core|src/domain/engine', 'core|src/domain/rules', 'core|planned'];
const groupCell = (key) => `all-classes~group-${key.replace(/\|/g, '_7c_').replace(/\//g, '_2f_')}`;

function page1(file) {
  const page = readPages(parseXml(readFileSync(file, 'utf8')))[0];
  return { page, boxes: absBoxes(page) };
}

// orderOf returns the cell names sorted by row, then by column, as gen.mjs places them.
function orderOf(file, names, cellOf) {
  const { boxes } = page1(file);
  return [...names].sort((a, b) => {
    const p = boxes.get(cellOf(a));
    const q = boxes.get(cellOf(b));
    return p.y - q.y || p.x - q.x;
  });
}
const boxOrder = (file, ids) => orderOf(file, ids, (id) => `all-classes~type-${id}`);
const groupOrder = (file, keys) => orderOf(file, keys, groupCell);

function generate(args = []) {
  const out = tmp('out.drawio');
  const r = run('gen.mjs', [MINI, out, ...args]);
  assert.equal(r.status, 0, r.stderr);
  return { out, r };
}

function writeJson(name, value) {
  const file = tmp(name);
  writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

// setGeometry moves one box of a .drawio text to x, y relative to its parent.
function setGeometry(xml, cellId, x, y) {
  const re = new RegExp(`(<object id="${cellId}"[^>]*><mxCell[^>]*><mxGeometry )x="-?\\d+" y="-?\\d+"`);
  assert.match(xml, re);
  return xml.replace(re, `$1x="${x}" y="${y}"`);
}

test('S1: a layout fixes the box order of a group, and check.mjs accepts the result', () => {
  const plain = generate();
  const reversed = boxOrder(plain.out, ENGINE).reverse();
  const layout = writeJson('layout.json', { pages: { 'all-classes': { 1: [{ group: ENGINE_GROUP, types: reversed }] } } });
  const fixed = generate(['--layout', layout]);
  assert.equal(fixed.r.stderr, '');
  assert.deepEqual(boxOrder(fixed.out, ENGINE), reversed);
  const c = run('check.mjs', [fixed.out, MINI]);
  assert.equal(c.status, 0, c.stdout);
});

test('S1: a layout fixes the group order of a band', () => {
  const plain = generate();
  const reversed = groupOrder(plain.out, LAYER1_GROUPS).reverse();
  const layout = writeJson('layout.json', { pages: { 'all-classes': { 1: reversed.map((group) => ({ group, types: [] })) } } });
  const fixed = generate(['--layout', layout]);
  assert.equal(fixed.r.stderr, '');
  assert.deepEqual(groupOrder(fixed.out, LAYER1_GROUPS), reversed);
});

test('S1: an unknown type or group gives one warning each, and an unlisted type comes after the fixed ones', () => {
  const layout = writeJson('layout.json', {
    pages: {
      'all-classes': {
        1: [
          { group: 'core|nowhere', types: ['Engine'] },
          { group: ENGINE_GROUP, types: ['Nope', 'Rules'] },
        ],
      },
    },
  });
  const { out, r } = generate(['--layout', layout]);
  const warnings = lines(r.stderr);
  assert.equal(warnings.length, 2, r.stderr);
  assert.match(warnings[0], /^warning: .*"core\|nowhere"/);
  assert.match(warnings[1], /^warning: .*"Nope"/);
  const order = boxOrder(out, ENGINE);
  assert.equal(order[0], 'Rules');
  assert.deepEqual([...order].sort(), [...ENGINE].sort());
});

test('S2: pin.mjs reads two swapped boxes, and gen.mjs keeps the swap', () => {
  const plain = generate();
  const before = boxOrder(plain.out, ENGINE);
  const [a, b] = before;
  const { page } = page1(plain.out);
  const ga = page.cells.get(`all-classes~type-${a}`).geo;
  const gb = page.cells.get(`all-classes~type-${b}`).geo;
  let xml = readFileSync(plain.out, 'utf8');
  xml = setGeometry(xml, `all-classes~type-${a}`, gb.x, gb.y);
  xml = setGeometry(xml, `all-classes~type-${b}`, ga.x, ga.y);
  const edited = tmp('edited.drawio');
  writeFileSync(edited, xml);
  const layout = tmp('layout.json');
  const p = run('pin.mjs', [edited, MINI, layout]);
  assert.equal(p.status, 0, p.stderr);
  assert.equal(p.stderr, '');
  const fixed = generate(['--layout', layout]);
  assert.deepEqual(boxOrder(fixed.out, ENGINE), [b, a, ...before.slice(2)]);
});

test('S2: a box moved out of its group stays in its model group, with one warning', () => {
  const plain = generate();
  const { page } = page1(plain.out);
  const label = page.cells.get(groupCell('core|src/domain/rules')).geo;
  const xml = setGeometry(readFileSync(plain.out, 'utf8'), 'all-classes~type-Outcome', label.x, Number(label.y) + 28);
  const edited = tmp('edited.drawio');
  writeFileSync(edited, xml);
  const layout = tmp('layout.json');
  const p = run('pin.mjs', [edited, MINI, layout]);
  assert.equal(p.status, 0, p.stderr);
  const warnings = lines(p.stderr);
  assert.equal(warnings.length, 1, p.stderr);
  assert.match(warnings[0], /^warning: .*"Outcome"/);
  const band1 = JSON.parse(readFileSync(layout, 'utf8')).pages['all-classes']['1'];
  assert.ok(band1.every((g) => !g.types.includes('Outcome')));
  const pinned = band1.find((g) => g.group === ENGINE_GROUP).types;
  const fixed = generate(['--layout', layout]);
  assert.deepEqual(boxOrder(fixed.out, ENGINE), [...pinned, 'Outcome']);
  const c = run('check.mjs', [fixed.out, MINI]);
  assert.equal(c.status, 0, c.stdout);
});

test('S2: pin.mjs of an unedited file, then gen.mjs --layout, gives the bytes of gen.mjs with no layout', () => {
  const plain = generate();
  const layout = tmp('layout.json');
  const p = run('pin.mjs', [plain.out, MINI, layout]);
  assert.equal(p.status, 0, p.stderr);
  assert.equal(p.stderr, '');
  const fixed = generate(['--layout', layout]);
  assert.equal(fixed.r.stderr, '');
  assert.ok(readFileSync(fixed.out).equals(readFileSync(plain.out)));
});

test('S4: gen.mjs with no layout writes the bytes of the expected file', () => {
  const { out } = generate();
  assert.ok(readFileSync(out).equals(readFileSync(path.join(DIR, 'fixtures', 'mini.expected.drawio'))));
});

test('previous behavior: merge.mjs --check and check.mjs keep their exit codes and the explicit config', () => {
  const m = run('merge.mjs', ['--check', 'fixtures/model-bad.json']);
  assert.equal(m.status, 1);
  assert.match(m.stdout, /fixtures\/model-bad\.json: 2 violation\(s\)/);
  const broken = run('check.mjs', ['fixtures/broken.drawio', 'fixtures/mini.model.json']);
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /39 violation\(s\) in fixtures\/broken\.drawio/);
  // A code class with no operation needs a stereotype of the config (check (i)).
  const model = JSON.parse(readFileSync(MINI, 'utf8'));
  const server = model.types.find((t) => t.id === 'WebServer');
  server.ops = [];
  server.stereotypes = ['module'];
  const modelFile = writeJson('module.model.json', model);
  const out = tmp('module.drawio');
  assert.equal(run('gen.mjs', [modelFile, out]).status, 0);
  const config = writeJson('config.json', { stereotypeFor: { WebServer: 'module' } });
  const withConfig = run('check.mjs', [out, modelFile, config]);
  assert.equal(withConfig.status, 0, withConfig.stdout);
  const without = run('check.mjs', [out, modelFile]);
  assert.equal(without.status, 1);
  assert.match(without.stdout, /\[i\] .*"WebServer"/);
});

test('check.mjs accepts an operation with a destructured parameter that has a type', () => {
  const model = JSON.parse(readFileSync(MINI, 'utf8'));
  const play = model.types.find((t) => t.id === 'Engine').ops.find((op) => op.name === 'play');
  play.params = ['[from, to]: Move'];
  const modelFile = writeJson('destructured.model.json', model);
  const out = tmp('destructured.drawio');
  assert.equal(run('gen.mjs', [modelFile, out]).status, 0);
  const r = run('check.mjs', [out, modelFile]);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /0 violations/);
});

// bigModel adds 14 classes of two views and one long type alias to the engine group of the mini model.
// The engine group then holds 19 boxes, so it is a large group.
// The view engine-overview draws 14 of the 19 boxes, more than half, so it is an overview and no home.
// extra adds that many small classes to a second large group, src/application/extra in layer 2.
function bigModel(extra = 0) {
  const model = JSON.parse(readFileSync(MINI, 'utf8'));
  const base = { abstract: false, status: 'code', sprint: null, stereotypes: [], layer: 1, part: 'core', line: 1, typeParams: [], attrs: [], values: [], alias: null, requirement: null };
  for (let k = 1; k <= 14; k += 1) {
    const ops = [{ vis: '+', name: 'value', typeParams: [], params: [], ret: 'number', abstract: false, static: false }];
    if (k === 1) {
      ops.push({ vis: '+', name: 'restore', typeParams: [], params: ['key: ProgressKey', 'highScore: Score | null', 'updatedAt: SyncInstant', 'results: readonly LevelResult[]', 'more: readonly LevelResult[]'], ret: 'PlayerProgress', abstract: false, static: false });
    }
    model.types.push({ ...base, id: `Cell${k}`, name: `Cell${k}`, kind: 'class', file: `src/domain/engine/cell${k}.ts`, ops, views: ['engine-overview', k % 2 ? 'engine-a' : 'engine-b'] });
  }
  const alias = `| ${Array.from({ length: 6 }, (_, k) => `{ readonly useCase: string; readonly outcome: 'failure-${k}'; readonly kind: string }`).join(' | ')}`;
  model.types.push({ ...base, id: 'LongEntry', name: 'LongEntry', kind: 'type', file: 'src/domain/engine/long-entry.ts', ops: [], alias, views: [] });
  for (let k = 1; k <= extra; k += 1) {
    const ops = [{ vis: '+', name: 'handle', typeParams: [], params: ['request: MoveRequest'], ret: 'void', abstract: false, static: false }];
    model.types.push({ ...base, id: `Extra${k}`, name: `Extra${k}`, kind: 'class', layer: 2, file: `src/application/extra/extra${k}.ts`, ops, views: [] });
  }
  model.edges.push({ from: 'Cell1', to: 'Engine', kind: 'use', label: 'run()', pattern: null, status: 'code', views: [] });
  model.edges.push({ from: 'Cell2', to: 'Cell1', kind: 'use', label: null, pattern: null, status: 'code', views: [] });
  return model;
}

function generateBig(extra = 0) {
  const modelFile = writeJson('big.model.json', bigModel(extra));
  const out = tmp('big.drawio');
  const r = run('gen.mjs', [modelFile, out]);
  assert.equal(r.status, 0, r.stderr);
  return { modelFile, out };
}

const inside = (b, r) => b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;

test('S8: use lines recede into their own layer, and structure lines stay strong', () => {
  const { out } = generate();
  const { page } = page1(out);
  const layer = page.cells.get('all-classes~layer-use');
  assert.ok(layer, 'page 1 has a use layer');
  assert.equal(layer.parent, '0');
  assert.equal(layer.value, 'use lines');
  assert.equal(layer.vertex, undefined);
  const edges = [...page.cells.values()].filter((c) => c.edge === '1');
  const use = edges.filter((c) => c.id.endsWith('-use'));
  const structure = edges.filter((c) => /-(extends|implements|composition)$/.test(c.id));
  assert.ok(use.length && structure.length);
  for (const c of use) {
    assert.equal(c.parent, 'all-classes~layer-use', c.id);
    assert.equal(c.styleMap.strokeWidth, '1', c.id);
    assert.equal(c.styleMap.fontSize, '10', c.id);
    assert.notEqual(c.styleMap.strokeColor, '#1f2937', c.id);
    assert.notEqual(c.styleMap.dashed, '1', c.id);
  }
  for (const c of structure) {
    assert.equal(c.parent, '1', c.id);
    assert.equal(c.styleMap.strokeWidth, '2', c.id);
    assert.equal(c.styleMap.fontSize, '11', c.id);
  }
  const c = run('check.mjs', [out, MINI]);
  assert.equal(c.status, 0, c.stdout);
});

test('S8: a large group puts the boxes of one view in a frame with the view title', () => {
  const { modelFile, out } = generateBig();
  const { page, boxes } = page1(out);
  const frames = [...page.cells.values()].filter((c) => c.data.role === 'frame');
  const byView = new Map(frames.map((f) => [f.data.view, f]));
  assert.ok(byView.has('engine-a') && byView.has('engine-b'), frames.map((f) => f.data.view).join());
  assert.match(labelText(byView.get('engine-a').label), /engine-a/);
  for (let k = 1; k <= 14; k += 1) {
    const frame = byView.get(k % 2 ? 'engine-a' : 'engine-b');
    assert.ok(inside(boxes.get(`all-classes~type-Cell${k}`), boxes.get(frame.id)), `Cell${k} sits in its frame`);
  }
  // A small group gets no frame.
  assert.ok(frames.every((f) => f.parent === 'all-classes~band-1'));
  const c = run('check.mjs', [out, modelFile]);
  assert.equal(c.status, 0, c.stdout);
  // pin.mjs ignores the frames: the round trip keeps the bytes.
  const layout = tmp('layout.json');
  const p = run('pin.mjs', [out, modelFile, layout]);
  assert.equal(p.status, 0, p.stderr);
  assert.equal(p.stderr, '');
  const again = tmp('again.drawio');
  assert.equal(run('gen.mjs', [modelFile, again, '--layout', layout]).status, 0);
  assert.ok(readFileSync(again).equals(readFileSync(out)));
});

test('S8: a large group uses the width of its band and packs its boxes in columns', () => {
  // The 60 extra classes make the page wider than the engine group needs.
  const { out } = generateBig(60);
  const { boxes } = page1(out);
  const band = boxes.get('all-classes~band-1');
  for (const key of [ENGINE_GROUP, 'core|src/application/extra']) assert.equal(boxes.get(groupCell(key)).w, band.w - 2 * 48, key);
  const xs = new Set();
  for (let k = 1; k <= 14; k += 1) xs.add(boxes.get(`all-classes~type-Cell${k}`).x);
  assert.ok(xs.size >= 3, `the 14 boxes use ${xs.size} columns`);
});

test('S8: a long type alias and a long operation wrap, so the box stays narrow', () => {
  const { modelFile, out } = generateBig();
  const { boxes } = page1(out);
  assert.ok(boxes.get('all-classes~type-LongEntry').w <= 520, `LongEntry is ${boxes.get('all-classes~type-LongEntry').w} wide`);
  assert.ok(boxes.get('all-classes~type-Cell1').w <= 520, `Cell1 is ${boxes.get('all-classes~type-Cell1').w} wide`);
  // check (e) reads a wrapped operation as one operation.
  const c = run('check.mjs', [out, modelFile]);
  assert.equal(c.status, 0, c.stdout);
});
