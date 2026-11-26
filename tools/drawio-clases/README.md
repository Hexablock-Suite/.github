# drawio-clases

This tool draws the class model of one HexaBlock repository as one draw.io file.
Page 1 shows every class, interface and type in four Clean layer bands.
Each next page shows one part of the model.
All pages come from one model, so they do not contradict each other.

[`MODEL.md`](MODEL.md) is the contract between the scripts.
It defines the model JSON: types, edges, layers and parts.
Change `MODEL.md` before you change the shape of the model.

The tool lives in `tools/drawio-clases/` of the organization repository `Hexablock-Suite/.github`.
Each HexaBlock repository keeps its own files in `docs/architecture/`:

| File | Content |
|---|---|
| `classes.drawio` | the diagram that `gen.mjs` writes |
| `classes.config.json` | the config of `merge.mjs`: folders and views to layers and parts, patterns, stereotypes |
| `classes.layout.json` | the layout file: the fixed order of groups and boxes (`MODEL.md`, «Layout file») |

## Quick start

You need Node 24 and a clone of the target repository with its dependencies installed (`merge.mjs` loads its `typescript`).
The `src/` and `app/` of that clone must have no uncommitted change, because the model comes from `HEAD`.
In the commands, `<repo>` is the root of that clone and `<out>` is a scratch directory outside it.

1. Clone this repository and go to the tool.

   ```sh
   git clone https://github.com/Hexablock-Suite/.github.git hexablock-github
   cd hexablock-github/tools/drawio-clases
   ```

2. Generate the diagram of one repository. Leave out `--layout` when the repository has no `classes.layout.json` yet.

   ```sh
   node merge.mjs <repo> <out>
   node gen.mjs <out>/<repo-name>.model.json <repo>/docs/architecture/classes.drawio --layout <repo>/docs/architecture/classes.layout.json
   ```

3. Open `classes.drawio` in draw.io. Drag the boxes inside their group, or drag whole groups inside their band, into the order you want.
   Save the file uncompressed: keep «Compressed» off in File > Properties.

4. Pin the order of your edit into the layout file.

   ```sh
   node pin.mjs <repo>/docs/architecture/classes.drawio <out>/<repo-name>.model.json <repo>/docs/architecture/classes.layout.json
   ```

5. Generate again, with the command of step 2. `gen.mjs` now keeps your order and draws clean lines.

6. Check the result. Exit 0 means no violation.

   ```sh
   node check.mjs <repo>/docs/architecture/classes.drawio <out>/<repo-name>.model.json
   ```

Commit `classes.drawio` and `classes.layout.json` together in the target repository.

### Which hand edits survive

| Survives the next generation | Does not survive |
|---|---|
| the order of the groups in a band | the pixel position of a box or a group |
| the order of the boxes in a group, read row by row, then left to right | the gaps and the row breaks: `gen.mjs` wraps the boxes into rows again |
| | the view frames: `gen.mjs` draws them again; the box order sets the frame order (see «Pages») |
| | the line routes and the label positions |
| | a box moved to another group: it stays in the group that the model gives it, after the pinned boxes, and `pin.mjs` prints a warning |
| | a change of text, style or size |

The layout keeps order only, because a fixed position breaks when a new class arrives, and the router cannot route around an enclosed box.

## Order

| Step | Script | Input | Output |
|---|---|---|---|
| 1 | `extract.mjs` | the `src/` and `app/` of the repository at `head` | code types and code edges |
| 2 | `views.mjs` | the class views of `docs/architecture/` | planned types, planned members and view edges |
| 3 | `merge.mjs` | the output of steps 1 and 2 | one model in the shape of `MODEL.md` |
| 4 | `gen.mjs` | the model and the optional layout file | one uncompressed multi-page `.drawio` file |
| 5 | `check.mjs` | the `.drawio` file and the model | the notation violations, exit 1 when there is one |
| 6 | `render.mjs` | the `.drawio` file | one PNG per page, for a visual look |
| - | `pin.mjs` | a `.drawio` file that a person edited, and the model | the layout file |

### What the generator reads

`extract.mjs` reads the `.ts` and `.tsx` files of `src/` and `app/`. Test files (`*.test.ts`, `*.spec.ts`) and declaration files (`*.d.ts`) stay out.

