#!/usr/bin/env node
// export.mjs writes one image of each extensibility scenario of a built site.
// Usage: node export.mjs <site-dir> <out-dir>
// It reads the repositories from the switch of the page and the scenarios from each <repo>.scenarios.json of the site.
// It serves the site on 127.0.0.1, because fetch does not read file:// addresses.
// It opens each scenario at its address #<repo key>~<scenario id> in a headless Chromium with a throwaway profile (cdp.mjs).
// The page fits the view to the groups that the scenario touches, and shows the scenario title and the legend.
// The window starts at 1440 by 900 CSS pixels. It grows, up to three times that size, until the class names read at the fit zoom.
// It writes <out-dir>/<repo key>-<scenario id>.png at scale 2, and prints one line per image with its window size.
// With no scenario in the site, it needs no browser, writes nothing and says so.
// A missing Chromium or a page that fails gives one error line, writes no image and ends with exit code 1.
// It stops the browser and the server that it started, also after an error.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findChrome, launch, serve } from './cdp.mjs';

const USAGE = 'usage: node export.mjs <site-dir> <out-dir>';
// The first window of an image in CSS pixels. Each side of the image has SCALE times as many pixels.
const WIDTH = 1440, HEIGHT = 900, SCALE = 2;
// The page shows the class names from the zoom 0.44 (LOD1 of app.js). The window grows until the fit zoom reaches MIN_K, up to MAX_GROW times its first size.
const MIN_K = 0.5, MAX_GROW = 3;
// The page has this time to load a scenario, in milliseconds.
const LOAD_MS = 30000;

class InputError extends Error {}

// siteScenarios gives the repository key, the id and the title of each scenario of the site, in the order of the page.
// The build writes one switch button per repository, with its key and its file name.
function siteScenarios(site) {
  const page = path.join(site, 'index.html');
  if (!existsSync(page)) throw new InputError(`${page} is missing: build the site first`);
  const html = readFileSync(page, 'utf8');
  const list = [];
  for (const [, key, file] of html.matchAll(/<button [^>]*data-r="([a-z0-9]+)" data-file="([^"]+)"/g)) {
    const name = path.join(site, `${file}.scenarios.json`);
    if (!existsSync(name)) continue;
    let data;
    try {
      data = JSON.parse(readFileSync(name, 'utf8'));
    } catch (e) {
      throw new InputError(`the scenario file ${name} is not JSON: ${String(e.message).split('\n')[0]}`);
    }
    for (const s of data.scenarios || []) list.push({ key, id: s.id, title: s.title });
  }
  return list;
}

// shoot opens one scenario and gives its image and its window size. It fails when the page does not show the scenario or throws an exception.
async function shoot(page, base, s) {
  let grow = 1;
  await page.viewport(WIDTH, HEIGHT, false, SCALE);
  const hash = `#${s.key}~${s.id}`;
  const fail = (why) => new InputError(`the page ${hash} did not show its scenario: ${why}`);
  // A change of the hash alone loads no new page, so the page goes blank first.
  await page.go('about:blank');
  page.log.length = 0;
  await page.go(base + hash);
  try {
    await page.wait("document.documentElement.dataset.ready === '1' && !document.getElementById('stage').hasAttribute('aria-busy')", LOAD_MS);
  } catch {
    throw fail(page.log.join('; ') || 'the page did not load in time');
  }
  const shown = await page.eval('document.documentElement.dataset.scenario');
  if (shown !== s.id) throw fail(page.log.join('; ') || `it shows "${shown}"`);
  let view = await page.eval('window.exportScenario()');
  if (!view || view.title !== s.title) throw fail(`the page gives the title "${view && view.title}"`);
  // The panel and the legend keep their size, so the zoom grows slower than the window. A few steps reach MIN_K.
  for (let step = 0; view.k < MIN_K && grow < MAX_GROW && step < 4; step++) {
    grow = Math.min(MAX_GROW, Math.ceil(grow * (MIN_K / view.k) * 4) / 4);
    await page.viewport(Math.round(WIDTH * grow), Math.round(HEIGHT * grow), false, SCALE);
    view = await page.eval('window.exportScenario()');
  }
  // The fades of the page end before the image.
  await page.sleep(400);
  const errors = page.log.filter((l) => l.startsWith('exception:'));
  if (errors.length) throw fail(errors.join('; '));
  return { png: await page.shot(), width: Math.round(WIDTH * grow), height: Math.round(HEIGHT * grow) };
}

async function main(argv) {
  if (argv.length !== 2) throw new InputError(USAGE);
  const [site, out] = argv;
  const scenarios = siteScenarios(site);
  if (!scenarios.length) {
    console.log(`${site}: no scenario, no image written`);
    return 0;
  }
  if (!findChrome()) throw new InputError('no Chromium found: set CHROME_BIN');
  // All images are taken before the first write, so a failure leaves no partial set.
  const images = [];
  const server = await serve(site);
  let browser = null;
  try {
    browser = await launch();
    const page = await browser.page();
    for (const s of scenarios) images.push({ file: path.join(out, `${s.key}-${s.id}.png`), title: s.title, ...(await shoot(page, server.base, s)) });
  } finally {
    // The server closes even when the browser does not close cleanly.
    try {
      if (browser) await browser.close();
    } finally {
      server.close();
    }
  }
  mkdirSync(out, { recursive: true });
  for (const im of images) {
    writeFileSync(im.file, im.png);
    console.log(`${im.file}: ${im.title} (window ${im.width}x${im.height}, scale ${SCALE})`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exitCode = 1;
  }
}
