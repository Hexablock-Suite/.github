// These tests call merge() and extract() of the generator on small inputs.
// Each test keeps its files in a fresh system temp directory.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from '../extract.mjs';
import { merge } from '../merge.mjs';
import { parseView } from '../views.mjs';

const MERGE = fileURLToPath(new URL('../merge.mjs', import.meta.url));
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

// The zone fill of each Clean layer, as views.mjs reads it.
const ZONE_FILL = { 1: '#f9f4dc', 2: '#efe7f8', 3: '#e2ebf8', 4: '#cfdcf3' };

// A view with two boxes in one layer zone and one line between them. The zone is layer 2 unless layer names another one.
// The holder box sits on the left and the target box on the right.
// A diamond line has its marker at the holder. A use line has its arrowhead at the target.
// The texts sit just above the line, so they label it.
function viewHtml(from, to, kind, texts = [], layer = 2) {
  const box = (n, x) => `<!-- Class: ${n} -->\n<rect x="${x}" y="100" width="120" height="60" fill="#ffffff"/>\n<text x="${x + 60}" y="118" font-weight="600">${n}</text>`;
  const marker = kind === 'use' ? 'marker-end="url(#m-open)"' : `marker-start="url(#m-${kind === 'aggregation' ? 'diamond-hollow' : 'diamond-filled'})"`;
  const labels = texts.map((t, i) => `<text x="${200 + i * 50}" y="126">${t}</text>`).join('\n');
  return [
    '<svg><defs></defs>',
    `<!-- Layer zone ${layer} -->`,
    `<rect x="-20" y="80" width="480" height="100" fill="${ZONE_FILL[layer]}"/>`,
    box(from, 0),
    box(to, 300),
    `<!-- ${from} to ${to} -->`,
    `<line x1="120" y1="130" x2="300" y2="130" stroke="#333333" ${marker}/>`,
    labels,
    '</svg>',
  ].join('\n');
}
function view(name, from, to, kind, texts = [], layer = 2) {
  const dir = tmp('views');
  mkdirSync(dir);
  const file = path.join(dir, `${name}.html`);
  writeFileSync(file, viewHtml(from, to, kind, texts, layer));
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

const stereotypesOf = (model, id) => model.types.find((t) => t.id === id).stereotypes;

test('S5c: a code interface with no operation keeps «interface» alone, with no «dataType»', () => {
  const { model, notes } = merge(code([codeType('MoveRequest', 'interface')], []), [], config());
  assert.deepEqual(stereotypesOf(model, 'MoveRequest'), ['interface']);
  assert.deepEqual(notes.noOps, []);
});

test('S5c: a union of literals gets the stereotype «enumeration»', () => {
  const union = { ...codeType('LevelProblem', 'union'), values: ["'too-many'", "'unknown'"] };
  const { model } = merge(code([union], []), [], config());
  assert.deepEqual(stereotypesOf(model, 'LevelProblem'), ['enumeration']);
});

test('previous behavior: a code class with no operation still gets «dataType»', () => {
  const { model, notes } = merge(code([codeType('MoveDto')], []), [], config());
  assert.deepEqual(stereotypesOf(model, 'MoveDto'), ['dataType']);
  assert.deepEqual(notes.noOps.map(({ type, mark }) => [type.id, mark]), [['MoveDto', 'dataType']]);
});

// The options of a test that calls extract(). It skips when TypeScript does not resolve.
const needsTypeScript = { skip: hasTypeScript ? false : 'TypeScript does not resolve; set NODE_PATH to a node_modules folder that holds it' };

// Write a small repository with these files and commit it, so extract() reads it at HEAD.
// The keys are repository-relative paths. The tsconfig reads src/ and app/ and keeps JSX as it is.
function miniRepo(files) {
  const repo = tmp('repo');
  mkdirSync(repo, { recursive: true });
  writeFileSync(path.join(repo, 'package.json'), '{ "name": "mini", "private": true }\n');
  writeFileSync(
    path.join(repo, 'tsconfig.json'),
    '{ "compilerOptions": { "strict": true, "target": "ES2022", "jsx": "preserve" }, "include": ["src", "app"] }\n',
  );
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), text);
  }
  const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('remote', 'add', 'origin', 'https://example.invalid/mini.git');
  git('add', '.');
  git('commit', '-q', '-m', 'mini');
  return repo;
}

