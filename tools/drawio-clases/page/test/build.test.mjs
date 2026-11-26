// These tests run build.mjs through its command line.
// Each test keeps its files in a fresh system temp directory.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGeometry, routedCount } from '../geom.mjs';
import { boxText } from '../text.mjs';

const DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCENARIOS = path.join(DIR, '..', 'fixtures', 'mini.scenarios.json');
const SCENARIO_REPO = path.join(DIR, '..', 'fixtures', 'mini-repo');
const scratch = mkdtempSync(path.join(tmpdir(), 'drawio-clases-page-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
// The build reads the scenario file next to a model. The fixture folder also holds the source scenario file of scenarios.mjs.
// So the tests build a copy of the mini model, in a folder of its own.
const MINI = path.join(scratch, 'mini', 'mini.model.json');
mkdirSync(path.dirname(MINI));
copyFileSync(path.join(DIR, '..', 'fixtures', 'mini.model.json'), MINI);

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

// classType gives one code class of layer `layer` in the folder `folder`, drawn by the views `views`.
const classType = (id, layer, folder, views) => ({
  id, name: id, kind: 'class', abstract: false, status: 'code', sprint: null, stereotypes: [],
  layer, part: 'core', file: `src/${folder}/${id.toLowerCase()}.ts`, line: 1, typeParams: [],
  attrs: [], ops: [{ vis: '+', name: 'run', typeParams: [], params: [], ret: 'void', abstract: false, static: false }],
  values: [], alias: null, views, requirement: null,
});
const edge = (from, to, kind, label = null) => ({ from, to, kind, label, pattern: null, status: 'code', views: [] });

// ZONE_VIEWS are the three views of the zoned folder of zonedModel.
const ZONE_VIEWS = ['zone-1-a', 'zone-2-b', 'zone-3-c'];

// zonedModel is a model with one folder of 54 classes in three views of 18 classes.
// Each view is a chain of extends. Three attribute uses join two views, and one other use joins two views too.
function zonedModel() {
  const types = [];
  const edges = [];
  ZONE_VIEWS.forEach((v, z) => {
    for (let i = 0; i < 18; i++) {
      types.push(classType(`Z${z}N${i}`, 1, 'domain/zoned', [v]));
      if (i) edges.push(edge(`Z${z}N${i}`, `Z${z}N${i - 1}`, 'extends'));
    }
  });
  edges.push(edge('Z0N3', 'Z1N3', 'use', 'next 1'), edge('Z0N5', 'Z1N5', 'use', 'peer 1'), edge('Z1N8', 'Z2N8', 'use', 'cells *'));
  edges.push(edge('Z0N9', 'Z2N9', 'use', 'run()'));
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { repo: 'hexablock-zoned', head: '0000000', parts: [{ id: 'core', title: 'Core' }], types, edges };
}

// trunkModel has one interface with four implementers: two in the band above, and two in a folder beside it.
// The folder beside it puts its implementers at the height of the interface, so they come in from the side.
function trunkModel() {
  const types = [
    classType('Port', 2, 'application/ports', []),
    classType('SideImpl', 2, 'application/side', []), classType('SideImpl2', 2, 'application/side', []),
    classType('AdapterA', 3, 'adapters/a', []), classType('AdapterB', 3, 'adapters/b', []),
  ];
  types[0].kind = 'interface';
  const edges = ['AdapterA', 'AdapterB', 'SideImpl', 'SideImpl2'].map((id) => edge(id, 'Port', 'implements'));
  return { repo: 'hexablock-trunk', head: '0000000', parts: [{ id: 'core', title: 'Core' }], types, edges };
}

// gapOf gives the empty distance between two rectangles. It is negative when they overlap.
const gapOf = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));

// onBorder tells if a point lies on the border of a box.
const onBorder = ([x, y], [bx, by, bw, bh]) => x >= bx - 0.6 && x <= bx + bw + 0.6 && y >= by - 0.6 && y <= by + bh + 0.6 &&
  (Math.abs(x - bx) < 0.6 || Math.abs(x - bx - bw) < 0.6 || Math.abs(y - by) < 0.6 || Math.abs(y - by - bh) < 0.6);

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

