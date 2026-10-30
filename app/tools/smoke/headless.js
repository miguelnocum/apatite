#!/usr/bin/env node
/* Runs the page smoke test in a headless Chromium with a throwaway profile, so it needs no visible window.
   Usage: node app/tools/smoke/headless.js <page path> <report name>     (serve.py must be running)
     e.g. node app/tools/smoke/headless.js /native/notebook-old.html old
   Compare two runs made this way (old page against new), not a run against baseline/: headless layout can differ from a
   visible browser's. Set APATITE_CHROMIUM to the browser's binary if it isn't one of those listed below. */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [page, name] = process.argv.slice(2);
if (!page || !name) {
  console.error('usage: headless.js <page path> <report name>');
  process.exit(2);
}
const CANDIDATES = [
  process.env.APATITE_CHROMIUM,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const binary = CANDIDATES.find(p => p && fs.existsSync(p));
if (!binary) {
  console.error('no Chromium browser found: set APATITE_CHROMIUM');
  process.exit(2);
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'apatite-smoke-'));
const browser = spawn(binary, [
  '--headless=new',
  '--remote-debugging-port=0',
  '--user-data-dir=' + profile,
  '--no-first-run',
  '--window-size=1400,1000',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  'about:blank',
]);

function finish(code) {
  browser.kill();
  setTimeout(() => {
    fs.rmSync(profile, { recursive: true, force: true });
    process.exit(code);
  }, 500);
}

function devToolsUrl() {
  return new Promise((resolve, reject) => {
    let seen = '';
    browser.stderr.on('data', d => {
      seen += d;
      const m = seen.match(/DevTools listening on (ws:\S+)/);
      if (m) resolve(m[1]);
    });
    browser.on('exit', () => reject(new Error('the browser exited: ' + seen.slice(-500))));
  });
}

function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise(resolve => {
      pending.set(++id, resolve);
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  return new Promise(resolve => ws.addEventListener('open', () => resolve(send)));
}

async function main() {
  const send = await connect(await devToolsUrl());
  const target = await send('Target.createTarget', { url: 'about:blank' });
  const attached = await send('Target.attachToTarget', { targetId: target.result.targetId, flatten: true });
  const session = attached.result.sessionId;
  const inPage = (method, params) => send(method, params, session);
  await inPage('Page.enable');
  await inPage('Emulation.setFocusEmulationEnabled', { enabled: true });
  await inPage('Page.navigate', { url: 'http://localhost:8766' + page });
  await new Promise(r => setTimeout(r, 3000));
  /* the promise is awaited here, with no timeout: runSmokeTo posts the report before it resolves */
  const run = await inPage('Runtime.evaluate', {
    expression: `(async () => {
      eval(await (await fetch('/app/tools/smoke/page-smoke.js')).text());
      await runSmokeTo(${JSON.stringify(name)});
      return 'done';
    })()`,
    awaitPromise: true,
  });
  if (run.result && run.result.exceptionDetails) throw new Error(JSON.stringify(run.result.exceptionDetails).slice(0, 800));
  console.log(name, 'done');
}

main().then(
  () => finish(0),
  e => {
    console.error(e.message);
    finish(1);
  }
);