const usesFrom = (c, from) =>
  c.edges.filter((e) => e.from === from && e.kind === 'use').map(({ to, label, viaAttr, multiplicity }) => ({ to, label, viaAttr, multiplicity }));

test('A1: a use inside a module function or an arrow const of the same file counts for the member that calls it', needsTypeScript, () => {
  const repo = miniRepo({
    'src/domain/level-status.ts': 'export class LevelStatus {\n  static ofEach(n: number): number[] {\n    return [n];\n  }\n}\n',
    'src/domain/tally.ts': 'export class Tally {\n  constructor(readonly n: number) {}\n}\n',
    'src/domain/achievement-goal.ts': [
      "import { LevelStatus } from './level-status';",
      "import { Tally } from './tally';",
      '',
      '// The recursive call checks that the walk stops.',
      'function wonCountOf(n: number): number {',
      '  if (n > 9) return wonCountOf(n - 1);',
      '  return LevelStatus.ofEach(n).length;',
      '}',
      'const tallyOf = (n: number) => new Tally(n);',
      '',
      'export class LevelsWon {',
      '  isReachedBy(n: number): boolean {',
      '    return wonCountOf(n) > 0;',
      '  }',
      '  count(n: number): number {',
      '    return tallyOf(n).n;',
      '  }',
      '}',
      '',
    ].join('\n'),
  });
  const c = extract(repo);
  assert.deepEqual(usesFrom(c, 'LevelsWon'), [
    { to: 'LevelStatus', label: 'isReachedBy()', viaAttr: false, multiplicity: null },
    { to: 'Tally', label: '«create»', viaAttr: false, multiplicity: null },
  ]);
  assert.deepEqual(c.types.map((t) => t.id).sort(), ['LevelStatus', 'LevelsWon', 'Tally']);
});

test('previous behavior: a function of another file stays unread, through a named import or a namespace import', needsTypeScript, () => {
  const repo = miniRepo({
    'src/domain/hidden.ts': 'export class Hidden {\n  static of(n: number): number {\n    return n;\n  }\n}\n',
    'src/domain/helpers.ts': "import { Hidden } from './hidden';\n\nexport function helperOf(n: number): number {\n  return Hidden.of(n);\n}\n",
    'src/domain/caller.ts': [
      "import { helperOf } from './helpers';",
      "import * as helpers from './helpers';",
      '',
      'export class Caller {',
      '  run(n: number): number {',
      '    return helperOf(n);',
      '  }',
      '  runAll(n: number): number {',
      '    return helpers.helperOf(n);',
      '  }',
      '}',
      '',
    ].join('\n'),
  });
  const c = extract(repo);
  assert.deepEqual(c.edges.filter((e) => e.from === 'Caller'), []);
});

// The files of a directory, by repository-relative path.
const filesOf = (dir, base = dir) =>
  Object.fromEntries(
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? Object.entries(filesOf(full, base)) : [[path.relative(base, full).split(path.sep).join('/'), readFileSync(full, 'utf8')]];
    }),
  );
const MINI_REPO = fileURLToPath(new URL('../fixtures/mini-repo', import.meta.url));

test('#196: a helper of another file that gives a receiver object uses its receiver interface for the caller', needsTypeScript, () => {
  const c = extract(miniRepo(filesOf(MINI_REPO)));
  // The member of a const object reaches both receivers through receiveProgressOf() and receiveKeyOf().
  // Stamp and the parameter types of the helpers give no use.
  assert.deepEqual(usesFrom(c, 'ProgressRowMapper'), [
    { to: 'KeyReceiver', label: 'toRow()', viaAttr: false, multiplicity: null },
    { to: 'Progress', label: 'toRow()', viaAttr: false, multiplicity: null },
    { to: 'ProgressReceiver', label: 'toRow()', viaAttr: false, multiplicity: null },
  ]);
  // find() reaches the helper through readRow() of its own file. scoreOf() gives its own receiver object.
  assert.deepEqual(usesFrom(c, 'ProgressStore'), [
    { to: 'KeyReceiver', label: 'find(), lock()', viaAttr: false, multiplicity: null },
    { to: 'Progress', label: 'scoreOf()', viaAttr: false, multiplicity: null },
    { to: 'ProgressKey', label: 'find(), lock()', viaAttr: false, multiplicity: null },
    { to: 'ProgressReceiver', label: 'scoreOf()', viaAttr: false, multiplicity: null },
  ]);
});

