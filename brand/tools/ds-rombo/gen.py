#!/usr/bin/env python3
"""Build rombo.html: second pass on the HexaBlock Rombo direction.

Usage: python3 gen.py [<out.html>]

Without an argument, the page goes to brand/tools/build/rombo.html.
The build folder is git-ignored: the page is a review page, not a published asset.

Every ratio on the page comes from this file (WCAG 2.x relative luminance).
The build stops when a tile is under 3:1 against what it sits on, or when text
is under its minimum (4.5:1, or 3:1 for large display text).
"""

import colorsys
import math
import sys
from html import escape
from pathlib import Path

# ---------- WCAG 2.x contrast ----------


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


def worst(c, against):
    return min(cr(c, x) for x in against)


def hexc(t):
    return '#%02x%02x%02x' % tuple(round(max(0, min(1, v)) * 255) for v in t)


def mix(a, b, t):
    return hexc(tuple(x * (1 - t) + y * t for x, y in zip(rgb(a), rgb(b))))


def reach(base, against, target, toward):
    """Mix base toward a pole until it reaches the target ratio on every color in against."""
    for i in range(0, 201):
        c = mix(base, toward, i / 200)
        if worst(c, against) >= target:
            return c
    raise ValueError(f'{base} cannot reach {target} against {against}')


def deep_pole(c):
    """A saturated dark color with the hue of c. Light shades mix toward it, so they stay vivid."""
    h, _, _ = colorsys.rgb_to_hls(*rgb(c))
    return hexc(colorsys.hls_to_rgb(h, 0.13, 1.0))


