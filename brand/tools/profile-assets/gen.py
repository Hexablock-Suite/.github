"""T2: regenerate the profile assets of Hexablock-Suite/.github from brand/DESIGN.md.

The script writes eight SVG files into profile/assets/:
- the Corte banner, dark and light (S5), with the field end «Corte en todos» (L14);
- the engine figure, dark and light, restyled to the DESIGN.md palette and fonts;
- the four game cards, restyled the same way.

Every colour is a DESIGN.md token. Banner geometry comes from banner_svg, corte_cells,
corte_board_group, CORTE and lockup in ds-componentes/gen.py and ds-rombo/gen.py.
The engine figure and the game cards keep the geometry of the published files.
Every piece of text is an SVG path from the shared helper textpath.py.

Usage: python profile-assets/gen.py [--root <dir>] [--repo <name>]
Run it from brand/tools/ with a Python that has the packages in requirements.txt.
By default the files go to profile/assets/ of this repository.
With --root, they go to <dir>/profile/assets/ instead.
With --repo, the script writes only the Corte banner of that repository README (S10),
dark and light, into <dir>/docs/assets/. --repo needs --root, the checkout of that repository.
The script prints every contrast gate. It writes no file when a gate fails.
"""
import argparse
import math
import sys
from pathlib import Path
from xml.sax.saxutils import escape

TOOLS = Path(__file__).resolve().parent.parent  # brand/tools/
sys.path.insert(0, str(TOOLS))
from textpath import text_path, text_width  # noqa: E402

REPO = TOOLS.parent.parent  # the repository root, two levels above brand/tools/
SQ3 = math.sqrt(3)

# ---------- DESIGN.md tokens (front matter, colors) ----------

INK = '#121319'
WHITE = '#ffffff'
SIG = '#1ad8ff'  # tertiary
SIG_TEXT_LIGHT = '#00728a'  # tertiary-text-light, also button-edge
T = {
    'dark': dict(bg='#0d0e13', sf='#262830', bd='#050609', cl='#2a2c33', tx='#f2f3f6', mu='#a3a7b6'),
    'light': dict(bg='#eaeaec', sf='#ffffff', bd='#dbdde4', cl='#ffffff', tx='#121319', mu='#4a4d5a'),
}
TILES = [  # name, dark shade, light shade; the order of the DESIGN.md tile table
    ('Amarillo', '#ffc800', '#957500'),
    ('Rojo', '#ff4b55', '#cf3d45'),
    ('Esmeralda', '#22d47a', '#15834c'),
    ('Azul', '#5b84ff', '#4b6cd1'),
    ('Violeta', '#a777ff', '#845ec9'),
    ('Magenta', '#ff4fb3', '#c43d8a'),
]
AMARILLO, ROJO, ESMERALDA, AZUL, VIOLETA, MAGENTA = range(6)


def tile(i, th):
    return TILES[i][1 if th == 'dark' else 2]


# ---------- WCAG 2.x contrast (copied from ds-componentes/gen.py) ----------


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


def hexc(t):
    return '#%02x%02x%02x' % tuple(round(max(0, min(1, v)) * 255) for v in t)


def mix(a, b, t):
    return hexc(tuple(x * (1 - t) + y * t for x, y in zip(rgb(a), rgb(b))))


def worst(c, against):
    return min(cr(c, x) for x in against)


TEXT_MIN = 4.5
LARGE_MIN = 3.0
TILE_MIN = 3.0
CHECKS = []  # (label, value, minimum)


def gate(label, value, minimum):
    CHECKS.append((label, value, minimum))


def text_gate(label, fg, bg, px, bold):
    """WCAG large text: 24 px and up, or bold 18.66 px and up, may go to 3:1."""
    large = px >= 24 or (bold and px >= 18.66)
    gate(f'{label} ({px:g} px{" bold" if bold else ""})', cr(fg, bg), LARGE_MIN if large else TEXT_MIN)


