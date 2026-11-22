#!/usr/bin/env node
// Parse the class views of one HexaBlock repository.
//
// Usage: node views.mjs <repo-root> <out.json>
//
// The script reads every docs/architecture/classes/views/*.html file of <repo-root>.
// A view draws class boxes and lines as loose SVG elements.
// A box starts at a `<!-- Class: Name -->` or `<!-- Reference box: Name -->` comment, or at a
// `<g data-class="Name">` chip of a map. Its first rect gives its bounds.
// A line is a <line>, <path> or <polyline> with a marker. The marker gives the kind and the direction.
// The comment just before a line names its ends when it names two boxes of the view.
// Otherwise each line end goes to the nearest box. A line end far from every box stays unresolved.
// A lollipop (a short line and a circle) is an implements line to the interface that its text names.
// The output lists each view with its boxes, its lines and its unresolved lines.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Zone fills of the Clean layers (layers.md of each repository).
const LAYER_FILLS = { '#f9f4dc': 1, '#efe7f8': 2, '#e2ebf8': 3, '#cfdcf3': 4 };
// A line end resolves to a box when it lies at most this far from the box bounds.
const END_TOLERANCE = 16;
// A label belongs to the nearest line when its text box lies at most this far from it.
const LABEL_TOLERANCE = 16;
// The labels use an 8-unit monospace font, about five units per character.
const CHAR_WIDTH = 5;
const MULTIPLICITY = /^(\d+|\*|\d+\.\.(\d+|\*))$/;
const SPRINT = /«(Sprint \d+)»/;
const REQUIREMENT = /^[A-Z]{2,}-[A-Z]+-\d+/;
// The muted ink of stereotypes and notes. Members use the dark ink.
const MUTED = '#5b6873';

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[‹]/g, '<')
    .replace(/[›]/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

const attrsOf = (s) => {
  const out = {};
  for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};
const num = (v) => (v == null ? NaN : Number(v));

// Split the SVG into tokens in document order. The <defs> block holds markers, not drawing.
function tokenize(html) {
  const start = html.indexOf('</defs>');
  const end = html.lastIndexOf('</svg>');
  const offset = start < 0 ? 0 : start;
  const svg = html.slice(offset, end < 0 ? undefined : end);
  // The source line of a token lets the report point at a view member.
  const lineAt = (index) => html.slice(0, offset + index).split('\n').length;
  const re =
    /<!--([\s\S]*?)-->|<g\b([^>]*)>|<\/g>|<text\b([^>]*)>([\s\S]*?)<\/text>|<(rect|line|path|polyline|circle)\b([^>]*?)\/?>/g;
  const tokens = [];
  for (const m of svg.matchAll(re)) {
    if (m[1] !== undefined) tokens.push({ t: 'comment', text: decode(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'g', a: attrsOf(m[2]) });
    else if (m[0] === '</g>') tokens.push({ t: '/g' });
    else if (m[3] !== undefined) {
      const a = attrsOf(m[3]);
      // A tspan can carry the weight or the style of the name.
      for (const k of ['font-weight', 'font-style', 'text-decoration']) {
        const inner = m[4].match(new RegExp(`${k}="([^"]*)"`));
        if (!a[k] && inner) a[k] = inner[1];
      }
      tokens.push({ t: 'text', a, text: decode(m[4]), x: num(a.x), y: num(a.y), line: lineAt(m.index) });
    } else tokens.push({ t: m[5], a: attrsOf(m[6]) });
  }
  return tokens;
}

// Read the points of a line, polyline or path. Only the first and the last point matter for the ends.
function pointsOf(tok) {
  const a = tok.a;
  if (tok.t === 'line') return [[num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)]];
  if (tok.t === 'polyline') {
    const n = (a.points ?? '').trim().split(/[\s,]+/).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
    return pts;
  }
  const pts = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of (a.d ?? '').matchAll(/([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g)) {
    const n = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : [];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const step = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 }[C];
    if (C === 'Z') {
      if (pts.length) [x, y] = pts[0];
      pts.push([x, y]);
      continue;
    }
    for (let i = 0; i + step <= n.length; i += step) {
      const g = n.slice(i, i + step);
      if (C === 'H') x = rel ? x + g[0] : g[0];
      else if (C === 'V') y = rel ? y + g[0] : g[0];
      else {
        const [ex, ey] = g.slice(-2);
        x = rel ? x + ex : ex;
        y = rel ? y + ey : ey;
      }
      pts.push([x, y]);
    }
  }
  return pts;
}

const distToRect = ([px, py], r) => {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
};
// Sample each segment every two units and keep the smallest distance to the rectangle.
const distPolylineToRect = (pts, r) => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
    for (let k = 0; k <= n; k++) best = Math.min(best, distToRect([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n], r));
  }
  return best;
};

