#!/usr/bin/env python3
"""Build componentes.html: the HexaBlock components decision board.

Usage: python3 gen.py [<out.html>]

Without an argument, the page goes to brand/tools/build/componentes.html.
The build folder is git-ignored: the page is a review page, not a published asset.

Every color comes from the draft brand/DESIGN.md. Every ratio on the page comes
from this file (WCAG 2.x relative luminance). The build stops when text is
under 4.5:1 (3:1 at 24 px and up, or bold at 18.66 px and up), when a tile is
under 3:1 against its board or empty cell, or when the HTML does not balance.
The contrast helpers and the board drawing are copied from ds-rombo/gen.py.
"""

import colorsys
import math
import sys
from html import escape
from html.parser import HTMLParser
from pathlib import Path

# ---------- WCAG 2.x contrast (copied from ds-rombo/gen.py) ----------


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


def reach(base, against, target, toward):
    """Mix base toward a pole until it reaches the target ratio on every color in against."""
    for i in range(0, 201):
        c = mix(base, toward, i / 200)
        if worst(c, against) >= target:
            return c
    raise ValueError(f'{base} cannot reach {target} against {against}')


def deep_pole(c):
    h, _, _ = colorsys.rgb_to_hls(*rgb(c))
    return hexc(colorsys.hls_to_rgb(h, 0.13, 1.0))


def fmt(v, d=2):
    return f'{v:.{d}f}'.replace('.', ',')


def ratio(v):
    return fmt(v) + ':1'


CHECKS = []
TEXT_MIN, LARGE_MIN, TILE_MIN = 4.5, 3.0, 3.0


def gate(label, value, minimum):
    CHECKS.append((label, value, minimum))
    assert value >= minimum, f'FAIL {label}: {value:.3f} < {minimum}'
    return value


def text_gate(label, fg, bg, px, bold=False):
    """Text pair: 3:1 for 24 px and up, or bold 18.66 px and up; 4.5:1 otherwise."""
    large = px >= 24 or (bold and px >= 18.66)
    return gate(f'texto {label} ({px} px)', cr(fg, bg), LARGE_MIN if large else TEXT_MIN)


def ui_gate(label, fg, bg):
    """Non-text pair (icon, focus ring, field edge): 3:1."""
    return gate(f'gráfico {label}', cr(fg, bg), 3.0)


# ---------- Tokens from brand/DESIGN.md ----------

INK = '#121319'
SIG = '#1ad8ff'
SIG_TEXT_LIGHT = '#00728a'
WHITE = '#ffffff'

THEMES = ('dark', 'light')
THEME_ES = {'dark': 'oscuro', 'light': 'claro'}

T = {
    'dark': dict(bg='#0d0e13', sf='#262830', bd='#050609', cl='#2a2c33', tx='#f2f3f6', mu='#a3a7b6',
                 sigtx=SIG),
    'light': dict(bg='#eaeaec', sf='#ffffff', bd='#dbdde4', cl='#ffffff', tx='#121319', mu='#4a4d5a',
                  sigtx=SIG_TEXT_LIGHT),
}

TILES = [  # name, dark, light (the "Cian señal" set)
    ('Amarillo', '#ffc800', '#957500'),
    ('Rojo', '#ff4b55', '#cf3d45'),
    ('Esmeralda', '#22d47a', '#15834c'),
    ('Azul', '#5b84ff', '#4b6cd1'),
    ('Violeta', '#a777ff', '#845ec9'),
    ('Magenta', '#ff4fb3', '#c43d8a'),
]


def tile(i, th):
    return TILES[i][1 if th == 'dark' else 2]


# Derived values. Each one is a proposal shown on the page as derived, not a draft token.
SIG_PRESSED = mix(SIG, INK, 0.15)
for th in THEMES:
    t = T[th]
    t['sig'] = SIG
    t['ink'] = INK
    t['sigp'] = SIG_PRESSED
    t['ring'] = t['sigtx']
    # Pressed surface: one step toward the text color.
    t['sfp'] = mix(t['sf'], t['tx'], 0.10) if th == 'dark' else t['bd']  # light: the board token
    # The bottom edge of the "Pieza" buttons reuses tokens that already exist.
    t['edge'] = SIG_TEXT_LIGHT
    t['sfedge'] = '#4a4d5a' if th == 'dark' else '#a3a7b6'
T['dark']['err'] = '#ff4b55'  # tile Rojo, dark shade
T['light']['err'] = reach('#cf3d45', [T['light']['bg'], T['light']['sf']], TEXT_MIN, deep_pole('#cf3d45'))
T['dark']['shadow'] = '0 1px 2px rgba(0,0,0,.55), 0 8px 20px rgba(0,0,0,.40)'
T['light']['shadow'] = '0 1px 2px rgba(18,19,25,.10), 0 8px 20px rgba(18,19,25,.10)'

# ---------- Option sets ----------

TYPE = {
    'a': dict(name='Compacta', step='pasos de 1,2 sobre 15',
              d=(31, 1.05), t=(22, 1.2, 'Archivo', 600), b=(15, 1.45, 400), l=(13, 1.3, 500)),
    'b': dict(name='Media', step='pasos de 1,25 sobre 16',
              d=(39, 1.05), t=(25, 1.2, 'Unbounded', 800), b=(16, 1.5, 400), l=(14, 1.3, 500)),
    'c': dict(name='Cartel', step='pasos de 1,333 sobre 16',
              d=(50, 1.0), t=(28, 1.15, 'Unbounded', 800), b=(16, 1.5, 400), l=(14, 1.3, 600)),
}
RADIUS = {
    'a': dict(name='Recto', btn=2, card=2, board=2, inp=2),
    'b': dict(name='Pequeño', btn=6, card=10, board=12, inp=6),
    'c': dict(name='Amplio', btn=14, card=20, board=24, inp=12),
}
SPACE = {
    'a': dict(name='Base 4', scale='4 · 8 · 12 · 16 · 24 · 32', gut=16, pad=16, gap=8, blk=24),
    'b': dict(name='Base 8', scale='8 · 16 · 24 · 32 · 48', gut=24, pad=24, gap=16, blk=32),
}
BUTTONS = {
    'a': dict(name='Campo plano'),
    'b': dict(name='Pieza'),
    'c': dict(name='Titular'),
}
INPUTS = {
    'a': dict(name='Relleno'),
    'b': dict(name='Contorno'),
}
ICONS = {
    'a': dict(name='Trazo recto', sw=2, cap='square', join='miter', fill='none'),
    'b': dict(name='Trazo redondo', sw=1.75, cap='round', join='round', fill='none'),
    'c': dict(name='Macizo', sw=2.5, cap='butt', join='miter', fill='currentColor'),
}
DEPTH = {
    'a': dict(name='Sin sombra'),
    'b': dict(name='Sombra sutil'),
}

# Field end of the cyan header. B and C are halves of a hexagon sized from the field height.
END_INSET = 24  # px between the field end and the right screen edge, for B and C
ENDS = {
    'a': dict(name='Corte 60°', k=None),
    'b': dict(name='Lado plano arriba', k=1 / (2 * math.sqrt(3))),  # depth of the ">" = H / (2 * sqrt 3)
    'c': dict(name='Punta arriba', k=math.sqrt(3) / 4),  # half width of a pointy-top hexagon = sqrt 3 / 4 * H
}

REC = dict(t='c', r='a', s=None, b='b', n='a', i='c', d='a', e=None)
DEFAULT = {k: (v or 'a') for k, v in REC.items()}  # what the screens show before any click
PRESELECT = {k for k in REC if k != 'e'}  # groups whose radio starts checked; Remate starts with no letter
SETS = [('t', 'Tipografía', TYPE), ('r', 'Radio', RADIUS), ('s', 'Espaciado', SPACE), ('b', 'Botones', BUTTONS),
        ('n', 'Campos', INPUTS), ('i', 'Íconos', ICONS), ('d', 'Profundidad', DEPTH), ('e', 'Remate', ENDS)]

# ---------- Gates ----------

for th in THEMES:
    t = T[th]
    es = THEME_ES[th]
    for i, (name, _, _) in enumerate(TILES):
        gate(f'ficha {name} {es} contra tablero', cr(tile(i, th), t['bd']), TILE_MIN)
        gate(f'ficha {name} {es} contra casilla', cr(tile(i, th), t['cl']), TILE_MIN)
    for k in ('bg', 'sf'):
        text_gate(f'principal sobre {k} {es}', t['tx'], t[k], 13)
        text_gate(f'secundario sobre {k} {es}', t['mu'], t[k], 13)
        text_gate(f'cian de texto sobre {k} {es}', t['sigtx'], t[k], 15, True)
        ui_gate(f'ícono principal sobre {k} {es}', t['tx'], t[k])
        ui_gate(f'ícono cian sobre {k} {es}', t['sigtx'], t[k])
        ui_gate(f'anillo de foco sobre {k} {es}', t['ring'], t[k])
    text_gate(f'tinta sobre cian {es}', INK, SIG, 15, True)
    text_gate(f'tinta sobre cian presionado {es}', INK, SIG_PRESSED, 15, True)
    text_gate(f'principal sobre superficie presionada {es}', t['tx'], t['sfp'], 15, True)
    text_gate(f'error sobre fondo {es}', t['err'], t['bg'], 13)
    ui_gate(f'borde de campo B sobre fondo {es}', t['mu'], t['bg'])
    ui_gate(f'barra de campo A sobre superficie {es}', t['mu'], t['sf'])
    ui_gate(f'barra de error sobre superficie {es}', t['err'], t['sf'])
    ui_gate(f'borde de error sobre fondo {es}', t['err'], t['bg'])
    ui_gate(f'anillo de foco sobre fondo {es} (página)', t['ring'], t['bg'])

# Layout gate: "HexaBlock" fits on one line of the home header at every type and spacing pair.
EM_HEXABLOCK = 6.750  # advance width per 1 px of Unbounded 800, measured in ds-rombo/gen.py
for tk, tv in TYPE.items():
    for sk, sv in SPACE.items():
        width = EM_HEXABLOCK * tv['d'][0] * (1 - 0.02)  # -0.02em tracking over about nine glyphs
        gate(f'HexaBlock cabe en el encabezado (tipografía {tk.upper()}, espaciado {sk.upper()})',
             (390 - 2 * sv['gut']) / width, 1.0)

