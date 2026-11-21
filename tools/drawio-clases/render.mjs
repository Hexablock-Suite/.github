#!/usr/bin/env node
// render.mjs draws each page of a .drawio file to one PNG with a local headless Chromium.
// Usage: node render.mjs <file.drawio> <out-dir>
// It does not use draw.io. It places boxes and HTML labels at their geometry, as draw.io does.
// It draws each line through its fixed exit, its waypoints and its fixed entry, as draw.io does.
// A line without them gets a simple elbow, so draw.io can route that line on another path.
// It also reports labels larger than their box, line labels on a box, overlapping boxes and lines that cross a box.
// Set CHROME_BIN to choose the browser. Set RENDER_SCALE to change the PNG scale.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { absBoxes, crossedBoxes, edgeKind, edgePolyline, labelText, parseXml, readPages } from './check.mjs';

// findChrome returns the first browser binary that exists, or null.
function findChrome() {
  const found = [];
  if (process.env.CHROME_BIN) found.push(process.env.CHROME_BIN);
  const pw = path.join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(pw)) {
    const dirs = readdirSync(pw).sort().reverse();
    for (const d of dirs.filter((x) => x.startsWith('chromium_headless_shell-'))) {
      found.push(path.join(pw, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
    }
    for (const d of dirs.filter((x) => x.startsWith('chromium-'))) found.push(path.join(pw, d, 'chrome-linux64', 'chrome'));
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) found.push(path.join(dir, name));
  }
  return found.find((p) => p && existsSync(p)) ?? null;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v, d = 0) => (v === undefined ? d : Number(v));

// route returns the points of one elbow line from box s to box t.
function elbow(s, t) {
  const sc = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  const tc = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
  const ox1 = Math.max(s.x, t.x);
  const ox2 = Math.min(s.x + s.w, t.x + t.w);
  const oy1 = Math.max(s.y, t.y);
  const oy2 = Math.min(s.y + s.h, t.y + t.h);
  if (ox2 - ox1 > 12) {
    const x = (ox1 + ox2) / 2;
    return tc.y > sc.y ? [[x, s.y + s.h], [x, t.y]] : [[x, s.y], [x, t.y + t.h]];
  }
  if (oy2 - oy1 > 12) {
    const y = (oy1 + oy2) / 2;
    return tc.x > sc.x ? [[s.x + s.w, y], [t.x, y]] : [[s.x, y], [t.x + t.w, y]];
  }
  if (Math.abs(tc.y - sc.y) >= Math.abs(tc.x - sc.x) / 2) {
    const sy = tc.y > sc.y ? s.y + s.h : s.y;
    const ty = tc.y > sc.y ? t.y : t.y + t.h;
    const my = (sy + ty) / 2;
    return [[sc.x, sy], [sc.x, my], [tc.x, my], [tc.x, ty]];
  }
  const sx = tc.x > sc.x ? s.x + s.w : s.x;
  const tx = tc.x > sc.x ? t.x : t.x + t.w;
  const mx = (sx + tx) / 2;
  return [[sx, sc.y], [mx, sc.y], [mx, tc.y], [tx, tc.y]];
}

function pointAt(pts, frac) {
  const segs = pts.slice(1).map((p, k) => Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]));
  let left = segs.reduce((a, b) => a + b, 0) * frac;
  for (let k = 0; k < segs.length; k += 1) {
    if (left <= segs[k] || k === segs.length - 1) {
      const r = segs[k] ? Math.min(1, left / segs[k]) : 0;
      return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * r, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * r];
    }
    left -= segs[k];
  }
  return pts[0];
}


function vertexHtml(cell, box) {
  const st = cell.styleMap;
  const css = [`left:${box.x}px`, `top:${box.y}px`, `width:${box.w}px`, `height:${box.h}px`];
  if (!st.text) {
    css.push(`background:${st.fillColor ?? '#ffffff'}`);
    css.push(`border:${st.strokeWidth ?? 1}px ${st.dashed === '1' ? 'dashed' : 'solid'} ${st.strokeColor ?? '#000000'}`);
    if (st.rounded === '1') css.push(`border-radius:${st.absoluteArcSize === '1' ? num(st.arcSize, 10) / 2 : 8}px`);
  }
  const fontStyle = num(st.fontStyle);
  const inner = [
    `font-size:${st.fontSize ?? 12}px`,
    `color:${st.fontColor ?? '#000000'}`,
    `font-weight:${fontStyle & 1 ? 'bold' : 'normal'}`,
    `font-style:${fontStyle & 2 ? 'italic' : 'normal'}`,
    `white-space:${st.whiteSpace === 'wrap' ? 'normal' : 'nowrap'}`,
    `text-align:${st.align ?? 'center'}`,
  ];
  const fill = st.overflow === 'fill';
  const spacing = fill ? 0 : num(st.spacing, 2);
  const lay = [
    'position:absolute',
    'inset:0',
    'display:flex',
    'flex-direction:column',
    `justify-content:${st.verticalAlign === 'top' ? 'flex-start' : st.verticalAlign === 'bottom' ? 'flex-end' : 'center'}`,
    `align-items:${fill ? 'stretch' : st.align === 'left' ? 'flex-start' : st.align === 'right' ? 'flex-end' : 'center'}`,
    `padding:${spacing + num(st.spacingTop)}px ${spacing}px ${spacing}px ${spacing + num(st.spacingLeft)}px`,
  ];
  const label = st.html === '1' ? cell.label : esc(cell.label);
  const watch = cell.data.role === 'class' || cell.data.role === 'ref' || cell.data.role === 'tparams';
  return `<div class="v"${watch ? ' data-box="1"' : ''} style="${css.join(';')}"><div style="${lay.join(';')}"><div class="l"${watch ? ` data-id="${esc(cell.id)}"` : ''} style="${inner.join(';')}">${label}</div></div></div>`;
}

