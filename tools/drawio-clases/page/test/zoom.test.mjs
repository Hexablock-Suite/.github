// zoom.test.mjs checks the wheel zoom and the drag of the built page in a headless Chromium.
// The build needs no browser, so these tests skip on a machine with no Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launch, serve } from '../cdp.mjs';

const DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MINI = path.join(DIR, '..', 'fixtures', 'mini.model.json');
const SCENARIO_REPO = path.join(DIR, '..', 'fixtures', 'mini-repo');
const SCENARIOS = path.join(SCENARIO_REPO, 'docs', 'architecture', 'scenarios.json');
const skip = findChrome() ? false : 'no Chromium on this machine';

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
  // The mini model has the checked fixture scenarios next to it, as the workflow leaves them. The wide model has none.
  const models = path.join(scratch, 'models');
  mkdirSync(models);
  const mini = path.join(models, 'mini.model.json');
  copyFileSync(MINI, mini);
  const s = spawnSync(process.execPath, [path.join(DIR, '..', 'scenarios.mjs'), SCENARIOS, MINI, SCENARIO_REPO, models], { encoding: 'utf8' });
  assert.equal(s.status, 0, s.stdout + s.stderr);
  const wide = path.join(models, 'wide.json');
  writeFileSync(wide, JSON.stringify(wideModel()));
  const r = spawnSync(process.execPath, [path.join(DIR, 'build.mjs'), mini, wide, '--out', scratch], { cwd: DIR, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  // The page reads its data files with fetch, and Chromium allows no fetch from a file URL.
  server = await serve(scratch);
  base = server.base;
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

// pick chooses a scenario in the selector of the tool bar, as a reader does, and waits for its boxes.
async function pick(id) {
  await page.eval(`(() => { const s = document.getElementById('sc'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change')); })()`);
  await page.wait(`document.documentElement.dataset.scenario === ${JSON.stringify(id)}`);
  await page.sleep(400);
}

// SCENARIO_STATE reads what the page shows of a scenario, in the coordinates of the SVG.
// A box gives its rectangle, its opacity, the stroke of its border and its marks. A group frame gives its title and its rectangle.
const SCENARIO_STATE = `(() => {
  const op = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
  const boxes = {};
  for (const g of document.querySelectorAll('#boxes .box')) {
    const [x, y] = /translate\\(([-\\d.]+) ([-\\d.]+)\\)/.exec(g.getAttribute('transform')).slice(1).map(Number);
    const bx = g.querySelector('.bx'), cs = getComputedStyle(bx);
    boxes[g.dataset.id] = { r: [x, y, +bx.getAttribute('width'), +bx.getAttribute('height')], op: op(g), dash: cs.strokeDasharray, sw: parseFloat(cs.strokeWidth),
      marks: [...g.querySelectorAll('.mk text')].map((t) => t.textContent) };
  }
  const titles = Object.fromEntries([...document.querySelectorAll('#titles .fold')].map((g) => [g.dataset.f, g.getAttribute('aria-label').split(',')[0]]));
  const groups = [...document.querySelectorAll('#frames .fr-g')].map((el) => ({ title: titles[el.dataset.f], op: op(el),
    r: ['x', 'y', 'width', 'height'].map((a) => +el.getAttribute(a)) }));
  const lines = Object.fromEntries([...document.querySelectorAll('#lines .e')].map((g) => {
    const pts = (d) => d.match(/-?[\\d.]+/g).map(Number);
    const ln = pts(g.querySelector('.ln').getAttribute('d')), hd = pts(g.querySelector('.hd').getAttribute('d'));
    return [g.dataset.i, { cls: g.getAttribute('class'), op: op(g), start: ln.slice(0, 2), tip: hd.slice(0, 2) }];
  }));
  return { boxes, groups, lines, hash: location.hash, value: document.getElementById('sc').value };
})()`;
const inside = (r, f) => r[0] >= f[0] && r[1] >= f[1] && r[0] + r[2] <= f[0] + f[2] && r[1] + r[3] <= f[1] + f[3];
const near = ([x, y], [bx, by, bw, bh]) => x >= bx - 1 && x <= bx + bw + 1 && y >= by - 1 && y <= by + bh + 1 &&
  Math.min(Math.abs(x - bx), Math.abs(x - bx - bw), Math.abs(y - by), Math.abs(y - by - bh)) < 1;

test('#7: the scenario selector lists the scenarios of the loaded repository and «No scenario», and «No scenario» is the page of today', { skip }, async () => {
  await open();
  const options = "[...document.querySelectorAll('#sc option')].map((o) => [o.value, o.textContent])";
  assert.deepEqual(await page.eval(options), [['', 'No scenario'], ['square-rules', 'A third rule set: Square Rules'], ['file-store', 'A second store: File Store']]);
  const today = await page.eval(SCENARIO_STATE);
  assert.equal(today.value, '');
  assert.equal(Object.keys(today.boxes).length, JSON.parse(readFileSync(MINI, 'utf8')).types.length);
  await pick('square-rules');
  await pick('');
  const back = await page.eval(SCENARIO_STATE);
  assert.deepEqual(back, today);
  assert.equal(back.hash, '#mini');
  assert.equal(await page.eval("document.querySelectorAll('#cv .sc-dim, #cv .sc-ext, #cv .added, #cv .mk').length"), 0);
  // A repository with no scenario file lists «No scenario» only.
  try {
    await page.eval("document.querySelector('#repo button[data-r=\"wide\"]').click()");
    await page.wait(`document.querySelectorAll('#boxes .box').length === ${WIDE_TYPES}`);
    assert.deepEqual(await page.eval(options), [['', 'No scenario']]);
  } finally {
    await page.eval("document.querySelector('#repo button[data-r=\"mini\"]').click()");
    await page.wait("document.documentElement.dataset.repo === 'mini'");
  }
});

test('#7: with a scenario, the groups of the unchanged types dim, the extension points light, each added box is dashed in its group with its line, and the boxes of edited files carry the mark', { skip }, async () => {
  await open();
  const today = await page.eval(SCENARIO_STATE);
  await pick('square-rules');
  const s = await page.eval(SCENARIO_STATE);
  // Engine and Phase sit in domain/engine, PlayGame in application. Rules is an extension point in domain/engine, so it does not dim.
  assert.deepEqual(s.groups.filter((g) => g.op < 0.5).map((g) => g.title).sort(), ['application', 'domain/engine']);
  for (const id of ['Engine', 'Phase', 'PlayGame', 'Outcome', 'UseCase']) assert.ok(s.boxes[id].op < 0.5, `${id} does not dim: ${s.boxes[id].op}`);
  for (const id of ['WebServer', 'MemoryStore', 'LinesRules', 'Color']) assert.equal(s.boxes[id].op, 1, id);
  for (const id of ['Rules', 'BaseRules']) {
    assert.equal(s.boxes[id].op, 1, id);
    assert.ok(s.boxes[id].sw > today.boxes[id].sw + 1, `${id} does not light: ${s.boxes[id].sw}`);
  }
  // SquareRules is new: a dashed box in the group of its file, with its extends line to BaseRules.
  const sq = s.boxes.SquareRules;
  assert.ok(sq, 'no box SquareRules');
  assert.notEqual(sq.dash, 'none');
  assert.ok(inside(sq.r, s.groups.find((g) => g.title === 'domain/rules').r), `SquareRules ${sq.r} is outside domain/rules`);
  const edges = JSON.parse(readFileSync(MINI, 'utf8')).edges.length;
  const line = s.lines[edges];
  assert.ok(line, 'no line for SquareRules');
  assert.equal(line.op, 1);
  assert.ok(near(line.start, sq.r), `the line starts at ${line.start}`);
  assert.ok(near(line.tip, s.boxes.BaseRules.r), `the line ends at ${line.tip}`);
  // web-server.ts is the edited file. WebServer sits in it.
  assert.deepEqual(Object.entries(s.boxes).filter(([, b]) => b.marks.length).map(([id, b]) => [id, b.marks]), [['WebServer', ['edited']]]);
  assert.deepEqual(Object.entries(today.boxes).filter(([, b]) => b.marks.length), []);
});

test('#7: with a scenario, the side panel lists the edited files with their change line, also the files with no type in the model', { skip }, async () => {
  await open();
  await pick('file-store');
  assert.equal(await page.eval("document.getElementById('panel').hidden"), false);
  assert.equal(await page.eval("document.getElementById('p-name').textContent"), 'A second store: File Store');
  const edits = await page.eval(`[...document.querySelectorAll('#p-body .edits > li')].map((li) => ({
    file: li.querySelector('.ef').textContent, change: li.querySelector('.ec').textContent,
    types: [...li.querySelectorAll('[data-go]')].map((b) => b.dataset.go), none: !!li.querySelector('.p-note') }))`);
  assert.deepEqual(edits, [
    { file: 'src/infrastructure/web-server.ts', change: 'build a FileStore in place of the MemoryStore', types: ['WebServer'], none: false },
    { file: 'src/main.ts', change: 'read the store folder from the environment', types: [], none: true },
  ]);
});

test('#7: the address names the scenario, so a link opens it', { skip }, async () => {
  await open();
  await pick('square-rules');
  assert.equal(await page.eval('location.hash'), '#mini~square-rules');
  await page.go('about:blank');
  await page.go(base + '#mini~file-store');
  await page.wait("document.documentElement.dataset.scenario === 'file-store'");
  await page.sleep(400);
  const s = await page.eval(SCENARIO_STATE);
  assert.equal(s.value, 'file-store');
  assert.notEqual(s.boxes.FileStore.dash, 'none');
  // A link can name a chosen class and a scenario together.
  await page.go('about:blank');
  await page.go(base + '#mini-FileStore~file-store');
  await page.wait("!document.getElementById('panel').hidden && document.getElementById('p-name').textContent === 'FileStore'");
  assert.equal(await page.eval('location.hash'), '#mini-FileStore~file-store');
  // «No scenario» drops the scenario from the address.
  await pick('');
  assert.equal(await page.eval('location.hash'), '#mini');
});

// withFetch runs a step with a page script that wraps fetch, from the next page load on. The script goes away after the step.
async function withFetch(source, step) {
  const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source });
  try {
    await step();
  } finally {
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
}
// openMini loads the page with the mini model and waits until it shows.
async function openMini(hash = '#mini') {
  await page.go('about:blank');
  await page.go(base + hash);
  await page.wait("document.documentElement.dataset.ready === '1' && document.documentElement.dataset.repo === 'mini'");
}
const choose = (id) => page.eval(`(() => { const s = document.getElementById('sc'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change')); })()`);
const busy = () => page.eval("document.getElementById('stage').getAttribute('aria-busy')");
const statusText = () => page.eval("document.getElementById('status').textContent");

test('#7: a newer choice that replaces a pending scenario load leaves the stage not busy', { skip }, async () => {
  const slow = `(() => { const f = window.fetch; window.fetch = (u, ...a) => String(u).includes('scenario-file-store.positions')
    ? new Promise((r) => setTimeout(r, 1500)).then(() => f(u, ...a)) : f(u, ...a); })()`;
  await withFetch(slow, async () => {
    await openMini();
    await choose('file-store');
    await page.sleep(100);
    assert.equal(await busy(), 'true');
    await choose('');
    await page.sleep(2000);
    assert.equal(await busy(), null);
    assert.equal(await page.eval('document.documentElement.dataset.scenario'), '');
    assert.equal(await page.eval('location.hash'), '#mini');
  });
});

test('#7: a linked scenario whose positions do not load keeps its address, so a reload tries it again', { skip }, async () => {
  const failing = `(() => { const f = window.fetch; window.fetch = (u, ...a) => String(u).includes('scenario-file-store.positions')
    ? Promise.resolve(new Response('', { status: 500 })) : f(u, ...a); })()`;
  await withFetch(failing, async () => {
    await openMini('#mini~file-store');
    assert.equal(await page.eval('document.documentElement.dataset.scenario'), '');
    assert.equal(await page.eval('location.hash'), '#mini~file-store');
    assert.equal(await statusText(), 'The scenario did not load. Reload the page.');
    assert.equal(await busy(), null);
  });
});

test('#7: only a missing scenario file means no scenario; a failed load says so and is tried again later', { skip }, async () => {
  // The first request of the scenario file of mini fails with 500, the second one gets a body that is not JSON. The third one reaches the server.
  const failing = `(() => { const f = window.fetch; let n = 0; window.fetch = (u, ...a) => {
    if (!String(u).endsWith('mini.scenarios.json')) return f(u, ...a);
    n += 1;
    if (n === 1) return Promise.resolve(new Response('', { status: 500 }));
    if (n === 2) return Promise.resolve(new Response('{', { status: 200 }));
    return f(u, ...a);
  }; })()`;
  const options = () => page.eval("[...document.querySelectorAll('#sc option')].map((o) => o.value)");
  const openRepo = async (r) => {
    await page.eval(`document.querySelector('#repo button[data-r="${r}"]').click()`);
    await page.wait(`document.documentElement.dataset.repo === '${r}' && !document.getElementById('stage').hasAttribute('aria-busy')`, 60000);
  };
  await withFetch(failing, async () => {
    await openMini();
    assert.deepEqual(await options(), ['']);
    assert.equal(await statusText(), 'The scenarios did not load. Reload the page.');
    await openRepo('wide');
    await openRepo('mini');
    assert.deepEqual(await options(), ['']);
    assert.equal(await statusText(), 'The scenarios did not load. Reload the page.');
    await openRepo('wide');
    await openRepo('mini');
    assert.deepEqual(await options(), ['', 'square-rules', 'file-store']);
  });
});