# "Hexa Merge" at 28 px measured 208 px in the first 1440 screenshot: 7.43 em of Unbounded 800.
EM_LONG_NAME = 7.43


def name_fits(tk, sk):
    tv, sv = TYPE[tk], SPACE[sk]
    if tv['t'][2] != 'Unbounded':
        return True  # Archivo 600 runs far narrower than Unbounded
    room = 390 - 2 * sv['gut'] - 2 * sv['pad'] - 44 - 2 * 0.75 * sv['pad'] - 24
    return EM_LONG_NAME * tv['t'][0] <= room


WRAPS = [(tk, sk) for tk in TYPE for sk in SPACE if not name_fits(tk, sk)]

PHONE_W = 390


def header_height(tk, sk, fs):
    """Height of the cyan header: padding, the name line, the Suite line and its 2 px margin."""
    tv, sv = TYPE[tk], SPACE[sk]
    return 1.5 * sv['blk'] + fs * tv['d'][1] + 0.42 * fs * 1.2 + 2


def header_geom(tk, sk, ek):
    """Name size, field height and end depth on a 390 px phone. B and C shrink the name until it stays left of the end."""
    fs0 = TYPE[tk]['d'][0]
    if ENDS[ek]['k'] is None:
        return dict(fs=fs0, h=None, d=None, end=PHONE_W)
    gut = SPACE[sk]['gut']
    end = PHONE_W - END_INSET
    for fs in range(fs0, 12, -1):
        h = math.ceil(header_height(tk, sk, fs))
        d = ENDS[ek]['k'] * h
        if gut + EM_HEXABLOCK * fs * 0.98 + 8 <= end - d:
            return dict(fs=fs, h=h, d=d, end=end)
    raise ValueError((tk, sk, ek))


GEOM = {(tk, sk, ek): header_geom(tk, sk, ek) for tk in TYPE for sk in SPACE for ek in ENDS}
for (tk, sk, ek), g in GEOM.items():
    if g['h'] is None:
        continue
    tag = f'remate {ek.upper()}, tipografía {tk.upper()}, espaciado {sk.upper()}'
    # The CSS sets margin-right to END_INSET - gut, so the field ends at 390 - END_INSET.
    right_edge = PHONE_W - SPACE[sk]['gut'] - (END_INSET - SPACE[sk]['gut'])
    gate(f'{tag}: el campo termina a 24 px o más del borde derecho', (PHONE_W - right_edge) / 24, 1.0)
    gate(f'{tag}: «HexaBlock» queda a la izquierda del remate',
         (g['end'] - g['d'] - 8 - SPACE[sk]['gut']) / (EM_HEXABLOCK * g['fs'] * 0.98), 1.0)

R = {th: {} for th in THEMES}  # ratios shown on the page
for th in THEMES:
    t = T[th]
    R[th] = dict(
        ink_sig=cr(INK, SIG), ink_sigp=cr(INK, SIG_PRESSED), tx_bg=cr(t['tx'], t['bg']), tx_sf=cr(t['tx'], t['sf']),
        mu_bg=cr(t['mu'], t['bg']), mu_sf=cr(t['mu'], t['sf']), sigtx_bg=cr(t['sigtx'], t['bg']),
        sigtx_sf=cr(t['sigtx'], t['sf']), tx_sfp=cr(t['tx'], t['sfp']), err_bg=cr(t['err'], t['bg']),
        err_sf=cr(t['err'], t['sf']), ring_bg=cr(t['ring'], t['bg']), sf_bg=cr(t['sf'], t['bg']),
        tile_min=min(min(cr(tile(i, th), t['bd']), cr(tile(i, th), t['cl'])) for i in range(6)))

# ---------- SVG: icons ----------

ICON_PATHS = {
    'play': '<path class="f" d="M7.5 4.5 19 12 7.5 19.5Z"/>',
    'back': '<path d="M15 4.5 7.5 12 15 19.5"/>',
    'settings': ('<path class="f" fill-rule="evenodd" d="M19.8 7.5V16.5L12 21 4.2 16.5V7.5L12 3Z'
                 'M15.5 12A3.5 3.5 0 1 0 8.5 12 3.5 3.5 0 1 0 15.5 12Z"/>'),
    'trophy': ('<path class="f" d="M7 3.5H17V9A5 5 0 0 1 7 9Z"/>'
               '<path d="M7 5.5H4.5V7.5A3 3 0 0 0 7.5 10.5M17 5.5H19.5V7.5A3 3 0 0 1 16.5 10.5M12 14V17.5"/>'
               '<path class="f" d="M8 17.5H16V20.5H8Z"/>'),
    'undo': '<path d="M9 6.5 4.5 11 9 15.5M4.5 11H14A4.5 4.5 0 0 1 14 20H10"/>',
    'alert': ('<path class="f" d="M12 3.5 21 19.5H3Z"/>'
              '<path class="cut" d="M12 9.5V14M12 16.2V17.2"/>'),
}
ICON_ES = {'play': 'Jugar', 'settings': 'Ajustes', 'trophy': 'Récord', 'back': 'Volver'}


def icon(name, size=24, cls=''):
    return (f'<svg class="ico {cls}" width="{size}" height="{size}" viewBox="0 0 24 24" aria-hidden="true">'
            f'{ICON_PATHS[name]}</svg>')


# ---------- SVG: board (mini_board from ds-rombo/gen.py, without the Merge cell) ----------

SQ3 = math.sqrt(3)
MINI_N = 5
MINI_R = 22
MINI_TILES = {(1, 0): 0, (4, 0): 1, (0, 2): 2, (2, 1): 3, (3, 2): 4, (1, 4): 5, (4, 4): 0, (0, 4): 2,
              (2, 2): 3, (2, 3): 1}


def hexpts(cx, cy, r, pointy=True):
    off = 30 if pointy else 0
    return ' '.join(
        f'{cx + r * math.cos(math.radians(off + 60 * k)):.1f},{cy + r * math.sin(math.radians(off + 60 * k)):.1f}'
        for k in range(6))


def poly(cx, cy, r, fill):
    return f'<polygon points="{hexpts(cx, cy, r)}" fill="{fill}"/>'


def board_svg(th, cls='board'):
    t = T[th]
    R_ = MINI_R
    pts = [(q, r, SQ3 * R_ * (q + r / 2), 1.5 * R_ * r) for r in range(MINI_N) for q in range(MINI_N)]
    xs, ys = [p[2] for p in pts], [p[3] for p in pts]
    pad = R_ * 1.35
    x0, y0 = min(xs) - pad, min(ys) - pad
    w, h = max(xs) - min(xs) + 2 * pad, max(ys) - min(ys) + 2 * pad
    out = [f'<svg class="{cls}" viewBox="{x0:.1f} {y0:.1f} {w:.1f} {h:.1f}" aria-hidden="true">']
    out += [poly(x, y, R_ * 1.22, t['bd']) for _, _, x, y in pts]
    for q, r, x, y in pts:
        fill = tile(MINI_TILES[(q, r)], th) if (q, r) in MINI_TILES else t['cl']
        out.append(poly(x, y, R_ * 0.9, fill))
    out.append('</svg>')
    return ''.join(out)


# ---------- Corte banner (copied from ds-rombo/gen.py, with the field end as a parameter) ----------

UNB = "Unbounded, &#39;Arial Black&#39;, &#39;Segoe UI&#39;, sans-serif"
ARC = "Archivo, &#39;Helvetica Neue&#39;, Arial, sans-serif"
EM = {'HexaBlock': 6.750, 'Suite': 3.322, 'tag500': 20.463}
TAGLINE = 'Four hex puzzle games on one generic engine'
CORTE = dict(top=1000, size=112, base=156, size2=44, base2=226, tag=26, R=36)
GITHUB = dict(dark='#0d1117', light='#ffffff')  # default GitHub page backgrounds
BANNER_H = 320
# Where each field end reaches on the 1280 px banner. A is the published Corte geometry.
BANNER_END = {'b': 960, 'c': 1000}


def lockup(x, base1, size1, base2, size2, color_title, color_tag, tag_size):
    suite_w = EM['Suite'] * size2
    gap = size2 * 0.5
    return (f'<text x="{x}" y="{base1}" font-family="{UNB}" font-weight="800" font-size="{size1}" fill="{color_title}" letter-spacing="-1">HexaBlock</text>'
            f'<text x="{x + 2}" y="{base2}" font-family="{UNB}" font-weight="800" font-size="{size2}" fill="{color_title}">Suite</text>'
            f'<text x="{x + 2 + suite_w + gap:.0f}" y="{base2}" font-family="{ARC}" font-weight="500" font-size="{tag_size}" fill="{color_tag}">{TAGLINE}</text>')


def corte_cells():
    R_ = CORTE['R']
    cells = []
    for r in range(-1, 8):
        for q in range(-8, 20):
            x = 760 + SQ3 * R_ * (q + r / 2)
            y = 4 + 1.5 * R_ * r
            if -R_ < y < BANNER_H + R_ and 600 < x < 1280 + R_:
                cells.append((q, r, x, y))
    return cells


def corte_fill(q, r):
    h = (q * 73856093) ^ (r * 19349663)
    h = (h ^ (h >> 7)) & 0xffff
    return h % 100 < 40, h % 6


def corte_board_group(th):
    """The board crop of banner_corte, defined once per theme and reused with <use>."""
    t = T[th]
    out = [f'<g id="corte-board-{th}"><rect width="1280" height="{BANNER_H}" fill="{t["bd"]}"/>']
    line_k, n = 7, 0
    for q, r, x, y in corte_cells():
        if q + r == line_k:
            if th == 'dark':
                fill = SIG
            else:
                fill = tile(n % 6, th)
                n += 1
        else:
            filled, idx = corte_fill(q, r)
            filled = filled and abs(q + r - line_k) > 1
            fill = tile((idx + q) % 6, th) if filled else t['cl']
        out.append(poly(x, y, CORTE['R'] - 3.5, fill))
    out.append('</g>')
    if th == 'dark':
        gate('banner Corte oscuro: línea encendida contra tablero y casilla', worst(SIG, [t['bd'], t['cl']]), TILE_MIN)
    return ''.join(out)