const MARKERS = `<defs>
<marker id="open" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto"><path d="M1,1 L11,6 L1,11" fill="none" stroke="context-stroke" stroke-width="1.3"/></marker>
<marker id="tri" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto"><path d="M1,1 L13,7 L1,13 Z" fill="#ffffff" stroke="context-stroke" stroke-width="1.3"/></marker>
<marker id="dia0" viewBox="0 0 18 10" refX="1" refY="5" markerWidth="18" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M1,5 L9,1 L17,5 L9,9 Z" fill="#ffffff" stroke="context-stroke" stroke-width="1.3"/></marker>
<marker id="dia1" viewBox="0 0 18 10" refX="1" refY="5" markerWidth="18" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M1,5 L9,1 L17,5 L9,9 Z" fill="context-stroke" stroke="context-stroke" stroke-width="1.3"/></marker>
</defs>`;

// renderPage builds the HTML of one page and the geometry findings of that page.
function renderPage(page) {
  const boxes = absBoxes(page);
  const vertices = [...page.cells.values()].filter((c) => c.vertex === '1');
  const classes = vertices.filter((c) => c.data.role === 'class' || c.data.role === 'ref');
  let maxX = 0;
  let maxY = 0;
  let minX = 0;
  let minY = 0;
  for (const b of boxes.values()) {
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
  }
  const findings = { overlaps: [], through: [] };
  for (let i = 0; i < classes.length; i += 1) {
    for (let j = i + 1; j < classes.length; j += 1) {
      const a = boxes.get(classes[i].id);
      const b = boxes.get(classes[j].id);
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        findings.overlaps.push(`${classes[i].data.typeId} / ${classes[j].data.typeId}`);
      }
    }
  }
  const paths = [];
  const labels = [];
  for (const cell of page.cells.values()) {
    if (cell.edge !== '1') continue;
    const s = boxes.get(cell.source);
    const t = boxes.get(cell.target);
    if (!s || !t) continue;
    const poly = edgePolyline(cell, page, boxes);
    const pts = poly.pts ? poly.pts.map((p) => [p.x, p.y]) : elbow(s, t);
    const st = cell.styleMap;
    const kind = edgeKind(st);
    const color = st.strokeColor ?? '#000000';
    const markers =
      kind === 'use'
        ? 'marker-end="url(#open)"'
        : kind === 'implements' || kind === 'extends'
          ? 'marker-end="url(#tri)"'
          : kind
            ? `marker-start="url(#dia${kind === 'composition' ? 1 : 0})"`
            : '';
    // A line can run outside every box, so its points also widen the picture.
    for (const [x, y] of pts) {
      minX = Math.min(minX, x - 40);
      minY = Math.min(minY, y - 20);
      maxX = Math.max(maxX, x + 40);
      maxY = Math.max(maxY, y + 20);
    }
    paths.push(
      `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="${num(st.strokeWidth, 1)}"${st.dashed === '1' ? ' stroke-dasharray="6,4"' : ''} ${markers}/>`,
    );
    const crossed = crossedBoxes(
      pts.map(([x, y]) => ({ x, y })),
      cell,
      page,
      boxes,
    );
    if (crossed.length) {
      const from = page.cells.get(cell.source).data.typeId;
      const to = page.cells.get(cell.target).data.typeId;
      findings.through.push(`${from} -> ${to} crosses ${crossed.join(', ')}`);
    }
    const text = labelText(cell.label).trim();
    if (text) {
      const frac = (num(cell.geo.x) + 1) / 2;
      const [px, py] = pointAt(pts, frac);
      const lx = px + cell.labelOffset.x;
      const ly = py + cell.labelOffset.y;
      labels.push(
        `<div class="el" data-edge="${esc(cell.id)}" style="left:${lx}px;top:${ly}px;color:${st.fontColor ?? color};font-size:${st.fontSize ?? 11}px">${esc(text)}</div>`,
      );
    }
  }
  const pad = 20;
  const width = Math.ceil(maxX - minX + 2 * pad);
  const height = Math.ceil(maxY - minY + 2 * pad);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#ffffff;font-family:Helvetica,Arial,'Liberation Sans',sans-serif}
