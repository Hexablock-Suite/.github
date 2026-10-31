---
version: alpha
name: "HexaBlock Suite"
description: "Four hex puzzle games on one generic engine, for portfolio visitors and the course professor: professional, and still a game."
colors:
  neutral-dark: "#0d0e13"
  surface-dark: "#262830"
  board-dark: "#050609"
  cell-dark: "#2a2c33"
  primary-dark: "#f2f3f6"
  secondary-dark: "#a3a7b6"
  neutral-light: "#eaeaec"
  surface-light: "#ffffff"
  board-light: "#dbdde4"
  cell-light: "#ffffff"
  primary-light: "#121319"
  secondary-light: "#4a4d5a"
  ink: "#121319"
  tertiary: "#1ad8ff"
  on-tertiary: "{colors.ink}"
  tertiary-text-light: "#00728a"
  error-dark: "#ff4b55"
  error-light: "#c1373e"
  button-edge: "#00728a"
  button-edge-secondary-dark: "#4a4d5a"
  button-edge-secondary-light: "#a3a7b6"
  on-tile-dark: "{colors.ink}"
  on-tile-light: "#ffffff"
  tile-amarillo-dark: "#ffc800"
  tile-amarillo-light: "#957500"
  tile-rojo-dark: "#ff4b55"
  tile-rojo-light: "#cf3d45"
  tile-esmeralda-dark: "#22d47a"
  tile-esmeralda-light: "#15834c"
  tile-azul-dark: "#5b84ff"
  tile-azul-light: "#4b6cd1"
  tile-violeta-dark: "#a777ff"
  tile-violeta-light: "#845ec9"
  tile-magenta-dark: "#ff4fb3"
  tile-magenta-light: "#c43d8a"
typography:
  display:
    fontFamily: "Unbounded"
    fontSize: 31px
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: -0.02em
  title-md:
    fontFamily: "Archivo"
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.01em
  banner-title:
    fontFamily: "Unbounded"
    fontSize: 112px
    fontWeight: 800
    lineHeight: "none: one line, placed by its baseline at y = 156 of the 320px banner"
  banner-tagline:
    fontFamily: "Archivo"
    fontSize: 26px
    fontWeight: 500
    lineHeight: "none: one line, placed by its baseline at y = 226 of the 320px banner"
  body-md:
    fontFamily: "Archivo"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.45
  label-md:
    fontFamily: "Archivo"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.3
  button-md:
    fontFamily: "Archivo"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1
  field-input:
    fontFamily: "Archivo"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.45
  field-label:
    fontFamily: "Archivo"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.3
  field-message:
    fontFamily: "Archivo"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.35
  field-error:
    fontFamily: "Archivo"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.35
  tile-number:
    fontFamily: "Unbounded"
    fontSize: "TODO: number size per cell size; set by the app board (T5)"
    fontWeight: 800
    lineHeight: 1
rounded:
  button: 2px
  card: 2px
  board: 2px
  input: 2px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  screen-margin: "{spacing.lg}"
  card-padding: "{spacing.lg}"
  entry-gap: "{spacing.sm}"
  block-gap: "{spacing.xl}"
