#!/usr/bin/env python3
"""Build the HexaBlock avatar and the two social previews as SVG.

Usage: python avatar-previews/gen.py [--root <dir>] <preview dir>

Run it from brand/tools/ with a Python that has the packages in requirements.txt.
By default the SVG files go to brand/ of this repository.
With --root, they go to <dir>/brand/ instead.

Every colour, font, size and shape comes from brand/DESIGN.md (commit 82ef81d)
or from the reference generators ds-componentes/gen.py and ds-rombo/gen.py.
The script writes the SVG files to the brand dir and copies them, with an HTML
wrapper each, to the preview dir. Snap Chromium renders the wrappers (render.sh).
The build stops when a contrast gate or a layout gate fails.
All text is an SVG path from textpath.py, so no SVG needs a web font.
"""

import argparse
import math
import re
import sys
from html import escape
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent  # brand/tools/
sys.path.insert(0, str(TOOLS))
from textpath import text_path, text_width  # noqa: E402  (shared helper; T2 uses the same one)

REPO = TOOLS.parent.parent  # the repository root, two levels above brand/tools/

# ---------- WCAG 2.x contrast (same formulas as ds-componentes/gen.py) ----------


def rgb(c):
    c = c.lstrip('#')
    return tuple(int(c[i:i + 2], 16) / 255 for i in (0, 2, 4))


def lin(v):
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4


def lum(c):
    r, g, b = (lin(v) for v in rgb(c))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def cr(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


TEXT_MIN, LARGE_MIN, GRAPHIC_MIN = 4.5, 3.0, 3.0
CHECKS = []


def gate(label, value, minimum):
    """Record one check and stop the build when it fails."""
    CHECKS.append((label, value, minimum))
    if value < minimum:
        raise SystemExit(f'FAIL {label}: {value:.2f} < {minimum}')
    return value


def text_gate(label, fg, bg, px, bold=False):
    """Text pair: 3:1 for 24 px and up, or bold 18.66 px and up; 4.5:1 otherwise."""
    large = px >= 24 or (bold and px >= 18.66)
    return gate(f'text {label} ({px} px)', cr(fg, bg), LARGE_MIN if large else TEXT_MIN)


# ---------- Tokens from brand/DESIGN.md (dark theme, the S3 principal version) ----------

NEUTRAL = '#0d0e13'  # colors.neutral-dark: page background
BOARD = '#050609'  # colors.board-dark: the board behind the cells
CELL = '#2a2c33'  # colors.cell-dark: a cell with no tile
PRIMARY = '#f2f3f6'  # colors.primary-dark: headlines and body text
INK = '#121319'  # colors.ink: type on the signal field
SIG = '#1ad8ff'  # colors.tertiary: the signal
EDGE = '#00728a'  # colors.button-edge: the edge under the cyan face
TILES = [  # colors.tile-*-dark, in the DESIGN.md order
    ('Amarillo', '#ffc800'), ('Rojo', '#ff4b55'), ('Esmeralda', '#22d47a'),
    ('Azul', '#5b84ff'), ('Violeta', '#a777ff'), ('Magenta', '#ff4fb3'),
]

# typography.banner-title: Unbounded 800 at 112 px. The banner sets it with -1 px letter spacing.
NAME = dict(family='Unbounded', weight=800, size=112, spacing=-1)
# typography.banner-tagline: Archivo 500 at 26 px.
DESC = dict(family='Archivo', weight=500, size=26, spacing=0)

SQ3 = math.sqrt(3)

# ---------- Avatar ----------

# The published avatar geometry (brand/avatar.svg, commit f6c5b53), copied point by point.
# The centre cell is the engine. The six cells around it are board cells. All cells are flat-top.
AVATAR_ENGINE = '639.4,512 575.7,622.3 448.3,622.3 384.6,512 448.3,401.7 575.7,401.7'
AVATAR_RING = [
    '639.4,227.4 575.7,337.7 448.3,337.7 384.6,227.4 448.3,117.1 575.7,117.1',
    '885.8,369.7 822.2,480 694.8,480 631.1,369.7 694.8,259.4 822.2,259.4',
    '885.8,654.3 822.2,764.6 694.8,764.6 631.1,654.3 694.8,544 822.2,544',
    '639.4,796.6 575.7,906.9 448.3,906.9 384.6,796.6 448.3,686.3 575.7,686.3',
    '392.9,654.3 329.2,764.6 201.8,764.6 138.2,654.3 201.8,544 329.2,544',
    '392.9,369.7 329.2,480 201.8,480 138.2,369.7 201.8,259.4 329.2,259.4',
]
AVATAR_LABEL = 'HexaBlock Suite: one engine cell surrounded by six board cells'

# Roles. The engine takes the signal: it is the one accent and the focal point.
# The signal is never a tile, and the engine cell is not a tile.
# The six board cells take the edge cyan. DESIGN.md already pairs it with the cyan face.
# The board and empty-cell colours measure under 3:1 against the background, so they vanish at 40 px.
AVATAR_BG, AVATAR_CENTRE, AVATAR_CELLS = NEUTRAL, SIG, EDGE


def avatar_svg():
    gate('avatar: engine cell vs background', cr(AVATAR_CENTRE, AVATAR_BG), GRAPHIC_MIN)
    gate('avatar: board cell vs background', cr(AVATAR_CELLS, AVATAR_BG), GRAPHIC_MIN)
    gate('avatar: board cell vs engine cell (its neighbour)', cr(AVATAR_CELLS, AVATAR_CENTRE), GRAPHIC_MIN)
    out = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" '
        f'role="img" aria-label="{escape(AVATAR_LABEL)}">',
        f'<title>{escape(AVATAR_LABEL)}</title>',
        f'<rect width="1024" height="1024" fill="{AVATAR_BG}"/>',
        f'<polygon points="{AVATAR_ENGINE}" fill="{AVATAR_CENTRE}"/>',
    ]
    out += [f'<polygon points="{pts}" fill="{AVATAR_CELLS}"/>' for pts in AVATAR_RING]
    out.append('</svg>')
    return '\n'.join(out) + '\n'


