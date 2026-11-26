// zoom.test.mjs checks the wheel zoom and the drag of the built page in a headless Chromium.
// The build needs no browser, so these tests skip on a machine with no Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch } from '../cdp.mjs';

const DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MINI = path.join(DIR, '..', 'fixtures', 'mini.model.json');
const skip = findChrome() ? false : 'no Chromium on this machine';
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json' };

// wideModel has 960 classes: eight folders of 30 classes in each layer. Chains of extends make each folder tall.
// Its canvas is about as large as the canvas of the App model, so the fit zoom of a 1440 by 900 window is under 0.1.
// The first folder of each band sits at the left edge of the band, under the band label.
const WIDE_TYPES = 960;
function wideModel() {
  const types = [];
  const edges = [];
  for (const layer of [4, 3, 2, 1]) {
    for (let f = 0; f < 8; f++) {
      for (let i = 0; i < 30; i++) {
        const id = `L${layer}F${f}T${i}`;
        types.push({
          id, name: id, kind: 'class', abstract: false, status: 'code', sprint: null, stereotypes: [],
          layer, part: 'core', file: `src/layer${layer}/folder${f}/${id.toLowerCase()}.ts`, line: 1, typeParams: [],
          attrs: [], ops: [{ vis: '+', name: 'run', typeParams: [], params: [], ret: 'void', abstract: false, static: false }],
          values: [], alias: null, views: [], requirement: null,
        });
        if (i % 3) edges.push({ from: id, to: `L${layer}F${f}T${i - 1}`, kind: 'extends', label: null, pattern: null, status: 'code', views: [] });
      }
    }
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { repo: 'hexablock-wide', head: '0000000', parts: [{ id: 'core', title: 'Core' }], types, edges };
}

let scratch, server, browser, page, base;
before(async () => {
  if (skip) return;
  scratch = mkdtempSync(path.join(tmpdir(), 'drawio-clases-zoom-test-'));
  // The site holds the mini model first, so the page opens it by default, and the wide model second.
  const wide = path.join(scratch, 'wide.json');
  writeFileSync(wide, JSON.stringify(wideModel()));
  const r = spawnSync(process.execPath, [path.join(DIR, 'build.mjs'), MINI, wide, '--out', scratch], { cwd: DIR, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  // The page reads its data files with fetch, and Chromium allows no fetch from a file URL.
  server = createServer((req, res) => {
    const name = req.url.split(/[?#]/)[0].slice(1) || 'index.html';
    const file = path.join(scratch, path.basename(name));
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await launch();
  page = await browser.page();
  await page.viewport(1200, 800);
});
after(async () => {
  if (browser) await browser.close();
  if (server) server.close();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// open loads the page and waits for the boxes.
async function open() {
  await page.go(base);
  await page.wait("document.querySelectorAll('#boxes .box').length > 0");
  await page.sleep(500);
}
// drawn reads the view that the SVG holds: its scale and its offset.
const drawn = async () => {
  const t = await page.eval("document.getElementById('vp').getAttribute('transform')");
  const [tx, ty, k] = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/.exec(t).slice(1).map(Number);
  return { k, tx, ty };
};
// settle waits for the last draw: the view stops and the preview is gone.
async function settle() {
  let last = '';
  for (let same = 0, tries = 0; same < 6; tries++) {
    assert.ok(tries < 100, `the view did not settle: ${last}`);
    await page.sleep(60);
    const now = await page.eval("document.getElementById('vp').getAttribute('transform') + '|' + document.getElementById('cv').style.transform");
    same = now === last && now.endsWith('|') ? same + 1 : 0;
    last = now;
  }
}
const wheel = (x, y, deltaY) => page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
// countDraws counts each write of the view into the SVG, from now on.
const countDraws = () => page.eval("(() => { window.draws = 0; new MutationObserver((l) => { window.draws += l.length; }).observe(document.getElementById('vp'), { attributes: true, attributeFilter: ['transform'] }); })()");

test('zoom: a burst of wheel events draws the SVG a few times, and the view ends where the events put it', { skip }, async () => {
  await open();
  const start = await drawn();
  await countDraws();
  // A real wheel does not wait for the page, so the events go out with no wait for an answer.
  const EVENTS = 40, X = 380, Y = 520, DELTA = -10;
  const sent = [];
  for (let i = 0; i < EVENTS; i++) { sent.push(wheel(X, Y, DELTA)); await page.sleep(4); }
  await Promise.all(sent);
  await settle();
  const end = await drawn();
  const draws = await page.eval('window.draws');
  assert.ok(draws < EVENTS / 2, `${draws} draws for ${EVENTS} wheel events`);
  // The wheel factor of the page is exp(-deltaY * 0.0018) for each event.
  const want = start.k * Math.exp(-DELTA * 0.0018 * EVENTS);
  assert.ok(Math.abs(end.k - want) < want * 1e-3, `scale ${end.k}, expected ${want}`);
  // The point of the diagram under the pointer stays under the pointer. The view counts from the corner of the stage.
  const [left, top] = await page.eval("(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.left, r.top]; })()");
  const sx = X - left, sy = Y - top;
  const px = (sx - start.tx) / start.k, py = (sy - start.ty) / start.k;
  assert.ok(Math.abs(end.k * px + end.tx - sx) < 1, `x moved to ${end.k * px + end.tx}, expected ${sx}`);
  assert.ok(Math.abs(end.k * py + end.ty - sy) < 1, `y moved to ${end.k * py + end.ty}, expected ${sy}`);
});

test('zoom: a preview that comes back to the drawn scale leaves no preview behind', { skip }, async () => {
  await open();
  // The largest scale is 3. The first event reaches it and draws. The second one starts a preview. The third one comes back to 3.
  await wheel(600, 400, -5000);
  await wheel(600, 400, 30);
  await wheel(600, 400, -5000);
  await page.sleep(500);
  assert.equal(await page.eval("document.getElementById('cv').style.transform"), '');
  assert.ok(Math.abs((await drawn()).k - 3) < 1e-6, `scale ${(await drawn()).k}`);
});

test('drag: at the far level, a drag that starts on a box moves the view and keeps the scale', { skip }, async () => {
  await open();
  // The far level starts under the scale 0.44.
  for (let i = 0; i < 400 && (await drawn()).k >= 0.4; i++) { await wheel(600, 400, 40); await page.sleep(10); }
  await settle();
  const start = await drawn();
  assert.ok(start.k < 0.44, `scale ${start.k} is not at the far level`);
  const [x, y] = await page.eval("(() => { const b = document.querySelector('#boxes .box').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()");
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + i * 6, y: y + i * 3, button: 'left', buttons: 1 }); await page.sleep(16); }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 60, y: y + 30, button: 'left', clickCount: 1 });
  await page.sleep(700);
  await settle();
  const end = await drawn();
  assert.ok(Math.abs(end.k - start.k) < 1e-4, `scale went from ${start.k} to ${end.k}`);
  assert.ok(Math.abs(end.tx - start.tx - 60) < 1 && Math.abs(end.ty - start.ty - 30) < 1, `the view moved by ${end.tx - start.tx}, ${end.ty - start.ty}`);
});

test('keyboard: a box that takes the focus from the Tab key still comes into view', { skip }, async () => {
  await open();
  for (let i = 0; i < 400 && (await drawn()).k >= 0.4; i++) { await wheel(600, 400, 40); await page.sleep(10); }
  await settle();
  await page.eval("document.getElementById('cv').focus()");
  await page.key('Tab', 'Tab', 9);
  await page.sleep(700);
  await settle();
  assert.equal(await page.eval("!!document.activeElement.closest('.box')"), true, 'the Tab key did not reach a box');
  // ensureVisible centers a focused box at the near level, 0.9, when the page is at the far level.
  assert.ok(Math.abs((await drawn()).k - 0.9) < 1e-3, `scale ${(await drawn()).k}`);
});

// LAYER_LABELS are the four band labels of the page, layer 4 first.
const LAYER_LABELS = [
  'Layer 4 · Frameworks and drivers / Infrastructure',
  'Layer 3 · Interface adapters / Adapters',
  'Layer 2 · Use cases / Application',
  'Layer 1 · Entities / Domain',
];

test('#6: the band labels, the layer chip of the side panel and the layer tab of the highlight menu show both names of each layer', { skip }, async () => {
  await open();
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#tags .tag')].map((el) => el.textContent)"), LAYER_LABELS);
  await page.eval("document.getElementById('hl-btn').click()");
  await page.eval("document.querySelector('.hl-tabs button[data-tab=\"l\"]').click()");
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#hl-opts .opt span:first-child')].map((el) => el.textContent)"), LAYER_LABELS);
  // A link with a type name opens the side panel of that type. Engine is a type of layer 1.
  await page.go('about:blank');
  await page.go(base + '#mini-Engine');
  await page.wait("!document.getElementById('panel').hidden");
  assert.equal(await page.eval("document.querySelector('#p-where .chip-l').textContent"), LAYER_LABELS[3]);
});

test('#6: at the fit zoom of a 1440 × 900 window, no band label overlaps a group frame of its band', { skip }, async () => {
  await page.viewport(1440, 900);
  try {
    await open();
    await page.eval("document.querySelector('#repo button[data-r=\"wide\"]').click()");
    await page.wait(`document.querySelectorAll('#boxes .box').length === ${WIDE_TYPES}`);
    await page.eval("document.getElementById('fit').click()");
    await page.sleep(500);
    await settle();
    const { k } = await drawn();
    assert.ok(k < 0.1, `the fit zoom ${k} of the wide model is not under 0.1`);
    const seen = await page.eval(`(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      const layerOf = (el) => +[...el.classList].find((c) => /^L\\d$/.test(c)).slice(1);
      const tags = [...document.querySelectorAll('#tags .tag')].map((el) => ({ layer: layerOf(el), hidden: el.hidden, ...box(el) }));
      const frames = [...document.querySelectorAll('#frames rect.fr-g')].map((el) => ({ f: el.dataset.f, layer: layerOf(el), ...box(el) }));
      const far = Object.fromEntries([...document.querySelectorAll('#titles .fold')].map((g) => {
        const zl = g.querySelector('.zl');
        return [g.dataset.f, { off: zl.classList.contains('off'), l: zl.getBoundingClientRect().left }];
      }));
      return { tags, frames, far };
    })()`);
    assert.deepEqual(seen.tags.map((t) => [t.layer, t.hidden]), [[4, false], [3, false], [2, false], [1, false]]);
    for (const tag of seen.tags) {
      const frames = seen.frames.filter((f) => f.layer === tag.layer);
      assert.ok(frames.length > 0, `band ${tag.layer} has no folder`);
      // A frame under the label keeps a margin of 4 pixels, the margin of the label rooms of the page.
      for (const f of frames) {
        if (Math.min(f.r, tag.r) - Math.max(f.l, tag.l) <= 0) continue;
        assert.ok(f.t - tag.b >= 4, `band ${tag.layer}: the label ends at ${tag.b.toFixed(1)}, the folder at ${f.l.toFixed(1)} starts at ${f.t.toFixed(1)}`);
      }
      // The folder at the left edge of the band shows its far label at the left end of its room.
      const first = frames.reduce((a, b) => (b.l < a.l ? b : a));
      assert.equal(seen.far[first.f].off, false, `band ${tag.layer}: the far label of the first folder hides`);
      assert.ok(seen.far[first.f].l - first.l < 2, `band ${tag.layer}: the far label starts at ${seen.far[first.f].l.toFixed(1)}, the folder at ${first.l.toFixed(1)}`);
    }
  } finally {
    // The page stores the chosen repository. The other tests open the mini model.
    await page.eval("document.querySelector('#repo button[data-r=\"mini\"]').click()");
    await page.viewport(1200, 800);
  }
});
