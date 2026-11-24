(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const cv = $('#cv'), vp = $('#vp'), stage = $('#stage'), panel = $('#panel'), app = $('#app');
  const LAYER = { 1: 'Entities', 2: 'Use cases', 3: 'Interface adapters', 4: 'Frameworks and drivers' };
  const KIND = { class: 'class', interface: 'interface', type: 'type alias', union: 'union', const: 'constant', enum: 'enumeration' };
  // Zoom levels. Far shows zones, middle shows names, near shows members and labels.
  // The values come from screenshots: at 0.44 a boosted name reads at about 8px.
  const LOD1 = 0.44, LOD2 = 0.9;
  const BAND_TOP = 168; // Top padding of a band in positions.json.
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrow = () => matchMedia('(max-width: 720px)').matches;

  // esc makes a model string safe inside HTML and SVG text or attributes.
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Each repository has one model file and one positions file next to the page.
  // The build writes one switch button per repository, with its key and its file name.
  // The key of a repository is also its hash prefix and the stored choice.
  const REPOS = Object.fromEntries([...document.querySelectorAll('#repo button')].map((b) => [b.dataset.r, b.dataset.file]));
  const FIRST = Object.keys(REPOS)[0];
  const STORE = 'diagrama-clases.repo';
  // The class views of each repository live in this folder, as PNG and HTML files.
  const VIEW_DIR = 'docs/architecture/classes/views/';
  let repo = null;
  let model, positions, byId, outE, inE;
  let density = 'compact', P = null;
  let k = 1, tx = 0, ty = 0;
  let sel = null, hl = null;
  let boxEl = new Map(), lineEl = new Map(), titles = [], zones = [], bandTags = [], stLines = [];

  // edgeKind sorts an edge into structure, attribute use or other use. isAttr comes from box-text.js.
  const edgeKind = (e) => (e.kind === 'use' ? (isAttr(e) ? 'a' : 'o') : 's');
  const isWhole = (e) => e.kind === 'composition' || e.kind === 'aggregation';
  // zoneOf gives the zone of a type, as the layout groups it: its source folder, or the planned zone of its part.
  let partTitle = new Map();
  const zoneOf = (t) => folderOf(t, partTitle);
  // ghUrl gives the GitHub address of one file of the loaded repository at the model commit.
  const ghUrl = (path, line) => 'https://github.com/Hexablock-Suite/' + encodeURIComponent(model.repo) + '/blob/' + encodeURIComponent(model.head) + '/' +
    path.split('/').map(encodeURIComponent).join('/') + (line ? '#L' + line : '');
  const typesText = (n) => n + (n === 1 ? ' type' : ' types');

  // A canvas measures label text once the web fonts are ready.
  const meter = document.createElement('canvas').getContext('2d');
  const textW = (font, s) => { meter.font = font; return meter.measureText(s).width; };

  // ---------- geometry helpers ----------
  const rectOf = (id) => { const b = P.boxes[id]; return { x: b[0], y: b[1], w: b[2], h: b[3] }; };

  // roundPath draws an orthogonal route with rounded corners.
  function roundPath(pts, r = 10) {
    let d = 'M' + pts[0][0] + ' ' + pts[0][1];
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i - 1], [cx, cy] = pts[i], [bx, by] = pts[i + 1];
      const la = Math.hypot(cx - ax, cy - ay), lb = Math.hypot(bx - cx, by - cy);
      const rr = Math.min(r, la / 2, lb / 2);
      if (rr < 0.5) { d += 'L' + cx + ' ' + cy; continue; }
      const p1 = [cx - (cx - ax) / la * rr, cy - (cy - ay) / la * rr];
      const p2 = [cx + (bx - cx) / lb * rr, cy + (by - cy) / lb * rr];
      d += 'L' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) + 'Q' + cx + ' ' + cy + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    const z = pts[pts.length - 1];
    return d + 'L' + z[0] + ' ' + z[1];
  }

  // headOf draws the arrow end. A triangle also shortens the line to its base.
  function headOf(p, q, tri) {
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
    const L = tri ? 13 : 9, W = tri ? 6.5 : 4.5;
    const bx = q[0] - ux * L, by = q[1] - uy * L;
    const f = (x, y) => x.toFixed(1) + ' ' + y.toFixed(1);
    if (tri) return { d: 'M' + f(q[0], q[1]) + 'L' + f(bx + nx * W, by + ny * W) + 'L' + f(bx - nx * W, by - ny * W) + 'Z', end: [bx, by] };
    return { d: 'M' + f(bx + nx * W, by + ny * W) + 'L' + f(q[0], q[1]) + 'L' + f(bx - nx * W, by - ny * W), end: q };
  }

  // diamondOf draws the diamond of a composition at the box point p. The line starts at its far tip.
  function diamondOf(p, q) {
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l, nx = -uy, ny = ux, L = 16, W = 5.5;
    const f = (x, y) => x.toFixed(1) + ' ' + y.toFixed(1);
    const mx = p[0] + ux * L / 2, my = p[1] + uy * L / 2, ex = p[0] + ux * L, ey = p[1] + uy * L;
    return { d: 'M' + f(p[0], p[1]) + 'L' + f(mx + nx * W, my + ny * W) + 'L' + f(ex, ey) + 'L' + f(mx - nx * W, my - ny * W) + 'Z', start: [ex, ey] };
  }

  // ---------- render ----------
  function boxSVG(t, r) {
    const m = boxModel(t, density, 0);
    const cls = 'box L' + t.layer + (t.status === 'planned' ? ' planned' : '') + (t.abstract ? ' abs' : '');
    const label = t.name + (m.st ? ', ' + m.st : '') + ', layer ' + t.layer;
    // The caps limit how much a name or a stereotype may grow at the middle level.
    const nameW = textW((t.abstract ? 'italic ' : '') + "600 12px 'IBM Plex Sans'", t.name);
    const stW = m.st ? textW("8px 'IBM Plex Mono'", m.st) + m.st.length * 0.64 : 1;
    const capN = Math.max(1, Math.min(1.5, (r.w - 14) / nameW)).toFixed(2);
    const capS = Math.max(1, Math.min(1.9, (r.w - 14) / stW)).toFixed(2);
    let s = '<g class="' + cls + '" data-id="' + esc(t.id) + '" tabindex="0" role="button" aria-label="' + esc(label) + '" transform="translate(' + r.x + ' ' + r.y + ')">';
    s += '<rect class="bx" width="' + r.w + '" height="' + r.h + '" rx="6"/>';
    s += '<rect class="ring" x="-4" y="-4" width="' + (r.w + 8) + '" height="' + (r.h + 8) + '" rx="9"/>';
    s += '<g class="tx">';
    if (m.st) s += '<text class="t-st" x="' + r.w / 2 + '" y="' + m.stY + '" style="--cs:' + capS + '">' + esc(m.st) + '</text>';
    s += '<text class="t-nm" x="' + r.w / 2 + '" y="' + m.nameY + '" style="--c:' + capN + '">' + esc(t.name) + '</text>';
    if (m.rq) s += '<text class="t-rq" x="' + r.w / 2 + '" y="' + m.rqY + '">' + esc(m.rq) + '</text>';
    s += '</g>';
    if (m.sections.length) {
      s += '<g class="mem">';
      for (const sec of m.sections) {
        s += '<line class="rule" x1="0" x2="' + r.w + '" y1="' + sec.top + '" y2="' + sec.top + '"/>';
        for (const row of sec.rows) {
          s += '<text class="t-m' + (row.under ? ' u' : '') + (row.ital ? ' i' : '') + '" x="' + row.x + '" y="' + row.y + '">' + esc(row.text) + '</text>';
        }
      }
      s += '</g>';
    }
    if (m.tp) {
      s += '<rect class="tp" x="' + (r.w - m.tpW + 8) + '" y="-9" width="' + m.tpW + '" height="16" rx="2"/>';
      s += '<text class="t-tp" x="' + (r.w - m.tpW + 14) + '" y="2.5">' + esc(m.tp) + '</text>';
    }
    return s + '</g>';
  }

  // zoneSummary names the two most frequent stereotypes of a zone.
  function zoneSummary(types) {
    const c = new Map();
    for (const t of types) for (const s of stereotypesOf(t)) c.set(s, (c.get(s) || 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([s, n]) => n + ' «' + s + '»');
  }

  function render() {
    P = positions[density];
    boxEl = new Map(); lineEl = new Map(); titles = []; zones = [];
    let bands = '', frames = '', tl = '', tags = '';
    for (const b of P.bands) {
      bands += '<g class="L' + b.layer + '"><rect class="band-r" x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="10"/></g>';
      tags += '<span class="tag L' + b.layer + '">Layer ' + b.layer + ' · ' + esc(LAYER[b.layer]) + '</span>';
    }
    const typesOf = new Map();
    for (const t of model.types) {
      const key = t.layer + '|' + zoneOf(t);
      if (!typesOf.has(key)) typesOf.set(key, []);
      typesOf.get(key).push(t);
    }
    // A frame title hangs from the top of its frame. Its top padding limits how much it may grow.
    // A folder frame and a zone frame also carry a far label, which lives in the label room `lb` of the frame.
    const zl = '<g class="zl" aria-hidden="true"><rect class="zl-p" rx="6"/><text class="zl-n"></text><text class="zl-c"></text></g>';
    P.frames.forEach((f, fi) => {
      frames += '<rect class="L' + f.layer + ' ' + (f.kind === 'g' ? 'fr-g' : 'fr-v') + '" data-f="' + fi + '" x="' + f.x + '" y="' + f.y + '" width="' + f.w + '" height="' + f.h + '" rx="' + (f.kind === 'g' ? 8 : 6) + '"/>';
      const fs = f.kind === 'g' ? 10 : 9;
      const ttl = { kind: f.kind, x: f.x + 16, y: f.y + 14, fs, text: f.title, room: f.w - 28, cap: ((f.kind === 'g' ? 84 : 44) - 22) / fs };
      ttl.tw = ttl.text.length * fs * 0.68;
      titles.push(ttl);
      // A tinted plate behind the title keeps lines from striking through it.
      const plate = '<g class="ttl ttl-' + f.kind + '"' + (f.kind === 'v' ? ' aria-hidden="true"' : '') + '><rect x="-5" y="-3" width="' + (ttl.tw + 10).toFixed(1) + '" height="' + (fs + 6) + '" rx="2"/><text y="' + (fs * 0.78).toFixed(1) + '">' + esc(f.title) + '</text></g>';
      if (f.kind === 'v' && !f.zone) { tl += '<g class="L' + f.layer + '">' + plate + '</g>'; return; }
      // A zone of a large folder shows its view name far away. A click on it zooms like a click on its frame.
      const types = f.kind === 'v' ? f.ids.map((id) => byId.get(id)).filter(Boolean) : typesOf.get(f.layer + '|' + f.title) || [];
      const z = { f, fi, types, name: zoneName(f.title), n: types.length, summary: zoneSummary(types) };
      zones.push(z);
      if (f.kind === 'v') { tl += '<g class="zone zv L' + f.layer + '" data-f="' + fi + '" aria-hidden="true">' + plate + zl + '</g>'; return; }
      // A folder is one button: its title at reading zoom and its zone label far away.
      tl += '<g class="fold L' + f.layer + '" data-f="' + fi + '" tabindex="0" role="button" aria-label="' + esc(f.title + ', ' + typesText(z.n) + '. Zoom to the folder.') + '">' + plate + zl + '</g>';
    });
    $('#tags').innerHTML = tags;
    bandTags = [...document.querySelectorAll('#tags .tag')].map((el, i) => ({ el, b: P.bands[i], h: el.offsetHeight, w: el.offsetWidth }));
    let lines = '';
    // A ghost line joins two zones, or two folders. At the middle level it is background texture, not a line to follow.
    const folderKey = (id) => { const t = byId.get(id); return t.layer + '|' + zoneOf(t); };
    ghostCount = 0;
    for (const ln of P.lines) {
      const e = model.edges[ln.i];
      const kk = edgeKind(e);
      const pts = ln.p.map((q) => q.slice());
      let h;
      if (isWhole(e)) {
        // A composition draws its diamond at the whole, which is the start of the line.
        h = diamondOf(pts[0], pts[1]);
        pts[0] = [+h.start[0].toFixed(1), +h.start[1].toFixed(1)];
      } else {
        h = headOf(pts[pts.length - 2], pts[pts.length - 1], kk === 's');
        pts[pts.length - 1] = [+h.end[0].toFixed(1), +h.end[1].toFixed(1)];
      }
      // A dashed line starts its dashes at the target, so lines that share a trunk keep one dash rhythm.
      const d = e.kind === 'implements' ? roundPath(pts.slice().reverse()) : roundPath(pts);
      const ghost = !!ln.zx || folderKey(e.from) !== folderKey(e.to);
      if (ghost) ghostCount++;
      const extra = (e.kind === 'implements' ? ' impl' : e.kind === 'composition' ? ' comp' : e.kind === 'aggregation' ? ' agg' : '') + (ln.zx ? ' zx' : '') + (ghost ? ' gh' : '');
      lines += '<g class="e ' + kk + extra + '" data-i="' + ln.i + '"><path class="ln" d="' + d + '"/><path class="hd" d="' + h.d + '"/></g>';
    }
    // A summary line stands for the lines between two zones on the far map. Its badge gives their count.
    let sums = '';
    sumBadges = P.sums || [];
    for (const sm of P.sums || []) {
      const a = P.frames[sm.a], b = P.frames[sm.b];
      const say = sm.n + (sm.n === 1 ? ' line' : ' lines') + ' between ' + zoneName(a.title) + ' and ' + zoneName(b.title);
      sums += '<g class="sum L' + a.layer + '"><title>' + esc(say) + '</title><path class="ln" d="' + roundPath(sm.p, 14) + '"/>' +
        '<g class="sc"><rect x="' + (-badgeW(sm.n) / 2).toFixed(1) + '" y="-9" width="' + badgeW(sm.n).toFixed(1) + '" height="18" rx="9"/><text y="4.2">' + sm.n + '</text></g></g>';
    }
    // Boxes go in reading order, so Tab follows bands, then rows, then columns.
    const order = model.types.filter((t) => P.boxes[t.id]).sort((a, b) => {
      const ra = rectOf(a.id), rb = rectOf(b.id);
      return b.layer - a.layer || Math.floor(ra.y / 80) - Math.floor(rb.y / 80) || ra.x - rb.x;
    });
    let boxes = '';
    for (const t of order) boxes += boxSVG(t, rectOf(t.id));
    $('#bands').innerHTML = bands;
    $('#frames').innerHTML = frames;
    $('#lines').innerHTML = lines;
    $('#sums').innerHTML = sums;
    sumEls = [...document.querySelectorAll('#sums .sc')];
    lastBadgeK = -1;
    // The legend shows the ghost line only when the model has one.
    app.classList.toggle('has-ghosts', ghostCount > 0);
    $('#boxes').innerHTML = boxes;
    $('#titles').innerHTML = tl;
    $('#others').innerHTML = '';
    $('#labels').innerHTML = '';
    cv.classList.toggle('dense', P.lines.filter((l) => edgeKind(model.edges[l.i]) === 's').length > 60);
    document.querySelectorAll('#boxes .box').forEach((g) => boxEl.set(g.dataset.id, g));
    document.querySelectorAll('#lines .e').forEach((g) => lineEl.set(+g.dataset.i, g));
    stLines = [...document.querySelectorAll('#boxes .t-st')].map((el) => ({ el, cs: Math.min(1.9, parseFloat(el.style.getPropertyValue('--cs')) || 1), tiny: false }));
    lastBoost = '';
    const tg = document.querySelectorAll('#titles .ttl');
    titles.forEach((t, i) => { t.el = tg[i]; });
    const zg = document.querySelectorAll('#titles .zl');
    zones.forEach((z, i) => { z.el = zg[i]; });
    applyHighlight();
    lastScale = -1;
  }

  // ---------- zone labels ----------
  // fillZones writes the count line of each zone and measures both label forms.
  // The long form adds the main stereotypes. With a highlight, it counts the lit types.
  const NAME_FONT = "600 15px 'IBM Plex Sans'", COUNT_FONT = "12.5px 'IBM Plex Sans'";
  function fillZones() {
    for (const z of zones) {
      const lit = hl ? z.types.filter((t) => hl.ids.has(t.id)).length : 0;
      // A zone with no lit type shows its name only, so the lit zones stand out.
      z.short = hl ? (lit ? lit + ' of ' + z.n : '') : typesText(z.n);
      z.long = hl ? (lit ? z.short + ' highlighted' : '') : [typesText(z.n), ...z.summary].join(' · ');
      z.nameW = textW(NAME_FONT, z.name);
      z.shortW = textW(COUNT_FONT, z.short);
      z.longW = textW(COUNT_FONT, z.long);
      z.el.classList.toggle('dim', !!hl && lit === 0);
      z.el.children[1].textContent = z.name;
      z.form = '';
    }
    lastScale = -1;
    if (!titleFrame) titleFrame = requestAnimationFrame(updateTitles);
  }

  // layoutZones fits each zone label into the label room of its frame, at the far level.
  // The layout reserves that room at the top of the frame, so a label never covers a box or another label.
  // A label keeps a constant size on screen while the room holds it. It shrinks to fit the room, down to LABEL_MIN.
  // It tries the forms in order: the long count on one line, on two lines, the short count, then the name only.
  // A room too small for the name at LABEL_MIN hides the label.
  // A band label can cover the left end of a room. Then the label moves right, past the band label, inside its room.
  // LABEL_GOOD is a little below the scale that the layout reserves for the fit zoom (0.8), so the long form shows there.
  const LABEL_GOOD = 0.75, LABEL_MIN = 0.6;
  function layoutZones() {
    const tags = bandTags.filter((t) => !t.el.hidden && t.box).map((t) => t.box);
    for (const z of zones) {
      const [lx, ly, lw, lh] = z.f.lb;
      const top = ly * k + ty, rh = lh * k, right = (lx + lw) * k + tx;
      // The label starts at the left end of its room, or just past a band label that overlaps the room.
      let x0 = lx * k + tx;
      for (const p of tags) if (p[1] < top + rh + 4 && top < p[3] + 4 && p[0] < right && x0 < p[2] + 4) x0 = Math.max(x0, p[2] + 8);
      const rw = right - x0;
      const one = (cnt, cw) => ({ two: false, cnt, cw, W: z.nameW + (cnt ? 10 + cw : 0) + 20, H: 26 });
      const two = (cnt, cw) => ({ two: true, cnt, cw, W: Math.max(z.nameW, cw) + 20, H: 42 });
      const forms = [one(z.long, z.longW), two(z.long, z.longW), one(z.short, z.shortW), two(z.short, z.shortW), one('', 0)].filter((f) => f.cnt || !f.two);
      const fit = (f) => Math.min(1, rw / f.W, rh / f.H);
      let form = rw > 0 ? forms.find((f) => fit(f) >= LABEL_GOOD) : null;
      if (!form && rw > 0 && fit(forms[forms.length - 1]) >= LABEL_MIN) form = forms[forms.length - 1];
      z.el.classList.toggle('off', !form);
      if (!form) continue;
      const s = fit(form);
      const y0 = top + (rh - form.H * s) / 2;
      const key = (form.two ? '2' : '1') + form.cnt;
      if (key !== z.form) {
        z.form = key;
        const [p, n, c] = z.el.children;
        p.setAttribute('x', 0); p.setAttribute('y', 0); p.setAttribute('width', form.W); p.setAttribute('height', form.H);
        if (form.two) {
          n.setAttribute('x', (form.W - z.nameW) / 2); n.setAttribute('y', 20);
          c.setAttribute('x', (form.W - form.cw) / 2); c.setAttribute('y', 34);
        } else {
          n.setAttribute('x', 10); n.setAttribute('y', 18);
          c.setAttribute('x', 20 + z.nameW); c.setAttribute('y', 17.5);
        }
        c.textContent = form.cnt;
      }
      z.el.setAttribute('transform', 'translate(' + ((x0 - tx) / k).toFixed(1) + ' ' + ((y0 - ty) / k).toFixed(1) + ') scale(' + (s / k).toFixed(4) + ')');
    }
  }

  // layoutBadges puts the count badge of each summary line on its route, at a constant size on screen.
  // A badge tries the middle of its longest run first, then other points of its runs, longest run first.
  // It takes the first point where it touches no box and no badge placed before it.
  // When no point is free, it keeps the middle of its longest run.
  const BADGE_TRIES = [0.5, 0.3, 0.7, 0.15, 0.85];
  function layoutBadges() {
    const sc = 'scale(' + (1 / k).toFixed(4) + ')';
    const placed = [];
    const boxes = Object.values(P.boxes);
    const clear = (r) => !boxes.some((b) => r[0] < b[0] + b[2] && b[0] < r[2] && r[1] < b[1] + b[3] && b[1] < r[3]) &&
      !placed.some((q) => r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3]);
    sumBadges.forEach((sm, i) => {
      const hw = (badgeW(sm.n) / 2 + 3) / k, hh = 12 / k;
      const runs = sm.p.slice(1).map((q, j) => [sm.p[j], q]).sort((a, b) => (Math.abs(b[1][0] - b[0][0]) + Math.abs(b[1][1] - b[0][1])) - (Math.abs(a[1][0] - a[0][0]) + Math.abs(a[1][1] - a[0][1])));
      let at = sm.c;
      search: for (const [a, b] of runs) for (const f of BADGE_TRIES) {
        const c = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        if (clear([c[0] - hw, c[1] - hh, c[0] + hw, c[1] + hh])) { at = c; break search; }
      }
      placed.push([at[0] - hw, at[1] - hh, at[0] + hw, at[1] + hh]);
      sumEls[i].setAttribute('transform', 'translate(' + at[0].toFixed(1) + ' ' + at[1].toFixed(1) + ') ' + sc);
    });
  }

  // ---------- view transform ----------
  let lastScale = -1, titleFrame = 0, lastBoost = '';
  let sumEls = [], sumBadges = [], ghostCount = 0, lastBadgeK = -1;
  // badgeW gives the width of the count badge of a summary line.
  const badgeW = (n) => String(n).length * 7.4 + 14;
  function apply() {
    vp.setAttribute('transform', 'translate(' + tx.toFixed(2) + ' ' + ty.toFixed(2) + ') scale(' + k.toFixed(5) + ')');
    const lod = k < LOD1 ? 'lod0' : k < LOD2 ? 'lod1' : 'lod2';
    if (!cv.classList.contains(lod)) { cv.classList.remove('lod0', 'lod1', 'lod2'); cv.classList.add(lod); app.dataset.lod = lod; }
    // The middle level grows names toward 8.5px on screen. The value changes in steps, so style work stays rare.
    if (lod === 'lod1') {
      const nb = Math.min(1.5, Math.max(1, 8.5 / (12 * k))).toFixed(2), sb = Math.min(1.9, Math.max(1, 7 / (8 * k))).toFixed(2);
      if (nb + sb !== lastBoost) {
        lastBoost = nb + sb;
        cv.style.setProperty('--nb', nb); cv.style.setProperty('--sb', sb);
        // A class changes only when its state flips, so a zoom step writes little.
        for (const x of stLines) {
          const tiny = 8 * Math.min(+sb, x.cs) * k < 6;
          if (tiny !== x.tiny) { x.tiny = tiny; x.el.classList.toggle('tiny', tiny); }
        }
      }
    }
    if (!titleFrame) titleFrame = requestAnimationFrame(updateTitles);
    placeTags();
  }

  // placeTags puts each band label in the top padding of its band.
  // On the far map, a label also sticks to the top left of the visible part of its band.
  // At reading zoom it scrolls with the band, so it never covers a box.
  function placeTags() {
    const vh = stage.clientHeight, map = k < LOD1;
    for (const t of bandTags) {
      const top = t.b.y * k + ty, bottom = (t.b.y + t.b.h) * k + ty;
      const x0 = t.b.x * k + tx + 16;
      const left = map ? Math.max(x0, 12) : x0;
      const y0 = top + Math.max(4, (BAND_TOP * k - t.h) / 2);
      const y = Math.min(map ? Math.max(y0, 10) : y0, bottom - t.h - 10);
      const show = bottom - top > t.h + 16 && bottom > 0 && top < vh && y + t.h > 0;
      t.el.hidden = !show;
      if (show) t.el.style.transform = 'translate(' + left.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      t.box = show ? [left, y, left + t.w, y + t.h] : null;
    }
  }

  // updateTitles keeps frame titles readable at every zoom.
  // A title grows as the canvas shrinks. It hides when it no longer fits its frame.
  // Zone labels follow the pan as well, so they run on every far frame.
  let lastTx = NaN, lastTy = NaN;
  function updateTitles() {
    titleFrame = 0;
    const far = k < LOD1;
    if (far && (lastTx !== tx || lastTy !== ty || Math.abs(lastScale - k) > 1e-4)) { lastTx = tx; lastTy = ty; layoutZones(); }
    // The summary lines show at the far and middle levels. Their badges depend on the zoom only.
    if (k < LOD2 && Math.abs(lastBadgeK - k) > 1e-4) { lastBadgeK = k; layoutBadges(); }
    if (Math.abs(lastScale - k) < 1e-4) return;
    lastScale = k;
    const target = { g: 11.5, v: 10.5 };
    for (const t of titles) {
      const s = Math.min(t.cap, Math.max(1, target[t.kind] / (t.fs * k)));
      // A title shows only when it reads at 8px or more and fits its frame.
      const fits = t.fs * s * k >= 8 && t.tw * s <= t.room;
      t.el.classList.toggle('off', !fits);
      if (fits) t.el.setAttribute('transform', 'translate(' + t.x + ' ' + t.y + ') scale(' + s.toFixed(3) + ')');
    }
  }

  // view gives the part of the stage that the panel does not cover.
  function view() {
    const r = stage.getBoundingClientRect();
    let w = r.width, h = r.height;
    if (!panel.hidden) {
      const pr = panel.getBoundingClientRect();
      if (pr.width < r.width - 2) w -= pr.width; else h -= pr.height;
    }
    return { w, h, rw: r.width, rh: r.height };
  }

  let anim = 0;
  function moveTo(nk, ntx, nty, animate = true, D = 260) {
    cancelAnimationFrame(anim);
    if (!animate || reduce) { k = nk; tx = ntx; ty = nty; apply(); return; }
    const k0 = k, x0 = tx, y0 = ty, t0 = performance.now();
    const step = (now) => {
      const u = Math.min(1, (now - t0) / D), e = u < 1 ? 1 - Math.pow(1 - u, 3) : 1;
      k = Math.exp(Math.log(k0) + (Math.log(nk) - Math.log(k0)) * e);
      tx = x0 + (ntx - x0) * e; ty = y0 + (nty - y0) * e;
      apply();
      if (u < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  const clampK = (v) => Math.min(3, Math.max(0.03, v));
  function fit(animate = true) {
    const v = view(), m = 20;
    const nk = clampK(Math.min((v.w - 2 * m) / P.w, (v.h - 2 * m) / P.h));
    moveTo(nk, (v.w - P.w * nk) / 2, (v.h - P.h * nk) / 2, animate, 360);
  }
  // fitK gives the zoom that shows one rectangle whole, with a margin.
  // A folder zoom never stays at the far level, so the names always show. A large folder on a phone fills the screen from its middle.
  function fitK(r) {
    const v = view(), m = narrow() ? 12 : 40;
    return Math.max(LOD1 + 0.06, Math.min(1.25, clampK(Math.min((v.w - 2 * m) / r.w, (v.h - 2 * m) / r.h))));
  }
  function zoomToFrame(fi) {
    const f = P.frames[fi], v = view(), nk = fitK(f);
    moveTo(nk, v.w / 2 - (f.x + f.w / 2) * nk, v.h / 2 - (f.y + f.h / 2) * nk, true, 380);
    $('#status').textContent = 'Folder ' + f.title + ' zoomed in.';
  }
  // folderOfFrame gives the folder frame that holds a view frame.
  function folderOfFrame(fi) {
    const f = P.frames[fi];
    if (f.kind === 'g') return fi;
    return P.frames.findIndex((g) => g.kind === 'g' && g.x <= f.x && g.y <= f.y && g.x + g.w >= f.x + f.w && g.y + g.h >= f.y + f.h);
  }
  // frameClick zooms to the folder first. When the folder already fills the view, it zooms to the view frame.
  function frameClick(fi) {
    const g = folderOfFrame(fi);
    if (g >= 0 && fitK(P.frames[g]) > k * 1.12) zoomToFrame(g);
    else if (fi !== g && fitK(P.frames[fi]) > k * 1.12) zoomToFrame(fi);
  }
  function zoomAt(px, py, f) {
    const nk = clampK(k * f);
    tx = px - (px - tx) * (nk / k); ty = py - (py - ty) * (nk / k); k = nk;
    apply();
  }
  function centerOn(id, minK = 0.9, animate = true) {
    const r = rectOf(id), v = view();
    const nk = clampK(Math.max(k, minK));
    moveTo(nk, v.w / 2 - (r.x + r.w / 2) * nk, v.h / 2 - (r.y + r.h / 2) * nk, animate, 320);
  }
  function ensureVisible(id) {
    const r = rectOf(id), v = view();
    const x0 = r.x * k + tx, y0 = r.y * k + ty, x1 = x0 + r.w * k, y1 = y0 + r.h * k;
    if (x0 < 8 || y0 < 8 || x1 > v.w - 8 || y1 > v.h - 8 || k < LOD1) centerOn(id, Math.max(k, LOD2));
  }

  // ---------- choice ----------
  // relations lists the related types of one type, in both directions.
  function relations(id) {
    const deps = [], dpts = [];
    for (const i of outE.get(id) || []) deps.push({ e: model.edges[i], i, other: model.edges[i].to });
    for (const i of inE.get(id) || []) dpts.push({ e: model.edges[i], i, other: model.edges[i].from });
    return { deps, dpts };
  }
  const visibleKind = (kk) => !cv.classList.contains('hide-' + kk);

  function clearMarks() {
    document.querySelectorAll('#boxes .on').forEach((g) => { g.classList.remove('on', 'sel'); g.removeAttribute('aria-pressed'); });
    document.querySelectorAll('#boxes .tab').forEach((g) => g.remove());
    document.querySelectorAll('#lines .on').forEach((g) => g.classList.remove('on'));
    $('#others').innerHTML = '';
    $('#labels').innerHTML = '';
    for (const g of boxEl.values()) g.setAttribute('aria-label', g.getAttribute('aria-label').replace(/\. (Depends on|Dependency of) .*$/, ''));
  }

  // tabSVG draws the plain word that marks the role of a neighbor. It is not a stereotype, so it has no guillemets.
  // The tab sits on the top edge. When the template box would cover it, the tab moves to the bottom edge.
  function tabSVG(cls, text, t) {
    const tw = text.length * 8 * 0.68 + 12, r = rectOf(t.id), tp = tpText(t);
    const tpW = tp ? Math.ceil(tp.length * BOX.tpChar + 12) : 0;
    const y = tpW && r.w - tpW + 8 < 10 + tw + 6 ? r.h : 0;
    return '<g class="tab ' + cls + '" aria-hidden="true"><rect x="10" y="' + (y - 8) + '" width="' + tw.toFixed(1) + '" height="15" rx="3"/><text x="' + (10 + tw / 2).toFixed(1) + '" y="' + (y + 2.6) + '">' + text + '</text></g>';
  }

  function labelSVG(x, y, text, cls = '') {
    const w = text.length * 5.4 + 8;
    return '<g class="lb ' + cls + '"><rect x="' + (x - 4).toFixed(1) + '" y="' + (y - 9).toFixed(1) + '" width="' + w.toFixed(1) + '" height="13" rx="2"/><text x="' + x.toFixed(1) + '" y="' + (y + 0.5).toFixed(1) + '">' + esc(text) + '</text></g>';
  }

  const NORMAL = { t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0] };
  // sideOf names the side of a box that a border point lies on.
  function sideOf(r, p) {
    if (Math.abs(p[1] - r.y) < 0.6) return 't';
    if (Math.abs(p[1] - r.y - r.h) < 0.6) return 'b';
    return p[0] <= r.x + r.w / 2 ? 'l' : 'r';
  }
  // borderPoint gives the point where the line to (px, py) leaves the box.
  function borderPoint(r, px, py) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = px - cx, dy = py - cy;
    const s = Math.min(Math.abs(dx) > 1e-6 ? r.w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? r.h / 2 / Math.abs(dy) : Infinity);
    return [cx + dx * s, cy + dy * s];
  }

  // routedPorts lists where the visible routed lines touch each side of a box.
  function routedPorts(id) {
    const r = rectOf(id), out = { t: [], b: [], l: [], r: [] };
    for (const ln of P.lines) {
      const e = model.edges[ln.i];
      if (!visibleKind(edgeKind(e))) continue;
      const ends = [];
      if (e.from === id) ends.push(ln.p[0]);
      if (e.to === id) ends.push(ln.p[ln.p.length - 1]);
      for (const p of ends) { const s = sideOf(r, p); out[s].push(s === 't' || s === 'b' ? p[0] : p[1]); }
    }
    return out;
  }

  // spreadAnchors gives each other-use curve a point on the border of the chosen box.
  // Points keep the order of the far ends and stay clear of the routed lines.
  // Incoming curves of one side share one point and one arrowhead, as a shared target in UML.
  // When a side is full, outgoing neighbors in order share one point too.
  function spreadAnchors(id, otherIds, incoming) {
    const r = rectOf(id), taken = routedPorts(id);
    const sides = { t: [], b: [], l: [], r: [] };
    for (const o of new Set(otherIds)) {
      const q = rectOf(o), ox = q.x + q.w / 2, oy = q.y + q.h / 2;
      const side = sideOf(r, borderPoint(r, ox, oy));
      sides[side].push({ o, key: side === 't' || side === 'b' ? ox : oy });
    }
    const out = new Map();
    for (const [side, list] of Object.entries(sides)) {
      if (!list.length) continue;
      list.sort((a, b) => a.key - b.key);
      const horiz = side === 't' || side === 'b', base = horiz ? r.x : r.y, len = horiz ? r.w : r.h;
      let cand = [];
      for (let u = 10; u <= len - 10; u += 10) if (taken[side].every((v) => Math.abs(base + u - v) >= 12)) cand.push(base + u);
      if (!cand.length) cand = [base + len / 2];
      const m = incoming ? 1 : Math.min(list.length, cand.length);
      const picks = m === 1 ? [cand[Math.floor(cand.length / 2)]] : Array.from({ length: m }, (_, j) => cand[Math.round(j * (cand.length - 1) / (m - 1))]);
      list.forEach((it, j) => {
        const p = picks[Math.floor(j * m / list.length)];
        const pt = horiz ? [p, side === 't' ? r.y : r.y + r.h] : [side === 'l' ? r.x : r.x + r.w, p];
        out.set(it.o, { pt, n: NORMAL[side] });
      });
    }
    return out;
  }

  function choose(id, opts = {}) {
    if (!byId.has(id) || !P.boxes[id]) return;
    sel = id;
    clearMarks();
    cv.classList.add('has-sel');
    const t = byId.get(id);
    const me = boxEl.get(id);
    me.classList.add('on', 'sel');
    me.setAttribute('aria-pressed', 'true');
    const { deps, dpts } = relations(id);
    const roles = new Map();
    let labels = '', curves = '', shownLines = 0;
    const routed = new Map(P.lines.map((l) => [l.i, l]));
    const others = [...deps.map((d) => ({ ...d, dir: 'dep' })), ...dpts.map((d) => ({ ...d, dir: 'dpt' }))];
    const otherCount = others.filter((d) => edgeKind(d.e) === 'o').length;
    const isO = (d) => edgeKind(d.e) === 'o' && d.other !== id;
    const anchors = new Map([...spreadAnchors(id, dpts.filter(isO).map((d) => d.other), true)].map(([o, a]) => ['dpt|' + o, a]));
    for (const [o, a] of spreadAnchors(id, deps.filter(isO).map((d) => d.other), false)) anchors.set('dep|' + o, a);
    for (const d of others) {
      const kk = edgeKind(d.e);
      if (!visibleKind(kk)) continue;
      if (kk !== 'o') {
        const g = lineEl.get(d.i);
        if (g) {
          g.classList.add('on');
          shownLines++;
          const l = routed.get(d.i);
          if (d.e.label && l.lb) labels += labelSVG(l.lb[0], l.lb[1], d.e.label);
        }
      } else if (d.other !== id) {
        // Other uses get a curve that leaves each box at a right angle, so the ends read apart.
        const mine = anchors.get(d.dir + '|' + d.other);
        const q = rectOf(d.other);
        const far = borderPoint(q, mine.pt[0], mine.pt[1]);
        const farN = NORMAL[sideOf(q, far)];
        const [pa, na, pb, nb] = d.dir === 'dep' ? [mine.pt, mine.n, far, farN] : [far, farN, mine.pt, mine.n];
        const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        const stub = Math.max(24, Math.min(140, len * 0.3));
        const c1 = [pa[0] + na[0] * stub, pa[1] + na[1] * stub], c2 = [pb[0] + nb[0] * stub, pb[1] + nb[1] * stub];
        const h = headOf(c2, pb, false);
        const f = (p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1);
        curves += '<g class="e o on"><path class="ln" d="M' + f(pa) + 'C' + f(c1) + ' ' + f(c2) + ' ' + f(pb) + '"/><path class="hd" d="' + h.d + '"/></g>';
        if (otherCount <= 14 && d.e.label) {
          const mid = [(pa[0] + 3 * c1[0] + 3 * c2[0] + pb[0]) / 8, (pa[1] + 3 * c1[1] + 3 * c2[1] + pb[1]) / 8];
          labels += labelSVG(mid[0] + 4, mid[1], d.e.label, 'o');
        }
        shownLines++;
      }
      const prev = roles.get(d.other);
      roles.set(d.other, prev && prev !== d.dir ? 'both' : d.dir);
    }
    for (const [oid, role] of roles) {
      const g = boxEl.get(oid);
      if (!g || oid === id) continue;
      g.classList.add('on');
      const text = role === 'dpt' ? 'dependent' : role === 'dep' ? 'dependency' : 'both';
      g.insertAdjacentHTML('beforeend', tabSVG(role, text, byId.get(oid)));
      const say = role === 'dpt' ? 'Depends on ' + t.name : role === 'dep' ? 'Dependency of ' + t.name : 'Depends on ' + t.name + ' and is its dependency';
      g.setAttribute('aria-label', g.getAttribute('aria-label') + '. ' + say);
    }
    $('#others').innerHTML = curves;
    $('#others').classList.toggle('many', otherCount > 20);
    $('#labels').innerHTML = labels;
    fillPanel(t, deps, dpts);
    const nDep = new Set(deps.map((d) => d.other)).size, nDpt = new Set(dpts.map((d) => d.other)).size;
    $('#status').textContent = t.name + ' chosen. ' + nDep + ' dependencies and ' + nDpt + ' dependents.';
    cv.dataset.neighbors = roles.size;
    cv.dataset.lines = shownLines;
    setHash(id);
    if (opts.center) requestAnimationFrame(() => centerOn(id, opts.minK ?? 0.9));
  }

  function clearChoice() {
    if (!sel) return;
    sel = null;
    clearMarks();
    cv.classList.remove('has-sel');
    panel.hidden = true;
    app.classList.remove('has-sheet');
    $('#status').textContent = 'No class chosen.';
    setHash(null);
  }

  // ---------- panel ----------
  const glyph = (e) => {
    const kk = edgeKind(e);
    if (isWhole(e)) return '<svg class="gl s" viewBox="0 0 26 10" aria-hidden="true"><path d="M10 5h15"/><path class="dia' + (e.kind === 'aggregation' ? ' hol' : '') + '" d="M1 5 5.5 2 10 5 5.5 8Z"/></svg>';
    if (kk === 's') return '<svg class="gl s" viewBox="0 0 26 10" aria-hidden="true"><path' + (e.kind === 'implements' ? ' class="dash"' : '') + ' d="M1 5h16"/><path class="tri" d="M17 1.5 24.5 5 17 8.5Z"/></svg>';
    if (kk === 'a') return '<svg class="gl" viewBox="0 0 26 10" aria-hidden="true"><path d="M1 5h23M19 1.5 24 5l-5 3.5"/></svg>';
    return '<svg class="gl o" viewBox="0 0 26 10" aria-hidden="true"><path d="M1 8C8 1 16 1 24 5"/></svg>';
  };
  // relationText comes from box-text.js. It names a diamond by its kind.
  const relText = relationText;
  const rank = { s: 0, a: 1, o: 2 };

  function relList(list) {
    if (!list.length) return '<p class="p-note">None.</p>';
    const sorted = list.slice().sort((a, b) => rank[edgeKind(a.e)] - rank[edgeKind(b.e)] || a.other.localeCompare(b.other));
    return '<ul class="rels">' + sorted.map((d) => {
      const o = byId.get(d.other);
      return '<li><button class="rel" type="button" data-go="' + esc(d.other) + '">' + glyph(d.e) + '<b>' + esc(o.name) + '</b><small>' + esc(relText(d.e)) + '</small></button></li>';
    }).join('') + '</ul>';
  }

  function fillPanel(t, deps, dpts) {
    const st = stereoText(t);
    $('#p-st').textContent = st;
    $('#p-st').hidden = !st;
    const nm = $('#p-name');
    nm.textContent = t.name;
    nm.classList.toggle('abs', !!t.abstract);
    const folder = zoneOf(t);
    // The kind is plain text, not a stereotype.
    const kind = KIND[t.kind] || t.kind;
    $('#p-where').innerHTML = '<span class="chip-l L' + t.layer + '"><i></i>Layer ' + t.layer + ' · ' + esc(LAYER[t.layer]) + '</span><span>' + esc(kind) + '</span><span>' + esc(folder) + '</span>' + (t.requirement ? '<span>' + esc(t.requirement) + '</span>' : '');
    let h = '';
    if (t.file) {
      h += '<a class="src" href="' + esc(ghUrl(t.file, t.line)) + '" target="_blank" rel="noopener"><svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5H3.5v9h9V10M9 2.5h4.5V7M13.5 2.5 7.5 8.5"/></svg>View ' + esc(t.file.split('/').pop()) + ' on GitHub, line ' + t.line + '</a>';
    } else {
      h += '<p class="p-note">Planned class. Only a view draws it, and it has no file.</p>';
    }
    // Each view that draws the type links to its picture in the repository.
    if (t.views.length) {
      h += '<h3>Views <span class="n">' + t.views.length + '</span></h3><ul class="views">' + t.views.map((v) =>
        '<li><a href="' + esc(ghUrl(VIEW_DIR + v + '.png')) + '" target="_blank" rel="noopener">' + esc(v) + '</a></li>').join('') + '</ul>';
    }
    if (t.typeParams.length) h += '<h3>Template parameters</h3><p class="uml">' + esc(tpText(t)) + '</p>';
    const titlesBy = [];
    if (t.attrs.length) titlesBy.push('Attributes');
    if (t.ops.filter((o) => !(o.name === 'constructor' && o.vis !== '+')).length) titlesBy.push('Operations');
    if (t.values && t.values.length) titlesBy.push('Values');
    if (t.alias) titlesBy.push('Alias');
    if (!titlesBy.length && t.status === 'planned') titlesBy.push('Members');
    memberSections(t).forEach((sec, i) => {
      h += '<h3>' + titlesBy[i] + ' <span class="n">' + sec.length + '</span></h3><ul class="uml">' +
        sec.map((r) => '<li class="' + (r.under ? 'u ' : '') + (r.ital ? 'i' : '') + '">' + esc(r.text) + '</li>').join('') + '</ul>';
    });
    const nDep = new Set(deps.map((d) => d.other)).size, nDpt = new Set(dpts.map((d) => d.other)).size;
    h += '<h3>Depends on <span class="n">' + nDep + '</span></h3>' + relList(deps);
    h += '<h3>Used by <span class="n">' + nDpt + '</span></h3>' + relList(dpts);
    $('#p-body').innerHTML = h;
    $('#p-body').scrollTop = 0;
    panel.hidden = false;
    app.classList.add('has-sheet');
  }

  $('#p-body').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-go]');
    if (b) choose(b.dataset.go, { center: true, minK: Math.max(k, LOD2) });
  });
  $('#p-close').addEventListener('click', () => { const id = sel; clearChoice(); if (id && boxEl.get(id)) boxEl.get(id).focus({ preventScroll: true }); });

  // ---------- highlight ----------
  // A set is a key: «st:» a stereotype, «v:» a view, «l:» a layer, «p:» a pattern.
  // A pattern set lights the edges of that pattern and their two ends, not every edge between lit boxes.
  const NONE = 'no stereotype';
  function setOptions() {
    const st = new Map(), vw = new Map(), ly = new Map();
    for (const t of model.types) {
      const s = stereotypesOf(t);
      for (const x of s.length ? s : [NONE]) st.set(x, (st.get(x) || 0) + 1);
      for (const v of t.views) vw.set(v, (vw.get(v) || 0) + 1);
      ly.set(t.layer, (ly.get(t.layer) || 0) + 1);
    }
    const byCount = (m) => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    return {
      st: byCount(st).map(([s, n]) => ({ key: 'st:' + s, label: s === NONE ? NONE : '«' + s + '»', n })),
      v: [...vw].sort((a, b) => a[0].localeCompare(b[0])).map(([v, n]) => ({ key: 'v:' + v, label: v, n })),
      l: [4, 3, 2, 1].map((l) => ({ key: 'l:' + l, label: 'Layer ' + l + ' · ' + LAYER[l], n: ly.get(l) || 0 })),
      p: patternSets(model).map((x) => ({ key: 'p:' + x.name, label: x.name, n: x.ids.length, ids: x.ids, edges: x.edges })),
    };
  }
  function idsFor(key) {
    const [kind, ...rest] = key.split(':');
    const val = rest.join(':');
    if (kind === 'p') return new Set(options.p.find((o) => o.key === key).ids);
    return new Set(model.types.filter((t) => {
      if (kind === 'st') { const s = stereotypesOf(t); return val === NONE ? !s.length : s.includes(val); }
      if (kind === 'v') return t.views.includes(val);
      return String(t.layer) === val;
    }).map((t) => t.id));
  }
  let options = null, tab = 'st';
  function drawOptions() {
    $('#hl-opts').innerHTML = options[tab].map((o) => '<li><button class="opt" type="button" data-hl="' + esc(o.key) + '" aria-pressed="' + (hl && hl.key === o.key) + '"><span>' + esc(o.label) + '</span><span class="c">' + o.n + '</span></button></li>').join('');
  }
  // applyHighlight marks the lit boxes and the lines between two lit boxes.
  function applyHighlight() {
    cv.classList.toggle('has-hl', !!hl);
    cv.classList.toggle('hl-e', !!hl && !!hl.edges);
    for (const [id, g] of boxEl) g.classList.toggle('lit', !!hl && hl.ids.has(id));
    for (const [i, g] of lineEl) {
      const e = model.edges[i];
      g.classList.toggle('lit', !!hl && (hl.edges ? hl.edges.has(i) : hl.ids.has(e.from) && hl.ids.has(e.to)));
      // A ghost line with one lit end shows at full ink, so the highlight shows where its set connects.
      g.classList.toggle('hle', !!hl && !hl.edges && g.classList.contains('gh') && (hl.ids.has(e.from) || hl.ids.has(e.to)));
    }
    if (zones.length && zones[0].el) fillZones();
    $('#hl-chip').hidden = !hl;
    $('#hl-badge').hidden = !hl;
    if (hl) {
      $('#hl-what').textContent = hl.label;
      $('#hl-n').textContent = hl.ids.size + ' of ' + model.types.length + ' types' + (hl.edges ? ' · ' + hl.edges.size + (hl.edges.size === 1 ? ' line' : ' lines') : '');
      $('#hl-badge').textContent = hl.ids.size;
    }
  }
  function setHighlight(key) {
    if (!key || (hl && hl.key === key)) { clearHighlight(); return; }
    const opt = [...options.st, ...options.v, ...options.l, ...options.p].find((o) => o.key === key);
    hl = { key, label: opt.label, ids: idsFor(key), edges: opt.edges ? new Set(opt.edges) : null };
    applyHighlight();
    drawOptions();
    if (!sel) showSet(hl.ids);
    $('#status').textContent = hl.ids.size + ' types highlighted: ' + hl.label + '.';
  }
  // showSet moves to a lit set when none of its boxes is on screen, so the reader never sees only faded boxes.
  function showSet(ids) {
    const v = view();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, seen = false;
    for (const id of ids) {
      if (!P.boxes[id]) continue;
      const r = rectOf(id);
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
      const sx = r.x * k + tx, sy = r.y * k + ty;
      if (sx + r.w * k > 0 && sy + r.h * k > 0 && sx < v.w && sy < v.h) seen = true;
    }
    if (seen || x0 === Infinity) return;
    const m = narrow() ? 12 : 40;
    const nk = clampK(Math.min(1.25, (v.w - 2 * m) / (x1 - x0), (v.h - 2 * m) / (y1 - y0)));
    moveTo(nk, v.w / 2 - (x0 + x1) / 2 * nk, v.h / 2 - (y0 + y1) / 2 * nk, true, 380);
  }
  function clearHighlight() {
    if (!hl) return;
    hl = null;
    applyHighlight();
    drawOptions();
    $('#status').textContent = 'Highlight cleared.';
  }
  // showTab selects one tab of the highlight menu.
  function showTab(name) {
    tab = name;
    document.querySelectorAll('.hl-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === name)));
    drawOptions();
  }
  document.querySelectorAll('.hl-tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#hl-opts').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-hl]');
    if (!b) return;
    setHighlight(b.dataset.hl);
    if (narrow()) closeMenus();
  });
  $('#hl-clear').addEventListener('click', clearHighlight);

  // ---------- menus ----------
  const menus = [['#hl-btn', '#hl-menu'], ['#ln-btn', '#ln-menu']].map(([b, m]) => ({ b: $(b), m: $(m) }));
  function closeMenus(focus) {
    for (const x of menus) {
      if (x.m.hidden) continue;
      x.m.hidden = true;
      x.b.setAttribute('aria-expanded', 'false');
      if (focus) x.b.focus();
    }
  }
  for (const x of menus) {
    x.b.addEventListener('click', () => {
      const open = x.m.hidden;
      closeMenus();
      if (!open) return;
      x.m.hidden = false;
      x.b.setAttribute('aria-expanded', 'true');
      const first = x.m.querySelector('[aria-selected="true"], [aria-pressed="true"], input, button');
      if (first) first.focus();
    });
  }
  document.addEventListener('pointerdown', (ev) => { if (!closest(ev.target, '.menu-w')) closeMenus(); });

  // ---------- pointer: pan, pinch, click, hover ----------
  const pts = new Map();
  let downAt = null, moved = false, pinch = null;
  cv.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    cv.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    cancelAnimationFrame(anim);
    if (pts.size === 1) { downAt = { x: ev.clientX, y: ev.clientY, target: ev.target }; moved = false; }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
      moved = true;
    }
  });
  cv.addEventListener('pointermove', (ev) => {
    if (!pts.has(ev.pointerId)) return;
    const prev = pts.get(ev.pointerId);
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    const r = cv.getBoundingClientRect();
    if (pts.size >= 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      tx += mx - pinch.mx; ty += my - pinch.my;
      zoomAt(mx - r.left, my - r.top, d / pinch.d);
      pinch = { d, mx, my };
      return;
    }
    if (!moved && downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4) { moved = true; cv.classList.add('drag'); }
    if (moved) { tx += ev.clientX - prev[0]; ty += ev.clientY - prev[1]; apply(); }
  });
  // A click on a box chooses it. A click on a folder title zooms to the folder.
  // A click on an empty frame clears the choice first, and zooms when nothing is chosen.
  const endPointer = (ev) => {
    if (!pts.has(ev.pointerId)) return;
    pts.delete(ev.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      cv.classList.remove('drag');
      if (!moved && downAt && ev.type === 'pointerup' && downAt.target.closest) {
        const tg = downAt.target;
        const box = tg.closest('.box'), fold = tg.closest('.fold'), frame = tg.closest('[data-f]');
        if (box) choose(box.dataset.id);
        else if (fold) zoomToFrame(+fold.dataset.f);
        else if (frame && !sel) frameClick(+frame.dataset.f);
        else clearChoice();
      }
      downAt = null;
    }
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = cv.getBoundingClientRect();
    const f = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0018) * (ev.deltaMode === 1 ? 16 : 1));
    cancelAnimationFrame(anim);
    zoomAt(ev.clientX - r.left, ev.clientY - r.top, f);
  }, { passive: false });

  // Hover gives a light preview of the lines of one box on a fine pointer.
  let hovered = null;
  function hoverOn(id) {
    hoverOff();
    hovered = id;
    cv.classList.add('hov');
    boxEl.get(id).classList.add('hv');
    for (const i of [...(outE.get(id) || []), ...(inE.get(id) || [])]) {
      const g = lineEl.get(i);
      if (!g) continue;
      g.classList.add('hv');
      const e = model.edges[i];
      const o = boxEl.get(e.from === id ? e.to : e.from);
      if (o) o.classList.add('hv');
    }
  }
  function hoverOff() {
    if (!hovered) return;
    hovered = null;
    cv.classList.remove('hov');
    document.querySelectorAll('#cv .hv').forEach((g) => g.classList.remove('hv'));
  }
  if (fine) {
    cv.addEventListener('pointerover', (ev) => {
      if (pts.size || k < LOD1) return;
      const g = ev.target.closest('.box');
      if (g && g.dataset.id !== hovered) hoverOn(g.dataset.id);
    });
    cv.addEventListener('pointerout', (ev) => {
      const g = ev.target.closest('.box');
      if (g && !(ev.relatedTarget && g.contains(ev.relatedTarget))) hoverOff();
    });
  }

  // ---------- keyboard ----------
  // closest finds the nearest ancestor that matches. A target with no closest(), such as the document, gives null.
  const closest = (t, sel) => (t && typeof t.closest === 'function' ? t.closest(sel) : null);
  cv.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const g = closest(ev.target, '.box');
    const fold = closest(ev.target, '.fold');
    if (g) { ev.preventDefault(); choose(g.dataset.id); }
    else if (fold) { ev.preventDefault(); zoomToFrame(+fold.dataset.f); }
  });
  cv.addEventListener('focusin', (ev) => {
    const g = closest(ev.target, '.box');
    if (g) ensureVisible(g.dataset.id);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (menus.some((x) => !x.m.hidden)) { closeMenus(true); return; }
      if (!hits.hidden) { closeHits(); return; }
      if (sel) { const id = sel; clearChoice(); const g = boxEl.get(id); if (g && document.activeElement === document.body) g.focus({ preventScroll: true }); return; }
      clearHighlight();
      return;
    }
    if (closest(ev.target, 'input, textarea')) return;
    const v = view();
    if (ev.key === '+' || ev.key === '=') zoomAt(v.w / 2, v.h / 2, 1.25);
    else if (ev.key === '-') zoomAt(v.w / 2, v.h / 2, 0.8);
    else if (ev.key === '0') fit();
  });

  // ---------- zoom buttons ----------
  $('#zin').addEventListener('click', () => { const v = view(); const c = [v.w / 2, v.h / 2], nk = clampK(k * 1.4); moveTo(nk, c[0] - (c[0] - tx) * nk / k, c[1] - (c[1] - ty) * nk / k); });
  $('#zout').addEventListener('click', () => { const v = view(); const c = [v.w / 2, v.h / 2], nk = clampK(k / 1.4); moveTo(nk, c[0] - (c[0] - tx) * nk / k, c[1] - (c[1] - ty) * nk / k); });
  $('#fit').addEventListener('click', () => fit());

  // ---------- density and line kinds ----------
  document.querySelectorAll('#dens button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.d === density || !model) return;
    density = b.dataset.d;
    document.querySelectorAll('#dens button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    const keep = sel;
    hoverOff();
    render();
    if (keep) choose(keep, { center: true, minK: k }); else fit(false);
    if (!keep) apply();
  }));
  document.querySelectorAll('.kinds input').forEach((inp) => inp.addEventListener('change', () => {
    cv.classList.toggle('hide-' + inp.dataset.k, !inp.checked);
    if (sel) choose(sel);
  }));

  // ---------- search ----------
  const q = $('#q'), hits = $('#hits'), go = $('#go');
  let found = [], active = 0;
  function search(text) {
    const s = text.trim().toLowerCase();
    if (!s) return [];
    const scored = [];
    for (const t of model.types) {
      const n = t.name.toLowerCase(), st = stereoText(t).toLowerCase();
      const score = n === s ? 0 : n.startsWith(s) ? 1 : n.includes(s) ? 2 : st.includes(s) ? 3 : -1;
      if (score >= 0) scored.push([score, t]);
    }
    return scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).map((x) => x[1]).slice(0, 40);
  }
  function closeHits() { hits.hidden = true; q.setAttribute('aria-expanded', 'false'); q.removeAttribute('aria-activedescendant'); }
  function drawHits() {
    if (!q.value.trim()) { closeHits(); go.disabled = true; return; }
    hits.hidden = false;
    q.setAttribute('aria-expanded', 'true');
    go.disabled = !found.length;
    if (!found.length) { hits.innerHTML = '<li class="none" role="option" aria-disabled="true">No class matches.</li>'; return; }
    hits.innerHTML = found.map((t, i) => '<li role="option" id="hit-' + i + '" data-id="' + esc(t.id) + '" aria-selected="' + (i === active) + '"><b>' + esc(t.name) + '</b><small>' + esc(stereoText(t) || 'layer ' + t.layer) + '</small></li>').join('');
    q.setAttribute('aria-activedescendant', 'hit-' + active);
    const a = hits.children[active];
    if (a) a.scrollIntoView({ block: 'nearest' });
  }
  function goTo(t) {
    if (!t) return;
    closeHits();
    q.value = t.name;
    choose(t.id, { center: true, minK: 0.9 });
  }
  q.addEventListener('input', () => { found = search(q.value); active = 0; drawHits(); });
  q.addEventListener('focus', () => { if (q.value.trim()) { found = search(q.value); drawHits(); } });
  q.addEventListener('blur', () => setTimeout(closeHits, 150));
  q.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' && found.length) { ev.preventDefault(); active = (active + 1) % found.length; drawHits(); }
    else if (ev.key === 'ArrowUp' && found.length) { ev.preventDefault(); active = (active - 1 + found.length) % found.length; drawHits(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); goTo(found[active]); }
  });
  hits.addEventListener('pointerdown', (ev) => ev.preventDefault());
  hits.addEventListener('click', (ev) => { const li = ev.target.closest('li[data-id]'); if (li) goTo(byId.get(li.dataset.id)); });
  go.addEventListener('click', () => goTo(found[active] || byId.get(sel)));

  // ---------- legend ----------
  // buildLegend lists only the line kinds, marks and labels that the loaded model has.
  const LG = {
    ext: '<svg viewBox="0 0 30 14" aria-hidden="true" class="gl s"><path d="M1 7h19"/><path class="tri" d="M20 2.5 28.5 7 20 11.5Z"/></svg>',
    impl: '<svg viewBox="0 0 30 14" aria-hidden="true" class="gl s"><path class="dash" d="M1 7h19"/><path class="tri" d="M20 2.5 28.5 7 20 11.5Z"/></svg>',
    comp: '<svg viewBox="0 0 30 14" aria-hidden="true" class="gl s"><path d="M12 7h17"/><path class="dia" d="M1 7 6.5 3.5 12 7 6.5 10.5Z"/></svg>',
    agg: '<svg viewBox="0 0 30 14" aria-hidden="true" class="gl s"><path d="M12 7h17"/><path class="dia hol" d="M1 7 6.5 3.5 12 7 6.5 10.5Z"/></svg>',
    sum: '<svg viewBox="0 0 30 14" aria-hidden="true" class="sw-sum L1"><path d="M1 7h28"/><rect x="9" y="2" width="12" height="10" rx="5"/></svg>',
    attr: '<svg viewBox="0 0 30 14" aria-hidden="true" class="gl"><path d="M1 7h27M22 3l6 4-6 4"/></svg>',
    other: '<svg viewBox="0 0 30 14" aria-hidden="true" class="gl o"><path d="M1 11C9 2 19 2 28 6"/></svg>',
    box: '<svg viewBox="0 0 30 14" aria-hidden="true"><rect class="sw-box" x="1" y="2" width="28" height="10" rx="2"/></svg>',
    planned: '<svg viewBox="0 0 30 14" aria-hidden="true"><rect class="sw-box dash" x="1" y="2" width="28" height="10" rx="2"/></svg>',
    tp: '<svg viewBox="0 0 30 14" aria-hidden="true"><rect class="sw-box" x="1" y="5" width="22" height="8" rx="2"/><rect class="sw-box dash" x="14" y="1" width="15" height="7"/></svg>',
    stat: '<svg viewBox="0 0 30 14" aria-hidden="true"><text class="sw-u" x="1" y="10">+ of()</text></svg>',
    abs: '<svg viewBox="0 0 30 14" aria-hidden="true"><text class="sw-i" x="1" y="10.5">Base</text></svg>',
    zone: '<svg viewBox="0 0 30 14" aria-hidden="true"><rect class="sw-zone" x="1" y="1" width="28" height="12" rx="2"/><rect class="sw-block" x="5" y="5" width="9" height="5" rx="1"/><rect class="sw-block" x="16" y="5" width="9" height="5" rx="1"/></svg>',
    ghost: '<svg viewBox="0 0 30 14" aria-hidden="true" class="gl gh"><path d="M1 7h27"/></svg>',
    sel: '<svg viewBox="0 0 30 14" aria-hidden="true"><rect class="sw-sel" x="1" y="2" width="28" height="10" rx="2"/></svg>',
    dpt: '<svg viewBox="0 0 30 14" aria-hidden="true"><rect class="sw-tab-dpt" x="1" y="3" width="28" height="8" rx="2"/></svg>',
    dep: '<svg viewBox="0 0 30 14" aria-hidden="true"><rect class="sw-tab-dep" x="1.5" y="3" width="27" height="8" rx="2"/></svg>',
    lit: '<svg viewBox="0 0 30 14" aria-hidden="true"><rect class="sw-lit" x="2" y="2.5" width="26" height="9" rx="2"/></svg>',
  };
  function buildLegend() {
    const kinds = new Set(model.edges.map((e) => e.kind));
    const members = model.types.flatMap((t) => [...t.attrs, ...t.ops]);
    const labels = model.edges.map((e) => e.label || '');
    // The marks of planned types and planned members, as the boxes print them.
    const marks = [...new Set([
      ...model.types.filter((t) => t.status === 'planned').map((t) => t.sprint || 'planned'),
      ...members.filter((m) => m.planned).map((m) => m.sprint || 'planned'),
    ])].sort().map((x) => '«' + x + '»');
    const li = (svg, text, cls) => '<li' + (cls ? ' class="' + cls + '"' : '') + '>' + svg + esc(text) + '</li>';
    let h = '';
    if (kinds.has('extends')) h += li(LG.ext, 'Extends. Thick solid line, hollow triangle.');
    if (kinds.has('implements')) h += li(LG.impl, 'Implements. Dashed line, hollow triangle. The lines to one interface join in one trunk.');
    if (kinds.has('aggregation')) {
      const deco = model.edges.some((e) => e.kind === 'aggregation' && e.pattern === 'Decorator');
      h += li(LG.agg, 'Aggregation. Hollow diamond at the holder. The label near the other end gives the role and the multiplicity.' + (deco ? ' A decorator reads decorate 1.' : ''));
    }
    if (kinds.has('composition')) h += li(LG.comp, 'Composition. Filled diamond at the root of the aggregate. The label gives the role and the multiplicity.');
    if (model.edges.some(isAttr)) h += li(LG.attr, 'Use by an attribute. The label gives the role and the multiplicity.');
    if (model.edges.some((e) => edgeKind(e) === 'o')) {
      const words = [labels.some((l) => l.includes('«bind»')) && '«bind» binds a template parameter.', labels.some((l) => l.includes('«create»')) && '«create» creates the other class.'].filter(Boolean);
      h += li(LG.other, ['Other use of the chosen class: a parameter, a return or a local variable. The label names the operation.', ...words].join(' '));
    }
    h += li(LG.box, 'Class in the code.');
    if (marks.length) h += li(LG.planned, 'Planned class. Dashed border and the mark ' + marks.join(' or ') + '. A planned member has the same mark.');
    if (model.types.some((t) => t.typeParams.length)) h += li(LG.tp, 'Template parameters, at the top right.');
    if (members.some((m) => m.static)) h += li(LG.stat, 'Static member, underlined.');
    if (model.types.some((t) => t.abstract) || members.some((m) => m.abstract)) h += li(LG.abs, 'Abstract class or operation, in italics.');
    h += li(LG.zone, 'Folder. From far away, each class is a block. A click on the folder zooms to it.', 'sep');
    if (marks.length) h += li(LG.zone, 'The «planned» zone of a part. It holds the planned classes that have no file yet.');
    if (['compact', 'full'].some((d) => (positions[d].sums || []).length)) {
      h += li(LG.sum, 'A large folder shows each view as a zone. From far away, the lines between two zones are one line with their count. Zoom in to see each line.');
    }
    h += li(LG.ghost, 'Ghost line, at the middle zoom: a line between two zones or two folders. It takes full ink for a chosen, hovered or highlighted end.', 'lg-ghost');
    h += li(LG.sel, 'Chosen class.');
    h += li(LG.dpt, 'Dependent tab. This class depends on the chosen class.');
    h += li(LG.dep, 'Dependency tab. The chosen class depends on this class.');
    h += li(LG.lit, 'Highlighted type. It has a thick border, and the rest fades.');
    h += '<li>With a chosen class, its relations show. The thick border still marks the highlighted set.</li>';
    $('#legend-list').innerHTML = h;
  }

  // ---------- repository and hash ----------
  // The hash names the repository and may name a type: #app, #api-PlayerProgress.
  // A bare type name opens the first repository, as older links do.
  function readHash() {
    const h = location.hash.slice(1);
    const m = /^([a-z0-9]+)(?:-([A-Za-z0-9]+))?$/.exec(h);
    if (m && REPOS[m[1]]) return { repo: m[1], id: m[2] || null };
    if (/^[A-Za-z0-9]+$/.test(h)) return { repo: FIRST, id: h };
    return null;
  }
  // setHash writes the repository and the chosen type. Only ASCII letters, digits and hyphens go in.
  function setHash(id) {
    const h = '#' + repo + (id && /^[A-Za-z0-9]+$/.test(id) ? '-' + id : '');
    if (location.hash === h) return;
    try { history.replaceState(null, '', location.pathname + location.search + h); } catch { /* The hash is optional. */ }
  }
  function storedRepo() {
    try { const r = localStorage.getItem(STORE); return REPOS[r] ? r : null; } catch { return null; }
  }
  function storeRepo(r) {
    try { localStorage.setItem(STORE, r); } catch { /* The stored choice is optional. */ }
  }

  const getJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  // A data set loads once. A failed load is forgotten, so a later try fetches again.
  const sets = new Map();
  function dataOf(r) {
    if (!sets.has(r)) {
      const p = Promise.all([getJSON(REPOS[r] + '.model.json'), getJSON(REPOS[r] + '.positions.json')]);
      p.catch(() => sets.delete(r));
      sets.set(r, p);
    }
    return sets.get(r);
  }
  const markRepo = (r) => document.querySelectorAll('#repo button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.r === r)));

  // The fonts load before the first render, so the measured label widths are right.
  const fonts = Promise.all(["600 15px 'IBM Plex Sans'", "12.5px 'IBM Plex Sans'", "600 12px 'IBM Plex Sans'", "italic 600 12px 'IBM Plex Sans'", "8px 'IBM Plex Mono'"]
    .map((f) => document.fonts.load(f).catch(() => null)));

  // openRepo loads one repository and draws it. The page does not reload.
  // A later call wins over an earlier one that is still loading.
  let loadSeq = 0;
  async function openRepo(r, id) {
    const seq = ++loadSeq;
    markRepo(r);
    stage.setAttribute('aria-busy', 'true');
    let m, p;
    try { [m, p] = await Promise.all([dataOf(r), fonts]).then(([d]) => d); } catch {
      if (seq !== loadSeq) return;
      stage.removeAttribute('aria-busy');
      markRepo(repo);
      const msg = 'The model did not load. Reload the page.';
      if ($('#loading')) $('#loading').textContent = msg; else $('#status').textContent = msg;
      return;
    }
    if (seq !== loadSeq) return;
    stage.removeAttribute('aria-busy');
    // A new repository starts clean: no choice, no highlight, no search.
    hoverOff();
    closeMenus();
    closeHits();
    q.value = ''; found = []; go.disabled = true;
    sel = null; hl = null;
    cv.classList.remove('has-sel');
    panel.hidden = true;
    app.classList.remove('has-sheet');
    repo = r;
    storeRepo(r);
    model = m; positions = p;
    partTitle = new Map((m.parts || []).map((x) => [x.id, x.title]));
    byId = new Map(m.types.map((t) => [t.id, t]));
    outE = new Map(); inE = new Map();
    m.edges.forEach((e, i) => {
      (outE.get(e.from) || outE.set(e.from, []).get(e.from)).push(i);
      (inE.get(e.to) || inE.set(e.to, []).get(e.to)).push(i);
    });
    $('#meta').textContent = m.repo + ' · ' + m.head + ' · ' + m.types.length + ' types · ' + m.edges.length + ' relations';
    if ($('#loading')) $('#loading').remove();
    options = setOptions();
    // The pattern tab shows only when the edges of the model carry a pattern.
    $('#hl-tab-p').hidden = !options.p.length;
    showTab(tab === 'p' && !options.p.length ? 'st' : tab);
    buildLegend();
    render();
    fit(false);
    $('#status').textContent = 'Repository ' + m.repo + ' loaded. ' + typesText(m.types.length) + '.';
    if (id && byId.has(id)) choose(id, { center: true }); else setHash(null);
    document.documentElement.dataset.ready = '1';
    document.documentElement.dataset.repo = r;
  }

  document.querySelectorAll('#repo button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.r !== repo) openRepo(b.dataset.r, null);
  }));

  // ---------- start ----------
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!sel && model) fit(false); }, 120); });
  window.addEventListener('hashchange', () => {
    const h = readHash();
    if (!h) return;
    if (h.repo !== repo) openRepo(h.repo, h.id);
    else if (h.id && byId && byId.has(h.id) && h.id !== sel) choose(h.id, { center: true });
  });

  const first = readHash();
  openRepo(first ? first.repo : storedRepo() || FIRST, first && first.id);
})();
