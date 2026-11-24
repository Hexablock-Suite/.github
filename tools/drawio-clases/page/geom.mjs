#!/usr/bin/env node
// geom.mjs checks the geometry of a positions file against its model.
// It counts overlaps, crossings, parallel runs, label rooms over boxes or labels, and summary lines.
// Usage: node geom.mjs <model.json> <positions.json>
// It prints one line per density. The tests import checkGeometry.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { boxText } from './text.mjs';

const { isAttr } = boxText;

// hits tells if two rectangles [x, y, w, h] share more than a touch.
const hits = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

// checkGeometry gives the counts of one density: boxes, lines, overlaps, crossings and more.
// A segment crosses a box when it passes through its inside, shrunk by 1 unit.
// The two boxes that a line joins do not count. A summary line joins two zones, so every box counts for it.
// A label room (`lb` of a frame) must not cover a box or another label room.
// The page keeps each zone label inside its room at every zoom, so these counts hold for the labels too.
export function checkGeometry(model, P) {
  const ids = Object.keys(P.boxes);
  let overlaps = 0;
  const overlapList = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const [ax, ay, aw, ah] = P.boxes[ids[i]], [bx, by, bw, bh] = P.boxes[ids[j]];
    if (ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah) { overlaps++; overlapList.push(ids[i] + '/' + ids[j]); }
  }
  let crosses = 0, badEnds = 0;
  const crossList = [];
  const segs = [];
  for (const ln of P.lines) {
    const e = model.edges[ln.i];
    const p = ln.p;
    for (let k = 0; k < p.length - 1; k++) {
      const [x1, y1] = p[k], [x2, y2] = p[k + 1];
      segs.push({ i: ln.i, to: e.to, x1: Math.min(x1, x2), x2: Math.max(x1, x2), y1: Math.min(y1, y2), y2: Math.max(y1, y2), h: y1 === y2 });
      for (const id of ids) {
        if (id === e.from || id === e.to) continue;
        const [bx, by, bw, bh] = P.boxes[id];
        const sx1 = Math.min(x1, x2), sx2 = Math.max(x1, x2), sy1 = Math.min(y1, y2), sy2 = Math.max(y1, y2);
        if (sx2 > bx + 1 && sx1 < bx + bw - 1 && sy2 > by + 1 && sy1 < by + bh - 1) { crosses++; crossList.push(ln.i + '>' + id); }
      }
    }
    // Each end must sit on the border of its own box.
    const onBorder = (pt, id) => {
      const [bx, by, bw, bh] = P.boxes[id];
      const [x, y] = pt;
      const inX = x >= bx - 0.6 && x <= bx + bw + 0.6, inY = y >= by - 0.6 && y <= by + bh + 0.6;
      return inX && inY && (Math.abs(x - bx) < 0.6 || Math.abs(x - bx - bw) < 0.6 || Math.abs(y - by) < 0.6 || Math.abs(y - by - bh) < 0.6);
    };
    if (!onBorder(p[0], e.from) || !onBorder(p[p.length - 1], e.to)) badEnds++;
  }
  // Summary lines between two zones.
  const sums = P.sums || [];
  let sumCrossings = 0;
  for (const [si, sm] of sums.entries()) {
    for (let k = 0; k < sm.p.length - 1; k++) {
      const [x1, y1] = sm.p[k], [x2, y2] = sm.p[k + 1];
      const sx1 = Math.min(x1, x2), sx2 = Math.max(x1, x2), sy1 = Math.min(y1, y2), sy2 = Math.max(y1, y2);
      for (const id of ids) {
        const [bx, by, bw, bh] = P.boxes[id];
        if (sx2 > bx + 1 && sx1 < bx + bw - 1 && sy2 > by + 1 && sy1 < by + bh - 1) { sumCrossings++; crossList.push('s' + si + '>' + id); }
      }
    }
  }
  // Label rooms against boxes and against each other.
  const rooms = P.frames.filter((f) => f.lb);
  let labelBoxes = 0, labelLabels = 0;
  const labelList = [];
  for (const [ri, f] of rooms.entries()) {
    for (const id of ids) if (hits(f.lb, P.boxes[id])) { labelBoxes++; labelList.push(f.title + '>' + id); }
    for (const g of rooms.slice(ri + 1)) if (hits(f.lb, g.lb)) { labelLabels++; labelList.push(f.title + '/' + g.title); }
  }
  // Shared runs: two lines on the same track for more than 40 units.
  const shared = new Map();
  for (let a = 0; a < segs.length; a++) for (let b = a + 1; b < segs.length; b++) {
    const s = segs[a], t = segs[b];
    if (s.i === t.i || s.h !== t.h) continue;
    let ov = 0;
    if (s.h && s.y1 === t.y1) ov = Math.min(s.x2, t.x2) - Math.max(s.x1, t.x1);
    if (!s.h && s.x1 === t.x1) ov = Math.min(s.y2, t.y2) - Math.max(s.y1, t.y1);
    if (ov > 40) {
      const key = Math.min(s.i, t.i) + '-' + Math.max(s.i, t.i);
      shared.set(key, Math.max(shared.get(key) || 0, ov));
      if (s.to === t.to) shared.set(key + 'T', 1);
    }
  }
  const pairs = [...shared.keys()].filter((k) => !k.endsWith('T'));
  const sameTarget = pairs.filter((k) => shared.has(k + 'T')).length;
  // Near-parallel: two lines of different targets on tracks 12 units apart, side by side for more than 200 units.
  const nearPairs = new Set();
  for (let a = 0; a < segs.length; a++) for (let b = a + 1; b < segs.length; b++) {
    const s = segs[a], t = segs[b];
    if (s.i === t.i || s.h !== t.h || s.to === t.to) continue;
    let ov = 0;
    if (s.h && Math.abs(s.y1 - t.y1) <= 12 && s.y1 !== t.y1) ov = Math.min(s.x2, t.x2) - Math.max(s.x1, t.x1);
    if (!s.h && Math.abs(s.x1 - t.x1) <= 12 && s.x1 !== t.x1) ov = Math.min(s.y2, t.y2) - Math.max(s.y1, t.y1);
    if (ov > 200) nearPairs.add(Math.min(s.i, t.i) + '-' + Math.max(s.i, t.i));
  }
  const length = P.lines.reduce((s, l) => s + l.p.slice(1).reduce((q, pt, k) => q + Math.abs(pt[0] - l.p[k][0]) + Math.abs(pt[1] - l.p[k][1]), 0), 0);
  const bends = P.lines.reduce((s, l) => s + l.p.length - 2, 0);
  return {
    w: P.w, h: P.h, boxes: ids.length, lines: P.lines.length,
    groupFrames: P.frames.filter((f) => f.kind === 'g').length, viewFrames: P.frames.filter((f) => f.kind === 'v').length,
    bands: P.bands.map((b) => b.layer).join(''),
    overlaps, overlapList, crossings: crosses, crossList, badEnds,
    sharedRuns: pairs.length, sharedSameTarget: sameTarget, closeParallel: nearPairs.size,
    length: Math.round(length), bends,
    labels: rooms.length, labelBoxes, labelLabels, labelList, sums: sums.length, sumCrossings,
  };
}

