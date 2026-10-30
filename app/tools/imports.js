// Import graph of the page's modules: the layering rule (areas.txt) and the size of the import cycles.
//   node imports.js <scripts dir> [--graph]     prints the report; exits 1 on a rule violation or when cycles got worse
//   --graph also lists which files are in a cycle
// areas.txt says which area may import which; cycles.txt holds the number of files in cycles we accept (it may only go down).
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const escope = require('eslint-scope');

const dir = path.resolve(process.argv[2]);
const here = __dirname;

function jsFiles(folder) {
  return fs.readdirSync(path.join(dir, folder), { withFileTypes: true }).flatMap(entry => {
    const rel = folder ? folder + '/' + entry.name : entry.name;
    return entry.isDirectory() ? jsFiles(rel) : entry.name.endsWith('.js') ? [rel] : [];
  });
}

function parse(rel) {
  return acorn.parse(fs.readFileSync(path.join(dir, rel), 'utf8'), { ecmaVersion: 2022, sourceType: 'module', ranges: true });
}

function importsOf(rel, ast) {
  return ast.body
    .filter(n => (n.type === 'ImportDeclaration' || (n.type === 'ExportNamedDeclaration' && n.source)))
    .map(n => path.posix.normalize(path.posix.join(path.posix.dirname(rel), n.source.value)));
}

/* areas.txt: "area: area area ..." means the first may import the others (and itself); "@name = a b c" names a group */
function readAreas() {
  const allowed = new Map(), groups = new Map();
  for (const line of fs.readFileSync(path.join(here, 'areas.txt'), 'utf8').split('\n')) {
    const text = line.replace(/#.*/, '').trim();
    if (!text) continue;
    if (text[0] === '@') groups.set(text.split('=')[0].trim(), text.split('=')[1].trim().split(/\s+/));
    else {
      const [name, rest] = text.split(':');
      allowed.set(name.trim(), new Set((rest || '').split(/\s+/).filter(Boolean).flatMap(a => groups.get(a) || [a])));
    }
  }
  return allowed;
}

/* strongly connected components (Tarjan): the files that import each other round and round */
function components(graph) {
  let index = 0;
  const stack = [], idx = new Map(), low = new Map(), on = new Set(), out = [];
  function visit(v) {
    idx.set(v, index); low.set(v, index++); stack.push(v); on.add(v);
    for (const w of graph.get(v)) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) !== idx.get(v)) return;
    const comp = [];
    for (let w; w !== v; ) { w = stack.pop(); on.delete(w); comp.push(w); }
    out.push(comp);
  }
  for (const v of graph.keys()) if (!idx.has(v)) visit(v);
  return out;
}


/* module evaluation order, as the language does it: imports in the order written, depth first (the entry first of all) */
function evaluationOrder(graph) {
  const done = new Map(), seen = new Set();
  const visit = f => {
    if (seen.has(f)) return;
    seen.add(f);
    graph.get(f).forEach(visit);
    done.set(f, done.size);
  };
  visit('app/start.js');
  return done;
}

/* what each module exports that is not a function (a function is hoisted, anything else is undefined until its module ran) */
function exportedValues(rel, ast) {
  const names = new Set();
  for (const n of ast.body) {
    const d = n.type === 'ExportNamedDeclaration' && n.declaration;
    if (!d) continue;
    if (d.type === 'VariableDeclaration') d.declarations.forEach(x => names.add(x.id.name));
    else if (d.type === 'ClassDeclaration') names.add(d.id.name);
  }
  return names;
}

/* top-level code (not inside any function) that reads an imported class or variable must run after that module did */
function eagerReads(graph, asts) {
  const when = evaluationOrder(graph), values = new Map([...asts].map(([f, ast]) => [f, exportedValues(f, ast)])), found = [];
  for (const [rel, ast] of asts) {
    const top = escope.analyze(ast, { ecmaVersion: 2022, sourceType: 'module' }).scopes.find(s => s.type === 'module');
    for (const ref of top.references) {
      const def = ref.resolved && ref.resolved.defs[0];
      if (!def || def.type !== 'ImportBinding' || !def.node.imported) continue;
      const from = path.posix.normalize(path.posix.join(path.posix.dirname(rel), def.parent.source.value));
      if (values.get(from).has(def.node.imported.name) && when.get(from) > when.get(rel)) found.push(rel + ' reads ' + ref.identifier.name + ' from ' + from + ' before it has run');
    }
  }
  return found;
}

const files = jsFiles('');
const asts = new Map(files.map(f => [f, parse(f)]));
const graph = new Map(files.map(f => [f, importsOf(f, asts.get(f))]));
const area = f => f.split('/')[0];
const allowed = readAreas();
const bad = [];
for (const [from, tos] of graph) {
  for (const to of tos) {
    if (area(from) === area(to)) continue;
    if (!allowed.has(area(from))) bad.push(from + ' (area "' + area(from) + '" is not in areas.txt)');
    else if (!allowed.get(area(from)).has(area(to))) bad.push(from + ' imports ' + to);
  }
}
const unique = [...new Set(bad)];
const cyclic = components(graph).filter(c => c.length > 1 || graph.get(c[0]).includes(c[0]));
const inCycles = cyclic.reduce((n, c) => n + c.length, 0);
const coreOut = bad.filter(b => b.startsWith('core/')).length;
const early = eagerReads(graph, asts);
const limit = +fs.readFileSync(path.join(here, 'cycles.txt'), 'utf8').trim();

console.log('files: ' + files.length + '   in import cycles: ' + inCycles + ' (largest cycle ' + Math.max(0, ...cyclic.map(c => c.length)) + ', accepted at most ' + limit + ')');
console.log('imports against areas.txt: ' + unique.length + '   (from core: ' + coreOut + ')');
for (const b of unique) console.log('  ' + b);
console.log('top-level reads of an import that has not run yet: ' + early.length);
for (const e of early) console.log('  ' + e);
if (process.argv.includes('--graph')) for (const c of cyclic) console.log('cycle: ' + c.sort().join(' '));
if (inCycles > limit) console.log('import cycles got worse: ' + inCycles + ' files, accepted ' + limit + ' (lower app/tools/cycles.txt only when they went down)');
process.exit(bad.length || early.length || inCycles > limit ? 1 : 0);
