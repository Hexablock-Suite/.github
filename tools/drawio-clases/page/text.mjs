// text.mjs gives the build the box rules of the page and the width of a class name.
// The box rules come from src/box-text.js, the same file that the page runs.
// The name widths come from glyphs.json, so the build needs no browser.
import { readFileSync } from 'node:fs';

export const BOX_TEXT = readFileSync(new URL('src/box-text.js', import.meta.url), 'utf8');

// boxText runs box-text.js in its own scope and gives its functions.
export const boxText = new Function(BOX_TEXT + '\nreturn { BOX, isAttr, folderOf, zoneName, relationText, patternSets, stereotypesOf, stereoText, boxModel };')();

const GLYPHS = JSON.parse(readFileSync(new URL('glyphs.json', import.meta.url), 'utf8'));

// A character that the table does not have counts as the widest glyph, so a box is never too narrow.
const widest = (style) => Math.max(...Object.values(GLYPHS[style].advance));
const WIDEST = { normal: widest('normal'), italic: widest('italic') };

// nameWidth gives the width of a class name in pixels, in the font of the box title.
// It sums the glyph widths and the kerning of each pair, in reading order, as the browser does.
// It rounds up to a tenth of a pixel.
export function nameWidth(name, italic) {
  const style = italic ? 'italic' : 'normal';
  const { advance, kern } = GLYPHS[style];
  let w = 0;
  for (let i = 0; i < name.length; i++) {
    w += advance[name[i]] ?? WIDEST[style];
    if (i) w += kern[name[i - 1] + name[i]] || 0;
  }
  return Math.ceil(w * 10) / 10;
}
