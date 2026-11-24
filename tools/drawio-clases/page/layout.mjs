// layout.mjs composes the class diagram layout of one model at build time.
// ELK places the boxes inside each view frame or folder group (layered, direction down).
// This file packs the frames into groups, the groups into layer bands, and stacks the bands.
// Then it routes the structure and attribute lines on an orthogonal grid that avoids every box.
// It gives one positions object for both densities.
import ELK from 'elkjs/lib/elk.bundled.js';
import { boxText, nameWidth } from './text.mjs';

const { isAttr, folderOf, boxModel } = boxText;

const LARGE = 12;
const G = 12; // Grid step of the router. Parallel lines keep this distance.
const ASPECT = 1.75; // Target width to height of the whole canvas.
const PAD = {
  view: { top: 44, side: 28, bottom: 28 },
  group: { top: 84, side: 36, bottom: 36 },
  band: { top: 168, side: 56, bottom: 56 },
};
const GAP = { frame: 36, group: 72, band: 40 };
// Frame names of the boxes that have no home view of their own.
const NO_VIEW = 'in no view';
const OTHER_VIEWS = 'other views';

const snap = (v, s = 4) => Math.round(v / s) * s;

// layoutModel gives the positions of one model: { layout, compact, full }.
// It also gives the count of lines that found no route.
export async function layoutModel(model) {
  const elk = new ELK();
  const routedEdges = model.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.kind !== 'use' || isAttr(e));
  const partTitle = new Map((model.parts || []).map((p) => [p.id, p.title]));
  const zoneOf = (t) => folderOf(t, partTitle);

  // viewPart gives the part of each view: the part that holds most of the types it draws.
  const viewPart = new Map();
  {
    const count = new Map();
    for (const t of model.types) for (const v of t.views) {
      const key = v + '|' + t.part;
      count.set(key, (count.get(key) || 0) + 1);
    }
    const best = new Map();
    for (const [key, n] of count) {
      const [v, part] = key.split('|');
      if (!best.has(v) || n > best.get(v)) { best.set(v, n); viewPart.set(v, part); }
    }
  }
  // homeOf gives the home view of a type: its first view of its own part, else its first view.
  // The model sorts the views of a type by name.
  const homeOf = (t) => t.views.find((v) => viewPart.get(v) === t.part) || t.views[0] || NO_VIEW;

  // homeViews gives each box of a large group its view frame, as the draw.io tool does.
  // A type with no view goes to «in no view».
  // A view that is home to one box only goes to «other views».
  // The named views come first, by name. «other views» and then «in no view» close the list.
  function homeViews(types) {
    const home = new Map(types.map((t) => [t.id, homeOf(t)]));
    const count = new Map();
    for (const v of home.values()) count.set(v, (count.get(v) || 0) + 1);
    for (const [id, v] of home) if (count.get(v) === 1 && v !== NO_VIEW) home.set(id, OTHER_VIEWS);
    const frames = new Map();
    for (const t of types) {
      const v = home.get(t.id);
      if (!frames.has(v)) frames.set(v, []);
      frames.get(v).push(t);
    }
    const rank = (v) => (v === OTHER_VIEWS ? 1 : v === NO_VIEW ? 2 : 0);
    const order = [...frames.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    return frames.size > 1 ? order.map((v) => [v, frames.get(v)]) : null;
  }

  // tpWidth holds the width of the template box of each type. A line never lands under that box.
  const tpWidth = new Map();

  // placeBoxes runs ELK on one flat container. It returns box offsets and the content size.
  async function placeBoxes(types, sizes) {
    const ids = new Set(types.map((t) => t.id));
    const edges = routedEdges.filter(({ e }) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
      .map(({ e, i }) => ({ id: 'e' + i, sources: [e.from], targets: [e.to] }));
    const res = await elk.layout({
      id: 'c',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.separateConnectedComponents': 'true',
        'elk.spacing.componentComponent': '72',
        'elk.aspectRatio': String(types.length > 8 ? 2.2 : 3),
        'elk.spacing.nodeNode': '52',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      },
      children: types.map((t) => ({ id: t.id, width: sizes.get(t.id)[0], height: sizes.get(t.id)[1] })),
      edges,
    });
    const pos = new Map();
    let w = 0, h = 0;
    for (const c of res.children) {
      const x = snap(c.x), y = snap(c.y);
      pos.set(c.id, [x, y]);
      w = Math.max(w, x + c.width);
      h = Math.max(h, y + c.height);
    }
    return { pos, w: snap(w + 2, 4), h: snap(h + 2, 4) };
  }

  async function compose(density) {
    const sizes = new Map();
    for (const t of model.types) {
      const m = boxModel(t, density, nameWidth(t.name, !!t.abstract));
      sizes.set(t.id, [m.w, m.h]);
      tpWidth.set(t.id, m.tpW);
    }
    // 1. Groups: folder groups per layer, with view frames inside a large group.
    const groups = [];
    for (const layer of [4, 3, 2, 1]) {
      const byFolder = new Map();
      for (const t of model.types.filter((x) => x.layer === layer)) {
        const g = zoneOf(t);
        if (!byFolder.has(g)) byFolder.set(g, []);
        byFolder.get(g).push(t);
      }
      for (const g of [...byFolder.keys()].sort()) {
        const types = byFolder.get(g);
        const frames = types.length >= LARGE ? homeViews(types) : null;
        const group = { layer, title: g, types, frames: [], boxes: new Map() };
        if (frames) {
          const items = [];
          for (const [v, ts] of frames) {
            const c = await placeBoxes(ts, sizes);
            items.push({ v, c, w: c.w + 2 * PAD.view.side, h: c.h + PAD.view.top + PAD.view.bottom });
          }
          const area = items.reduce((s, it) => s + (it.w + GAP.frame) * (it.h + GAP.frame), 0);
          const limit = Math.max(Math.max(...items.map((it) => it.w)), Math.sqrt(area * 2.4));
          const pk = shelf(items, limit, GAP.frame, GAP.frame);
          items.forEach((it, i) => {
            const [fx, fy] = pk.at[i];
            group.frames.push({ title: it.v === NO_VIEW || it.v === OTHER_VIEWS ? it.v : 'view ' + it.v, x: fx, y: fy, w: it.w, h: it.h });
            for (const [id, [x, y]] of it.c.pos) group.boxes.set(id, [fx + PAD.view.side + x, fy + PAD.view.top + y]);
          });
          group.cw = pk.w; group.ch = pk.h;
        } else {
          const c = await placeBoxes(types, sizes);
          for (const [id, p] of c.pos) group.boxes.set(id, p);
          group.cw = c.w; group.ch = c.h;
        }
        group.w = group.cw + 2 * PAD.group.side;
        group.h = group.ch + PAD.group.top + PAD.group.bottom;
        groups.push(group);
      }
    }
    const groupOf = new Map();
    groups.forEach((g, gi) => { for (const id of g.boxes.keys()) groupOf.set(id, gi); });

    // 2. Bands: pack the groups of each band into rows of one common width.
    // Each layer gets a band, layer 4 at the top.
    const layers = [4, 3, 2, 1];
    const bandsOf = (layer) => groups.filter((g) => g.layer === layer);
    const order = new Map(layers.map((l) => [l, bandsOf(l)]));
    const placeAll = (inner) => {
      const out = { bands: [] };
      let y = 0;
      for (const layer of layers) {
        const gs = order.get(layer);
        const pk = shelf(gs, inner, GAP.group, GAP.group, true);
        const h = pk.h + PAD.band.top + PAD.band.bottom;
        gs.forEach((g, i) => { g.x = PAD.band.side + pk.at[i][0]; g.y = y + PAD.band.top + pk.at[i][1]; });
        out.bands.push({ layer, x: 0, y, w: inner + 2 * PAD.band.side, h });
        y += h + GAP.band;
      }
      out.w = inner + 2 * PAD.band.side;
      out.h = y - GAP.band;
      return out;
    };
    const minInner = Math.max(...groups.map((g) => g.w));
    const sumW = Math.max(...layers.map((l) => bandsOf(l).reduce((s, g) => s + g.w + GAP.group, 0)));
    const fitWidth = () => {
      let best = null;
      for (let inner = minInner; inner <= sumW + 1; inner += 48) {
        const p = placeAll(inner);
        const score = Math.abs(Math.log((p.w / p.h) / ASPECT));
        if (!best || score < best.score - 1e-9) best = { inner, score };
      }
      return best.inner;
    };
    let inner = fitWidth();
    const boxCenter = (id) => {
      const g = groups[groupOf.get(id)];
      const [x, y] = g.boxes.get(id);
      const [w, h] = sizes.get(id);
      return [g.x + PAD.group.side + x + w / 2, g.y + PAD.group.top + y + h / 2];
    };
    // Sweeps order the groups of a band by the mean x of the boxes they touch in other bands.
    let placed = placeAll(inner);
    for (let sweep = 0; sweep < 4; sweep++) {
      for (const layer of sweep % 2 ? layers.slice().reverse() : layers) {
        const gs = order.get(layer);
        const bary = new Map();
        // mate holds, for a group with no link to another band, the group of its band that it links to most.
        const mate = new Map();
        for (const g of gs) {
          let sx = 0, n = 0;
          const inBand = new Map();
          for (const e of model.edges) {
            const a = g.boxes.has(e.from), b = g.boxes.has(e.to);
            if (a === b) continue;
            const other = a ? e.to : e.from;
            const og = groups[groupOf.get(other)];
            const wgt = e.kind === 'use' && !isAttr(e) ? 0.3 : 1;
            if (og.layer === layer) { inBand.set(og, (inBand.get(og) || 0) + wgt); continue; }
            sx += boxCenter(other)[0] * wgt; n += wgt;
          }
          if (n) bary.set(g, sx / n);
          else if (inBand.size) mate.set(g, [...inBand].sort((p, q) => q[1] - p[1])[0][0]);
          else bary.set(g, g.x + g.w / 2);
        }
        // A group that only links inside its band sits right after the group it links to.
        // This keeps a planned zone next to the folder of its kin.
        const sorted = gs.filter((g) => bary.has(g)).sort((p, q) => bary.get(p) - bary.get(q));
        for (const [g, m] of mate) {
          const at = sorted.indexOf(m);
          sorted.splice(at < 0 ? sorted.length : at + 1, 0, g);
        }
        order.set(layer, sorted);
        placed = placeAll(inner);
      }
    }
    inner = fitWidth();
    placed = placeAll(inner);

    // 3. Absolute boxes and frames.
    const M = 48; // Outer margin of the canvas.
    const boxes = {};
    const frames = [];
    for (const g of groups) {
      frames.push({ kind: 'g', layer: g.layer, title: g.title, x: M + g.x, y: M + g.y, w: g.w, h: g.h });
      for (const f of g.frames) frames.push({ kind: 'v', layer: g.layer, title: f.title, x: M + g.x + PAD.group.side + f.x, y: M + g.y + PAD.group.top + f.y, w: f.w, h: f.h });
      for (const [id, [x, y]] of g.boxes) {
        const [w, h] = sizes.get(id);
        boxes[id] = [M + g.x + PAD.group.side + x, M + g.y + PAD.group.top + y, w, h];
      }
    }
    const bands = placed.bands.map((b) => ({ ...b, x: M + b.x, y: M + b.y }));
    const W = snap(placed.w + 2 * M, G), H = snap(placed.h + 2 * M, G);
    const groupFrames = frames.filter((f) => f.kind === 'g');
    const { lines, failed } = route(model, routedEdges, tpWidth, boxes, groupFrames, W, H, (id) => groupOf.get(id));
    return { failed, layout: { w: W, h: H, bands, frames, boxes, lines } };
  }

  const positions = { layout: 'elk-per-container + own packing + own grid router' };
  let unrouted = 0;
  for (const density of ['compact', 'full']) {
    const { failed, layout } = await compose(density);
    positions[density] = layout;
    unrouted += failed;
  }
  return { positions, unrouted };
}