def number_color(fill):
    """The Hexa Merge number colour: the higher-contrast of white and ink (ds-rombo/gen.py)."""
    return max((WHITE, INK), key=lambda c: cr(c, fill))


# Side faces of the Hexa Sort stack. DESIGN.md has no token for them.
# The rule comes from SIG_PRESSED = mix(SIG, INK, 0.15) in ds-componentes/gen.py.
SIDE_TOWARD_INK = 0.15


def side(fill):
    return mix(fill, INK, SIDE_TOWARD_INK)


# ---------- Shapes ----------


def num(v):
    """One decimal, without a trailing .0, as in the published files."""
    s = f'{v:.1f}'
    s = s[:-2] if s.endswith('.0') else s
    return '0' if s == '-0' else s


def flat_hex(cx, cy, r):
    """Flat-top hexagon: the orientation of the published engine figure and game cards."""
    return ' '.join(f'{num(cx + r * math.cos(math.radians(60 * k)))},{num(cy + r * math.sin(math.radians(60 * k)))}'
                    for k in range(6))


def pointy_hex(cx, cy, r):
    """Pointy-top hexagon: hexpts in ds-componentes/gen.py, used by the Corte board crop."""
    return ' '.join(f'{cx + r * math.cos(math.radians(30 + 60 * k)):.1f},'
                    f'{cy + r * math.sin(math.radians(30 + 60 * k)):.1f}' for k in range(6))


def polygon(points, fill):
    return f'<polygon points="{points}" fill="{fill}"/>'


def text(s, family, weight, size, x, y, fill, letter_spacing=0.0, anchor='start'):
    d, _ = text_path(s, family, weight, size, x, y, letter_spacing=letter_spacing, anchor=anchor)
    return f'<path d="{d}" fill="{fill}"/>'


def svg_open(w, h, label):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'role="img" aria-label="{escape(label)}">\n<title>{escape(label)}</title>\n')


# ---------- Corte banner (S5) ----------

BANNER_LABEL = 'HexaBlock Suite: four hex puzzle games on one generic engine'
TAGLINE = 'Four hex puzzle games on one generic engine'  # TAGLINE in both generators
CORTE = dict(size=112, base=156, size2=44, base2=226, tag=26, R=36)  # CORTE in both generators
# The repository READMEs use the same banner (S10). The second line names the repository part.
# The tagline is the role before the colon in profile/README.md (lines 53 and 54).
# The label quotes the full description of the same line.
REPO_BANNERS = {
    'hexablock-app': ('App', 'Mobile client',
                      'HexaBlock App. Mobile client: the four games on one generic engine.'),
    'hexablock-api': ('API', 'REST backend',
                      'HexaBlock API. REST backend: users, progress, leaderboards and level definitions, '
                      'with Drizzle and OpenAPI docs.'),
}
REPO_ASSETS = Path('docs') / 'assets'  # the banner folder inside a repository checkout
BANNER_W, BANNER_H = 1280, 320
# The field ends in a 60-degree cut over the full banner height (DESIGN.md Shapes, «Corte»).
# The horizontal run of the cut is the field height / sqrt 3.
# CUT_TOP is CORTE['top'] in ds-rombo/gen.py. The bottom end is rounded to a whole px.
CUT_TOP = 1000  # the cut starts here at y = 0
CUT_BOTTOM = round(CUT_TOP - BANNER_H / SQ3)  # 815: the cut ends here at y = 320
# The field polygon is the literal value in DESIGN.md (Components, Corte banner): 0,0 1000,0 815,320 0,320.
FIELD = f'0,0 {CUT_TOP},0 {CUT_BOTTOM},{BANNER_H} 0,{BANNER_H}'
NAME_INSET = 24  # each text line ends 24 px or more before the cut, measured at its baseline
LOCKUP_X = 60
LINE_K = 7  # cells with q + r == LINE_K form the line about to clear


