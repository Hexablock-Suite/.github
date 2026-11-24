// box-text.js turns one type of the model into the rows of its UML box.
// The page and the layout share this file, so the box sizes of both stay equal.
// It is a plain script with no DOM access and no module syntax.
// The build puts it into the page as it is, and the layout runs it with its own scope.
const BOX = { pad: 16, minW: 168, maxChars: 54, indent: 4, mono: 5.4, stereo: 8 * 0.68, tpChar: 4.8, row: 16, compactH: 56 };

// isAttr tells an attribute use from another use: the label ends with a multiplicity.
function isAttr(e) {
  return e.kind === 'use' && / (1|\*|0\.\.1|\d+\.\.(\d+|\*))$/.test(e.label || '');
}

// folderOf gives the zone of a type: its source folder, or the planned zone of its part.
// partTitle maps a part id to its title.
function folderOf(t, partTitle) {
  return t.file ? t.file.replace(/^src\//, '').split('/').slice(0, -1).join('/') || '.' : 'planned · ' + (partTitle.get(t.part) || t.part);
}

// zoneName gives the short name of a folder zone: the path below the layer folder.
// A view zone drops the word «view» of its frame title.
function zoneName(title) {
  if (title.startsWith('view ')) return title.slice(5);
  return title.includes('/') ? title.split('/').slice(1).join('/') : title;
}

// relationText names one relation in the side panel.
// A diamond names its kind first, so an aggregation never reads as a use.
function relationText(e) {
  if (e.kind === 'aggregation' || e.kind === 'composition') return e.kind + (e.label ? ' · ' + e.label : '');
  return e.label || (e.kind === 'use' ? 'use' : e.kind);
}

// patternSets gives, for each pattern that the edges carry, its edge indexes and the ids of their ends.
// The patterns come in name order.
function patternSets(model) {
  const sets = new Map();
  model.edges.forEach((e, i) => {
    if (!e.pattern) return;
    if (!sets.has(e.pattern)) sets.set(e.pattern, { edges: [], ids: new Set() });
    const s = sets.get(e.pattern);
    s.edges.push(i);
    s.ids.add(e.from);
    s.ids.add(e.to);
  });
  return [...sets].sort((a, b) => a[0].localeCompare(b[0])).map(([name, s]) => ({ name, edges: s.edges, ids: [...s.ids].sort() }));
}

// stereotypesOf gives the stereotypes that the box prints, without guillemets.
// It prints only what the model gives, plus «interface» for an interface.
// «dataType» never stacks on «interface».
function stereotypesOf(t) {
  const isInterface = t.kind === 'interface' || t.stereotypes.includes('interface');
  const s = t.stereotypes.filter((x) => !(x === 'dataType' && isInterface));
  if (t.kind === 'interface' && !s.includes('interface')) s.unshift('interface');
  return s;
}

// stereoText gives the stereotype line of a box.
function stereoText(t) {
  const s = stereotypesOf(t);
  if (t.status === 'planned') s.push(t.sprint || 'planned');
  return s.map((x) => '«' + x + '»').join(' ');
}

// tpText gives the text of the template box, or an empty string.
function tpText(t) {
  return t.typeParams.map((p) => p.name + (p.constraint ? ' extends ' + p.constraint : '') + (p.default ? ' = ' + p.default : '')).join(', ');
}

// plannedTag marks a member that only a view plans.
function plannedTag(m) {
  return m.planned ? ' «' + (m.sprint || 'planned') + '»' : '';
}

// memberSections gives the compartments of a full box as plain text rows.
// {readOnly} marks a public attribute only, as the class views do.
function memberSections(t) {
  const out = [];
  if (t.attrs.length) {
    out.push(t.attrs.map((a) => ({
      text: a.vis + ' ' + a.name + ': ' + a.type + (a.optional ? ' [0..1]' : '') + (a.readonly && a.vis === '+' ? ' {readOnly}' : '') + plannedTag(a),
      under: !!a.static, ital: false,
    })));
  }
  const ops = t.ops.filter((o) => !(o.name === 'constructor' && o.vis !== '+'));
  if (ops.length) {
    out.push(ops.map((o) => {
      const tps = o.typeParams && o.typeParams.length ? '<' + o.typeParams.map((p) => p.name + (p.constraint ? ' extends ' + p.constraint : '')).join(', ') + '>' : '';
      return {
        text: o.vis + ' ' + o.name + tps + '(' + o.params.join(', ') + ')' + (o.ret == null ? '' : ': ' + o.ret) + plannedTag(o),
        under: !!o.static, ital: !!o.abstract,
      };
    }));
  }
  if (t.values && t.values.length) out.push(t.values.map((v) => ({ text: v, under: false, ital: false })));
  if (t.alias) out.push([{ text: '= ' + t.alias, under: false, ital: false }]);
  if (!out.length && t.status === 'planned') out.push([{ text: 'members not designed yet', under: false, ital: true }]);
  return out;
}

// wrapText breaks a row at a space so that no line passes max characters.
function wrapText(text, max, indent) {
  const lines = [];
  let rest = text;
  let lim = max;
  while (rest.length > lim) {
    let cut = rest.lastIndexOf(' ', lim);
    const paren = rest.lastIndexOf('(', lim - 1);
    if (paren + 1 > cut && paren > 0) cut = paren + 1;
    if (cut < lim * 0.35) cut = lim;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
    lim = max - indent;
  }
  lines.push(rest);
  return lines;
}

// boxModel gives the size and the text rows of one box in one density.
// nameW is the width of the name. The layout passes the width from the glyph table.
// The page passes 0 and uses the stored size.
function boxModel(t, density, nameW) {
  const st = stereoText(t);
  const tp = tpText(t);
  const tpW = tp ? Math.ceil(tp.length * BOX.tpChar + 12) : 0;
  let w = Math.max(BOX.minW, nameW + 2 * BOX.pad + 8, st.length * BOX.stereo + 2 * BOX.pad, tpW + 32);
  const m = { st, tp, tpW, stY: 0, nameY: 0, rq: null, rqY: 0, sections: [], h: 0, w: 0 };
  if (density === 'compact') {
    m.stY = 22;
    m.nameY = st ? 40 : 33;
    m.h = BOX.compactH;
  } else {
    m.stY = 18;
    m.nameY = st ? 36 : 28;
    let y = m.nameY + 12;
    if (t.requirement) {
      m.rq = t.requirement;
      m.rqY = m.nameY + 14;
      y = m.rqY + 10;
      w = Math.max(w, m.rq.length * BOX.stereo + 2 * BOX.pad);
    }
    for (const sec of memberSections(t)) {
      const rows = [];
      const top = y;
      let base = y + 16;
      for (const r of sec) {
        const parts = wrapText(r.text, BOX.maxChars, BOX.indent);
        parts.forEach((p, i) => {
          const x = BOX.pad + (i ? BOX.indent * BOX.mono : 0);
          rows.push({ x, y: base, text: p, under: r.under, ital: r.ital });
          w = Math.max(w, x + p.length * BOX.mono + BOX.pad);
          base += BOX.row;
        });
      }
      y = base - BOX.row + 8;
      m.sections.push({ top, rows });
    }
    m.h = y;
  }
  m.w = Math.ceil(w / 4) * 4;
  return m;
}