components:
  page-dark:
    backgroundColor: "{colors.neutral-dark}"
    textColor: "{colors.primary-dark}"
    typography: "{typography.body-md}"
  page-light:
    backgroundColor: "{colors.neutral-light}"
    textColor: "{colors.primary-light}"
    typography: "{typography.body-md}"
  card-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.primary-dark}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-padding}"
  card-light:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.primary-light}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-padding}"
  caption-dark:
    backgroundColor: "{colors.neutral-dark}"
    textColor: "{colors.secondary-dark}"
    typography: "{typography.body-md}"
  caption-dark-on-card:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.secondary-dark}"
    typography: "{typography.body-md}"
  caption-light:
    backgroundColor: "{colors.neutral-light}"
    textColor: "{colors.secondary-light}"
    typography: "{typography.body-md}"
  caption-light-on-card:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.secondary-light}"
    typography: "{typography.body-md}"
  signal-field:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    typography: "{typography.banner-title}"
  signal-field-tagline:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    typography: "{typography.banner-tagline}"
  signal-title-dark:
    backgroundColor: "{colors.neutral-dark}"
    textColor: "{colors.tertiary}"
    typography: "{typography.display}"
  signal-text-light:
    backgroundColor: "{colors.neutral-light}"
    textColor: "{colors.tertiary-text-light}"
    typography: "{typography.body-md}"
  button-primary:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.button}"
    height: 48px
    padding: "0 18px"
  button-secondary-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.primary-dark}"
    typography: "{typography.button-md}"
    rounded: "{rounded.button}"
    height: 48px
    padding: "0 18px"
  button-secondary-light:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.primary-light}"
    typography: "{typography.button-md}"
    rounded: "{rounded.button}"
    height: 48px
    padding: "0 18px"
  button-ghost-dark:
    backgroundColor: "{colors.neutral-dark}"
    textColor: "{colors.tertiary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.button}"
    height: 48px
    padding: "0 18px"
  button-ghost-light:
    backgroundColor: "{colors.neutral-light}"
    textColor: "{colors.tertiary-text-light}"
    typography: "{typography.button-md}"
    rounded: "{rounded.button}"
    height: 48px
    padding: "0 18px"
  button-ghost-pressed-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.tertiary}"
    typography: "{typography.button-md}"
  button-ghost-pressed-light:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.tertiary-text-light}"
    typography: "{typography.button-md}"
  field-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.primary-dark}"
    typography: "{typography.field-input}"
    rounded: "{rounded.input}"
    height: 48px
    padding: "0 14px"
  field-light:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.primary-light}"
    typography: "{typography.field-input}"
    rounded: "{rounded.input}"
    height: 48px
    padding: "0 14px"
  field-label-dark:
    backgroundColor: "{colors.neutral-dark}"
    textColor: "{colors.primary-dark}"
    typography: "{typography.field-label}"
  field-label-light:
    backgroundColor: "{colors.neutral-light}"
    textColor: "{colors.primary-light}"
    typography: "{typography.field-label}"
  field-error-dark:
    backgroundColor: "{colors.neutral-dark}"
    textColor: "{colors.error-dark}"
    typography: "{typography.field-error}"
  field-error-light:
    backgroundColor: "{colors.neutral-light}"
    textColor: "{colors.error-light}"
    typography: "{typography.field-error}"
  merge-number-dark:
    backgroundColor: "{colors.tile-azul-dark}"
    textColor: "{colors.on-tile-dark}"
    typography: "{typography.tile-number}"
  merge-number-light:
    backgroundColor: "{colors.tile-azul-light}"
    textColor: "{colors.on-tile-light}"
    typography: "{typography.tile-number}"
---
# HexaBlock Suite

Every value comes from a real source: the owner's decisions in the HexaBlock design-system feature document (S2 to S6), the second-pass generator `ds-rombo/gen.py` that measured the Rombo direction, the components-board generator `ds-componentes/gen.py` (board at https://claude.ai/artifact/LbxJjr7DjLdU8P1WnZeFAN) with the owner's picks on it, and the published brand assets in this repository. When a source does not say, the marker names what is missing. Nothing here is guessed.

The generators live in `brand/tools/` of this repository, and every generator path in this file is relative to that folder. `brand/tools/profile-assets/gen.py` generates the published profile assets in `profile/assets/`. `brand/tools/avatar-previews/gen.py` generates the published avatar and the social previews in `brand/`. `brand/tools/README.md` gives the setup and the commands to rebuild them.

The owner's picks on the components board, verbatim: «Tipografía: A · Radio: A · Espaciado: A · Botones: B · Campos: A · Íconos: C · Profundidad: B · Marca de referencia: Monument Valley · Tono: A (Preciso, Vivo, Claro) · Palabras prohibidas: solución, optimizar, ¡súper!, ¡yupi!, amiguito». Each letter names one option of that board. The values for each option come from `ds-componentes/gen.py`.

Each component with `backgroundColor` and `textColor` is a text contrast pair. `check_design.py` tests every pair. Tiles, cells, surfaces, edges, bars and focus rings are not text, so their pairs live in the tables under Colors.