// shelf packs items of {w, h} into rows no wider than limit. It returns the offsets and the size.
function shelf(items, limit, gx, gy, justify = false) {
  const rows = [];
  let row = null;
  for (const it of items) {
    if (!row || (row.w + gx + it.w > limit && row.items.length)) { row = { items: [], w: -gx, h: 0 }; rows.push(row); }
    row.items.push(it);
    row.w += gx + it.w;
    row.h = Math.max(row.h, it.h);
  }
  let y = 0, W = 0;
  const at = [];
  for (const r of rows) {
    let x = 0, gap = gx;
    const n = r.items.length;
    // A full row spreads its slack between its items, so the rhythm stays even.
    // A short row spreads a little and then sits in the middle, so the band has no empty half.
    if (justify && n > 1 && r.w > limit * 0.72) gap = gx + (limit - r.w) / (n - 1);
    else if (justify) {
      if (n > 1) gap = gx + Math.min(gx * 5, (limit - r.w) / (n - 1));
      x = (limit - (r.w + (gap - gx) * (n - 1))) / 2;
    }
    for (const it of r.items) { at.push([snap(x), y]); x += it.w + gap; }
    W = Math.max(W, justify ? limit : r.w);
    y += r.h + gy;
  }
  return { at, w: W, h: Math.max(0, y - gy) };
}

