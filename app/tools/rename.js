// Renames a top-level binding that modules share, scope-aware (eslint-scope), in the declaring module and in every module
// that imports it:   node rename.js <scripts dir> <declaring file> <old> <new> [<old> <new> ...]
// Only the variable is renamed: a property of the same name (x.pts, { pts: 1 }) is left alone, and a shorthand { pts } becomes
// { pts: syllabusPoints }, so saved JSON keys do not change. A local binding that happens to share the name (another scope's
// own `pts`) is a different variable and is left alone. It refuses when the new name is already in use in a file it would edit.
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');
const escope = require('eslint-scope');

const dir = path.resolve(process.argv[2]);
const declaring = process.argv[3];
const pairs = process.argv.slice(4);

function jsFiles(folder) {
  return fs.readdirSync(path.join(dir, folder), { withFileTypes: true }).flatMap(entry => {
    const rel = folder ? folder + '/' + entry.name : entry.name;
    return entry.isDirectory() ? jsFiles(rel) : entry.name.endsWith('.js') ? [rel] : [];
  });
}

function rename(oldName, newName) {
  const edits = new Map();
  for (const rel of jsFiles('')) {
    const src = fs.readFileSync(path.join(dir, rel), 'utf8');
    const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module', ranges: true });
    const manager = escope.analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
    const top = manager.scopes.find(s => s.type === 'module');
    const variable = top.set.get(oldName);
    if (!variable) continue;
    const def = variable.defs[0];
    const mine = rel === declaring && def.type !== 'ImportBinding';
    const imported =
      def.type === 'ImportBinding' &&
      def.node.imported.name === oldName &&
      def.node.local.name === oldName &&
      path.posix.normalize(path.posix.join(path.posix.dirname(rel), def.parent.source.value)) === declaring;
    if (!mine && !imported) continue;
    const used = new Set(manager.scopes.flatMap(s => [...s.set.keys()]).concat(top.through.map(r => r.identifier.name)));
    if (used.has(newName)) throw new Error(rel + ' already has a variable called ' + newName);
    const shorthand = new Map();
    walk.full(ast, node => {
      if (node.type === 'Property' && node.shorthand) shorthand.set(node.key.start, node);
    });
    const list = [];
    const at = id => {
      const prop = shorthand.get(id.start);
      if (prop && prop.value.type !== 'Identifier') throw new Error(rel + ': shorthand with a default at ' + id.start);
      list.push([id.start, id.end, prop ? oldName + ': ' + newName : newName]);
    };
    if (imported) list.push([def.node.start, def.node.end, newName]);
    else variable.identifiers.forEach(at);
    variable.references.forEach(r => at(r.identifier));
    edits.set(rel, { src, list });
  }
  if (!edits.size) throw new Error('nothing named ' + oldName + ' in ' + declaring);
  for (const [rel, { src, list }] of edits) {
    const seen = new Set();
    let out = src;
    for (const [start, end, text] of list.sort((a, b) => b[0] - a[0])) {
      if (seen.has(start)) continue;
      seen.add(start);
      out = out.slice(0, start) + text + out.slice(end);
    }
    fs.writeFileSync(path.join(dir, rel), out);
  }
  console.log(oldName + ' -> ' + newName + ': ' + edits.size + ' files, ' + [...edits.values()].reduce((n, e) => n + e.list.length, 0) + ' places');
}

for (let i = 0; i < pairs.length; i += 2) rename(pairs[i], pairs[i + 1]);