# ---------- Social preview ----------

W, H = 1280, 640
SAFE_X = 40  # other sites crop a 2:1 preview to about 1.91:1; text keeps 40 px from each side
TEXT_X = 60  # the left text edge of the Corte banner lockup

# The signal field is a band as tall as the Corte banner (320 px).
# It ends in a 60-degree cut over the full field height (DESIGN.md Shapes, «Corte»).
# The cut starts at the top-right corner, with no inset. Its horizontal run is the field height / sqrt 3.
# The bottom end is rounded to a whole px, as the banner rounds 815.
FIELD_H = 320
CUT_TOP = W  # the cut starts here at y = 0
CUT_BOTTOM = round(W - FIELD_H / SQ3)  # 1095: the cut ends here at y = 320
NAME_GAP = 24  # each text line on the field ends 24 px or more before the cut, measured at its baseline

# The board crop of banner_corte in ds-rombo/gen.py: R = 36, cells drawn 3.5 px smaller, pointy-top.
# The cell orientation is an open TODO in DESIGN.md; the crop follows the banner reference.
CELL_R = 36
CELL_DRAW_R = CELL_R - 3.5
LINE_K = 7  # cells with q + r == 7 form the line about to clear, as in banner_corte
SKIP_ROWS = (6, 7)  # these rows stay empty, so the description sits on the plain board colour

# Descriptions are quoted from profile/README.md (lines 53 and 54), the "What it is" column.
REPOS = [
    ('hexablock-app', 'Mobile client: the four games on one generic engine.'),
    ('hexablock-api', 'REST backend: users, progress, leaderboards and level definitions, with Drizzle and OpenAPI docs.'),
]


def hexpts(cx, cy, r, pointy=True):
    off = 30 if pointy else 0
    return [(cx + r * math.cos(math.radians(off + 60 * k)), cy + r * math.sin(math.radians(off + 60 * k)))
            for k in range(6)]


def pts_attr(pts):
    return ' '.join(f'{x:.1f},{y:.1f}' for x, y in pts)


def field_points():
    """The field polygon in whole px, written like the banner polygon."""
    return f'0,0 {CUT_TOP},0 {CUT_BOTTOM},{FIELD_H} 0,{FIELD_H}'


def field_right(y):
    """Right edge x of the field at height y, on the straight edge of the cut."""
    return CUT_TOP + (CUT_BOTTOM - CUT_TOP) * y / FIELD_H


def under_field(x, y):
    return 0 <= y <= FIELD_H and x <= field_right(y)