Status: approved by the owner on 2026-10-31. The org profile banner, engine figure, game cards and badges, the avatar, the social previews of `hexablock-app` and `hexablock-api`, and the HexaBlock diagram profile use it. The app theme does not use it yet (T5).

## Overview
HexaBlock Suite is a course project: one mobile app with four puzzle games (Hexa Lines, Hexa Fit, Hexa Sort, Hexa Merge) on hexagonal boards, on one generic engine. It serves two audiences. Portfolio visitors arrive «Por linkedin o por github». The professor grades the course.

The look is the Rombo direction with a cyan signal colour. The owner's brief for its tone: «Yo pensaba en el sentido de que todo se vea demasiado sobrio y apagado, es un juego al final de todo, si es algo que es profesional, pero un juego al fin y al cabo. No necesariamente va a ser exagerado como para que parezca para niños de 2 años, pero al evitar eso que tampoco sea una app corporativa gris.» The owner chose Rombo because «el tercero es el que más logra lo que quiero de verse profesional y a la vez divertido».

**Reference brand: Monument Valley.** The owner picked it on the components board («Marca de referencia: Monument Valley»). It names the feel to aim at. No Monument Valley colour, shape, name or logo enters this file or any asset.

The README shows the game: «Con capturas o un GIF del juego en el README. Al menos mientras no haya un link, cuando si haya pueden coexistir».

The published assets in `profile/assets/` and `brand/avatar.svg` still use the earlier palette (`#2d3142`, `#4f5d75`, `#bfc0c0`, `#eb6c36`) and a system font stack. They are not sources for this palette. They get regenerated from this file after approval.

**Assumptions, not decisions.** Each one waits for owner or team confirmation.
- Scope (S1): «todo» means the six app screens, GitHub (org profile, READMEs, social previews), the diagrams and the artifacts.
- Dark first (S3): dark is the principal version of every single-image asset (banner default, social previews). The app follows the phone theme. Source: «el modo oscuro del rombo se ve increible. Incluso casi que podría ser la versión principal».
- Tile contrast (S6): every tile stays at 3:1 or more against its board and against the empty cell, in both themes.
- Team review (S7): the team sees this palette before the assets are regenerated. Source: «Se cambia, pero en principio, no hay problema en que nosotros hagamos el primer diseño o paleta».
- Deadline (S8): this palette exists before 2026-11-16, when sprint 3 builds the screens.
- Brand shape: the hexagon is the brand shape. Every published asset and the Rombo board use it, but the owner has not stated it as a rule.

## Colors
Two themes. The board changes with the theme: «Sí, el tablero también cambia con el tema».

**Dark theme**
- **Neutral (`#0d0e13`):** page background.
- **Surface (`#262830`):** cards, secondary buttons and fields.
- **Board (`#050609`):** the game board behind the cells.
- **Empty cell (`#2a2c33`):** a cell with no tile.
- **Primary (`#f2f3f6`):** headlines and body text.
- **Secondary (`#a3a7b6`):** captions, muted text and the field bottom bar.

**Light theme**
- **Neutral (`#eaeaec`):** page background.
- **Surface (`#ffffff`):** cards, secondary buttons and fields.
- **Board (`#dbdde4`):** the game board behind the cells.
- **Empty cell (`#ffffff`):** a cell with no tile.
- **Primary (`#121319`):** headlines and body text.
- **Secondary (`#4a4d5a`):** captions, muted text and the field bottom bar.

**Signal colour (the one accent), «Cian señal»**
- **Tertiary (`#1ad8ff`):** the signal. Source: «Tengo una inclinacion por el cian, ese». It is a brand field with ink type on it (ink `#121319` on cyan is 10.87:1), which includes the primary button. It is the title colour on the dark background (11.30:1 on `#0d0e13`). In the dark theme it is also the text cyan: ghost buttons, the focus ring and accent icons. It is never a tile.
- **Ink (`#121319`):** type on the signal field, in both themes.
- **Text cyan, light theme (`#00728a`):** cyan as text on the light background measures 1.42:1, so light-theme cyan text uses `#00728a` (4.63:1 on `#eaeaec`, 5.56:1 on `#ffffff`). It is the first value that passes. It sits close to the diagram teal `#0f6f74`. In the light theme it is the ghost button text, the focus ring and the accent icon colour.
- In the dark Corte banner, the line about to clear is drawn in the signal colour (8.17:1 against the dark board and the empty cell, the lower of the two). Source: `banner_corte` in `ds-rombo/gen.py`. In the light banner the same line uses the six tiles.
- TODO: how often the signal appears per app screen; no source sets a count.