// Split a list at the commas that sit outside <> and ().
export function splitTop(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if ('<(['.includes(ch)) depth++;
    if ('>)]'.includes(ch) && !(ch === '>' && cur.endsWith('='))) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Parse one printed member, for example `+ play(move: TMove): Outcome «Sprint 3»` or `- history: T [0..1]`.
export function parseMember(text, style = {}) {
  let s = text.trim();
  let sprint = null;
  const sm = s.match(SPRINT);
  if (sm) {
    sprint = sm[1];
    s = s.replace(SPRINT, '').trim();
  }
  let optional = false;
  const mult = s.match(/\s*\[(0\.\.1|\*|\d+(\.\.(\d+|\*))?)\]\s*/);
  if (mult) {
    optional = mult[1] === '0..1';
    s = s.replace(mult[0], ' ').trim();
  }
  const readonly = /\{\s*readOnly\s*\}/i.test(s);
  s = s.replace(/\{[^}]*\}/g, '').trim();
  let vis = '+';
  const vm = s.match(/^([+\-#~])\s*/);
  if (vm) {
    vis = vm[1] === '~' ? '+' : vm[1];
    s = s.slice(vm[0].length);
  }
  const isStatic = /underline/.test(style['text-decoration'] ?? '');
  const isAbstract = /italic/.test(style['font-style'] ?? '');
  const op = s.match(/^(\[[\w$.]+\]|[A-Za-z_$][\w$]*|\(\))\s*(?:<([^(]*)>)?\s*\((.*)\)\s*(?::\s*(.+))?$/);
  if (op) {
    const params = op[3].trim() ? splitTop(op[3]) : [];
    const typeParams = op[2] ? parseTypeParams(op[2]) : [];
    return { member: 'op', vis, name: op[1], typeParams, params, ret: op[1] === 'constructor' ? null : (op[4] ?? 'void').trim(), abstract: isAbstract, static: isStatic, sprint };
  }
  const at = s.match(/^([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+)$/);
  if (at) {
    return { member: 'attr', vis, name: at[1], type: at[3].trim(), static: isStatic, readonly, optional: optional || !!at[2], sprint };
  }
  return { member: 'attr', vis, name: s, type: '', static: isStatic, readonly, optional, sprint, raw: true };
}

// Parse the text of a template box, for example `TCell, TState extends BoardState<TCell> & Cloneable<TState>`.
export function parseTypeParams(text) {
  return splitTop(text).map((p) => {
    const m = p.match(/^([A-Za-z_]\w*)(?:\s+extends\s+(.+?))?(?:\s*=\s*(.+))?$/);
    return m ? { name: m[1], constraint: m[2]?.trim() ?? null, default: m[3]?.trim() ?? null } : { name: p, constraint: null, default: null };
  });
}

// Read the header and the members of one box from its texts and compartment lines.
function readBox(box) {
  const { r } = box;
  const inside = box.texts.filter((tx) => tx.x >= r.x - 4 && tx.x <= r.x + r.w + 4 && tx.y >= r.y - 4 && tx.y <= r.y + r.h + 4).sort((a, b) => a.y - b.y || a.x - b.x);
  const splits = box.lines
    .filter((l) => Math.abs(num(l.a.y1) - num(l.a.y2)) < 0.5 && Math.abs(num(l.a.x2) - num(l.a.x1)) >= r.w * 0.8)
    .map((l) => num(l.a.y1))
    .sort((a, b) => a - b);
  const plain = (t) => t.replace(/<.*$/, '').trim();
  let nameIdx = inside.findIndex((tx) => plain(tx.text) === box.name);
  if (nameIdx < 0) nameIdx = inside.findIndex((tx) => tx.a['font-weight'] === '600');
  const headerEnd = splits.length ? splits[0] : nameIdx >= 0 ? inside[nameIdx].y + 0.5 : r.y;
  const header = inside.filter((tx, i) => tx.y < headerEnd || i <= nameIdx);
  const body = inside.filter((tx) => !header.includes(tx));
  for (const tx of header) {
    if (tx.a['data-requirement'] && !box.requirement) box.requirement = tx.a['data-requirement'];
    if (tx === inside[nameIdx]) {
      if (/italic/.test(tx.a['font-style'] ?? '')) box.abstract = true;
      continue;
    }
    const st = [...tx.text.matchAll(/«([^»]+)»/g)].map((m) => m[1]);
    for (const s of st) {
      if (/^Sprint \d+$/.test(s)) box.sprint ??= s;
      else box.stereotypes.push(s);
    }
    if (st.length) continue;
    if (REQUIREMENT.test(tx.text)) box.requirement ??= tx.text;
    else if (box.chip && !/·|^(PART|VIEW|LAYER)\b/.test(tx.text)) box.stereotypes.push(tx.text);
  }
  // A member starts with a visibility mark. An indented text without one continues the entry above it.
  // A centred text lists the literals of a union or an enumeration.
  // A muted text is a note, not a member. A text at the member margin without a mark is an unmarked
  // entry, such as one alternative of a union; it goes to the values.
  let last = null;
  for (const tx of body) {
    const marked = /^[+\-#~]\s/.test(tx.text);
    if (!marked && tx.a.fill === MUTED) {
      last = null;
    } else if (marked) {
      last = { text: tx.text, style: tx.a, x: tx.x, line: tx.line };
      box.members.push(last);
    } else if (tx.a['text-anchor'] === 'middle') {
      box.values.push(...tx.text.split(/\s*\|\s*|\s*,\s*/).filter(Boolean));
      last = null;
    } else if (last && tx.x > last.x + 1) {
      last.text = `${last.text} ${tx.text}`.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
    } else {
      last = { text: tx.text, style: tx.a, x: tx.x, unmarked: true };
      box.members.push(last);
    }
  }
  for (const m of box.members) if (m.unmarked) box.values.push(m.text);
  box.members = box.members.filter((m) => !m.unmarked);
  box.attrs = [];
  box.ops = [];
  for (const m of box.members) {
    const p = { ...parseMember(m.text, m.style), line: m.line };
    (p.member === 'op' ? box.ops : box.attrs).push(p);
  }
  delete box.members;
}

const markerKind = (url) => {
  const m = (url ?? '').match(/-(triangle|diamond-hollow|diamond-filled|open)\)/);
  return m ? m[1] : null;
};

// Parse one view file.
export function parseView(file) {
  const view = path.basename(file, '.html');
  const tokens = tokenize(fs.readFileSync(file, 'utf8'));
  const boxes = [];
  const zones = [];
  const rawLines = [];
  const labelTexts = [];
  const templates = [];
  const lollipops = [];
  let section = '';
  let box = null;
  let inChip = false;
  let prev = null;
  let legend = false;
  for (const tok of tokens) {
    if (tok.t === 'comment') {
      section = tok.text;
      if (/^Legend\b/.test(section)) legend = true;
      if (!inChip) box = null;
      const m = section.match(/^(Class|Reference box):\s*([A-Za-z_]\w*)/);
      if (m && !legend) {
        box = { name: m[2], ref: m[1] === 'Reference box', chip: false, r: null, texts: [], lines: [], stereotypes: [], sprint: null, requirement: null, abstract: false, values: [], members: [] };
        boxes.push(box);
      }
      prev = tok;
      continue;
    }
    if (legend) continue;
    if (tok.t === 'g' && tok.a['data-class']) {
      box = { name: tok.a['data-class'], ref: false, chip: true, r: null, texts: [], lines: [], stereotypes: [], sprint: null, requirement: null, abstract: false, values: [], members: [] };
      boxes.push(box);
      inChip = true;
      prev = tok;
      continue;
    }
    if (tok.t === '/g') {
      if (inChip) box = null;
      inChip = false;
      prev = tok;
      continue;
    }
    const isMarked = (tok.t === 'line' || tok.t === 'path' || tok.t === 'polyline') && (tok.a['marker-start'] || tok.a['marker-end']);
    if (box && !isMarked) {
      if (tok.t === 'rect' && !box.r) box.r = { x: num(tok.a.x), y: num(tok.a.y), w: num(tok.a.width), h: num(tok.a.height) };
      else if (tok.t === 'text') box.texts.push(tok);
      else if (tok.t === 'line') box.lines.push(tok);
      prev = tok;
      continue;
    }
    if (tok.t === 'rect' && LAYER_FILLS[tok.a.fill] && num(tok.a.width) * num(tok.a.height) >= 20000) {
      zones.push({ layer: LAYER_FILLS[tok.a.fill], r: { x: num(tok.a.x), y: num(tok.a.y), w: num(tok.a.width), h: num(tok.a.height) } });
    } else if (/^UML template/.test(section) && tok.t === 'rect') {
      templates.push({ r: { x: num(tok.a.x), y: num(tok.a.y), w: num(tok.a.width), h: num(tok.a.height) }, texts: [] });
    } else if (/^UML template/.test(section) && tok.t === 'text' && templates.length) {
      templates[templates.length - 1].texts.push(tok);
    } else if (/^Lollipop/.test(section) && tok.t === 'line') {
      lollipops.push({ pts: pointsOf(tok), circle: null, text: null, comment: section });
    } else if (/^Lollipop/.test(section) && tok.t === 'circle' && lollipops.length) {
      lollipops[lollipops.length - 1].circle = [num(tok.a.cx), num(tok.a.cy)];
    } else if (/^Lollipop/.test(section) && tok.t === 'text' && lollipops.length) {
      lollipops[lollipops.length - 1].text ??= tok.text;
    } else if (isMarked) {
      rawLines.push({ tok, comment: prev?.t === 'comment' ? prev.text : null });
    } else if (tok.t === 'text' && tok.text.length <= 48 && !/^(Footnote|Zone label|Layer zone|Group|Pattern|Chips|Row|Column)/.test(section)) {
      labelTexts.push(tok);
    }
    prev = tok;
  }

  for (const b of boxes) {
    if (!b.r) continue;
    readBox(b);
    const cx = b.r.x + b.r.w / 2;
    const cy = b.r.y + b.r.h / 2;
    const zone = zones
      .filter((z) => cx >= z.r.x && cx <= z.r.x + z.r.w && cy >= z.r.y && cy <= z.r.y + z.r.h)
      .sort((a, z) => a.r.w * a.r.h - z.r.w * z.r.h)[0];
    b.layer = zone ? zone.layer : null;
  }
  const drawn = boxes.filter((b) => b.r);

  // A template box sits on the top right corner of its class.
  for (const tp of templates) {
    const owner = drawn
      .filter((b) => !b.ref)
      .map((b) => ({ b, d: distToRect([b.r.x + b.r.w, b.r.y], tp.r) }))
      .sort((a, z) => a.d - z.d)[0];
    if (owner && owner.d <= 24) {
      const text = tp.texts.sort((a, z) => a.y - z.y).map((t) => t.text).join(' ');
      owner.b.typeParams = parseTypeParams(text.replace(/,\s*$/, ''));
    }
  }

  const nearest = (p) => {
    const c = drawn.map((b) => ({ b, d: distToRect(p, b.r) })).sort((a, z) => a.d - z.d || a.b.r.w * a.b.r.h - z.b.r.w * z.b.r.h);
    return c[0] && c[0].d <= END_TOLERANCE ? c[0] : null;
  };
  const boxDist = (p, name) => Math.min(...drawn.filter((b) => b.name === name).map((b) => distToRect(p, b.r)));
  const names = new Set(drawn.map((b) => b.name));

  const lines = [];
  const unresolved = [];
  for (const { tok, comment } of rawLines) {
    const pts = pointsOf(tok);
    const start = pts[0];
    const end = pts[pts.length - 1];
    const ms = markerKind(tok.a['marker-start']);
    const me = markerKind(tok.a['marker-end']);
    const dashed = !!tok.a['stroke-dasharray'];
    // The diamond sits on the holder. The arrowhead and the triangle sit on the target.
    let kind;
    let fromAtStart;
    const head = me ?? ms;
    const atEnd = !!me;
    if (head === 'diamond-hollow' || head === 'diamond-filled') {
      kind = head === 'diamond-hollow' ? 'aggregation' : 'composition';
      fromAtStart = !atEnd;
    } else if (head === 'triangle') {
      kind = dashed ? 'implements' : 'extends';
      fromAtStart = atEnd;
    } else {
      kind = 'use';
      fromAtStart = atEnd;
    }
    const pFrom = fromAtStart ? start : end;
    const pTo = fromAtStart ? end : start;
    const geoFrom = nearest(pFrom);
    const geoTo = nearest(pTo);
    let from = null;
    let to = null;
    let via;
    const named = comment ? [...new Set([...comment.matchAll(/\b[A-Za-z_]\w*\b/g)].map((m) => m[0]).filter((n) => names.has(n)))] : [];
    if (named.length >= 2) {
      // The comment names both ends. The geometry only decides which end is which.
      const [a, b] = named;
      const keep = boxDist(pFrom, a) + boxDist(pTo, b) <= boxDist(pFrom, b) + boxDist(pTo, a);
      [from, to] = keep ? [a, b] : [b, a];
      via = 'comment';
    } else if (geoFrom && geoTo && geoFrom.b !== geoTo.b) {
      from = geoFrom.b.name;
      to = geoTo.b.name;
      via = 'geometry';
    }
    const record = { view, kind, comment, start, end };
    if (!from || !to || from === to) {
      unresolved.push({ ...record, reason: !geoFrom ? 'no box near the holder end' : !geoTo ? 'no box near the target end' : 'both ends on one box' });
      continue;
    }
    const conflict = via === 'comment' && geoFrom && geoTo && (geoFrom.b.name !== from || geoTo.b.name !== to) && geoFrom.d === 0 && geoTo.d === 0;
    lines.push({ view, from, to, kind, label: [], multiplicity: [], sprint: null, via, pts, comment, geometry: conflict ? `${geoFrom.b.name} -> ${geoTo.b.name}` : null });
  }

  // A lollipop is an implements line from the box under the stick to the interface in its text.
  for (const lp of lollipops) {
    if (!lp.circle || !lp.text) continue;
    const far = lp.pts.slice().sort((a, z) => Math.hypot(z[0] - lp.circle[0], z[1] - lp.circle[1]) - Math.hypot(a[0] - lp.circle[0], a[1] - lp.circle[1]))[0];
    const owner = nearest(far);
    const iface = lp.text.match(/^[A-Za-z_]\w*/)?.[0];
    if (!owner || !iface) {
      unresolved.push({ view, kind: 'implements', comment: lp.comment, start: far, end: lp.circle, reason: `lollipop "${lp.text}" has no box under its stick` });
      continue;
    }
    lines.push({ view, from: owner.b.name, to: iface, kind: 'implements', label: [], multiplicity: [], sprint: null, via: 'lollipop', pts: [far, lp.circle], comment: lp.comment, geometry: null, binding: lp.text });
  }

  // A label or a multiplicity belongs to the nearest line.
  // The distance runs from the line to the box of the text, which grows from its anchor.
  const labelled = lines.filter((l) => l.via !== 'lollipop');
  for (const tx of labelTexts) {
    const w = tx.text.length * CHAR_WIDTH;
    const anchor = tx.a['text-anchor'] ?? 'start';
    const left = anchor === 'middle' ? tx.x - w / 2 : anchor === 'end' ? tx.x - w : tx.x;
    const r = { x: left, y: tx.y - 8, w, h: 8 };
    const best = labelled.map((l) => ({ l, d: distPolylineToRect(l.pts, r) })).sort((a, z) => a.d - z.d)[0];
    if (!best || best.d > LABEL_TOLERANCE) continue;
    if (MULTIPLICITY.test(tx.text)) best.l.multiplicity.push(tx.text);
    else if (SPRINT.test(tx.text) && tx.text.replace(SPRINT, '').trim() === '') best.l.sprint = tx.text.match(SPRINT)[1];
    else best.l.label.push(tx.text);
  }
  for (const l of lines) {
    l.label = l.label.join(' ') || null;
    l.multiplicity = l.multiplicity.join(' ') || null;
    delete l.pts;
  }

  const outBoxes = boxes.map((b) => ({
    name: b.name,
    ref: b.ref,
    chip: b.chip,
    layer: b.layer ?? null,
    stereotypes: [...new Set(b.stereotypes)],
    sprint: b.sprint,
    requirement: b.requirement,
    abstract: b.abstract,
    typeParams: b.typeParams ?? [],
    attrs: b.attrs ?? [],
    ops: b.ops ?? [],
    values: b.values,
    bounds: b.r,
  }));
  return { view, boxes: outBoxes, lines, unresolved };
}

export function parseViews(repoArg) {
  const dir = path.join(path.resolve(repoArg), 'docs/architecture/classes/views');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .sort();
  return files.map((f) => parseView(path.join(dir, f)));
}

function main(argv) {
  const [repoArg, outArg] = argv;
  if (!repoArg || !outArg) {
    console.error('usage: node views.mjs <repo-root> <out.json>');
    process.exit(2);
  }
  const views = parseViews(repoArg);
  fs.writeFileSync(outArg, JSON.stringify(views, null, 2) + '\n');
  const boxes = views.reduce((n, v) => n + v.boxes.length, 0);
  const lines = views.reduce((n, v) => n + v.lines.length, 0);
  const lost = views.reduce((n, v) => n + v.unresolved.length, 0);
  console.log(`${views.length} views: ${boxes} boxes, ${lines} lines, ${lost} unresolved lines`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main(process.argv.slice(2));