def cut_x(y):
    """The x of the cut at height y, on the straight edge of the field polygon."""
    return CUT_TOP + (CUT_BOTTOM - CUT_TOP) * y / BANNER_H


def corte_cells():
    """Board crop cells, from corte_cells in ds-componentes/gen.py."""
    R = CORTE['R']
    cells = []
    for r in range(-1, 8):
        for q in range(-8, 20):
            x = 760 + SQ3 * R * (q + r / 2)
            y = 4 + 1.5 * R * r
            if -R < y < BANNER_H + R and 600 < x < BANNER_W + R:
                cells.append((q, r, x, y))
    return cells


def corte_fill(q, r):
    """Deterministic scatter: about four cells in ten hold a tile (ds-rombo/gen.py)."""
    h = (q * 73856093) ^ (r * 19349663)
    h = (h ^ (h >> 7)) & 0xffff
    return h % 100 < 40, h % 6


def corte_board(th):
    """The board crop of corte_board_group in ds-componentes/gen.py."""
    t = T[th]
    out = [f'<rect width="{BANNER_W}" height="{BANNER_H}" fill="{t["bd"]}"/>']
    n = 0
    used = set()
    for q, r, x, y in corte_cells():
        if q + r == LINE_K:
            # The dark line is the signal colour. The light line uses the six tiles (DESIGN.md Colors).
            if th == 'dark':
                fill = SIG
            else:
                used.add(n % 6)
                fill = tile(n % 6, th)
                n += 1
        else:
            filled, idx = corte_fill(q, r)
            # The cells next to the line stay empty, so the line reads as one piece.
            filled = filled and abs(q + r - LINE_K) > 1
            if filled:
                used.add((idx + q) % 6)
            fill = tile((idx + q) % 6, th) if filled else t['cl']
        out.append(polygon(pointy_hex(x, y, CORTE['R'] - 3.5), fill))
    for i in sorted(used):
        gate(f'banner {th}: tile {TILES[i][0]} vs board and empty cell', worst(tile(i, th), [t['bd'], t['cl']]), TILE_MIN)
    if th == 'dark':
        gate('banner dark: signal line vs board and empty cell', worst(SIG, [t['bd'], t['cl']]), TILE_MIN)
    return ''.join(out)


def lockup(second='Suite', tagline=TAGLINE):
    """HexaBlock on the first line; the second word and the tagline share the second line (lockup in both generators)."""
    k = CORTE
    second_w = text_width(second, 'Unbounded', 800, k['size2'])
    gap = k['size2'] * 0.5
    tag_x = round(LOCKUP_X + 2 + second_w + gap)
    return ''.join([
        text('HexaBlock', 'Unbounded', 800, k['size'], LOCKUP_X, k['base'], INK, letter_spacing=-1),
        text(second, 'Unbounded', 800, k['size2'], LOCKUP_X + 2, k['base2'], INK),
        text(tagline, 'Archivo', 500, k['tag'], tag_x, k['base2'], INK),
    ])


def banner(th, second='Suite', tagline=TAGLINE, label=BANNER_LABEL):
    return (svg_open(BANNER_W, BANNER_H, label) + corte_board(th) + '\n'
            + polygon(FIELD, SIG) + '\n' + lockup(second, tagline) + '\n</svg>\n')