**Error colour (field errors only, not an accent).** The draft had no error colour. The components board added one per theme, and the owner picked the field option that uses it («Campos: A»). Source: `T['dark']['err']` and `T['light']['err']` in `ds-componentes/gen.py`.
- **Error, dark (`#ff4b55`):** the dark shade of the Rojo tile. As text on the dark background it measures 5.87:1. On the dark surface it measures 4.47:1, which is under 4.5:1, so error text sits on the background. On the surface only the 3 px field bar uses it, as a graphical object (3:1).
- **Error, light (`#c1373e`):** a new value. It is derived from the light shade of the Rojo tile, `#cf3d45`: the generator mixes that shade toward a deep red of the same hue (`#420004`) until it reaches 4.5:1 on both the light background and the light surface (`reach` in `ds-componentes/gen.py`). It measures 4.50:1 on `#eaeaec` and 5.41:1 on `#ffffff`.
- An error never depends on colour alone. The message carries an alert icon and text.

**Button edges («Botones: B», option «Pieza»).** The primary and secondary buttons stand on a 4 px bottom edge. Source: `t['edge']` and `t['sfedge']` in `ds-componentes/gen.py`. Each edge reuses a value that already exists.
- **Primary edge (`#00728a`):** the light text cyan, in both themes.
- **Secondary edge, dark (`#4a4d5a`):** the value of the light-theme secondary.
- **Secondary edge, light (`#a3a7b6`):** the value of the dark-theme secondary.

**Tiles.** Six tiles, each with a dark and a light shade. «Cian señal» set from `ds-rombo/gen.py`: Celeste leaves because it is 0.03 from the signal in OKLab distance (the limit is 0.15), and Amarillo joins. Tiles are game pieces, not accents.

| Tile | Dark | Light |
|---|---|---|
| Amarillo | `#ffc800` | `#957500` |
| Rojo | `#ff4b55` | `#cf3d45` |
| Esmeralda | `#22d47a` | `#15834c` |
| Azul | `#5b84ff` | `#4b6cd1` |
| Violeta | `#a777ff` | `#845ec9` |
| Magenta | `#ff4fb3` | `#c43d8a` |

TODO: the Hexa Sort tile count is a team decision (S6). Six tiles are the example.

**Graphical contrast (not text).** Tiles against the board and the empty cell are graphical objects. WCAG 1.4.11 sets their minimum at 3:1, not the 4.5:1 for text. `check_design.py` tests every `backgroundColor` and `textColor` pair as text, so these pairs stay out of `components` and live here. Ratios come from `ds-rombo/gen.py` (WCAG 2.x relative luminance).

| Tile | Dark vs board | Dark vs empty cell | Light vs board | Light vs empty cell |
|---|---|---|---|---|
| Amarillo | 13.04:1 | 8.97:1 | 3.21:1 | 4.35:1 |
| Rojo | 6.16:1 | 4.24:1 | 3.51:1 | 4.77:1 |
| Esmeralda | 10.39:1 | 7.15:1 | 3.53:1 | 4.79:1 |
| Azul | 5.97:1 | 4.11:1 | 3.55:1 | 4.81:1 |
| Violeta | 6.49:1 | 4.46:1 | 3.50:1 | 4.75:1 |
| Magenta | 6.77:1 | 4.66:1 | 3.53:1 | 4.79:1 |

The lowest tile pair is Amarillo light against the light board, 3.21:1. The closest two tiles are Azul and Violeta in the light theme, 0.08 apart in OKLab distance.

**Control contrast (not text).** Bars, rings and edges are graphical. Ratios come from the `cr` function of `ds-componentes/gen.py`. The gate column names the minimum the board build enforces. The board has no gate for the button edges; their ratios are measured only.