- A top-level class, interface, type alias or enum is a code type. A top-level `const` that holds an object literal is a code type of kind `const`.
- A function component is a code type of kind `component`. In `src/`, it is a function, or a `const` that holds a function, with a PascalCase name in a `.tsx` file, that the file exports with `export`, `export default Name;` or `export { Name }`. In `app/`, it is the default export of each route file, for example `export default function GameScreen()`.
  Its props are its attributes, also a prop in method syntax such as `onPick(at: Coord): void`. Its body and the default values of its props give its uses.
- A member uses a model type when its types, its `new` calls, its values or the inferred types of its local variables name that type.
- A use inside a top-level function of the same file counts for the member that names the function in a call, a JSX tag, or a reference to the function as a value, such as the shorthand property `{ helper }`. A `typeof` type query does not read the function. The tool does not follow a function of another file.
- `views.mjs` reads the class views. A box or a line that no code type or code use has becomes planned.

`merge.mjs` keeps a `const` or a `component` only when a view draws it. It places each code type by the folders of the config.
A declaration of `app/` that no folder holds is no code type: a view box of its name stays a planned type, as before the tool read `app/`, and its code lines stay out. Each one that is exported or that a view draws prints one `warning:` line. A route is exported. It does not fail the run.

## Commands

```sh
node merge.mjs <repo-root> <out-dir> [--config <config.json>]
node merge.mjs --check <model.json>
node gen.mjs <model.json> <out.drawio> [--layout <layout.json>]
node pin.mjs <edited.drawio> <model.json> <layout.json>
node check.mjs <out.drawio> <model.json> [<config.json>]
node render.mjs <out.drawio> <png-dir>
```

`merge.mjs` reads `<repo-root>/docs/architecture/classes.config.json` when no `--config` is given.
`check.mjs` reads `classes.config.json` next to the `.drawio` file when no config is given, for the stereotypes of `stereotypeFor`.
For a diagram at `docs/architecture/classes.drawio`, that is the same file that `merge.mjs` reads.
`merge.mjs` prints one `warning:` line on stderr for each declaration of `app/` that no folder of the config holds and that is exported or that a view draws. A view box of its name stays a planned type, and the warning does not change the exit code.
`gen.mjs` prints one `warning:` line on stderr for each page, group or type of the layout file that the model does not have, and exits 0.
`pin.mjs` prints one `warning:` line on stderr for each box that sits outside its group, and exits 0.
`merge.mjs` lists the code classes with no operation, and their stereotypes, under «Types with no operation» in `planned-report-<repo>.md`. An interface with no operation keeps «interface» alone, so the list leaves it out.
The tools use Node built-ins only. The page builder in `page/` is the one exception (see «Page»).
`gen.mjs` writes no timestamp and no random id, so the same model always gives the same bytes.

## Pages

- Page 1, «All classes», has a band for each layer: layer 4 at the top, layer 1 at the bottom, so every dependency points down.
  Each band title gives the Clean name of its layer, then the name of its source folder: `LAYER 1 · ENTITIES / DOMAIN`, `LAYER 2 · USE CASES / APPLICATION`, `LAYER 3 · INTERFACE ADAPTERS / ADAPTERS` and `LAYER 4 · FRAMEWORKS AND DRIVERS / INFRASTRUCTURE`.
  A band groups its types by part, then by source folder. A planned type sits in the group «<part> · planned».
  A group has a thin border and its label at the top left.
- A group with 12 boxes or more is large. A large group, and a group alone in its band, takes the full width of the band.
- Inside a large group of class boxes, the boxes of one view sit in one frame. The frame title names the view, for example `view engine-1-turn`.
  Each type has one home view: the view of its `views` array that the most boxes of the group share. A tie goes to the first view name.
  A view that draws more than half of the boxes of the group is an overview, such as `overview-engine`. A type goes to it only when it has no other view.
  A type with no view sits in the frame `in no view`. A view that is home to one box only goes to the frame `other views`.
  A group with one frame only gets no frame. A group of reference boxes gets no frame.
  The frames follow the first box of each frame in the box order, and each frame keeps the box order. So the layout file also orders the frames.
  The frames of a group aim at one height and stand side by side, like columns. A frame is as wide as the area of its boxes needs.
  A frame is not a container: a box stays a child of its band.