def corte_fill(q, r):
    """Deterministic scatter from banner_corte: about four cells in ten hold a tile."""
    h = (q * 73856093) ^ (r * 19349663)
    h = (h ^ (h >> 7)) & 0xffff
    return h % 100 < 40, h % 6


def board_cells():
    """Cells of the banner crop, extended to the full 1280 x 640 preview."""
    cells = []
    for r in range(-1, 14):
        if r in SKIP_ROWS:
            continue
        for q in range(-20, 20):
            x = 760 + SQ3 * CELL_R * (q + r / 2)
            y = 4 + 1.5 * CELL_R * r
            if not (-CELL_R < x < W + CELL_R and -CELL_R < y < H + CELL_R):
                continue
            pts = hexpts(x, y, CELL_DRAW_R)
            # The field covers this cell completely; the SVG does not need it.
            if all(under_field(px, py) for px, py in pts):
                continue
            cells.append((q, r, pts))
    return cells


def cell_fill(q, r):
    if q + r == LINE_K and r > max(SKIP_ROWS):
        return SIG  # the dark banner draws the line about to clear in the signal colour
    filled, idx = corte_fill(q, r)
    # The cells next to the line stay empty, so the line reads as one piece.
    filled = filled and abs(q + r - LINE_K) > 1
    return TILES[(idx + q) % 6][1] if filled else CELL


def path_bbox(d):
    """Bounding box of a path from textpath.py. Control points count, so the box is a little large.

    SVGPathPen writes absolute commands only: M, L, Q, C, H, V and Z.
    H carries one x value and V carries one y value; the other commands carry x, y pairs.
    """
    xs, ys = [], []
    x = y = 0.0
    for cmd, args in re.findall(r'([MLQCHVZ])([^MLQCHVZ]*)', d):
        nums = [float(v) for v in re.findall(r'-?\d+(?:\.\d+)?(?:e-?\d+)?', args)]
        if cmd == 'H':
            for x in nums:
                xs.append(x)
                ys.append(y)
        elif cmd == 'V':
            for y in nums:
                xs.append(x)
                ys.append(y)
        elif cmd != 'Z':
            for x, y in zip(nums[0::2], nums[1::2]):
                xs.append(x)
                ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def cap_height(spec):
    """Height of a capital H in the given type style, measured from its outline."""
    d, _ = text_path('H', spec['family'], spec['weight'], spec['size'], 0, 0)
    _, y0, _, y1 = path_bbox(d)
    return y1 - y0


def set_text(text, spec, x, baseline):
    d, _ = text_path(text, spec['family'], spec['weight'], spec['size'], x, baseline, spec['spacing'])
    return d, path_bbox(d)


