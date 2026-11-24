#!/usr/bin/env node
// Join the code and the class views of one HexaBlock repository into one class model.
//
// Usage: node merge.mjs <repo-root> <out-dir> [--config <config.json>]
//        node merge.mjs --check <model.json>
//
// The first form runs extract.mjs and views.mjs on <repo-root>.
// It writes <out-dir>/<repo>.model.json in the shape of MODEL.md.
// It also writes <out-dir>/planned-report-<repo>.md with the planned types, the planned members,
// the unresolved view lines and the view types without a layer.
// The default config is <repo-root>/docs/architecture/classes.config.json. It maps folders and views to layers and parts.
// The second form checks one model against the five invariants of MODEL.md.
// It prints each violation on one line and exits 1 when it finds one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from './extract.mjs';
import { parseViews } from './views.mjs';

const DIAMONDS = new Set(['aggregation', 'composition']);
// The role label of an aggregation, by pattern. It replaces the attribute name next to the line.
// The multiplicity follows it, for example `decorate 1`. Any other pattern keeps its label.
const ROLE_LABELS = { Decorator: 'decorate' };

// Return the list of violations of the five invariants of MODEL.md.
export function checkModel(model) {
  const out = [];
  const types = model.types ?? [];
  const edges = model.edges ?? [];
  const byId = new Map(types.map((t) => [t.id, t]));
  const partIndex = new Map((model.parts ?? []).map((p, i) => [p.id, i]));

  // Invariant 1: every end is a type of the model.
  for (const e of edges) {
    if (!byId.has(e.from)) out.push(`invariant 1: edge ${e.from} -> ${e.to} (${e.kind}): from "${e.from}" is not a type`);
    if (!byId.has(e.to)) out.push(`invariant 1: edge ${e.from} -> ${e.to} (${e.kind}): to "${e.to}" is not a type`);
  }

  // Invariant 2: a diamond joins two types of one layer and names its pattern.
  for (const e of edges) {
    if (DIAMONDS.has(e.kind)) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (a && b && a.layer !== b.layer) {
        out.push(`invariant 2: ${e.kind} ${e.from} -> ${e.to} crosses layers ${a.layer} and ${b.layer}`);
      }
      if (!e.pattern) out.push(`invariant 2: ${e.kind} ${e.from} -> ${e.to} has no pattern`);
    } else if (e.pattern != null) {
      out.push(`invariant 2: ${e.kind} ${e.from} -> ${e.to} has pattern "${e.pattern}" but is no diamond`);
    }
  }

  // Invariant 3: one edge per (from, to, kind), and no use next to implements or extends.
  const seen = new Set();
  const kindsOf = new Map();
  for (const e of edges) {
    const key = `${e.from}|${e.to}|${e.kind}`;
    if (seen.has(key)) out.push(`invariant 3: duplicate edge ${e.from} -> ${e.to} (${e.kind})`);
    seen.add(key);
    const pair = `${e.from}|${e.to}`;
    if (!kindsOf.has(pair)) kindsOf.set(pair, new Set());
    kindsOf.get(pair).add(e.kind);
  }
  for (const [pair, kinds] of kindsOf) {
    if (kinds.has('use') && (kinds.has('implements') || kinds.has('extends'))) {
      out.push(`invariant 3: pair ${pair.replace('|', ' -> ')} has a use next to ${kinds.has('implements') ? 'implements' : 'extends'}`);
    }
  }

  // Invariant 4: the sort order of types and edges.
  for (let i = 1; i < types.length; i++) {
    if (compareTypes(types[i - 1], types[i], partIndex) > 0) {
      out.push(`invariant 4: type ${types[i].id} sorts before ${types[i - 1].id}`);
    }
  }
  for (let i = 1; i < edges.length; i++) {
    if (compareEdges(edges[i - 1], edges[i]) > 0) {
      const e = edges[i];
      out.push(`invariant 4: edge ${e.from} -> ${e.to} (${e.kind}) sorts before its predecessor`);
    }
  }

  // Invariant 5: no timestamp in the model.
  const stamp = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
  const walk = (v, where) => {
    if (typeof v === 'string' && stamp.test(v)) out.push(`invariant 5: ${where} holds the timestamp "${v}"`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (/^(timestamp|generated(at)?|created(at)?|date|time)$/i.test(k)) out.push(`invariant 5: ${where}.${k} is a timestamp field`);
        walk(x, `${where}.${k}`);
      }
    }
  };
  walk(model, 'model');
  return out;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Sort types by layer from 4 to 1, then part, file and name (MODEL.md invariant 4).