def banner_gates(second='Suite', tagline=TAGLINE, where='banner'):
    k = CORTE
    text_gate(f'{where}: title ink on cyan', INK, SIG, k['size'], True)
    text_gate(f'{where}: {second} ink on cyan', INK, SIG, k['size2'], True)
    # The task holds the tagline to the normal-text floor, although 26 px counts as large text.
    gate(f'{where}: tagline ink on cyan ({k["tag"]} px, held to the text floor)', cr(INK, SIG), TEXT_MIN)
    name_end = LOCKUP_X + text_width('HexaBlock', 'Unbounded', 800, k['size'], letter_spacing=-1)
    tag_end = (LOCKUP_X + 2 + text_width(second, 'Unbounded', 800, k['size2']) + k['size2'] * 0.5
               + text_width(tagline, 'Archivo', 500, k['tag']))
    # Each line is measured at its baseline. The cut moves left as y grows.
    for line, end, base in (('name', name_end, k['base']), ('tagline', tag_end, k['base2'])):
        room = cut_x(base) - end
        print(f'{where}: the {line} ends at x = {end:.1f}; the cut is at x = {cut_x(base):.1f} on its baseline '
              f'(y = {base}); clearance {room:.1f} px')
        gate(f'{where}: {line} clearance to the cut at its baseline, minus {NAME_INSET} px (must be >= 0)',
             room - NAME_INSET, 0)


# ---------- Game cells: engine figure and game cards ----------
# The geometry is the geometry of the published files. Only colours and fonts change.
# Each game uses the tiles of its badge in ds-componentes/gen.py (BADGES).
# A published cell in the old accent takes the badge tile.
# A published cell in the old light grey takes a second tile.
# A published cell in the old slate is an empty cell.

SMALL_R, SMALL_STEP = 13, 15  # small cells of the Lines and Fit groups
SMALL = [(0, 0), (0, -2), (0, 2), (1, -1), (1, 1), (-1, -1), (-1, 1)]  # (column, half row), published order
LINES_FILL = [AMARILLO, AMARILLO, AMARILLO, None, None, None, None]  # a full line of three
FIT_FILL = [AZUL, AZUL, ROJO, AZUL, None, ROJO, ROJO]  # two pieces and one empty cell
SORT_LAYERS = [(26, ESMERALDA), (13, ESMERALDA), (0, VIOLETA), (-13, VIOLETA)]  # bottom to top
MERGE_TILES = [(-21.5, -22.7, 15, MAGENTA, '2', 19, -15.7), (-21.5, 6.7, 15, MAGENTA, '2', 19, 13.7),
               (19.8, 17.1, 24, AZUL, '4', 28, 27.1)]  # cx, cy, r, tile, number, size, baseline


def small_cells(fills, th):
    out = []
    for (c, hr), f in zip(SMALL, fills):
        cx = c * 1.5 * SMALL_STEP
        cy = hr * SQ3 * SMALL_STEP / 2
        out.append(polygon(flat_hex(cx, cy, SMALL_R), T[th]['cl'] if f is None else tile(f, th)))
    return ''.join(out)


def sort_layer(cy, fill):
    """One tile of the stack: a side band, then the top face (the published shape)."""
    band = f'34,{num(cy)} 17,{num(cy + 14.7)} -17,{num(cy + 14.7)} -34,{num(cy)} -34,{num(cy + 9)} -17,{num(cy + 23.7)} 17,{num(cy + 23.7)} 34,{num(cy + 9)}'
    top = f'34,{num(cy)} 17,{num(cy + 14.7)} -17,{num(cy + 14.7)} -34,{num(cy)} -17,{num(cy - 14.7)} 17,{num(cy - 14.7)}'
    return polygon(band, side(fill)) + polygon(top, fill)


def merge_tiles(th):
    out = []
    for cx, cy, r, i, n, size, base in MERGE_TILES:
        fill = tile(i, th)
        out.append(polygon(flat_hex(cx, cy, r), fill))
        out.append(text(n, 'Unbounded', 800, size, cx, base, number_color(fill), anchor='middle'))
    return ''.join(out)


def game_group(game, th):
    if game == 'Hexa Lines':
        return small_cells(LINES_FILL, th)
    if game == 'Hexa Fit':
        return small_cells(FIT_FILL, th)
    if game == 'Hexa Sort':
        return ''.join(sort_layer(cy, tile(i, th)) for cy, i in SORT_LAYERS)
    return merge_tiles(th)


