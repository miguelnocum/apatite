// Bundles the page's modules into the one script the page runs, and prints it on stdout.
//   node bundle.js <scripts dir> [--minify]
// The entry is <scripts dir>/app/start.js: it imports every module's init function and calls them in the order that matters
// (see there). esbuild follows the imports from it; a .js file in the folder that nothing imports is an error, so a file
// cannot be forgotten. The output is not minified (unless asked): one IIFE, each module's code under a "// path" line.
// Names the Mac app calls (window.nb*) are assigned to window by the modules, so bundling does not touch them.
'use strict';
const fs = require('fs');
const path = require('path');

/* esbuild is a native program, installed for the architecture npm ran under. An x86_64 Python (Homebrew's, under Rosetta)
   starts a universal Node as x86_64, which then cannot run an arm64-only install: start Node again as arm64 then. */
const modules = path.join(__dirname, 'node_modules', '@esbuild');
if (
  process.platform === 'darwin' &&
  process.arch === 'x64' &&
  !process.env.APATITE_REEXEC &&
  !fs.existsSync(path.join(modules, 'darwin-x64')) &&
  fs.existsSync(path.join(modules, 'darwin-arm64'))
) {
  const again = require('child_process').spawnSync(
    'arch',
    ['-arm64', process.execPath, __filename, ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: Object.assign({}, process.env, { APATITE_REEXEC: '1' })
    }
  );
  process.exit(again.status === null ? 1 : again.status);
}

let esbuild;
try {
  esbuild = require('esbuild');
} catch (e) {
  console.error('bundle.js: esbuild is not installed. Building the page needs Node: run `npm ci` in app/tools first.');
  process.exit(2);
}

const dir = path.resolve(process.argv[2]);
const minify = process.argv.includes('--minify');

/* every .js file under the folder, as a path relative to it */
function jsFiles(folder) {
  return fs.readdirSync(path.join(dir, folder), { withFileTypes: true }).flatMap(entry => {
    const rel = path.join(folder, entry.name);
    return entry.isDirectory() ? jsFiles(rel) : entry.name.endsWith('.js') ? [rel.split(path.sep).join('/')] : [];
  });
}

let result;
try {
  result = esbuild.buildSync({
    entryPoints: ['app/start.js'],
    absWorkingDir: dir,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    write: false,
    metafile: true,
    treeShaking: false, // keep every function, as the page had them
    charset: 'utf8',
    minify,
    logLevel: 'error'
  });
} catch (e) {
  process.exit(1); // esbuild has printed what is wrong
}
const bundled = new Set(Object.keys(result.metafile.inputs));
const orphans = jsFiles('').filter(rel => !bundled.has(rel));
if (orphans.length) {
  console.error('bundle.js: not imported by anything reachable from app/start.js:\n  ' + orphans.join('\n  '));
  process.exit(1);
}
process.stdout.write(result.outputFiles[0].text);
