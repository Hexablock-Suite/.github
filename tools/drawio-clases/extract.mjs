#!/usr/bin/env node
// Extract the code types of one HexaBlock repository from its TypeScript source.
//
// Usage: node extract.mjs <repo-root> <out.json>
//
// The script loads the TypeScript compiler from the node_modules of <repo-root>.
// It reads every top-level declaration under <repo-root>/src: classes, interfaces, type aliases, enums
// and `const` objects. Test files and declaration files stay out.
// It writes the code half of the class model: the types, their members and the uses between them.
// `merge.mjs` joins this output with the class views. It also drops the local types and the
// `const` objects that no view draws.
// The source under src/ must match HEAD. The script stops when src/ has uncommitted changes.
// The output has no timestamp, so the same commit always gives the same bytes.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Collection types give the multiplicity `*` to the attribute that holds them.
const COLLECTIONS = new Set([
  'Array',
  'ReadonlyArray',
  'Map',
  'ReadonlyMap',
  'Set',
  'ReadonlySet',
  'WeakMap',
  'WeakSet',
  'Record',
  'Iterable',
  'IterableIterator',
  'AsyncIterable',
]);
const LABEL_CAP = 3;

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

// The repository name is the last segment of the origin URL. A repository without origin uses its folder name.
export function repoName(repo) {
  try {
    return path.basename(git(repo, 'remote', 'get-url', 'origin')).replace(/\.git$/, '');
  } catch {
    return path.basename(repo);
  }
}