- Page 2 and the next pages show one part each, in the order of `parts`.
  A part page shows the types of its part in full.
  It also shows each type of another part that one of its lines touches, as a grey reference box with the name only.
  The eyebrow of that box names the page that details the type, for example `PAGE 2 · ENGINE`.
  The page draws every line between the types it shows.
- Each page has a legend. The legend lists only the line kinds and box kinds that the page draws.

## Layout and lines

- Inside a group, boxes that share a line sit near each other.
  Four sweeps sort each group by the mean position of the boxes that its boxes connect to.
  The bands and the groups keep their order.
- A layout file fixes the order of the groups of a band and the order of the boxes of a group (`MODEL.md`, «Layout file»).
  The fixed groups and boxes come first, in the order of the file. The others follow in the computed order.
- The gaps between boxes, groups and bands are gutters.
  Two neighbours in a row that share a labelled line get a gap wide enough for the label.
- A router walks an 8-pixel grid in the gutters and keeps 8 pixels away from every box.
  Each line leaves its source on one side and enters its target on one side, with a straight stub of 24 pixels for the arrowhead or the diamond.
  The router pays for length, bends and tracks that other lines already use, so parallel lines take distinct tracks.
- Each line stores its fixed exit and entry (`exitX`, `exitY`, `entryX`, `entryY`) and its waypoints (`<Array as="points">`) at every bend.
  draw.io follows the waypoints of an orthogonal edge, so it draws the path of the router.
- A member line, a literal or a type alias wider than 460 pixels wraps after `, `, `; `, `(`, `{ ` or `<`, or before ` | `.
  The next part starts with an indent. `<br class="wrap">` marks the soft break, and `check.mjs` reads the parts as one line.
- The use lines of a page live in the draw.io layer `use lines`, above the default layer. Hide them in Edit > Layers (Ctrl+Shift+L).
  The structure lines (`extends`, `implements`, `aggregation`, `composition`) stay in the default layer.
- Each label sits on a segment of its own line, or just beside it, clear of every box.
  A label that finds no clear place on one line wraps after each `, ` and before each ` · `.
  `gen.mjs` and `render.mjs` both ignore a touch of 1 pixel or less.
  `gen.mjs` estimates the text width on the wide side, so its count is never lower than the count of `render.mjs`.
  `gen.mjs` prints how many labels touch a box or another label.

## Notation

| Element | Drawing |
|---|---|
| class box | stereotypes, name (italic when abstract), attributes `+ name: type`, operations `+ name(p: T): R` (italic when abstract) |
| type parameters | a small dashed box at the top right of the class, with bounds and defaults |
| union, enum | `«enumeration»` and one literal per line; a union takes the word from the model (`merge.mjs`) |
| type alias | no kind word: the box shows its stereotypes from the model, if any, its name and `= <aliased type>` or its attributes |
| component | `«component»` from the model, its name and its props as attributes |
| planned type | dashed border, `«planned»` and its `«Sprint N»` |
| planned member | its `«Sprint N»`, or `«planned»`, before the member |
| planned class with no operation | one italic line, `members not designed yet`, in the operation compartment; the tool does not invent members |
| code class with no operation | the stereotype `«dataType»`: a type that only carries data; the `stereotypeFor` map of the config can name another one, such as `«module»` for a Nest module |
| code interface with no operation | `«interface»` alone, never `«dataType»` on top |
| long member | wraps into parts; each next part starts with an indent |
| use | thin (1 px) solid line in a light ink, open arrowhead at the class it needs, label from the model in 10 px; layer `use lines` |
| implements | dashed line, hollow triangle, 2 px |
| extends | solid line, hollow triangle, 2 px |
| aggregation, composition | hollow or filled diamond at the holder, attribute and multiplicity near the far end, 2 px; a Decorator aggregation carries the role and the multiplicity instead, for example `decorate 1` |
| planned line | the style and width of its kind in grey, and the word `planned` in the label |
| group | thin border in the layer color, label at the top left |
| view frame | rounded panel in a light tint of the layer, title `view <name>` |

Every line goes from class cell to class cell. Dashed lines stay reserved for implements.
The light ink of a use line is darker than the grey of a planned line.

## Cell data

`gen.mjs` wraps each box in a draw.io `<object>`. Its attributes show in draw.io under «Edit Data».
`check.mjs` and `render.mjs` read them.