// The files copy the credential limits of hexablock-api (#224 there): a Range of CharacterCount in a top-level const.
const rangeFiles = {
  'src/domain/shared/ordered.ts': 'export interface Ordered<T> {\n  isAfter(other: T): boolean;\n}\n',
  'src/domain/shared/range.ts': [
    "import type { Ordered } from './ordered';",
    '',
    'export class Range<T extends Ordered<T>> {',
    '  private constructor(private readonly min: T, private readonly max: T) {}',
    '  static of<T extends Ordered<T>>(min: T, max: T): Range<T> {',
    '    return new Range(min, max);',
    '  }',
    '  contains(value: T): boolean {',
    '    return !this.min.isAfter(value) && !value.isAfter(this.max);',
    '  }',
    '  isExceededBy(value: T): boolean {',
    '    return value.isAfter(this.max);',
    '  }',
    '}',
    '',
  ].join('\n'),
  'src/domain/user/character-count.ts': [
    "import type { Ordered } from '../shared/ordered';",
    '',
    'export class CharacterCount implements Ordered<CharacterCount> {',
    '  private constructor(private readonly n: number) {}',
    '  static ofText(text: string): CharacterCount {',
    '    return new CharacterCount([...text].length);',
    '  }',
    '  isAfter(other: CharacterCount): boolean {',
    '    return this.n > other.n;',
    '  }',
    '}',
    '',
  ].join('\n'),
};

test('#224: a value use of a top-level const, of the same file or imported, uses the model types of its value', needsTypeScript, () => {
  const repo = miniRepo({
    ...rangeFiles,
    'src/domain/user/password.ts': [
      "import { Range } from '../shared/range';",
      "import { CharacterCount } from './character-count';",
      '',
      "export const PASSWORD_LENGTH = Range.of(CharacterCount.ofText('12345678'), CharacterCount.ofText('x'.repeat(128)));",
      '',
      'export class Password {',
      '  private constructor(private readonly text: string) {}',
      '  static create(raw: string): Password | null {',
      '    return PASSWORD_LENGTH.contains(CharacterCount.ofText(raw)) ? new Password(raw) : null;',
      '  }',
      '}',
      '',
    ].join('\n'),
    'src/domain/user/password-attempt.ts': [
      "import { CharacterCount } from './character-count';",
      "import { PASSWORD_LENGTH } from './password';",
      "import * as limits from './password';",
      '',
      'export class PasswordAttempt {',
      '  constructor(private readonly typed: string) {}',
      '  isLongerThanAnyPassword(): boolean {',
      '    return PASSWORD_LENGTH.isExceededBy(CharacterCount.ofText(this.typed));',
      '  }',
      '  fits(): boolean {',
      '    return limits.PASSWORD_LENGTH.contains(CharacterCount.ofText(this.typed));',
      '  }',
      '}',
      '',
    ].join('\n'),
  });
  const c = extract(repo);
  // The Range line comes from the const. The CharacterCount line was there before.
  assert.deepEqual(usesFrom(c, 'Password'), [
    { to: 'CharacterCount', label: 'create()', viaAttr: false, multiplicity: null },
    { to: 'Range', label: 'create()', viaAttr: false, multiplicity: null },
  ]);
  assert.deepEqual(usesFrom(c, 'PasswordAttempt'), [
    { to: 'CharacterCount', label: 'isLongerThanAnyPassword(), fits()', viaAttr: false, multiplicity: null },
    { to: 'Range', label: 'isLongerThanAnyPassword(), fits()', viaAttr: false, multiplicity: null },
  ]);
  // A const that holds no object literal stays no model type.
  assert.deepEqual(c.types.map((t) => t.id).sort(), ['CharacterCount', 'Ordered', 'Password', 'PasswordAttempt', 'Range']);
});