// fixtureSites builds the fixture models once for the checks of S2 and S5b.
let fixtureCache = null;
function fixtureSites() {
  if (fixtureCache) return fixtureCache;
  const files = { mini: MINI, 'hexablock-big': writeJson('big.model.json', bigModel()), 'hexablock-zoned': writeJson('zoned.model.json', zonedModel()), 'hexablock-trunk': writeJson('trunk.model.json', trunkModel()) };
  const { out } = build(Object.values(files));
  fixtureCache = Object.entries(files).map(([repo, file]) => ({ repo, model: readJson(file), pos: readJson(path.join(out, `${repo}.positions.json`)) }));
  return fixtureCache;
}

test('S5b: on every fixture, no box overlaps a box and no line crosses a box that it does not join', () => {
  for (const { repo, model, pos } of fixtureSites()) {
    for (const density of ['compact', 'full']) {
      const g = checkGeometry(model, pos[density]);
      assert.equal(g.boxes, model.types.length, `${repo} ${density}`);
      assert.equal(g.lines, routedCount(model), `${repo} ${density}`);
      assert.equal(g.overlaps, 0, `${repo} ${density}: ${g.overlapList.join(' ')}`);
      assert.equal(g.crossings, 0, `${repo} ${density}: ${g.crossList.join(' ')}`);
      assert.equal(g.badEnds, 0, `${repo} ${density}`);
    }
  }
});

test('S2c, S5b: each folder frame and each zone frame reserves a label room that covers no box and no other label', () => {
  for (const { repo, model, pos } of fixtureSites()) {
    for (const density of ['compact', 'full']) {
      const P = pos[density];
      const framed = P.frames.filter((x) => x.kind === 'g' || x.zone);
      assert.ok(framed.length > 0, `${repo} ${density}`);
      for (const f of framed) {
        assert.ok(Array.isArray(f.lb) && f.lb.length === 4, `${repo} ${density} ${f.title}: no label room`);
        const [x, y, w, h] = f.lb;
        // The room lies inside its frame and holds at least one line of text.
        assert.ok(x >= f.x && y >= f.y && x + w <= f.x + f.w && y + h <= f.y + f.h && h >= 40, `${repo} ${density} ${f.title}: ${f.lb}`);
      }
      const g = checkGeometry(model, P);
      assert.equal(g.labels, framed.length, `${repo} ${density}`);
      assert.equal(g.labelBoxes, 0, `${repo} ${density}: ${g.labelList.join(' ')}`);
      assert.equal(g.labelLabels, 0, `${repo} ${density}: ${g.labelList.join(' ')}`);
    }
  }
});

test('S5b: checkGeometry counts a label room over a box and over another label', () => {
  const P = {
    w: 400, h: 300, bands: [], lines: [],
    boxes: { A: [100, 100, 80, 40], B: [300, 100, 80, 40] },
    frames: [
      { kind: 'g', title: 'a', x: 0, y: 0, w: 200, h: 200, lb: [90, 90, 40, 40] },
      { kind: 'g', title: 'b', x: 0, y: 0, w: 200, h: 200, lb: [110, 80, 40, 30] },
      { kind: 'g', title: 'c', x: 200, y: 0, w: 200, h: 200, lb: [200, 0, 60, 40] },
    ],
  };
  const g = checkGeometry({ edges: [] }, P);
  assert.equal(g.labels, 3);
  assert.equal(g.labelBoxes, 2);
  assert.equal(g.labelLabels, 1);
});

test('S2d, S5b: an aggregation edge reaches the positions with its kind, and its line starts on its from box', () => {
  const [{ model, pos }] = fixtureSites();
  const aggs = model.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === 'aggregation');
  assert.equal(aggs.length, 2);
  for (const density of ['compact', 'full']) {
    const P = pos[density];
    for (const ln of P.lines) assert.equal(ln.k, model.edges[ln.i].kind, `${density} line ${ln.i}`);
    for (const { e, i } of aggs) {
      const ln = P.lines.find((l) => l.i === i);
      assert.ok(ln, `${density}: no line for ${e.from}>${e.to}`);
      assert.equal(ln.k, 'aggregation');
      // The hollow diamond sits at the from end, and the label sits near the other end.
      assert.ok(onBorder(ln.p[0], P.boxes[e.from]), `${density} ${e.from}: ${ln.p[0]}`);
      assert.ok(onBorder(ln.p[ln.p.length - 1], P.boxes[e.to]), `${density} ${e.to}`);
      const end = ln.p[ln.p.length - 1];
      assert.ok(Math.hypot(ln.lb[0] - end[0], ln.lb[1] - end[1]) < Math.hypot(ln.lb[0] - ln.p[0][0], ln.lb[1] - ln.p[0][1]), `${density}: label ${ln.lb}`);
    }
  }
});

