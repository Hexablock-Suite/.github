// These tests run the scripts through their command line.
// Each test keeps its files in a fresh system temp directory.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { absBoxes, parseXml, readPages } from '../check.mjs';

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
