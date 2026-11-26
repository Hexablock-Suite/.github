#!/usr/bin/env node
// check.mjs checks the class notation of a .drawio file that gen.mjs writes.
// Usage: node check.mjs <file.drawio> <model.json> [<config.json>]
// It prints one line for each violation and exits 1 when it finds one.
// The config gives the stereotypes that merge.mjs puts on a code type with no operation.
// Without the argument it reads classes.config.json next to the .drawio file, when that file exists.
// The diagram lives at docs/architecture/classes.drawio, so that file is <repo-root>/docs/architecture/classes.config.json.
// The letters in brackets are the checks of README.md.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The generator draws a planned line in this grey.
const PLANNED_STROKE = '#9ca3af';
const LINE_KINDS = ['use', 'implements', 'extends', 'aggregation', 'composition'];
// A planned class or interface that no view details shows this line instead of operations.
export const UNDESIGNED = 'members not designed yet';
// A code class or interface with no operation carries one of these stereotypes. The box says why it has no operation.
export const DATA_TYPE = 'dataType';

// ---------------------------------------------------------------- XML parser

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeXml(text, fail) {
  return text.replace(/&([^;\s&]*);?/g, (all, body) => {
    if (!all.endsWith(';')) fail(`bare "&" in "${text.slice(0, 40)}"`);
    if (body in ENTITIES) return ENTITIES[body];
    const num = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(body);
    if (!num) fail(`unknown entity "&${body};"`);
    return String.fromCodePoint(num[1] ? parseInt(num[1], 16) : Number(num[2]));
  });
}

// parseXml returns the root element as { name, attrs, children }.
// It reads elements, attributes, text, comments and the XML declaration.
// It throws on any other markup and on any well-formedness error.
export function parseXml(text) {
  const doc = { name: '#document', attrs: {}, children: [] };
  const stack = [doc];
  let i = 0;
  const fail = (msg) => {
    const line = text.slice(0, i).split('\n').length;
    throw new Error(`line ${line}: ${msg}`);
  };
  const NAME = /[A-Za-z_][\w.:-]*/y;
  const ATTR = /\s+([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;
  while (i < text.length) {
    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i);
      if (end < 0) fail('the declaration has no end');
      i = end + 2;
    } else if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i);
      if (end < 0) fail('the comment has no end');
      i = end + 3;
    } else if (text.startsWith('<!', i)) {
      fail('DOCTYPE and CDATA are not supported');
    } else if (text.startsWith('</', i)) {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(text);
      if (!m) fail('a closing tag has no name');
      const open = stack.pop();
      if (open.name !== m[0]) fail(`</${m[0]}> closes <${open.name}>`);
      i = NAME.lastIndex;
      while (/\s/.test(text[i] ?? '')) i += 1;
      if (text[i] !== '>') fail(`</${m[0]}> has no ">"`);
      i += 1;
    } else if (text[i] === '<') {
      NAME.lastIndex = i + 1;
      const m = NAME.exec(text);
      if (!m) fail('a tag has no name');
      const el = { name: m[0], attrs: {}, children: [] };
      let j = NAME.lastIndex;
      for (;;) {
        ATTR.lastIndex = j;
        const a = ATTR.exec(text);
        if (!a) break;
        const raw = a[3] ?? a[4];
        if (raw.includes('<')) fail(`attribute ${a[1]} of <${el.name}> holds "<"`);
        if (a[1] in el.attrs) fail(`attribute ${a[1]} of <${el.name}> repeats`);
        el.attrs[a[1]] = decodeXml(raw, fail);
        j = ATTR.lastIndex;
      }
      while (/\s/.test(text[j] ?? '')) j += 1;
      const parent = stack[stack.length - 1];
      if (parent === doc && doc.children.length) fail('the document has a second root element');
      parent.children.push(el);
      if (text.startsWith('/>', j)) i = j + 2;
      else if (text[j] === '>') {
        stack.push(el);
        i = j + 1;
      } else {
        i = j;
        fail(`<${el.name}> has a malformed attribute`);
      }
    } else {
      const end = text.indexOf('<', i);
      const raw = text.slice(i, end < 0 ? text.length : end);
      if (raw.trim()) {
        if (stack.length === 1) fail('text outside the root element');
        stack[stack.length - 1].children.push({ name: '#text', text: decodeXml(raw, fail) });
      }
      i = end < 0 ? text.length : end;
    }
  }
  if (stack.length > 1) fail(`<${stack[stack.length - 1].name}> has no closing tag`);
  if (!doc.children.length) fail('the document has no root element');
  return doc.children[0];
}