test('S2d: the side panel names a diamond by its kind', () => {
  const { relationText } = boxText;
  assert.equal(relationText(edge('A', 'B', 'aggregation', 'decorate 1')), 'aggregation · decorate 1');
  assert.equal(relationText(edge('A', 'B', 'composition', 'state 0..1')), 'composition · state 0..1');
  assert.equal(relationText(edge('A', 'B', 'aggregation')), 'aggregation');
  // The other kinds keep their text.
  assert.equal(relationText(edge('A', 'B', 'use', 'run()')), 'run()');
  assert.equal(relationText(edge('A', 'B', 'use')), 'use');
  assert.equal(relationText(edge('A', 'B', 'implements')), 'implements');
  assert.equal(relationText(edge('A', 'B', 'extends')), 'extends');
});

test('S5a: the highlight lists one set per pattern of the edges, with its edges and their two ends', () => {
  const { patternSets } = boxText;
  const model = readJson(MINI);
  const sets = patternSets(model);
  assert.deepEqual(sets.map((s) => s.name), ['Command', 'Decorator', 'State', 'Strategy']);
  for (const s of sets) {
    const edges = model.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.pattern === s.name);
    assert.deepEqual(s.edges, edges.map(({ i }) => i));
    assert.deepEqual(s.ids, [...new Set(edges.flatMap(({ e }) => [e.from, e.to]))].sort());
  }
  assert.deepEqual(sets.find((s) => s.name === 'Decorator').ids, ['LoggingAspect', 'UseCase']);
  // A model with no pattern gives no set.
  assert.deepEqual(patternSets({ edges: [edge('A', 'B', 'use', 'x 1')] }), []);
});

test('S2a: a folder of 48 types or more draws each view as a zone, with corridors between the zones', () => {
  const sites = fixtureSites();
  const zoned = sites.find((s) => s.repo === 'hexablock-zoned');
  for (const density of ['compact', 'full']) {
    const P = zoned.pos[density];
    const zones = P.frames.filter((f) => f.zone);
    assert.deepEqual(zones.map((f) => f.title).sort(), ZONE_VIEWS.map((v) => 'view ' + v));
    for (const f of zones) assert.deepEqual(f.ids.slice().sort(), zoned.model.types.filter((t) => t.views[0] === f.title.slice(5)).map((t) => t.id).sort());
    for (let a = 0; a < zones.length; a++) for (let b = a + 1; b < zones.length; b++) {
      assert.ok(gapOf(zones[a], zones[b]) >= 144, `${density}: ${zones[a].title} and ${zones[b].title} are ${gapOf(zones[a], zones[b])} apart`);
    }
  }
  // The large folder of 14 types keeps its plain view frames.
  const big = sites.find((s) => s.repo === 'hexablock-big');
  assert.equal(big.pos.compact.frames.filter((f) => f.zone).length, 0);
  assert.equal(big.pos.compact.frames.filter((f) => f.kind === 'v').length, 2);
});

