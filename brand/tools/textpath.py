"""Turn a line of text into one SVG path, so the SVG needs no web font.

GitHub shows a README SVG as an image. An SVG image cannot load a web font,
so the brand fonts must be drawn as outlines. HarfBuzz shapes the text
(kerning and ligatures) and fontTools gives the glyph outlines.

Fonts come from brand/tools/fonts/ (run fetch_fonts.py once).
Run with a Python that has the packages in requirements.txt.
"""
from functools import lru_cache
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT_DIR = Path(__file__).resolve().parent / 'fonts'
FONTS = {
    ('Unbounded', 800): FONT_DIR / 'Unbounded-800.ttf',
    ('Archivo', 400): FONT_DIR / 'Archivo-400.ttf',
    ('Archivo', 500): FONT_DIR / 'Archivo-500.ttf',
    ('Archivo', 600): FONT_DIR / 'Archivo-600.ttf',
}


@lru_cache(maxsize=None)
def _load(family, weight):
    path = FONTS[(family, weight)]
    tt = TTFont(path)
    face = hb.Face(path.read_bytes())
    return tt, hb.Font(face), tt['head'].unitsPerEm


def _shape(text, family, weight):
    tt, font, upem = _load(family, weight)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {'kern': True, 'liga': True})
    return tt, upem, buf.glyph_infos, buf.glyph_positions


def text_width(text, family, weight, size, letter_spacing=0.0):
    """Advance width in px of the shaped text, letter spacing included."""
    _, upem, infos, pos = _shape(text, family, weight)
    scale = size / upem
    return sum(p.x_advance for p in pos) * scale + letter_spacing * len(infos)


def text_path(text, family, weight, size, x, y, letter_spacing=0.0, anchor='start'):
    """Return (path_d, width). x and y are the baseline origin, as in SVG <text>.

    anchor is 'start', 'middle' or 'end', like text-anchor.
    letter_spacing is in px and is added after each glyph, like CSS.
    """
    tt, upem, infos, pos = _shape(text, family, weight)
    scale = size / upem
    width = text_width(text, family, weight, size, letter_spacing)
    if anchor == 'middle':
        x -= width / 2
    elif anchor == 'end':
        x -= width
    glyph_set = tt.getGlyphSet()
    order = tt.getGlyphOrder()
    pen = SVGPathPen(glyph_set, ntos=lambda v: f'{v:.2f}'.rstrip('0').rstrip('.'))
    cursor = 0.0
    for info, p in zip(infos, pos):
        gx = x + (cursor + p.x_offset) * scale
        gy = y - p.y_offset * scale
        # Font units point up; SVG units point down. The matrix flips y.
        glyph_set[order[info.codepoint]].draw(TransformPen(pen, (scale, 0, 0, -scale, gx, gy)))
        cursor += p.x_advance + letter_spacing / scale
    return pen.getCommands(), width


if __name__ == '__main__':
    # Check: ds-rombo/gen.py measured «HexaBlock» in Unbounded 800 at 6.750 px per 1 px of size.
    print('HexaBlock per px:', round(text_width('HexaBlock', 'Unbounded', 800, 1), 3))
    d, w = text_path('HexaBlock', 'Unbounded', 800, 112, 60, 156, letter_spacing=-1)
    print('path chars:', len(d), 'width at 112 px with -1 spacing:', round(w, 1))