| Pair | Dark | Light | Gate |
|---|---|---|---|
| Field bottom bar (secondary) vs surface | 6.13:1 | 8.40:1 | 3:1 |
| Error bar vs surface | 4.47:1 | 5.41:1 | 3:1 |
| Focus ring vs background | 11.30:1 | 4.63:1 | 3:1 |
| Focus ring vs surface | 8.62:1 | 5.56:1 | 3:1 |
| Primary edge `#00728a` vs cyan face | 3.26:1 | 3.26:1 | none |
| Primary edge `#00728a` vs background | 3.46:1 | 4.63:1 | none |
| Secondary edge vs background | 2.30:1 | 2.00:1 | none |
| Secondary edge vs surface | 1.75:1 | 2.40:1 | none |

**Layer separation (not text).** These pairs are low on purpose. Each one has a floor from the owner's corrections.

| Pair | Dark | Light | Floor (dark / light) |
|---|---|---|---|
| Surface vs background | 1.31:1 | 1.20:1 | 1.30:1 / 1.20:1 |
| Empty cell vs board | 1.45:1 | 1.36:1 | 1.45:1 / 1.35:1 |

## Typography
Two families. **Unbounded 800** for display: titles, the banner name and the numbers on tiles. **Archivo** for body text, game titles, labels and controls. Fallbacks from `ds-rombo/gen.py`: `Unbounded, 'Arial Black', 'Segoe UI', sans-serif` and `Archivo, 'Helvetica Neue', Arial, sans-serif`. Both are on Google Fonts: `https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Unbounded:wght@800&display=swap` (the link the second-pass page and the components board load). Set `--font-head` and `--font-body` once.

**App type scale «Compacta».** The owner's pick: «Tipografía: A». Source: `TYPE['a']` in `ds-componentes/gen.py`, steps of 1.2 on 15 («pasos de 1,2 sobre 15»). Letter spacing comes from the board CSS (`.hd-name`, `.e-name`).

| Role | Size / line height | Family and weight | Letter spacing | Use on the board |
|---|---|---|---|---|
| Display | 31px / 1.05 | Unbounded 800 | -0.02em | the name in the home header |
| Title | 22px / 1.20 | Archivo 600 | -0.01em | game names, screen titles |
| Body | 15px / 1.45 | Archivo 400 | none | running text |
| Label | 13px / 1.30 | Archivo 500 | none | game descriptions, score labels |

- Control text, from the board CSS: buttons Archivo 600 16px with line height 1; field text Archivo 400 16px; field label Archivo 600 14px / 1.30; field help message Archivo 400 14px / 1.35; field error message Archivo 500 14px / 1.35.
- The board's layout gate checks that «HexaBlock» fits on one line of the home header on a 390px phone at this scale.
- The Corte banner sets the name at 112px Unbounded 800 on a 1280px-wide banner, the word «Suite» at 44px, and the tagline at 26px Archivo 500. The title must stay legible at about 360px wide (S5): 112px at 1280px is about 31px at 360px.
- **Banner lines:** the Corte banner places each line by its baseline, not by a line height. The name sits at y = 156, and «Suite» and the tagline sit at y = 226 (`CORTE` in `ds-rombo/gen.py`, used by the published banner).
- TODO: the tile number size per cell size. The app board (T5) decides it.

## Layout
**Spacing «Base 4».** The owner's pick: «Espaciado: A». Source: `SPACE['a']` in `ds-componentes/gen.py`.

- **Scale:** 4, 8, 12, 16, 24, 32 px.
- **Screen margin:** 16px on each side of a phone screen.
- **Card padding:** 16px.
- **Gap between entries** (game cards in a list, stacked buttons): 8px.
- **Gap between blocks** (header, lead, list, actions): 24px.
- **Gap inside a game entry** (badge, text, play icon): 12px, three quarters of the card padding (`.entry` in the board CSS).
- The board draws every screen on a 390px-wide phone.

TODO: grid and maximum page width for screens wider than a phone (GitHub pages, artifacts). The components board draws phones only; T5 or the first wide page decides them.

