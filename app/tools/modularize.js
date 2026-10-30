// One-off codemod (Phase 2): turns web/scripts/ from files that share one scope into ES modules.
//
//   node modularize.js <scripts dir> [--out <dir>]      (without --out the files are rewritten in place)
//
// It reads <scripts dir>/order.txt (the old load order), parses every file with acorn, and with eslint-scope works out
// each file's free identifiers and which other file declares them. From that it writes:
//   - `import { ... } from '...'` for every name a file takes from another one, and `export` on the declarations those
//     names come from;
//   - for a variable that another file ASSIGNS (an import is read-only): `export function setX(value)` next to its
//     declaration, and `x = v` in the other file becomes `setX(v)`;
//   - the load-time SIDE EFFECTS (listeners, `window.nb* = ...`, `Store.x = ...`, `if (NATIVE) ...`, and declarations
//     whose initializer is not a plain constant) move into `export function initFile()` in their own file, in their
//     original order. A listener or method written inline (`document.addEventListener('keydown', e => {...})`)
//     stays where it is as `const onFileKeydown = e => {...}`, and the init function registers it;
//   - app/start.js becomes the entry module: it imports every init function and calls them in the order order.txt had,
//     then runs its own statements (the first paint and boot()).
// Pure declarations (functions, classes, literals, regexps, Sets...) stay at the top level of their module.
// It checks, with the import graph, that a pure top-level value reading another module's binding is evaluated after it.
// Run it once on the files as they were (git: ba08163); the result is committed, this script is kept to show how.
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const escope = require('eslint-scope');

const args = process.argv.slice(2);
const dir = path.resolve(args[0]);
const outFlag = args.indexOf('--out');
const outDir = outFlag >= 0 ? path.resolve(args[outFlag + 1]) : dir;
const ENTRY = 'app/start.js';

const order = fs
  .readFileSync(path.join(dir, 'order.txt'), 'utf8')
  .split('\n')
  .map(s => s.trim())
  .filter(s => s && s[0] !== '#');