def oklab(c):
    def l2(v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (l2(v) for v in rgb(c))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def okdist(a, b):
    return math.dist(oklab(a), oklab(b))


def fmt(v, d=2):
    return f'{v:.{d}f}'.replace('.', ',')


def ratio(v):
    return fmt(v) + ':1'


CHECKS = []  # (label, value, minimum) for the build gate and the report


def gate(label, value, minimum):
    CHECKS.append((label, value, minimum))
    assert value >= minimum, f'FAIL {label}: {value:.3f} < {minimum}'
    return value


# ---------- Tokens ----------

INK = '#121319'
WHITE = '#ffffff'
PAPER = '#f7f7f8'
YELLOW = '#ffd000'

OLD = dict(
    light=dict(bg='#f7f7f8', surface='#ffffff', text='#121319', muted='#4a4d5a', board='#e2e4eb', cell='#f6f7f9'),
    dark=dict(bg='#0d0e13', surface='#191b23', text='#f2f3f6', muted='#a3a7b6', board='#050609', cell='#1f2129'),
)

# Starting targets from the brief, and the targets this page uses.
SURF_START = dict(dark=1.25, light=1.15)
SURF_T = dict(dark=1.30, light=1.20)
CELL_START = dict(dark=1.25, light=1.15)
CELL_T = dict(dark=1.45, light=1.35)
TILE_AIM = 3.2   # small margin over the 3:1 floor
TILE_MIN = 3.0
TEXT_MIN = 4.5
LARGE_MIN = 3.0
OK_SPLIT = 0.15  # OKLab distance under which a tile looks like the signal color

NEW = dict(light=dict(OLD['light']), dark=dict(OLD['dark']))
# Light: the card stays white and the page background steps down to a cool grey.
NEW['light']['bg'] = reach(PAPER, [WHITE], SURF_T['light'], '#4a4d5a')
# Light: the empty cell becomes pure white and the board steps down a little.
NEW['light']['cell'] = WHITE
NEW['light']['board'] = reach('#e2e4eb', [WHITE], CELL_T['light'], '#4a4d5a')
# Dark: the background stays (it is the look that worked); the card and the cell step up.
NEW['dark']['surface'] = reach('#191b23', ['#0d0e13'], SURF_T['dark'], '#f2f3f6')
NEW['dark']['cell'] = reach('#1f2129', ['#050609'], CELL_T['dark'], '#f2f3f6')

THEMES = ('dark', 'light')
THEME_ES = {'light': 'claro', 'dark': 'oscuro'}

# ---------- Tiles ----------

# name, bright base (dark theme), light shade from the first board (None for new tiles)
POOL = {
    'Rojo': ('#ff4b55', '#cf3d45'),
    'Naranja': ('#ff8a1f', None),
    'Amarillo': ('#ffc800', None),
    'Esmeralda': ('#22d47a', '#15834c'),
    'Celeste': ('#1fcfee', '#137e91'),
    'Azul': ('#5b84ff', '#4b6cd1'),
    'Violeta': ('#a777ff', '#845ec9'),
    'Magenta': ('#ff4fb3', '#c43d8a'),
}
BASE_SET = ['Rojo', 'Esmeralda', 'Celeste', 'Azul', 'Violeta', 'Magenta']
RESERVE = ['Amarillo', 'Naranja']


def shades(name, tokens, extra_light=()):
    base, light0 = POOL[name]
    t_d, t_l = tokens['dark'], tokens['light']
    dark = reach(base, [t_d['board'], t_d['cell']], TILE_AIM, WHITE)
    light = reach(light0 or base, [t_l['board'], t_l['cell'], *extra_light], TILE_AIM, deep_pole(base))
    return dict(name=name, base=base, dark=dark, light=light)


OLD_TILES = [dict(name=n, dark=POOL[n][0], light=POOL[n][1]) for n in BASE_SET]
NEW_TILES = [shades(n, NEW, extra_light=[YELLOW]) for n in BASE_SET]


def tile_rows(tiles, tokens):
    rows = []
    for t in tiles:
        row = dict(name=t['name'])
        for th in THEMES:
            row[th] = dict(fill=t[th], board=cr(t[th], tokens[th]['board']), cell=cr(t[th], tokens[th]['cell']))
        rows.append(row)
    return rows


def min_tile(rows, th):
    return min(min(r[th]['board'], r[th]['cell']) for r in rows)


OLD_ROWS = tile_rows(OLD_TILES, OLD)
NEW_ROWS = tile_rows(NEW_TILES, NEW)
for r in NEW_ROWS:
    for th in THEMES:
        gate(f'ficha {r["name"]} {th} contra tablero', r[th]['board'], TILE_MIN)
        gate(f'ficha {r["name"]} {th} contra casilla', r[th]['cell'], TILE_MIN)

for th in THEMES:
    t = NEW[th]
    gate(f'superficie/fondo {th}', cr(t['surface'], t['bg']), SURF_T[th])
    gate(f'casilla/tablero {th}', cr(t['cell'], t['board']), CELL_T[th])
    for k in ('bg', 'surface'):
        gate(f'texto sobre {k} {th}', cr(t['text'], t[k]), TEXT_MIN)
        gate(f'texto secundario sobre {k} {th}', cr(t['muted'], t[k]), TEXT_MIN)

# ---------- Signal candidates ----------

SIGNALS = [
    dict(id='amarillo', name='Amarillo señal', hex='#ffd000'),
    dict(id='naranja', name='Naranja señal', hex='#ff7a1a'),
    dict(id='rosa', name='Rosa señal', hex='#ff5aa5'),
    dict(id='cian', name='Cian señal', hex='#1ad8ff'),
]

for s in SIGNALS:
    left = [n for n in BASE_SET if okdist(POOL[n][0], s['hex']) < OK_SPLIT]
    keep = [n for n in BASE_SET if n not in left]
    joined = [n for n in RESERVE if okdist(POOL[n][0], s['hex']) >= OK_SPLIT][:6 - len(keep)]
    names = joined + keep
    assert len(names) == 6, (s['id'], names)
    s['left'] = [(n, okdist(POOL[n][0], s['hex'])) for n in left]
    s['joined'] = joined
    extra = [YELLOW] if s['hex'] == YELLOW else []
    s['tiles'] = [shades(n, NEW, extra_light=extra) for n in names]
    s['rows'] = tile_rows(s['tiles'], NEW)
    for r in s['rows']:
        for th in THEMES:
            gate(f'{s["id"]}: ficha {r["name"]} {th} contra tablero', r[th]['board'], TILE_MIN)
            gate(f'{s["id"]}: ficha {r["name"]} {th} contra casilla', r[th]['cell'], TILE_MIN)
    s['title_on_dark'] = gate(f'{s["id"]}: señal como título sobre fondo oscuro', cr(s['hex'], NEW['dark']['bg']), TEXT_MIN)
    s['ink_on_field'] = gate(f'{s["id"]}: tinta sobre campo de señal', cr(INK, s['hex']), TEXT_MIN)
    s['line_dark'] = gate(f'{s["id"]}: línea encendida contra tablero oscuro y casilla',
                          worst(s['hex'], [NEW['dark']['board'], NEW['dark']['cell']]), TILE_MIN)
    s['min_pair'] = min(
        (okdist(a[th], b[th]), a['name'], b['name'], th)
        for i, a in enumerate(s['tiles']) for b in s['tiles'][i + 1:] for th in THEMES)

# ---------- SVG helpers ----------


def hexpts(cx, cy, r, pointy=True):
    off = 30 if pointy else 0
    return ' '.join(
        f'{cx + r * math.cos(math.radians(off + 60 * k)):.1f},{cy + r * math.sin(math.radians(off + 60 * k)):.1f}'
        for k in range(6))


def poly(cx, cy, r, fill, pointy=True):
    return f'<polygon points="{hexpts(cx, cy, r, pointy)}" fill="{fill}"/>'


UNB = "Unbounded, &#39;Arial Black&#39;, &#39;Segoe UI&#39;, sans-serif"
ARC = "Archivo, &#39;Helvetica Neue&#39;, Arial, sans-serif"
# Advance widths per 1 px of font size, measured in headless Chromium with the Google Fonts files.
EM = {'HexaBlock': 6.750, 'Suite': 3.322, '2048': 3.570, '512': 2.195, '64': 1.747, '8': 0.92, '2': 0.92,
      'tag500': 20.463}
TAGLINE = 'Four hex puzzle games on one generic engine'
SQ3 = math.sqrt(3)


def number_color(fill):
    return max((WHITE, INK), key=lambda c: cr(c, fill))


# Mini board: a 5 x 5 rhombus of pointy cells, the board of the game Hex.
MINI_N = 5
MINI_R = 22
MINI_TILES = {(1, 0): 0, (4, 0): 1, (0, 2): 2, (2, 1): 3, (3, 2): 4, (1, 4): 5, (4, 4): 0, (0, 4): 2}
MINI_MERGE = (2, 3)


def mini_board(tokens, th, tiles, label, merge_idx):
    t = tokens[th]
    R = MINI_R
    pts = []
    for r in range(MINI_N):
        for q in range(MINI_N):
            pts.append((q, r, SQ3 * R * (q + r / 2), 1.5 * R * r))
    xs = [p[2] for p in pts]
    ys = [p[3] for p in pts]
    pad = R * 1.35
    x0, y0 = min(xs) - pad, min(ys) - pad
    w, h = max(xs) - min(xs) + 2 * pad, max(ys) - min(ys) + 2 * pad
    out = [f'<svg viewBox="{x0:.1f} {y0:.1f} {w:.1f} {h:.1f}" role="img" aria-label="{escape(label)}">']
    out += [poly(x, y, R * 1.22, t['board']) for _, _, x, y in pts]
    for q, r, x, y in pts:
        if (q, r) in MINI_TILES:
            out.append(poly(x, y, R * 0.9, tiles[MINI_TILES[(q, r)]][th]))
        elif (q, r) == MINI_MERGE:
            fill = tiles[merge_idx][th]
            nc = number_color(fill)
            gate(f'número 64 sobre {tiles[merge_idx]["name"]} {th}', cr(nc, fill), TEXT_MIN)
            out.append(poly(x, y, R * 0.9, fill))
            out.append(f'<text x="{x:.1f}" y="{y + 5.6:.1f}" text-anchor="middle" font-family="{UNB}" '
                       f'font-weight="800" font-size="15" fill="{nc}">64</text>')
        else:
            out.append(poly(x, y, R * 0.9, t['cell']))
    out.append('</svg>')
    return ''.join(out)


def merge_index(tiles):
    """The tile whose best number color has the most contrast in both themes."""
    def score(i):
        return min(cr(number_color(tiles[i][th]), tiles[i][th]) for th in THEMES)
    return max(range(len(tiles)), key=score)


# ---------- Banners (1280 x 320) ----------

DARK_BG = OLD['dark']['bg']
DARK_TEXT = OLD['dark']['text']


def lockup(x, base1, size1, base2, size2, color_title, color_tag, tag_size):
    """HexaBlock on the first line; Suite and the tagline share the second line."""
    suite_w = EM['Suite'] * size2
    gap = size2 * 0.5
    return (f'<text x="{x}" y="{base1}" font-family="{UNB}" font-weight="800" font-size="{size1}" fill="{color_title}" letter-spacing="-1">HexaBlock</text>'
            f'<text x="{x + 2}" y="{base2}" font-family="{UNB}" font-weight="800" font-size="{size2}" fill="{color_title}">Suite</text>'
            f'<text x="{x + 2 + suite_w + gap:.0f}" y="{base2}" font-family="{ARC}" font-weight="500" font-size="{tag_size}" fill="{color_tag}">{TAGLINE}</text>')


def banner_open(label):
    return f'<svg viewBox="0 0 1280 320" role="img" aria-label="{escape(label)}">'


def banner_colors(th, sig):
    if th == 'dark':
        return dict(bg=DARK_BG, title=sig, tag=DARK_TEXT)
    return dict(bg=sig, title=INK, tag=INK)


def check_banner_text(name, th, c, sig):
    gate(f'banner {name} {th}: título', cr(c['title'], c['bg']), LARGE_MIN)
    gate(f'banner {name} {th}: lema', cr(c['tag'], c['bg']), TEXT_MIN)


TITULAR = dict(size=168, base=178, size2=52, base2=264, tag=34)


def banner_titular(th, sig, tiles):
    c = banner_colors(th, sig)
    check_banner_text('Titular', th, c, sig)
    k = TITULAR
    out = [banner_open(f'Banner Titular, tema {THEME_ES[th]}: HexaBlock Suite, {TAGLINE}'),
           f'<rect width="1280" height="320" fill="{c["bg"]}"/>',
           lockup(60, k['base'], k['size'], k['base2'], k['size2'], c['title'], c['tag'], k['tag'])]
    # One full line of six tiles on a hex axis, closing the second line.
    r = 25
    x0 = 1224 - 5 * 1.5 * r
    for i, t in enumerate(tiles):
        fill = t[th]
        gate(f'banner Titular {th}: ficha {t["name"]} sobre fondo', cr(fill, c['bg']), TILE_MIN)
        y = 250 + (-1) ** i * (SQ3 / 2 * r) / 1
        out.append(poly(x0 + i * 1.5 * r, y, r - 1.5, fill, pointy=False))
    out.append('</svg>')
    return ''.join(out)


CORTE = dict(top=1000, size=112, base=156, size2=44, base2=226, tag=26, R=36)


def corte_cells():
    k = CORTE
    R = k['R']
    cells = []
    for r in range(-1, 8):
        for q in range(-8, 20):
            x = 760 + SQ3 * R * (q + r / 2)
            y = 4 + 1.5 * R * r
            if -R < y < 320 + R and 600 < x < 1280 + R:
                cells.append((q, r, x, y))
    return cells


def corte_fill(q, r):
    """Deterministic scatter: about four cells in ten hold a tile."""
    h = (q * 73856093) ^ (r * 19349663)
    h = (h ^ (h >> 7)) & 0xffff
    return h % 100 < 40, h % 6


def banner_corte(th, sig, tiles):
    k = CORTE
    t = NEW[th]
    R = k['R']
    label = f'Banner Corte, tema {THEME_ES[th]}: HexaBlock Suite sobre campo de señal y recorte del tablero con una línea completa'
    out = [banner_open(label), f'<rect width="1280" height="320" fill="{t["board"]}"/>']
    line_k = 7  # cells with q + r == line_k form the line parallel to the cut, mid crop
    n = 0
    for q, r, x, y in corte_cells():
        if q + r == line_k:
            if th == 'dark':
                fill = sig
            else:
                fill = tiles[n % 6][th]
                n += 1
        else:
            filled, idx = corte_fill(q, r)
            # The cells next to the line stay empty, so the line reads as one piece.
            filled = filled and abs(q + r - line_k) > 1
            fill = tiles[(idx + q) % 6][th] if filled else t['cell']
        out.append(poly(x, y, R - 3.5, fill))
    for tt in tiles:
        gate(f'banner Corte {th}: ficha {tt["name"]} contra tablero y casilla', worst(tt[th], [t['board'], t['cell']]), TILE_MIN)
    if th == 'dark':
        gate(f'banner Corte {th}: línea encendida', worst(sig, [t['board'], t['cell']]), TILE_MIN)
    bot = k['top'] - 320 * math.tan(math.radians(30))
    out.append(f'<polygon points="0,0 {k["top"]},0 {bot:.1f},320 0,320" fill="{sig}"/>')
    gate(f'banner Corte {th}: título tinta sobre señal', cr(INK, sig), TEXT_MIN)
    out.append(lockup(60, k['base'], k['size'], k['base2'], k['size2'], INK, INK, k['tag']))
    out.append('</svg>')
    return ''.join(out)


# value, center x, center y, circumradius, tile index
STAIRS = [(2, 874, 262, 24, 2), (8, 930, 230, 30, 3), (64, 1000, 192, 40, 4),
          (512, 1090, 140, 52, 5), (2048, 1196, 84, 72, 0)]
ESCALERA = dict(size=108, base=158, size2=44, base2=230, tag=28)


def banner_escalera(th, sig, tiles):
    c = banner_colors(th, sig)
    check_banner_text('Escalera', th, c, sig)
    k = ESCALERA
    out = [banner_open(f'Banner Escalera, tema {THEME_ES[th]}: la cadena de Hexa Merge de 2 a 2048 junto a HexaBlock Suite'),
           f'<rect width="1280" height="320" fill="{c["bg"]}"/>',
           lockup(60, k['base'], k['size'], k['base2'], k['size2'], c['title'], c['tag'], k['tag'])]
    for v, x, y, r, i in STAIRS:
        fill = tiles[i][th]
        gate(f'banner Escalera {th}: ficha {v} sobre fondo', cr(fill, c['bg']), TILE_MIN)
        f = min(1.5 * r / EM[str(v)], 0.8 * r)
        nc = number_color(fill)
        gate(f'banner Escalera {th}: número {v} ({f:.0f} px, negrita)', cr(nc, fill), LARGE_MIN if f >= 18.66 else TEXT_MIN)
        out.append(poly(x, y, r, fill, pointy=False))
        out.append(f'<text x="{x}" y="{y + f * 0.36:.1f}" text-anchor="middle" font-family="{UNB}" font-weight="800" '
                   f'font-size="{f:.1f}" fill="{nc}">{v}</text>')
    out.append('</svg>')
    return ''.join(out)


COMPOSITIONS = [
    dict(id='titular', name='Titular', fn=banner_titular, title=TITULAR['size'],
         line='El nombre es la imagen: ocupa casi todo el ancho y una línea completa de seis fichas cierra la segunda fila.'),
    dict(id='corte', name='Corte', fn=banner_corte, title=CORTE['size'],
         line='Un campo de señal cortado a 60 grados, el ángulo del tablero, guarda el nombre; al lado, un recorte del tablero con una línea a punto de despejarse.'),
    dict(id='escalera', name='Escalera', fn=banner_escalera, title=ESCALERA['size'],
         line='La cadena de Hexa Merge sube de 2 a 2048 y cada ficha crece con su valor.'),
]

GITHUB = dict(dark='#0d1117', light='#ffffff')  # default GitHub page backgrounds

# ---------- HTML blocks ----------


def chip(color, size=22):
    r = size / 2 - 0.5
    return (f'<svg class="chip" width="{size}" height="{size}" viewBox="0 0 {size} {size}" aria-hidden="true">'
            f'<polygon points="{hexpts(size / 2, size / 2, r - 0.5)}" fill="{color}" stroke="#8a8d99" stroke-width="1"/></svg>')


def sample(t, when):
    return (f'<figure class="sample"><div class="sample-bg" style="background:{t["bg"]}">'
            f'<div class="sample-card" style="background:{t["surface"]}">'
            f'<p class="sc-t" style="color:{t["text"]}">Hexa Lines</p>'
            f'<p class="sc-m" style="color:{t["muted"]}">Completa una línea en cualquiera de los tres ejes.</p>'
            f'</div></div><figcaption><b>{when}</b> {ratio(cr(t["surface"], t["bg"]))}'
            f'<span class="sub">fondo {t["bg"]}, superficie {t["surface"]}</span></figcaption></figure>')


def board_fig(tokens, rows_tiles, th, when):
    t = tokens[th]
    tiles = rows_tiles
    rows = tile_rows(tiles, tokens)
    lab = f'Tablero {THEME_ES[th]} {when.lower()}: casillas vacías, seis fichas y una ficha de Hexa Merge con el 64'
    return (f'<figure class="mboard" style="background:{t["bg"]}">{mini_board(tokens, th, tiles, lab, merge_index(tiles))}'
            f'<figcaption style="color:{t["text"]}"><b>{when}</b> casilla contra tablero {ratio(cr(t["cell"], t["board"]))}'
            f'<span class="sub" style="color:{t["muted"]}">ficha más baja {ratio(min_tile(rows, th))}</span></figcaption></figure>')


def section_changes():
    sd, sl = cr(OLD['dark']['surface'], OLD['dark']['bg']), cr(OLD['light']['surface'], OLD['light']['bg'])
    cd, cl = cr(OLD['dark']['cell'], OLD['dark']['board']), cr(OLD['light']['cell'], OLD['light']['board'])
    rows_s = ''.join(
        f'<div class="theme-row"><h4>Tema {THEME_ES[th]}</h4><div class="pair">{sample(OLD[th], "Antes")}{sample(NEW[th], "Ahora")}</div></div>'
        for th in THEMES)
    rows_b = ''.join(
        f'<div class="theme-row"><h4>Tema {THEME_ES[th]}</h4><div class="pair">'
        f'{board_fig(OLD, OLD_TILES, th, "Antes")}{board_fig(NEW, NEW_TILES, th, "Ahora")}</div></div>'
        for th in THEMES)
    roles = [('Fondo', 'bg'), ('Superficie', 'surface'), ('Tablero', 'board'), ('Casilla vacía', 'cell')]
    trs = []
    for name, k in roles:
        cells = ''
        for th in THEMES:
            a, b = OLD[th][k], NEW[th][k]
            same = a == b
            cells += (f'<td>{chip(b, 16)} <b>{b}</b>' + ('<span class="sub">sin cambio</span>' if same else f'<span class="sub">antes {a}</span>') + '</td>')
        trs.append(f'<tr><th scope="row">{name}</th>{cells}</tr>')
    tile_tr = []
    for o, n in zip(OLD_TILES, NEW_TILES):
        cells = ''
        for th in THEMES:
            same = o[th] == n[th]
            cells += (f'<td>{chip(n[th], 16)} <b>{n[th]}</b>' + ('<span class="sub">sin cambio</span>' if same else f'<span class="sub">antes {o[th]}</span>') + '</td>')
        tile_tr.append(f'<tr><th scope="row">{n["name"]}</th>{cells}</tr>')
    return f"""
<section id="cambios" class="sec" aria-labelledby="cambios-h">
<h2 id="cambios-h">Lo que cambió</h2>
<div class="sub-sec">
<h3>Superficie y fondo</h3>
<p>Antes la tarjeta casi desaparecía sobre el fondo: {ratio(sd)} en oscuro y {ratio(sl)} en claro. En oscuro sube la superficie y el fondo se queda igual, porque es el que gustó. En claro la tarjeta sigue blanca y el fondo baja a un gris frío. Meta inicial: {fmt(SURF_START['dark'])} en oscuro y {fmt(SURF_START['light'])} en claro; uso {fmt(SURF_T['dark'])} y {fmt(SURF_T['light'])} para dejar margen. No hace falta borde de 1 px: el salto de tono basta.</p>
{rows_s}
</div>
<div class="sub-sec">
<h3>Casilla vacía y tablero</h3>
<p>Los dos tableros ya cumplían la meta inicial ({ratio(cd)} en oscuro y {ratio(cl)} en claro) y aun así la casilla no se distinguía. La meta era baja, así que la subí a {fmt(CELL_T['dark'])}:1 en oscuro y {fmt(CELL_T['light'])}:1 en claro. En claro la casilla pasa a blanco puro y el tablero baja un poco; en oscuro la casilla sube. Las fichas siguen sobre 3:1 contra el tablero y contra la casilla en los dos temas.</p>
{rows_b}
</div>
<div class="sub-sec">
<h3>Valores nuevos</h3>
<div class="tbl-wrap"><table class="t-tok"><thead><tr><th scope="col">Rol</th><th scope="col">Oscuro</th><th scope="col">Claro</th></tr></thead>
<tbody>{''.join(trs)}</tbody></table></div>
<p class="note">Fichas: solo se mueven las que ya no llegaban a {fmt(TILE_AIM, 1)}:1 contra el tablero nuevo.</p>
<div class="tbl-wrap"><table class="t-tok"><thead><tr><th scope="col">Ficha</th><th scope="col">Oscuro</th><th scope="col">Claro</th></tr></thead>
<tbody>{''.join(tile_tr)}</tbody></table></div>
</div>
</section>"""


def banner_figure(svg_main, svg_phone, th, caption):
    return (f'<figure class="bfig"><div class="gh" style="background:{GITHUB[th]}">{svg_main}</div>'
            f'<div class="phone" style="background:{GITHUB[th]}"><div class="phone-in">{svg_phone}</div></div>'
            f'<figcaption>{caption}</figcaption></figure>')


def section_banners():
    tiles = NEW_TILES
    parts = []
    for c in COMPOSITIONS:
        figs = ''
        for th in THEMES:
            svg = c['fn'](th, YELLOW, tiles)
            note = 'Oscuro, versión principal' if th == 'dark' else 'Claro'
            figs += banner_figure(svg, svg, th, f'{note}. A la derecha, el mismo banner a 360 px, el ancho de un teléfono.')
        parts.append(f'<article class="comp" id="{c["id"]}" aria-labelledby="{c["id"]}-h">'
                     f'<h3 id="{c["id"]}-h">{c["name"]}</h3><p>{escape(c["line"])}</p>'
                     f'<p class="note">Título a {c["title"]} px en el banner: {fmt(c["title"] * 360 / 1280, 0)} px en un teléfono.</p>{figs}</article>')
    return f"""
<section id="banner" class="sec" aria-labelledby="banner-h">
<h2 id="banner-h">Banner: tres composiciones</h2>
<p class="lead">Las tres usan el amarillo actual. Cada una va primero en oscuro, la versión principal, y luego en claro, sobre el fondo real de GitHub. En claro ya no hay raya negra: el amarillo hace de campo, o el tablero claro lleva las fichas.</p>
{''.join(parts)}
</section>"""


def signal_block(s):
    tiles = s['tiles']
    chips_d = ''.join(f'<li>{chip(t["dark"], 26)}<span>{t["name"]}</span><span class="sub">{t["dark"]}</span></li>' for t in tiles)
    chips_l = ''.join(f'<li>{chip(t["light"], 26)}<span>{t["name"]}</span><span class="sub">{t["light"]}</span></li>' for t in tiles)
    if s['left']:
        left = ', '.join(f'{n} (distancia {fmt(d)})' for n, d in s['left'])
        change = f'Sale {left}. Entra {", ".join(s["joined"])}.'
    else:
        change = 'Ninguna ficha se le parece: el juego de seis queda como está.'
    lab = f'Tablero oscuro con las fichas de {s["name"]}'
    board = mini_board(NEW, 'dark', tiles, lab, merge_index(tiles))
    trs = ''.join(
        f'<tr><th scope="row">{chip(r["dark"]["fill"], 14)} {r["name"]}</th>'
        f'<td>{fmt(r["dark"]["board"])}</td><td>{fmt(r["dark"]["cell"])}</td>'
        f'<td>{fmt(r["light"]["board"])}</td><td>{fmt(r["light"]["cell"])}</td></tr>'
        for r in s['rows'])
    bd = banner_corte('dark', s['hex'], tiles)
    bl = banner_corte('light', s['hex'], tiles)
    return f"""
<article class="sig" id="sig-{s['id']}" aria-labelledby="sig-{s['id']}-h">
<header class="sig-head"><span class="sig-sw" style="background:{s['hex']}"></span>
<div><h3 id="sig-{s['id']}-h">{s['name']}</h3><p class="hex">{s['hex']}</p></div></header>
<div class="sig-grid">
<div class="sig-side">
<p>{escape(change)}</p>
<p class="label">Fichas en oscuro</p><ul class="chips">{chips_d}</ul>
<p class="label">Fichas en claro</p><ul class="chips">{chips_l}</ul>
<figure class="sig-board" style="background:{NEW['dark']['bg']}">{board}<figcaption>Tablero oscuro</figcaption></figure>
</div>
<div class="sig-main">
<figure class="bfig one"><div class="gh" style="background:{GITHUB['dark']}">{bd}</div><figcaption>Corte en oscuro</figcaption></figure>
<figure class="bfig one"><div class="gh" style="background:{GITHUB['light']}">{bl}</div><figcaption>Corte en claro</figcaption></figure>
<dl class="nums">
<div><dt>Señal como título sobre {NEW['dark']['bg']}</dt><dd>{ratio(s['title_on_dark'])}</dd></div>
<div><dt>Tinta {INK} sobre campo de señal</dt><dd>{ratio(s['ink_on_field'])}</dd></div>
<div><dt>Línea encendida en el tablero oscuro</dt><dd>{ratio(s['line_dark'])}</dd></div>
</dl>
<div class="tbl-wrap"><table class="t-sig"><caption>Fichas contra tablero y casilla vacía (mínimo 3:1)</caption>
<thead><tr><th scope="col" rowspan="2">Ficha</th><th scope="colgroup" colspan="2">Oscuro</th><th scope="colgroup" colspan="2">Claro</th></tr>
<tr><th scope="col">Tablero</th><th scope="col">Casilla</th><th scope="col">Tablero</th><th scope="col">Casilla</th></tr></thead>
<tbody>{trs}</tbody></table></div>
</div>
</div>
</article>"""


def section_signals():
    return f"""
<section id="senal" class="sec" aria-labelledby="senal-h">
<h2 id="senal-h">Color de señal: cuatro candidatos</h2>
<p class="lead">El principio es el mismo para los cuatro: un color fuerte que hace de campo con letra tinta y de título sobre casi negro, y que nunca es ficha. Si una ficha queda a menos de {fmt(OK_SPLIT)} de la señal en distancia OKLab, sale del juego; el amarillo entra a las fichas cuando deja de ser señal. Cada candidato va con la composición Corte, la única en la que ninguna ficha toca el campo de señal, así que sirve con cualquier color.</p>
{''.join(signal_block(s) for s in SIGNALS)}
</section>"""


def section_decide():
    s = {x['id']: x for x in SIGNALS}
    y_light = NEW['light']['board']
    lines = [
        f'Corte es la composición que aguanta cualquier señal y mantiene el nombre igual en los dos temas; Titular y Escalera ponen el título en amarillo sobre negro, lo que más gustó, pero en oscuro su fondo ({DARK_BG}) se funde con el de GitHub ({GITHUB["dark"]}) y el banner pierde su borde.',
        f'Amarillo no cambia nada de lo decidido y es el que más se ve en miniatura; en claro el campo amarillo y el tablero gris tienen casi la misma luminancia ({ratio(cr(YELLOW, y_light))}) y el corte se lee solo por el tono.',
        f'Naranja retoma la mandarina ya publicada, más encendida; cuesta el rojo, y el amarillo que entra se vuelve {s["naranja"]["tiles"][0]["light"]} en el tablero claro.',
        f'Rosa es el más de juego pero saca dos fichas, rojo y magenta; Cian da el título de más contraste ({ratio(s["cian"]["title_on_dark"])}) pero cian sobre casi negro se acerca al aire de herramienta técnica, y cuesta el celeste.',
    ]
    return ('<section id="decidir" class="sec decide" aria-labelledby="decidir-h"><h2 id="decidir-h">Para decidir</h2><ul>'
            + ''.join(f'<li>{escape(x)}</li>' for x in lines) + '</ul></section>')


# ---------- Page ----------

def css():
    L, D = NEW['light'], NEW['dark']
    light = (f'--bg:{L["bg"]};--surface:{L["surface"]};--ink:{L["text"]};--muted:{L["muted"]};'
             f'--line:{L["board"]};--focus:{INK};--accent:{YELLOW};--on-accent:{INK};color-scheme:light')
    dark = (f'--bg:{D["bg"]};--surface:{D["surface"]};--ink:{D["text"]};--muted:{D["muted"]};'
            f'--line:#343846;--focus:{YELLOW};--accent:{YELLOW};--on-accent:{INK};color-scheme:dark')
    for th, t in (('light', L), ('dark', D)):
        gate(f'página {th}: texto secundario sobre fondo', cr(t['muted'], t['bg']), TEXT_MIN)
        gate(f'página {th}: texto secundario sobre superficie', cr(t['muted'], t['surface']), TEXT_MIN)
    gate('página: foco claro sobre fondo', cr(INK, L['bg']), LARGE_MIN)
    gate('página: foco oscuro sobre fondo', cr(YELLOW, D['bg']), LARGE_MIN)
    return CSS.replace('/*LIGHT*/', light).replace('/*DARK*/', dark)


CSS = r"""
:root{/*LIGHT*/}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){/*DARK*/}}
:root[data-theme="dark"]{/*DARK*/}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 Archivo,"Helvetica Neue",Arial,sans-serif}
.wrap{padding-left:max(16px, env(safe-area-inset-left, 0px));padding-right:max(16px, env(safe-area-inset-right, 0px));padding-block:40px 80px}
.inner{max-width:1200px;margin-inline:auto;display:grid;gap:64px}
.sections{display:grid;gap:72px;min-width:0}
h1,h2,h3,h4,p,ul,dl,dd,figure{margin:0}
h1,h2{font-family:Unbounded,"Arial Black","Segoe UI",sans-serif;font-weight:800;letter-spacing:-0.02em;line-height:1.08}
h1{font-size:clamp(32px,5.2vw,60px)}
h2{font-size:clamp(24px,3.2vw,36px)}
h3{font-size:21px;line-height:1.25;font-weight:600}
h4{font-size:16px;font-weight:600}
.top{display:grid;gap:16px;max-width:70ch}
.top p{font-size:18px}
nav ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:4px 22px}
nav a{display:inline-flex;align-items:center;min-height:44px;font-weight:600;color:var(--ink);text-underline-offset:4px}
a:focus-visible{outline:3px solid var(--focus);outline-offset:3px;border-radius:2px}
.sec{display:grid;gap:24px;min-width:0;scroll-margin-top:16px}
.lead{max-width:72ch;font-size:17px}
.sub-sec{display:grid;gap:16px;background:var(--surface);border-radius:12px;padding:clamp(16px,2.4vw,28px);min-width:0}
.sub-sec>p{max-width:72ch}
.theme-row{display:grid;gap:10px}
.pair{display:grid;gap:12px}
@media (min-width:620px){.pair{grid-template-columns:1fr 1fr}}
.sample{display:grid;gap:8px}
.sample-bg{padding:clamp(18px,3vw,32px);border-radius:8px}
.sample-card{border-radius:10px;padding:18px 20px;display:grid;gap:4px}
.sc-t{font-weight:600;font-size:17px}
.sc-m{font-size:15px}
figcaption{font-size:14px;color:var(--muted)}
figcaption b{color:var(--ink);font-weight:600;margin-right:6px}
.sub{display:block;color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.mboard{border-radius:8px;padding:16px;display:grid;gap:8px;justify-items:center}
.mboard svg{width:100%;max-width:300px;height:auto}
.mboard figcaption b{color:inherit}
.mboard figcaption{text-align:center}
.tbl-wrap{overflow-x:auto;max-width:100%}
table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
th,td{text-align:left;vertical-align:top;padding:8px 8px 8px 0;border-bottom:1px solid var(--line)}
thead th{font-weight:600;color:var(--muted)}
tbody th{font-weight:600;white-space:nowrap}
caption{text-align:left;font-size:14px;color:var(--muted);padding-bottom:6px}
.chip{display:inline-block;vertical-align:-3px;flex:none}
.note{font-size:14px;color:var(--muted)}
.comp{display:grid;gap:14px;min-width:0}
.comp>p{max-width:72ch}
.bfig{display:grid;gap:8px;min-width:0}
.gh{padding:clamp(10px,2vw,24px);border-radius:8px}
.gh svg,.phone svg{display:block;width:100%;height:auto}
.phone{display:none;border-radius:8px;padding:12px}
.phone-in{width:100%}
.bfig figcaption{grid-column:1/-1}
@media (min-width:1100px){
  .bfig{grid-template-columns:minmax(0,1fr) 384px;align-items:center}
  .bfig.one{grid-template-columns:minmax(0,1fr)}
  .phone{display:block}
}
.sig{background:var(--surface);border-radius:12px;padding:clamp(16px,2.4vw,28px);display:grid;gap:20px;min-width:0}
.sig-head{display:flex;align-items:center;gap:16px}
.sig-sw{width:56px;height:56px;border-radius:8px;flex:none;clip-path:polygon(25% 3%,75% 3%,100% 50%,75% 97%,25% 97%,0 50%)}
.sig-head h3{font-family:Unbounded,"Arial Black",sans-serif;font-weight:800;font-size:clamp(20px,2.4vw,26px)}
.hex{color:var(--muted);font-variant-numeric:tabular-nums}
.sig-grid{display:grid;gap:24px;min-width:0}
@media (min-width:980px){.sig-grid{grid-template-columns:300px minmax(0,1fr)}}
.sig-side,.sig-main{display:grid;gap:12px;align-content:start;min-width:0}
.label{font-weight:600;font-size:15px}
.chips{list-style:none;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 8px}
.chips li{display:grid;justify-items:start;font-size:13px;line-height:1.3;min-width:0}
.sig-board{border-radius:8px;padding:14px;display:grid;gap:6px;justify-items:center}
.sig-board svg{width:100%;max-width:260px;height:auto}
.sig-board figcaption{color:#a3a7b6}
.nums{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.nums div{display:grid;gap:2px}
.nums dt{font-size:14px;color:var(--muted)}
.nums dd{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}
.t-sig td{width:17%}
.decide{background:var(--accent);color:var(--on-accent);border-radius:12px;padding:clamp(20px,3vw,40px)}
.decide ul{padding-left:1.1em;display:grid;gap:12px;max-width:80ch;font-size:17px}
@media (prefers-reduced-motion: no-preference){html{scroll-behavior:smooth}}
"""

FONTS = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&amp;family=Unbounded:wght@800&amp;display=swap'


def page():
    nav = [('cambios', 'Lo que cambió'), ('banner', 'Banner'), ('senal', 'Color de señal'), ('decidir', 'Para decidir')]
    nav_html = ''.join(f'<li><a href="#{i}">{t}</a></li>' for i, t in nav)
    body = (section_changes() + section_banners() + section_signals() + section_decide())
    return f"""<title>Rombo HexaBlock</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>{css()}</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<div class="wrap"><div class="inner">
<header class="top">
<h1>Rombo, segunda vuelta</h1>
<p>El tema oscuro pasa a ser la versión principal de todo lo que es una sola imagen: el banner de GitHub y las vistas previas al compartir. La app sigue el tema del teléfono.</p>
<p>Esta página arregla las dos quejas del primer tablero, prueba tres banners nuevos y compara cuatro colores de señal. Cada número sale de la fórmula de luminancia relativa de WCAG 2.x.</p>
<nav aria-label="Secciones"><ul>{nav_html}</ul></nav>
</header>
<main class="sections">{body}</main>
</div></div>
"""


def report():
    for th in THEMES:
        o, n = OLD[th], NEW[th]
        print(f'== {th}')
        print(f'  surface/bg   {cr(o["surface"], o["bg"]):.3f} -> {cr(n["surface"], n["bg"]):.3f}   bg {n["bg"]} surface {n["surface"]}')
        print(f'  cell/board   {cr(o["cell"], o["board"]):.3f} -> {cr(n["cell"], n["board"]):.3f}   board {n["board"]} cell {n["cell"]}')
        print(f'  tile min     {min_tile(OLD_ROWS, th):.3f} -> {min_tile(NEW_ROWS, th):.3f}')
        for o_t, n_t in zip(OLD_TILES, NEW_TILES):
            print(f'    {n_t["name"]:10} {o_t[th]} -> {n_t[th]}')
    for s in SIGNALS:
        print(f'== {s["name"]} {s["hex"]}  left {s["left"]} joined {s["joined"]}')
        print(f'  title on dark {s["title_on_dark"]:.2f}  ink on field {s["ink_on_field"]:.2f}  line dark {s["line_dark"]:.2f}')
        print(f'  closest tile pair {s["min_pair"][0]:.3f} {s["min_pair"][1:]}')
        for t, r in zip(s['tiles'], s['rows']):
            print(f'    {t["name"]:10} dark {t["dark"]} {r["dark"]["board"]:.2f}/{r["dark"]["cell"]:.2f}  '
                  f'light {t["light"]} {r["light"]["board"]:.2f}/{r["light"]["cell"]:.2f}')
    low = sorted(CHECKS, key=lambda c: c[1] - c[2])[:8]
    print(f'== {len(CHECKS)} checks passed; closest to their minimum:')
    for label, v, m in low:
        print(f'  {v:.2f} (min {m}) {label}')


if __name__ == '__main__':
    html = page()
    assert '—' not in html, 'em dash found'
    # The default output is brand/tools/build/. Git ignores that folder.
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / 'build' / 'rombo.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    report()
