#!/usr/bin/env node
// glyphs.mjs writes glyphs.json: the glyph widths of the font that the class names use.
// The build reads that table, so it needs no browser.
// This maintenance script loads the web font in a headless Chromium and measures each glyph.
// Usage: node glyphs.mjs
// It needs network access to Google Fonts and a local Chromium (see cdp.mjs).
import { writeFileSync } from 'node:fs';
import { launch } from './cdp.mjs';

const FAMILY = 'IBM Plex Sans';
const WEIGHT = 600;
// The boxes print names at 12px. The table holds the widths at that size.
// The sum of the glyph widths and the kerning values of a name then equals the width that the browser measures.
const SIZE = 12;
const CHARS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

const browser = await launch();
try {
  const page = await browser.page();
  await page.go('about:blank');
  const table = await page.eval(`(async () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,${WEIGHT};1,${WEIGHT}&display=block';
    document.head.append(link);
    await new Promise((r) => { link.onload = r; link.onerror = r; });
    const fonts = { normal: "${WEIGHT} ${SIZE}px '${FAMILY}'", italic: "italic ${WEIGHT} ${SIZE}px '${FAMILY}'" };
    for (const f of Object.values(fonts)) await document.fonts.load(f);
    if (!Object.values(fonts).every((f) => document.fonts.check(f))) return null;
    const ctx = document.createElement('canvas').getContext('2d');
    const chars = ${JSON.stringify(CHARS)};
    const out = {};
    for (const [style, font] of Object.entries(fonts)) {
      ctx.font = font;
      const w = (s) => ctx.measureText(s).width;
      const advance = {};
      for (const c of chars) advance[c] = w(c);
      // A pair whose width is not the sum of its glyphs has a kerning value.
      const kern = {};
      for (const a of chars) for (const b of chars) {
        const d = w(a + b) - advance[a] - advance[b];
        if (d !== 0) kern[a + b] = d;
      }
      out[style] = { advance, kern };
    }
    return out;
  })()`);
  if (!table) throw new Error('the web font did not load, so the widths would be wrong');
  const doc = { font: `${WEIGHT} ${FAMILY}`, size: SIZE, ...table };
  writeFileSync(new URL('glyphs.json', import.meta.url), JSON.stringify(doc, null, 1) + '\n');
  console.log('glyphs.json:', Object.keys(table.normal.advance).length, 'glyphs,',
    Object.keys(table.normal.kern).length, 'normal and', Object.keys(table.italic.kern).length, 'italic kerning pairs');
} finally {
  await browser.close();
}