def game_tiles(game):
    if game == 'Hexa Lines':
        return {f for f in LINES_FILL if f is not None}
    if game == 'Hexa Fit':
        return {f for f in FIT_FILL if f is not None}
    if game == 'Hexa Sort':
        return {i for _, i in SORT_LAYERS}
    return {m[3] for m in MERGE_TILES}


def game_gates(where, game, th, backdrop):
    """Tiles and numbers inside one game group, against the board and the empty cell of the theme."""
    t = T[th]
    for i in sorted(game_tiles(game)):
        gate(f'{where} {th}: {game} tile {TILES[i][0]} vs board and empty cell', worst(tile(i, th), [backdrop, t['cl']]), TILE_MIN)
    if game == 'Hexa Sort':
        for i in sorted(game_tiles(game)):
            gate(f'{where} {th}: {game} side of {TILES[i][0]} vs board', cr(side(tile(i, th)), backdrop), TILE_MIN)
    if game == 'Hexa Merge':
        scale = 0.92 if where == 'engine' else 1.0
        for _, _, _, i, n, size, _ in MERGE_TILES:
            fill = tile(i, th)
            text_gate(f'{where} {th}: number {n} on {TILES[i][0]}', number_color(fill), fill, round(size * scale, 2), True)


# ---------- Engine figure ----------

ENGINE_LABEL = ('Conceptual view: one generic engine at the center, with Hexa Lines, Hexa Fit, '
                'Hexa Sort and Hexa Merge on the cells around it')
ENGINE_W, ENGINE_H = 960, 600
CELL_R, CELL_STEP = 121, 128
GAMES = {(-1, -0.5): ('Hexa Sort', 'Cell: a tile stack'), (-1, 0.5): ('Hexa Merge', 'Cell: a power of 2'),
         (1, -0.5): ('Hexa Lines', 'Cell: a color'), (1, 0.5): ('Hexa Fit', 'Cell: a piece id')}
ENGINE_LINES = [('Generic engine', 600, 24, 272), ('one board', 400, 18, 306),
                ('one rules contract', 400, 18, 331), ('one turn cycle', 400, 18, 356)]


def engine_cells():
    """Columns -2 to 2; odd columns shift half a row. The published order: column by column, top to bottom."""
    for c in range(-2, 3):
        rows = [-1, 0, 1] if c % 2 == 0 else [-1.5, -0.5, 0.5, 1.5]
        for row in rows:
            yield c, row, 480 + 1.5 * CELL_STEP * c, 300 + SQ3 * CELL_STEP * row


def engine(th):
    """Theme roles: page background; empty cells in the cell colour; game cells in the board colour,
    like the game badge in DESIGN.md; the engine in the signal field with ink type."""
    t = T[th]
    out = [svg_open(ENGINE_W, ENGINE_H, ENGINE_LABEL), f'<rect width="{ENGINE_W}" height="{ENGINE_H}" fill="{t["bg"]}"/>\n']
    for c, row, x, y in engine_cells():
        if (c, row) == (0, 0):
            out.append(polygon(flat_hex(x, y, CELL_R), SIG) + '\n')
            for s, weight, size, base in ENGINE_LINES:
                out.append(text(s, 'Archivo', weight, size, 480, base, INK, anchor='middle') + '\n')
        elif (c, row) in GAMES:
            game, desc = GAMES[(c, row)]
            out.append(polygon(flat_hex(x, y, CELL_R), t['bd']) + '\n')
            out.append(f'<g transform="translate({num(x)} {num(y - 38)}) scale(0.92)">{game_group(game, th)}</g>\n')
            out.append(text(game, 'Archivo', 600, 24, x, round(y + 30, 1), t['tx'], anchor='middle') + '\n')
            out.append(text(desc, 'Archivo', 400, 18, x, round(y + 60, 1), t['mu'], anchor='middle') + '\n')
        else:
            out.append(polygon(flat_hex(x, y, CELL_R), t['cl']) + '\n')
    out.append('</svg>\n')
    return ''.join(out)


