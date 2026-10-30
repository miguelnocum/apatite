// Lists the functions in a folder of scripts (and its subfolders) that are longer than a limit (in lines; nested functions counted on their own).
// Usage: node fnlen.js ../../web/scripts [limit=20] [how many to list=40]
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const [dir, limitArg, showArg] = process.argv.slice(2);
const limit = +(limitArg || 20);
const show = +(showArg || 40);

/* a function's name: its own, the method or property it is, or the variable it's assigned to */
function nameOf(fn, ancestors) {
  if (fn.id) return fn.id.name;
  const parent = ancestors[ancestors.length - 2];
  if (parent && (parent.type === 'MethodDefinition' || parent.type === 'Property') && parent.key)
    return parent.key.name || parent.key.value;
  if (parent && parent.type === 'VariableDeclarator') return parent.id.name;
  return '(anonymous)';
}

function longFunctions(file) {
  const source = fs.readFileSync(path.join(dir, file), 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'module', locations: true });
  const found = { total: 0, over: [] };
  walk.fullAncestor(ast, (node, state, ancestors) => {
    if (!/Function/.test(node.type)) return;
    found.total++;
    const lines = node.loc.end.line - node.loc.start.line + 1;
    if (lines > limit) found.over.push([lines, file + ':' + node.loc.start.line, nameOf(node, ancestors)]);
  });
  return found;
}

/* every .js file under the folder, as a path relative to it */
function jsFiles(folder) {
  return fs
    .readdirSync(path.join(dir, folder), { withFileTypes: true })
    .flatMap(entry => {
      const rel = path.join(folder, entry.name);
      return entry.isDirectory() ? jsFiles(rel) : entry.name.endsWith('.js') ? [rel] : [];
    })
    .sort();
}

const files = jsFiles('');
const results = files.map(longFunctions);
const over = results.flatMap(r => r.over).sort((a, b) => b[0] - a[0]);
const total = results.reduce((sum, r) => sum + r.total, 0);
console.log('functions', total, 'over', limit, 'lines:', over.length);
for (const entry of over.slice(0, show)) console.log(entry.join('  '));