Banner and preview sizes from the sources: the profile banner is 1280 × 320 (the published `banner-*.svg` and the Corte banner in `ds-rombo/gen.py`). The social preview is 1280 × 640 (T3).

## Elevation & Depth
Layers separate by the tone step plus a subtle shadow. The owner's pick: «Profundidad: B», option «Sombra sutil».

- **Tone step:** the surface sits at 1.30:1 or more on the dark background and 1.20:1 or more on the light background (see Colors).
- **Card shadow, dark:** `0 1px 2px rgba(0,0,0,.55), 0 8px 20px rgba(0,0,0,.40)`.
- **Card shadow, light:** `0 1px 2px rgba(18,19,25,.10), 0 8px 20px rgba(18,19,25,.10)`. The colour is ink `#121319` at 10 %.
- Source: `T['dark']['shadow']` and `T['light']['shadow']` in `ds-componentes/gen.py`.
- On the board only cards carry the shadow: game entries and the score card. Buttons, fields and the board frame do not. Buttons get their depth from the 4 px edge (see Components).

## Shapes
- **Corner radius «Recto».** The owner's pick: «Radio: A». Source: `RADIUS['a']` in `ds-componentes/gen.py`. Buttons 2px, cards 2px, the board frame 2px, fields 2px. Icon buttons and the game badges use the button radius. Fields round only their two top corners, above the bottom bar.
- TODO: the radius of images. The components board shows no image.
- **Cells and tiles:** hexagons. The hexagon as brand shape is an assumption (see Overview).
- TODO: the hexagon orientation. The Rombo review board and the components board draw pointy-top cells (`mini_board` in `ds-rombo/gen.py`, `hexpts` in `ds-componentes/gen.py`), and the published avatar draws flat-top cells. No requirement or architecture document decides it; the engine's board coordinates (T5) decide it. The published profile mixes both today: the banner and the social previews draw pointy-top cells (from `corte_cells`), and the engine figure, the game cards and the avatar keep flat-top cells.
- **Field end «Corte».** The owner's pick: «Corte en todos (Recomendado)». Every signal field ends in a 60-degree cut over the full field height. The reason, in the owner's words: «en el baner el corte es lo que mejor se ve», and on the phone screens «el problema que tenia es que el corte estaba solo como hasta la mitad, y si hacemos el corte completo desde arriba a la derecha servira? Asi usariamos corte en ambas».
  - Rule: the cut starts at the top-right corner of the field and leans 60 degrees from the horizontal. Its horizontal run is the field height ÷ √3, about 0.58 of the height. A text line on the field ends 24px or more before the cut, measured at the line's baseline (the gates in `profile-assets/gen.py` and `avatar-previews/gen.py`).
  - Phone header: with the Compacta scale and the Base 4 spacing on a 390px phone, the header is 87px tall (`header_geom` in `ds-componentes/gen.py`). The cut runs from x = 390 at the top to x = 339.8 at the bottom (87 ÷ √3 = 50.2px). The 31px name ends at x = 219.7: the 16px gutter plus 203.7px of text, -0.02em letter spacing included. That is 120.1px before the bottom end of the cut. Option A on the components board cut only 42px of the 87px header, so on a phone it showed as a small corner triangle. The cut that starts exactly at the corner, with no inset, is an assumption the owner has not confirmed (S5).
  - Corte banner (1280 × 320): polygon `0,0 1000,0 815,320 0,320`, the published Corte geometry (`banner_corte` and `CORTE` in `ds-rombo/gen.py`; field end A in `banner_svg` of `ds-componentes/gen.py`). The run is 320 ÷ √3 = 184.8px, and the bottom end is rounded to a whole pixel. The name ends at x = 807, 102.8px before the cut at its baseline (y = 156). The tagline ends at x = 762.2, 107.2px before the cut at its baseline (y = 226).
  - Social preview (1280 × 640): polygon `0,0 1280,0 1095,320 0,320` on the 320px field band. The cut starts at the top-right corner with no inset, and the bottom end is rounded as on the banner (1280 − 184.8). Board cells fill the wedge right of the cut. The name ends 67.5px (`hexablock-app`) and 122.3px (`hexablock-api`) before the cut at its baseline (y = 202). The description sits below the field, on the board.