export function extract(repoArg) {
  const repo = path.resolve(repoArg);
  if (git(repo, 'status', '--porcelain', '--', 'src') !== '') {
    throw new Error(`${repo}/src has uncommitted changes; the model must come from HEAD`);
  }
  const require = createRequire(path.join(repo, 'package.json'));
  const ts = require('typescript');
  const srcDir = path.join(repo, 'src') + path.sep;
  const rel = (file) => path.relative(repo, file).split(path.sep).join('/');
  const isSource = (f) => f.startsWith(srcDir) && !f.endsWith('.d.ts') && !/\.(test|spec)\.tsx?$/.test(f);

  // Build one program from the tsconfig of the repository, so the type checker resolves every import.
  const configPath = ts.findConfigFile(repo, ts.sys.fileExists, 'tsconfig.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  });
  const srcFiles = ts.sys.readDirectory(path.join(repo, 'src'), ['.ts', '.tsx'], undefined, ['**/*']).filter(isSource);
  const program = ts.createProgram({ rootNames: [...new Set([...parsed.fileNames, ...srcFiles])], options: parsed.options });
  const checker = program.getTypeChecker();
  const files = program
    .getSourceFiles()
    .filter((f) => isSource(f.fileName))
    .sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));

  const hasMod = (node, flag) => (ts.getCombinedModifierFlags(node) & flag) !== 0;
  const lineOf = (node) => node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

  // An object literal, also behind `as const` or `satisfies`, is the body of a `const` type.
  const objectLiteralOf = (init) => {
    let e = init;
    while (e && (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e))) e = e.expression;
    return e && ts.isObjectLiteralExpression(e) ? e : null;
  };

  // Pass 1: find the top-level declarations. Exported ones come first, so they keep the plain name as id.
  const found = [];
  for (const sf of files) {
    for (const st of sf.statements) {
      const exported = hasMod(st, ts.ModifierFlags.Export);
      if (
        (ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) &&
        st.name
      ) {
        found.push({ node: st, name: st.name.text, exported, sf });
      } else if (ts.isVariableStatement(st) && st.declarationList.flags & ts.NodeFlags.Const) {
        for (const d of st.declarationList.declarations) {
          const obj = ts.isIdentifier(d.name) ? objectLiteralOf(d.initializer) : null;
          if (obj) found.push({ node: d, obj, name: d.name.text, exported, sf, isConst: true });
        }
      }
    }
  }
  const decls = new Map(); // declaration node -> id
  const entries = new Map(); // id -> { node, obj?, companion? }
  const sameFileType = (f) =>
    found.find((g) => !g.isConst && g.name === f.name && g.sf === f.sf && g.exported === f.exported);
  for (const f of [...found.filter((x) => x.exported), ...found.filter((x) => !x.exported)]) {
    // A const object next to a type of the same name is the companion of that type (`Result`).
    if (f.isConst && sameFileType(f)) continue;
    if (decls.has(f.node)) continue;
    // A class and an interface can merge under one name in one file; keep the first declaration.
    const merged = found.find((g) => g !== f && !g.isConst && g.name === f.name && g.sf === f.sf && decls.has(g.node));
    if (merged) {
      decls.set(f.node, decls.get(merged.node));
      continue;
    }
    const id = entries.has(f.name) ? `${f.name}@${rel(f.sf.fileName)}` : f.name;
    decls.set(f.node, id);
    entries.set(id, { ...f });
  }
  for (const f of found.filter((x) => x.isConst)) {
    const owner = sameFileType(f);
    if (owner && decls.has(owner.node)) {
      decls.set(f.node, decls.get(owner.node));
      entries.get(decls.get(owner.node)).companion = f;
    }
  }

  // Print a type the way the source writes it, with the import("…") prefixes removed.
  const clean = (text) => text.replace(/import\("[^"]*"\)\./g, '').replace(/\s+/g, ' ').trim();
  const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
  const typeText = (node, typeNode) => (typeNode ? clean(typeNode.getText()) : clean(checker.typeToString(checker.getTypeAtLocation(node), node, flags)));

  // Resolve a name node to the id of a model type, or null.
  const targetOf = (nameNode) => {
    let sym = checker.getSymbolAtLocation(nameNode);
    if (!sym) return null;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    for (const d of sym.declarations ?? []) if (decls.has(d)) return decls.get(d);
    return null;
  };

  // Collect the model types that a subtree names. Each hit is { id, isNew }.
  // A type reference, a value identifier, a `new` and the inferred type of a local variable count as uses.
  const refsIn = (node) => {
    const out = [];
    if (!node) return out;
    const visit = (n) => {
      if (ts.isDecorator(n)) return; // Module metadata and injection tokens draw no line (rule 12).
      if (ts.isTypeReferenceNode(n)) {
        const id = targetOf(ts.isQualifiedName(n.typeName) ? n.typeName.right : n.typeName);
        if (id) out.push({ id, isNew: false });
        (n.typeArguments ?? []).forEach(visit);
        return;
      }
      if (ts.isNewExpression(n)) {
        const e = n.expression;
        const id = ts.isIdentifier(e) ? targetOf(e) : ts.isPropertyAccessExpression(e) ? targetOf(e.name) : null;
        if (id) out.push({ id, isNew: true });
        (n.typeArguments ?? []).forEach(visit);
        (n.arguments ?? []).forEach(visit);
        if (!id) visit(e);
        return;
      }
      if (ts.isVariableDeclaration(n) && !n.type) {
        // A local variable without an annotation uses the type that the checker infers for it.
        for (const id of refsOfType(checker.getTypeAtLocation(n.name))) out.push({ id, isNew: false });
      }
      if (ts.isIdentifier(n)) {
        // A value use such as Radius.of(…) or GameState.initial.
        const id = targetOf(n);
        if (id) out.push({ id, isNew: false });
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return out;
  };

  // Collect the model types that a checker type names. It covers attributes without an annotation.
  const refsOfType = (type, out = new Set(), depth = 0) => {
    if (!type || depth > 4) return out;
    for (const sym of [type.aliasSymbol, type.getSymbol()]) {
      for (const d of sym?.declarations ?? []) if (decls.has(d)) out.add(decls.get(d));
    }
    if (type.isUnionOrIntersection()) for (const t of type.types) refsOfType(t, out, depth + 1);
    for (const t of type.aliasTypeArguments ?? []) refsOfType(t, out, depth + 1);
    if (type.flags & ts.TypeFlags.Object && type.objectFlags & ts.ObjectFlags.Reference) {
      for (const t of checker.getTypeArguments(type)) refsOfType(t, out, depth + 1);
    }
    return out;
  };

  // The UML multiplicity of an attribute: `*` for a collection, `0..1` for an optional value, else `1`.
  const multiplicity = (node, typeNode, optional) => {
    let many = false;
    let maybe = optional;
    const visit = (t) => {
      if (!t) return;
      if (ts.isParenthesizedTypeNode(t) || ts.isTypeOperatorNode(t)) return visit(t.type);
      if (ts.isArrayTypeNode(t) || ts.isTupleTypeNode(t)) many = true;
      else if (ts.isTypeReferenceNode(t) && COLLECTIONS.has(t.typeName.getText())) many = true;
      else if (ts.isUnionTypeNode(t)) t.types.forEach(visit);
      else if (t.kind === ts.SyntaxKind.UndefinedKeyword) maybe = true;
      else if (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword) maybe = true;
    };
    if (typeNode) visit(typeNode);
    else {
      const type = checker.getTypeAtLocation(node);
      const parts = type.isUnion() ? type.types : [type];
      for (const p of parts) {
        if (p.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) maybe = true;
        else if (checker.isArrayType(p) || checker.isTupleType(p) || COLLECTIONS.has(p.getSymbol()?.name)) many = true;
      }
    }
    return many ? '*' : maybe ? '0..1' : '1';
  };

  const visibility = (node) => {
    if (node.name && ts.isPrivateIdentifier(node.name)) return '-';
    if (hasMod(node, ts.ModifierFlags.Private)) return '-';
    if (hasMod(node, ts.ModifierFlags.Protected)) return '#';
    return '+';
  };
  const memberName = (node) => (ts.isPrivateIdentifier(node.name) ? node.name.text.slice(1) : node.name.getText());
  const paramText = (p) => `${p.dotDotDotToken ? '...' : ''}${p.name.getText()}${p.questionToken || p.initializer ? '?' : ''}: ${typeText(p, p.type)}`;
  const returnText = (node) => {
    if (node.type) return clean(node.type.getText());
    const sig = checker.getSignatureFromDeclaration(node);
    return sig ? clean(checker.typeToString(checker.getReturnTypeOfSignature(sig), node, flags)) : 'void';
  };
  const typeParams = (node) =>
    (node.typeParameters ?? []).map((tp) => ({
      name: tp.name.text,
      constraint: tp.constraint ? clean(tp.constraint.getText()) : null,
      default: tp.default ? clean(tp.default.getText()) : null,
    }));

  // Pass 2: members and uses. Each pair keeps its attribute uses, its `new` and the operations that use it.
  const types = [];
  const pairs = new Map(); // "from|to" -> { from, to, kind, attrs: Map, create, ops: [] }
  const pairOf = (from, to) => {
    const key = `${from}|${to}`;
    if (!pairs.has(key)) pairs.set(key, { from, to, heritage: null, attrs: new Map(), create: false, ops: [] });
    return pairs.get(key);
  };
  const useAttr = (from, refs, name, mult) => {
    for (const to of refs) if (to !== from) pairOf(from, to).attrs.set(name, mult);
  };
  const useIn = (from, hits, opLabel) => {
    for (const { id, isNew } of hits) {
      if (id === from) continue;
      const p = pairOf(from, id);
      if (isNew) p.create = true;
      else if (!p.ops.includes(opLabel)) p.ops.push(opLabel);
    }
  };
  const ids = (hits) => [...new Set(hits.filter((h) => !h.isNew).map((h) => h.id))];

  // Read one attribute: a property, a parameter property or an accessor.
  const attrOf = (t, m, typeNode, extra = {}) => {
    const optional = !!m.questionToken;
    const name = memberName(m);
    const attr = {
      vis: visibility(m),
      name,
      type: typeText(m, typeNode),
      static: hasMod(m, ts.ModifierFlags.Static),
      readonly: hasMod(m, ts.ModifierFlags.Readonly),
      optional,
      ...extra,
    };
    t.attrs.push(attr);
    const refs = typeNode ? ids(refsIn(typeNode)) : [...refsOfType(checker.getTypeAtLocation(m))];
    useAttr(t.id, refs, name, multiplicity(m, typeNode, optional));
  };

  // Read one operation: a method, a function-valued property or a call signature.
  const opOf = (t, m, name, fn, isStatic = false) => {
    t.ops.push({
      vis: m.name ? visibility(m) : '+',
      name,
      typeParams: typeParams(fn),
      params: fn.parameters.map(paramText),
      ret: returnText(fn),
      abstract: hasMod(m, ts.ModifierFlags.Abstract),
      static: isStatic || hasMod(m, ts.ModifierFlags.Static),
    });
    const label = `${name}()`;
    for (const p of fn.parameters) useIn(t.id, refsIn(p.type), label);
    useIn(t.id, refsIn(fn.type), label);
    useIn(t.id, refsIn(fn.body), label);
  };

  const readObjectMembers = (t, members) => {
    for (const m of members) {
      if (ts.isPropertySignature(m) || ts.isPropertyDeclaration(m)) {
        if (m.type && ts.isFunctionTypeNode(m.type)) opOf(t, m, memberName(m), m.type);
        else if (m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer))) {
          opOf(t, m, memberName(m), m.initializer, hasMod(m, ts.ModifierFlags.Static));
        } else {
          attrOf(t, m, m.type);
          useIn(t.id, refsIn(m.initializer), 'constructor()');
        }
      } else if (ts.isMethodSignature(m) || ts.isMethodDeclaration(m)) {
        opOf(t, m, memberName(m), m);
      } else if (ts.isCallSignatureDeclaration(m)) {
        opOf(t, m, '()', m);
      }
    }
  };

  // A `const` object or a companion object: methods and arrow functions are operations.
  const readConstObject = (t, obj) => {
    for (const p of obj.properties) {
      if (ts.isMethodDeclaration(p)) opOf(t, p, memberName(p), p);
      else if (ts.isPropertyAssignment(p) && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) {
        opOf(t, p, memberName(p), p.initializer);
      } else if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) {
        attrOf(t, p, null, { readonly: true });
      }
    }
  };

  for (const [id, entry] of entries) {
    const { node, sf } = entry;
    const t = {
      id,
      name: entry.name,
      kind: '',
      abstract: false,
      exported: entry.exported,
      file: rel(sf.fileName),
      line: lineOf(node),
      typeParams: entry.isConst ? [] : typeParams(node),
      attrs: [],
      ops: [],
      values: [],
      alias: null,
    };
    if (entry.isConst) {
      t.kind = 'const';
      readConstObject(t, entry.obj);
    } else if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      t.kind = ts.isClassDeclaration(node) ? 'class' : 'interface';
      t.abstract = ts.isClassDeclaration(node) && hasMod(node, ts.ModifierFlags.Abstract);
      for (const clause of node.heritageClauses ?? []) {
        const kind = clause.token === ts.SyntaxKind.ImplementsKeyword ? 'implements' : 'extends';
        for (const h of clause.types) {
          const e = h.expression;
          const target = ts.isIdentifier(e) ? targetOf(e) : ts.isPropertyAccessExpression(e) ? targetOf(e.name) : null;
          if (target && target !== id) pairOf(id, target).heritage = kind;
          // A type argument of a heritage clause binds a template parameter: a use with «bind».
          for (const arg of h.typeArguments ?? []) useIn(id, refsIn(arg), '«bind»');
        }
      }
      // A get accessor is an attribute. It is read-only when the class has no set accessor of the same name.
      // The members keep their source order.
      const accessors = (kind) => new Set(node.members.filter(kind).map(memberName));
      const setters = accessors(ts.isSetAccessorDeclaration);
      const getters = accessors(ts.isGetAccessorDeclaration);
      for (const m of node.members) {
        if (ts.isConstructorDeclaration(m)) {
          const isField = (p) => ts.getCombinedModifierFlags(p) & ts.ModifierFlags.ParameterPropertyModifier;
          for (const p of m.parameters) if (isField(p)) attrOf(t, p, p.type);
          t.ops.push({ vis: visibility(m), name: 'constructor', typeParams: [], params: m.parameters.map(paramText), ret: null, abstract: false, static: false });
          for (const p of m.parameters) if (!isField(p)) useIn(id, refsIn(p.type), 'constructor()');
          useIn(id, refsIn(m.body), 'constructor()');
        } else if (ts.isGetAccessorDeclaration(m)) {
          const name = memberName(m);
          const typeNode = m.type ?? null;
          t.attrs.push({ vis: visibility(m), name, type: returnText(m), static: hasMod(m, ts.ModifierFlags.Static), readonly: !setters.has(name), optional: false });
          const refs = typeNode ? ids(refsIn(typeNode)) : [...refsOfType(checker.getReturnTypeOfSignature(checker.getSignatureFromDeclaration(m)))];
          useAttr(id, refs, name, multiplicity(m, typeNode, false));
          useIn(id, refsIn(m.body), `${name}()`);
        } else if (ts.isSetAccessorDeclaration(m)) {
          const name = memberName(m);
          if (!getters.has(name)) attrOf(t, m, m.parameters[0]?.type ?? null);
          useIn(id, refsIn(m.body), `${name}()`);
        } else {
          readObjectMembers(t, [m]);
        }
      }
    } else if (ts.isTypeAliasDeclaration(node)) {
      const tn = node.type;
      if (ts.isUnionTypeNode(tn) && tn.types.every((x) => ts.isLiteralTypeNode(x))) {
        t.kind = 'union';
        t.values = tn.types.map((x) => x.getText());
      } else if (ts.isTypeLiteralNode(tn)) {
        t.kind = 'type';
        readObjectMembers(t, tn.members);
      } else {
        t.kind = 'type';
        t.alias = clean(tn.getText());
        useIn(id, refsIn(tn), null);
      }
    } else if (ts.isEnumDeclaration(node)) {
      t.kind = 'enum';
      t.values = node.members.map((m) => m.name.getText());
    }
    if (entry.companion) readConstObject(t, entry.companion.obj);
    types.push(t);
  }

  // Turn the pairs into lines. A pair gives its heritage line and its use line.
  // A Decorator implements the interface that it also holds, so both lines can exist.
  // `merge.mjs` drops the use next to the heritage unless a view turns it into a diamond.
  const capped = (list) => (list.length > LABEL_CAP ? `${list.slice(0, LABEL_CAP).join(', ')}, …` : list.join(', '));
  const edges = [];
  for (const p of pairs.values()) {
    if (p.heritage) edges.push({ from: p.from, to: p.to, kind: p.heritage, label: null, viaAttr: false });
    if (!p.attrs.size && !p.create && !p.ops.length) continue;
    let label;
    if (p.attrs.size) label = capped([...p.attrs].map(([n, m]) => `${n} ${m}`));
    else if (p.create) label = '«create»';
    else label = p.ops.some((o) => o) ? capped(p.ops.filter((o) => o)) : null;
    edges.push({ from: p.from, to: p.to, kind: 'use', label, viaAttr: p.attrs.size > 0 });
  }

  const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    repo: repoName(repo),
    head: git(repo, 'rev-parse', '--short=7', 'HEAD'),
    types: types.sort((a, b) => byText(a.file, b.file) || a.line - b.line || byText(a.id, b.id)),
    edges: edges.sort((a, b) => byText(a.from, b.from) || byText(a.to, b.to) || byText(a.kind, b.kind)),
  };
}

function main(argv) {
  const [repoArg, outArg] = argv;
  if (!repoArg || !outArg) {
    console.error('usage: node extract.mjs <repo-root> <out.json>');
    process.exit(2);
  }
  const model = extract(repoArg);
  fs.writeFileSync(outArg, JSON.stringify(model, null, 2) + '\n');
  const count = (k) => model.types.filter((x) => x.kind === k).length;
  const kinds = ['class', 'interface', 'union', 'type', 'enum', 'const'].map((k) => `${k} ${count(k)}`).join(', ');
  console.log(`${model.repo}@${model.head}: ${model.types.length} types (${kinds}), ${model.edges.length} lines`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main(process.argv.slice(2));