// routedCount gives the count of model edges that the layout routes: structure lines and attribute uses.
export const routedCount = (model) => model.edges.filter((e) => e.kind !== 'use' || isAttr(e)).length;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.length < 4) {
    console.error('error: usage: node geom.mjs <model.json> <positions.json>');
    process.exit(1);
  }
  const model = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const pos = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  console.log(model.repo, 'routed edges in the model', routedCount(model));
  for (const d of ['compact', 'full']) {
    const g = checkGeometry(model, pos[d]);
    console.log(d, 'size', g.w + 'x' + g.h, 'boxes', g.boxes, 'frames', g.groupFrames + 'g/' + g.viewFrames + 'v',
      'bands', g.bands, 'lines', g.lines, 'overlaps', g.overlaps, 'crossings', g.crossings, 'badEnds', g.badEnds,
      'sharedRuns>40', g.sharedRuns, '(same target', g.sharedSameTarget + ', other', (g.sharedRuns - g.sharedSameTarget) + ')',
      'closeParallel>200', g.closeParallel, 'length', g.length, 'bends', g.bends,
      'labels', g.labels, 'labelBoxes', g.labelBoxes, 'labelLabels', g.labelLabels, 'sums', g.sums, 'sumCrossings', g.sumCrossings);
    if (g.crossList.length) console.log('  crossings:', g.crossList.slice(0, 10).join(' '));
  }
}