// ---------------------------------------------------------------- draw.io reading

export function parseStyle(style = '') {
  const out = {};
  for (const part of style.split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) out[part] = true;
    else out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

// readPages returns each <diagram> with its cells.
// A cell inside <object> or <UserObject> takes the attributes of that wrapper as data.
// The cell map keeps the last cell of an id. `dupes` lists each id that more than one cell of the page has, with its count.
export function readPages(root) {
  if (root.name !== 'mxfile') throw new Error(`the root element is <${root.name}>, not <mxfile>`);
  const pages = [];
  for (const diagram of root.children.filter((c) => c.name === 'diagram')) {
    const model = diagram.children.find((c) => c.name === 'mxGraphModel');
    if (!model) throw new Error(`page "${diagram.attrs.name}" is compressed or empty`);
    const rootEl = model.children.find((c) => c.name === 'root');
    const cells = new Map();
    const idCount = new Map();
    for (const el of rootEl?.children ?? []) {
      let cell;
      let mx;
      if (el.name === 'mxCell') {
        mx = el;
        cell = { ...el.attrs, data: {}, label: el.attrs.value ?? '' };
      } else if (el.name === 'object' || el.name === 'UserObject') {
        mx = el.children.find((c) => c.name === 'mxCell') ?? { attrs: {}, children: [] };
        cell = { ...mx.attrs, id: el.attrs.id, data: el.attrs, label: el.attrs.label ?? '' };
      } else continue;
      cell.styleMap = parseStyle(cell.style);
      const geo = mx.children.find((c) => c.name === 'mxGeometry');
      cell.geo = geo?.attrs ?? {};
      const points = geo?.children.find((c) => c.name === 'Array' && c.attrs.as === 'points');
      cell.points = (points?.children ?? []).filter((c) => c.name === 'mxPoint').map((p) => ({ x: Number(p.attrs.x ?? 0), y: Number(p.attrs.y ?? 0) }));
      const offset = geo?.children.find((c) => c.name === 'mxPoint' && c.attrs.as === 'offset');
      cell.labelOffset = { x: Number(offset?.attrs.x ?? 0), y: Number(offset?.attrs.y ?? 0) };
      idCount.set(cell.id, (idCount.get(cell.id) ?? 0) + 1);
      cells.set(cell.id, cell);
    }
    const dupes = [...idCount].filter(([, n]) => n > 1);
    pages.push({ id: diagram.attrs.id, name: diagram.attrs.name, cells, dupes });
  }
  return pages;
}

// labelText turns an HTML label into plain text, one line per <br> or block.
// gen.mjs wraps a long member with <br class="wrap">. That soft break joins the parts again into one line.
export function labelText(html) {
  return html
    .replace(/<br class="wrap">/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

// edgeKind reads the UML line kind from the style, or returns null.
export function edgeKind(st) {
  const dashed = st.dashed === '1';
  if (st.startArrow === 'diamondThin' && st.endArrow === 'none' && !dashed) {
    if (st.startFill === '0') return 'aggregation';
    if (st.startFill === '1') return 'composition';
    return null;
  }
  if (st.startArrow && st.startArrow !== 'none') return null;
  if (st.endArrow === 'block' && st.endFill === '0') return dashed ? 'implements' : 'extends';
  if (st.endArrow === 'open' && !dashed) return 'use';
  return null;
}

// ---------------------------------------------------------------- edge geometry

const num = (v, d = 0) => (v === undefined || v === '' ? d : Number(v));

// absBoxes returns the page position of every vertex. A child position adds its parent position.
export function absBoxes(page) {
  const out = new Map();
  const at = (cell) => {
    if (out.has(cell.id)) return out.get(cell.id);
    const parent = page.cells.get(cell.parent);
    const base = parent && parent.vertex === '1' ? at(parent) : { x: 0, y: 0 };
    const box = { x: base.x + num(cell.geo.x), y: base.y + num(cell.geo.y), w: num(cell.geo.width), h: num(cell.geo.height) };
    out.set(cell.id, box);
    return box;
  };
  for (const cell of page.cells.values()) if (cell.vertex === '1') at(cell);
  return out;
}

// edgePolyline returns the drawn points of an edge: the fixed exit, the waypoints and the fixed entry.
// It returns { error } when the edge has no fixed exit, no fixed entry, no waypoint or a diagonal segment.
export function edgePolyline(cell, page, boxes) {
  const st = cell.styleMap;
  const s = boxes.get(cell.source);
  const t = boxes.get(cell.target);
  if (!s || !t) return { error: 'has no source or target box' };
  if (st.exitX === undefined || st.exitY === undefined) return { error: 'has no fixed exit point (exitX, exitY)' };
  if (st.entryX === undefined || st.entryY === undefined) return { error: 'has no fixed entry point (entryX, entryY)' };
  if (!cell.points.length) return { error: 'has no waypoints' };
  const parent = page.cells.get(cell.parent);
  const base = parent && parent.vertex === '1' ? boxes.get(parent.id) : { x: 0, y: 0 };
  const pts = [
    { x: s.x + num(st.exitX) * s.w + num(st.exitDx), y: s.y + num(st.exitY) * s.h + num(st.exitDy) },
    ...cell.points.map((p) => ({ x: base.x + p.x, y: base.y + p.y })),
    { x: t.x + num(st.entryX) * t.w + num(st.entryDx), y: t.y + num(st.entryY) * t.h + num(st.entryDy) },
  ];
  for (let k = 1; k < pts.length; k += 1) {
    if (Math.abs(pts[k].x - pts[k - 1].x) > 1 && Math.abs(pts[k].y - pts[k - 1].y) > 1) return { error: `has a diagonal segment at point ${k}` };
  }
  return { pts };
}

// segmentCrosses tells whether segment a-b enters the interior of box r. A touch on the border does not count.
export function segmentCrosses(a, b, r) {
  const pad = 1;
  return (
    Math.max(a.x, b.x) > r.x + pad && Math.min(a.x, b.x) < r.x + r.w - pad && Math.max(a.y, b.y) > r.y + pad && Math.min(a.y, b.y) < r.y + r.h - pad
  );
}

// crossedBoxes returns the boxes that the polyline of an edge enters, except its own two ends.
// Class boxes, reference boxes and type parameter boxes count.
export function crossedBoxes(pts, cell, page, boxes) {
  const out = [];
  for (const other of page.cells.values()) {
    const role = other.data.role;
    if (other.vertex !== '1' || !(role === 'class' || role === 'ref' || role === 'tparams')) continue;
    if (other.id === cell.source || other.id === cell.target) continue;
    const r = boxes.get(other.id);
    if (pts.slice(1).some((p, k) => segmentCrosses(pts[k], p, r))) out.push(role === 'tparams' ? `${other.data.typeId} (type parameters)` : other.data.typeId);
  }
  return out;
}

function isPlannedEdge(cell) {
  return cell.styleMap.strokeColor === PLANNED_STROKE && /\bplanned\b/.test(labelText(cell.label));
}

// ---------------------------------------------------------------- operation check

function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let k = 0; k < text.length; k += 1) {
    const ch = text[k];
    if ('<([{'.includes(ch)) depth += 1;
    else if ('>)]}'.includes(ch) && !(ch === '>' && text[k - 1] === '=')) depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(text.slice(start, k));
      start = k + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

// opProblem returns why one operation line breaks rule 5, or null.
export function opProblem(line) {
  const body = line.replace(/^(«[^»]*»\s*)+/, '').trim();
  // A name is an identifier or a computed key such as [Symbol.iterator].
  const m = /^[+\-#~]\s*([\w$]+|\[[\w$.]+\])\s*\(/.exec(body);
  if (!m) return 'has no visibility, name and parentheses';
  let depth = 0;
  let close = -1;
  for (let k = m[0].length - 1; k < body.length; k += 1) {
    if (body[k] === '(') depth += 1;
    if (body[k] === ')') depth -= 1;
    if (depth === 0) {
      close = k;
      break;
    }
  }
  if (close < 0) return 'has no closing parenthesis';
  for (const param of splitTopLevel(body.slice(m[0].length, close))) {
    // A parameter name is an identifier or a destructuring pattern such as [x, y] or { x, y }.
    if (!/^(\.\.\.)?([\w$]+\??|\[[^\]]*\]|\{[^}]*\})\s*:\s*\S/.test(param)) return `has the untyped parameter "${param}"`;
  }
  if (m[1] === 'constructor') return null;
  if (!/^\s*:\s*\S/.test(body.slice(close + 1))) return 'has no return type';
  return null;
}

// ---------------------------------------------------------------- the checks

// dataStereotypes: the stereotypes that let a code class or interface have no operation.
export function check(xmlText, model, dataStereotypes = [DATA_TYPE]) {
  const out = [];
  const say = (rule, msg) => out.push(`[${rule}] ${msg}`);

  let pages;
  try {
    pages = readPages(parseXml(xmlText));
  } catch (err) {
    say('g', `the XML does not parse: ${err.message}`);
    return out;
  }
  if (!pages.length) {
    say('g', 'the file has no page');
    return out;
  }
  // (g) Each cell id appears once on its page. draw.io expects one cell for each id, so it can drop or merge a second one.
  // A part over two layers gave two groups with one key, and so one cell id, on one page.
  for (const page of pages) {
    for (const [id, n] of page.dupes) say('g', `page "${page.name}" has ${n} cells with the id "${id}"`);
  }

  const types = new Map(model.types.map((t) => [t.id, t]));
  const parts = model.parts ?? [];
  const partPageNo = new Map();
  for (const part of parts) {
    const idx = pages.findIndex((p) => p.id === `part-${part.id}`);
    if (idx < 0) say('d', `part "${part.id}" has no page with id "part-${part.id}"`);
    else partPageNo.set(part.id, idx + 1);
  }

  const pageInfo = pages.map((page) => scanPage(page, types, say, dataStereotypes));
  const first = pageInfo[0];

  // (c) Page 1 shows every model type once, in full, and every model line.
  const counts = new Map();
  for (const cell of first.boxes) {
    if (cell.data.role === 'ref') say('c', `page 1 has the reference box ${cell.id}`);
    counts.set(cell.data.typeId, (counts.get(cell.data.typeId) ?? 0) + 1);
  }
  for (const t of model.types) {
    const n = counts.get(t.id) ?? 0;
    if (n !== 1) say('c', `type "${t.id}" appears ${n} times on page 1, not once`);
  }
  const modelLines = new Map(model.edges.map((e) => [lineKey(e.from, e.to, e.kind), e]));
  for (const [key, line] of first.lines) {
    const e = modelLines.get(key);
    if (!e) say('c', `page 1 draws the line ${key}, which the model does not have`);
    else if ((e.status === 'planned') !== line.planned) say('c', `line ${key} is ${e.status} in the model but not drawn so`);
  }
  for (const key of modelLines.keys()) {
    if (!first.lines.has(key)) say('c', `page 1 lacks the model line ${key}`);
  }

  // (d) Each part page is a subset of page 1.
  for (const part of parts) {
    const no = partPageNo.get(part.id);
    if (!no) continue;
    const info = pageInfo[no - 1];
    const where = `page ${no} "${info.page.name}"`;
    const shown = new Set();
    for (const cell of info.boxes) {
      const t = types.get(cell.data.typeId);
      if (!t) continue;
      if (shown.has(t.id)) say('d', `${where} shows type "${t.id}" twice`);
      shown.add(t.id);
      if (cell.data.role === 'class') {
        if (t.part !== part.id) say('d', `${where} details type "${t.id}" of part "${t.part}"`);
        const full = first.boxes.find((c) => c.data.typeId === t.id && c.data.role === 'class');
        if (full && full.label !== cell.label) say('d', `${where} draws box "${t.id}" unlike page 1`);
      } else {
        if (t.part === part.id) say('d', `${where} shows its own type "${t.id}" as a reference`);
        const eyebrow = `PAGE ${partPageNo.get(t.part)} · ${parts.find((p) => p.id === t.part)?.title.toUpperCase()}`;
        if (!labelText(cell.label).includes(eyebrow)) say('d', `${where} reference "${t.id}" does not name "${eyebrow}"`);
      }
    }
    for (const t of model.types) {
      if (t.part === part.id && !shown.has(t.id)) say('d', `${where} lacks its type "${t.id}"`);
    }
    for (const key of info.lines.keys()) {
      if (!first.lines.has(key)) say('d', `${where} draws the line ${key}, which page 1 does not draw`);
    }
    for (const [key, line] of first.lines) {
      if (shown.has(line.from) && shown.has(line.to) && !info.lines.has(key)) {
        say('d', `${where} shows both ends of ${key} but not the line`);
      }
    }
  }
  for (const info of pageInfo.slice(1)) {
    if (!parts.some((p) => `part-${p.id}` === info.page.id)) say('d', `page "${info.page.name}" belongs to no part`);
  }
  return out;
}

function lineKey(from, to, kind) {
  return `${from} -${kind}-> ${to}`;
}

// scanPage runs the checks of one page: (a), (b), (e), (f), (h), (i) and rule 1.
function scanPage(page, types, say, dataStereotypes) {
  const where = `page "${page.name}"`;
  const geom = absBoxes(page);
  const boxes = [];
  const lines = new Map();
  const drawnLines = new Set();
  const drawnBoxes = new Set();
  const legendLines = new Set();
  const legendBoxes = new Set();

  const bandOf = (cell) => {
    let cur = cell;
    for (let guard = 0; cur && guard < 50; guard += 1) {
      if (cur.data.role === 'band') return cur;
      cur = page.cells.get(cur.parent);
    }
    return null;
  };

  for (const cell of page.cells.values()) {
    const role = cell.data.role;
    if (role === 'legend-line') legendLines.add(cell.data.kind);
    if (role === 'legend-box') legendBoxes.add(cell.data.kind);
    if (role === 'tparams') drawnBoxes.add('template');
    if (cell.vertex === '1' && (role === 'class' || role === 'ref')) {
      const t = types.get(cell.data.typeId);
      if (!t) {
        say('c', `${where} box ${cell.id} shows "${cell.data.typeId}", which the model does not have`);
        continue;
      }
      boxes.push(cell);
      const band = bandOf(cell);
      if (!band || Number(band.data.layer) !== t.layer) {
        say('c', `${where} box "${t.id}" of layer ${t.layer} sits in ${band ? `the layer ${band.data.layer} band` : 'no band'} (rule 1)`);
      }
      if (role === 'ref') drawnBoxes.add('ref');
      else drawnBoxes.add(cell.styleMap.dashed === '1' ? 'planned' : 'code');
      if (role === 'class' && /<i>/.test(cell.label)) drawnBoxes.add('abstract');
      if (role === 'class') for (const kind of checkOps(cell, t, where, say, dataStereotypes)) drawnBoxes.add(kind);
    }
  }

  for (const cell of page.cells.values()) {
    if (cell.edge !== '1') continue;
    const ends = {};
    for (const side of ['source', 'target']) {
      const end = page.cells.get(cell[side]);
      if (!end) say('a', `${where} edge ${cell.id} ${side} "${cell[side]}" is no cell`);
      else if (!(end.vertex === '1' && (end.data.role === 'class' || end.data.role === 'ref'))) {
        say('a', `${where} edge ${cell.id} ${side} "${end.id}" is a ${end.data.role ?? 'plain'} cell, not a class (rule 3)`);
      } else ends[side] = types.get(end.data.typeId);
    }
    const kind = edgeKind(cell.styleMap);
    if (!kind) {
      say('a', `${where} edge ${cell.id} has no UML line kind in its style "${cell.style}"`);
      continue;
    }
    drawnLines.add(kind);
    if (isPlannedEdge(cell)) drawnLines.add('planned');
    if (!ends.source || !ends.target) continue;
    if ((kind === 'aggregation' || kind === 'composition') && ends.source.layer !== ends.target.layer) {
      say('b', `${where} ${kind} ${ends.source.id} -> ${ends.target.id} joins layer ${ends.source.layer} and layer ${ends.target.layer} (rule 9)`);
    }
    const key = lineKey(ends.source.id, ends.target.id, kind);
    // (h) The line runs from a fixed exit through its waypoints to a fixed entry and enters no other box.
    const poly = edgePolyline(cell, page, geom);
    if (poly.error) say('h', `${where} line ${key} ${poly.error}`);
    else {
      const crossed = crossedBoxes(poly.pts, cell, page, geom);
      if (crossed.length) say('h', `${where} line ${key} crosses the box of ${crossed.join(', ')}`);
    }
    if (lines.has(key)) say('d', `${where} draws ${key} twice`);
    lines.set(key, { from: ends.source.id, to: ends.target.id, kind, planned: isPlannedEdge(cell) });
  }

  // (f) The legend lists exactly the line kinds and box kinds of the page (rule 13).
  for (const kind of [...LINE_KINDS, 'planned']) {
    if (drawnLines.has(kind) && !legendLines.has(kind)) say('f', `${where} draws ${kind} lines but the legend omits them`);
    if (!drawnLines.has(kind) && legendLines.has(kind)) say('f', `${where} legend lists ${kind} lines that the page does not draw`);
  }
  for (const kind of ['code', 'planned', 'ref', 'template', 'abstract', 'undesigned', ...dataStereotypes]) {
    if (drawnBoxes.has(kind) && !legendBoxes.has(kind)) say('f', `${where} draws ${kind} boxes but the legend omits them`);
    if (!drawnBoxes.has(kind) && legendBoxes.has(kind)) say('f', `${where} legend lists ${kind} boxes that the page does not draw`);
  }
  return { page, boxes, lines };
}

// The words that say that a box is an interface. gen.mjs prints one of them on every interface box.
const INTERFACE_WORDS = ['interface', 'port'];

// checkOps runs check (e) and check (i) on one full class box.
// It returns the legend box kinds that the box draws: 'undesigned' and each data stereotype it shows.
function checkOps(cell, t, where, say, dataStereotypes) {
  if (!['class', 'interface', 'type', 'const', 'component'].includes(t.kind)) return [];
  const compartments = cell.label.split(/<hr\b[^>]*>/i);
  const head = labelText(compartments[0]);
  const marks = dataStereotypes.filter((m) => head.includes(`«${m}»`));
  const lines = compartments.length >= 3 ? labelText(compartments[2]).split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const undesigned = lines.includes(UNDESIGNED);
  const ops = lines.filter((l) => l !== UNDESIGNED);
  // (i) A class or interface box with no operation says why (professor, 2026-11-02).
  // A planned box shows «members not designed yet». A code class box shows «dataType» or a stereotype of the config.
  // A code interface box shows «interface» (team decision, 2026-11-24).
  // A port shows «port» in its place, because gen.mjs adds no «interface» to a port.
  if (t.kind === 'class' || t.kind === 'interface') {
    const planned = cell.data.status === 'planned' && cell.styleMap.dashed === '1';
    const said = marks.length || (t.kind === 'interface' && INTERFACE_WORDS.some((m) => head.includes(`«${m}»`)));
    if (!ops.length && !planned && !said) {
      const want = [...dataStereotypes, ...(t.kind === 'interface' ? INTERFACE_WORDS : [])];
      say('i', `${where} box "${t.id}" is a code ${t.kind} with no operation and no stereotype of ${want.map((m) => `«${m}»`).join(', ')}`);
    } else if (!ops.length && planned && !undesigned) say('i', `${where} planned box "${t.id}" has no operation and does not say "${UNDESIGNED}"`);
  }
  if (marks.length && ops.length) say('i', `${where} box "${t.id}" shows «${marks[0]}» but also operations`);
  if (undesigned && ops.length) say('i', `${where} box "${t.id}" says "${UNDESIGNED}" but shows operations`);
  if (undesigned && !['class', 'interface'].includes(t.kind)) say('i', `${where} box "${t.id}" of kind ${t.kind} says "${UNDESIGNED}"`);
  if (ops.length !== t.ops.length) {
    say('e', `${where} box "${t.id}" shows ${ops.length} operations, the model has ${t.ops.length}`);
  }
  for (const op of ops) {
    const problem = opProblem(op);
    if (problem) say('e', `${where} box "${t.id}" operation "${op}" ${problem} (rule 5)`);
  }
  return [...(undesigned ? ['undesigned'] : []), ...marks];
}

// ---------------------------------------------------------------- command line

// dataStereotypesOf reads the stereotypeFor map of a merge.mjs config and adds «dataType».
function dataStereotypesOf(configPath) {
  const cfg = configPath && existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  return [...new Set([DATA_TYPE, ...Object.values(cfg.stereotypeFor ?? {})])];
}

function main(argv) {
  if (argv.length !== 2 && argv.length !== 3) {
    console.error('usage: node check.mjs <file.drawio> <model.json> [<config.json>]');
    return 2;
  }
  const [file, modelPath, configArg] = argv;
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  const configPath = configArg ?? path.join(path.dirname(file), 'classes.config.json');
  const violations = check(readFileSync(file, 'utf8'), model, dataStereotypesOf(configPath));
  for (const v of violations) console.log(v);
  if (violations.length) {
    console.log(`${violations.length} violation(s) in ${file}`);
    return 1;
  }
  console.log(`ok: ${file} follows the notation rules (0 violations)`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
