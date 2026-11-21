#!/usr/bin/env node
// pin.mjs writes the layout file of gen.mjs from a .drawio file that a person edited in draw.io.
// Usage: node pin.mjs <edited.drawio> <model.json> <layout.json>
// For each page it reads the groups of each band by position, and the boxes of each group by row and then by column.
// The model gives the group of each box. A box that sits outside that group stays in it:
// pin.mjs leaves the box out of the layout and prints one warning, and gen.mjs puts the box after the fixed boxes of its group.
// The layout keeps order only. gen.mjs computes the positions, the gaps and the lines again.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { absBoxes, parseXml, readPages } from './check.mjs';
import { bandCellId, groupCellId, pageGroups, readJson, readText, runCommand, typeCellId } from './gen.mjs';

// byRows sorts items { x, y, h } by row, then by column.
// An item joins the current row when its top is above the middle of every item of that row.
// So two rows of one frame never merge, even when a tall box of another frame sits beside them.
function byRows(items) {
  const rows = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows[rows.length - 1];
    if (row && row.every((r) => it.y < r.y + r.h / 2)) row.push(it);
    else rows.push([it]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

// groupLabels returns the page position of each group label: "layer|key" -> { x, y, w, h, layer, key }.
// It walks the XML tree and not the cell map of readPages, because two bands of one page can hold a group with the same key.
// The parent band tells those two labels apart.
function groupLabels(diagram, pid, groups, boxes) {
  const out = new Map();
  const root = diagram.children.find((c) => c.name === 'mxGraphModel')?.children.find((c) => c.name === 'root');
  for (const el of root?.children ?? []) {
    if (el.name !== 'object' || el.attrs.role !== 'group') continue;
    const mx = el.children.find((c) => c.name === 'mxCell');
    const band = mx && boxes.get(mx.attrs.parent);
    if (!band) continue;
    const geo = mx.children.find((c) => c.name === 'mxGeometry')?.attrs ?? {};
    for (const g of groups) {
      if (el.attrs.id !== groupCellId(pid, g.key) || mx.attrs.parent !== bandCellId(pid, g.layer)) continue;
      const rect = { x: band.x + Number(geo.x ?? 0), y: band.y + Number(geo.y ?? 0), w: Number(geo.width ?? 0), h: Number(geo.height ?? 0) };
      out.set(`${g.layer}|${g.key}`, { ...rect, layer: g.layer, key: g.key });
    }
  }
  return out;
}

// groupAt returns the label of the group that holds a box, or null.
// That label sits in the band of the box center, at or above the top of the box, and spans the box center.
// The nearest such label wins.
function groupAt(rect, bands, labels) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const band = bands.find((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
  if (!band) return null;
  let best = null;
  for (const l of labels.values()) {
    if (l.layer !== band.layer || l.y > rect.y || cx < l.x || cx > l.x + l.w) continue;
    if (!best || l.y > best.y) best = l;
  }
  return best;
}

// pin returns the layout of one .drawio text. Each problem adds one line to warnings.
export function pin(xmlText, model, warnings = []) {
  const root = parseXml(xmlText);
  const pages = readPages(root);
  const layout = { pages: {} };
  for (const { pid, groups } of pageGroups(model)) {
    const page = pages.find((p) => p.id === pid);
    if (!page) {
      warnings.push(`the file has no page "${pid}"; skipped`);
      continue;
    }
    const diagram = root.children.find((c) => c.name === 'diagram' && c.attrs.id === pid);
    const boxes = absBoxes(page);
    const labels = groupLabels(diagram, pid, groups, boxes);
    const bands = [...page.cells.values()].filter((c) => c.data.role === 'band').map((c) => ({ ...boxes.get(c.id), layer: Number(c.data.layer) }));
    const placed = [];
    for (const g of groups) {
      const label = labels.get(`${g.layer}|${g.key}`);
      const inside = [];
      for (const id of g.typeIds) {
        const rect = boxes.get(typeCellId(pid, id));
        if (!rect) {
          warnings.push(`page "${pid}" has no box for type "${id}"; skipped`);
          continue;
        }
        // Without its label, a group keeps every box that the model gives it.
        if (label && groupAt(rect, bands, labels) !== label) {
          warnings.push(`page "${pid}" box "${id}" sits outside its group "${g.key}"; it stays in that group`);
          continue;
        }
        inside.push({ id, ...rect });
      }
      const rects = label ? [label, ...inside] : inside;
      if (!rects.length) continue;
      const x = Math.min(...rects.map((r) => r.x));
      const y = Math.min(...rects.map((r) => r.y));
      const h = Math.max(...rects.map((r) => r.y + r.h)) - y;
      placed.push({ layer: g.layer, key: g.key, x, y, h, types: byRows(inside).map((r) => r.id) });
    }
    const byLayer = {};
    for (const layer of new Set(placed.map((p) => p.layer))) {
      byLayer[layer] = byRows(placed.filter((p) => p.layer === layer)).map((p) => ({ group: p.key, types: p.types }));
    }
    layout.pages[pid] = byLayer;
  }
  return layout;
}

function main(argv) {
  if (argv.length !== 3) {
    console.error('usage: node pin.mjs <edited.drawio> <model.json> <layout.json>');
    return 2;
  }
  const [file, modelPath, out] = argv;
  const model = readJson(modelPath, 'model file');
  const warnings = [];
  const layout = pin(readText(file, '.drawio file'), model, warnings);
  for (const w of warnings) console.error(`warning: ${w}`);
  writeFileSync(out, `${JSON.stringify(layout, null, 2)}\n`);
  const groups = Object.values(layout.pages).flatMap((page) => Object.values(page).flat());
  console.log(
    `wrote ${out}: ${Object.keys(layout.pages).length} pages, ${groups.length} groups, ${groups.reduce((n, g) => n + g.types.length, 0)} boxes, ${warnings.length} warning(s)`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = runCommand(main, process.argv.slice(2));
}
