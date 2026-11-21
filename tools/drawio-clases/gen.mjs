#!/usr/bin/env node
// gen.mjs turns one class model (MODEL.md) into one uncompressed multi-page .drawio file.
// Usage: node gen.mjs <model.json> <out.drawio>
// Page 1 shows every type in four layer bands. Each next page shows one part.
// The output has no timestamp and no random id, so one model always gives the same bytes.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Layer colors come from layers.md of both repositories.
const LAYERS = {
  4: { title: 'LAYER 4 · FRAMEWORKS AND DRIVERS', fill: '#cfdcf3', stroke: '#1e3a8a' },
  3: { title: 'LAYER 3 · INTERFACE ADAPTERS', fill: '#e2ebf8', stroke: '#1d4ed8' },
  2: { title: 'LAYER 2 · USE CASES', fill: '#efe7f8', stroke: '#7e22ce' },
  1: { title: 'LAYER 1 · ENTITIES', fill: '#f9f4dc', stroke: '#b45309' },
};
const LAYER_ORDER = [4, 3, 2, 1];

const INK = '#1f2937';
const PLANNED_STROKE = '#9ca3af';
const PLANNED_TEXT = '#6b7280';
const REF_FILL = '#e5e7eb';
const REF_STROKE = '#9ca3af';

const FONT = 12;
const SMALL = 11;
const LINE = 16;
const PAD_X = 10;
const HR = 9;
const EMPTY = 8;
// The gaps between boxes are the gutters where the lines run.
const GAP_X = 64;
const GAP_Y = 80;
const GROUP_LABEL = 28;
const GROUP_GAP_X = 96;
const GROUP_GAP_Y = 80;
const GROUP_MAX_W = 2600;
const PAGE_MAX_W = 5600;
const BAND_PAD = 48;
const BAND_TITLE = 56;
const BAND_GAP = 64;
const ORDER_SWEEPS = 4;
const ROUTE_MARGIN = 120;
const LEGEND_ROW = 20;
// The type parameter box covers only this much of the class box, so it hides no stereotype.
const TPARAMS_OVERLAP = 4;

const EDGE_BASE = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;fontSize=11;labelBackgroundColor=#ffffff;';
const EDGE_KIND = {
  use: 'endArrow=open;endSize=10;startArrow=none;',
  implements: 'endArrow=block;endFill=0;endSize=12;startArrow=none;dashed=1;',
  extends: 'endArrow=block;endFill=0;endSize=12;startArrow=none;',
  aggregation: 'startArrow=diamondThin;startFill=0;startSize=16;endArrow=none;',
  composition: 'startArrow=diamondThin;startFill=1;startSize=16;endArrow=none;',
};

// Legend rows. Each row names one line kind or one box kind (rule 13).
const LEGEND_LINES = {
  use: ['——&gt;', 'use: solid line, open arrowhead at the class it needs'],
  implements: ['- - -▷', 'implements: dashed line, hollow triangle'],
  extends: ['——▷', 'extends: solid line, hollow triangle'],
  aggregation: ['◇——', 'aggregation: hollow diamond at the holder, one layer'],
  composition: ['◆——', 'composition: filled diamond at the holder, one layer'],
  planned: ['grey', 'planned line: the label says planned'],
};
const LEGEND_BOXES = {
  code: ['▭', 'solid box: a type in the code'],
  planned: ['┅', 'dashed box: a planned type («planned», «Sprint N»)'],
  ref: ['▒', 'grey box: a type that another page details'],
  template: ['⌐', 'small dashed box: type parameters'],
  abstract: ['<i>A</i>', 'italic: abstract class or operation'],
  undesigned: ['∅', 'members not designed yet: a planned class that no view details'],
  dataType: ['«»', '«dataType»: a type in the code that only carries data'],
  module: ['«»', '«module»: a framework module that only holds decorator metadata'],
};
// A code type with no operation carries one of these stereotypes (merge.mjs). Each has a legend row.
const DATA_STEREOTYPES = ['dataType', 'module'];

// A planned class or interface that no view details shows this line instead of operations.
// The professor wants an operation in every class box (2026-11-02), and the tool does not invent one.
const UNDESIGNED = 'members not designed yet';
const isUndesigned = (t) => (t.kind === 'class' || t.kind === 'interface') && t.status === 'planned' && !(t.ops ?? []).length;

// ---------------------------------------------------------------- text helpers

const escXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// enc turns a type id into a safe cell id part. It keeps letters and digits and hex-codes the rest.
const enc = (s) => String(s).replace(/[^A-Za-z0-9]/g, (ch) => `_${ch.codePointAt(0).toString(16)}_`);

const NARROW = new Set("il.,:;|!'`");
const SEMI = new Set('fjrtI()[]{} -/');
const WIDE = new Set('mwMW@%');

// textWidth estimates the width of a Helvetica text. It errs on the wide side, so no label clips.
export function textWidth(text, size = FONT, bold = false) {
  let units = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) units += 0.3;
    else if (SEMI.has(ch)) units += 0.38;
    else if (WIDE.has(ch)) units += 0.9;
    else if (ch >= 'A' && ch <= 'Z') units += 0.72;
    else units += 0.6;
  }
  return Math.ceil(units * size * (bold ? 1.1 : 1));
}

// A label line keeps its HTML and its plain text. The plain text sets the width.
function line(text, { size = FONT, bold = false, italic = false, color = null } = {}) {
  let html = escHtml(text);
  if (bold) html = `<b>${html}</b>`;
  if (italic) html = `<i>${html}</i>`;
  if (size !== FONT || color) html = `<span style="${size !== FONT ? `font-size:${size}px;` : ''}${color ? `color:${color};` : ''}">${html}</span>`;
  return { html, width: textWidth(text, size, bold) };
}

// member prints one attribute or operation. A planned member starts with its «Sprint N» or «planned».
function member(text, m, { italic = false, underline = false } = {}) {
  let html = escHtml(text);
  if (underline) html = `<u>${html}</u>`;
  if (italic) html = `<i>${html}</i>`;
  let plain = text;
  if (m.planned) {
    const mark = `«${m.sprint ?? 'planned'}»`;
    html = `<span style="color:${PLANNED_TEXT};">${escHtml(mark)}</span> ${html}`;
    plain = `${mark} ${text}`;
  }
  return { html, width: textWidth(plain) };
}