def engine_gates(th):
    t = T[th]
    for s, weight, size, _ in ENGINE_LINES:
        text_gate(f'engine {th}: "{s}" ink on cyan', INK, SIG, size, weight >= 600)
    text_gate(f'engine {th}: game name primary on board', t['tx'], t['bd'], 24, True)
    text_gate(f'engine {th}: cell line secondary on board', t['mu'], t['bd'], 18, False)
    for game, _ in GAMES.values():
        game_gates('engine', game, th, t['bd'])
    gate(f'engine {th}: empty cell vs page (layer step, no floor)', cr(t['cl'], t['bg']), 1.0)
    gate(f'engine {th}: game cell vs empty cell (layer step, floor of DESIGN.md)', cr(t['bd'], t['cl']), 1.35)


# ---------- Game cards ----------
# One file per game, shown on both GitHub themes. Dark is the principal version of a
# single-image asset (S3 assumption), so the card uses the dark board and the dark tiles.

CARD_TH = 'dark'
CARDS = {'lines': 'Hexa Lines', 'fit': 'Hexa Fit', 'sort': 'Hexa Sort', 'merge': 'Hexa Merge'}


def card(game):
    t = T[CARD_TH]
    return (svg_open(120, 120, f'{game} icon') + polygon(flat_hex(60, 60, 58), t['bd'])
            + f'<g transform="translate(60 60)">{game_group(game, CARD_TH)}</g>\n</svg>\n')


# ---------- README badges ----------
# shields.io draws white text on the label colour and on the message colour.

BADGE_MESSAGE = ('00728a', 'tertiary-text-light (also button-edge)')
BADGE_LABEL = ('262830', 'surface-dark')


def badge_gates():
    for hexv, token in (BADGE_MESSAGE, BADGE_LABEL):
        gate(f'README badge: white text on #{hexv} ({token})', cr(WHITE, '#' + hexv), TEXT_MIN)


def main():
    parser = argparse.ArgumentParser(description='Write the profile assets as SVG.')
    parser.add_argument('--root', type=Path,
                        help='write to <root>/profile/assets/ (default: this repository)')
    parser.add_argument('--repo', choices=sorted(REPO_BANNERS),
                        help='write only the README banner of this repository, to <root>/docs/assets/')
    args = parser.parse_args()
    if args.repo:
        if args.root is None:
            parser.error('--repo needs --root <dir>, the checkout of that repository')
        assets = args.root / REPO_ASSETS
        second, tagline, label = REPO_BANNERS[args.repo]
        banner_gates(second, tagline, f'banner {args.repo}')
        files = {f'banner-{th}.svg': banner(th, second, tagline, label) for th in ('dark', 'light')}
    else:
        assets = (args.root or REPO) / 'profile' / 'assets'
        banner_gates()
        files = {'banner-dark.svg': banner('dark'), 'banner-light.svg': banner('light'),
                 'engine-dark.svg': engine('dark'), 'engine-light.svg': engine('light')}
        for th in ('dark', 'light'):
            engine_gates(th)
        for key, game in CARDS.items():
            files[f'game-{key}.svg'] = card(game)
            game_gates('card', game, CARD_TH, T[CARD_TH]['bd'])
        badge_gates()
    failed = [c for c in CHECKS if c[1] < c[2]]
    for label, value, minimum in CHECKS:
        print(f'{"PASS" if value >= minimum else "FAIL"}  {label}: {value:.2f} (minimum {minimum:g})')
    if failed:
        print(f'{len(failed)} gate(s) failed; no file written.')
        return 1
    for name, content in files.items():
        if '<text' in content:
            print(f'{name} still holds a <text> element; no file written.')
            return 1
    assets.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        (assets / name).write_text(content, encoding='utf-8')
        print(f'wrote {name}: {len(content.encode("utf-8"))} bytes')
    return 0


if __name__ == '__main__':
    sys.exit(main())