#c{position:relative;transform-origin:0 0}
.v{position:absolute;box-sizing:border-box}
.v .l{max-width:100%}
.el{position:absolute;transform:translate(-50%,-50%);background:#ffffff;white-space:pre;text-align:center;line-height:14px;padding:0 2px}
hr{display:block}
</style></head><body><div id="c" style="width:${width}px;height:${height}px;transform:translate(${pad - minX}px,${pad - minY}px)">
${vertices.map((c) => vertexHtml(c, boxes.get(c.id))).join('\n')}
<svg style="position:absolute;left:0;top:0;overflow:visible" width="${maxX}" height="${maxY}">${MARKERS}${paths.join('')}</svg>
${labels.join('\n')}
</div><pre id="report"></pre><script>
const big = [];
for (const el of document.querySelectorAll('.l[data-id]')) {
  const box = el.parentElement.parentElement;
  if (el.scrollWidth > box.clientWidth + 1 || el.scrollHeight > box.clientHeight + 1 || el.offsetWidth > box.clientWidth + 1) {
    big.push(el.dataset.id + ' ' + el.scrollWidth + 'x' + el.scrollHeight + ' in ' + box.clientWidth + 'x' + box.clientHeight);
  }
}
const boxRects = [...document.querySelectorAll('.v[data-box]')].map((el) => el.getBoundingClientRect());
const onBox = [];
for (const el of document.querySelectorAll('.el')) {
  const r = el.getBoundingClientRect();
  if (boxRects.some((b) => r.right > b.left + 1 && r.left < b.right - 1 && r.bottom > b.top + 1 && r.top < b.bottom - 1)) onBox.push(el.dataset.edge);
}
document.getElementById('report').textContent = JSON.stringify({ big, onBox });
</script></body></html>`;
  return { html, width, height, findings };
}

function main(argv) {
  if (argv.length !== 2) {
    console.error('usage: node render.mjs <file.drawio> <out-dir>');
    return 2;
  }
  const [file, outDir] = argv;
  const chrome = findChrome();
  if (!chrome) {
    console.error('render.mjs: no Chromium found. Set CHROME_BIN to a Chromium or Chrome binary.');
    return 2;
  }
  const pages = readPages(parseXml(readFileSync(file, 'utf8')));
  const base = path.basename(file).replace(/\.drawio$/, '');
  const tmp = mkdtempSync(path.join(tmpdir(), 'drawio-render-'));
  const flags = ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files'];
  try {
    pages.forEach((page, k) => {
      const { html, width, height, findings } = renderPage(page);
      const htmlPath = path.join(tmp, `p${k + 1}.html`);
      writeFileSync(htmlPath, html);
      const url = pathToFileURL(htmlPath).href;
      const dom = execFileSync(chrome, [...flags, '--virtual-time-budget=3000', '--window-size=1200,800', '--dump-dom', url], {
        encoding: 'utf8',
        maxBuffer: 1 << 28,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 180000,
      });
      const report = /<pre id="report">([^<]*)<\/pre>/.exec(dom);
      const parsed = report ? JSON.parse(report[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')) : null;
      const big = parsed?.big ?? null;
      const onBox = parsed?.onBox ?? null;
      const scale = Number(process.env.RENDER_SCALE ?? Math.min(1, 12000 / Math.max(width, height)));
      const slug = page.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const png = path.join(outDir, `${base}-p${k + 1}-${slug}.png`);
      execFileSync(chrome, [...flags, `--force-device-scale-factor=${scale}`, `--window-size=${width},${height}`, `--screenshot=${png}`, url], {
        stdio: 'ignore',
        timeout: 180000,
      });
      console.log(`page ${k + 1} "${page.name}": ${png} (${width}x${height} css px, scale ${scale.toFixed(2)})`);
      console.log(`  labels larger than their box: ${big ? big.length : 'unknown'}${big?.length ? ` (${big.slice(0, 8).join('; ')})` : ''}`);
      console.log(`  line labels on a box: ${onBox ? onBox.length : 'unknown'}${onBox?.length ? ` (${onBox.slice(0, 4).join('; ')})` : ''}`);
      console.log(`  overlapping boxes: ${findings.overlaps.length}${findings.overlaps.length ? ` (${findings.overlaps.slice(0, 8).join('; ')})` : ''}`);
      console.log(`  lines that cross a box: ${findings.through.length}${findings.through.length ? ` (${findings.through.slice(0, 4).join('; ')})` : ''}`);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