function attrLine(a) {
  return member(`${a.vis} ${a.name}${a.optional ? '?' : ''}: ${a.type}`, a, { underline: a.static });
}

function opLine(o) {
  const sig = `${o.vis} ${o.name}(${o.params.join(', ')})`;
  return member(o.ret === null ? sig : `${sig}: ${o.ret}`, o, { italic: o.abstract, underline: o.static });
}

// ---------------------------------------------------------------- boxes

function stereotypeMarks(t) {
  const marks = [...(t.stereotypes ?? [])];
  const has = (s) => marks.includes(s);
  if (t.kind === 'interface' && !has('interface') && !has('port')) marks.push('interface');
  if (t.kind === 'union' && !has('union')) marks.push('union');
  if (t.kind === 'enum' && !has('enumeration')) marks.push('enumeration');
  if (t.kind === 'type' && !has('type')) marks.push('type');
  if (t.status === 'planned' && !has('planned')) marks.push('planned');
  if (t.sprint && !has(t.sprint)) marks.push(t.sprint);
  return marks;
}

// classBox builds the full UML box of one type: stereotypes, name and compartments.
function classBox(t) {
  const stroke = LAYERS[t.layer].stroke;
  const head = [];
  const marks = stereotypeMarks(t);
  if (marks.length) head.push(line(marks.map((m) => `«${m}»`).join(' '), { size: SMALL }));
  head.push(line(t.name, { bold: true, italic: t.abstract }));
  if (t.requirement) head.push(line(t.requirement, { size: SMALL, color: PLANNED_TEXT }));

  const compartments = [];
  if (t.kind === 'union' || t.kind === 'enum') {
    compartments.push((t.values ?? []).map((v) => line(v)));
  } else {
    const attrs = (t.attrs ?? []).map(attrLine);
    if (t.alias) attrs.unshift(line(`= ${t.alias}`));
    const ops = (t.ops ?? []).map(opLine);
    if (isUndesigned(t)) {
      ops.push({ html: `<span style="font-style:italic;color:${PLANNED_TEXT};">${UNDESIGNED}</span>`, width: textWidth(UNDESIGNED) });
    }
    compartments.push(attrs, ops);
  }

  const hr = `<hr style="margin:4px 0;border:none;border-top:1px solid ${stroke};">`;
  const block = (lines) =>
    lines.length
      ? `<div style="padding:0 ${PAD_X}px;line-height:${LINE}px;">${lines.map((l) => l.html).join('<br>')}</div>`
      : `<div style="height:${EMPTY}px;"></div>`;
  const label =
    `<div style="padding-top:4px;text-align:center;line-height:${LINE}px;">${head.map((l) => l.html).join('<br>')}</div>` +
    compartments.map((c) => hr + block(c)).join('');

  const all = [...head, ...compartments.flat()];
  const width = Math.max(120, Math.max(...all.map((l) => l.width)) + 2 * PAD_X + 12);
  const height = 4 + head.length * LINE + compartments.reduce((h, c) => h + HR + (c.length ? c.length * LINE : EMPTY), 0) + 8;

  let tparams = null;
  if (t.typeParams?.length) {
    const lines = t.typeParams.map((p) =>
      line(`${p.name}${p.constraint ? ` extends ${p.constraint}` : ''}${p.default ? ` = ${p.default}` : ''}`, { size: SMALL }),
    );
    tparams = {
      label: `<div style="line-height:14px;">${lines.map((l) => l.html).join('<br>')}</div>`,
      w: Math.max(...lines.map((l) => l.width)) + 18,
      h: lines.length * 14 + 10,
    };
  }
  return { label, w: Math.ceil(width), h: Math.ceil(height), tparams };
}

// refBox builds the name-only box of a type that another page details.
function refBox(t, eyebrow) {
  const label =
    `<div style="font-size:9px;line-height:12px;letter-spacing:0.5px;color:#4b5563;">${escHtml(eyebrow)}</div>` +
    `<div style="line-height:${LINE}px;"><b>${escHtml(t.name)}</b></div>`;
  const w = Math.max(textWidth(eyebrow, 9) + eyebrow.length * 0.5, textWidth(t.name, FONT, true)) + 28;
  return { label, w: Math.ceil(Math.max(110, w)), h: 46, tparams: null };
}

// ---------------------------------------------------------------- layout

