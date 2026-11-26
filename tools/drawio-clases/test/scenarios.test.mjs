// These tests run scenarios.mjs through its command line.
// Each test keeps its files in a fresh system temp directory.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeFile } from '../merge.mjs';

const DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MINI = path.join(DIR, 'fixtures', 'mini.model.json');
const REPO = path.join(DIR, 'fixtures', 'mini-repo');
const SCENARIOS = path.join(REPO, 'docs', 'architecture', 'scenarios.json');
const scratch = mkdtempSync(path.join(tmpdir(), 'drawio-clases-scenarios-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let seq = 0;
const tmp = (name) => {
  seq += 1;
  return path.join(scratch, `${seq}-${name}`);
};
const lines = (text) => text.split('\n').filter(Boolean);
const goodFile = () => JSON.parse(readFileSync(SCENARIOS, 'utf8'));

// run writes the scenario file, runs scenarios.mjs on it and returns the result and the files of the out dir.
function run(scenarios, repo = REPO) {
  const file = tmp('scenarios.json');
  writeFileSync(file, JSON.stringify(scenarios, null, 2));
  const out = tmp('out');
  mkdirSync(out);
  const r = spawnSync(process.execPath, [path.join(DIR, 'scenarios.mjs'), file, MINI, repo, out], { cwd: DIR, encoding: 'utf8' });
  return { r, file, out, written: readdirSync(out) };
}

// expectViolations checks the exit code, one line for each violation, the count line, and that no file was written.
function expectViolations(scenarios, expected, repo = REPO) {
  const { r, file, written } = run(scenarios, repo);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
  assert.deepEqual(lines(r.stdout), [...expected, `${file}: ${expected.length} violation(s)`]);
  assert.deepEqual(written, []);
}

// change returns the good fixture with one edit applied to its first scenario.
function change(edit) {
  const s = goodFile();
  edit(s.scenarios[0], s);
  return s;
}

test('scenarios: the good fixture passes and gives the layer and the part of each added box', () => {
  const out = tmp('out');
  mkdirSync(out);
  const r = spawnSync(process.execPath, [path.join(DIR, 'scenarios.mjs'), SCENARIOS, MINI, REPO, out], { cwd: DIR, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
  const outFile = path.join(out, 'mini.scenarios.json');
  assert.deepEqual(lines(r.stdout), [`${outFile}: 2 scenario(s), 2 added box(es), 0 violation(s)`]);
  assert.deepEqual(readdirSync(out), ['mini.scenarios.json']);
  const expected = goodFile();
  Object.assign(expected.scenarios[0].adds[0], { layer: 1, part: 'core' });
  Object.assign(expected.scenarios[1].adds[0], { layer: 3, part: 'shell' });
  const text = readFileSync(outFile, 'utf8');
  assert.deepEqual(JSON.parse(text), expected);
  assert.equal(text, JSON.stringify(expected, null, 2) + '\n');
});

test('scenarios: the fixture repository places each code type of the fixture model in its layer and its part', () => {
  const cfg = JSON.parse(readFileSync(path.join(REPO, 'docs', 'architecture', 'classes.config.json'), 'utf8'));
  const model = JSON.parse(readFileSync(MINI, 'utf8'));
  assert.deepEqual(cfg.parts.map(({ id, title }) => ({ id, title })), model.parts);
  for (const t of model.types.filter((x) => x.file)) {
    const { layer, part } = placeFile(cfg.folders, t.file) ?? {};
    assert.deepEqual({ layer, part }, { layer: t.layer, part: t.part }, t.id);
  }
});

test('scenarios: an extension point that is not a type id of the model is a violation', () => {
  expectViolations(change((s) => s.extensionPoints.push('Board')), [
    'scenario square-rules: extensionPoints names "Board", which is not a type id of the model',
  ]);
});

test('scenarios: an unchanged type that is not a type id of the model is a violation', () => {
  expectViolations(change((s) => s.unchanged.push('Board')), [
    'scenario square-rules: unchanged names "Board", which is not a type id of the model',
  ]);
});

test('scenarios: an added box that implements a type id the model does not have is a violation', () => {
  expectViolations(change((s) => (s.adds[0].implements = 'IRules')), [
    'scenario square-rules: added box SquareRules implements "IRules", which is not a type id of the model',
  ]);
});

test('scenarios: an added box that extends a type id the model does not have is a violation', () => {
  expectViolations(change((s) => (s.adds[0].extends = 'AbstractRules')), [
    'scenario square-rules: added box SquareRules extends "AbstractRules", which is not a type id of the model',
  ]);
});

test('scenarios: an added box with the name of a model type is a violation', () => {
  expectViolations(change((s) => (s.adds[0].name = 'LinesRules')), [
    'scenario square-rules: added box LinesRules has the name of a type of the model',
  ]);
});

test('scenarios: an added box in a file that no folder of the config holds is a violation', () => {
  expectViolations(change((s) => (s.adds[0].file = 'lib/square-rules.ts')), [
    'scenario square-rules: added box SquareRules has the file "lib/square-rules.ts", which no folder of classes.config.json holds',
  ]);
});

test('scenarios: an edited file that does not exist in the repository is a violation', () => {
  // fixtures/mini.model.json exists, but outside the repository root.
  expectViolations(
    change((s) => s.edits.push({ file: 'src/infrastructure/router.ts', change: 'one route' }, { file: '../mini.model.json', change: 'one type' })),
    [
      'scenario square-rules: edits the file "src/infrastructure/router.ts", which does not exist in the repository',
      'scenario square-rules: edits the file "../mini.model.json", which does not exist in the repository',
    ],
  );
});

test('scenarios: an unchanged type that is also an extension point is a violation', () => {
  expectViolations(change((s) => s.unchanged.push('Rules')), ['scenario square-rules: unchanged type Rules is also an extension point']);
});

test('scenarios: an unchanged type in a file of edits is a violation', () => {
  expectViolations(change((s) => s.unchanged.push('WebServer')), [
    'scenario square-rules: unchanged type WebServer sits in "src/infrastructure/web-server.ts", a file of edits',
  ]);
});

test('scenarios: an id with other characters than lowercase letters, digits and "-" is a violation', () => {
  expectViolations(change((s) => (s.id = 'Square_Rules')), ['scenario Square_Rules: the id is not lowercase letters, digits and "-"']);
});

test('scenarios: an id that two scenarios share is a violation', () => {
  expectViolations(change((s, file) => (file.scenarios[1].id = s.id)), ['scenario square-rules: the id is not unique in the file']);
});

test('scenarios: a field with another shape than MODEL.md gives is a violation', () => {
  expectViolations(
    change((s) => {
      s.adds[0].kind = 'struct';
      s.edits = 'src/infrastructure/web-server.ts';
    }),
    ['scenario square-rules: edits is not a list', 'scenario square-rules: adds[0].kind "struct" is not a kind of MODEL.md'],
  );
});

test('scenarios: a config of another repository than the model is a violation', () => {
  const repo = tmp('repo');
  mkdirSync(path.join(repo, 'docs', 'architecture'), { recursive: true });
  mkdirSync(path.join(repo, 'src', 'infrastructure'), { recursive: true });
  const cfg = JSON.parse(readFileSync(path.join(REPO, 'docs', 'architecture', 'classes.config.json'), 'utf8'));
  writeFileSync(path.join(repo, 'docs', 'architecture', 'classes.config.json'), JSON.stringify({ ...cfg, repo: 'other' }));
  writeFileSync(path.join(repo, 'src', 'infrastructure', 'web-server.ts'), '');
  writeFileSync(path.join(repo, 'src', 'main.ts'), '');
  expectViolations(goodFile(), ['classes.config.json is for "other", the model is for "mini"'], repo);
});

test('scenarios: each violation gives one line', () => {
  expectViolations(
    change((s) => {
      s.extensionPoints.push('Board');
      s.unchanged.push('Rules', 'WebServer');
      s.adds[0].file = 'lib/square-rules.ts';
    }),
    [
      'scenario square-rules: extensionPoints names "Board", which is not a type id of the model',
      'scenario square-rules: added box SquareRules has the file "lib/square-rules.ts", which no folder of classes.config.json holds',
      'scenario square-rules: unchanged type Rules is also an extension point',
      'scenario square-rules: unchanged type WebServer sits in "src/infrastructure/web-server.ts", a file of edits',
    ],
  );
});

test('scenarios: two added boxes with one name in one scenario are a violation', () => {
  expectViolations(change((s) => s.adds.push({ ...s.adds[0] })), ['scenario square-rules: added box SquareRules is added twice']);
});

test('scenarios: the written file gives each edited file as a normalized repository-relative path', () => {
  const { r, out } = run(change((s) => {
    s.edits[0].file = './src/infrastructure/../infrastructure/web-server.ts';
  }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const written = JSON.parse(readFileSync(path.join(out, 'mini.scenarios.json'), 'utf8'));
  assert.deepEqual(written.scenarios[0].edits, [{ file: 'src/infrastructure/web-server.ts', change: 'one entry in the rules list' }]);
  // The check of an unchanged type compares the same normalized path.
  expectViolations(change((s) => {
    s.edits[0].file = './src/infrastructure/web-server.ts';
    s.unchanged.push('WebServer');
  }), ['scenario square-rules: unchanged type WebServer sits in "src/infrastructure/web-server.ts", a file of edits']);
});

test('scenarios: an added box of kind component passes, because component is a kind of MODEL.md «Type»', () => {
  const { r, out } = run(change((s) => {
    s.adds[0].kind = 'component';
  }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(out, 'mini.scenarios.json'), 'utf8')).scenarios[0].adds[0].kind, 'component');
});

test('scenarios: an input that is missing or is not JSON gives exactly one error line, exit 1 and no file', () => {
  const bad = tmp('bad.json');
  writeFileSync(bad, '{\n  "scenarios": [\n    nope\n  ]\n}\n');
  for (const [args, file] of [[[bad, MINI, REPO], bad], [[tmp('missing.json'), MINI, REPO], null], [[SCENARIOS, bad, REPO], bad]]) {
    const out = tmp('out');
    const r = spawnSync(process.execPath, [path.join(DIR, 'scenarios.mjs'), ...args, out], { cwd: DIR, encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(lines(r.stderr).length, 1, r.stderr);
    assert.ok(r.stderr.startsWith(`error: ${file ?? args[0]}: `), r.stderr);
    assert.equal(existsSync(out), false);
  }
});

test('scenarios: a wrong argument count prints the usage and exits 2', () => {
  const r = spawnSync(process.execPath, [path.join(DIR, 'scenarios.mjs'), SCENARIOS, MINI], { cwd: DIR, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'usage: node scenarios.mjs <scenarios.json> <model.json> <repo-root> <out-dir>\n');
});