def preview_svg(name, desc):
    label = f'{name}. {desc}'
    # The name: optical centre (cap height) on the middle of the field.
    name_base = FIELD_H / 2 + cap_height(NAME) / 2
    name_d, nb = set_text(name, NAME, TEXT_X, name_base)
    # The description: centred in the plain board band between the field and the first cell row below.
    first_row_top = 4 + 1.5 * CELL_R * (max(SKIP_ROWS) + 1) - CELL_DRAW_R
    desc_base = (FIELD_H + first_row_top) / 2 + cap_height(DESC) / 2
    desc_d, db = set_text(desc, DESC, TEXT_X, desc_base)

    # Contrast gates. Each text sits on one flat colour only.
    text_gate(f'{name}: name, ink on signal', INK, SIG, NAME['size'], bold=True)
    text_gate(f'{name}: description, primary on board', PRIMARY, BOARD, DESC['size'])
    for tname, fill in TILES:
        gate(f'{name}: tile {tname} vs board', cr(fill, BOARD), GRAPHIC_MIN)
        gate(f'{name}: tile {tname} vs empty cell', cr(fill, CELL), GRAPHIC_MIN)
    gate(f'{name}: line cell (signal) vs board', cr(SIG, BOARD), GRAPHIC_MIN)
    gate(f'{name}: line cell (signal) vs empty cell', cr(SIG, CELL), GRAPHIC_MIN)

    # Layout gates. A gate value of 1.0 or more passes.
    gate(f'{name}: name and description keep {SAFE_X} px from the left edge', min(nb[0], db[0]) / SAFE_X, 1.0)
    gate(f'{name}: name and description keep {SAFE_X} px from the right edge',
         (W - max(nb[2], db[2])) / SAFE_X, 1.0)
    # Each text line with its baseline on the field keeps NAME_GAP px from the cut, at that baseline.
    # A line below the field has no cut beside it; the gates below keep it off the field.
    clearance = {}
    for role, s, spec, base in (('name', name, NAME, name_base), ('description', desc, DESC, desc_base)):
        if base > FIELD_H:
            continue
        end = TEXT_X + text_width(s, spec['family'], spec['weight'], spec['size'], spec['spacing'])
        clearance[role] = (end, field_right(base), field_right(base) - end)
        gate(f'{name}: {role} ends {NAME_GAP} px or more before the cut at its baseline',
             clearance[role][2] / NAME_GAP, 1.0)
    gate(f'{name}: the name has its baseline on the field', 1.0 if 'name' in clearance else 0.0, 1.0)
    gate(f'{name}: name stays inside the field height', min(nb[1], FIELD_H - nb[3]) / 1.0, 1.0)
    gate(f'{name}: description clears the field bottom', (db[1] - FIELD_H) / 1.0, 1.0)
    gate(f'{name}: description clears the first cell row', (first_row_top - db[3]) / 1.0, 1.0)

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
        f'role="img" aria-label="{escape(label)}">',
        f'<title>{escape(label)}</title>',
        f'<rect width="{W}" height="{H}" fill="{BOARD}"/>',
    ]
    out += [f'<polygon points="{pts_attr(pts)}" fill="{cell_fill(q, r)}"/>' for q, r, pts in board_cells()]
    out.append(f'<polygon points="{field_points()}" fill="{SIG}"/>')
    out.append(f'<path d="{name_d}" fill="{INK}"/>')
    out.append(f'<path d="{desc_d}" fill="{PRIMARY}"/>')
    out.append('</svg>')
    report = dict(name_base=name_base, desc_base=desc_base, name_box=nb, desc_box=db, clearance=clearance)
    return '\n'.join(out) + '\n', report


# ---------- Output ----------

WRAPPER = ('<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;padding:0;overflow:hidden;'
           'background:#808080}}img{{display:block}}</style><img src="{src}" width="{w}" height="{h}" alt="">\n')


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description='Write the avatar and the social previews as SVG.')
    parser.add_argument('--root', type=Path, default=REPO,
                        help='write to <root>/brand/ (default: this repository)')
    parser.add_argument('preview', type=Path, help='folder for the preview copies and the HTML wrappers')
    args = parser.parse_args()
    brand, preview = args.root / 'brand', args.preview
    outputs = [('avatar.svg', avatar_svg(), 1024, 1024)]
    for name, desc in REPOS:
        svg, rep = preview_svg(name, desc)
        print(f'{name}: name baseline {rep["name_base"]:.1f}, description baseline {rep["desc_base"]:.1f}, '
              f'name box {tuple(round(v) for v in rep["name_box"])}, '
              f'description box {tuple(round(v) for v in rep["desc_box"])}')
        for role in ('name', 'description'):
            if role in rep['clearance']:
                end, cut, room = rep['clearance'][role]
                print(f'{name}: the {role} ends at x = {end:.1f}; the cut is at x = {cut:.1f} on its baseline; '
                      f'clearance {room:.1f} px')
            else:
                print(f'{name}: the {role} sits below the field (baseline below y = {FIELD_H}); no cut beside it')
        outputs.append((f'social/{name}.svg', svg, W, H))
    for rel, svg, w, h in outputs:
        write(brand / rel, svg)
        flat = rel.replace('/', '-')
        write(preview / flat, svg)
        write(preview / flat.replace('.svg', '.html'), WRAPPER.format(src=flat, w=w, h=h))
    # The avatar at the smallest size GitHub shows it.
    write(preview / 'avatar-40.html', WRAPPER.format(src='avatar.svg', w=40, h=40))
    print(f'field: {field_points()}; the cut runs from x = {CUT_TOP} at y = 0 to x = {CUT_BOTTOM} at y = {FIELD_H}')
    for label, value, minimum in CHECKS:
        print(f'PASS {label}: {value:.2f} (minimum {minimum})')
    print(f'{len(CHECKS)} gates pass')


if __name__ == '__main__':
    main()