// shelf places items left to right and starts a new row at maxW.
// Each item has w, h, top (space above it) and right (space after it).
// gapOf(a, b) can widen the gap between two neighbours in a row. It never returns less than gapX.
function shelf(items, maxW, gapX, gapY, gapOf = null) {
  let x = 0;
  let y = 0;
  let row = [];
  let rowH = 0;
  let rowTop = 0;
  let width = 0;
  const flush = () => {
    for (const it of row) it.y = y + rowTop;
    width = Math.max(width, x);
    y += rowTop + rowH + gapY;
    x = 0;
    row = [];
    rowH = 0;
    rowTop = 0;
  };
  for (const it of items) {
    const gapTo = (prev) => (gapOf ? Math.max(gapX, gapOf(prev, it)) : gapX);
    if (row.length && x + gapTo(row[row.length - 1]) + it.w + (it.right ?? 0) > maxW) flush();
    it.x = row.length ? x + gapTo(row[row.length - 1]) : 0;
    x = it.x + it.w + (it.right ?? 0);
    row.push(it);
    rowH = Math.max(rowH, it.h);
    rowTop = Math.max(rowTop, it.top ?? 0);
  }
  if (row.length) flush();
  return { width: Math.max(0, width), height: Math.max(0, y - gapY) };
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const cmpList = (a, b) => {
  for (let k = 0; k < a.length; k += 1) {
    const c = typeof a[k] === 'number' ? a[k] - b[k] : cmp(a[k], b[k]);
    if (c) return c;
  }
  return 0;
};
const dirname = (file) => file.split('/').slice(0, -1).join('/') || '.';

// buildBands sorts the entries of one page into bands and groups, and measures each box.
// entries: [{ type, role: 'class' | 'ref', eyebrow }].
function buildBands(entries, ctx, allLayers) {
  const bands = [];
  for (const layer of LAYER_ORDER) {
    const inLayer = entries.filter((e) => e.type.layer === layer);
    if (!inLayer.length && !allLayers) continue;
    const groups = new Map();
    for (const e of inLayer) {
      const t = e.type;
      const pi = ctx.partIndex.get(t.part);
      const part = ctx.model.parts[pi];
      let key;
      let sort;
      let label;
      if (e.role === 'ref') {
        key = `ref|${t.part}`;
        sort = [1, pi, ''];
        label = `${part.title} · detailed on page ${pi + 2}`;
      } else if (t.file) {
        const folder = dirname(t.file);
        key = `${t.part}|${folder}`;
        sort = [0, pi, folder];
        label = `${part.title} · ${folder}`;
      } else {
        key = `${t.part}|planned`;
        sort = [0, pi, '￿'];
        label = `${part.title} · planned`;
      }
      if (!groups.has(key)) groups.set(key, { key, sort, label, entries: [] });
      groups.get(key).entries.push(e);
    }
    const list = [...groups.values()].sort((a, b) => cmpList(a.sort, b.sort));
    for (const g of list) {
      g.entries.sort((a, b) => cmpList([a.type.file ?? '￿', a.type.name, a.type.id], [b.type.file ?? '￿', b.type.name, b.type.id]));
      g.items = g.entries.map((e) => {
        const box = e.role === 'ref' ? refBox(e.type, e.eyebrow) : classBox(e.type);
        return { entry: e, box, w: box.w, h: box.h, top: box.tparams ? box.tparams.h - TPARAMS_OVERLAP : 0, right: box.tparams ? 14 : 0 };
      });
      const maxW = Math.max(...g.items.map((it) => it.w + it.right));
      const area = g.items.reduce((s, it) => s + (it.w + it.right + GAP_X) * (it.h + it.top + GAP_Y), 0);
      g.limit = Math.max(maxW, textWidth(g.label, FONT, true), Math.min(GROUP_MAX_W, Math.sqrt(area * 3.5)));
    }
    bands.push({ layer, groups: list });
  }
  return bands;
}

// placeBands places the groups in their bands and gives every box its page position (ax, ay).
// All bands of a page have the same width. The first band starts at y = top.
function placeBands(bands, top, innerHint, gapOf = null) {
  for (const band of bands) {
    for (const g of band.groups) {
      const size = shelf(g.items, g.limit, GAP_X, GAP_Y, gapOf);
      g.w = Math.max(size.width, textWidth(g.label, FONT, true) + 10);
      g.h = GROUP_LABEL + size.height;
    }
  }
  let inner = innerHint;
  if (inner === undefined) {
    const groups = bands.flatMap((b) => b.groups);
    const widest = Math.max(800, ...groups.map((g) => g.w));
    const area = groups.reduce((s, g) => s + (g.w + GROUP_GAP_X) * (g.h + GROUP_GAP_Y), 0);
    inner = Math.ceil(Math.max(widest, Math.min(PAGE_MAX_W, Math.sqrt(area * 1.6))));
  }
  let width = inner;
  let y = top;
  for (const band of bands) {
    const size = shelf(band.groups, inner, GROUP_GAP_X, GROUP_GAP_Y);
    width = Math.max(width, size.width);
    band.y = y;
    band.h = BAND_TITLE + (band.groups.length ? size.height : 20) + BAND_PAD;
    for (const g of band.groups) {
      g.ax = BAND_PAD + g.x;
      g.ay = y + BAND_TITLE + g.y;
      for (const it of g.items) {
        it.ax = g.ax + it.x;
        it.ay = g.ay + GROUP_LABEL + it.y;
      }
    }
    y += band.h + BAND_GAP;
  }
  for (const band of bands) band.w = width + 2 * BAND_PAD;
  return { inner, width: width + 2 * BAND_PAD, bottom: y - BAND_GAP };
}

// orderByLines moves connected boxes near each other. Bands and groups keep their places.
// Two neighbours in a row that share a labelled line get a gap wide enough for the label.
// Each sweep sorts the boxes of a group by the mean position of the boxes that they share a line with.
// The mean y sets the rows. The mean x sets the order inside a row.
function orderByLines(bands, edges, top) {
  const items = new Map();
  for (const band of bands) for (const g of band.groups) for (const it of g.items) items.set(it.entry.type.id, it);
  const near = new Map();
  for (const e of edges) {
    if (e.from === e.to) continue;
    for (const [a, b] of [
      [e.from, e.to],
      [e.to, e.from],
    ]) {
      if (!near.has(a)) near.set(a, []);
      near.get(a).push(b);
    }
  }
  const idOf = (it) => it.entry.type.id;
  const wide = new Map();
  for (const e of edges) {
    const text = edgeLabel(e);
    if (!text || e.from === e.to) continue;
    const need = textWidth(text, 11) + 8 + 2 * LABEL_END + 2 * GRID;
    for (const k of [`${e.from}|${e.to}`, `${e.to}|${e.from}`]) wide.set(k, Math.max(wide.get(k) ?? 0, need));
  }
  const gapOf = (a, b) => wide.get(`${idOf(a)}|${idOf(b)}`) ?? 0;
  const cx = (it) => it.ax + it.w / 2;
  const cy = (it) => it.ay + it.h / 2;
  let placed = placeBands(bands, top, undefined, gapOf);
  for (let sweep = 0; sweep < ORDER_SWEEPS; sweep += 1) {
    for (const band of bands) {
      for (const g of band.groups) {
        if (g.items.length < 2) continue;
        for (const it of g.items) {
          const others = (near.get(idOf(it)) ?? []).map((id) => items.get(id)).filter(Boolean);
          it.bx = others.length ? others.reduce((s, o) => s + cx(o), 0) / others.length : cx(it);
          it.by = others.length ? others.reduce((s, o) => s + cy(o), 0) / others.length : cy(it);
        }
        const byY = [...g.items].sort((a, b) => a.by - b.by || a.bx - b.bx || cmp(idOf(a), idOf(b)));
        shelf(byY, g.limit, GAP_X, GAP_Y, gapOf);
        const rows = new Map();
        for (const it of byY) {
          if (!rows.has(it.y)) rows.set(it.y, []);
          rows.get(it.y).push(it);
        }
        g.items = [...rows.values()].flatMap((row) => row.sort((a, b) => a.bx - b.bx || cmp(idOf(a), idOf(b))));
      }
    }
    placed = placeBands(bands, top, placed.inner, gapOf);
  }
  return placed;
}

// ---------------------------------------------------------------- routing

// The router walks a grid of points in the free space around the boxes.
// Each line leaves its source on one side, runs only through gutters and enters its target on one side.
// A line pays for each step, each bend and each step on a track that another line already uses.
// So parallel lines take distinct tracks, and the shortest clean path wins.
const GRID = 8;
const CLEAR = 8;
const STUB = 24;
// A label keeps this distance from both ends, so it never covers an arrowhead or a diamond.
const LABEL_END = 16;
const PORT_MARGIN = 10;
const COST_BEND = 24;
const COST_SHARE = 48;
const COST_BESIDE = 6;
const COST_CROSS = 4;
const COST_SOFT = 14;
const COST_PORT = 400;
const COST_PORT_BESIDE = 60;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

// Heap is a binary min-heap. Equal keys leave in push order, so the routes do not change between runs.
class Heap {
  constructor() {
    this.f = [];
    this.n = [];
    this.v = [];
    this.seq = 0;
  }

  get size() {
    return this.v.length;
  }

  less(a, b) {
    return this.f[a] < this.f[b] || (this.f[a] === this.f[b] && this.n[a] < this.n[b]);
  }

  swap(a, b) {
    const { f, n, v } = this;
    [f[a], f[b]] = [f[b], f[a]];
    [n[a], n[b]] = [n[b], n[a]];
    [v[a], v[b]] = [v[b], v[a]];
  }

  push(key, value) {
    let i = this.v.length;
    this.f.push(key);
    this.n.push(this.seq);
    this.seq += 1;
    this.v.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop() {
    const top = { key: this.f[0], value: this.v[0] };
    const f = this.f.pop();
    const n = this.n.pop();
    const v = this.v.pop();
    if (this.v.length) {
      this.f[0] = f;
      this.n[0] = n;
      this.v[0] = v;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.v.length && this.less(l, m)) m = l;
        if (r < this.v.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

const hits = (a, b, r, pad) =>
  Math.max(a.x, b.x) > r.x - pad && Math.min(a.x, b.x) < r.x + r.w + pad && Math.max(a.y, b.y) > r.y - pad && Math.min(a.y, b.y) < r.y + r.h + pad;
// overlapArea ignores a touch of 1 pixel or less, as render.mjs does when it counts labels on boxes.
const overlapArea = (a, b) => {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > 1 && oy > 1 ? ox * oy : 0;
};

// labelForms returns the label on one line, and also wrapped after each ", " and before each " · ".
function labelForms(text) {
  const forms = [[text]];
  const lines = text.replace(/, /g, ',\n').replace(/ · /g, '\n· ').split('\n');
  if (lines.length > 1) forms.push(lines);
  return forms;
}

// simplify drops repeated points and points in the middle of a straight run.
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

// routeEdges gives each edge a fixed exit, a fixed entry and waypoints in the gutters.
// rects: type id -> box. hard: boxes, type parameter boxes and the legend; no line enters them.
// soft: band titles and group labels; a line can cross them at a cost.
function routeEdges(edges, rects, hard, soft, bounds) {
  const ox = bounds.x;
  const oy = bounds.y;
  const nx = Math.floor(bounds.w / GRID) + 1;
  const ny = Math.floor(bounds.h / GRID) + 1;
  const size = nx * ny;
  const blocked = new Uint8Array(size);
  const softCost = new Uint16Array(size);
  const hUse = new Uint16Array(size);
  const vUse = new Uint16Array(size);
  const each = (r, pad, fn) => {
    const i0 = Math.max(0, Math.ceil((r.x - pad - ox) / GRID));
    const i1 = Math.min(nx - 1, Math.floor((r.x + r.w + pad - ox) / GRID));
    const j0 = Math.max(0, Math.ceil((r.y - pad - oy) / GRID));
    const j1 = Math.min(ny - 1, Math.floor((r.y + r.h + pad - oy) / GRID));
    for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) fn(j * nx + i);
  };
  for (const r of hard) each(r, CLEAR, (k) => (blocked[k] = 1));
  for (const r of soft) each(r, 2, (k) => (softCost[k] = COST_SOFT));
  const g = new Float64Array(size * 4);
  const from = new Int32Array(size * 4);
  const stamp = new Uint32Array(size * 4);
  let run = 0;
  const portUse = new Map();
  const portCache = new Map();
  const xOf = (node) => ox + (node % nx) * GRID;
  const yOf = (node) => oy + Math.floor(node / nx) * GRID;

  // portsOf lists the places where a line can leave or enter a box.
  // A port is a grid point STUB away from one side. The stub to the side must touch no other box.
  const portsOf = (id) => {
    if (portCache.has(id)) return portCache.get(id);
    const rect = rects.get(id);
    const others = hard.filter((h) => !(h.owner === id && h.kind === 'box'));
    const out = [];
    const add = (side, dir, i, j, ex, ey) => {
      if (i < 0 || j < 0 || i >= nx || j >= ny) return;
      const node = j * nx + i;
      if (blocked[node]) return;
      const a = { x: ex, y: ey };
      const b = { x: xOf(node), y: yOf(node) };
      if (others.some((h) => hits(a, b, h, 2))) return;
      const idx = side === 'top' || side === 'bottom' ? i : j;
      out.push({
        side,
        dir,
        node,
        ex,
        ey,
        fx: (ex - rect.x) / rect.w,
        fy: (ey - rect.y) / rect.h,
        key: `${id}|${side}|${idx}`,
        near: [-2, -1, 1, 2].map((d) => `${id}|${side}|${idx + d}`),
      });
    };
    const i0 = Math.ceil((rect.x + PORT_MARGIN - ox) / GRID);
    const i1 = Math.floor((rect.x + rect.w - PORT_MARGIN - ox) / GRID);
    const j0 = Math.ceil((rect.y + PORT_MARGIN - oy) / GRID);
    const j1 = Math.floor((rect.y + rect.h - PORT_MARGIN - oy) / GRID);
    const top = Math.floor((rect.y - STUB - oy) / GRID);
    const bottom = Math.ceil((rect.y + rect.h + STUB - oy) / GRID);
    const left = Math.floor((rect.x - STUB - ox) / GRID);
    const right = Math.ceil((rect.x + rect.w + STUB - ox) / GRID);
    for (let i = i0; i <= i1; i += 1) {
      add('top', 3, i, top, ox + i * GRID, rect.y);
      add('bottom', 1, i, bottom, ox + i * GRID, rect.y + rect.h);
    }
    for (let j = j0; j <= j1; j += 1) {
      add('left', 2, left, j, rect.x, oy + j * GRID);
      add('right', 0, right, j, rect.x + rect.w, oy + j * GRID);
    }
    portCache.set(id, out);
    return out;
  };
  const portCost = (p) => (portUse.get(p.key) ?? 0) * COST_PORT + p.near.reduce((s, k) => s + (portUse.get(k) ?? 0), 0) * COST_PORT_BESIDE;

  // search runs A* from the start ports to the goal ports.
  const search = (starts, goals, target) => {
    run += 1;
    const heap = new Heap();
    const goalAt = new Map(goals.map((p, k) => [p.node, k]));
    const termCost = new Float64Array(goals.length).fill(Infinity);
    const termFrom = new Int32Array(goals.length);
    const h = (node) => {
      const x = xOf(node);
      const y = yOf(node);
      return Math.max(0, target.x - STUB - x, x - target.x - target.w - STUB) + Math.max(0, target.y - STUB - y, y - target.y - target.h - STUB);
    };
    starts.forEach((p, k) => {
      const s = p.node * 4 + p.dir;
      const cost = portCost(p);
      if (stamp[s] === run && g[s] <= cost) return;
      stamp[s] = run;
      g[s] = cost;
      from[s] = -1 - k;
      heap.push(cost + h(p.node), s);
    });
    while (heap.size) {
      const { key, value: s } = heap.pop();
      if (s < 0) {
        const k = -1 - s;
        if (key > termCost[k]) continue;
        const nodes = [];
        let cur = termFrom[k];
        let start;
        for (;;) {
          nodes.push(cur >> 2);
          const prev = from[cur];
          if (prev < 0) {
            start = starts[-1 - prev];
            break;
          }
          cur = prev;
        }
        nodes.reverse();
        return { start, goal: goals[k], nodes };
      }
      const node = s >> 2;
      const dir = s & 3;
      const gs = g[s];
      if (key > gs + h(node) + 1e-9) continue;
      const k = goalAt.get(node);
      if (k !== undefined) {
        const p = goals[k];
        const c = gs + (dir === ((p.dir + 2) & 3) ? 0 : COST_BEND) + portCost(p);
        if (c < termCost[k]) {
          termCost[k] = c;
          termFrom[k] = s;
          heap.push(c, -1 - k);
        }
      }
      const i = node % nx;
      const j = (node - i) / nx;
      for (let nd = 0; nd < 4; nd += 1) {
        if (nd === ((dir + 2) & 3)) continue;
        const ni = i + DX[nd];
        const nj = j + DY[nd];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        const nn = nj * nx + ni;
        if (blocked[nn]) continue;
        let c = gs + GRID + softCost[nn] + (nd !== dir ? COST_BEND : 0);
        if (nd === 0 || nd === 2) {
          c += hUse[nn] * COST_SHARE + ((nj > 0 ? hUse[nn - nx] : 0) + (nj < ny - 1 ? hUse[nn + nx] : 0)) * COST_BESIDE + vUse[nn] * COST_CROSS;
        } else {
          c += vUse[nn] * COST_SHARE + ((ni > 0 ? vUse[nn - 1] : 0) + (ni < nx - 1 ? vUse[nn + 1] : 0)) * COST_BESIDE + hUse[nn] * COST_CROSS;
        }
        const ns = nn * 4 + nd;
        if (stamp[ns] === run && g[ns] <= c) continue;
        stamp[ns] = run;
        g[ns] = c;
        from[ns] = s;
        heap.push(c + h(nn), ns);
      }
    }
    return null;
  };

  // Short lines go first, so they keep the straight tracks.
  const keyOf = (e) => `${e.from}|${e.to}|${e.kind}`;
  const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const order = [...edges].sort((a, b) => {
    const da = Math.abs(center(rects.get(a.from)).x - center(rects.get(a.to)).x) + Math.abs(center(rects.get(a.from)).y - center(rects.get(a.to)).y);
    const db = Math.abs(center(rects.get(b.from)).x - center(rects.get(b.to)).x) + Math.abs(center(rects.get(b.from)).y - center(rects.get(b.to)).y);
    return da - db || cmp(keyOf(a), keyOf(b));
  });
  const routes = new Map();
  const failed = [];
  for (const e of order) {
    // A line from a box to itself leaves on the right side and comes back on the top side.
    const self = e.from === e.to;
    const starts = portsOf(e.from).filter((p) => !self || p.side === 'right');
    const goals = portsOf(e.to).filter((p) => !self || p.side === 'top');
    const found = starts.length && goals.length ? search(starts, goals, rects.get(e.to)) : null;
    if (!found) {
      failed.push(keyOf(e));
      continue;
    }
    for (const p of [found.start, found.goal]) portUse.set(p.key, (portUse.get(p.key) ?? 0) + 1);
    const hSet = new Set();
    const vSet = new Set();
    for (let k = 1; k < found.nodes.length; k += 1) {
      const a = found.nodes[k - 1];
      const b = found.nodes[k];
      const set = Math.abs(a - b) === 1 ? hSet : vSet;
      set.add(a);
      set.add(b);
    }
    for (const n of hSet) hUse[n] += 1;
    for (const n of vSet) vUse[n] += 1;
    const pts = simplify([{ x: found.start.ex, y: found.start.ey }, ...found.nodes.map((n) => ({ x: xOf(n), y: yOf(n) })), { x: found.goal.ex, y: found.goal.ey }]);
    routes.set(keyOf(e), { exit: found.start, entry: found.goal, pts });
  }
  if (failed.length) throw new Error(`no free path for ${failed.join(', ')}`);
  return routes;
}

// bestSpot scans one label form along a line and returns its best place.
// A place on a box costs most, a place on a title or another label costs less.
// A place far from the wanted fraction, beside the line, on a vertical segment or in a wrapped form costs a little.
function bestSpot(pts, want, lines, form, boxes, titles, placed) {
  const w = Math.max(...lines.map((l) => textWidth(l, 11))) + 8;
  const h = lines.length * 14 + 2;
  const lens = pts.slice(1).map((p, k) => Math.abs(p.x - pts[k].x) + Math.abs(p.y - pts[k].y));
  const total = lens.reduce((a, b) => a + b, 0);
  let best = null;
  let walked = 0;
  lens.forEach((len, k) => {
    const flat = pts[k].y === pts[k + 1].y;
    const shifts = flat
      ? [[0, 0], [0, -(h / 2 + 3)], [0, h / 2 + 3]]
      : [[0, 0], [w / 2 + 4, 0], [-(w / 2 + 4), 0]];
    for (let d = 0; d <= len; d += 4) {
      const s = walked + d;
      if (s < LABEL_END || total - s < LABEL_END) continue;
      const r = len ? d / len : 0;
      const x = pts[k].x + (pts[k + 1].x - pts[k].x) * r;
      const y = pts[k].y + (pts[k + 1].y - pts[k].y) * r;
      for (const [dx, dy] of shifts) {
        const rect = { x: x + dx - w / 2, y: y + dy - h / 2, w, h };
        const onBox = boxes.reduce((a, b) => a + overlapArea(rect, b), 0);
        const onLabel = titles.reduce((a, b) => a + overlapArea(rect, b), 0) + placed.reduce((a, b) => a + overlapArea(rect, b), 0);
        const score =
          (onBox ? 1e6 + onBox : 0) + (onLabel ? 1000 + onLabel : 0) + Math.abs(s / total - want) + (flat ? 0 : 0.2) + (dx || dy ? 0.3 : 0) + form * 0.5;
        if (!best || score < best.score) best = { score, s, total, rect, onBox, onLabel, dx, dy, lines };
      }
    }
    walked += len;
  });
  return best;
}

// placeLabels puts each line label on a segment of its own line, clear of every box and every other label.
// A label can also sit just beside a vertical segment, or just above or below a horizontal one.
// A label that finds no clear place on one line can wrap after each ", " and before each " · ".
// A use label sits near the middle. A diamond label sits near the far end, where it names the attribute.
// It counts the labels that touch a box and the labels that touch another label or a title.
function placeLabels(edges, routes, hard, soft, labelOf, stats) {
  const placed = [];
  const titles = [...soft, ...hard.filter((r) => r.kind === 'other')];
  const boxes = hard.filter((r) => r.kind !== 'other');
  for (const e of edges) {
    const route = routes.get(`${e.from}|${e.to}|${e.kind}`);
    const text = labelOf(e);
    route.labelX = null;
    if (!text) continue;
    const want = e.kind === 'aggregation' || e.kind === 'composition' ? 0.8 : 0.5;
    let best = null;
    for (const [form, lines] of labelForms(text).entries()) {
      const spot = bestSpot(route.pts, want, lines, form, boxes, titles, placed);
      if (spot && (!best || spot.score < best.score)) best = spot;
    }
    if (!best) best = { s: 0, total: 0, rect: null, onBox: 0, onLabel: 0, dx: 0, dy: 0, lines: [text] };
    if (best.rect) placed.push(best.rect);
    if (best.onBox) stats.labelsOnBoxes += 1;
    else if (best.onLabel) stats.labelsOnLabels += 1;
    route.labelX = best.total ? (2 * best.s) / best.total - 1 : 0;
    route.labelOffset = { x: best.dx, y: best.dy };
    route.labelLines = best.lines;
  }
}

// ---------------------------------------------------------------- cells

function vertexXml({ id, label, style, parent, x, y, w, h, data }) {
  const geo = `<mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" as="geometry"/>`;
  if (!data) {
    return `<mxCell id="${escXml(id)}" value="${escXml(label)}" style="${style}" vertex="1" parent="${escXml(parent)}">${geo}</mxCell>`;
  }
  const attrs = Object.entries(data)
    .map(([k, v]) => ` ${k}="${escXml(v)}"`)
    .join('');
  return `<object id="${escXml(id)}" label="${escXml(label)}"${attrs}><mxCell style="${style}" vertex="1" parent="${escXml(parent)}">${geo}</mxCell></object>`;
}

const fmt = (v) => String(Math.round(v * 1e6) / 1e6);
const edgeLabel = (e) => (e.status === 'planned' ? (e.label ? `${e.label} · planned` : 'planned') : (e.label ?? ''));

// edgeXml writes one line with its fixed exit, fixed entry, waypoints and label position.
// draw.io follows the waypoints of an orthogonal edge, so it draws the same path as the router.
function edgeXml(pid, e, cellOf, route) {
  const planned = e.status === 'planned';
  const color = planned ? `strokeColor=${PLANNED_STROKE};fontColor=${PLANNED_TEXT};` : `strokeColor=${INK};fontColor=${INK};`;
  const ends =
    `exitX=${fmt(route.exit.fx)};exitY=${fmt(route.exit.fy)};exitDx=0;exitDy=0;exitPerimeter=0;` +
    `entryX=${fmt(route.entry.fx)};entryY=${fmt(route.entry.fy)};entryDx=0;entryDy=0;entryPerimeter=0;`;
  const style = EDGE_BASE + EDGE_KIND[e.kind] + color + ends;
  const label = edgeLabel(e);
  const labelHtml = (route.labelLines ?? [label]).map(escHtml).join('<br>');
  let inner = route.pts.slice(1, -1);
  if (!inner.length) {
    // A straight line still gets one waypoint, in its middle.
    const [a, b] = [route.pts[0], route.pts[route.pts.length - 1]];
    inner = [{ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) }];
  }
  const points = inner.map((p) => `<mxPoint x="${p.x}" y="${p.y}"/>`).join('');
  const labelAt = label && route.labelX !== null ? ` x="${fmt(route.labelX)}"` : '';
  const shift = label && route.labelOffset && (route.labelOffset.x || route.labelOffset.y);
  const offset = shift ? `<mxPoint x="${fmt(route.labelOffset.x)}" y="${fmt(route.labelOffset.y)}" as="offset"/>` : '';
  const geo = `<mxGeometry${labelAt} relative="1" as="geometry"><Array as="points">${points}</Array>${offset}</mxGeometry>`;
  const id = `${pid}~edge-${enc(e.from)}-${enc(e.to)}-${e.kind}`;
  return `<mxCell id="${escXml(id)}" value="${escXml(labelHtml)}" style="${style}" edge="1" parent="1" source="${escXml(cellOf(e.from))}" target="${escXml(cellOf(e.to))}">${geo}</mxCell>`;
}

function legendCells(pid, lineKinds, boxKinds, y) {
  const rows = (table, kinds, role) =>
    Object.keys(table)
      .filter((k) => kinds.has(k))
      .map((kind) => {
        const [glyph, text] = table[kind];
        const plainGlyph = glyph.replace(/<[^>]*>/g, '').replace(/&gt;/g, '>');
        return {
          kind,
          role,
          label: `<span style="font-family:monospace;">${glyph}</span>&nbsp;&nbsp;${escHtml(text)}`,
          w: textWidth(plainGlyph, FONT) + textWidth(text, FONT) + 40,
        };
      });
  const left = rows(LEGEND_LINES, lineKinds, 'legend-line');
  const right = rows(LEGEND_BOXES, boxKinds, 'legend-box');
  const colW = (col) => Math.max(120, ...col.map((r) => r.w));
  const lw = colW(left);
  const rw = colW(right);
  const height = 30 + Math.max(left.length, right.length, 1) * LEGEND_ROW + 10;
  const width = 12 + lw + 30 + rw + 12;
  const cells = [
    vertexXml({
      id: `${pid}~legend`,
      label: 'LEGEND',
      style: 'rounded=0;html=1;whiteSpace=wrap;fillColor=#ffffff;strokeColor=#d1d5db;verticalAlign=top;align=left;spacingLeft=10;spacingTop=4;fontStyle=1;fontSize=12;fontColor=#374151;container=1;collapsible=0;',
      parent: '1',
      x: 0,
      y,
      w: width,
      h: height,
      data: { role: 'legend' },
    }),
  ];
  const textStyle = 'text;html=1;whiteSpace=nowrap;align=left;verticalAlign=middle;fontSize=12;fontColor=#1f2937;strokeColor=none;fillColor=none;';
  for (const [col, x, w] of [
    [left, 12, lw],
    [right, 12 + lw + 30, rw],
  ]) {
    col.forEach((r, k) => {
      cells.push(
        vertexXml({
          id: `${pid}~${r.role}-${r.kind}`,
          label: r.label,
          style: textStyle,
          parent: `${pid}~legend`,
          x,
          y: 30 + k * LEGEND_ROW,
          w,
          h: LEGEND_ROW,
          data: { role: r.role, kind: r.kind },
        }),
      );
    });
  }
  return { cells, height, width };
}

// pageXml writes one <diagram>. The title and the legend come first, then the bands, then the lines.
function pageXml(pid, name, title, entries, ctx, allLayers, stats) {
  const shown = new Set(entries.map((e) => e.type.id));
  const cellOf = (typeId) => `${pid}~type-${enc(typeId)}`;
  const edges = ctx.model.edges.filter((e) => shown.has(e.from) && shown.has(e.to));

  const lineKinds = new Set(edges.map((e) => e.kind));
  if (edges.some((e) => e.status === 'planned')) lineKinds.add('planned');
  const boxKinds = new Set();
  for (const e of entries) {
    if (e.role === 'ref') boxKinds.add('ref');
    else boxKinds.add(e.type.status === 'planned' ? 'planned' : 'code');
    if (e.role === 'class' && e.type.typeParams?.length) boxKinds.add('template');
    if (e.role === 'class' && (e.type.abstract || (e.type.ops ?? []).some((o) => o.abstract))) boxKinds.add('abstract');
    if (e.role === 'class' && isUndesigned(e.type)) boxKinds.add('undesigned');
    for (const m of DATA_STEREOTYPES) if (e.role === 'class' && (e.type.stereotypes ?? []).includes(m)) boxKinds.add(m);
  }

  const cells = [];
  const titleW = textWidth(title, 20, true) + 20;
  cells.push(
    vertexXml({
      id: `${pid}~title`,
      label: escHtml(title),
      style: 'text;html=1;whiteSpace=nowrap;align=left;verticalAlign=middle;fontSize=20;fontStyle=1;fontColor=#111827;strokeColor=none;fillColor=none;',
      parent: '1',
      x: 0,
      y: 0,
      w: titleW,
      h: 32,
    }),
  );
  const legend = legendCells(pid, lineKinds, boxKinds, 44);
  cells.push(...legend.cells);

  const top = 44 + legend.height + 40;
  const bands = buildBands(entries, ctx, allLayers);
  const placed = orderByLines(bands, edges, top);

  const rects = new Map();
  const hard = [
    { x: 0, y: 0, w: titleW, h: 32, owner: null, kind: 'other' },
    { x: 0, y: 44, w: legend.width, h: legend.height, owner: null, kind: 'other' },
  ];
  const soft = [];
  for (const band of bands) {
    const layer = LAYERS[band.layer];
    const bandId = `${pid}~band-${band.layer}`;
    const bandLabel = band.groups.length ? layer.title : `${layer.title} · no types`;
    soft.push({ x: 0, y: band.y, w: textWidth(bandLabel, 16, true) + 30, h: BAND_TITLE - 8 });
    cells.push(
      vertexXml({
        id: bandId,
        label: bandLabel,
        style: `rounded=0;html=1;whiteSpace=wrap;fillColor=${layer.fill};strokeColor=${layer.stroke};strokeWidth=2;fontColor=${layer.stroke};fontSize=16;fontStyle=1;verticalAlign=top;align=left;spacingLeft=14;spacingTop=8;container=1;collapsible=0;`,
        parent: '1',
        x: 0,
        y: band.y,
        w: band.w,
        h: band.h,
        data: { role: 'band', layer: band.layer },
      }),
    );
    for (const g of band.groups) {
      soft.push({ x: g.ax, y: g.ay, w: textWidth(g.label, FONT, true) + 10, h: 20 });
      cells.push(
        vertexXml({
          id: `${pid}~group-${enc(g.key)}`,
          label: escHtml(g.label),
          style: `text;html=1;whiteSpace=nowrap;align=left;verticalAlign=top;fontSize=12;fontStyle=1;fontColor=${layer.stroke};strokeColor=none;fillColor=none;`,
          parent: bandId,
          x: g.ax,
          y: g.ay - band.y,
          w: g.w,
          h: 20,
          data: { role: 'group' },
        }),
      );
      for (const it of g.items) {
        const t = it.entry.type;
        const isRef = it.entry.role === 'ref';
        const rect = { x: it.ax, y: it.ay, w: it.w, h: it.h, owner: t.id, kind: 'box' };
        rects.set(t.id, rect);
        hard.push(rect);
        const style = isRef
          ? `rounded=0;whiteSpace=wrap;html=1;fillColor=${REF_FILL};strokeColor=${REF_STROKE};fontColor=#111827;align=center;verticalAlign=middle;fontSize=12;`
          : `rounded=0;whiteSpace=wrap;html=1;overflow=fill;verticalAlign=top;align=left;spacing=0;fontSize=12;fontColor=#111827;fillColor=#ffffff;strokeColor=${layer.stroke};strokeWidth=1.5;${t.status === 'planned' ? 'dashed=1;' : ''}`;
        const data = { role: isRef ? 'ref' : 'class', typeId: t.id, kind: t.kind, status: t.status, layer: t.layer };
        cells.push(vertexXml({ id: cellOf(t.id), label: it.box.label, style, parent: bandId, x: it.ax, y: it.ay - band.y, w: it.w, h: it.h, data }));
        if (it.box.tparams) {
          const tp = it.box.tparams;
          const tx = it.w - tp.w + 14;
          const ty = -(tp.h - TPARAMS_OVERLAP);
          hard.push({ x: it.ax + tx, y: it.ay + ty, w: tp.w, h: tp.h, owner: t.id, kind: 'tparams' });
          cells.push(
            vertexXml({
              id: `${pid}~tparams-${enc(t.id)}`,
              label: tp.label,
              style: `rounded=0;html=1;whiteSpace=nowrap;dashed=1;fillColor=#ffffff;strokeColor=${layer.stroke};fontSize=11;fontColor=#111827;align=left;verticalAlign=top;spacingLeft=6;spacingTop=3;spacing=0;`,
              parent: cellOf(t.id),
              x: tx,
              y: ty,
              w: tp.w,
              h: tp.h,
              data: { role: 'tparams', typeId: t.id },
            }),
          );
        }
      }
    }
  }

  const pageW = Math.max(placed.width, legend.width, titleW, 800);
  const bounds = { x: -ROUTE_MARGIN, y: -ROUTE_MARGIN, w: pageW + 2 * ROUTE_MARGIN, h: placed.bottom + 2 * ROUTE_MARGIN };
  const routes = routeEdges(edges, rects, hard, soft, bounds);
  placeLabels(edges, routes, hard, soft, edgeLabel, stats);
  for (const e of edges) cells.push(edgeXml(pid, e, cellOf, routes.get(`${e.from}|${e.to}|${e.kind}`)));

  return [
    `  <diagram id="${escXml(pid)}" name="${escXml(name)}">`,
    `    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="${pageW}" pageHeight="${Math.round(placed.bottom)}" math="0" shadow="0">`,
    '      <root>',
    '        <mxCell id="0"/>',
    '        <mxCell id="1" parent="0"/>',
    ...cells.map((c) => `        ${c}`),
    '      </root>',
    '    </mxGraphModel>',
    '  </diagram>',
  ].join('\n');
}

// ---------------------------------------------------------------- model to file

// generate returns the .drawio text.
// It counts in stats the line labels that touch a box and those that touch another label or a title.
export function generate(model, stats = { labelsOnBoxes: 0, labelsOnLabels: 0 }) {
  const parts = model.parts ?? [];
  const partIndex = new Map(parts.map((p, k) => [p.id, k]));
  for (const t of model.types) {
    if (!LAYERS[t.layer]) throw new Error(`type "${t.id}" has no layer 1 to 4`);
    if (!partIndex.has(t.part)) throw new Error(`type "${t.id}" has the unknown part "${t.part}"`);
  }
  const byId = new Map(model.types.map((t) => [t.id, t]));
  for (const e of model.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) throw new Error(`edge ${e.from} -> ${e.to} names a type that the model does not have`);
    if (!EDGE_KIND[e.kind]) throw new Error(`edge ${e.from} -> ${e.to} has the unknown kind "${e.kind}"`);
  }
  const ctx = { model: { ...model, parts }, partIndex };
  const head = `${model.repo} @ ${model.head}`;

  const pages = [pageXml('all-classes', 'All classes', `${head} · page 1 · all classes`, model.types.map((type) => ({ type, role: 'class' })), ctx, true, stats)];
  parts.forEach((part, k) => {
    const own = model.types.filter((t) => t.part === part.id);
    const ownIds = new Set(own.map((t) => t.id));
    const refIds = new Set();
    for (const e of model.edges) {
      if (ownIds.has(e.from) && !ownIds.has(e.to)) refIds.add(e.to);
      if (ownIds.has(e.to) && !ownIds.has(e.from)) refIds.add(e.from);
    }
    const refs = model.types
      .filter((t) => refIds.has(t.id))
      .map((type) => {
        const pi = partIndex.get(type.part);
        return { type, role: 'ref', eyebrow: `PAGE ${pi + 2} · ${parts[pi].title.toUpperCase()}` };
      });
    const entries = [...own.map((type) => ({ type, role: 'class' })), ...refs];
    pages.push(pageXml(`part-${part.id}`, part.title, `${head} · page ${k + 2} · ${part.title}`, entries, ctx, false, stats));
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<mxfile host="drawio-clases" compressed="false">', ...pages, '</mxfile>', ''].join('\n');
}

function main(argv) {
  if (argv.length !== 2) {
    console.error('usage: node gen.mjs <model.json> <out.drawio>');
    return 2;
  }
  const [modelPath, out] = argv;
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  const stats = { labelsOnBoxes: 0, labelsOnLabels: 0 };
  writeFileSync(out, generate(model, stats));
  console.log(
    `wrote ${out}: ${1 + (model.parts ?? []).length} pages, ${model.types.length} types, ${model.edges.length} lines, ${stats.labelsOnBoxes} labels on a box, ${stats.labelsOnLabels} labels on another label`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