| `role` | Cell | Other attributes |
|---|---|---|
| `class` | a full class box | `typeId`, `kind`, `status`, `layer` |
| `ref` | a reference box | `typeId`, `kind`, `status`, `layer` |
| `tparams` | the type parameter box, a child of its class | `typeId` |
| `band` | a layer band | `layer` |
| `group` | the border and label of a group | none |
| `frame` | the frame of one view inside a large group | `view` |
| `legend`, `legend-line`, `legend-box` | the legend and its rows | `kind` on a row |

Page 1 has the id `all-classes`. A part page has the id `part-<part id>`.
The use layer of a page is the plain cell `<page id>~layer-use`, with the name `use lines`. Each use line has it as its parent.
The id of each cell comes from the page id and the type ids or the edge key.

## Checks

`check.mjs` prints one line for each violation.

| Check | Rule |
|---|---|
| (a) | The `source` and `target` of every edge are class or reference cells (rule 3). Each edge has one UML line kind in its style. |
| (b) | No aggregation or composition joins two layers (rule 9). |
| (c) | Page 1 shows every model type exactly once and in the band of its layer. It draws every model line, and no other line. |
| (d) | Each part page is a subset of page 1: the same boxes, and only lines that page 1 draws. It shows every line between the types it shows. A reference box names the page that details it. |
| (e) | Every operation shows parentheses, a type for each parameter and a return type. A constructor has no return type (rule 5). |
| (f) | The legend of each page lists exactly the line kinds and box kinds of that page (rule 13). |
| (g) | The XML parses. No cell id appears twice on one page, because draw.io expects one cell for each id inside one page. A part with planned types in two layers gives two planned groups with one cell id, so (g) fails on it. |
| (h) | Every line has a fixed exit, a fixed entry and waypoints, with no diagonal segment. No segment enters a class box, a reference box or a type parameter box, except the two boxes that the line joins. |
| (i) | A class or interface box with no operation says why. A planned box shows `members not designed yet`. A code class box shows `«dataType»` or a stereotype of the `stereotypeFor` map of the config. A code interface box shows `«interface»`, or `«port»` when it is a port. Any other class or interface with no operation is a violation. Types, unions, enums, consts and components are exempt. |

`fixtures/mini.model.json` is a small model with all four layers, three parts and every edge kind.
`fixtures/broken.drawio` breaks rule 3, rule 9 and check (h) on purpose: `check.mjs` must fail on it.
`fixtures/mini.expected.drawio` holds the bytes that `gen.mjs` writes for `fixtures/mini.model.json` with no layout file.

```sh
node check.mjs fixtures/broken.drawio fixtures/mini.model.json   # exit 1
node gen.mjs fixtures/mini.model.json /tmp/mini.drawio
node check.mjs /tmp/mini.drawio fixtures/mini.model.json         # exit 0
```

## Tests

`node --test 'test/*.test.mjs'` in `tools/drawio-clases/` runs the tests of `test/`. They use Node built-ins only and need no install step.
Give the pattern: a plain `node --test` there also finds the tests of `page/`, and these need `npm ci` in `page/` first.
`node --test` in `tools/drawio-clases/page/` runs the tests of the page builder, after `npm ci` there.
The tests of `page/test/zoom.test.mjs` drive the built page in a headless Chromium. They skip on a machine with no Chromium.
The workflow `.github/workflows/drawio-clases.yml` runs them on each pull request and push that touches the tool.

## Render

`render.mjs` needs a local Chromium. It looks for `CHROME_BIN`, then for the Playwright browsers in `~/.cache/ms-playwright`, then for `chromium` or `google-chrome` on the `PATH`.
It does not use draw.io. It places the boxes and the HTML labels at their geometry, as draw.io does.
It draws each line through its fixed exit, its waypoints and its fixed entry, with its stroke width, and puts each label where draw.io puts it.
A line without waypoints gets a simple elbow, so draw.io can route that line on another path.
For each page it reports the labels larger than their box, the line labels on a box, the overlapping boxes and the lines that cross a box.
`RENDER_SCALE` sets the PNG scale. The default keeps each side under 12000 pixels.

## Page

