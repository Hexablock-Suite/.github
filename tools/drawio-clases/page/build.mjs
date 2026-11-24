#!/usr/bin/env node
// build.mjs builds the class diagram page from one or more class models.
// Usage: node build.mjs <model.json>... --out <dir> [--artifact]
// It writes a static site: the page, and one model file and one positions file per repository.
// The page loads the two data files of a repository with a relative fetch.
// --artifact writes the page as a fragment with no doctype, html, head or body tags, for a claude.ai artifact.
// The build needs no browser. The same models always give the same bytes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { layoutModel } from './layout.mjs';
import { BOX_TEXT } from './text.mjs';
import { VIEW_RULES } from './view.mjs';

const USAGE = 'usage: node build.mjs <model.json>... --out <dir> [--artifact]';
const SITE_PAGE = 'index.html';
const ARTIFACT_PAGE = 'diagrama-clases-hexablock.html';
// The switch label of a known repository key. Another key shows with a capital first letter.
const LABELS = { api: 'API', app: 'App' };

class InputError extends Error {}

const src = (name) => readFileSync(new URL(`src/${name}`, import.meta.url), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// parseArgs gives the model paths, the output directory and the form of the page.
function parseArgs(argv) {
  if (!argv.length) throw new InputError(USAGE);
  const models = [];
  let out = null;
  let artifact = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new InputError(`--out needs a directory (${USAGE})`);
      out = v;
      i++;
    } else if (a === '--artifact') artifact = true;
    else if (a.startsWith('--')) throw new InputError(`unknown option ${a} (${USAGE})`);
    else models.push(a);
  }
  if (!out) throw new InputError(`--out <dir> is missing (${USAGE})`);
  if (!models.length) throw new InputError(`give at least one model file (${USAGE})`);
  return { models, out, artifact };
}

const isList = (v) => Array.isArray(v);

// readModel reads one model file and checks the fields that the layout and the page use.
// It gives the model, its bytes and its repository key.
function readModel(file) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (e) {
    throw new InputError(`cannot read the model ${file}: ${e.code || e.message}`);
  }
  let model;
  try {
    model = JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    throw new InputError(`the model ${file} is not JSON: ${String(e.message).split('\n')[0]}`);
  }
  if (model === null || typeof model !== 'object' || Array.isArray(model)) throw new InputError(`the model ${file} is not a JSON object`);
  for (const f of ['repo', 'head']) {
    if (typeof model[f] !== 'string') throw new InputError(`the model ${file} has no ${f} string`);
  }
  for (const f of ['types', 'edges']) {
    if (!isList(model[f])) throw new InputError(`the model ${file} has no ${f} array`);
  }
  if (model.parts !== undefined && !isList(model.parts)) throw new InputError(`the model ${file} has a parts field that is not an array`);
  const ids = new Set();
  for (const t of model.types) {
    if (!t || typeof t.id !== 'string' || typeof t.name !== 'string') throw new InputError(`the model ${file} has a type with no id or name string`);
    if (ids.has(t.id)) throw new InputError(`the model ${file} has the type id ${t.id} twice`);
    ids.add(t.id);
    if (![1, 2, 3, 4].includes(t.layer)) throw new InputError(`the type ${t.id} of ${file} has no layer from 1 to 4`);
    for (const f of ['stereotypes', 'views', 'typeParams', 'attrs', 'ops']) {
      if (!isList(t[f])) throw new InputError(`the type ${t.id} of ${file} has no ${f} array`);
    }
  }
  for (const e of model.edges) {
    for (const end of ['from', 'to']) {
      if (!e || !ids.has(e[end])) throw new InputError(`the model ${file} has an edge ${end} ${e && e[end]}, which is not a type id`);
    }
  }
  const key = model.repo.replace(/^hexablock-/, '');
  if (!/^[a-z0-9]+$/.test(key)) {
    throw new InputError(`the repository name "${model.repo}" of ${file} gives no link key: use lowercase letters and digits, with an optional hexablock- prefix`);
  }
  return { model, bytes, key };
}

// pageHtml gives the page text. The full form is a document. The artifact form is its fragment.
export function pageHtml(repos, artifact) {
  const buttons = repos.map((r) => `        <button type="button" role="radio" aria-checked="false" data-r="${r.key}" data-file="${esc(r.repo)}">${esc(r.label)}</button>\n`).join('');
  const body = src('body.html').replace('<!-- repos -->\n', buttons);
  const headPart = src('head.html') + '<style>\n' + src('page.css') + '</style>\n';
  const bodyPart = '\n' + body + '\n<script>\n' + BOX_TEXT + '</script>\n\n<script>\n' + VIEW_RULES + '</script>\n\n<script>\n' + src('app.js') + '</script>\n';
  if (artifact) return headPart + bodyPart;
  return '<!doctype html>\n<html lang="en">\n<head>\n' + headPart + '</head>\n<body>\n' + bodyPart + '</body>\n</html>\n';
}

async function main(argv) {
  const { models, out, artifact } = parseArgs(argv);
  const repos = [];
  for (const file of models) {
    const { model, bytes, key } = readModel(file);
    if (repos.some((r) => r.key === key)) throw new InputError(`the repository ${model.repo} comes twice`);
    repos.push({ key, repo: model.repo, label: LABELS[key] || key[0].toUpperCase() + key.slice(1), model, bytes });
  }
  // The layout runs before the first write, so a failure leaves no partial site.
  const files = [];
  for (const r of repos) {
    const { positions, unrouted } = await layoutModel(r.model);
    if (unrouted) console.error(`warning: ${r.repo}: ${unrouted} lines found no route`);
    files.push([`${r.repo}.model.json`, r.bytes], [`${r.repo}.positions.json`, JSON.stringify(positions)]);
  }
  files.unshift([artifact ? ARTIFACT_PAGE : SITE_PAGE, pageHtml(repos, artifact)]);
  mkdirSync(out, { recursive: true });
  for (const [name, data] of files) writeFileSync(path.join(out, name), data);
  console.log(`${out}: ${files.map(([name]) => name).join(', ')}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    console.error(`error: ${e.message}`);
    process.exitCode = 1;
  }
}