def banner_field(ek):
    """Polygon points of the signal field for each end, on the 1280 x 320 banner."""
    H = BANNER_H
    if ek == 'a':
        bot = CORTE['top'] - H * math.tan(math.radians(30))
        return f'0,0 {CORTE["top"]},0 {bot:.1f},{H} 0,{H}'
    x, d = BANNER_END[ek], ENDS[ek]['k'] * H
    if ek == 'b':
        return f'0,0 {x - d:.1f},0 {x},{H / 2:.0f} {x - d:.1f},{H} 0,{H}'
    return f'0,0 {x - d:.1f},0 {x},{H / 4:.0f} {x},{3 * H / 4:.0f} {x - d:.1f},{H} 0,{H}'


TITLE_RIGHT = 60 + EM['HexaBlock'] * CORTE['size']
for ek, x in BANNER_END.items():
    gate(f'banner remate {ek.upper()}: el nombre queda 24 px o más antes del remate',
         (x - ENDS[ek]['k'] * BANNER_H - TITLE_RIGHT) / 24, 1.0)
gate('banner: título tinta sobre señal', cr(INK, SIG), LARGE_MIN)
text_gate('banner: lema tinta sobre señal', INK, SIG, 26)


def banner_svg(th, ek):
    k = CORTE
    label = (f'Banner Corte, tema {THEME_ES[th]}, remate {ek.upper()} ({ENDS[ek]["name"]}): '
             f'HexaBlock Suite sobre el campo cian junto a un recorte del tablero')
    return (f'<svg viewBox="0 0 1280 {BANNER_H}" role="img" aria-label="{escape(label)}">'
            f'<use href="#corte-board-{th}"/><polygon points="{banner_field(ek)}" fill="{SIG}"/>'
            f'{lockup(60, k["base"], k["size"], k["base2"], k["size2"], INK, INK, k["tag"])}</svg>')


BADGES = {  # three small cells per game: (dx, dy, tile index or None for an empty cell)
    'Hexa Lines': [(-1, 0, 0), (0, 0, 0), (1, 0, 0)],
    'Hexa Fit': [(-0.5, -0.75, 3), (0.5, -0.75, 3), (0, 0.75, 3)],
    'Hexa Sort': [(-0.5, 0.75, 4), (0.5, 0.75, 2), (0, -0.75, 4)],
    'Hexa Merge': [(-0.5, 0, 5), (0.5, 0, 5)],
}


def badge(game, th):
    r = 7.2
    out = [f'<svg class="badge-svg" viewBox="-22 -22 44 44" aria-hidden="true">']
    for dx, dy, i in BADGES[game]:
        out.append(poly(dx * SQ3 * r, dy * 1.5 * r * 1.15, r * 0.95, tile(i, th)))
    out.append('</svg>')
    return ''.join(out)


# ---------- Kit markup ----------


def attrs(opts):
    return ' '.join(f'data-{k}="{v}"' for k, v in opts.items())


def kit_root(th, opts, cls, inner, label=None, tag='div'):
    lab = f' role="img" aria-label="{escape(label)}"' if label else ''
    return f'<{tag} class="kit th-{th} {cls}" {attrs(opts)}{lab}>{inner}</{tag}>'


GAMES = [
    ('Hexa Lines', 'Completa líneas en tres ejes'),
    ('Hexa Fit', 'Encaja piezas en el tablero'),
    ('Hexa Sort', 'Ordena fichas por color'),
    ('Hexa Merge', 'Une fichas iguales'),
]


def entry(th, game, desc):
    return (f'<div class="card entry"><span class="badge">{badge(game, th)}</span>'
            f'<span class="e-txt"><span class="e-name">{game}</span><span class="e-desc">{desc}</span></span>'
            f'{icon("play", 24, "e-go")}</div>')


def screen_home(th, opts, label):
    cards = ''.join(entry(th, g, d) for g, d in GAMES)
    inner = (f'<div class="ph-in">'
             f'<div class="hd"><p class="hd-name">HexaBlock</p><p class="hd-suite">Suite</p></div>'
             f'<p class="ph-lead">Cuatro juegos sobre un tablero hexagonal.</p>'
             f'<div class="list">{cards}</div>'
             f'<div class="btn btn-s set-row">{icon("settings", 24)}<span>Ajustes</span></div>'
             f'</div>')
    return f'<div class="dev">{kit_root(th, opts, "ph", inner, label)}</div>'


def screen_game(th, opts, label):
    inner = (f'<div class="ph-in">'
             f'<div class="bar"><span class="ibtn">{icon("back", 24)}</span><p class="g-title">Hexa Lines</p>'
             f'<span class="ibtn">{icon("undo", 24)}</span></div>'
             f'<div class="card score"><div><p class="lab">Puntaje</p><p class="num">1.280</p></div>'
             f'<div class="best"><p class="lab">Récord</p><p class="num-s">{icon("trophy", 20)}<span>4.020</span></p></div></div>'
             f'<div class="frame">{board_svg(th)}</div>'
             f'<div class="acts"><span class="btn btn-p">{icon("play", 20)}<span>Nueva partida</span></span>'
             f'<span class="btn btn-g">Cómo se juega</span></div>'
             f'</div>')
    return f'<div class="dev">{kit_root(th, opts, "ph", inner, label)}</div>'


def opts_with(**over):
    o = dict(DEFAULT)
    o.update(over)
    return o


# ---------- Page blocks ----------


def rec_tag(key, letter):
    return '<span class="rec">Recomendada</span>' if REC.get(key) == letter else ''


def opt_head(key, letter, name):
    return (f'<header class="opt-h"><span class="letter">{letter.upper()}</span>'
            f'<h3>{escape(name)}</h3>{rec_tag(key, letter)}</header>')


def spec(rows):
    return '<dl class="spec">' + ''.join(f'<div><dt>{k}</dt><dd>{v}</dd></div>' for k, v in rows) + '</dl>'


def rec_line(text):
    return f'<p class="why"><b>Por qué la recomendada:</b> {text}</p>'


def section(sid, title, intro, body, todo):
    return (f'<section id="{sid}" class="sec" aria-labelledby="{sid}-h">'
            f'<div class="sec-top"><h2 id="{sid}-h">{title}</h2><p>{intro}</p>'
            f'<p class="todo">Llena en DESIGN.md: {todo}</p></div>{body}</section>')


def panel(th, opts, inner, cls=''):
    return kit_root(th, opts, f'pnl {cls}', f'<p class="pnl-cap">Tema {THEME_ES[th]}</p>{inner}')


def sec_type():
    items = []
    for k, v in TYPE.items():
        d, t_, b, l_ = v['d'], v['t'], v['b'], v['l']
        rows = [('Display', f'{d[0]} px / {fmt(d[1])} · Unbounded 800'),
                ('Título', f'{t_[0]} px / {fmt(t_[1])} · {t_[2]} {t_[3]}'),
                ('Cuerpo', f'{b[0]} px / {fmt(b[1])} · Archivo {b[2]}'),
                ('Etiqueta', f'{l_[0]} px / {fmt(l_[1])} · Archivo {l_[2]}')]
        phone = screen_home('dark', opts_with(t=k), f'Inicio en tema oscuro con la tipografía {k.upper()}, {v["name"]}')
        items.append(f'<article class="opt opt-phone">{opt_head("t", k, v["name"])}'
                     f'<p class="note">{v["step"]}</p>{spec(rows)}<div class="phone-slot">{phone}</div></article>')
    body = (f'<div class="scroll-x" tabindex="0" role="region" aria-label="Tres pantallas de inicio, una por escala">'
            f'<div class="phones-row">{"".join(items)}</div></div>'
            + rec_line('Rombo vive del display ancho. «Cartel» lleva al teléfono el mismo nombre grande del banner Corte, '
                       'y aun así «HexaBlock» cabe en una línea con los dos espaciados.'))
    return section('tipografia', 'Tipografía', 'Tres escalas para display, título, cuerpo y etiqueta, cada una sobre la '
                   'pantalla de inicio en oscuro. Archivo carga 400, 500 y 600; cada escala dice qué peso va en cada rol.',
                   body, 'typography (tamaños, interlineado y pesos de Archivo)')


def strip_radius(th, k):
    o = opts_with(r=k)
    inner = (f'<div class="strip-r"><span class="btn btn-p">{icon("play", 20)}<span>Jugar</span></span>'
             f'{entry(th, "Hexa Sort", "Ordena fichas por color")}'
             f'<div class="frame frame-s">{board_svg(th)}</div></div>')
    return panel(th, o, inner)


def sec_radius():
    items = []
    for k, v in RADIUS.items():
        rows = [('Botón', f'{v["btn"]} px'), ('Tarjeta', f'{v["card"]} px'), ('Marco del tablero', f'{v["board"]} px'),
                ('Campo', f'{v["inp"]} px')]
        items.append(f'<article class="opt">{opt_head("r", k, v["name"])}{spec(rows)}'
                     f'{strip_radius("dark", k)}{strip_radius("light", k)}</article>')
    body = (f'<div class="opts three">{"".join(items)}</div>'
            + rec_line('la casilla es un hexágono de aristas vivas y el banner corta el campo a 60 grados; '
                       'una esquina casi recta habla el mismo idioma.'))
    return section('radio', 'Radio de las esquinas', 'Tres radios sobre el botón, la tarjeta de un juego y el marco del '
                   'tablero. El hexágono de la casilla no cambia.', body, 'rounded.sm, rounded.md, rounded.lg')


def strip_space(th, k):
    inner = '<div class="list">' + ''.join(entry(th, g, d) for g, d in GAMES[:3]) + '</div>'
    return panel(th, opts_with(s=k), inner, 'pnl-space')


def sec_space():
    items = []
    for k, v in SPACE.items():
        rows = [('Escala', f'{v["scale"]} px'), ('Margen de pantalla', f'{v["gut"]} px'),
                ('Relleno de tarjeta', f'{v["pad"]} px'), ('Entre entradas', f'{v["gap"]} px'),
                ('Entre bloques', f'{v["blk"]} px')]
        items.append(f'<article class="opt">{opt_head("s", k, v["name"])}{spec(rows)}'
                     f'<div class="pair">{strip_space("dark", k)}{strip_space("light", k)}</div></article>')
    body = (f'<div class="opts two">{"".join(items)}</div>'
            '<p class="why"><b>Sin recomendada:</b> las dos caben en la pantalla de inicio con las cuatro entradas y Ajustes. '
            'Base 4 deja más alto libre para el tablero; base 8 se lee más tranquila.</p>'
            + (('<p class="note wide-note">Ojo: con ' + ' y con '.join(
                f'tipografía {tk.upper()} y espaciado {sk.upper()}' for tk, sk in WRAPS)
                + ', «Hexa Merge» y «Hexa Lines» pasan a dos líneas en un teléfono de 390 px. '
                'Pruébalo arriba en las pantallas.</p>') if WRAPS else ''))
    return section('espaciado', 'Espaciado', 'Dos escalas con el relleno de la tarjeta y la separación entre entradas. '
                   'Se ven aquí sobre tres juegos y en las pantallas de arriba con los cuatro.', body,
                   'spacing.sm, spacing.md, spacing.lg, spacing.xl y el relleno de card-dark y card-light')