The page is a clickable class diagram for the browser. It shows one repository at a time, and a switch in the tool bar loads the other one.
It reads only the model of `MODEL.md`, the model that `gen.mjs` draws. It never reads source code, so it never contradicts `classes.drawio`.
It has the four layer bands with layer 4 at the top, the folder frames, the view frames inside a large folder, the planned zones, two box densities and three zoom levels.
Each band label gives the Clean name of its layer, then the name of its source folder: `Layer 1 · Entities / Domain`, `Layer 2 · Use cases / Application`, `Layer 3 · Interface adapters / Adapters` and `Layer 4 · Frameworks and drivers / Infrastructure`.
The layer chip of the side panel and the layer tab of the highlight menu show the same names. The names live in `LAYER_NAMES` of `page/layout.mjs`, and the build gives them to the page.
A click on a class chooses it: its lines and its neighbors stay, each neighbor gets a `dependent` or `dependency` tab, and a side panel lists its members, its views and its relations.
The panel names a diamond by its kind and its label, for example `aggregation · decorate 1`.
The search finds a class by name or stereotype, the highlight menu lights a stereotype, a view, a layer or a pattern, and a link such as `#app-GameEngine` opens one class.
The pattern tab shows only when the edges of the model carry a `pattern`. A pattern lights its edges and the two ends of each edge.
An `aggregation` draws a hollow diamond at its `from` type, and a `composition` a filled one. The label sits near the other end.
The legend lists a line kind only when the loaded model has an edge of that kind.
Each class with a file links to its line on GitHub, at the commit of the model.

The builder lives in `page/`. It has its own `package.json`, so the scripts above keep zero dependencies.
Its one dependency is `elkjs`: ELK places the boxes inside each frame with a layered layout.
The builder packs the frames, the groups and the bands itself, and routes the structure and attribute lines on its own grid.

#### Zones, labels and trunks

- A folder with 48 types or more is zoned. The two real models give the value: App `domain/engine` holds 105 types, and the next largest folders hold 40 (API `adapters/http`) and 34 (App `application`).
  In a zoned folder each view frame is a zone, with a corridor of 144 units to the next zone. A type with no view goes to the zone `in no view`.
  The router pays for each step inside a zone or a folder that a line does not join, so the lines take the corridors.
- The frame of a zone is a plate with a solid border, so the reader sees where the zone ends. A plain view frame stays a faint dashed hint.
- At the far zoom level, the lines between two zones of one zoned folder hide. The zone labels say what each zone holds.
  Those lines show at the middle and near levels, for the chosen class, and for a pattern highlight.
- At the middle level, a line between two zones or two folders is a ghost line: thin and pale, as background texture.
  A ghost line takes full ink when one of its ends is chosen, hovered or highlighted. At the near level every line has full ink.
- Each folder frame and each zone frame keeps a label room at the top. The far label of the zone lives in that room, so it covers no box and no other label.
  The room is as high as a label of one line at 0.8 of its size, at the fit zoom of a 1440 by 900 window. The packer runs three times, because the fit zoom depends on the size of the canvas.
  On screen, a label keeps its size while its room holds it, then shrinks to 0.6 of its size, then hides. It moves right, inside its room, past a band label.
- Each band keeps a label room at its top left for the band label. The room is as high as the top padding of the band, so no folder frame of the band overlaps it.
  The top padding aims to hold the band label with a gap of 8 pixels above and below, at the fit zoom of a 1440 by 900 window. The padding is 168 units or more. The same three passes of the packer give it.
  The last pass can make the canvas a little larger, so the gap at the final fit zoom can be smaller. On the App model it is about 5 pixels.
  The room is as wide as the band label text at that zoom, with its left offset of 16 pixels and a gap.
  On screen, the band label sits in the middle of the height of its room and keeps a gap of 4 pixels or more to its edges.
  When the room is too small for that, for example below the fit zoom, the label shrinks to fit the room, down to 0.6 of its size, and then hides.
  On the far map, a band label also sticks to the top left of the visible part of its band.
- The `implements` lines into one type enter it on one side and meet in one port, so they share one trunk. The `extends` lines do the same.
  The side is the one that most of these lines would take.
- A step beside a line to another target, one track away, costs more than two bends. So long parallel lines keep two tracks apart.

#### Zoom and the preview

A change of the scale makes the browser lay out every text again and draw every shape again. On the App model that costs 15 to 25 ms for each wheel event.
So the page does not draw each step of a zoom. It keeps two views: the asked view, which is what the reader wants, and the drawn view, which is what the SVG holds.