- TODO: pills, and where they may appear. No source decided them.

## Components
- **Board:** the board colour fills the area behind the cells. Empty cells use the cell colour. Tiles use the tile shades of the active theme. The board frame has a 2px radius.
- **Hexa Merge number:** the number on a tile is Unbounded 800. On the Azul tile it is ink `#121319` in the dark theme (5.46:1) and `#ffffff` in the light theme (4.81:1). Source: `number_color` in `ds-rombo/gen.py`, which picks the higher-contrast of white and ink.
- TODO: the number colour on the other five tiles. The mapping from Hexa Merge values to tiles is not decided.
- **Signal field:** cyan `#1ad8ff` with ink `#121319` type, in both themes.
- **Corte banner (S5):** a signal field that ends in a 60-degree cut holds the name in ink, beside a crop of the board with a line about to clear (see Shapes). Dark and light versions. The geometry in `banner_corte` in `ds-rombo/gen.py` is the reference for T2: polygon `0,0 1000,0 815,320 0,320`.
- **Home header:** the signal field with the name in ink, in both themes. It ends in the same 60-degree cut as the banner, over the full header height from the top-right corner (see Shapes).
- **Cards:** the surface colour of the theme with primary text, a 2px radius, 16px padding and the card shadow (see Elevation & Depth).
- **Game entry:** a card with a 44px badge in the board colour, the game name in the title style, the description in the label style, and a 24px play icon in the theme text cyan.

**Buttons «Pieza».** The owner's pick: «Botones: B». Source: `BUTTON_SPEC['b']` and the button CSS in `ds-componentes/gen.py`. Every button is 44px tall or more.
- **Primary:** cyan `#1ad8ff` face with ink `#121319` text, in both themes. Archivo 600 16px, 2px radius, padding 0 18px. Height 48px, which includes a 4px bottom edge in `#00728a`. An icon in a button is 20px, 8px from the text.
- **Pressed (primary and secondary):** «el canto desaparece y el botón baja 4 px, como una ficha que entra». The edge goes to 0, the button moves down 4px and is 44px tall. The face colour does not change. The move takes 0.12s ease, and none when the user asks for reduced motion.
- **Secondary:** the theme surface with primary text and the same 4px edge in grey: `#4a4d5a` in dark, `#a3a7b6` in light.
- **Ghost:** the theme text cyan with no fill: `#1ad8ff` in dark (11.30:1 on the background), `#00728a` in light (4.63:1). Pressed, the board draws it on the theme surface (8.62:1 dark, 5.56:1 light).
- **Focus:** a 3px ring, 3px from the button, in the theme text cyan (`#1ad8ff` dark, `#00728a` light).
- **Icon button:** a 48 × 48 square on the theme surface with a 24px icon and a 2px radius.

**Fields «Relleno».** The owner's pick: «Campos: A». Source: `INPUT_SPEC['a']` and the field CSS in `ds-componentes/gen.py`.
- **Box:** the theme surface, 48px tall, padding 0 14px, no outline, 2px radius on the top corners. Text is Archivo 400 16px in primary. The placeholder is secondary.
- **Bottom bar:** 2px in the theme secondary (`#a3a7b6` dark, `#4a4d5a` light).
- **Focus:** the bar becomes 3px in the theme text cyan. The caret is 2px wide in the same colour.
- **Error:** the bar becomes 3px in the theme error colour (`#ff4b55` dark, `#c1373e` light). Under the field, a 16px alert icon and the message, Archivo 500 14px, in the error colour on the background.
- **Label and help:** the label sits above the box in Archivo 600 14px, primary. The help message sits below in Archivo 400 14px, secondary.
- The field texts on the board («Tu nombre», «Escribe al menos 3 letras.») are examples, not copy.

## Do's and Don'ts
Each rule is one sentence of intent and one sentence of limit.