STATES = [('Normal', ''), ('Presionado', 'is-press'), ('Foco', 'is-focus')]
KINDS = [('Principal', 'btn-p', 'Jugar'), ('Secundario', 'btn-s', 'Ajustes'), ('Fantasma', 'btn-g', 'Reglas')]


def button_grid(th, k):
    head = '<span></span>' + ''.join(f'<span class="gh">{s}</span>' for s, _ in STATES)
    rows = ''
    for kname, cls, label in KINDS:
        rows += f'<span class="gh gk">{kname}</span>'
        for _, st in STATES:
            rows += f'<span class="cell"><span class="btn {cls} {st}">{label}</span></span>'
    return panel(th, opts_with(b=k), f'<div class="bgrid">{head}{rows}</div>')


BUTTON_SPEC = {
    'a': [('Principal', 'campo cian, tinta, Archivo 600 16 px, alto 48'),
          ('Presionado', 'cian un paso hacia la tinta'),
          ('Secundario', 'superficie con texto principal; presionado, un paso de tono'),
          ('Fantasma', 'texto cian, sin fondo; presionado, sobre la superficie')],
    'b': [('Principal', 'campo cian, tinta, Archivo 600 16 px, alto 48 con un canto de 4 px en el cian de texto'),
          ('Presionado', 'el canto desaparece y el botón baja 4 px, como una ficha que entra'),
          ('Secundario', 'superficie con el mismo canto en gris'),
          ('Fantasma', 'texto cian, sin fondo')],
    'c': [('Principal', 'campo cian, tinta, Unbounded 800 15 px, alto 56'),
          ('Presionado', 'cian un paso hacia la tinta'),
          ('Secundario', 'contorno de 2 px en el color del texto'),
          ('Fantasma', 'texto cian subrayado')],
}


def sec_buttons():
    items = []
    for k, v in BUTTONS.items():
        rows = BUTTON_SPEC[k] + [('Foco', 'anillo de 3 px a 3 px del botón, en el cian de texto del tema')]
        items.append(f'<article class="opt opt-wide">{opt_head("b", k, v["name"])}<div class="wide-in">'
                     f'<div class="wide-spec">{spec(rows)}</div>'
                     f'<div class="scroll-x" tabindex="0" role="region" aria-label="Botones {v["name"]} en los dos temas">'
                     f'<div class="pair pair-fixed">{button_grid("dark", k)}{button_grid("light", k)}</div></div></div></article>')
    d, l_ = R['dark'], R['light']
    nums = spec([('Tinta sobre cian', ratio(d['ink_sig'])),
                 (f'Tinta sobre cian presionado ({SIG_PRESSED})', ratio(d['ink_sigp'])),
                 ('Cian sobre fondo oscuro', ratio(d['sigtx_bg'])),
                 (f'Cian de texto {SIG_TEXT_LIGHT} sobre fondo claro', ratio(l_['sigtx_bg'])),
                 ('Anillo de foco sobre fondo, oscuro y claro', f'{ratio(d["ring_bg"])} y {ratio(l_["ring_bg"])}')])
    body = (f'<div class="opts one">{"".join(items)}</div>'
            f'<div class="measures"><h3>Medido</h3>{nums}<p class="note">El cian presionado {SIG_PRESSED} es un valor '
            f'nuevo: el cian con 15 % de tinta. El canto de «Pieza» reutiliza {SIG_TEXT_LIGHT} y los grises que ya existen.</p></div>'
            + rec_line('el canto hace que el botón se hunda como una ficha que entra en su casilla. Es juego sin '
                       'degradados ni sombras, y el color sigue plano.'))
    return section('botones', 'Botones', 'Tres estilos de botón principal sobre el campo cian con letra tinta, cada uno con '
                   'su secundario y su fantasma, en normal, presionado y foco. Todos miden 44 px o más.', body,
                   'Components, Buttons (relleno, texto, estados)')


def field(state, value, k):
    cls = {'default': '', 'focus': 'is-focus', 'error': 'is-error'}[state]
    val = (f'<span class="in-ph">Tu nombre</span>' if not value else f'<span class="in-val">{value}</span>')
    caret = '<span class="caret"></span>' if state == 'focus' else ''
    msg = ('<p class="in-msg">Así te ven en la tabla de puntajes.</p>' if state != 'error' else
           f'<p class="in-msg in-err">{icon("alert", 16)}<span>Escribe al menos 3 letras.</span></p>')
    cap = {'default': 'Vacío', 'focus': 'Con foco', 'error': 'Con error'}[state]
    return (f'<div class="fld"><p class="st-cap">{cap}</p><p class="in-lab">Nombre en la tabla</p>'
            f'<div class="in {cls}">{val}{caret}</div>{msg}</div>')


def strip_inputs(th, k):
    inner = field('default', '', k) + field('focus', 'Oscar', k) + field('error', 'Os', k)
    return panel(th, opts_with(n=k), f'<div class="fields">{inner}</div>')


INPUT_SPEC = {
    'a': [('Caja', 'superficie, alto 48, sin borde'), ('Borde', 'barra inferior de 2 px en el gris secundario'),
          ('Foco', 'la barra pasa a 3 px en el cian de texto'), ('Error', 'barra roja de 3 px, ícono y mensaje')],
    'b': [('Caja', 'fondo de la pantalla, alto 48'), ('Borde', 'contorno de 2 px en el gris secundario'),
          ('Foco', 'contorno de 3 px en el cian de texto'), ('Error', 'contorno rojo, ícono y mensaje')],
}


def sec_inputs():
    items = []
    for k, v in INPUTS.items():
        items.append(f'<article class="opt">{opt_head("n", k, v["name"])}{spec(INPUT_SPEC[k])}'
                     f'{strip_inputs("dark", k)}{strip_inputs("light", k)}</article>')
    d, l_ = R['dark'], R['light']
    nums = spec([('Rojo de error sobre fondo oscuro', f'{T["dark"]["err"]}, {ratio(d["err_bg"])}'),
                 ('Rojo de error sobre fondo claro', f'{T["light"]["err"]}, {ratio(l_["err_bg"])}'),
                 ('Barra o contorno gris sobre fondo, oscuro y claro', f'{ratio(d["mu_bg"])} y {ratio(l_["mu_bg"])}')])
    body = (f'<div class="opts two">{"".join(items)}</div>'
            f'<div class="measures"><h3>Medido</h3>{nums}<p class="note">El borrador no tiene color de error. El oscuro usa la '
            f'ficha Rojo; el claro, {T["light"]["err"]}, sale de la ficha Rojo oscurecida hasta 4,5:1 sobre fondo y superficie. '
            f'El mensaje lleva ícono y texto, así el error no depende solo del color. El texto del mensaje es de ejemplo.</p></div>'
            + rec_line('el borrador ya dice que los campos van en la superficie. «Relleno» sigue esa línea y no '
                       'agrega un contorno.'))
    return section('campos', 'Campos de texto', 'Dos campos para el nombre de la cuenta y de la tabla de puntajes, '
                   'vacío, con foco y con error.', body, 'Components, Inputs (borde, alto, foco, error)')


def strip_icons(th, k):
    big = ''.join(f'<span class="ic">{icon(n, 32)}<span>{ICON_ES[n]}</span></span>' for n in ICON_ES)
    small = ''.join(icon(n, 24) for n in ICON_ES)
    ctx = (f'<div class="ic-ctx"><span class="ibtn">{icon("back", 24)}</span>'
           f'<span class="btn btn-s">{icon("settings", 24)}<span>Ajustes</span></span></div>')
    return panel(th, opts_with(i=k), f'<div class="ic-row">{big}</div><div class="ic-small">{small}</div>{ctx}')


ICON_SPEC = {
    'a': [('Trazo', '2 px'), ('Puntas y esquinas', 'rectas'), ('Relleno', 'ninguno')],
    'b': [('Trazo', '1,75 px'), ('Puntas y esquinas', 'redondas'), ('Relleno', 'ninguno'),
          ('Ojo', 'es el aspecto de las librerías de íconos comunes')],
    'c': [('Trazo', '2,5 px'), ('Puntas y esquinas', 'rectas'), ('Relleno', 'las formas cerradas van llenas')],
}


def sec_icons():
    items = []
    for k, v in ICONS.items():
        items.append(f'<article class="opt">{opt_head("i", k, v["name"])}{spec(ICON_SPEC[k])}'
                     f'{strip_icons("dark", k)}{strip_icons("light", k)}</article>')
    body = (f'<div class="opts three">{"".join(items)}</div>'
            '<p class="note wide-note">Los cuatro íconos están dibujados a mano sobre una grilla de 24. Ajustes es una tuerca '
            'hexagonal con la punta arriba, como el tablero de revisión; la orientación del hexágono sigue pendiente.</p>'
            + rec_line('las formas llenas pesan lo mismo que las fichas y la tuerca repite la casilla. Se distingue '
                       'del trazo fino que trae cualquier librería.'))
    return section('iconos', 'Íconos', 'Tres estilos para los mismos cuatro íconos: jugar, ajustes, récord y volver. '
                   'Cada uno va grande, a 24 px y dentro de un botón.', body, 'Iconography (estilo, tamaño, trazo, color)')


def strip_depth(th, k):
    inner = (f'{entry(th, "Hexa Merge", "Une fichas iguales")}'
             f'<div class="card score"><div><p class="lab">Puntaje</p><p class="num">1.280</p></div></div>')
    return panel(th, opts_with(d=k), f'<div class="list">{inner}</div>')