// A planned type has no file, so it sorts after the code types of its part.
export function compareTypes(a, b, partIndex) {
  const pa = partIndex.get(a.part) ?? Infinity;
  const pb = partIndex.get(b.part) ?? Infinity;
  return (
    b.layer - a.layer ||
    (pa === pb ? 0 : pa < pb ? -1 : 1) ||
    cmp(a.file ?? '￿', b.file ?? '￿') ||
    cmp(a.name, b.name) ||
    cmp(a.id, b.id)
  );
}

export function compareEdges(a, b) {
  return cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.kind, b.kind);
}

const HERITAGE = new Set(['implements', 'extends']);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const majority = (values) => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = null;
  for (const [v, n] of counts) if (best === null || n > counts.get(best)) best = v;
  return best;
};

// Build the model of one repository from its code, its views and its config.
export function merge(code, views, cfg) {
  const notes = { unparsed: [], diamonds: [], kinds: [], heritageUses: [], unplaced: [], dangling: [], ambiguous: [], lollipops: [], stale: [], staleIgnored: [], renames: [], noOps: [], stereotypeIgnored: [] };
  const partIds = cfg.parts.map((p) => p.id);
  const partOfView = (view) => {
    if (view in cfg.views) return cfg.views[view];
    const prefix = Object.keys(cfg.views).find((k) => k.endsWith('-') && view.startsWith(k));
    return prefix === undefined ? null : cfg.views[prefix];
  };
  const placeFile = (file) => cfg.folders.filter((f) => file.startsWith(f.path)).sort((a, b) => b.path.length - a.path.length)[0] ?? null;
  // Part views come before flow views, so a part view gives the members and the signature of a type.
  const viewOrder = [...views].sort((a, b) => (partOfView(a.view) === null) - (partOfView(b.view) === null) || byText(a.view, b.view));

  // Every box with bounds, by type name, in view order.
  const drawn = new Map();
  for (const v of viewOrder) {
    for (const b of v.boxes) {
      if (!b.bounds) continue;
      if (!drawn.has(b.name)) drawn.set(b.name, []);
      drawn.get(b.name).push({ view: v.view, box: b });
    }
  }
  const viewsOf = (name) => [...new Set((drawn.get(name) ?? []).map((d) => d.view))].sort(byText);
  const stereotypesOf = (name) => [...new Set((drawn.get(name) ?? []).flatMap((d) => d.box.stereotypes))];
  const requirementOf = (name) => (drawn.get(name) ?? []).map((d) => d.box.requirement).find(Boolean) ?? null;
  const detailed = (name) => (drawn.get(name) ?? []).filter((d) => !d.box.ref && !d.box.chip);

  // A lollipop draws an interface by name. An interface that no box and no code type has becomes a
  // planned interface in the layer of the box under the stick.
  const codeTypeNames = new Set(code.types.map((t) => t.name));
  const lollipopOnly = new Set();
  for (const v of viewOrder) {
    for (const l of v.lines) {
      if (l.via !== 'lollipop' || codeTypeNames.has(l.to) || (drawn.has(l.to) && !lollipopOnly.has(l.to))) continue;
      const owner = v.boxes.find((b) => b.name === l.from && b.bounds);
      const box = { name: l.to, ref: true, chip: false, layer: owner?.layer ?? null, stereotypes: [], sprint: null, requirement: null, abstract: false, typeParams: [], attrs: [], ops: [], values: [] };
      if (!drawn.has(l.to)) drawn.set(l.to, []);
      drawn.get(l.to).push({ view: v.view, box });
      lollipopOnly.add(l.to);
    }
  }

  // The members that a code type inherits through its code heritage lines.
  // An alias such as `type SyncProgress = UseCase<…>` takes the members of the types it names.
  const codeById = new Map(code.types.map((t) => [t.id, t]));
  const parents = new Map();
  for (const e of code.edges) {
    if (!HERITAGE.has(e.kind) && codeById.get(e.from)?.alias == null) continue;
    if (!parents.has(e.from)) parents.set(e.from, []);
    parents.get(e.from).push(e.to);
  }
  const inherited = (id, seen = new Set()) => {
    const out = new Set();
    for (const p of parents.get(id) ?? []) {
      if (seen.has(p)) continue;
      seen.add(p);
      const t = codeById.get(p);
      for (const m of [...(t?.attrs ?? []), ...(t?.ops ?? [])]) out.add(m.name);
      for (const n of inherited(p, seen)) out.add(n);
    }
    return out;
  };
  // A field of an object type inside an alias, such as `ok` in `{ ok: true; value: T } | …`, is in the code.
  const inAlias = (t, name) => t.alias != null && new RegExp(`(^|[{;,\\s])${name.replace(/\$/g, '\\$')}\\??\\s*:`).test(t.alias);

  // Stale view members: the config names, for each one, the code members that play its role.
  // Each equivalent is `Type.member` of a code type; the report prints its signature.
  const codeMember = (ref) => {
    const [typeName, memberName] = ref.split('.');
    const t = code.types.find((x) => x.name === typeName);
    const m = [...(t?.attrs ?? []), ...(t?.ops ?? [])].find((x) => x.name === memberName);
    if (!m) throw new Error(`config staleMembers: ${ref} is no member of a code type`);
    return `${typeName}.${memberText(m).replace(/^[+\-#] /, '')}`;
  };
  const staleEntries = (cfg.staleMembers ?? []).map((s) => ({ ...s, equivalent: s.equivalent.map(codeMember), used: false }));
  const staleOf = (typeName, memberName) => staleEntries.find((s) => s.type === typeName && s.member === memberName) ?? null;
  const occurrences = (name, memberName) =>
    detailed(name).flatMap(({ view, box }) => [...box.attrs, ...box.ops].filter((m) => m.name === memberName).map((m) => `${view}.html:${m.line}`));

  // Code types: the exported ones, plus a local type or a const object that a view draws.
  const types = [];
  for (const t of code.types) {
    const isDrawn = drawn.has(t.name);
    if (!isDrawn && (!t.exported || t.kind === 'const')) continue;
    const place = placeFile(t.file);
    if (!place) {
      notes.unplaced.push(`${t.id} (${t.file}): no folder of the config holds it`);
      continue;
    }
    const type = {
      id: t.id,
      name: t.name,
      kind: t.kind,
      abstract: t.abstract,
      status: 'code',
      sprint: null,
      stereotypes: stereotypesOf(t.name),
      layer: place.layer,
      part: place.part,
      file: t.file,
      line: t.line,
      typeParams: t.typeParams,
      attrs: t.attrs.map(({ vis, name, type, static: st, readonly, optional }) => ({ vis, name, type, static: st, readonly, optional })),
      ops: t.ops.map(({ vis, name, typeParams, params, ret, abstract, static: st }) => ({ vis, name, typeParams, params, ret, abstract, static: st })),
      values: t.values,
      alias: t.alias,
      views: viewsOf(t.name),
      requirement: requirementOf(t.name),
    };
    // A member that only a view draws on a code type is planned.
    // A member that the type inherits, or a field inside its alias, is in the code.
    const known = new Set([...type.attrs, ...type.ops].map((m) => m.name).concat([...inherited(t.id)]));
    for (const { view, box } of detailed(t.name)) {
      for (const m of [...box.attrs, ...box.ops]) {
        if (m.raw) {
          notes.unparsed.push(`${t.name} in ${view}: "${m.name}"`);
          continue;
        }
        if (known.has(m.name) || inAlias(t, m.name)) continue;
        known.add(m.name);
        // A view member without «Sprint N» is stale when the config names its code equivalent.
        const stale = staleOf(t.name, m.name);
        if (stale && !m.sprint) {
          stale.used = true;
          notes.stale.push({ type: t.id, member: memberText(memberOf(m, view)), equivalent: stale.equivalent, where: occurrences(t.name, m.name) });
          continue;
        }
        if (stale) notes.staleIgnored.push(`${t.name}.${m.name}: the view marks it «${m.sprint}», so it stays planned`);
        type[m.member === 'op' ? 'ops' : 'attrs'].push(memberOf(m, view));
      }
    }
    types.push(type);
  }
  for (const s of staleEntries) {
    if (!s.used) notes.staleIgnored.push(`${s.type}.${s.member}: no planned member of the views matches this config entry`);
  }

  // Planned types: a name that a view draws and the code does not have.
  for (const [name, list] of drawn) {
    if (codeTypeNames.has(name)) continue;
    const full = list.filter((d) => !d.box.ref && !d.box.chip);
    const stereotypes = stereotypesOf(name);
    const layers = list.map((d) => d.box.layer).filter((l) => l != null);
    const layer = majority(layers);
    if (lollipopOnly.has(name)) notes.lollipops.push(`${name} (${viewsOf(name).join(', ')}): only a lollipop draws it`);
    if (layer === null) {
      notes.unplaced.push(`${name} (${viewsOf(name).join(', ')}): no box sits in a layer zone`);
      continue;
    }
    if (new Set(layers).size > 1) notes.unplaced.push(`${name}: the views put it in layers ${[...new Set(layers)].join(', ')}; the model uses layer ${layer}`);
    const fitting = cfg.parts.filter((p) => p.layers.includes(layer)).map((p) => p.id);
    const fromViews = list.map((d) => partOfView(d.view)).filter((p) => p && fitting.includes(p));
    const part = majority(fromViews) ?? fitting[0];
    const kindFrom = (st) =>
      st.some((s) => /\binterface\b|\bport\b/i.test(s)) || lollipopOnly.has(name) ? 'interface' : st.some((s) => /union/i.test(s)) ? 'union' : st.some((s) => /^enum/i.test(s)) ? 'enum' : 'class';
    const type = {
      id: name,
      name,
      kind: kindFrom(stereotypes),
      abstract: list.some((d) => d.box.abstract),
      status: 'planned',
      sprint: list.map((d) => d.box.sprint).find(Boolean) ?? null,
      stereotypes,
      layer,
      part,
      file: null,
      line: null,
      typeParams: full.map((d) => d.box.typeParams).find((tp) => tp.length) ?? [],
      attrs: [],
      ops: [],
      values: full.map((d) => d.box.values).find((v) => v.length) ?? [],
      alias: null,
      views: viewsOf(name),
      requirement: requirementOf(name),
    };
    const seen = new Set();
    for (const { view, box } of full) {
      for (const m of [...box.attrs, ...box.ops]) {
        if (m.raw) {
          notes.unparsed.push(`${name} in ${view}: "${m.name}"`);
          continue;
        }
        if (seen.has(m.name)) continue;
        seen.add(m.name);
        const { planned, ...plain } = memberOf(m, view);
        // A member of a planned type keeps only its own «Sprint N» when it differs from the type.
        if (plain.sprint === type.sprint || plain.sprint === null) delete plain.sprint;
        else plain.planned = true;
        type[m.member === 'op' ? 'ops' : 'attrs'].push(plain);
      }
    }
    types.push(type);
  }

  // Resolve a view name to one type id.
  const idsByName = new Map();
  for (const t of types) {
    if (!idsByName.has(t.name)) idsByName.set(t.name, []);
    idsByName.get(t.name).push(t.id);
  }
  const idOf = (name) => {
    const ids = idsByName.get(name) ?? [];
    if (ids.length > 1) notes.ambiguous.push(`${name}: ${ids.join(', ')}; the model uses ${ids[0]}`);
    return ids[0] ?? null;
  };
  const byId = new Map(types.map((t) => [t.id, t]));

  // Group the code lines and the view lines by pair.
  const pairs = new Map();
  const pairOf = (from, to) => {
    const key = `${from}|${to}`;
    if (!pairs.has(key)) pairs.set(key, { from, to, codeHeritage: null, codeUse: null, viewHeritage: [], viewAssoc: [] });
    return pairs.get(key);
  };
  for (const e of code.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    const p = pairOf(e.from, e.to);
    if (HERITAGE.has(e.kind)) p.codeHeritage = e;
    else p.codeUse = e;
  }
  for (const v of viewOrder) {
    for (const l of v.lines) {
      const from = idOf(l.from);
      const to = idOf(l.to);
      if (!from || !to) {
        notes.dangling.push(`${v.view}: ${l.from} -> ${l.to} (${l.kind}): ${!from ? l.from : l.to} is no type of the model`);
        continue;
      }
      const p = pairOf(from, to);
      (HERITAGE.has(l.kind) ? p.viewHeritage : p.viewAssoc).push(l);
    }
  }

  const viewLabel = (lines) => {
    const l = lines.find((x) => x.label || x.multiplicity);
    if (!l) return null;
    if (l.label && l.multiplicity && !l.label.endsWith(` ${l.multiplicity}`)) return `${l.label} ${l.multiplicity}`;
    return l.label ?? l.multiplicity;
  };
  const viewNames = (lines) => [...new Set(lines.map((l) => l.view))].sort(byText);
  // An aggregation with a role label carries the role and the multiplicity, else the label stays.
  const labelOf = (d, label, multiplicity) => {
    const role = d?.kind === 'aggregation' ? ROLE_LABELS[d.pattern] : undefined;
    if (!role) return label;
    return multiplicity ? `${role} ${multiplicity}` : role;
  };

  // A diamond needs one layer for both ends and a pattern from the config (MODEL.md invariant 2).
  const diamondFor = (p, lines, viaAttr) => {
    const diamonds = lines.filter((l) => l.kind !== 'use');
    if (!diamonds.length) return null;
    const kind = diamonds.some((l) => l.kind === 'composition') ? 'composition' : 'aggregation';
    const a = byId.get(p.from);
    const b = byId.get(p.to);
    const pattern = cfg.patterns[`${a.name}->${b.name}`] ?? null;
    const where = `${p.from} -> ${p.to} (${kind}, ${viewNames(diamonds).join(', ')})`;
    if (!viaAttr) notes.diamonds.push(`${where}: the code uses the type without an attribute; the line stays a use`);
    else if (a.layer !== b.layer) notes.diamonds.push(`${where}: layers ${a.layer} and ${b.layer}; the line stays a use`);
    else if (!pattern) notes.diamonds.push(`${where}: the config names no pattern; the line stays a use`);
    else return { kind, pattern };
    return null;
  };

  const edges = [];
  for (const p of pairs.values()) {
    let heritage = null;
    if (p.codeHeritage) {
      heritage = { from: p.from, to: p.to, kind: p.codeHeritage.kind, label: null, pattern: null, status: 'code', views: viewNames(p.viewHeritage) };
      const other = p.viewHeritage.filter((l) => l.kind !== p.codeHeritage.kind);
      if (other.length) notes.kinds.push(`${p.from} -> ${p.to}: the code ${p.codeHeritage.kind}, ${viewNames(other).join(', ')} draw ${other[0].kind}`);
    } else if (p.viewHeritage.length) {
      // The code decides that the dependency exists. A view can still read a use as a heritage,
      // for example an alias that binds the parameters of UseCase.
      const kind = p.viewHeritage[0].kind;
      heritage = { from: p.from, to: p.to, kind, label: null, pattern: null, status: p.codeUse ? 'code' : 'planned', views: viewNames(p.viewHeritage) };
      if (p.codeUse) notes.kinds.push(`${p.from} -> ${p.to}: the code has a use, ${viewNames(p.viewHeritage).join(', ')} draw ${kind}; the model keeps ${kind} with status code`);
    }
    let assoc = null;
    if (p.codeUse) {
      const d = diamondFor(p, p.viewAssoc, p.codeUse.viaAttr);
      // The code gives the multiplicity of a pair that the code holds.
      const label = labelOf(d, p.codeUse.label, p.codeUse.multiplicity);
      assoc = { from: p.from, to: p.to, kind: d?.kind ?? 'use', label, pattern: d?.pattern ?? null, status: 'code', views: viewNames(p.viewAssoc) };
    } else if (p.viewAssoc.length) {
      const d = diamondFor(p, p.viewAssoc, true);
      // The view gives the multiplicity of a planned pair: its own text, or the last word of the label.
      const multiplicity = p.viewAssoc.map((l) => l.multiplicity ?? l.label?.match(/\s(\d+|\*|\d+\.\.(?:\d+|\*))$/)?.[1]).find(Boolean);
      const label = labelOf(d, viewLabel(p.viewAssoc), multiplicity);
      assoc = { from: p.from, to: p.to, kind: d?.kind ?? 'use', label, pattern: d?.pattern ?? null, status: 'planned', views: viewNames(p.viewAssoc) };
    }
    // A pair with implements or extends keeps no use (MODEL.md invariant 3).
    // An aggregation or a composition stays next to the heritage line.
    if (heritage && assoc && assoc.kind === 'use') {
      notes.heritageUses.push(`${p.from} -> ${p.to}: ${heritage.kind} hides the ${assoc.status} use "${assoc.label ?? ''}"`);
      assoc = null;
    }
    if (heritage) edges.push(heritage);
    if (assoc) edges.push(assoc);
  }

  notes.renames = renameCandidates(types, edges, drawn);

  // Stereotypes: a layer-2 interface that an outer layer implements is a port.
  // Any other interface without a stereotype is an interface.
  for (const e of edges) {
    const target = byId.get(e.to);
    if (e.kind === 'implements' && target.kind === 'interface' && target.layer === 2 && byId.get(e.from).layer > 2) {
      if (!target.stereotypes.some((s) => /\bport\b/.test(s))) target.stereotypes.push('port');
    }
  }
  for (const t of types) if (t.kind === 'interface' && t.stereotypes.length === 0) t.stereotypes.push('interface');
  // A union of literals is an enumeration (team decision, 2026-11-24).
  // The model holds the word, so gen.mjs and the page print the same word.
  for (const t of types) if (t.kind === 'union' && !t.stereotypes.includes('enumeration')) t.stereotypes.push('enumeration');

  // A code class with no operation only carries data, so it gets «dataType».
  // The box then says why it has no operation (rule (i) of check.mjs).
  // An interface never gets «dataType». Its «interface» already says why (team decision, 2026-11-24).
  // The config map stereotypeFor names another stereotype for one class, for example «module» for a Nest module.
  const stereotypeFor = cfg.stereotypeFor ?? {};
  for (const t of types) {
    if (t.status !== 'code' || t.kind !== 'class' || t.ops.length) continue;
    const mark = stereotypeFor[t.id] ?? stereotypeFor[t.name] ?? 'dataType';
    if (!t.stereotypes.includes(mark)) t.stereotypes.push(mark);
    notes.noOps.push({ type: t, mark });
  }
  for (const name of Object.keys(stereotypeFor)) {
    if (!notes.noOps.some(({ type }) => type.id === name || type.name === name)) {
      notes.stereotypeIgnored.push(`${name}: no code class with no operation has this name`);
    }
  }

  // An id with a path suffix keeps it only while another type shares the name.
  for (const t of types) {
    if (t.id.includes('@') && types.filter((x) => x.name === t.name).length === 1) {
      const old = t.id;
      t.id = t.name;
      for (const e of edges) {
        if (e.from === old) e.from = t.id;
        if (e.to === old) e.to = t.id;
      }
    }
  }

  const partIndex = new Map(partIds.map((id, i) => [id, i]));
  const model = {
    repo: code.repo,
    head: code.head,
    parts: cfg.parts.map(({ id, title }) => ({ id, title })),
    types: types.sort((a, b) => compareTypes(a, b, partIndex)),
    edges: edges.sort(compareEdges),
  };
  const unresolved = views.flatMap((v) => v.unresolved);
  return { model, notes, unresolved };
}