- While the scale changes, the page draws the SVG at most once in 120 ms (`DRAW_MS` in `page/src/view.js`), and once more when the scale rests.
- Between two draws the page shows a preview: it scales and moves the drawn picture with a CSS transform on the canvas, which needs no layout and no drawing.
  The text of a preview is a little soft. On a zoom out, the edge of the stage is empty until the next draw.
- A pan keeps the scale, so it draws at once.
- While the scale changes, a level switch has no fade. A fade of every text draws the whole diagram on each frame.
- A box that takes the focus from the keyboard comes into view. A mouse press also gives the focus, but it starts a drag, so it does not move the view.

### Build

```sh
cd tools/drawio-clases/page
npm ci --ignore-scripts
node build.mjs <out>/hexablock-api.model.json <out>/hexablock-app.model.json --out <site>
```

The build writes a static site into `<site>`:

| File | Content |
|---|---|
| `index.html` | the page, as a full HTML document |
| `<repo>.model.json` | the model, byte for byte as `merge.mjs` wrote it |
| `<repo>.positions.json` | the box, frame, band and line positions of both densities, and the label rooms |

In the positions file, each line has the edge index `i`, its kind `k`, its points `p` and its label point `lb`. A line between two zones has `zx: 1`.
Each folder frame and each zone frame has its label room `lb` as `[x, y, w, h]`. A zone frame has `zone: 1` and the ids of its boxes in `ids`.
Each band has the label room `lb` of its band label as `[x, y, w, h]`, at the top left corner of the band.

The page loads the two data files of a repository with a relative `fetch`.
The repository switch has one button per model, in the order of the arguments, and the first model opens by default.
The link key of a repository is its name without the `hexablock-` prefix, for example `app` in `#app-GameEngine`.
`--artifact` writes the page as `diagrama-clases-hexablock.html` instead: the same page as a fragment with no doctype, `html`, `head` or `body` tag, for a claude.ai artifact. The data files stay the same.
A wrong argument or a model that does not have the shape of `MODEL.md` gives one `error:` line, writes no file and ends with exit code 1.
The build needs no browser, and the same models always give the same bytes.

### View the site

`fetch` does not read `file://` addresses, so serve the site over HTTP:

```sh
cd <site>
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000/`.

### Published site

The workflow `.github/workflows/class-diagram-site.yml` publishes the page to GitHub Pages at <https://hexablock-suite.github.io/.github/>.
It clones `hexablock-api` and `hexablock-app` at their `main`, runs `merge.mjs` on each one, builds the page and deploys it.
No product repository commits its model, so the site always shows the code of `main` at the time of the build.

| Start | When |
|---|---|
| push | a push to `main` of this repository that touches the tool or the workflow |
| schedule | every six hours |
| «Run workflow» | by hand, in the Actions tab or with `gh workflow run class-diagram-site.yml` |

A push to a product repository cannot start a workflow of this repository. After a product merge, the site is up to date at the next scheduled run, or at once with «Run workflow».
A violation in a product model stops the build, and the site keeps its last good version.
The Pages source of this repository must be «GitHub Actions» (Settings > Pages).

### Glyph table

The width of a box depends on the width of the class name in IBM Plex Sans 600 at 12 px.
`page/glyphs.json` holds the width of each printable ASCII glyph and the kerning of each glyph pair, upright and italic, as Chromium measures them.
The build adds these widths, so it gives the same box widths as the browser.
A character outside the table counts as the widest glyph.

Run `node glyphs.mjs` in `page/` when the page changes the font, the weight or the size of the class names, or when a name uses a character outside printable ASCII.
The script needs a local Chromium (`CHROME_BIN`, the Playwright browsers or the `PATH`) and network access to Google Fonts.
Commit the new `glyphs.json` with the change that needs it.

### Check the geometry

```sh
node geom.mjs <site>/hexablock-app.model.json <site>/hexablock-app.positions.json
```

`geom.mjs` prints, for each density, the count of boxes, frames and lines, the boxes that overlap, the lines that cross a box that they do not join, and the line ends off their box.
It also prints the pairs of close parallel lines (12 units apart or less, side by side for more than 200 units), and the label rooms that cover a box or another label room.
The tests of `page/test/` run the same checks on the fixture models: no box overlap, no line across a foreign box, no label room over a box or a label, and an `aggregation` edge in the positions with its kind.