def sec_depth():
    d, l_ = R['dark'], R['light']
    specs = {
        'a': [('Capas', 'solo el salto de tono'),
              ('Superficie sobre fondo', f'{ratio(d["sf_bg"])} en oscuro, {ratio(l_["sf_bg"])} en claro')],
        'b': [('Capas', 'salto de tono y una sombra corta'),
              ('Oscuro', T['dark']['shadow'].replace(', ', ' y ')),
              ('Claro', T['light']['shadow'].replace(', ', ' y '))],
    }
    items = []
    for k, v in DEPTH.items():
        items.append(f'<article class="opt">{opt_head("d", k, v["name"])}{spec(specs[k])}'
                     f'<div class="pair">{strip_depth("dark", k)}{strip_depth("light", k)}</div></article>')
    body = (f'<div class="opts two">{"".join(items)}</div>'
            + rec_line('el borrador ya lo dice: «No hace falta borde de 1 px: el salto de tono basta». En oscuro la '
                       'sombra casi no se ve y en claro ensucia el blanco.'))
    return section('profundidad', 'Profundidad', 'El borrador separa las capas por un salto de tono. Aquí está eso contra '
                   'una sombra sutil, para confirmarlo o descartarlo.', body, 'Elevation &amp; Depth (sombras)')


ENDS_SPEC = {
    'a': [('Forma', 'esquina inferior derecha cortada a 60°, 42 px de alto'), ('Ancho', 'todo el teléfono'),
          ('Banner', 'el corte de hoy, de x = 1000 arriba a x = 815 abajo')],
    'b': [('Forma', 'mitad derecha de un hexágono con lado plano arriba'), ('Remate', 'una punta a media altura, flancos a 60°'),
          ('Hondo', 'alto del campo ÷ (2 × √3), unos 0,29 del alto'), ('Fin', f'{END_INSET} px antes del borde derecho'),
          ('Banner', f'punta en x = {BANNER_END["b"]}')],
    'c': [('Forma', 'mitad derecha de un hexágono con punta arriba'),
          ('Remate', 'dos tramos a 30° unidos por un tramo vertical de medio alto'),
          ('Hondo', '√3 ÷ 4 del alto del campo, unos 0,43 del alto'), ('Fin', f'{END_INSET} px antes del borde derecho'),
          ('Banner', f'tramo vertical en x = {BANNER_END["c"]}')],
}


def header_crop(th, ek):
    o = opts_with(e=ek)
    inner = (f'<div class="ph-in"><div class="hd"><p class="hd-name">HexaBlock</p><p class="hd-suite">Suite</p></div>'
             f'<p class="ph-lead">Cuatro juegos sobre un tablero hexagonal.</p></div>')
    label = f'Encabezado de inicio en tema {THEME_ES[th]} con el remate {ek.upper()}'
    return (f'<div class="scroll-x crop-wrap" tabindex="0" role="region" aria-label="{escape(label)}">'
            f'{kit_root(th, o, "ph ph-crop", inner, label)}</div>')


def banner_fig(th, ek):
    svg = banner_svg(th, ek)
    return (f'<figure class="bfig"><div class="ghb" style="background:{GITHUB[th]}">{svg}</div>'
            f'<div class="b360"><div class="ghb" style="background:{GITHUB[th]}">{svg}</div></div>'
            f'<figcaption>Tema {THEME_ES[th]}, sobre el fondo de GitHub. Junto a él, el mismo banner a 360 px.</figcaption></figure>')


def sec_remate():
    ta, sa = DEFAULT['t'], DEFAULT['s']
    items = []
    for k, v in ENDS.items():
        g = GEOM[(ta, sa, k)]
        size = (f'Con tipografía {ta.upper()} y espaciado {sa.upper()} el nombre va a {g["fs"]} px'
                + (f' y el campo mide {g["h"]} px de alto, con {fmt(g["d"], 0)} px de remate.' if g['h'] else '.'))
        items.append(f'<article class="opt">{opt_head("e", k, v["name"])}{spec(ENDS_SPEC[k])}'
                     f'<p class="note">{size}</p>{header_crop("dark", k)}{header_crop("light", k)}</article>')
    head = ''.join(f'<th scope="col">{k.upper()} {escape(v["name"])}</th>' for k, v in ENDS.items())
    rows = ''
    for tk, tv in TYPE.items():
        for sk, sv in SPACE.items():
            cells = ''
            for ek in ENDS:
                g = GEOM[(tk, sk, ek)]
                cut = '' if g['fs'] == tv['d'][0] else ' <span class="down">(baja)</span>'
                cells += f'<td>{g["fs"]} px{cut}</td>'
            rows += f'<tr><th scope="row">Tipografía {tk.upper()}, espaciado {sk.upper()}</th>{cells}</tr>'
    table = (f'<div class="measures"><h3>El nombre en el encabezado a 390 px</h3>'
             f'<p class="note">Con B y C el nombre nunca entra en el remate: si no cabe, baja de tamaño. '
             f'El display de cada escala no cambia en el resto de la app.</p>'
             f'<div class="scroll-x" tabindex="0" role="region" aria-label="Tamaño del nombre por escala y remate">'
             f'<table class="t-end"><thead><tr><th scope="col">Escala</th>{head}</tr></thead><tbody>{rows}</tbody></table></div></div>')
    banners = ''.join(
        f'<article class="opt opt-banner">{opt_head("e", k, v["name"])}{banner_fig("dark", k)}{banner_fig("light", k)}</article>'
        for k, v in ENDS.items())
    defs = (f'<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>'
            f'{corte_board_group("dark")}{corte_board_group("light")}</defs></svg>')
    body = (f'{defs}<p class="why orient">La orientación del medio hexágono es una decisión de marca, solo para este remate. '
            f'La orientación de la casilla del tablero sigue pendiente: la decide el motor. B coincide con el avatar publicado '
            f'(lado plano arriba) y C con el tablero de revisión (punta arriba).</p>'
            f'<div class="opts three">{"".join(items)}</div>{table}'
            f'<h3 class="sub-h">El banner Corte con cada remate</h3>'
            f'<div class="opts one">{banners}</div>'
            f'<p class="why"><b>Sin recomendada:</b> B y C se leen como forma a 390 px. B deja el nombre más grande; '
            f'C se reconoce más como hexágono. A queda solo para comparar.</p>')
    return section('remate', 'Remate del campo', 'En el teléfono, el corte de 60° del campo cian queda como un triangulito '
                   'en la esquina y parece un error de dibujo. B y C terminan el campo en medio hexágono, medido desde el alto del '
                   f'campo, {END_INSET} px antes del borde, así el fondo oscuro se ve a la derecha.', body,
                   'Shapes («Banner cut») y la forma del campo de señal')


# ---------- Live preview ----------


def controls():
    groups = []
    for key, title, opts in SETS:
        btns = ''
        for letter, v in opts.items():
            checked = ' checked' if key in PRESELECT and DEFAULT[key] == letter else ''
            btns += (f'<label class="seg"><input type="radio" name="set-{key}" value="{letter}" data-ctl="{key}"{checked}>'
                     f'<span><b>{letter.upper()}</b> {escape(v["name"])}</span></label>')
        rec = f'Recomendada: {REC[key].upper()}' if REC[key] else 'Sin recomendada'
        groups.append(f'<fieldset class="ctl"><legend>{title} <span class="ctl-rec">{rec}</span></legend>'
                      f'<div class="segs">{btns}</div></fieldset>')
    return ''.join(groups)


def sec_preview():
    o = dict(DEFAULT)
    phones = (f'<div class="pv-row"><h3>Tema oscuro</h3><div class="pv-phones">'
              f'{screen_home("dark", o, "Inicio en tema oscuro")}{screen_game("dark", o, "Partida de Hexa Lines en tema oscuro")}</div></div>'
              f'<div class="pv-row"><h3>Tema claro</h3><div class="pv-phones">'
              f'{screen_home("light", o, "Inicio en tema claro")}{screen_game("light", o, "Partida de Hexa Lines en tema claro")}</div></div>')
    return (f'<section id="pantallas" class="sec" aria-labelledby="pantallas-h">'
            f'<div class="sec-top"><h2 id="pantallas-h">Las pantallas con tus letras</h2>'
            f'<p>Elige una letra por grupo y las cuatro pantallas cambian. Empiezan en las recomendadas, y en espaciado A, '
            f'que no tiene recomendada. Remate empieza sin letra: las pantallas muestran el corte de hoy hasta que elijas. '
            f'Tu respuesta copia cada letra; la inicial lleva «(inicial)» hasta que la toques.</p></div>'
            f'<div class="pv"><form class="pv-ctl" aria-label="Opciones de la vista previa" onsubmit="return false">{controls()}</form>'
            f'<div class="pv-screens live scroll-x" tabindex="0" role="region" aria-label="Pantallas de inicio y de partida">{phones}</div></div>'
            f'<p class="note">El tablero se dibuja como el de revisión, con la punta de la casilla arriba. La orientación está '
            f'pendiente, y también cuántas fichas tiene Hexa Sort y cuántas veces aparece el cian por pantalla. Los textos de las '
            f'pantallas y los puntajes son de ejemplo.</p></section>')


# ---------- Candidates ----------

BRANDS = [
    ('Mini Metro', 'Un rompecabezas de líneas y colores planos que se ve como un plano de diseño y se juega como un juego.'),
    ('Monument Valley', 'Geometría limpia y paleta medida: se nota el diseño y nadie lo confunde con una app de oficina.'),
    ('Threes!', 'Fichas numeradas con carácter y tipografía cuidada; es el pariente directo de Hexa Merge.'),
    ('Two Dots', 'Puntos de color sobre fondo liso: juego de colores fuertes sin caer en lo infantil.'),
    ('Teenage Engineering', 'Aparatos de trabajo serio con colores vivos y formas de juguete.'),
    ('Figma', 'Herramienta profesional con color y formas juguetonas en su marca, para adultos.'),
]
TONES = [
    ('a', [('Preciso', 'Precise'), ('Vivo', 'Lively'), ('Claro', 'Clear')],
     'Lo profesional en «preciso» y «claro»; «vivo» contesta a «sobrio y apagado».'),
    ('b', [('Cuidado', 'Crafted'), ('Lúdico', 'Playful'), ('Directo', 'Direct')],
     '«Un juego al fin y al cabo» en «lúdico»; «cuidado» y «directo» lo alejan de lo infantil.'),
    ('c', [('Seguro', 'Confident'), ('Ágil', 'Quick'), ('Cercano', 'Approachable')],
     'Habla como alguien que sabe jugar: firme sin ser corporativo, cercano sin hablarle a un niño.'),
]
BANNED = [
    ('solución', 'solution', 'jerga corporativa'), ('potenciar', 'empower', 'jerga corporativa'),
    ('optimizar', 'optimize', 'jerga corporativa'), ('innovador', 'innovative', 'jerga corporativa'),
    ('plataforma', 'platform', 'jerga corporativa'), ('gestionar', 'manage', 'jerga corporativa'),
    ('¡súper!', 'super!', 'tono infantil'), ('¡yupi!', 'yay!', 'tono infantil'),
    ('mágico', 'magical', 'tono infantil'), ('amiguito', 'buddy', 'tono infantil'),
]