test('previous behavior: an imported const that holds a function stays unread, and a typeof query of a const draws no line', needsTypeScript, () => {
  const repo = miniRepo({
    ...rangeFiles,
    'src/domain/user/limits.ts': [
      "import { Range } from '../shared/range';",
      "import { CharacterCount } from './character-count';",
      '',
      "export const lengthOf = (text: string) => Range.of(CharacterCount.ofText(text), CharacterCount.ofText(text));",
      "export const NAME_LENGTH = Range.of(CharacterCount.ofText('abc'), CharacterCount.ofText('abcdef'));",
      '',
    ].join('\n'),
    'src/domain/user/checker.ts': [
      "import { lengthOf, NAME_LENGTH } from './limits';",
      '',
      'export class Checker {',
      '  run(text: string): boolean {',
      '    return lengthOf(text) !== null;',
      '  }',
      '  same(other: typeof NAME_LENGTH): boolean {',
      '    return other !== null;',
      '  }',
      '}',
      '',
    ].join('\n'),
  });
  const c = extract(repo);
  assert.deepEqual(c.edges.filter((e) => e.from === 'Checker'), []);
});

test('A2: an exported function component of a .tsx file of src/ is a code type of kind component, with its props as attributes', needsTypeScript, () => {
  const repo = miniRepo({
    'src/infrastructure/board-layout.ts': 'export interface BoardLayout {\n  cellSize(): number;\n}\n',
    'src/infrastructure/cell-shape.ts': 'export class CellShape {\n  static of(n: number): string {\n    return String(n);\n  }\n}\n',
    'src/infrastructure/count.ts': 'export class Count {\n  constructor(readonly value: number) {}\n}\n',
    'src/infrastructure/plain.ts': 'export function Plain(): number {\n  return 1;\n}\n',
    'src/infrastructure/board-view.tsx': [
      "import type { BoardLayout } from './board-layout';",
      "import { CellShape } from './cell-shape';",
      "import type { Count } from './count';",
      '',
      'export interface BoardViewProps {',
      '  readonly layout: BoardLayout;',
      '  readonly label: string;',
      '  readonly onPress?: () => void;',
      '}',
      '',
      '// A component of the same file that is not exported: its JSX tag is a call.',
      'function Cell({ size }: { readonly size: number }) {',
      '  return <i>{CellShape.of(size)}</i>;',
      '}',
      '',
      'export function BoardView({ layout, label }: BoardViewProps) {',
      '  return <b title={label}><Cell size={layout.cellSize()} /></b>;',
      '}',
      '',
      'export const Badge = ({ count }: { readonly count: Count }) => <i>{count.value}</i>;',
      '',
      'export function useBoard(): number {',
      '  return 1;',
      '}',
      '',
    ].join('\n'),
  });
  const c = extract(repo);
  const components = c.types.filter((t) => t.kind === 'component');
  assert.deepEqual(
    components.map(({ id, file, line, attrs, ops }) => ({ id, file, line, attrs, ops })),
    [
      {
        id: 'BoardView',
        file: 'src/infrastructure/board-view.tsx',
        line: 16,
        attrs: [
          { vis: '+', name: 'layout', type: 'BoardLayout', static: false, readonly: true, optional: false },
          { vis: '+', name: 'label', type: 'string', static: false, readonly: true, optional: false },
          { vis: '+', name: 'onPress', type: '() => void', static: false, readonly: true, optional: true },
        ],
        ops: [],
      },
      {
        id: 'Badge',
        file: 'src/infrastructure/board-view.tsx',
        line: 20,
        attrs: [{ vis: '+', name: 'count', type: 'Count', static: false, readonly: true, optional: false }],
        ops: [],
      },
    ],
  );
  assert.equal(c.types.some((t) => ['Cell', 'useBoard', 'Plain'].includes(t.id)), false);
  assert.deepEqual(usesFrom(c, 'BoardView'), [
    { to: 'BoardLayout', label: 'layout 1', viaAttr: true, multiplicity: '1' },
    { to: 'BoardViewProps', label: null, viaAttr: false, multiplicity: null },
    { to: 'CellShape', label: null, viaAttr: false, multiplicity: null },
  ]);
  assert.deepEqual(usesFrom(c, 'Badge'), [{ to: 'Count', label: 'count 1', viaAttr: true, multiplicity: '1' }]);

  // A view that draws the component makes it a code type with «component». A component that no view draws stays out.
  const views = [view('ad-1-board', 'BoardView', 'BoardLayout', 'use', ['layout 1'])];
  const { model } = merge(c, views, config());
  const board = model.types.find((t) => t.id === 'BoardView');
  assert.deepEqual([board.kind, board.status, board.stereotypes], ['component', 'code', ['component']]);
  assert.deepEqual(edgesOf(model, 'BoardView', 'BoardLayout').map(pick), [{ kind: 'use', label: 'layout 1', pattern: null, status: 'code' }]);
  assert.equal(model.types.some((t) => t.id === 'Badge'), false);
});