// Turn a parsed view member into a model member with its planned mark.
// Name tokens that give a role, not a subject. Two names that share only these tokens name siblings.
const ROLE_TOKENS = new Set(
  'Use Case Controller Dto Repository Mapper Aspect Factory Builder Decorator Presenter Screen Store Gateway Reader Validator Validators Rules Policy Model Entry Row Get Set Update Sync Manager Renderer View Service Handler Port Adapter Interface'.split(' '),
);
// Member names that most types of one role share. They give no evidence of a rename.
const TRIVIAL_MEMBERS = new Set(['constructor', 'execute', 'clone']);
const nameTokens = (name) => name.replace(/^I(?=[A-Z])/, '').match(/[A-Z][a-z0-9]*|[a-z0-9]+/g) ?? [name];

// List the code types that a planned type may rename. Nothing merges; the report shows the evidence.
// A candidate sits in the same layer and part, has no line to the planned type, is not drawn next
// to it in one view, and shares a subject token of its name. Shared members raise the confidence.
function renameCandidates(types, edges, drawn) {
  const linked = new Set(edges.flatMap((e) => [`${e.from}|${e.to}`, `${e.to}|${e.from}`]));
  const viewSet = (name) => new Set((drawn.get(name) ?? []).map((d) => d.view));
  const members = (t) => new Set([...t.attrs, ...t.ops].map((m) => m.name).filter((n) => !TRIVIAL_MEMBERS.has(n)));
  const out = [];
  for (const p of types.filter((t) => t.status === 'planned')) {
    const pTokens = nameTokens(p.name);
    const pSubject = pTokens.filter((x) => !ROLE_TOKENS.has(x));
    const pRole = pTokens.filter((x) => ROLE_TOKENS.has(x)).join(' ');
    const pViews = viewSet(p.name);
    const pMembers = members(p);
    for (const c of types.filter((t) => t.status === 'code' && t.layer === p.layer && t.part === p.part)) {
      if (linked.has(`${p.id}|${c.id}`)) continue;
      const together = [...viewSet(c.name)].filter((v) => pViews.has(v));
      if (together.length) continue;
      const cTokens = nameTokens(c.name);
      const cSubject = cTokens.filter((x) => !ROLE_TOKENS.has(x));
      const sharedSubject = pSubject.filter((x) => cSubject.includes(x));
      if (!sharedSubject.length) continue;
      const sameRole = pRole === cTokens.filter((x) => ROLE_TOKENS.has(x)).join(' ');
      const nested = pSubject.every((x) => cSubject.includes(x)) || cSubject.every((x) => pSubject.includes(x));
      const cMembers = members(c);
      const shared = [...pMembers].filter((n) => cMembers.has(n));
      const ratio = shared.length / Math.max(1, Math.min(pMembers.size, cMembers.size));
      let confidence = null;
      if (sameRole && nested && shared.length >= 2 && ratio >= 0.5) confidence = 'high';
      else if (sameRole && nested && shared.length >= 1 && ratio >= 0.5) confidence = 'medium';
      else if ((sameRole && nested) || (shared.length >= 2 && ratio >= 0.5)) confidence = 'low';
      if (!confidence) continue;
      out.push({
        planned: p.id,
        code: c.id,
        confidence,
        evidence: [
          `shared name tokens: ${sharedSubject.join(', ')}${sameRole ? `; same role${pRole ? ` (${pRole})` : ''}` : ''}`,
          `shared members: ${shared.length ? `${shared.join(', ')} (${shared.length} of ${pMembers.size} planned, ${cMembers.size} in the code)` : 'none'}`,
          `code folder: ${path.posix.dirname(c.file)}`,
          `planned type drawn in: ${[...pViews].sort(byText).join(', ')}; never in one view with ${c.name}`,
        ].join('; '),
      });
    }
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.confidence] - rank[b.confidence] || byText(a.planned, b.planned) || byText(a.code, b.code));
}