def sec_candidates():
    brands = ''.join(
        f'<li><label class="pick"><input type="radio" name="marca" value="{escape(n)}" data-pick="marca">'
        f'<span><b>{escape(n)}</b> {escape(w)}</span></label></li>' for n, w in BRANDS)
    brands += ('<li><label class="pick"><input type="radio" name="marca" value="otra" data-pick="marca">'
               '<span><b>Otra</b> La nombro yo en la respuesta.</span></label></li>')
    tones = ''
    for k, words, why in TONES:
        ws = ''.join(f'<li><b>{es}</b> <span lang="en">{en}</span></li>' for es, en in words)
        label = ', '.join(es for es, _ in words)
        tones += (f'<label class="pick tone"><input type="radio" name="tono" value="{k.upper()} ({escape(label)})" data-pick="tono">'
                  f'<span><span class="letter">{k.upper()}</span><ul class="words">{ws}</ul><span class="tone-why">{escape(why)}</span></span></label>')
    banned = ''.join(
        f'<li><label class="pick chk"><input type="checkbox" name="prohibida" value="{escape(es)}" data-pick="prohibida">'
        f'<span><b>{escape(es)}</b> <span lang="en">{escape(en)}</span> <span class="kind">{kind}</span></span></label></li>'
        for es, en, kind in BANNED)
    return (f'<section id="tuyas" class="sec" aria-labelledby="tuyas-h">'
            f'<div class="sec-top"><h2 id="tuyas-h">Las tres que son tuyas</h2>'
            f'<p>Aquí no hay recomendada: solo candidatas sacadas de tus palabras, «profesional, pero un juego al fin y al cabo», '
            f'ni «para niños de 2 años» ni «una app corporativa gris». Marca aquí y pasa a tu respuesta.</p></div>'
            f'<div class="cand">'
            f'<fieldset class="cand-b"><legend><h3>Marca de referencia</h3></legend><p class="note">Una marca o juego real al '
            f'que el look se debería parecer. Solo nombres y razones; nada de sus logos.</p><ul class="picks">{brands}</ul></fieldset>'
            f'<fieldset class="cand-b"><legend><h3>Tono</h3></legend><p class="note">Tres palabras, en español y en inglés, '
            f'porque la app sale en los dos.</p><div class="tones">{tones}</div></fieldset>'
            f'<fieldset class="cand-b"><legend><h3>Palabras prohibidas</h3></legend><p class="note">Elige cinco. '
            f'<span id="ban-count" aria-live="polite">Llevas 0 de 5.</span></p><ul class="picks ban">{banned}</ul></fieldset>'
            f'</div></section>')


TEMPLATE_KEYS = [('t', 'Tipografía'), ('r', 'Radio'), ('s', 'Espaciado'), ('b', 'Botones'), ('n', 'Campos'),
                 ('i', 'Íconos'), ('d', 'Profundidad'), ('e', 'Remate'), ('marca', 'Marca de referencia'), ('tono', 'Tono'),
                 ('prohibida', 'Palabras prohibidas')]
TEMPLATE = ' · '.join(f'{label}: _' for _, label in TEMPLATE_KEYS)


def sec_answer():
    return (f'<section id="respuesta" class="sec answer" aria-labelledby="respuesta-h">'
            f'<h2 id="respuesta-h">Tu respuesta</h2>'
            f'<p>Llena cada hueco con una letra o una palabra. Lo que marcas arriba se escribe solo; una letra con «(inicial)» '
            f'es la que venía marcada y aún no tocas. También puedes copiar la plantilla y escribirla a mano.</p>'
            f'<p class="tpl" id="tpl">{escape(TEMPLATE)}</p>'
            f'<div class="copy-row"><button type="button" class="copy" id="copy">Copiar respuesta</button>'
            f'<span id="copy-st" class="copy-st" aria-live="polite"></span></div></section>')


# ---------- CSS ----------


def kit_css():
    out = []
    for th in THEMES:
        t = T[th]
        out.append(f'.th-{th}{{--k-bg:{t["bg"]};--k-sf:{t["sf"]};--k-bd:{t["bd"]};--k-cl:{t["cl"]};--k-tx:{t["tx"]};'
                   f'--k-mu:{t["mu"]};--k-sig:{SIG};--k-sigtx:{t["sigtx"]};--k-ink:{INK};--k-sigp:{t["sigp"]};'
                   f'--k-ring:{t["ring"]};--k-sfp:{t["sfp"]};--k-edge:{t["edge"]};--k-sfedge:{t["sfedge"]};'
                   f'--k-err:{t["err"]};--k-shb:{t["shadow"]}}}')
    for k, v in TYPE.items():
        d, t_, b, l_ = v['d'], v['t'], v['b'], v['l']
        fam = 'var(--fh)' if t_[2] == 'Unbounded' else 'var(--fb)'
        out.append(f'[data-t="{k}"]{{--fs-d:{d[0]}px;--lh-d:{d[1]};--fs-t:{t_[0]}px;--lh-t:{t_[1]};--ff-t:{fam};--fw-t:{t_[3]};'
                   f'--fs-b:{b[0]}px;--lh-b:{b[1]};--fw-b:{b[2]};--fs-l:{l_[0]}px;--lh-l:{l_[1]};--fw-l:{l_[2]}}}')
    for k, v in RADIUS.items():
        out.append(f'[data-r="{k}"]{{--r-btn:{v["btn"]}px;--r-card:{v["card"]}px;--r-board:{v["board"]}px;--r-in:{v["inp"]}px}}')
    for k, v in SPACE.items():
        out.append(f'[data-s="{k}"]{{--gut:{v["gut"]}px;--pad:{v["pad"]}px;--gap:{v["gap"]}px;--blk:{v["blk"]}px}}')
    for k, v in ICONS.items():
        out.append(f'[data-i="{k}"]{{--i-sw:{v["sw"]};--i-cap:{v["cap"]};--i-join:{v["join"]};--i-fill:{v["fill"]}}}')
    for (tk, sk, ek), g in GEOM.items():
        extra = f';--hd-h:{g["h"]}px;--hd-d:{g["d"]:.1f}px' if g['h'] else ''
        out.append(f'[data-t="{tk}"][data-s="{sk}"][data-e="{ek}"]{{--hd-fs:{g["fs"]}px{extra}}}')
    out.append(f'[data-e="b"] .hd,[data-e="c"] .hd{{height:var(--hd-h);margin-right:calc({END_INSET}px - var(--gut));'
               f'display:flex;flex-direction:column;justify-content:center}}')
    out.append('[data-e="b"] .hd{clip-path:polygon(0 0,calc(100% - var(--hd-d)) 0,100% 50%,calc(100% - var(--hd-d)) 100%,0 100%)}')
    out.append('[data-e="c"] .hd{clip-path:polygon(0 0,calc(100% - var(--hd-d)) 0,100% 25%,100% 75%,'
               'calc(100% - var(--hd-d)) 100%,0 100%)}')
    return '\n'.join(out)


def chrome_tokens(th):
    t = T[th]
    return (f'--bg:{t["bg"]};--surface:{t["sf"]};--text:{t["tx"]};--muted:{t["mu"]};--sig:{SIG};--on-sig:{INK};'
            f'--focus:{t["ring"]};color-scheme:{th}')