- Do keep text contrast at 4.5:1 or better. Text of 24px and up, or bold 18.66px and up, may go to 3:1.
- Do keep every tile at 3:1 or more against the board and the empty cell, in both themes. This rule rests on the S6 assumption.
- Don't let the surface blend into the background. The owner's correction: «el color de la superficie, que casi no se distingue del fondo». Keep surface vs background at 1.30:1 or more in dark and 1.20:1 or more in light.
- Don't let the empty cell blend into the board. The owner's correction: «Se ve muy raro ese raya negra así en y que no se distingue casi el fondo de casilla». Keep empty cell vs board at 1.45:1 or more in dark and 1.35:1 or more in light.
- Don't draw a full ink-black line in the light banner. Same correction: «Se ve muy raro ese raya negra así». The light banner line uses the six tiles.
- Don't use the signal colour as a tile. The owner's rule for the signal: «puede ser un color así que destaque también, pero utilizando el mismo principio». A tile within 0.15 OKLab distance of the signal leaves the set.
- Don't set cyan `#1ad8ff` as text on the light background. It measures 1.42:1. Use `#00728a`.
- Don't constrain the tiles for colour-blind users. The owner's decision: «Que se joda entonces el daltonismo, prefiero el visualmente atractivo a la accesibilidad para esto.» An optional mode may come later: «Si acaso en algun momento habilitamos un modo opcional de daltonismo. Pero no es prioridad. Si queda fuera de las fichas».
- Don't add a second accent colour. Tiles are game pieces and the error red marks errors only; neither is an accent.
- Don't use a third font family.
- Don't use the owner's banned words in any copy, in Spanish or English. The owner's list: «solución, optimizar, ¡súper!, ¡yupi!, amiguito»; the English pairs from the board are solution, optimize, super!, yay! and buddy.

## Iconography
**Icon set «Macizo».** The owner's pick: «Íconos: C». Source: `ICONS['c']`, `ICON_SPEC['c']` and `ICON_PATHS` in `ds-componentes/gen.py`.

- **Set:** one own set, drawn by hand on a 24-unit grid (`viewBox="0 0 24 24"`). The board draws six icons: play, back, settings, trophy, undo and alert.
- **Stroke:** 2.5px, butt caps, miter joins.
- **Fill:** closed shapes are filled with the icon colour (`currentColor`). Open lines stay strokes.
- **Settings:** a hexagonal nut with a round hole.
- **Sizes:** 24px by default, 32px large, 20px inside buttons and next to the record, 16px in field messages.
- **Colour:** the icon takes the text colour around it. Primary by default; the theme text cyan for the play icon in game entries and the trophy. Primary and text-cyan icons pass 3:1 on the background and the surface in both themes (gates in `ds-componentes/gen.py`). The cut inside the filled alert icon uses the background colour.
- TODO: the orientation of the settings nut. The board draws it pointy-top, like the review board; it follows the hexagon orientation once T5 decides it.
- **Logo:** `brand/avatar.svg`, one engine cell surrounded by six board cells. It uses the earlier palette. T3 recolours it from this file.
- **Game icons:** `profile/assets/game-lines.svg`, `game-fit.svg`, `game-sort.svg`, `game-merge.svg`: a 120 × 120 hexagon badge with tiles inside. They use the earlier palette. T2 restyles them from this file.

## Voice
Tone from the owner (S2): professional, «pero un juego al fin y al cabo»; not «para niños de 2 años»; not «una app corporativa gris».

**Tone words.** The owner's pick: «Tono: A (Preciso, Vivo, Claro)». The app ships in Spanish and English; the English pairs come from the board (`TONES` in `ds-componentes/gen.py`).
- **Preciso / Precise**
- **Vivo / Lively**
- **Claro / Clear**

**Banned words.** The owner's pick: «Palabras prohibidas: solución, optimizar, ¡súper!, ¡yupi!, amiguito». English pairs from the board (`BANNED` in `ds-componentes/gen.py`).

| Spanish | English |
|---|---|
| solución | solution |
| optimizar | optimize |
| ¡súper! | super! |
| ¡yupi! | yay! |
| amiguito | buddy |

Lines the brand already uses (`profile/README.md` and `profile/assets/`):
- «Four hex puzzle games on one generic engine»
- «one board», «one rules contract», «one turn cycle»