function memberOf(m, view) {
  const base =
    m.member === 'op'
      ? { vis: m.vis, name: m.name, typeParams: m.typeParams, params: m.params, ret: m.ret, abstract: m.abstract, static: m.static }
      : { vis: m.vis, name: m.name, type: m.type, static: m.static, readonly: m.readonly, optional: m.optional };
  return { ...base, planned: true, sprint: m.sprint ?? null, _view: `${view}.html:${m.line}` };
}

const mdCell = (s) => String(s ?? '').replace(/\|/g, '\\|');
const memberText = (m) =>
  m.params ? `${m.vis} ${m.name}(${m.params.join(', ')})${m.ret === null ? '' : `: ${m.ret}`}` : `${m.vis} ${m.name}: ${m.type}`;

// Write the planned report of one model as Markdown.
export function report(model, notes, unresolved) {
  const L = [];
  const planned = model.types.filter((t) => t.status === 'planned');
  L.push(`# Planned design of ${model.repo} at ${model.head}`, '');
  L.push('`merge.mjs` writes this file. Each section lists what the class views add to the code.', '');
  L.push(`## Planned types (${planned.length})`, '');
  L.push('| Type | Kind | Layer | Part | Sprint | Views |', '|---|---|---|---|---|---|');
  for (const t of planned) L.push(`| ${t.id} | ${t.kind} | ${t.layer} | ${t.part} | ${t.sprint ?? ''} | ${t.views.join(', ')} |`);
  const members = model.types.flatMap((t) => [...t.attrs, ...t.ops].filter((m) => m.planned).map((m) => ({ t, m })));
  L.push('', `## Planned members (${members.length})`, '');
  L.push('A member of a code type that only a view draws. A member of a planned type is listed when its sprint differs from the sprint of its type.', '');
  L.push('| Type | Status of the type | Member | Sprint | View |', '|---|---|---|---|---|');
  for (const { t, m } of members) L.push(`| ${t.id} | ${t.status} | \`${mdCell(memberText(m))}\` | ${m.sprint ?? ''} | ${m._view ?? ''} |`);
  const plannedEdges = model.edges.filter((e) => e.status === 'planned');
  L.push('', `## Planned lines (${plannedEdges.length})`, '');
  L.push('| From | To | Kind | Label | Views |', '|---|---|---|---|---|');
  for (const e of plannedEdges) L.push(`| ${e.from} | ${e.to} | ${e.kind}${e.pattern ? ` (${e.pattern})` : ''} | ${mdCell(e.label ?? '')} | ${e.views.join(', ')} |`);
  L.push('', `## Types with no operation (${notes.noOps.length})`, '');
  L.push('A code class with no operation. It carries «dataType», or the stereotype that the `stereotypeFor` map of the config names. An interface with no operation keeps «interface» alone, so this list leaves it out.', '');
  if (!notes.noOps.length) L.push('None.');
  else L.push('| Type | Kind | Layer | Part | Stereotype | File |', '|---|---|---|---|---|---|');
  for (const { type: t, mark } of notes.noOps) L.push(`| ${t.id} | ${t.kind} | ${t.layer} | ${t.part} | «${mark}» | ${t.file}:${t.line} |`);
  L.push('', `## Stale view members (${notes.stale.length})`, '');
  L.push('A view member without «Sprint N» whose role a code member already plays. The model drops it. The `staleMembers` list of the config names each code equivalent.', '');
  L.push('| Type | View member | Code equivalent | View file and line |', '|---|---|---|---|');
  for (const s of notes.stale) L.push(`| ${s.type} | \`${mdCell(s.member)}\` | ${s.equivalent.map((e) => `\`${mdCell(e)}\``).join(', ')} | ${s.where.join(', ')} |`);
  L.push('', `## Possible renames (${notes.renames.length})`, '');
  L.push('A code type that a planned type may rename. Nothing merges; the parent decides.', '');
  if (!notes.renames.length) L.push('None.');
  else L.push('| Planned type | Code type | Confidence | Evidence |', '|---|---|---|---|');
  for (const r of notes.renames) L.push(`| ${r.planned} | ${r.code} | ${r.confidence} | ${mdCell(r.evidence)} |`);
  L.push('', `## Unresolved view lines (${unresolved.length + notes.dangling.length})`, '');
  if (!unresolved.length && !notes.dangling.length) L.push('None.');
  for (const u of unresolved) L.push(`- ${u.view}: ${u.kind}, ${u.reason}. Comment: ${u.comment ?? 'none'}.`);
  for (const d of notes.dangling) L.push(`- ${d}`);
  L.push('', `## View types without a layer (${notes.unplaced.length})`, '');
  if (!notes.unplaced.length) L.push('None.');
  for (const u of notes.unplaced) L.push(`- ${u}`);
  const extra = [
    ['Diamonds the model keeps as uses', notes.diamonds],
    ['Kinds where the code and a view differ', notes.kinds],
    ['Uses hidden by implements or extends (MODEL.md invariant 3)', notes.heritageUses],
    ['Planned interfaces that only a lollipop draws', notes.lollipops],
    ['Names with more than one type', [...new Set(notes.ambiguous)]],
    ['Config entries for stale members that do not apply', notes.staleIgnored],
    ['Config stereotypes that do not apply', notes.stereotypeIgnored],
    ['Member texts the parser could not read', notes.unparsed],
  ];
  for (const [title, list] of extra) {
    L.push('', `## ${title} (${list.length})`, '');
    if (!list.length) L.push('None.');
    for (const x of list) L.push(`- ${x}`);
  }
  return L.join('\n') + '\n';
}