CSS = r"""
:root{/*LIGHT*/;--fh:Unbounded,"Arial Black","Segoe UI",sans-serif;--fb:Archivo,"Helvetica Neue",Arial,sans-serif}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){/*DARK*/}}
:root[data-theme="dark"]{/*DARK*/}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 var(--fb)}
h1,h2,h3,p,ul,dl,dd,figure,fieldset{margin:0}
fieldset{border:0;padding:0;min-width:0}
legend{padding:0}
.wrap{padding-left:max(16px, env(safe-area-inset-left, 0px));padding-right:max(16px, env(safe-area-inset-right, 0px));padding-block:40px 96px}
.inner{max-width:1400px;margin-inline:auto;display:grid;gap:clamp(72px,9vw,128px);min-width:0}
h1,h2{font-family:var(--fh);font-weight:800;letter-spacing:-0.02em;line-height:1.05}
h1{font-size:clamp(32px,5.4vw,64px)}
h2{font-size:clamp(24px,3.2vw,38px)}
h3{font-size:19px;line-height:1.3;font-weight:600}
a{color:var(--text);text-underline-offset:4px}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
.top{display:grid;gap:18px;max-width:74ch}
.top .lead{font-size:clamp(18px,1.6vw,21px)}
.open{color:var(--muted)}
nav ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:0 20px}
nav a{display:inline-flex;align-items:center;min-height:44px;font-weight:600}
.sec{display:grid;gap:28px;min-width:0;scroll-margin-top:16px}
.sec-top{display:grid;gap:10px;max-width:74ch}
.todo,.note{font-size:14px;color:var(--muted)}
.wide-note{max-width:74ch}
.why{max-width:74ch}
.why b{font-weight:600}
.scroll-x{overflow-x:auto;max-width:100%;min-width:0}
.opts{display:grid;gap:20px;min-width:0}
@media (min-width:760px){.opts.two{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:760px) and (max-width:1099px){.opts.three{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:1100px){.opts.three{grid-template-columns:repeat(3,minmax(0,1fr))}}
.opt{background:var(--surface);border-radius:4px;padding:clamp(16px,2vw,24px);display:grid;gap:16px;align-content:start;min-width:0}
.opt-h{display:flex;align-items:center;flex-wrap:wrap;gap:10px 14px}
.opt-h h3{font-size:20px}
.letter{font-family:var(--fh);font-weight:800;font-size:28px;line-height:1;min-width:1.1em}
.rec{background:var(--sig);color:var(--on-sig);font-weight:600;font-size:14px;padding:4px 10px;border-radius:2px}
.spec{display:grid;gap:6px;font-size:15px}
.spec div{display:grid;grid-template-columns:minmax(110px,40%) 1fr;gap:10px}
.spec dt{color:var(--muted)}
.spec dd{font-variant-numeric:tabular-nums;min-width:0;overflow-wrap:anywhere}
.pair{display:grid;gap:12px;min-width:0}
.pair-fixed{grid-template-columns:repeat(2,max-content)}
@media (max-width:1099px){.pair-fixed{grid-template-columns:max-content}}
.phones-row{display:flex;gap:16px;width:max-content;padding-bottom:8px}
.opt-phone{width:442px;flex:none;padding:16px}
.phone-slot{margin-top:4px}
.opt-wide .wide-in{display:grid;gap:18px;min-width:0}
@media (min-width:1100px){.opt-wide .wide-in{grid-template-columns:280px minmax(0,1fr);align-items:start}}
.measures{display:grid;gap:10px;max-width:74ch}
.measures h3{font-size:17px}

/* live preview */
.pv{display:grid;gap:24px;min-width:0}
@media (min-width:1180px){.pv{grid-template-columns:320px minmax(0,1fr);align-items:start}.pv-ctl{position:sticky;top:16px}}
.pv-ctl{display:grid;gap:14px;background:var(--surface);border-radius:4px;padding:18px}
.ctl legend{font-weight:600;font-size:15px;margin-bottom:6px;display:flex;flex-wrap:wrap;gap:4px 10px;width:100%}
.ctl-rec{font-weight:400;color:var(--muted)}
.segs{display:flex;flex-wrap:wrap;gap:6px}
.seg{position:relative;display:inline-flex}
.seg input{position:absolute;opacity:0;inset:0;width:100%;height:100%;margin:0;cursor:pointer}
.seg span{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 12px;border-radius:2px;background:var(--bg);font-size:14px;cursor:pointer}
.seg b{font-family:var(--fh);font-weight:800}
.seg input:checked+span{background:var(--sig);color:var(--on-sig)}
.seg input:focus-visible+span{outline:3px solid var(--focus);outline-offset:2px}
.pv-screens{display:grid;gap:28px;padding-bottom:8px}
.pv-row{display:grid;gap:10px;width:max-content}
.pv-row h3{font-size:16px}
.pv-phones{display:flex;gap:24px}

/* candidates */
.cand{display:grid;gap:20px;min-width:0}
@media (min-width:1100px){.cand{grid-template-columns:1.2fr 1fr 1fr;align-items:start}}
.cand-b{background:var(--surface);border-radius:4px;padding:clamp(16px,2vw,24px);display:grid;gap:12px;min-width:0}
.cand-b legend{float:left;width:100%;margin-bottom:4px}
.cand-b legend+*{clear:both}
.picks{list-style:none;padding:0;display:grid;gap:6px}
.pick{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:2px;background:var(--bg);cursor:pointer;min-height:44px}
.pick input{width:20px;height:20px;margin:2px 0 0;flex:none;accent-color:var(--focus)}
.pick b{display:block;font-weight:600}
.pick:has(input:checked){box-shadow:inset 0 0 0 2px var(--focus)}
.tones{display:grid;gap:8px}
.tone>span{display:grid;gap:6px}
.words{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:4px 16px}
.words b{display:inline;font-family:var(--fh);font-weight:800;font-size:17px}
.words span{color:var(--muted)}
.tone-why{font-size:14px;color:var(--muted)}
.tone .letter{font-size:20px}
.ban{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.ban b{display:inline}
.kind{display:block;font-size:13px;color:var(--muted)}

/* answer */
.answer{background:var(--sig);color:var(--on-sig);border-radius:4px;padding:clamp(20px,3vw,40px);gap:16px}
.answer p{max-width:74ch}
.tpl{font-size:clamp(17px,1.6vw,20px);font-weight:600;line-height:1.6;background:var(--on-sig);color:#f2f3f6;padding:16px 18px;border-radius:2px;max-width:none!important;overflow-wrap:anywhere}
.copy-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.copy{font:600 16px/1 var(--fb);min-height:48px;padding:0 20px;border:0;border-radius:2px;background:var(--on-sig);color:#f2f3f6;cursor:pointer}
.copy:active{transform:translateY(2px)}
.copy:focus-visible{outline:3px solid var(--on-sig);outline-offset:3px}
.copy-st{font-weight:600}

/* ---------- kit: the app components ---------- */
/*KIT*/
.kit{font-family:var(--fb);color:var(--k-tx);background:var(--k-bg);font-size:var(--fs-b);line-height:var(--lh-b);font-weight:var(--fw-b)}
.kit p{margin:0}
.dev{width:410px;padding:10px;background:#3b3e48;border-radius:46px;flex:none}
.ph{width:390px;height:844px;border-radius:36px;overflow:hidden;position:relative}
.ph-in{display:flex;flex-direction:column;gap:var(--blk);padding:56px var(--gut) var(--gut)}
.hd{background:var(--k-sig);color:var(--k-ink);margin:0 calc(-1 * var(--gut));padding:calc(var(--blk) * .75) var(--gut);
  clip-path:polygon(0 0,100% 0,100% calc(100% - 42px),calc(100% - 24.2px) 100%,0 100%)}
.hd-name{font-family:var(--fh);font-weight:800;font-size:var(--hd-fs);line-height:var(--lh-d);letter-spacing:-0.02em;white-space:nowrap}
.hd-suite{font-family:var(--fh);font-weight:800;font-size:calc(var(--hd-fs) * .42);line-height:1.2;margin-top:2px}
.ph-lead{color:var(--k-mu);margin-top:calc(var(--blk) * -.4)}
.list{display:flex;flex-direction:column;gap:var(--gap)}
.card{background:var(--k-sf);border-radius:var(--r-card);padding:var(--pad)}
[data-d="b"] .card{box-shadow:var(--k-shb)}
.entry{display:flex;align-items:center;gap:calc(var(--pad) * .75)}
.badge{width:44px;height:44px;flex:none;background:var(--k-bd);border-radius:var(--r-btn);display:grid;place-items:center}
.badge-svg{width:40px;height:40px}
.e-txt{display:grid;gap:2px;flex:1;min-width:0}
.e-name{font-family:var(--ff-t);font-weight:var(--fw-t);font-size:var(--fs-t);line-height:var(--lh-t);letter-spacing:-0.01em}
.e-desc{font-size:var(--fs-l);line-height:var(--lh-l);font-weight:var(--fw-l);color:var(--k-mu)}
.e-go{color:var(--k-sigtx);flex:none}
.ico{display:block;fill:none;stroke:currentColor;stroke-width:var(--i-sw);stroke-linecap:var(--i-cap);stroke-linejoin:var(--i-join);flex:none}
.ico .f{fill:var(--i-fill)}
[data-i="c"] .ico .cut{stroke:var(--k-bg)}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px}
.g-title{font-family:var(--ff-t);font-weight:var(--fw-t);font-size:var(--fs-t);line-height:var(--lh-t)}
.ibtn{width:48px;height:48px;display:grid;place-items:center;background:var(--k-sf);border-radius:var(--r-btn);flex:none}
.score{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}
.lab{font-size:var(--fs-l);line-height:var(--lh-l);font-weight:var(--fw-l);color:var(--k-mu)}
.num{font-family:var(--fh);font-weight:800;font-size:calc(var(--fs-d) * .8);line-height:1;margin-top:4px;font-variant-numeric:tabular-nums}
.best{text-align:right}
.num-s{display:flex;align-items:center;gap:6px;justify-content:flex-end;font-family:var(--fh);font-weight:800;font-size:calc(var(--fs-t) * .8);line-height:1.1;margin-top:4px}
.num-s .ico{color:var(--k-sigtx)}
.frame{background:var(--k-bd);border-radius:var(--r-board);padding:10px 6px}
.board{display:block;width:100%;height:auto}
.frame-s{max-width:260px}
.acts{display:flex;flex-direction:column;gap:var(--gap)}
/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 18px;border-radius:var(--r-btn);
  font:600 16px/1 var(--fb);white-space:nowrap;box-sizing:border-box;position:relative;transition:transform .12s ease}
.btn-p{background:var(--k-sig);color:var(--k-ink)}
.btn-s{background:var(--k-sf);color:var(--k-tx)}
.btn-g{background:transparent;color:var(--k-sigtx)}
.btn-p.is-press{background:var(--k-sigp)}
.btn-s.is-press{background:var(--k-sfp)}
.btn-g.is-press{background:var(--k-sf)}
.btn.is-focus{outline:3px solid var(--k-ring);outline-offset:3px}
[data-b="b"] .btn-p{border-bottom:4px solid var(--k-edge)}
[data-b="b"] .btn-s{border-bottom:4px solid var(--k-sfedge)}
[data-b="b"] .btn-p.is-press{background:var(--k-sig);border-bottom-width:0;transform:translateY(4px);min-height:44px}
[data-b="b"] .btn-s.is-press{background:var(--k-sf);border-bottom-width:0;transform:translateY(4px);min-height:44px}
[data-b="c"] .btn{font:800 15px/1 var(--fh);min-height:56px;letter-spacing:-0.01em}
[data-b="c"] .btn-s{background:transparent;box-shadow:inset 0 0 0 2px var(--k-tx)}
[data-b="c"] .btn-s.is-press{background:var(--k-sfp)}
[data-b="c"] .btn-g{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:5px}
.set-row{justify-content:flex-start;align-self:stretch}
.acts .btn{width:100%}
/* panels */
.pnl{border-radius:4px;padding:16px;display:grid;gap:14px;min-width:0}
.pnl-cap{font-size:13px;line-height:1.3;color:var(--k-mu);font-family:var(--fb);font-weight:500}
.strip-r{display:grid;gap:14px;justify-items:start}
.strip-r .entry{width:100%}
.pnl .list{max-width:calc(390px - 2 * var(--gut))}
.bgrid{display:grid;grid-template-columns:auto repeat(3,auto);gap:14px 14px;align-items:center}
.bgrid .gh{font-size:13px;line-height:1.3;color:var(--k-mu);font-weight:500}
.bgrid .cell{display:flex;align-items:center;min-height:60px}
.fields{display:grid;gap:18px}
.fld{display:grid;gap:6px}
.st-cap{font-size:13px;line-height:1.3;color:var(--k-mu)}
.in-lab{font-size:14px;line-height:1.3;font-weight:600}
.in{display:flex;align-items:center;min-height:48px;padding:0 14px;font-size:16px;border-radius:var(--r-in) var(--r-in) 0 0;
  background:var(--k-sf);box-shadow:inset 0 -2px 0 var(--k-mu)}
.in.is-focus{box-shadow:inset 0 -3px 0 var(--k-ring)}
.in.is-error{box-shadow:inset 0 -3px 0 var(--k-err)}
[data-n="b"] .in{background:transparent;border-radius:var(--r-in);box-shadow:inset 0 0 0 2px var(--k-mu)}
[data-n="b"] .in.is-focus{box-shadow:inset 0 0 0 3px var(--k-ring)}
[data-n="b"] .in.is-error{box-shadow:inset 0 0 0 3px var(--k-err)}
.in-ph{color:var(--k-mu)}
.caret{width:2px;height:22px;background:var(--k-ring);margin-left:1px}
.in-msg{font-size:14px;line-height:1.35;color:var(--k-mu);display:flex;align-items:center;gap:6px}
.in-err{color:var(--k-err);font-weight:500}
.in-err .ico{--i-sw:2;--i-fill:currentColor}
.in-err .ico .cut{stroke:var(--k-bg)}
.ic-row{display:flex;flex-wrap:wrap;gap:16px 22px}
.ic{display:grid;justify-items:center;gap:6px;font-size:13px;line-height:1.3;color:var(--k-mu)}
.ic .ico{color:var(--k-tx)}
.ic-small{display:flex;gap:18px}
.ic-ctx{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.ph-crop{height:auto;border-radius:4px}
.ph-crop .ph-in{padding-top:var(--gut)}
.crop-wrap{border-radius:4px}
.defs{position:absolute;width:0;height:0;overflow:hidden}
.sub-h{font-size:21px;margin-top:12px}
.orient{font-weight:500}
.t-end{border-collapse:collapse;font-size:15px;font-variant-numeric:tabular-nums;width:100%;max-width:760px}
.t-end th,.t-end td{text-align:left;padding:8px 16px 8px 0}
.t-end thead th{color:var(--muted);font-weight:600}
.t-end tbody th{font-weight:500}
.down{color:var(--muted)}
.opt-banner{gap:20px}
.bfig{display:grid;gap:8px;min-width:0}
.ghb{padding:clamp(8px,1.6vw,16px);border-radius:4px}
.ghb svg{display:block;width:100%;height:auto}
.b360{width:min(392px,100%)}
.b360 .ghb{padding:16px}
.bfig figcaption{grid-column:1/-1;font-size:14px;color:var(--muted)}
@media (min-width:1100px){.bfig{grid-template-columns:minmax(0,1fr) 392px;align-items:center}}
/* The crop keeps its true 390 px geometry; on a narrow page it is zoomed to fit, so the end stays in view. */
@media (max-width:460px){.ph-crop{zoom:.8}.t-end{font-size:14px}.t-end th,.t-end td{padding-right:10px}}
@media (max-width:370px){.ph-crop{zoom:.72}}
@media (prefers-reduced-motion: reduce){.btn,.copy{transition:none}.copy:active{transform:none}}
@media (prefers-reduced-motion: no-preference){html{scroll-behavior:smooth}}
@media (max-width:520px){.spec div{grid-template-columns:1fr;gap:0}.opt .pnl{margin-inline:-16px;padding:12px;border-radius:0}}
"""