// ---------- router ----------
// route draws every structure and attribute line on a grid of step G.
// A grid point near a box is blocked, so no line crosses a box.
// A step on a track that a line to another target already uses costs more, so lines keep apart.
function route(model, routedEdges, tpWidth, boxes, groupFrames, W, H, groupIdx) {
  const NX = Math.floor(W / G) + 1, NY = Math.floor(H / G) + 1;
  const INF = 8; // A line keeps this distance from every box.
  const blocked = new Uint8Array(NX * NY);
  const ids = Object.keys(boxes);
  for (const id of ids) {
    const [x, y, w, h] = boxes[id];
    for (let iy = Math.ceil((y - INF) / G); iy * G < y + h + INF; iy++) {
      for (let ix = Math.ceil((x - INF) / G); ix * G < x + w + INF; ix++) {
        const px = ix * G, py = iy * G;
        if (px > x - INF && px < x + w + INF && py > y - INF && py < y + h + INF) blocked[iy * NX + ix] = 1;
      }
    }
  }
  // Each grid point knows its folder group, so a line pays to cross a group that is not its own.
  // The group index of a frame follows the order of groupFrames, which is the order of groups.
  const gridGroup = new Int16Array(NX * NY).fill(-1);
  groupFrames.forEach((f, gi) => {
    for (let iy = Math.ceil(f.y / G); iy * G <= f.y + f.h; iy++) for (let ix = Math.ceil(f.x / G); ix * G <= f.x + f.w; ix++) gridGroup[iy * NX + ix] = gi;
  });
  const hUse = new Int32Array(NX * NY).fill(-1); // Horizontal step from a point to its right neighbor.
  const vUse = new Int32Array(NX * NY).fill(-1); // Vertical step from a point to its lower neighbor.
  const hCount = new Uint8Array(NX * NY), vCount = new Uint8Array(NX * NY);

  // Ports: choose a side per line end, then spread the ends of one side along it.
  const ends = new Map();
  const lines = routedEdges.map(({ e, i }) => {
    const a = boxes[e.from], b = boxes[e.to];
    let sa, sb;
    if (b[1] >= a[1] + a[3] + 2 * G) { sa = 'b'; sb = 't'; }
    else if (a[1] >= b[1] + b[3] + 2 * G) { sa = 't'; sb = 'b'; }
    else if (b[0] >= a[0] + a[2]) { sa = 'r'; sb = 'l'; }
    else { sa = 'l'; sb = 'r'; }
    return { e, i, ends: [{ id: e.from, side: sa, other: e.to, lineTo: e.to, kind: e.kind }, { id: e.to, side: sb, other: e.from, lineTo: e.to, kind: e.kind }] };
  });
  for (const l of lines) for (const en of l.ends) {
    const key = en.id + '|' + en.side;
    if (!ends.has(key)) ends.set(key, []);
    ends.get(key).push(en);
  }
  const center = (id) => [boxes[id][0] + boxes[id][2] / 2, boxes[id][1] + boxes[id][3] / 2];
  for (const [key, list] of ends) {
    const cut = key.lastIndexOf('|');
    const id = key.slice(0, cut), side = key.slice(cut + 1);
    const [x, y, w, h] = boxes[id];
    const horiz = side === 't' || side === 'b';
    // Ends that go to one other box share one port.
    // Structure lines of one kind into one target also share one port, so they meet in one trunk.
    const incoming = list[0].id === list[0].lineTo;
    const keyOf = (en) => (incoming && en.kind !== 'use' ? 'S:' + en.kind : en.other);
    const groupsByKey = new Map();
    for (const en of list) {
      const k = keyOf(en);
      if (!groupsByKey.has(k)) groupsByKey.set(k, []);
      groupsByKey.get(k).push(en);
    }
    // Ports keep the order of the far ends along the side, so lines do not cross at the box.
    const meanOf = (ens) => {
      const cs = [...new Set(ens.map((en) => en.other))].map(center);
      return [cs.reduce((a, c) => a + c[0], 0) / cs.length, cs.reduce((a, c) => a + c[1], 0) / cs.length];
    };
    const others = [...groupsByKey.keys()].sort((p, q) => {
      const cp = meanOf(groupsByKey.get(p)), cq = meanOf(groupsByKey.get(q));
      return horiz ? cp[0] - cq[0] || cp[1] - cq[1] : cp[1] - cq[1] || cp[0] - cq[0];
    });
    const lo = horiz ? Math.ceil((x + 14) / G) : Math.ceil((y + 12) / G);
    const hi = horiz ? Math.floor((x + w - 14) / G) : Math.floor((y + h - 12) / G);
    const slots = [];
    // The template box sits on the top side at the right. Its span takes no port.
    const tpW = tpWidth.get(id) || 0;
    const tpLo = x + w - tpW + 8 - 10;
    for (let s = lo; s <= hi; s++) if (!(side === 't' && tpW && s * G >= tpLo)) slots.push(s);
    // Line ends into a target keep at least 36 units apart. More ends share a port, like a bus.
    const n = others.length;
    const ports = incoming ? Math.min(n, Math.max(1, Math.floor(((horiz ? w : h) - 28) / 36) + 1)) : n;
    others.forEach((o, j) => {
      const b = Math.floor((j * ports) / n);
      const s = slots.length ? slots[Math.min(slots.length - 1, Math.round(((b + 0.5) / ports) * slots.length - 0.5))] : Math.round((horiz ? x + w / 2 : y + h / 2) / G);
      for (const en of groupsByKey.get(o)) en.slot = s;
    });
  }
  // portOf gives the point on the box side and the first free grid point outside it.
  const portOf = (en) => {
    const [x, y, w, h] = boxes[en.id];
    const s = en.slot * G;
    if (en.side === 't') return { p: [s, y], g: [en.slot, Math.floor((y - INF) / G)], dir: 3 };
    if (en.side === 'b') return { p: [s, y + h], g: [en.slot, Math.ceil((y + h + INF) / G)], dir: 2 };
    if (en.side === 'l') return { p: [x, s], g: [Math.floor((x - INF) / G), en.slot], dir: 1 };
    return { p: [x + w, s], g: [Math.ceil((x + w + INF) / G), en.slot], dir: 0 };
  };

  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  // NEAR is the cost of a step beside a line of another target, one grid step away.
  // It keeps a visible gap of two grid steps between parallel lines.
  // TRUNK is the cost factor of a step on the track of a structure line of the same kind and target.
  const BEND = 40, OVERLAP = 140, CROSS = 14, FOREIGN = 24, NEAR = 16, TRUNK = 0.5;
  const S = NX * NY * 4;
  const gScore = new Float64Array(S), stamp = new Int32Array(S), parent = new Int32Array(S);
  let gen = 0;

  // A binary heap of states keyed by f score.
  const heapS = new Int32Array(S > 4e6 ? 4e6 : S), heapF = new Float64Array(heapS.length);
  let hn = 0;
  const push = (s, f) => {
    let i = hn++;
    while (i > 0) { const p = (i - 1) >> 1; if (heapF[p] <= f) break; heapS[i] = heapS[p]; heapF[i] = heapF[p]; i = p; }
    heapS[i] = s; heapF[i] = f;
  };
  const pop = () => {
    const top = heapS[0];
    const ls = heapS[--hn], lf = heapF[hn];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= hn) break;
      if (c + 1 < hn && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= lf) break;
      heapS[i] = heapS[c]; heapF[i] = heapF[c]; i = c;
    }
    heapS[i] = ls; heapF[i] = lf;
    return top;
  };

  const tIndex = new Map(ids.map((id, k) => [id, k]));
  // lineKey groups the lines that may share a track: one target and one kind.
  const kindCode = { use: 0, implements: 1, extends: 2, aggregation: 3, composition: 4 };
  const lineKey = (l) => tIndex.get(l.e.to) * 5 + kindCode[l.e.kind];

  function astar(l, from, to) {
    gen++;
    hn = 0;
    const tk = lineKey(l);
    const structure = l.e.kind !== 'use';
    const gA = groupIdx(l.e.from), gB = groupIdx(l.e.to);
    const [sx, sy] = from.g, [ex, ey] = to.g;
    const needDir = to.dir ^ 1; // Arrive moving toward the box.
    const s0 = ((sy * NX + sx) << 2) | from.dir;
    gScore[s0] = 0; stamp[s0] = gen; parent[s0] = -1;
    push(s0, Math.abs(ex - sx) * G + Math.abs(ey - sy) * G);
    const goal = ((ey * NX + ex) << 2) | needDir;
    while (hn) {
      const s = pop();
      if (s === goal) break;
      const node = s >> 2, dir = s & 3, gs = gScore[s];
      const ix = node % NX, iy = (node - ix) / NX;
      // Turn in place.
      for (const nd of dir < 2 ? [2, 3] : [0, 1]) {
        const t = (node << 2) | nd, ng = gs + BEND;
        if (stamp[t] !== gen || ng < gScore[t]) { stamp[t] = gen; gScore[t] = ng; parent[t] = s; push(t, ng + Math.abs(ex - ix) * G + Math.abs(ey - iy) * G); }
      }
      // Move one step forward.
      const nx = ix + DX[dir], ny = iy + DY[dir];
      if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue;
      const nn = ny * NX + nx;
      if (blocked[nn] && !(nx === ex && ny === ey)) continue;
      let cost = G;
      const seg = dir < 2 ? (dir === 0 ? node : nn) : (dir === 2 ? node : nn);
      const use = dir < 2 ? hUse[seg] : vUse[seg];
      const cnt = dir < 2 ? hCount[seg] : vCount[seg];
      if (cnt && use !== tk) cost += OVERLAP * cnt;
      else if (cnt && structure) cost *= TRUNK;
      else if (cnt) cost += OVERLAP / 4;
      // A line keeps one empty track between itself and a line to another target.
      const side = dir < 2 ? [seg - NX, seg + NX] : [seg - 1, seg + 1];
      for (const c of side) {
        if (c < 0 || c >= NX * NY) continue;
        const n2 = dir < 2 ? hCount[c] : vCount[c], u2 = dir < 2 ? hUse[c] : vUse[c];
        if (n2 && u2 !== tk) cost += NEAR;
      }
      const cross = dir < 2 ? (vCount[nn] || (ny > 0 && vCount[nn - NX])) : (hCount[nn] || (nx > 0 && hCount[nn - 1]));
      if (cross) cost += CROSS;
      const gg = gridGroup[nn];
      if (gg >= 0 && gg !== gA && gg !== gB) cost += FOREIGN;
      const t = (nn << 2) | dir, ng = gs + cost;
      if (stamp[t] !== gen || ng < gScore[t]) { stamp[t] = gen; gScore[t] = ng; parent[t] = s; push(t, ng + Math.abs(ex - nx) * G + Math.abs(ey - ny) * G); }
    }
    if (stamp[goal] !== gen) return null;
    const pts = [];
    for (let s = goal; s !== -1; s = parent[s]) {
      const node = s >> 2;
      const p = [(node % NX) * G, Math.floor(node / NX) * G];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
    }
    return pts.reverse();
  }

  const mark = (pts, tk, sign) => {
    for (let k = 0; k < pts.length - 1; k++) {
      const [x1, y1] = pts[k], [x2, y2] = pts[k + 1];
      if (y1 === y2) {
        const iy = y1 / G;
        for (let ix = Math.min(x1, x2) / G; ix < Math.max(x1, x2) / G; ix++) { const c = iy * NX + ix; hCount[c] += sign; hUse[c] = hCount[c] ? (sign > 0 && hUse[c] !== -1 && hUse[c] !== tk && hCount[c] > 1 ? -2 : tk) : -1; }
      } else {
        const ix = x1 / G;
        for (let iy = Math.min(y1, y2) / G; iy < Math.max(y1, y2) / G; iy++) { const c = iy * NX + ix; vCount[c] += sign; vUse[c] = vCount[c] ? (sign > 0 && vUse[c] !== -1 && vUse[c] !== tk && vCount[c] > 1 ? -2 : tk) : -1; }
      }
    }
  };

  // Short lines go first, so they take the direct tracks.
  for (const l of lines) { l.from = portOf(l.ends[0]); l.to = portOf(l.ends[1]); }
  const order = lines.slice().sort((p, q) => (Math.abs(p.from.g[0] - p.to.g[0]) + Math.abs(p.from.g[1] - p.to.g[1])) - (Math.abs(q.from.g[0] - q.to.g[0]) + Math.abs(q.from.g[1] - q.to.g[1])));
  let failed = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const l of order) {
      const tk = lineKey(l);
      if (l.grid) mark(l.grid, tk, -1);
      const g = astar(l, l.from, l.to);
      if (!g) { if (pass === 1) failed++; l.grid = null; continue; }
      l.grid = g;
      mark(g, tk, 1);
    }
  }
  const r1 = (v) => Math.round(v * 2) / 2;
  const out = lines.filter((l) => l.grid).map((l) => {
    const raw = [l.from.p, ...l.grid.map((p) => p.slice()), l.to.p];
    // Drop the points in the middle of a straight run.
    const p = [];
    for (const q of raw) {
      const n = p.length;
      if (n && p[n - 1][0] === q[0] && p[n - 1][1] === q[1]) continue;
      if (n >= 2 && ((p[n - 2][0] === p[n - 1][0] && p[n - 1][0] === q[0]) || (p[n - 2][1] === p[n - 1][1] && p[n - 1][1] === q[1]))) p[n - 1] = q;
      else p.push(q);
    }
    const res = { i: l.i, p: p.map((q) => [r1(q[0]), r1(q[1])]) };
    if (l.e.label) {
      // The label sits beside the last run, near the arrowhead.
      const z = p[p.length - 1], y = p[p.length - 2];
      const dx = Math.sign(z[0] - y[0]), dy = Math.sign(z[1] - y[1]);
      res.lb = dy ? [z[0] + 6, z[1] - dy * 22 + (dy > 0 ? 0 : 9)] : [z[0] - dx * (l.e.label.length * 5.4 + 18), z[1] - 6];
    }
    return res;
  }).sort((a, b) => a.i - b.i);
  return { lines: out, failed };
}
