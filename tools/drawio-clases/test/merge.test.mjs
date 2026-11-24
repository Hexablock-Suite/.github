// These tests call merge() and extract() of the generator on small inputs.
// Each test keeps its files in a fresh system temp directory.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extract } from '../extract.mjs';
import { merge } from '../merge.mjs';
import { parseView } from '../views.mjs';

const scratch = mkdtempSync(path.join(tmpdir(), 'drawio-clases-merge-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let seq = 0;
const tmp = (name) => {
  seq += 1;
  return path.join(scratch, `${seq}-${name}`);
};

// The config puts every file of src/ in layer 2 of one part.
const config = (patterns = {}) => ({
  repo: 'mini',
  parts: [{ id: 'core', title: 'Core', layers: [1, 2, 3, 4] }],
  views: {},
  folders: [{ path: 'src/', layer: 2, part: 'core' }],
  patterns,
});

// A code type in the shape that extract() gives.
const codeType = (name, kind = 'class') => ({
  id: name,
  name,
  kind,
  abstract: false,
  exported: true,
  file: `src/${name}.ts`,
  line: 1,
  typeParams: [],
  attrs: [],
  ops: [],
  values: [],
  alias: null,
});
const code = (types, edges) => ({ repo: 'mini', head: 'abc1234', types, edges });

// A view with two boxes in layer 2 and one line between them.
// The holder box sits on the left and the target box on the right.
// A diamond line has its marker at the holder. A use line has its arrowhead at the target.
// The texts sit just above the line, so they label it.
function view(name, from, to, kind, texts = []) {
  const box = (n, x) => `<!-- Class: ${n} -->\n<rect x="${x}" y="100" width="120" height="60" fill="#ffffff"/>\n<text x="${x + 60}" y="118" font-weight="600">${n}</text>`;
  const marker = kind === 'use' ? 'marker-end="url(#m-open)"' : `marker-start="url(#m-${kind === 'aggregation' ? 'diamond-hollow' : 'diamond-filled'})"`;
  const labels = texts.map((t, i) => `<text x="${200 + i * 50}" y="126">${t}</text>`).join('\n');
  const html = [
    '<svg><defs></defs>',
    '<!-- Layer zone 2 -->',
    '<rect x="-20" y="80" width="480" height="100" fill="#efe7f8"/>',
    box(from, 0),
    box(to, 300),
    `<!-- ${from} to ${to} -->`,
    `<line x1="120" y1="130" x2="300" y2="130" stroke="#333333" ${marker}/>`,
    labels,
    '</svg>',
  ].join('\n');
  const dir = tmp('views');
  mkdirSync(dir);
  const file = path.join(dir, `${name}.html`);
  writeFileSync(file, html);
  return parseView(file);
}

const edgesOf = (model, from, to) => model.edges.filter((e) => e.from === from && e.to === to);
const pick = ({ kind, label, pattern, status }) => ({ kind, label, pattern, status });

test('S3: a hollow diamond between a decorator and the interface that it implements gives the label decorate and the multiplicity', () => {
  // LoggingAspect holds the interface in the code. AuditAspect and RetryAspect hold it only in a view.
  // The view of AuditAspect prints the multiplicity in the label text, and the view of RetryAspect prints it alone.
  const c = code(
    [codeType('UseCase', 'interface'), codeType('LoggingAspect'), codeType('AuditAspect'), codeType('RetryAspect')],
    [
      { from: 'LoggingAspect', to: 'UseCase', kind: 'implements', label: null, viaAttr: false },
      { from: 'LoggingAspect', to: 'UseCase', kind: 'use', label: 'inner 1', viaAttr: true, multiplicity: '1' },
      { from: 'AuditAspect', to: 'UseCase', kind: 'implements', label: null, viaAttr: false },
      { from: 'RetryAspect', to: 'UseCase', kind: 'implements', label: null, viaAttr: false },
    ],
  );
  const views = [
    view('uc-1-contract', 'LoggingAspect', 'UseCase', 'aggregation', ['decorate', '1']),
    view('uc-2-audit', 'AuditAspect', 'UseCase', 'aggregation', ['wraps 1']),
    view('uc-3-retry', 'RetryAspect', 'UseCase', 'aggregation', ['wraps', '1']),
  ];
  const cfg = config({ 'LoggingAspect->UseCase': 'Decorator', 'AuditAspect->UseCase': 'Decorator', 'RetryAspect->UseCase': 'Decorator' });
  const { model } = merge(c, views, cfg);
  assert.deepEqual(edgesOf(model, 'LoggingAspect', 'UseCase').map(pick), [
    { kind: 'aggregation', label: 'decorate 1', pattern: 'Decorator', status: 'code' },
    { kind: 'implements', label: null, pattern: null, status: 'code' },
  ]);
  for (const from of ['AuditAspect', 'RetryAspect']) {
    assert.deepEqual(edgesOf(model, from, 'UseCase').map(pick), [
      { kind: 'aggregation', label: 'decorate 1', pattern: 'Decorator', status: 'planned' },
      { kind: 'implements', label: null, pattern: null, status: 'code' },
    ]);
  }
});

// extract() loads the TypeScript compiler from the node_modules of the repository, or from NODE_PATH.
const hasTypeScript = (() => {
  try {
    createRequire(path.join(scratch, 'package.json')).resolve('typescript');
    return true;
  } catch {
    return false;
  }
})();

test(
  'S3: an attribute typed by a type parameter with a constraint gives an attribute edge to the constraint',
  { skip: hasTypeScript ? false : 'TypeScript does not resolve; set NODE_PATH to a node_modules folder that holds it' },
  () => {
    const repo = tmp('repo');
    mkdirSync(path.join(repo, 'src'), { recursive: true });
    writeFileSync(path.join(repo, 'package.json'), '{ "name": "mini", "private": true }\n');
    writeFileSync(path.join(repo, 'tsconfig.json'), '{ "compilerOptions": { "strict": true, "target": "ES2022" }, "include": ["src"] }\n');
    writeFileSync(
      path.join(repo, 'src', 'scoring.ts'),
      [
        'export interface IScoringPolicy {',
        '  score(n: number): number;',
        '}',
        'export class ScoringDecorator<TInner extends IScoringPolicy> implements IScoringPolicy {',
        '  constructor(private readonly inner: TInner) {}',
        '  score(n: number): number {',
        '    return this.inner.score(n) + 1;',
        '  }',
        '}',
        'export class Holder<T> {',
        '  constructor(private readonly item: T) {}',
        '}',
        '',
      ].join('\n'),
    );
    const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { stdio: 'ignore' });
    git('init', '-q');
    git('remote', 'add', 'origin', 'https://example.invalid/mini.git');
    git('add', '.');
    git('commit', '-q', '-m', 'mini');

    const c = extract(repo);
    const uses = c.edges.filter((e) => e.kind === 'use').map(({ from, to, label, viaAttr, multiplicity }) => ({ from, to, label, viaAttr, multiplicity }));
    assert.deepEqual(uses, [{ from: 'ScoringDecorator', to: 'IScoringPolicy', label: 'inner 1', viaAttr: true, multiplicity: '1' }]);
    assert.equal(c.edges.filter((e) => e.from === 'Holder').length, 0);

    // The diamond of the view now joins a pair that the code holds.
    const views = [view('engine-4-sources', 'ScoringDecorator', 'IScoringPolicy', 'aggregation', ['decorate', '1'])];
    const { model } = merge(c, views, config({ 'ScoringDecorator->IScoringPolicy': 'Decorator' }));
    assert.deepEqual(edgesOf(model, 'ScoringDecorator', 'IScoringPolicy').map(pick), [
      { kind: 'aggregation', label: 'decorate 1', pattern: 'Decorator', status: 'code' },
      { kind: 'implements', label: null, pattern: null, status: 'code' },
    ]);
  },
);

test('previous behavior: a use line of a view next to implements on the same pair leaves no use edge', () => {
  const c = code(
    [codeType('Repo', 'interface'), codeType('Store')],
    [
      { from: 'Store', to: 'Repo', kind: 'implements', label: null, viaAttr: false },
      { from: 'Store', to: 'Repo', kind: 'use', label: 'inner 1', viaAttr: true, multiplicity: '1' },
    ],
  );
  const views = [view('store', 'Store', 'Repo', 'use', ['save()'])];
  const { model, notes } = merge(c, views, config({ 'Store->Repo': 'Decorator' }));
  assert.deepEqual(edgesOf(model, 'Store', 'Repo').map(pick), [{ kind: 'implements', label: null, pattern: null, status: 'code' }]);
  assert.deepEqual(notes.heritageUses, ['Store -> Repo: implements hides the code use "inner 1"']);
});

test('previous behavior: a diamond line with no entry in patterns stays a use and writes its note', () => {
  const c = code([codeType('Cache'), codeType('Clock')], [{ from: 'Cache', to: 'Clock', kind: 'use', label: 'clock 1', viaAttr: true, multiplicity: '1' }]);
  const views = [view('cache', 'Cache', 'Clock', 'aggregation', ['decorate', '1'])];
  const { model, notes } = merge(c, views, config());
  assert.deepEqual(edgesOf(model, 'Cache', 'Clock').map(pick), [{ kind: 'use', label: 'clock 1', pattern: null, status: 'code' }]);
  assert.deepEqual(notes.diamonds, ['Cache -> Clock (aggregation, cache): the config names no pattern; the line stays a use']);
});

test('previous behavior: an aggregation of another pattern and a composition keep the label of the code', () => {
  const c = code(
    [codeType('Engine'), codeType('Rules', 'interface'), codeType('Phase')],
    [
      { from: 'Engine', to: 'Phase', kind: 'use', label: 'phase 1', viaAttr: true, multiplicity: '1' },
      { from: 'Engine', to: 'Rules', kind: 'use', label: 'rules 1', viaAttr: true, multiplicity: '1' },
    ],
  );
  const views = [view('engine-rules', 'Engine', 'Rules', 'aggregation', ['rules', '1']), view('engine-phase', 'Engine', 'Phase', 'composition', ['phase', '1'])];
  const { model } = merge(c, views, config({ 'Engine->Rules': 'Strategy', 'Engine->Phase': 'Decorator' }));
  assert.deepEqual(model.edges.map(pick), [
    { kind: 'composition', label: 'phase 1', pattern: 'Decorator', status: 'code' },
    { kind: 'aggregation', label: 'rules 1', pattern: 'Strategy', status: 'code' },
  ]);
});