FONTS = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&amp;family=Unbounded:wght@800&amp;display=swap'

JS = r"""
(function(){
  var KEYS = %KEYS%;
  var state = {};
  function render(){
    var parts = KEYS.map(function(k){
      var v = state[k[0]];
      if (k[0] === 'prohibida') v = (v && v.length) ? v.join(', ') : '';
      return k[1] + ': ' + (v ? v : '_');
    });
    document.getElementById('tpl').textContent = parts.join(' · ');
  }
  document.querySelectorAll('[data-ctl]:checked').forEach(function(inp){
    state[inp.dataset.ctl] = inp.value.toUpperCase() + ' (inicial)';
  });
  render();
  document.querySelectorAll('[data-ctl]').forEach(function(inp){
    function pick(){
      var g = inp.dataset.ctl;
      state[g] = inp.value.toUpperCase();
      document.querySelectorAll('.live .kit').forEach(function(k){ k.setAttribute('data-' + g, inp.value); });
      render();
    }
    inp.addEventListener('change', pick);
    inp.addEventListener('click', pick);
  });
  document.querySelectorAll('[data-pick]').forEach(function(inp){
    inp.addEventListener('change', function(){
      var g = inp.dataset.pick;
      if (g === 'prohibida') {
        var on = Array.prototype.filter.call(document.querySelectorAll('[data-pick="prohibida"]'), function(c){ return c.checked; });
        state.prohibida = on.map(function(c){ return c.value; });
        var n = on.length;
        document.getElementById('ban-count').textContent = 'Llevas ' + n + ' de 5.' + (n > 5 ? ' Sobran ' + (n - 5) + '.' : '');
      } else if (g === 'marca' && inp.value === 'otra') {
        state.marca = 'otra, _';
      } else {
        state[g] = inp.value;
      }
      render();
    });
  });
  var btn = document.getElementById('copy'), st = document.getElementById('copy-st');
  btn.addEventListener('click', function(){
    var text = document.getElementById('tpl').textContent;
    function fallback(){
      var r = document.createRange(); r.selectNodeContents(document.getElementById('tpl'));
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      st.textContent = 'No pude copiar. El texto quedó seleccionado: cópialo con el teclado.';
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function(){ st.textContent = 'Copiada.'; }, fallback);
      } else { fallback(); }
    } catch (e) { fallback(); }
  });
})();
"""


def css():
    return (CSS.replace('/*LIGHT*/', chrome_tokens('light')).replace('/*DARK*/', chrome_tokens('dark'))
            .replace('/*KIT*/', kit_css()))


def page():
    for th in THEMES:
        t = T[th]
        text_gate(f'página principal sobre fondo {THEME_ES[th]}', t['tx'], t['bg'], 16)
        text_gate(f'página secundario sobre superficie {THEME_ES[th]}', t['mu'], t['sf'], 14)
        text_gate(f'página secundario sobre fondo {THEME_ES[th]}', t['mu'], t['bg'], 14)
    text_gate('página tinta sobre cian (Recomendada, respuesta)', INK, SIG, 14, True)
    text_gate('página plantilla clara sobre tinta', '#f2f3f6', INK, 17, True)
    nav = [('pantallas', 'Pantallas'), ('tipografia', 'Tipografía'), ('radio', 'Radio'), ('espaciado', 'Espaciado'),
           ('botones', 'Botones'), ('campos', 'Campos'), ('iconos', 'Íconos'), ('profundidad', 'Profundidad'), ('remate', 'Remate'),
           ('tuyas', 'Las tres tuyas'), ('respuesta', 'Tu respuesta')]
    nav_html = ''.join(f'<li><a href="#{i}">{t}</a></li>' for i, t in nav)
    body = (sec_preview() + sec_type() + sec_radius() + sec_space() + sec_buttons() + sec_inputs() + sec_icons()
            + sec_depth() + sec_remate() + sec_candidates() + sec_answer())
    keys = '[' + ','.join(f'["{k}","{label}"]' for k, label in TEMPLATE_KEYS) + ']'
    return f"""<title>Componentes HexaBlock</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>{css()}</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<div class="wrap"><div class="inner">
<header class="top">
<h1>Componentes HexaBlock</h1>
<p class="lead">Siete decisiones del sistema visual y tres que son tuyas, con opciones que se ven en pantallas de teléfono. Cada opción tiene letra: respondes con algo como «tipografía B, radio A».</p>
<p>Todo sale del borrador de DESIGN.md: Rombo, cian señal, Unbounded y Archivo. El oscuro va primero y el claro al lado. Al final está la plantilla de respuesta.</p>
<p class="open">Aquí no se decide cuántas fichas tiene Hexa Sort, qué valor de Hexa Merge va en cada ficha, la orientación del hexágono ni cuántas veces aparece el cian por pantalla. Eso es del juego y del equipo.</p>
<nav aria-label="Secciones"><ul>{nav_html}</ul></nav>
</header>
<main class="inner-main" style="display:grid;gap:inherit;min-width:0">{body}</main>
</div></div>
<script>{JS.replace('%KEYS%', keys)}</script>
"""


# ---------- HTML balance check ----------

VOID = {'meta', 'link', 'input', 'br', 'img', 'hr', 'path', 'polygon', 'circle', 'rect', 'line'}


class Balance(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.errors, self.ids = [], [], []

    def handle_starttag(self, tag, attrs):
        for k, v in attrs:
            if k == 'id':
                self.ids.append(v)
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        for k, v in attrs:
            if k == 'id':
                self.ids.append(v)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack or self.stack[-1] != tag:
            self.errors.append(f'unexpected </{tag}> with open {self.stack[-3:]}')
            if tag in self.stack:
                while self.stack and self.stack.pop() != tag:
                    pass
        else:
            self.stack.pop()


def check_html(html):
    p = Balance()
    p.feed(html)
    p.close()
    assert not p.errors, p.errors[:5]
    assert not p.stack, f'unclosed {p.stack}'
    dup = {i for i in p.ids if p.ids.count(i) > 1}
    assert not dup, f'duplicate ids {dup}'
    for href in set(x.split('"')[0] for x in html.split('href="#')[1:]):
        assert href in p.ids, f'anchor #{href} has no target'
    assert '—' not in html, 'em dash found'
    assert '–' not in html, 'en dash found'


if __name__ == '__main__':
    html = page()
    check_html(html)
    # The default output is brand/tools/build/. Git ignores that folder.
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / 'build' / 'componentes.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    low = sorted(CHECKS, key=lambda c: c[1] - c[2])[:10]
    print(f'{len(CHECKS)} checks passed; HTML balanced; {len(html) // 1024} KiB')
    print(f'derived: pressed cyan {SIG_PRESSED}; light error {T["light"]["err"]}; '
          f'pressed surface dark {T["dark"]["sfp"]} light {T["light"]["sfp"]}')
    for label, v, m in low:
        print(f'  {v:.2f} (min {m}) {label}')
