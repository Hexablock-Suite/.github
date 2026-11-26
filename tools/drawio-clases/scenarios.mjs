#!/usr/bin/env node
// Check the extensibility scenarios of one HexaBlock repository against its class model.
//
// Usage: node scenarios.mjs <scenarios.json> <model.json> <repo-root> <out-dir>
//
// The scenario file has the shape of MODEL.md, «Scenario file».
// The script reads the config <repo-root>/docs/architecture/classes.config.json, as merge.mjs does.
// It prints one line for each violation and exits 1 when it finds one. Then it writes no file.
// With no violation it writes <out-dir>/<repo>.scenarios.json: the scenarios, and the layer and the part of each added box.
// <repo> is the repo of the model, as in the name <repo>.model.json that merge.mjs writes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeFile, readConfig } from './merge.mjs';

const USAGE = 'usage: node scenarios.mjs <scenarios.json> <model.json> <repo-root> <out-dir>';

// The kinds of a type in MODEL.md, «Type».
const KINDS = new Set(['class', 'interface', 'union', 'type', 'enum', 'const']);
const ID = /^[a-z0-9-]+$/;
const HERITAGE = ['implements', 'extends'];
const isText = (v) => typeof v === 'string' && v !== '';
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A file of edits exists when it is a file inside the repository root.
function existsIn(root, file) {
  const base = path.resolve(root);
  const rel = path.relative(base, path.resolve(base, file));
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return false;
  return fs.statSync(path.join(base, rel), { throwIfNoEntry: false })?.isFile() ?? false;
}

// Return the violations of a scenario file, one text for each.
// The shape checks come from the field table of MODEL.md, «Scenario file». The other checks come from README.md, «Scenarios».
export function checkScenarios(file, model, cfg, repoRoot) {
  const out = [];
  if (cfg.repo !== model.repo) out.push(`classes.config.json is for "${cfg.repo}", the model is for "${model.repo}"`);
  if (!isObject(file) || !Array.isArray(file.scenarios)) {
    out.push('the file has no list "scenarios"');
    return out;
  }
  const typeIds = new Set(model.types.map((t) => t.id));
  const typeNames = new Set(model.types.map((t) => t.name));
  const typeById = new Map(model.types.map((t) => [t.id, t]));
  const seenIds = new Set();
  file.scenarios.forEach((s, i) => {
    const say = (text) => out.push(`scenario ${isText(s?.id) ? s.id : `#${i + 1}`}: ${text}`);
    if (!isObject(s)) {
      say('is not an object');
      return;
    }

    // The shape of the scenario.
    if (typeof s.id !== 'string' || !ID.test(s.id)) say('the id is not lowercase letters, digits and "-"');
    else if (seenIds.has(s.id)) say('the id is not unique in the file');
    seenIds.add(s.id);
    for (const field of ['title', 'source']) if (!isText(s[field])) say(`${field} is not a text`);
    for (const field of ['extensionPoints', 'adds', 'edits', 'unchanged']) if (!Array.isArray(s[field])) say(`${field} is not a list`);
    const listOf = (field) => (Array.isArray(s[field]) ? s[field] : []);
    for (const field of ['extensionPoints', 'unchanged']) {
      listOf(field).forEach((x, j) => isText(x) || say(`${field}[${j}] is not a text`));
    }
    listOf('adds').forEach((a, j) => {
      if (!isObject(a)) return say(`adds[${j}] is not an object`);
      if (!isText(a.name)) say(`adds[${j}].name is not a text`);
      if (!KINDS.has(a.kind)) say(`adds[${j}].kind "${a.kind}" is not a kind of MODEL.md`);
      if (!Array.isArray(a.stereotypes) || !a.stereotypes.every(isText)) say(`adds[${j}].stereotypes is not a list of texts`);
      if (!isText(a.file)) say(`adds[${j}].file is not a text`);
      for (const h of HERITAGE) if (h in a && !isText(a[h])) say(`adds[${j}].${h} is not a text`);
    });
    listOf('edits').forEach((e, j) => {
      if (!isObject(e)) return say(`edits[${j}] is not an object`);
      for (const field of ['file', 'change']) if (!isText(e[field])) say(`edits[${j}].${field} is not a text`);
    });

    // Rule 1: a scenario finds the existing code by type id.
    const points = listOf('extensionPoints').filter(isText);
    const unchanged = listOf('unchanged').filter(isText);
    for (const x of points) if (!typeIds.has(x)) say(`extensionPoints names "${x}", which is not a type id of the model`);
    for (const x of unchanged) if (!typeIds.has(x)) say(`unchanged names "${x}", which is not a type id of the model`);

    // An added box is new, and a folder of the config holds its file (rule 2).
    for (const a of listOf('adds')) {
      if (!isObject(a) || !isText(a.name)) continue;
      for (const h of HERITAGE) {
        if (isText(a[h]) && !typeIds.has(a[h])) say(`added box ${a.name} ${h} "${a[h]}", which is not a type id of the model`);
      }
      if (typeNames.has(a.name)) say(`added box ${a.name} has the name of a type of the model`);
      if (isText(a.file) && !placeFile(cfg.folders, a.file)) say(`added box ${a.name} has the file "${a.file}", which no folder of classes.config.json holds`);
    }

    // An edited file exists in the repository.
    const edited = new Set();
    for (const e of listOf('edits')) {
      if (!isObject(e) || !isText(e.file)) continue;
      edited.add(path.posix.normalize(e.file));
      if (!existsIn(repoRoot, e.file)) say(`edits the file "${e.file}", which does not exist in the repository`);
    }

    // An unchanged type is no extension point and sits in no edited file.
    for (const x of unchanged) {
      if (points.includes(x)) say(`unchanged type ${x} is also an extension point`);
      const t = typeById.get(x);
      if (t?.file && edited.has(t.file)) say(`unchanged type ${x} sits in "${t.file}", a file of edits`);
    }
  });
  return out;
}

// Return the scenarios with the layer and the part of each added box, from the folders of the config.
export function placeScenarios(file, cfg) {
  return file.scenarios.map((s) => ({
    ...s,
    adds: s.adds.map((a) => {
      const { layer, part } = placeFile(cfg.folders, a.file);
      return { ...a, layer, part };
    }),
  }));
}

function main(argv) {
  if (argv.length !== 4) {
    console.error(USAGE);
    return 2;
  }
  const [scenariosPath, modelPath, repoRoot, outDir] = argv;
  let file, model, cfg;
  try {
    file = JSON.parse(fs.readFileSync(scenariosPath, 'utf8'));
    model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
    ({ cfg } = readConfig(repoRoot));
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 1;
  }
  if (!Array.isArray(model?.types) || !Array.isArray(cfg?.folders)) {
    console.error('error: the model has no list "types", or the config has no list "folders"');
    return 1;
  }
  const violations = checkScenarios(file, model, cfg, repoRoot);
  for (const v of violations) console.log(v);
  if (violations.length) {
    console.log(`${scenariosPath}: ${violations.length} violation(s)`);
    return 1;
  }
  const scenarios = placeScenarios(file, cfg);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${model.repo}.scenarios.json`);
  fs.writeFileSync(outPath, JSON.stringify({ scenarios }, null, 2) + '\n');
  const added = scenarios.reduce((n, s) => n + s.adds.length, 0);
  console.log(`${outPath}: ${scenarios.length} scenario(s), ${added} added box(es), 0 violation(s)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) process.exitCode = main(process.argv.slice(2));