/* ---------- reading ---------- */
const files = order.map((rel, idx) => {
  const src = fs.readFileSync(path.join(dir, rel), 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module', ranges: true });
  const scopes = escope.analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
  const stem = path.basename(rel, '.js');
  return { rel, idx, src, ast, scopes, top: scopes.scopes.find(s => s.type === 'module'), stem, edits: [], needs: new Map() };
});
const byRel = new Map(files.map(f => [f.rel, f]));
const pascal = s => s.replace(/(^|[-_])([a-z0-9])/gi, (_, __, c) => c.toUpperCase());
const camel = s => pascal(s)[0].toLowerCase() + pascal(s).slice(1);

/* name -> { file, kind: function|class|var|let|const, stmt } */
const declOf = new Map();
for (const f of files) {
  for (const v of f.top.variables) {
    const def = v.defs[0];
    const kind = def.type === 'FunctionName' ? 'function' : def.type === 'ClassName' ? 'class' : def.parent.kind;
    if (declOf.has(v.name)) fail('declared twice: ' + v.name + ' (' + declOf.get(v.name).file.rel + ', ' + f.rel + ')');
    declOf.set(v.name, { file: f, kind, name: v.name, stmt: def.type === 'Variable' ? def.parent : def.node });
  }
}
const taken = new Set(declOf.keys()); // every name in use, to make sure new ones are unique
function fail(message) {
  console.error('modularize: ' + message);
  process.exit(1);
}
function fresh(name) {
  let n = name;
  for (let i = 2; taken.has(n); i++) n = name + i;
  taken.add(n);
  return n;
}

/* ---------- what is pure (may stay at the top level of its module) ---------- */
const GLOBALS_OK = new Set(['window', 'document', 'navigator', 'customElements', 'Math', 'Object', 'Array', 'String',
  'Number', 'Boolean', 'JSON', 'Symbol', 'undefined', 'Infinity', 'NaN', 'Set', 'Map', 'WeakMap', 'WeakSet', 'RegExp', 'localStorage']);
const PURE_NEW = new Set(['Set', 'Map', 'WeakMap', 'WeakSet', 'RegExp', 'Array']);
const PURE_STATIC = { Object: ['keys', 'values', 'entries', 'assign', 'fromEntries', 'freeze'], Array: ['from', 'isArray', 'of'],
  Math: null, String: ['fromCharCode', 'raw'], Number: ['isFinite', 'isInteger'], JSON: ['stringify'] };
const PURE_METHODS = new Set(['join', 'concat', 'slice', 'split', 'replace', 'replaceAll', 'indexOf', 'includes', 'toLowerCase',
  'toUpperCase', 'trim', 'reverse', 'flat', 'repeat', 'padStart', 'startsWith', 'endsWith']);
const settled = new Map(); // name -> true (value is there at import time) | false (set in init)
let why = '';
const localStack = []; // the parameters of the callbacks being looked into
const CALLBACK_METHODS = new Set(['map', 'filter', 'flatMap', 'some', 'every', 'find']);
const review = [];
const initName = new Map(), setterName = new Map(), evalOrder = new Map(); // kept declarations that read something, for the report

/* is the expression free of side effects and of anything that is not there yet at import time? collects the names read */
function pure(node, deps) {
  if (!node) return true;
  switch (node.type) {
    case 'Literal':
      return true;
    case 'TemplateLiteral':
      return node.expressions.every(e => pure(e, deps));
    case 'Identifier': {
      if (localStack.some(l => l.has(node.name))) return true;
      const d = declOf.get(node.name);
      if (!d) return GLOBALS_OK.has(node.name) || ((why = 'global ' + node.name), false);
      if (d.kind === 'function') return true;
      if (settled.get(node.name) !== true) return ((why = 'not settled ' + node.name), false);
      deps.add(node.name);
      return true;
    }
    case 'MemberExpression':
      return pure(node.object, deps) && (!node.computed || pure(node.property, deps));
    case 'ArrayExpression':
      return node.elements.every(e => !e || pure(e, deps));
    case 'SpreadElement':
      return pure(node.argument, deps);
    case 'ObjectExpression':
      return node.properties.every(
        p => p.type === 'SpreadElement' ? pure(p.argument, deps) : (!p.computed || pure(p.key, deps)) && pure(p.value, deps)
      );
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return true;
    case 'UnaryExpression':
      return node.operator !== 'delete' && pure(node.argument, deps);
    case 'BinaryExpression':
    case 'LogicalExpression':
      return pure(node.left, deps) && pure(node.right, deps);
    case 'ConditionalExpression':
      return pure(node.test, deps) && pure(node.consequent, deps) && pure(node.alternate, deps);
    case 'NewExpression':
      return node.callee.type === 'Identifier' && PURE_NEW.has(node.callee.name) && node.arguments.every(a => pure(a, deps));
    case 'CallExpression': {
      const c = node.callee;
      const callback = a => {
        // a callback run on the spot: an arrow with an expression body, looked into with its parameters known
        if (a.type !== 'ArrowFunctionExpression' || a.body.type === 'BlockStatement' || !a.params.every(p => p.type === 'Identifier' || p.type === 'ArrayPattern')) return false;
        localStack.push(new Set(a.params.flatMap(p => boundNames(p))));
        const ok = pure(a.body, deps);
        localStack.pop();
        return ok;
      };
      const isFn = a => a.type === 'FunctionExpression' || a.type === 'ArrowFunctionExpression';
      const method = c.type === 'MemberExpression' && !c.computed ? c.property.name : '';
      const argsPure = node.arguments.every(a => (isFn(a) ? CALLBACK_METHODS.has(method) && callback(a) : pure(a, deps)));
      if (!argsPure) return false;
      if (c.type === 'Identifier') return ['String', 'Number', 'Boolean', 'parseInt', 'parseFloat'].includes(c.name);
      if (c.type !== 'MemberExpression' || c.computed) return false;
      const m = c.property.name;
      if (c.object.type === 'Identifier' && c.object.name in PURE_STATIC && !declOf.has(c.object.name)) {
        const list = PURE_STATIC[c.object.name];
        return list === null || list.includes(m);
      }
      if (c.object.type === 'Identifier' && c.object.name === 'customElements' && m === 'get') return true;
      return (PURE_METHODS.has(m) || CALLBACK_METHODS.has(m)) && pure(c.object, deps);
    }
    default:
      why = node.type + ' ' + String(node.callee && (node.callee.name || node.callee.property && node.callee.property.name));
      return false;
  }
}

const exportedNames = new Set(); // names other files import
const forceSplit = new Set(); // pure declarations that have to move to init, found below
const PINS = []; // modules the entry imports first, found below
function boundNames(pattern, out = []) {
  switch (pattern.type) {
    case 'Identifier': out.push(pattern.name); break;
    case 'ObjectPattern': pattern.properties.forEach(p => boundNames(p.type === 'RestElement' ? p.argument : p.value, out)); break;
    case 'ArrayPattern': pattern.elements.forEach(e => e && boundNames(e, out)); break;
    case 'AssignmentPattern': boundNames(pattern.left, out); break;
    case 'RestElement': boundNames(pattern.argument, out); break;
  }
  return out;
}

function classify(f, unit) {
  const s = unit.stmt;
  if (s.type === 'FunctionDeclaration') return;
  if (s.type === 'ClassDeclaration') {
    const deps = new Set();
    if (s.superClass && !pure(s.superClass, deps)) fail(f.rel + ': class ' + s.id.name + ' extends something not settled');
    if (s.body.body.some(m => m.type === 'PropertyDefinition' || m.type === 'StaticBlock')) fail(f.rel + ': class ' + s.id.name + ' has static or field members');
    settled.set(s.id.name, true);
    if (deps.size) review.push([f.rel, 'class ' + s.id.name + ' extends', [...deps], null]);
    return;
  }
  if (s.type === 'VariableDeclaration') {
    const depsAll = new Set();
    const forced = s.declarations.some(d => boundNames(d.id).some(n => forceSplit.has(n)));
    const ok = !forced && s.declarations.every(d => d.init && d.id.type === 'Identifier' ? pure(d.init, depsAll) : !d.init && d.id.type === 'Identifier');
    const names = s.declarations.flatMap(d => boundNames(d.id));
    names.forEach(n => settled.set(n, ok));
    if (ok) {
      if (depsAll.size) review.push([f.rel, names.join(','), [...depsAll], names]);
      return;
    }
    unit.kind = 'split';
    if (!forced) console.log('split ' + f.rel + ' ' + names.join(',') + ': ' + why);
    return;
  }
  if (s.type === 'ExpressionStatement') {
    const e = s.expression;
    const isFn = n => n && (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');
    if (e.type === 'CallExpression' && e.callee.type === 'MemberExpression' && !e.callee.computed && e.callee.property.name === 'addEventListener'
        && e.arguments.length >= 2 && e.arguments[0].type === 'Literal' && typeof e.arguments[0].value === 'string' && isFn(e.arguments[1])) {
      const target = e.callee.object;
      const t = target.type === 'Identifier' && target.name === 'document' ? '' : target.type === 'Identifier' && target.name === 'window' ? 'Window'
        : target.type === 'CallExpression' && target.arguments[0] && target.arguments[0].type === 'Literal' ? pascal(String(target.arguments[0].value)) : '';
      unit.kind = 'listener';
      unit.fn = e.arguments[1];
      unit.name = fresh('on' + pascal(f.stem).replace(/-/g, '') + t + pascal(e.arguments[0].value));
      return;
    }
    if (e.type === 'AssignmentExpression' && e.operator === '=' && e.left.type === 'MemberExpression' && isFn(e.right)) {
      const chain = [];
      for (let n = e.left; ; n = n.object) {
        if (n.type === 'MemberExpression' && !n.computed) chain.unshift(n.property.name);
        else if (n.type === 'Identifier') { chain.unshift(n.name); break; } else fail(f.rel + ': odd assignment target');
      }
      unit.kind = 'method';
      unit.fn = e.right;
      unit.name = fresh(chain[0] === 'window' ? chain.slice(1).join('') : camel(chain.map(pascal).join('')));
      return;
    }
  }
  unit.kind = 'effect';
}

function analyze() {
  settled.clear(); review.length = 0; exportedNames.clear(); taken.clear(); declOf.forEach((_, n) => taken.add(n));
  for (const f of files) { f.edits = []; f.needs = new Map(); }
for (const f of files) {
  f.units = [];
  let prevEnd = 0;
  for (const stmt of f.ast.body) {
    let end = stmt.end;
    const tail = /^[ \t]*(\/\/[^\n]*|\/\*[^\n]*?\*\/)[ \t]*(?=\n|$)/.exec(f.src.slice(end));
    if (tail) end += tail[0].length;
    const unit = { stmt, lead: [prevEnd, stmt.start], end, kind: 'keep' };
    prevEnd = end;
    f.units.push(unit);
    if (f.rel === ENTRY) {
      if (/Declaration$/.test(stmt.type)) fail(ENTRY + ' declares something');
      unit.kind = 'entry';
      continue;
    }
    classify(f, unit);
  }
  f.tailText = f.src.slice(prevEnd);
}

/* ---------- imports, exports, setters ---------- */
initName.clear();
for (const f of files) {
  if (f.rel !== ENTRY && f.units.some(u => u.kind !== 'keep')) initName.set(f.rel, fresh('init' + pascal(f.stem)));
}
// a unit that only defines a handler const needs no init by itself, but its registration does
setterName.clear();
for (const f of files) {
  const assignAt = new Map(), updateAt = new Map();
  walk.full(f.ast, node => {
    if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') assignAt.set(node.left.start, node);
    if (node.type === 'UpdateExpression' && node.argument.type === 'Identifier') updateAt.set(node.argument.start, node);
  });
  for (const r of f.top.through) {
    const d = declOf.get(r.identifier.name);
    if (!d || d.file === f) continue;
    const name = d.name;
    const need = f.needs.get(d.file) || new Set();
    f.needs.set(d.file, need);
    if (r.isRead()) need.add(name);
    exportedNames.add(name);
    if (r.isWrite()) {
      if (d.kind === 'function' || d.kind === 'class' || d.kind === 'const') fail(f.rel + ': assigns to ' + d.kind + ' ' + name);
      const node = assignAt.get(r.identifier.start), up = updateAt.get(r.identifier.start);
      let setter = setterName.get(name);
      if (!setter) { setter = fresh('set' + name[0].toUpperCase() + name.slice(1)); setterName.set(name, setter); }
      need.add(setter);
      exportedNames.add(setter);
      if (node) {
        if (!['=', '+=', '-=', '*=', '/=', '||=', '&&=', '??='].includes(node.operator)) fail(f.rel + ': operator ' + node.operator);
        if (['||=', '&&=', '??='].includes(node.operator)) fail(f.rel + ': logical assignment to ' + name);
        const op = node.operator === '=' ? '' : name + ' ' + node.operator.slice(0, -1) + ' ';
        f.edits.push([node.start, node.right.start, setter + '(' + op], [node.end, node.end, ')']);
      } else if (up && up.prefix === false && (r.isRead())) {
        f.edits.push([up.start, up.end, setter + '(' + name + (up.operator === '++' ? ' + 1' : ' - 1') + ')']);
      } else fail(f.rel + ': cannot rewrite the write to ' + name + ' at ' + r.identifier.start);
    }
  }
}

  const entry = byRel.get(ENTRY);
  for (const g of files) if (initName.has(g.rel)) entry.needs.set(g, new Set([...(entry.needs.get(g) || []), initName.get(g.rel)]));
/* ---------- module evaluation order (a depth first walk of the imports, as the language does) ---------- */
evalOrder.clear();
(function simulate() {
  const seen = new Set();
  const visit = f => {
    if (seen.has(f)) return;
    seen.add(f);
    const own = [...f.needs.keys()].sort((a, b) => a.idx - b.idx);
    for (const g of f.rel === ENTRY ? PINS.map(r => byRel.get(r)).concat(own, files.filter(x => initName.has(x.rel))) : own) visit(g);
    evalOrder.set(f.rel, evalOrder.size);
  };
  visit(byRel.get(ENTRY));
})();
  let again = false;
  for (const [rel, what, deps, names] of review) {
    const f = byRel.get(rel);
    for (const n of deps) {
      const g = declOf.get(n).file;
      if (g === f) continue;
      const ok = evalOrder.get(g.rel) < evalOrder.get(rel);
      if (ok) continue;
      if (names) names.forEach(x => forceSplit.add(x));
      else if (!PINS.includes(rel)) PINS.push(rel);
      else fail(rel + ' ' + what + ' reads ' + n + ' from ' + g.rel + ' and cannot be put right');
      again = true;
    }
  }
  return !again;
}
for (let tries = 0; !analyze(); tries++) if (tries > 5) fail('the order check does not settle');
for (const [rel, what, deps] of review) for (const n of deps) if (declOf.get(n).file.rel !== rel) console.log('checked ' + rel + ' ' + what + ' reads ' + n + ' from ' + declOf.get(n).file.rel + ': evaluated after it');
if (forceSplit.size) console.log('moved to init so they are set after what they read: ' + [...forceSplit].join(', '));
if (PINS.length) console.log('imported first by the entry (a class that extends one of a cycle): ' + PINS.join(', '));

/* ---------- writing ---------- */
const importPath = (from, to) => {
  const rel = path.relative(path.dirname(path.join(dir, from.rel)), path.join(dir, to.rel)).split(path.sep).join('/');
  return rel.startsWith('.') ? rel : './' + rel;
};
function render(f, start, end) {
  const edits = f.edits.filter(e => e[0] >= start && e[1] <= end).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let out = '', at = start;
  for (const [s, e, text] of edits) {
    out += f.src.slice(at, s) + text;
    at = e;
  }
  return out + f.src.slice(at, end);
}
const BANNER = /^[ \t]*\/\*\s*[-=]{3,}.*[-=]{3,}\s*\*\/[ \t]*$/;
function splitLead(text) {
  // the section banners ("===== state =====") stay where they are; any other comment goes with its statement
  const stay = [], go = [];
  for (const line of text.split('\n')) (BANNER.test(line) ? stay : go).push(line);
  return [stay.join('\n'), go.join('\n').replace(/^\s*\n/, '')];
}

const stats = { files: files.length, inits: 0, listeners: 0, methods: 0, splits: 0, setters: 0, effects: 0, exports: 0 };
for (const f of files) {
  const imports = [...f.needs.entries()]
    .filter(([, names]) => names.size)
    .sort(([a], [b]) => a.idx - b.idx)
    .map(([g, names]) => `import { ${[...names].sort().join(', ')} } from '${importPath(f, g)}';`);
  let body = '';
  const init = [];
  for (const u of f.units) {
    const s = u.stmt;
    const lead = f.src.slice(u.lead[0], u.lead[1]);
    const text = () => render(f, s.start, u.end);
    const names = s.type === 'VariableDeclaration' ? s.declarations.flatMap(d => boundNames(d.id)) : s.id ? [s.id.name] : [];
    const exp = names.some(n => exportedNames.has(n)) ? 'export ' : '';
    if (exp) stats.exports++;
    switch (u.kind) {
      case 'entry':
        body += lead + text();
        break;
      case 'keep': {
        body += lead + exp + text();
        for (const n of names) if (setterName.has(n)) { stats.setters++; body += `\nexport function ${setterName.get(n)}(value) {\n  ${n} = value;\n  return value;\n}`; }
        break;
      }
      case 'split': {
        stats.splits++;
        const [stay, go] = splitLead(lead);
        const kind = 'let';
        const tail = u.end - s.end > 0 ? f.src.slice(s.end, u.end) : '';
        body += stay + (stay ? '\n' : '') + go + '\n' + exp + kind + ' ' + names.join(', ') + ';' + tail;
        for (const n of names) if (setterName.has(n)) { stats.setters++; body += `\nexport function ${setterName.get(n)}(value) {\n  ${n} = value;\n  return value;\n}`; }
        for (const d of s.declarations) {
          if (!d.init) continue;
          const left = d.id.type === 'Identifier' ? d.id.name : render(f, d.id.start, d.id.end);
          init.push(d.id.type === 'Identifier' ? `${left} = ${render(f, d.init.start, d.init.end)};` : `(${left} = ${render(f, d.init.start, d.init.end)});`);
        }
        break;
      }
      case 'listener':
      case 'method': {
        stats[u.kind === 'listener' ? 'listeners' : 'methods']++;
        body += lead + `const ${u.name} = ${render(f, u.fn.start, u.fn.end)};` + f.src.slice(s.end, u.end);
        init.push(render(f, s.start, u.fn.start) + u.name + render(f, u.fn.end, s.end));
        break;
      }
      case 'effect': {
        stats.effects++;
        const [stay, go] = splitLead(lead);
        if (stay.trim()) body += stay + '\n';
        init.push((go.trim() ? go.replace(/\s+$/, '') + '\n' : '') + render(f, s.start, u.end));
        break;
      }
    }
  }
  let out;
  if (f.rel === ENTRY) {
    const calls = files.filter(g => initName.has(g.rel));
    const head = PINS.map(rel => `import '${importPath(f, byRel.get(rel))}';`).concat(imports).join('\n');
    out = head + '\n\n// The page\'s load-time code runs from here: each module\'s own setup is its init function, called in the order the\n'
      + '// scripts used to be joined in (it matters: listeners on the same event run in the order they were added, the\n'
      + '// Store is replaced by the Mac app\'s before boot, ...).\n'
      + calls.map(g => initName.get(g.rel) + '();').join('\n') + '\n\n' + body.replace(/^\s+/, '');
    stats.inits += calls.length;
  } else {
    out = (imports.length ? imports.join('\n') + '\n\n' : '') + body.replace(/^\n+/, '') + f.tailText;
    if (initName.has(f.rel)) out = out.replace(/\s*$/, '\n') + `\nexport function ${initName.get(f.rel)}() {\n${init.join('\n')}\n}\n`;
  }
  const dest = path.join(outDir, f.rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
}
console.log(JSON.stringify(stats));