test('S2a: a line between two zones carries the flag zx, and the layout draws no summary line', () => {
  const zoned = fixtureSites().find((s) => s.repo === 'hexablock-zoned');
  const { model } = zoned;
  for (const density of ['compact', 'full']) {
    const P = zoned.pos[density];
    const zoneOf = new Map();
    P.frames.forEach((f, fi) => { if (f.zone) for (const id of f.ids) zoneOf.set(id, fi); });
    // The three attribute uses cross zones. The extends chains stay inside their zone.
    const cross = P.lines.filter((l) => zoneOf.get(model.edges[l.i].from) !== zoneOf.get(model.edges[l.i].to));
    assert.deepEqual(cross.map((l) => model.edges[l.i].label).sort(), ['cells *', 'next 1', 'peer 1']);
    for (const l of P.lines) assert.equal(!!l.zx, cross.includes(l), `${density} line ${l.i}`);
    // The zone labels and the real lines say how the zones connect. No line with a count stands for them.
    assert.equal('sums' in P, false, `${density}: the positions list summary lines`);
  }
  const page = readFileSync(path.join(build([writeJson('zoned-page.model.json', zonedModel())]).out, 'index.html'), 'utf8');
  assert.equal(/id="sums"|class="sum\b|sw-sum/.test(page), false, 'the page still draws a summary line');
});

test('S2a: the page marks the frame of a zone, so the reader sees where each zone ends', () => {
  const page = readFileSync(path.join(build([writeJson('zoned-frame.model.json', zonedModel())]).out, 'index.html'), 'utf8');
  // app.js gives the class fr-z to the frame of a zone, and page.css gives that class a fill and a solid border.
  assert.match(page, /f\.zone \? ' fr-z' : ''/);
  const rule = page.match(/\.fr-z \{[^}]*\}/);
  assert.ok(rule, 'page.css has no rule for a zone frame');
  assert.match(rule[0], /fill: (?!none)/);
  assert.match(rule[0], /stroke-dasharray: none/);
});

test('S2b: the implements lines into one interface end at one point, so they share one trunk', () => {
  const trunk = fixtureSites().find((s) => s.repo === 'hexablock-trunk');
  for (const density of ['compact', 'full']) {
    const P = trunk.pos[density];
    const ends = P.lines.filter((l) => trunk.model.edges[l.i].kind === 'implements').map((l) => l.p[l.p.length - 1].join(','));
    assert.equal(ends.length, 4);
    assert.deepEqual([...new Set(ends)], [ends[0]], `${density}: ${ends.join(' ')}`);
  }
});

test('#6: each band has a label room at its top left, and no group frame of the band overlaps it', () => {
  for (const { repo, pos } of fixtureSites()) {
    for (const density of ['compact', 'full']) {
      const P = pos[density];
      assert.deepEqual(P.bands.map((b) => b.layer), [4, 3, 2, 1], `${repo} ${density}`);
      for (const b of P.bands) {
        const where = `${repo} ${density} band ${b.layer}`;
        assert.ok(Array.isArray(b.lb) && b.lb.length === 4, `${where}: no label room`);
        const [x, y, w, h] = b.lb;
        // The room starts at the top left corner of the band, lies inside the band and holds at least one line of text.
        assert.ok(x === b.x && y === b.y && x + w <= b.x + b.w && y + h <= b.y + b.h && w > 0 && h >= 40, `${where}: ${b.lb}`);
        for (const f of P.frames.filter((fr) => fr.kind === 'g' && fr.layer === b.layer)) {
          assert.ok(gapOf({ x, y, w, h }, f) >= 0, `${where}: the folder ${f.title} overlaps the room ${b.lb}`);
        }
      }
    }
  }
});