function main(argv) {
  if (argv[0] === '--check' && argv[1]) {
    const model = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
    const violations = checkModel(model);
    for (const v of violations) console.log(v);
    console.log(`${argv[1]}: ${violations.length} violation(s)`);
    process.exit(violations.length ? 1 : 0);
  }
  const ci = argv.indexOf('--config');
  const cfgArg = ci >= 0 ? argv[ci + 1] : null;
  const [repoArg, outDir] = argv.filter((a, i) => ci < 0 || (i !== ci && i !== ci + 1));
  if (!repoArg || !outDir || (ci >= 0 && !cfgArg)) {
    console.error('usage: node merge.mjs <repo-root> <out-dir> [--config <config.json>]\n       node merge.mjs --check <model.json>');
    process.exit(2);
  }
  const cfgPath = cfgArg ?? path.join(repoArg, 'docs', 'architecture', 'classes.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const code = extract(repoArg);
  if (code.repo !== cfg.repo) throw new Error(`config ${cfgPath} is for ${cfg.repo}, the repository is ${code.repo}`);
  const { model, notes, unresolved } = merge(code, parseViews(repoArg), cfg);
  const md = report(model, notes, unresolved);
  // The view of a planned member serves the report only; the model keeps the MODEL.md fields.
  for (const t of model.types) for (const m of [...t.attrs, ...t.ops]) delete m._view;
  fs.mkdirSync(outDir, { recursive: true });
  const modelPath = path.join(outDir, `${model.repo}.model.json`);
  fs.writeFileSync(modelPath, JSON.stringify(model, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, `planned-report-${model.repo}.md`), md);
  const violations = checkModel(model);
  for (const v of violations) console.log(v);
  const status = (s) => model.types.filter((t) => t.status === s).length;
  console.log(
    `${modelPath}: ${model.types.length} types (code ${status('code')}, planned ${status('planned')}), ${model.edges.length} lines, ${unresolved.length + notes.dangling.length} unresolved view lines, ${violations.length} violation(s)`,
  );
  process.exit(violations.length ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main(process.argv.slice(2));