// Two routes of app/ and one component of src/ for the route tests.
const routeFiles = {
  'src/adapters/game-presenter.ts': 'export class GamePresenter {\n  static create(): GamePresenter {\n    return new GamePresenter();\n  }\n}\n',
  'src/infrastructure/board-view.tsx': 'export function BoardView({ label }: { readonly label: string }) {\n  return <b>{label}</b>;\n}\n',
  'app/game/[gameId].tsx': [
    "import { GamePresenter } from '../../src/adapters/game-presenter';",
    "import { BoardView } from '../../src/infrastructure/board-view';",
    '',
    'export default function GameScreen() {',
    '  return <Game />;',
    '}',
    '',
    'function Game() {',
    '  const presenter = GamePresenter.create();',
    '  return <BoardView label={String(presenter)} />;',
    '}',
    '',
    'export function generateStaticParams(): { gameId: string }[] {',
    '  return [];',
    '}',
    '',
  ].join('\n'),
  'app/index.tsx': 'function HomeScreen() {\n  return <b />;\n}\n\nexport default HomeScreen;\n',
};

test('A2: the default export of each route of app/ is a code type of kind component', needsTypeScript, () => {
  const repo = miniRepo(routeFiles);
  const c = extract(repo);
  assert.deepEqual(
    c.types.filter((t) => t.kind === 'component').map(({ id, file, line }) => ({ id, file, line })),
    [
      { id: 'GameScreen', file: 'app/game/[gameId].tsx', line: 4 },
      { id: 'HomeScreen', file: 'app/index.tsx', line: 1 },
      { id: 'BoardView', file: 'src/infrastructure/board-view.tsx', line: 1 },
    ],
  );
  assert.equal(c.types.some((t) => t.id === 'generateStaticParams'), false);
  // The JSX tag of Game, a component of the same file, brings the uses of Game to GameScreen.
  assert.deepEqual(usesFrom(c, 'GameScreen'), [
    { to: 'BoardView', label: null, viaAttr: false, multiplicity: null },
    { to: 'GamePresenter', label: null, viaAttr: false, multiplicity: null },
  ]);

  const cfg = config();
  cfg.folders.push({ path: 'app/', layer: 4, part: 'core' });
  const { model } = merge(c, [view('ad-1-game', 'GameScreen', 'GamePresenter', 'use', ['presenter'])], cfg);
  const screen = model.types.find((t) => t.id === 'GameScreen');
  assert.deepEqual([screen.kind, screen.status, screen.layer, screen.file], ['component', 'code', 4, 'app/game/[gameId].tsx']);
  assert.deepEqual(edgesOf(model, 'GameScreen', 'GamePresenter').map(pick), [{ kind: 'use', label: null, pattern: null, status: 'code' }]);

  // The model comes from HEAD, so an uncommitted change in app/ stops extract().
  writeFileSync(path.join(repo, 'app', 'index.tsx'), 'export default function HomeScreen() {\n  return null;\n}\n');
  assert.throws(() => extract(repo), /\/app has uncommitted changes; the model must come from HEAD/);
});