// scenarioDir gives a directory with the mini model and its checked scenario file, as the workflow leaves them.
// scenarios.mjs writes the scenario file, so the build reads the same file as on the site.
function scenarioDir() {
  const dir = tmp('models');
  mkdirSync(dir);
  copyFileSync(MINI, path.join(dir, 'mini.model.json'));
  const r = spawnSync(process.execPath, [path.join(DIR, '..', 'scenarios.mjs'), SCENARIOS, MINI, SCENARIO_REPO, dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return dir;
}

test('#7: with no scenario file the build writes the same page, model and positions bytes as with one, and the page holds the scenario selector', () => {
  const plain = build([MINI]);
  const withScenarios = build([path.join(scenarioDir(), 'mini.model.json')]);
  assert.deepEqual(readdirSync(plain.out).sort(), ['index.html', 'mini.model.json', 'mini.positions.json']);
  for (const f of ['index.html', 'mini.model.json', 'mini.positions.json']) {
    assert.deepEqual(readFileSync(path.join(withScenarios.out, f)), readFileSync(path.join(plain.out, f)), f);
  }
  const html = readFileSync(path.join(plain.out, 'index.html'), 'utf8');
  assert.match(html, /<select id="sc"[^>]*>\s*<option value="">No scenario<\/option>/);
});

// ADDED gives the group of each added box of the fixture scenarios: the folder of its file below src/.
const ADDED = { SquareRules: 'domain/rules', FileStore: 'adapters' };

test('#7: the build writes the scenario file and one positions file per scenario, laid out on a copy of the model with the added boxes', () => {
  const dir = scenarioDir();
  const a = build([path.join(dir, 'mini.model.json')]);
  const b = build([path.join(dir, 'mini.model.json')]);
  assert.deepEqual(filesOf(b.out), filesOf(a.out));
  const { out } = a;
  assert.deepEqual(readdirSync(out).sort(), [
    'index.html', 'mini.model.json', 'mini.positions.json',
    'mini.scenario-file-store.positions.json', 'mini.scenario-square-rules.positions.json', 'mini.scenarios.json',
  ]);
  assert.deepEqual(readFileSync(path.join(out, 'mini.scenarios.json')), readFileSync(path.join(dir, 'mini.scenarios.json')));
  const model = readJson(MINI);
  for (const s of readJson(path.join(dir, 'mini.scenarios.json')).scenarios) {
    const pos = readJson(path.join(out, `mini.scenario-${s.id}.positions.json`));
    // The lines of the added boxes come after the edges of the model, in the order of the adds.
    const added = s.adds.flatMap((x) => ['implements', 'extends'].filter((k) => x[k]).map((k) => edge(x.name, x[k], k)));
    const scenarioEdges = { edges: [...model.edges, ...added] };
    for (const density of ['compact', 'full']) {
      const P = pos[density];
      const where = `${s.id} ${density}`;
      assert.deepEqual(Object.keys(P.boxes).sort(), [...model.types.map((t) => t.id), ...s.adds.map((x) => x.name)].sort(), where);
      const g = checkGeometry(scenarioEdges, P);
      assert.equal(g.overlaps, 0, `${where}: ${g.overlapList.join(' ')}`);
      assert.equal(g.crossings, 0, `${where}: ${g.crossList.join(' ')}`);
      assert.equal(g.badEnds, 0, where);
      for (const x of s.adds) {
        // The added box sits in the group of its file, in the band of its layer.
        const frame = P.frames.find((f) => f.kind === 'g' && f.layer === x.layer && f.title === ADDED[x.name]);
        assert.ok(frame, `${where}: no group ${ADDED[x.name]}`);
        const [bx, by, bw, bh] = P.boxes[x.name];
        assert.ok(bx >= frame.x && by >= frame.y && bx + bw <= frame.x + frame.w && by + bh <= frame.y + frame.h, `${where}: ${x.name} is outside ${frame.title}`);
      }
      added.forEach((e, j) => {
        const ln = P.lines.find((l) => l.i === model.edges.length + j);
        assert.ok(ln, `${where}: no line ${e.from} ${e.kind} ${e.to}`);
        assert.equal(ln.k, e.kind);
        assert.ok(onBorder(ln.p[0], P.boxes[e.from]) && onBorder(ln.p[ln.p.length - 1], P.boxes[e.to]), `${where}: ${ln.p}`);
      });
    }
  }
});

test('#7: a scenario file that is not JSON, or that adds a line to a type the model does not have, gives one error line, exit 1 and no file', () => {
  const good = readJson(path.join(scenarioDir(), 'mini.scenarios.json'));
  const bad = structuredClone(good);
  bad.scenarios[0].adds[0].extends = 'Nope';
  for (const [text, why] of [['{ not json', /mini\.scenarios\.json is not JSON/], [JSON.stringify(bad), /Nope/]]) {
    const dir = tmp('models');
    mkdirSync(dir);
    copyFileSync(MINI, path.join(dir, 'mini.model.json'));
    writeFileSync(path.join(dir, 'mini.scenarios.json'), text);
    const out = tmp('site');
    const r = run([path.join(dir, 'mini.model.json'), '--out', out]);
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.stdout, '');
    const err = lines(r.stderr);
    assert.equal(err.length, 1, r.stderr);
    assert.match(err[0], /^error: /);
    assert.match(err[0], why);
    assert.equal(existsSync(out), false);
  }
});