test('A2: each exported or drawn declaration of app/ with no folder in the config prints one warning line, its view box stays a planned type, and the run does not fail', needsTypeScript, () => {
  // GameScreen and RouteParams have a view box. HomeScreen has none, but a route is exported.
  // STONE is a private object of a route file that no view draws, so it gives no warning.
  const repo = miniRepo({
    ...routeFiles,
    'app/route-params.ts': [
      "import { GamePresenter } from '../src/adapters/game-presenter';",
      '',
      'const STONE = { size: 1 };',
      '',
      'export class RouteParams {',
      '  presenter(): GamePresenter {',
      '    return GamePresenter.create() + STONE.size;',
      '  }',
      '}',
      '',
    ].join('\n'),
    'docs/architecture/classes.config.json': JSON.stringify(config()) + '\n',
    'docs/architecture/classes/views/ad-1-game.html': viewHtml('GameScreen', 'GamePresenter', 'use', ['presenter']),
    'docs/architecture/classes/views/ad-2-params.html': viewHtml('RouteParams', 'GamePresenter', 'use', ['asks']),
  });
  const out = tmp('out');
  const run = spawnSync(process.execPath, [MERGE, repo, out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const warnings = run.stderr.split('\n').filter((l) => l.startsWith('warning:'));
  const tail = 'no folder of the config holds this declaration of app/; a view box of its name stays planned';
  assert.deepEqual(warnings, [
    `warning: GameScreen (app/game/[gameId].tsx): ${tail}`,
    `warning: HomeScreen (app/index.tsx): ${tail}`,
    `warning: RouteParams (app/route-params.ts): ${tail}`,
  ]);
  // The model keeps each view box as a planned type with its view line, as before app/ was read.
  const model = JSON.parse(readFileSync(path.join(out, 'mini.model.json'), 'utf8'));
  const shape = (name) => model.types.filter((t) => t.name === name).map(({ kind, status, file }) => ({ kind, status, file }));
  assert.deepEqual(shape('GameScreen'), [{ kind: 'class', status: 'planned', file: null }]);
  assert.deepEqual(shape('RouteParams'), [{ kind: 'class', status: 'planned', file: null }]);
  assert.deepEqual(shape('HomeScreen'), []);
  assert.deepEqual(edgesOf(model, 'GameScreen', 'GamePresenter').map(pick), [{ kind: 'use', label: 'presenter', pattern: null, status: 'planned' }]);
  assert.deepEqual(edgesOf(model, 'RouteParams', 'GamePresenter').map(pick), [{ kind: 'use', label: 'asks', pattern: null, status: 'planned' }]);
  assert.match(run.stdout, / 0 violation\(s\)$/m);
});

test('A1: a typeof type query reads no function, and a shorthand property reads its function', needsTypeScript, () => {
  const repo = miniRepo({
    'src/domain/widget.ts': 'export class Widget {\n  static create(): number {\n    return 1;\n  }\n}\n',
    'src/domain/gadget.ts': 'export class Gadget {\n  static of(): number {\n    return 2;\n  }\n}\n',
    'src/domain/holder.ts': [
      "import { Gadget } from './gadget';",
      "import { Widget } from './widget';",
      '',
      'function makeThing() {',
      '  return Widget.create();',
      '}',
      'const helper = () => Gadget.of();',
      'function apply(o: { helper: () => number }): number {',
      '  return o.helper();',
      '}',
      '',
      'export class Holder {',
      '  readonly made: ReturnType<typeof makeThing> = 0;',
      '  run(): number {',
      '    return apply({ helper });',
      '  }',
      '}',
      '',
    ].join('\n'),
  });
  const c = extract(repo);
  assert.deepEqual(usesFrom(c, 'Holder'), [{ to: 'Gadget', label: 'run()', viaAttr: false, multiplicity: null }]);
});

test('A2: a prop in method syntax is an attribute, and the defaults of the props are uses', needsTypeScript, () => {
  const repo = miniRepo({
    'src/ui/coord.ts': 'export class Coord {\n  constructor(readonly q: number) {}\n}\n',
    'src/ui/size.ts': 'export class Size {\n  static small(): number {\n    return 1;\n  }\n}\n',
    'src/ui/glow.ts': 'export class Glow {\n  static base(): number {\n    return 2;\n  }\n}\n',
    'src/ui/tile.tsx': [
      "import type { Coord } from './coord';",
      "import { Glow } from './glow';",
      "import { Size } from './size';",
      '',
      'export function Tile({ size = Size.small() }: { readonly size?: number; onPick(at: Coord): void }) {',
      '  return <i>{size}</i>;',
      '}',
      '',
      'export function Halo(props: { readonly n: number } = { n: Glow.base() }) {',
      '  return <i>{props.n}</i>;',
      '}',
      '',
    ].join('\n'),
  });
  const c = extract(repo);
  assert.deepEqual(c.types.find((t) => t.id === 'Tile').attrs, [
    { vis: '+', name: 'size', type: 'number', static: false, readonly: true, optional: true },
    { vis: '+', name: 'onPick', type: '(at: Coord) => void', static: false, readonly: false, optional: false },
  ]);
  assert.deepEqual(usesFrom(c, 'Tile'), [
    { to: 'Coord', label: 'onPick 1', viaAttr: true, multiplicity: '1' },
    { to: 'Size', label: null, viaAttr: false, multiplicity: null },
  ]);
  assert.deepEqual(usesFrom(c, 'Halo'), [{ to: 'Glow', label: null, viaAttr: false, multiplicity: null }]);
});

test('A2: a component of src/ that export default or an export list exports is a component', needsTypeScript, () => {
  const repo = miniRepo({
    'src/ui/panel.tsx': [
      'function Panel() {',
      '  return <b />;',
      '}',
      'function Frame() {',
      '  return <i />;',
      '}',
      'function Hidden() {',
      '  return <s />;',
      '}',
      'export default Panel;',
      'export { Frame };',
      '',
    ].join('\n'),
  });
  const c = extract(repo);
  assert.deepEqual(c.types.filter((t) => t.kind === 'component').map((t) => t.id), ['Panel', 'Frame']);
});

// splitConfig has the two parts of the split of Hexablock-Suite/hexablock-app#394 and Hexablock-Suite/hexablock-api#198.
// The part adapters holds layer 3 and the part infrastructure holds layer 4.
// The views map keeps the prefix ad- and the view map-4-adapters on the part adapters, as both product configs do.
const splitConfig = () => ({
  repo: 'mini',
  parts: [
    { id: 'adapters', title: 'Adapters', layers: [3] },
    { id: 'infrastructure', title: 'Infrastructure', layers: [4] },
  ],
  views: { 'ad-': 'adapters', 'map-4-adapters': 'adapters' },
  folders: [
    { path: 'src/adapters/', layer: 3, part: 'adapters' },
    { path: 'src/infrastructure/', layer: 4, part: 'infrastructure' },
  ],
  patterns: {},
});

test('#6: a planned layer 4 type of a view mapped to a layer 3 part goes to the part of layer 4', () => {
  const repo = { ...codeType('HttpRepo'), file: 'src/adapters/http-repo.ts' };
  const views = [
    view('ad-1-storage', 'LocalStore', 'HttpRepo', 'use', ['save()'], 4),
    view('map-4-adapters', 'SystemClock', 'HttpRepo', 'use', ['now()'], 4),
    view('ad-2-http', 'HttpGateway', 'HttpRepo', 'use', ['send()'], 3),
  ];
  const { model } = merge(code([repo], []), views, splitConfig());
  const where = (id) => {
    const t = model.types.find((x) => x.id === id);
    return t && { layer: t.layer, part: t.part, status: t.status };
  };
  assert.deepEqual(where('LocalStore'), { layer: 4, part: 'infrastructure', status: 'planned' });
  assert.deepEqual(where('SystemClock'), { layer: 4, part: 'infrastructure', status: 'planned' });
  // A planned layer 3 type of a view of the same prefix keeps the part adapters.
  assert.deepEqual(where('HttpGateway'), { layer: 3, part: 'adapters', status: 'planned' });
  // A code type takes its part from its folder.
  assert.deepEqual(where('HttpRepo'), { layer: 3, part: 'adapters', status: 'code' });
});
