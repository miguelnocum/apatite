/* Page smoke test: drives the notebook page's features and returns a report of what they produced.
   A refactor must leave the report unchanged.

   Run it on the page as the Mac app runs it (the "native" page: serve.py puts a fake WKWebView bridge and a fixture
   notebook in front of notebook.html, see fake-bridge.js; the page's scripts are not touched):
     python3 app/tools/smoke/serve.py                 (port 8766; leave it running)
     app/tools/smoke/build-old.sh [rev=HEAD]          notebook-old.html from that commit (a tag will do, e.g. phase0-baseline)
                                                      and notebook.html from the working copy
   then, for each page (old, new), in the browser pane (or any browser) with that page in FRONT:
     1. in the console: localStorage.clear(); sessionStorage.clear();   then open the page afresh (not a reload from the console):
        http://localhost:8766/native/notebook-old.html   (new: …/native/notebook.html; the web page, for comparison: …/app/Resources/notebook.html)
     2. in its console (don't await it: a run takes 5 to 10 minutes, and the console would time out):
        eval(await (await fetch('/app/tools/smoke/page-smoke.js')).text()); runSmokeTo('old');
        (…'new' for the other page.) The report is saved as app/tools/smoke/reports/<name>.json, and what the page sent the
        bridge as <name>-bridge.json. app/tools/smoke/wait.sh <name> waits for it.
   and compare: python3 app/tools/smoke/compare.py old new      (prints SAME, or the steps that differ)
   The report of the baseline commit is kept in app/tools/smoke/baseline/native.json (see baseline/README.txt for what in it
   is expected to fail): to check a change against it without building the old page, run the new one and
     python3 app/tools/smoke/compare.py baseline/native.json new

   Keep the page in front while it runs: a hidden page's timers are throttled, which changes what some steps see
   (the empty line added after a quote 400ms after an edit, for one). Driving the wait from the page itself keeps it
   awake. */
window.runSmoke = async function () {
  const report = {};
  const errors = [];
  let current = 'start';
  const onError = e => errors.push(current + ': ' + String(e.message || e.reason || e));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  /* ids and timestamps differ between runs; they're replaced so two runs compare equal */
  const norm = s =>
    String(s == null ? '' : s)
      .replace(/\b(?:pm|cm|es|fn|eq|k)(?=[a-z0-9]*\d)[a-z0-9]{6,}\b/g, '<id>')
      .replace(/(data-key\w+=")k[a-z0-9]{8}/g, '$1<id>')
      .replace(/(data-cmt(?:id)?=")[^"]+/g, '$1<id>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
      .replace(/\b1[6-9]\d{11}\b/g, '<time>')
      .replace(/\s+/g, ' ')
      .trim();
  const text = (el, n = 400) => norm(el ? el.innerText : '<missing>').slice(0, n);
  const html = (el, n = 600) => norm(el ? el.innerHTML : '<missing>').slice(0, n);
  const click = el => {
    if (!el) throw new Error('nothing to click');
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    el.click();
  };
  const key = (k, opts = {}) =>
    (document.activeElement || document.body).dispatchEvent(
      new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts))
    );
  const view = async v => {
    const tab = $('[data-view="' + v + '"]');
    /* in the Mac app (and so on the native page) the Syllabus or Works Cited tab that is showing goes back to the notes
       when clicked; a step that wants the view shown has it already */
    if (!(window.__posted && (v === 'syl' || v === 'wc') && tab && tab.getAttribute('aria-pressed') === 'true'))
      click(tab);
    await wait(250);
  };
  /* the caret at the end of the editor's last paragraph */
  const caretAtEnd = () => {
    const ed = $('#ed');
    const blocks = ed.querySelectorAll('p,li,h1,h2,h3');
    const last = blocks[blocks.length - 1] || ed;
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(last);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    return last;
  };
  /* a fresh paragraph at the end of the notes (never inside a list left by an earlier step), the caret at its end */
  const newLine = text => {
    const ed = $('#ed');
    const p = document.createElement('p');
    if (text) p.textContent = text;
    else p.appendChild(document.createElement('br'));
    ed.appendChild(p);
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  };
  /* selects text in an element, then waits for the page to notice (it keeps the selection on selectionchange, which comes a
     moment later; a person is never quicker than that) */
  const selectText = async (el, from, to) => {
    const node = [...el.childNodes].find(n => n.nodeType === 3) || el.firstChild;
    const r = document.createRange();
    r.setStart(node, from);
    r.setEnd(node, Math.min(to, node.length));
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    await wait(30);
  };
  const menu = async name => {
    click($('[data-menu="' + name + '"]'));
    await wait(120);
    const m = $('.tbmenu');
    const items = m ? $$('.tbmenu button').map(b => norm(b.innerText)) : ['<no menu>'];
    return items;
  };
  const closeMenus = async () => {
    key('Escape');
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wait(80);
  };
  const step = async (name, fn) => {
    current = name;
    try {
      sessionStorage.setItem('smoke-step', name); // (to see where a run stopped, if the page reloads)
    } catch (x) {}
    try {
      report[name] = await fn();
    } catch (e) {
      report[name] = 'THREW: ' + e.message;
    }
  };

  /* ---- the views ---- */
  await step('syllabus view', async () => {
    await view('syl');
    return { rows: $$('#main tr').length, start: text($('#main'), 300) };
  });
  await step('works cited view', async () => {
    await view('wc');
    return text($('#main'), 300);
  });
  await step('essay view', async () => {
    await view('essay');
    return { main: text($('#main'), 200), side: text($('#side'), 300) };
  });
  await step('notes view', async () => {
    await view('notes');
    return { toolbar: $$('#tb .tbtn').length, start: text($('#ed'), 200) };
  });

  /* ---- writing and formatting in the notes ---- */
  await step('typing', async () => {
    newLine('Smoke line one with some words to format');
    await wait(100);
    return html($('#ed').lastElementChild, 300);
  });
  await step('bold and italic', async () => {
    const p = $('#ed').lastElementChild;
    await selectText(p, 0, 5);
    click($('[data-cmd="bold"]'));
    await selectText(p.lastChild.nodeType === 3 ? p : p, 0, 3);
    click($('[data-cmd="italic"]'));
    await wait(80);
    return html($('#ed').lastElementChild, 300);
  });
  await step('highlight', async () => {
    newLine('Highlight me please');
    await selectText($('#ed').lastElementChild, 0, 9);
    click($('[data-cmd="hl"]'));
    await wait(80);
    return html($('#ed').lastElementChild, 300);
  });
  for (const name of ['head', 'list', 'ins', 'hl', 'cmt', 'zoom']) {
    await step('menu ' + name, async () => {
      caretAtEnd();
      const items = await menu(name);
      await closeMenus();
      return items;
    });
  }
  await step('heading 2', async () => {
    newLine('A smoke heading');
    await menu('head');
    click([...document.querySelectorAll('.tbmenu button')].find(b => /Heading 2/.test(b.innerText)));
    await wait(100);
    return norm($('#ed').lastElementChild.outerHTML).slice(0, 200);
  });
  await step('bullet list', async () => {
    newLine('First bullet');
    await menu('list');
    click($('.tbmenu [data-mi="ul"]'));
    await wait(100);
    return html($('#ed').lastElementChild, 200);
  });
  await step('comment', async () => {
    newLine('Comment on this text');
    await selectText($('#ed').lastElementChild, 0, 7);
    await menu('cmt');
    const first = $('.tbmenu button[data-mi^="cmt:"]');
    if (first) click(first);
    await wait(250);
    return { mark: html($('#ed').lastElementChild, 300), cards: $$('#cmts .cmtcard').length };
  });

  await step('toolbar actions', async () => {
    const out = {};
    const keyOn = (el, k, opts = {}) =>
      el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts)));
    /* a link with ⌘K, then removed */
    newLine('Link this text');
    await selectText($('#ed').lastElementChild, 0, 4);
    keyOn($('#ed'), 'k', { metaKey: true });
    await wait(100);
    const url = $('#lkurl');
    if (url) {
      url.value = 'example.com';
      keyOn(url, 'Enter');
      await wait(100);
    }
    out.link = html($('#ed').lastElementChild, 200);
    const a = $('#ed').lastElementChild.querySelector('a');
    if (a) {
      const r = document.createRange();
      r.setStart(a.firstChild, 2);
      r.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      keyOn($('#ed'), 'k', { metaKey: true });
      await wait(100);
      const unlink = $('.tbmenu [data-mi="unlink"]');
      if (unlink) click(unlink);
      await wait(100);
    }
    out.unlinked = html($('#ed').lastElementChild, 200);
    /* a highlight colour from the menu, then removed */
    newLine('Colour this text');
    await selectText($('#ed').lastElementChild, 0, 6);
    await menu('hl');
    const second = $$('.tbmenu [data-hc]')[1];
    if (second) click(second);
    await wait(100);
    out.highlightColour = html($('#ed').lastElementChild, 200);
    const highlighted = $('#ed').lastElementChild.querySelector('mark,span[style]') || $('#ed').lastElementChild;
    await selectText(highlighted, 0, 3);
    await menu('hl');
    click($('.tbmenu [data-mi="hl0"]'));
    await wait(100);
    out.highlightRemoved = html($('#ed').lastElementChild, 200);
    /* ⌘B */
    newLine('Bold by key');
    await selectText($('#ed').lastElementChild, 0, 4);
    keyOn($('#ed'), 'b', { metaKey: true });
    await wait(50);
    out.boldKey = html($('#ed').lastElementChild, 200);
    /* Tab and ⇧Tab in a bulleted list */
    newLine('Outer bullet');
    await menu('list');
    click($('.tbmenu [data-mi="ul"]'));
    await wait(80);
    document.execCommand('insertParagraph');
    document.execCommand('insertText', false, 'Inner bullet');
    keyOn($('#ed'), 'Tab');
    await wait(80);
    out.indented = html($('#ed').lastElementChild, 300);
    keyOn($('#ed'), 'Tab', { shiftKey: true });
    await wait(80);
    out.outdented = html($('#ed').lastElementChild, 300);
    /* a checklist item ticked by its box */
    newLine('Tick me');
    await menu('list');
    click($('.tbmenu [data-mi="todo"]'));
    await wait(80);
    const item = $('#ed ul[data-todo]>li:last-child');
    if (item) {
      const box = item.getBoundingClientRect();
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: box.left - 8, clientY: box.top + 4 }));
    }
    out.ticked = item ? item.getAttribute('data-done') : 'no checklist';
    /* a table, and Tab to its next cell */
    newLine('');
    await menu('ins');
    click($('.tbmenu [data-mi="table"]'));
    await wait(150);
    const table = [...$$('#ed table')].pop();
    if (table) {
      const cells = [...table.querySelectorAll('td,th')];
      const r = document.createRange();
      r.selectNodeContents(cells[0]);
      r.collapse(false);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      keyOn($('#ed'), 'Tab');
      await wait(50);
      const at = getSelection().anchorNode;
      out.tableTab = cells.findIndex(c => c === at || c.contains(at)) + ' of ' + cells.length;
    } else out.tableTab = 'no table';
    /* comments shown and hidden from the menu, and zoom levels from the zoom menu */
    await menu('cmt');
    out.commentToggle = norm($('.tbmenu [data-mi="cmtshow"]').textContent);
    click($('.tbmenu [data-mi="cmtshow"]'));
    await wait(80);
    await menu('cmt');
    out.commentToggleAfter = norm($('.tbmenu [data-mi="cmtshow"]').textContent);
    await closeMenus();
    await menu('zoom');
    click($('.tbmenu [data-mi="zoom:1.5"]'));
    await wait(80);
    out.zoomMenu = $('#zlab').textContent;
    await menu('zoom');
    click($('.tbmenu [data-mi="zoom:fit"]'));
    await wait(80);
    out.zoomFit = $('#zlab').textContent;
    return out;
  });

  /* ---- zoom ---- */
  await step('zoom', async () => {
    const label = () => $('#zlab').textContent;
    const out = [label()];
    for (const d of ['1', '1', '-1', '-1', '-1']) {
      click($('[data-zoom="' + d + '"]'));
      await wait(80);
      out.push(label());
    }
    return out;
  });

  /* ---- settings ---- */
  await step('settings', async () => {
    click($('#setbtn'));
    await wait(150);
    const out = {};
    for (const b of $$('.setov [data-setsec]')) {
      click(b);
      await wait(60);
      out[b.dataset.setsec] = text($('.setov .setbody'), 160);
    }
    click($('.setov [data-setsec="theme"]'));
    click($('.setov [data-wst="nord"]'));
    out.themeAfter =
      document.documentElement.getAttribute('data-skin') + '/' + document.documentElement.getAttribute('data-theme');
    click($('.setov [data-wst="graphite"]'));
    key('Escape');
    $('.setov') && $('.setov').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(80);
    out.closed = !$('.setov');
    return out;
  });

  await step('settings actions', async () => {
    const KEY = 'syllabus-notebook-v1';
    const stored = () =>
      Object.keys(localStorage)
        .filter(k => /-(write|latex|zoomstart|zfold|eqsaved|eqpins)$/.test(k))
        .sort()
        .map(k => k.replace(KEY, '') + '=' + localStorage.getItem(k))
        .join(' | ');
    localStorage.setItem(
      KEY + '-eqsaved',
      JSON.stringify([
        { n: 'Saved one', t: 'a^2' },
        { n: 'Saved two', t: 'b_1' }
      ])
    );
    localStorage.setItem(KEY + '-eqpins', JSON.stringify(['\\alpha', '\\beta', '\\gamma']));
    click($('#setbtn'));
    await wait(120);
    const body = () => $('.setov .setbody');
    const section = async name => {
      click($('.setov [data-setsec="' + name + '"]'));
      await wait(60);
    };
    const input = (el, value, type = 'input') => {
      el.value = value;
      el.dispatchEvent(new Event(type, { bubbles: true }));
    };
    const out = {};
    await section('write');
    input(body().querySelector('#wssize'), '18');
    input(body().querySelector('#wslh'), '1.9');
    input(body().querySelector('#wsps'), '1.2');
    out.writeOutputs = [...body().querySelectorAll('output')].map(o => o.textContent);
    input(body().querySelector('#wsfont'), Object.values(body().querySelector('#wsfont').options)[2].value, 'change');
    const tw = body().querySelector('#wstw');
    tw.checked = true;
    tw.dispatchEvent(new Event('change', { bubbles: true }));
    out.writeStored = stored();
    out.cssVars = ['--edf', '--eds', '--edl', '--edp'].map(v => document.documentElement.style.getPropertyValue(v));
    click(body().querySelector('[data-wsreset]'));
    await wait(60);
    out.afterReset = stored();
    await section('key');
    click(body().querySelector('[data-keyadd]'));
    await wait(60);
    const means = body().querySelectorAll('[data-keymean]');
    input(means[means.length - 1], 'Smoke meaning');
    input(body().querySelector('[data-keyhex]'), '#123456');
    await wait(600);
    click(body().querySelector('[data-keyhide]'));
    await wait(60);
    out.keyAfterHide = text(body(), 400);
    const back = body().querySelector('[data-keyback]');
    if (back) input(back, back.options[1].value, 'change');
    await wait(60);
    out.keyAfterPutBack = html(body().querySelector('.setkey'), 900);
    await section('eq');
    input(body().querySelector('input[name=seteqm][value=t]'), 't', 'change');
    input(body().querySelector('[data-eqname="1"]'), 'Renamed two');
    click(body().querySelector('[data-eqdel2="0"]'));
    await wait(60);
    click(body().querySelector('[data-unpin="1"]'));
    await wait(60);
    out.eqAfterEdits = text(body(), 400);
    click(body().querySelector('[data-unpinall]'));
    await wait(60);
    out.eqStored = stored();
    await section('zoom');
    input(body().querySelector('[data-zoomstart]'), '1.5', 'change');
    const fold = body().querySelector('[data-zfold]');
    fold.checked = false;
    fold.dispatchEvent(new Event('change', { bubbles: true }));
    out.zoomStored = stored();
    input(body().querySelector('[data-zoomstart]'), 'last', 'change');
    fold.checked = true;
    fold.dispatchEvent(new Event('change', { bubbles: true }));
    out.zoomRestored = stored();
    input(body().querySelector('input[name=seteqm]') || body(), 'v', 'change');
    click($('.setov [data-setclose]'));
    await wait(60);
    out.closed = !$('.setov');
    localStorage.removeItem(KEY + '-latex');
    return out;
  });

  /* ---- equations ---- */
  await step('block equation', async () => {
    newLine('');
    await menu('list');
    click($('.tbmenu [data-mi="math"]'));
    await wait(700);
    const pop = $('.mathpop');
    if (!pop) return 'no editor';
    const out = {
      cats: $$('.mathpop [data-mpcat]').map(b => b.title),
      strip: $$('.mathpop .mp-syms [data-symtex]').length
    };
    const ta = pop.querySelector('textarea');
    ta.value = '\\frac{a}{b}+\\phi_{10}';
    ta.dispatchEvent(new Event('input'));
    await wait(200);
    click(pop.querySelector('[data-mpcat="0"]'));
    await wait(100);
    out.fractionTiles = $$('.mathpop .mp-drop [data-mptpl]').length;
    click(pop.querySelector('[data-mpcat="0"]'));
    click(pop.querySelector('[data-mpgal]'));
    await wait(100);
    out.gallery = $$('.mathpop .mp-galdrop .mp-eqn')
      .map(e => e.textContent)
      .slice(0, 6);
    click(pop.querySelector('[data-mpgal]'));
    click(pop.querySelector('[data-mpdone]'));
    await wait(200);
    const eq = [...$$('#ed [data-math]')].pop();
    out.saved = eq && eq.getAttribute('data-math');
    out.rendered = eq ? text(eq, 80) : '';
    return out;
  });
  await step('equation editor details', async () => {
    const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
    const eq = [...$$('#ed [data-math]')].pop();
    click(eq);
    await wait(600);
    const pop = $('.mathpop');
    if (!pop) return 'no editor';
    const ta = pop.querySelector('textarea');
    const out = { markupLength: pop.innerHTML.length, markupHash: hash(norm(pop.innerHTML)) };
    /* LaTeX mode: a tile goes in the LaTeX box, and broken LaTeX is reported */
    click(pop.querySelector('[data-mpmode="t"]'));
    await wait(100);
    out.latexMode = pop.classList.contains('showtex');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    click(pop.querySelector('[data-mpcat="1"]'));
    await wait(100);
    click(pop.querySelector('.mp-drop [data-mptpl]'));
    await wait(100);
    out.afterTile = ta.value;
    ta.value = 'a^{';
    ta.dispatchEvent(new Event('input'));
    await wait(100);
    out.error = norm(pop.querySelector('.mp-err').textContent).slice(0, 60);
    ta.value = 'x+y';
    ta.dispatchEvent(new Event('input'));
    click(pop.querySelector('[data-mpmode="v"]'));
    await wait(200);
    out.visualMode = !pop.classList.contains('showtex');
    /* a symbol from the strip; then pinning one from the full list */
    click(pop.querySelector('.mp-syms [data-symtex]'));
    await wait(100);
    out.afterSymbol = ta.value;
    click(pop.querySelector('[data-mpsyms]'));
    await wait(100);
    out.symbolCells = $$('.mathpop .mp-symdrop [data-symtex]').length;
    const pin = pop.querySelector('.mp-symdrop [data-pin]');
    click(pin);
    await wait(100);
    out.stripFirstAfterPin = pop.querySelector('.mp-syms [data-symtex]').dataset.symtex;
    click(pop.querySelector('.mp-symdrop [data-pin]'));
    await wait(100);
    out.stripFirstAfterUnpin = pop.querySelector('.mp-syms [data-symtex]').dataset.symtex;
    click(pop.querySelector('[data-mpsyms]'));
    /* saving to the gallery, then removing it */
    click(pop.querySelector('[data-mpgal]'));
    await wait(100);
    click(pop.querySelector('[data-eqsave]'));
    await wait(100);
    pop.querySelector('.mp-eqname').value = 'Smoke saved';
    click(pop.querySelector('[data-eqsaveok]'));
    await wait(100);
    click(pop.querySelector('[data-mpgal]'));
    await wait(100);
    out.galleryAfterSave = $$('.mathpop .mp-galdrop .mp-eqn')
      .map(e => e.textContent)
      .slice(0, 2);
    click(pop.querySelector('[data-eqdel="0"]'));
    await wait(100);
    out.galleryAfterDelete = $$('.mathpop .mp-galdrop .mp-eqn')
      .map(e => e.textContent)
      .slice(0, 2);
    click(pop.querySelector('[data-mpgal]'));
    /* Return adds a line, Backspace in an empty one removes it */
    const field = pop.querySelector('math-field');
    if (field) {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await wait(100);
      out.linesAfterReturn = pop.querySelectorAll('math-field').length;
      const second = pop.querySelectorAll('math-field')[1];
      if (second)
        second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
      await wait(100);
      out.linesAfterBackspace = pop.querySelectorAll('math-field').length;
    }
    /* explaining a selection when nothing is selected says so */
    click(pop.querySelector('[data-mpann]'));
    click(pop.querySelector('[data-annsel]'));
    await wait(50);
    out.explainNothing = $('#toast').textContent;
    click(pop.querySelector('[data-mpann]'));
    click(pop.querySelector('[data-mpdone]'));
    await wait(150);
    out.saved = eq.getAttribute('data-math');
    return out;
  });
  await step('delete an equation', async () => {
    newLine('');
    await menu('list');
    click($('.tbmenu [data-mi="math"]'));
    await wait(600);
    const before = $$('#ed [data-math]').length;
    const pop = $('.mathpop');
    pop.querySelector('textarea').value = 'z';
    pop.querySelector('textarea').dispatchEvent(new Event('input'));
    click(pop.querySelector('[data-mpdel]'));
    await wait(150);
    return { before: before, after: $$('#ed [data-math]').length, editorOpen: !!$('.mathpop') };
  });
  await step('annotate', async () => {
    const eq = [...$$('#ed [data-math]')].pop();
    click(eq);
    await wait(600);
    const pop = $('.mathpop');
    if (!pop) return 'no editor';
    click(pop.querySelector('[data-mpann]'));
    await wait(200);
    const cand = eq.querySelector('.meq [class*="mcand"]');
    if (cand) click(cand);
    await wait(200);
    const notes = eq.getAttribute('data-math-notes');
    click(pop.querySelector('[data-mpdone]'));
    await wait(150);
    return norm(notes);
  });
  await step('inline equation', async () => {
    newLine('Inline maths ');
    await menu('list');
    const b = $('.tbmenu [data-mi="imath"]');
    if (!b) return 'no inline item';
    click(b);
    await wait(600);
    const pop = $('.mathpop');
    const ta = pop && pop.querySelector('textarea');
    if (ta) {
      ta.value = 'x_i^2';
      ta.dispatchEvent(new Event('input'));
      await wait(150);
      click(pop.querySelector('[data-mpdone]'));
      await wait(150);
    }
    const m = [...$$('#ed [data-imath]')].pop();
    return m ? m.getAttribute('data-imath') : 'none';
  });

  /* ---- essays ---- */
  await step('essay writing', async () => {
    await view('essay');
    const ed = $('#ed');
    if (!ed) return 'no editor';
    newLine('An essay sentence of eight words to count.');
    await wait(400);
    return { words: text($('#side'), 120) };
  });

  /* ---- an essay's word count: tagging from the contents, the settings, and boxes drawn in the margin ---- */
  await step('word count', async () => {
    const out = {};
    const box = () => text($('#wcbox'), 500);
    const change = (el, value) => {
      if (typeof value === 'boolean') el.checked = value;
      else el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    await view('essay');
    const ed = $('#ed');
    ed.insertAdjacentHTML(
      'beforeend',
      '<h1>1 Introduction</h1><p>Intro words one two three.</p><h1>Chapter 2: Methods</h1><p>Method words here.</p>' +
        '<h2>2.1 Sampling</h2><p>Sampling words go here now.</p><h1>References</h1><p>Smith, J. (2020) A Book.</p>'
    );
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(400);
    out.start = box();
    click($('[data-wctocall]'));
    await wait(150);
    out.everyChapter = box();
    click($('[data-wctocun]'));
    await wait(150);
    out.untagged = box();
    const loose = $$('[data-wctoc]').find(row => !row.classList.contains('on'));
    click(loose);
    await wait(150);
    out.tagOne = box();
    /* a tag's settings */
    click($('[data-wctw]'));
    await wait(100);
    const tagId = $('[data-wcname]').dataset.wcname;
    change($('[data-wcname]'), 'Opening');
    await wait(80);
    change($('[data-wctlim="' + tagId + '"]'), '3');
    await wait(80);
    change($('[data-wcexcl="' + tagId + '"]'), false);
    await wait(80);
    out.settings = box();
    change($('[data-wcopt="citations"]'), false);
    await wait(80);
    change($('[data-wclim]'), '40');
    await wait(80);
    out.options = box();
    /* word count mode: boxes beside the tagged paragraphs */
    click($('#wcmodebtn'));
    await wait(150);
    const labels = () => $$('#wclayer .wclab').map(label => norm(label.textContent));
    out.boxes = labels();
    out.locked = ed.getAttribute('contenteditable');
    const blocks = () => [...ed.children].filter(b => b.id !== 'fnlist');
    const margin = () => ed.getBoundingClientRect().left - 6;
    const dragDown = async (from, to, target) => {
      const y = el => el.getBoundingClientRect().top + 4;
      const start = target || document.elementFromPoint(margin(), y(from)) || $('.doc');
      start.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: margin(), clientY: y(from) })
      );
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: margin(), clientY: y(to) }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: margin(), clientY: y(to) }));
      await wait(300);
    };
    const plain = blocks().filter(b => b.tagName === 'P');
    await dragDown(plain[0], plain[1]);
    out.pop = text($('.tagpop'), 300);
    click($('.tagpop [data-tpnew]'));
    await wait(150);
    out.afterPreset = labels();
    await dragDown(plain[2], plain[2]);
    const name = $('.tagpop input');
    name.value = 'Typed tag';
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(150);
    out.afterTyped = labels();
    await dragDown(plain[3], plain[3]);
    click($('.tagpop [data-tpcancel]'));
    await wait(100);
    out.cancelled = !$('.tagpop') && !$('#wctemp');
    await dragDown(plain[0], plain[0]);
    click($('.tagpop [data-tpclear]'));
    await wait(150);
    out.afterClear = labels();
    /* resizing a box from its bottom handle */
    const handle = $('#wclayer [data-wcrs$=":bot"]');
    if (handle) await dragDown(plain[1], plain[3], handle);
    out.afterResize = labels();
    click($('#wclayer .wclab'));
    await wait(100);
    out.labelOpens = !!document.activeElement.dataset.wcname;
    click($('[data-wctag]'));
    await wait(80);
    click($('[data-wcdeltag]'));
    await wait(150);
    out.afterDelete = box();
    click($('#wcmodebtn'));
    await wait(150);
    out.unlocked = ed.getAttribute('contenteditable') + ' ' + !$('#wclayer');
    out.essayList = text($('#side .esl'), 200);
    return out;
  });

  /* ---- spec points: the panel, rating, going to a point's notes, and tagging the notes in the margin ---- */
  await step('spec points', async () => {
    const out = {};
    const side = () => text($('#side'), 400);
    const tagsInNotes = () =>
      [...$('#ed').children].filter(b => b.dataset.sp).map(b => b.tagName + ':' + norm(b.textContent).slice(0, 20));
    const brackets = () => $$('#splayer .splab').map(label => norm(label.textContent));
    await view('notes');
    out.panel = side();
    const rating = $('#side [data-spcyc]');
    if (rating) {
      click(rating);
      await wait(50);
      out.rated = norm($('#side [data-spcyc]').textContent);
      $('#side [data-spcyc]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      await wait(50);
      out.ratedBack = norm($('#side [data-spcyc]').textContent);
    }
    /* a point not in the notes yet gets a heading and a line; one that is, is gone to */
    const untagged = $('#side .spi.none');
    if (untagged) {
      click(untagged);
      await wait(200);
      out.addedPlace = tagsInNotes().slice(-3);
      out.caretIn = norm(getSelection().anchorNode ? getSelection().anchorNode.textContent || '(empty)' : 'none');
    }
    const tagged = $$('#side .spi').find(row => !row.classList.contains('none'));
    if (tagged) {
      click(tagged);
      await wait(200);
      out.wentTo = !!$('#ed .spflash');
    }
    /* tagging mode: drag down the margin */
    click($('#side [data-spmode]'));
    await wait(150);
    out.mode = side().slice(0, 160);
    out.gutter = !!$('#splayer .spgut');
    const plain = () => [...$('#ed').children].filter(b => b.tagName === 'P' && b.textContent.trim() && !b.dataset.sp);
    const y = el => el.getBoundingClientRect().top + 4;
    const dragMargin = async (from, to, start) => {
      const target = start || $('#splayer .spgut');
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 5, clientY: y(from) }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: y(to) }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 5, clientY: y(to) }));
      await wait(300);
    };
    const lines = plain();
    await dragMargin(lines[0], lines[1]);
    out.pick = text($('.sppick'), 200);
    const find = $('.sppick input');
    find.value = 'zzzz-nothing';
    find.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(50);
    out.pickNone = text($('.sppick .tp-list'), 60);
    find.value = '';
    find.dispatchEvent(new Event('input', { bubbles: true }));
    find.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    find.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    find.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    find.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(150);
    out.afterEnter = brackets();
    await dragMargin(lines[2], lines[2]);
    click($('.sppick [data-sppick]'));
    await wait(150);
    out.afterClick = brackets();
    await dragMargin(lines[3] || lines[2], lines[3] || lines[2]);
    click($('.sppick [data-spcancel]'));
    await wait(80);
    out.cancelled = !$('.sppick') && !$('#sptemp');
    await dragMargin(lines[2], lines[2]);
    out.clearOffered = !!$('.sppick [data-spclear]');
    if ($('.sppick [data-spclear]')) click($('.sppick [data-spclear]'));
    await wait(150);
    out.afterClear = brackets();
    /* resizing a bracket from its bottom */
    const handle = $('#splayer [data-sprs$=":bot"]');
    if (handle) await dragMargin(lines[1], lines[3] || lines[2], handle);
    out.afterResize = tagsInNotes().length;
    const label = $('#splayer [data-splab]');
    if (label) {
      label.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await wait(150);
      out.labelGoes = norm(($('#side .spi.cur') || {}).textContent || 'none').slice(0, 60);
    }
    /* hovering a point lights up its notes */
    const current = $('#side .spi.cur') || $('#side .spi');
    current.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await wait(50);
    out.hovered = $$('#ed .sphover').length;
    document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    /* Esc ends tagging */
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(100);
    out.modeOff = !$('#splayer .spgut');
    /* the Heading menu's "Tag with spec point…" */
    const line = plain()[0];
    if (line) {
      await selectText(line, 0, 3);
      await menu('head');
      const item = $('.tbmenu [data-mi="sptag"]');
      if (item) click(item);
      await wait(150);
      out.menuPick = text($('.sppick h5'), 60);
      if ($('.sppick [data-sppick]')) click($$('.sppick [data-sppick]')[1] || $('.sppick [data-sppick]'));
      await wait(150);
    }
    out.finalTags = tagsInNotes();
    out.finalPanel = side();
    click($('#side [data-spmode]'));
    await wait(100);
    return out;
  });

  /* ---- typed shortcuts: Markdown-style formatting, smart quotes and pairs, dashes and arrows, ⌘Z after ---- */
  await step('typed shortcuts', async () => {
    const out = {};
    await view('notes');
    const ed = $('#ed');
    const typeChars = async chars => {
      for (const ch of chars) {
        const before = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: ch
        });
        if (ed.dispatchEvent(before)) document.execCommand('insertText', false, ch);
      }
      await wait(30);
    };
    const press = async (k, opts = {}) => {
      const down = new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts));
      const go = ed.dispatchEvent(down);
      if (go && k === 'Enter') document.execCommand('insertParagraph');
      if (go && k === 'Backspace') document.execCommand('delete');
      await wait(40);
    };
    const tail = (n = 1) =>
      norm(
        [...ed.children]
          .slice(-n)
          .map(b => b.outerHTML)
          .join('')
      ).slice(0, 300);
    const typed = async (name, chars, n) => {
      newLine('');
      await typeChars(chars);
      out[name] = tail(n);
    };
    await typed('bold', 'a **bold** b');
    await typed('underscoreBold', 'a __bold__ b');
    await typed('italic', 'an *italic* b');
    await typed('underscoreItalic', 'an _italic_ b');
    await typed('strike', 'a ~~gone~~ b');
    await typed('code', 'a `code` b');
    await typed('mark', 'a ==marked== b');
    await typed('markColour', 'a ==🔵blue== b');
    await typed('heading', '## Typed heading');
    await typed('bullet', '- typed bullet');
    await typed('numbered', '1. typed number');
    await typed('todo', '[ ] typed todo');
    await typed('done', '[x] typed done');
    await typed('quote', '> typed quote');
    await typed('fullWidth', '＃ wide heading');
    await typed('dash', 'one -- two');
    await typed('arrows', 'a --> b <-- c <--> d ==> e <== f <==> g');
    await typed('inlineMath', 'area $x^2$ here');
    await typed('quotes', 'she said "hi" and it\'s "done" (fine) [ok] {x}');
    await typed('dollarsStay', 'costs $5 and $10');
    /* ⌘Z straight after a conversion gives back what was typed */
    newLine('');
    await typeChars('undo **this**');
    await press('z', { metaKey: true });
    out.undoInline = tail();
    newLine('');
    await typeChars('# ');
    await press('z', { metaKey: true });
    out.undoBlock = tail();
    newLine('');
    await typeChars('x -- ');
    await press('z', { metaKey: true });
    out.undoDash = tail();
    /* a callout from a quote */
    newLine('');
    await typeChars('> ');
    await typeChars('[!TIP] ');
    out.callout = tail();
    /* a divider: --- then Return */
    newLine('');
    await typeChars('---');
    await press('Enter');
    out.divider = tail(2);
    /* Return on an empty quote line leaves the quote */
    newLine('');
    await typeChars('> quoted line');
    await press('Enter');
    await press('Enter');
    out.quoteExit = tail(2);
    /* Backspace between a pair deletes both */
    newLine('');
    await typeChars('pair (');
    await press('Backspace');
    out.pairBackspace = tail();
    /* typing ) over the closing bracket steps past it */
    newLine('');
    await typeChars('(x)');
    out.closeOver = tail();
    /* the list and quote shortcuts */
    for (const [name, opts] of [
      ['cmdL', { code: 'KeyL', metaKey: true }],
      ['cmdShiftL', { code: 'KeyL', metaKey: true, shiftKey: true }],
      ['cmdShiftT', { code: 'KeyT', metaKey: true, shiftKey: true }],
      ['cmdAltS', { code: 'KeyS', metaKey: true, altKey: true }]
    ]) {
      newLine('shortcut ' + name);
      await press(opts.code.slice(3).toLowerCase(), opts);
      await wait(60);
      out[name] = tail(2);
    }
    /* typewriter scrolling, on then off */
    await press('t', { metaKey: true, ctrlKey: true });
    out.typewriter = text($('#toast'), 60);
    await press('t', { metaKey: true, ctrlKey: true });
    return out;
  });

  /* ---- an explained equation as drawn: its lines, coloured parts, note boxes and the lines to them ---- */
  await step('equation drawing', async () => {
    const out = {};
    await view('notes');
    const attr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const tex =
      'y = \\sigma(x) + \\sum_{i=1}^{n} x_i + 3.14\n\\int_0^1 x \\, dx\n' +
      '\\begin{pmatrix} a & b \\\\\n c & d \\end{pmatrix}\n\\operatorname*{arg\\,min}_w \\placeholder{} \\hat{y}';
    const notes = [
      { t: '\\sigma', c: 2, n: 'squashes $x_i$ to between 0 and 1' },
      { t: 'x', c: 1, n: 'the input\nover two lines' },
      { t: '\\sum', c: 0, n: 'adds up' },
      { t: '\\int', c: 3, n: '' },
      { t: 'nothing', c: 4, n: 'not in the equation' }
    ];
    $('#ed').insertAdjacentHTML(
      'beforeend',
      `<div data-math="${attr(tex)}" data-math-notes="${attr(JSON.stringify(notes))}"></div><p>after the equation</p>`
    );
    await view('syl');
    await view('notes');
    await wait(400);
    const eq = [...$$('#ed [data-math]')].pop();
    out.lines = eq.querySelectorAll('.meq').length;
    out.drawnAs = [...eq.querySelectorAll('annotation')].map(a => a.textContent);
    out.coloured = [...eq.querySelectorAll('.meqs [class*="mann"]')].map(
      part => /mann\d+/.exec(part.getAttribute('class'))[0] + ' ' + part.style.getPropertyValue('--ac')
    );
    const cards = () =>
      [...eq.querySelectorAll('.mcard')].map(card =>
        [card.parentNode.className, card.style.display, card.style.left, card.style.top, norm(card.innerText)].join('|')
      );
    out.cards = cards();
    out.paths = [...eq.querySelectorAll('path.mpath')].map(path => path.getAttribute('d'));
    out.rows = [...eq.querySelectorAll('.mrow')].map(row =>
      [row.style.height, row.style.marginTop, row.style.marginBottom].join(' ')
    );
    /* pointing at a part lights up it, its box and its line */
    const part = eq.querySelector('.meqs .mann1');
    if (part) part.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    out.lit = eq.querySelectorAll('.annhl').length;
    document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    out.unlit = eq.querySelectorAll('.annhl').length;
    /* writing in a note's box: typed where it stands, Esc to finish */
    const card = eq.querySelector('.mcard[data-ai="3"]');
    if (card) {
      card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      await wait(100);
      const field = card.querySelector('textarea');
      out.editing = !!field;
      if (field) {
        field.value = 'the area, $\\int f$\n';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(80);
        out.savedNote = norm(eq.getAttribute('data-math-notes'));
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await wait(150);
        out.afterEdit = cards();
        out.pathsAfterEdit = [...eq.querySelectorAll('path.mpath')].map(path => path.getAttribute('d'));
        out.rowsAfterEdit = [...eq.querySelectorAll('.mrow')].map(row =>
          [row.style.height, row.style.marginTop, row.style.marginBottom].join(' ')
        );
      }
    }
    eq.remove();
    $('#ed').dispatchEvent(new Event('input', { bubbles: true }));
    return out;
  });

  /* ---- pictures: the toolbar, wrapping and size, a caption, resizing, moving, cropping, deleting ---- */
  await step('images', async () => {
    const out = {};
    await view('notes');
    const ed = $('#ed');
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 60;
    const paint = canvas.getContext('2d');
    paint.fillStyle = '#c33';
    paint.fillRect(0, 0, 80, 60);
    paint.fillStyle = '#36c';
    paint.fillRect(20, 15, 40, 30);
    ed.insertAdjacentHTML(
      'beforeend',
      `<p>Before the picture</p><p><img src="${canvas.toDataURL('image/png')}" data-nb="1" alt=""></p>` +
        '<ul><li>first item</li><li>second item</li></ul><p>After the picture</p>'
    );
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    const image = () => [...ed.querySelectorAll('img[data-nb]')].pop();
    const bar = () => $$('.imgbar [data-it]').map(b => b.dataset.it + (b.classList.contains('on') ? '*' : ''));
    const attrs = () => {
      const img = image();
      return img
        ? [img.getAttribute('data-w'), img.getAttribute('data-wrap'), img.parentNode.tagName].join(' ')
        : 'gone';
    };
    const act = async name => {
      click($('.imgbar [data-it="' + name + '"]'));
      await wait(80);
      return attrs();
    };
    click(image());
    await wait(100);
    out.toolbar = bar();
    out.frame = !!$('#imgframe') && $('#imgframe').getAttribute('data-size');
    out.wrapLeft = await act('wrap:left');
    out.wrapRight = await act('wrap:right');
    out.inLine = await act('wrap:');
    out.small = await act('w:25');
    out.full = await act('w:100');
    out.toolbarAfter = bar();
    out.caption = await act('cap');
    out.captionHTML = norm(
      image().closest('figure')
        ? image()
            .closest('figure')
            .outerHTML.replace(/src="[^"]*"/, 'src')
        : 'none'
    );
    click(image());
    await wait(80);
    out.noCaption = await act('nocap');
    /* resizing from a corner */
    click(image());
    await wait(80);
    const corner = $('#imgframe [data-rs="1"]');
    const box = corner.getBoundingClientRect();
    corner.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: box.left, clientY: box.top })
    );
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: box.left + 60, clientY: box.top }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await wait(80);
    out.resized = attrs();
    /* moving into the list */
    const item = ed.querySelectorAll('li')[0];
    const move = $('.imgbar [data-it="move"]');
    const y = item.getBoundingClientRect().bottom;
    move.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientY: y }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: y }));
    out.dropLine = !!$('#imgdropline');
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await wait(80);
    out.moved = attrs() + ' ' + norm(image().parentNode.textContent);
    /* cropping: cancel, then a smaller frame and Done; then back to the uncropped picture */
    const original = image().getAttribute('src');
    click(image());
    await wait(80);
    click($('.imgbar [data-it="crop"]'));
    await wait(80);
    out.cropper = !!$('#cropper');
    click($('#cropper [data-cr="cancel"]'));
    await wait(80);
    out.cancelled = !$('#cropper') && image().getAttribute('src') === original;
    click($('.imgbar [data-it="crop"]'));
    await wait(80);
    const handle = $('#cropper [data-c="se"]');
    const at = handle.getBoundingClientRect();
    handle.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: at.left, clientY: at.top })
    );
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: at.left - 20, clientY: at.top - 15 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    out.cropBox = ['left', 'top', 'width', 'height'].map(side => $('#cropper .cbox').style[side]).join(' ');
    click($('#cropper [data-cr="done"]'));
    await wait(300);
    out.cropped = image().getAttribute('src') !== original;
    out.resetOffered = bar().includes('uncrop');
    if ($('.imgbar [data-it="uncrop"]')) await act('uncrop');
    out.reset = image().getAttribute('src') === original;
    /* pictures can't be dragged as files; a click elsewhere closes the toolbar */
    const drag = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    image().dispatchEvent(drag);
    out.dragBlocked = drag.defaultPrevented;
    click(ed.lastElementChild);
    await wait(50);
    out.closed = !$('.imgbar');
    click(image());
    await wait(80);
    out.deleted = await act('del');
    out.toast = text($('#toast'), 40);
    /* a footnote marker opens its note */
    const marker = $('#ed .fn');
    if (marker) {
      click(marker);
      await wait(100);
      out.footnote = !!$('.fnpop');
      click(ed.lastElementChild);
      await wait(80);
      out.footnoteClosed = !$('.fnpop');
    }
    return out;
  });

  /* ---- comments: the column of cards, filters, writing a note, changing its style, resolving, hiding ---- */
  await step('comments', async () => {
    const out = {};
    await view('notes');
    const ed = $('#ed');
    const panel = () => text($('#cmts'), 400);
    const comment = async (words, from, to, type) => {
      newLine(words);
      await selectText(ed.lastElementChild, from, to);
      await menu('cmt');
      click($('.tbmenu [data-mi="cmt:' + type + '"]') || $('.tbmenu button[data-mi^="cmt:"]'));
      await wait(150);
    };
    await comment('A question about this line', 2, 10, 'q');
    out.afterQuestion = panel();
    const field = $('#cmts .cmtcard.on textarea');
    if (field) {
      field.value = 'Why is this so?';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(50);
      out.noteSaved = norm([...ed.querySelectorAll('span[data-cmt]')].pop().outerHTML);
    }
    await comment('Something to fix here', 0, 9, 'fix');
    out.twoKinds = panel();
    newLine('Already commented');
    await selectText(ed.lastElementChild, 0, 7);
    await menu('cmt');
    click($('.tbmenu button[data-mi^="cmt:"]'));
    await wait(100);
    await selectText(ed.lastElementChild.querySelector('span[data-cmt]') || ed.lastElementChild, 0, 3);
    await menu('cmt');
    click($('.tbmenu button[data-mi^="cmt:"]'));
    await wait(100);
    out.twice = text($('#toast'), 60);
    /* filters */
    for (const filter of ['q', 'fix', '']) {
      click($('#cmts [data-cmtf="' + filter + '"]'));
      await wait(60);
      out['filter ' + (filter || 'all')] = $$('#cmts .cmtcard').length;
    }
    /* a card opens; its style changes; Done closes it */
    click($('#cmts .cmtcard:not(.on)'));
    await wait(80);
    out.opened = text($('#cmts .cmtcard.on'), 120);
    const style = $('#cmts .cmtcard.on select');
    if (style) {
      style.value = 'research';
      style.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(80);
    }
    out.restyled = panel();
    click($('#cmts [data-cmtdone]'));
    await wait(60);
    out.done = $$('#cmts .cmtcard.on').length;
    /* clicking the commented text opens its card */
    click(ed.querySelector('span[data-cmt]'));
    await wait(80);
    out.fromText = text($('#cmts .cmtcard.on .cmtq'), 80);
    out.positions = $$('#cmts .cmtcard').map(card => card.style.top);
    click($('#cmts [data-cmtresolve]'));
    await wait(80);
    out.resolved = [text($('#toast'), 40), ed.querySelectorAll('span[data-cmt]').length];
    /* hiding the column; the button that shows it in a narrow window */
    click($('#cmts [data-cmtclose]'));
    await wait(80);
    out.hidden = $('#cmts').hidden;
    out.fab = norm(($('#cmtfab') || {}).textContent);
    const marked = ed.querySelector('span[data-cmt]');
    if (marked) click(marked);
    await wait(80);
    out.reopened = !$('#cmts').hidden;
    return out;
  });

  /* ---- body, headings and quotes over several lines; callouts: inserting, Return and Backspace in them ---- */
  await step('callouts and blocks', async () => {
    const out = {};
    await view('notes');
    const ed = $('#ed');
    const tail = (n = 1) =>
      norm(
        [...ed.children]
          .slice(-n)
          .map(b => b.outerHTML)
          .join('')
      ).slice(0, 400);
    const press = async k => {
      const down = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      const go = ed.dispatchEvent(down);
      if (go && k === 'Enter') document.execCommand('insertParagraph');
      if (go && k === 'Backspace') document.execCommand('delete');
      await wait(50);
    };
    const caret = (el, atEnd) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(!atEnd);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    };
    const fromMenu = async (name, item) => {
      await menu(name);
      const button = $('.tbmenu [data-mi="' + item + '"]');
      if (button) click(button);
      await wait(100);
    };
    /* three lines (one with a citation) become a heading together, then body again */
    ed.insertAdjacentHTML(
      'beforeend',
      '<p data-sp="x1">Line one</p><p>Line two <span data-cite="">(x, x)</span> on</p><p data-wct="t1">Line three</p>'
    );
    const lines = [...ed.children].slice(-3);
    const range = document.createRange();
    range.setStart(lines[0].firstChild, 2);
    range.setEnd(lines[2].firstChild, 4);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    await wait(30);
    await fromMenu('head', 'fmt:h2');
    out.headings = tail(3);
    await fromMenu('head', 'fmt:p');
    out.body = tail(3);
    await fromMenu('list', 'quote');
    out.quoted = tail(3);
    /* a quote holding lines of its own gives them back as lines */
    ed.insertAdjacentHTML(
      'beforeend',
      '<blockquote data-sp="x2"><p>quoted one</p>loose words<p>quoted two</p></blockquote>'
    );
    caret(ed.lastElementChild.querySelector('p'), true);
    await fromMenu('head', 'fmt:p');
    out.unquoted = tail(3);
    /* callouts from the submenu: each kind, on an empty line and around a line of text */
    for (const kind of ['note', 'warning', 'def', 'pc']) {
      newLine(kind === 'def' ? 'Text to put inside' : '');
      await menu('list');
      const sub = $('.tbmenu [data-sub="callout"]');
      if (sub) sub.dispatchEvent(new MouseEvent('mouseenter'));
      await wait(80);
      out['submenu ' + kind] = $$('.tbsub button').length;
      const item = $('.tbsub [data-mi="callout:' + kind + '"]');
      if (item) click(item);
      await wait(100);
      out['callout ' + kind] = tail(2);
    }
    /* Return on the pros' empty last bullet moves across to the cons; on the cons' leaves the callout */
    const pros = ed.querySelector('[data-callout="pc"]:last-of-type [data-side="pro"] li');
    if (pros) {
      caret(pros, true);
      await press('Enter');
      out.prosEnter = norm(
        getSelection().anchorNode && getSelection().anchorNode.parentNode.closest('[data-side]')
          ? getSelection().anchorNode.parentNode.closest('[data-side]').getAttribute('data-side')
          : String(getSelection().anchorNode && getSelection().anchorNode.nodeName)
      );
      await press('Enter');
      out.consEnter = tail(2);
    }
    /* in a note callout: Return in the title goes to the first line; Return on an empty last line leaves */
    const note = [...ed.querySelectorAll('[data-callout="note"]')].pop();
    caret(note.querySelector('[data-cot]'), true);
    await press('Enter');
    out.titleEnter = norm(getSelection().anchorNode ? getSelection().anchorNode.nodeName : 'none');
    caret(note.lastElementChild, true);
    await press('Enter');
    out.leaveCallout = tail(2);
    /* Backspace: at the start of the first line goes up into the title; at the start of an empty one's title, back to a line */
    const warning = [...ed.querySelectorAll('[data-callout="warning"]')].pop();
    caret(warning.children[1], false);
    await press('Backspace');
    out.backIntoTitle = norm(getSelection().anchorNode ? getSelection().anchorNode.textContent : 'none');
    caret(warning.querySelector('[data-cot]'), false);
    await press('Backspace');
    out.backToLine = norm(warning.isConnected ? warning.outerHTML : 'replaced');
    /* an old "warn" callout without a title gets one when the notes are drawn */
    ed.insertAdjacentHTML('beforeend', '<div data-callout="warn"><p>old style</p></div>');
    await view('syl');
    await view('notes');
    out.upgraded = norm([...$('#ed').querySelectorAll('[data-callout]')].pop().outerHTML);
    return out;
  });

  /* ---- Backspace and Delete at line edges: bullets, lines starting with a citation, lines after a callout or table ---- */
  await step('line edges', async () => {
    const out = {};
    await view('notes');
    const ed = $('#ed');
    const tail = (n = 1) =>
      norm(
        [...ed.children]
          .slice(-n)
          .map(b => b.outerHTML)
          .join('')
      ).slice(0, 500);
    const press = async k => {
      const down = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      const go = ed.dispatchEvent(down);
      if (go && k === 'Backspace') document.execCommand('delete');
      if (go && k === 'Delete') document.execCommand('forwardDelete');
      await wait(50);
    };
    const caretAt = (node, offset) => {
      const range = document.createRange();
      range.setStart(node, offset);
      range.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    };
    const add = async html => {
      ed.insertAdjacentHTML('beforeend', html);
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(50);
    };
    /* a bullet: Backspace at its start makes it a line; its sub-bullets and the bullets after carry on below */
    await add('<ul data-sp="x3"><li>first</li><li>middle<ul><li>sub one</li></ul></li><li>last</li></ul>');
    const middle = ed.lastElementChild.children[1];
    caretAt(middle.firstChild, 0);
    await press('Backspace');
    out.bulletToLine = tail(3);
    /* a nested bullet goes one level out */
    await add('<ul><li>outer<ul><li>inner</li></ul></li></ul>');
    caretAt(ed.lastElementChild.querySelector('li li').firstChild, 0);
    await press('Backspace');
    out.outdent = tail();
    /* a line starting with a citation joins the line above */
    await add('<p>Line above</p><p><span data-cite="">(x, x)</span> continues here</p>');
    const second = ed.lastElementChild;
    caretAt(second, 0);
    await press('Backspace');
    out.joinBack = tail(2);
    /* Delete at the end of a line before one starting with a footnote */
    await add('<p>End here<br></p><p><span data-fn="a note"></span> next line</p>');
    const before = ed.children[ed.children.length - 2];
    caretAt(before, before.childNodes.length);
    await press('Delete');
    out.joinForward = tail(2);
    /* into a quote above: its last line */
    await add('<blockquote><p>quoted line</p></blockquote><p><span data-cite="">(x, x)</span> after the quote</p>');
    caretAt(ed.lastElementChild, 0);
    await press('Backspace');
    out.joinIntoQuote = tail(2);
    /* a line after a callout or a table isn't merged into it; an empty one goes */
    await add('<div data-callout="note"><p data-cot="">Note</p><p>inside</p></div><p>after the callout</p>');
    caretAt(ed.lastElementChild.firstChild, 0);
    await press('Backspace');
    out.afterCallout = tail(2) + ' | ' + norm(getSelection().anchorNode ? getSelection().anchorNode.textContent : '');
    await add('<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table><p><br></p><p>more</p>');
    caretAt(ed.children[ed.children.length - 2], 0);
    await press('Backspace');
    out.afterTable = tail(3) + ' | ' + norm(getSelection().anchorNode ? getSelection().anchorNode.textContent : '');
    /* zero-width places for the caret beside locked pieces */
    await add('<p><span data-cite="">(x, x)</span></p>');
    await view('syl');
    await view('notes');
    const anchored = [...$('#ed').querySelectorAll('p')].pop();
    out.caretPlaces = [...anchored.childNodes].map(n => (n.nodeType === 3 ? JSON.stringify(n.nodeValue) : n.nodeName));
    return out;
  });

  /* ---- footnotes (writing, the list under the page, deleting) and the table of contents ---- */
  await step('footnotes and contents', async () => {
    const out = {};
    await view('notes');
    const ed = $('#ed');
    const fromMenu = async (name, item) => {
      await menu(name);
      const button = $('.tbmenu [data-mi="' + item + '"]');
      if (button) click(button);
      await wait(150);
    };
    newLine('A line with a note');
    await fromMenu('ins', 'footnote');
    await wait(100);
    out.popup = text($('.fnpop h5'), 40);
    const field = $('.fnpop textarea');
    if (field) {
      field.value = 'The note itself';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(350);
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    }
    out.closed = !$('.fnpop');
    out.list = text($('#fnlist'), 300);
    const listed = $$('#fnlist li').pop();
    if (listed) click(listed);
    await wait(100);
    out.fromList = text($('.fnpop h5'), 40);
    if ($('.fnpop [data-fnact="del"]')) click($('.fnpop [data-fnact="del"]'));
    await wait(100);
    out.deleted = [text($('#toast'), 40), $$('#fnlist li').length];
    /* contents: a second one isn't added; clicking an entry goes to its heading */
    ed.insertAdjacentHTML('beforeend', '<h2>A heading for contents</h2><h3>Its subheading</h3><p>text</p>');
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(500);
    const contents = ed.querySelector('nav[data-toc]');
    out.contents = contents ? norm(contents.innerHTML).slice(-300) : 'none';
    newLine('');
    await fromMenu('ins', 'toc');
    out.secondContents = [text($('#toast'), 60), ed.querySelectorAll('nav[data-toc]').length];
    const entry = contents && [...contents.querySelectorAll('li[data-toci]')].pop();
    if (entry) click(entry);
    await wait(100);
    out.flashed = norm(($('#ed .flash') || {}).textContent || 'none');
    return out;
  });

  /* ---- folding sections, revealing folded text, and room to type after solid blocks ---- */
  await step('folding', async () => {
    const out = {};
    await view('notes');
    const ed = $('#ed');
    ed.insertAdjacentHTML(
      'beforeend',
      '<h2>Fold section</h2><p>under it</p><h3>Sub part</h3><p>deeper</p><h2>Empty section</h2><p><br></p>' +
        '<h2>Next section</h2><hr><table><tbody><tr><td>cell</td></tr></tbody></table><p>end</p>'
    );
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(600);
    const buttons = () =>
      $$('.foldlayer .foldbtn').map(b =>
        [b.className, b.getAttribute('title'), b.getAttribute('aria-expanded')].join('|')
      );
    out.buttons = buttons().slice(-4);
    out.room = norm(
      [...ed.children]
        .slice(-6)
        .map(b => b.tagName)
        .join(' ')
    );
    const foldButton = () =>
      $$('.foldlayer .foldbtn').find(b => {
        const layer = b.parentNode;
        const heading = layer._hs && layer._hs[+b.dataset.foldi];
        return heading && heading.textContent === 'Fold section';
      });
    const button = foldButton();
    if (button) button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await wait(100);
    out.hidden = $$('#ed .fh').map(b => norm(b.textContent));
    out.afterFold = buttons().slice(-4);
    /* scrolling to folded text opens its fold */
    const deeper = [...ed.querySelectorAll('p')].find(p => p.textContent === 'deeper');
    if (deeper) deeper.scrollIntoView({ block: 'nearest' });
    await wait(80);
    out.revealed = $$('#ed .fh').length;
    /* a click in the gap under the divider puts the caret on the next line */
    const rule = ed.querySelector('hr:last-of-type');
    if (rule) {
      const box = rule.getBoundingClientRect();
      ed.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientY: box.bottom + 2 })
      );
      await wait(50);
      out.gapClick = norm(
        getSelection().anchorNode ? getSelection().anchorNode.textContent || getSelection().anchorNode.nodeName : 'none'
      );
    }
    return out;
  });

  /* ---- the Mac app's calls (quotes and comments from PDFs, sources, essays, the whole notebook) and exporting ---- */
  await step('app calls and export', async () => {
    const out = {};
    await view('notes');
    const ed = $('#ed');
    const currentView = () => ($('.tabs [aria-pressed="true"]') || { dataset: {} }).dataset.view;
    const scrub = s =>
      norm(
        String(s)
          .replace(/data-cite="[^"]*"/g, 'data-cite')
          .replace(/\br[a-z0-9]{10,}\b/g, '<ref>')
      );
    newLine('Quote goes here');
    const added = JSON.parse(window.nbAddRef('Prince, S. J. D. (2023) Understanding Deep Learning. MIT Press.'));
    out.addRef = [added.refs.length, scrub(JSON.stringify(added.refs.map(r => r.authors.concat(r.year))))];
    out.quote = window.nbInsertQuote({
      refId: 'rpdf000000001',
      refRaw: 'Whatmore, S. (2009) Hybrid Geographies. Sage.',
      text: '  a quoted\n line ',
      pg: '12',
      anchor: 'A|B'
    });
    await wait(80);
    out.afterQuote = scrub(ed.lastElementChild.outerHTML);
    newLine('');
    out.note = window.nbInsertNote({ refId: 'rpdf000000001', quote: 'some words', text: 'my comment', pg: '3' });
    window.nbInsertNote({ text: 'just a comment' });
    await wait(80);
    out.afterNote = scrub(ed.lastElementChild.outerHTML);
    /* the whole notebook, as the app would save it */
    const state = JSON.parse(window.nbFlush());
    out.state = [
      Object.keys(state).join(','),
      state.pts.length,
      state.essays.length,
      state.refs.length,
      typeof state.doc
    ];
    /* essays imported from Word or PDF */
    window.nbImportEssays([
      { title: 'Imported one', html: '<p>Body <b>text</b> (Smith, 2020)</p>' },
      { title: '', html: '<p></p>' }
    ]);
    await wait(400);
    out.imported = [currentView(), text($('#toast'), 120), norm($('#etitle') ? $('#etitle').value : 'none')];
    window.nbShow('notes');
    await wait(150);
    out.shown = currentView();
    /* export: the page offered as a download */
    let saved = null;
    const realClaude = window.claude;
    window.claude = { use: () => Promise.resolve({ save: file => ((saved = file), Promise.resolve()) }) };
    $('#ed').insertAdjacentHTML(
      'beforeend',
      '<div data-math="x^2" data-math-notes=\'[{"t":"x","c":1,"n":"a number"}]\'></div><p>An <span data-imath="y"></span> and <img src="data:image/png;base64,iVBORw0KGgo=" data-nb="1"></p>'
    );
    $('#ed').dispatchEvent(new Event('input', { bubbles: true }));
    const exportButton = document.createElement('button'); // (the Save notes button, as in the syllabus editor)
    exportButton.id = 'exp';
    document.body.appendChild(exportButton);
    click(exportButton);
    exportButton.remove();
    await wait(300);
    window.claude = realClaude;
    out.exportName = saved ? saved.filename : 'none';
    out.exportTail = saved ? scrub(saved.data.slice(-900)) : 'none';
    out.exportHead = saved ? norm(saved.data.slice(0, 200)) : 'none';
    out.exportToast = text($('#toast'), 40);
    return out;
  });

  /* ---- the notes survive a save and reload of the view ---- */
  await step('notes after round trip', async () => {
    await view('syl');
    await view('notes');
    return { length: $('#ed').innerText.length, tail: text($('#ed'), 4000).slice(-300) };
  });

  /* ---- every command the editor has ---- */
  await step('editor commands', async () => {
    await view('notes');
    const out = {};
    const last = () => $('#ed').lastElementChild;
    const fromMenu = async (menuName, item) => {
      await menu(menuName);
      const b = $('.tbmenu [data-mi="' + item + '"]');
      if (b) click(b);
      else await closeMenus();
      await wait(120);
    };
    for (const [item, words] of [
      ['ol', 'Numbered item'],
      ['quote', 'A quoted line'],
      ['underline', 'Underline me'],
      ['strike', 'Strike me'],
      ['code', 'Code me']
    ]) {
      newLine(words);
      if (item !== 'ol' && item !== 'quote') await selectText(last(), 0, 5);
      await fromMenu(item === 'ol' || item === 'quote' ? 'list' : 'ins', item);
      out[item] = html(last(), 200);
    }
    newLine('Before a divider');
    await fromMenu('list', 'hr');
    out.hr = html($('#ed'), 100000).slice(-120);
    newLine('A footnote here');
    await fromMenu('ins', 'footnote');
    await wait(200);
    out.footnote = html($('#ed'), 100000).slice(-300);
    key('Escape');
    newLine('');
    await fromMenu('ins', 'toc');
    await wait(150);
    out.toc = text($('#ed .toc, #ed [data-toc]') || last(), 200);
    newLine('Inside a callout');
    await menu('list');
    const sub = $('.tbmenu [data-sub="callout"]');
    if (sub) {
      sub.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      click(sub);
      await wait(120);
      const def = $('[data-mi="callout:def"]');
      if (def) click(def);
      await wait(120);
    }
    await closeMenus();
    out.callout = html(last(), 300);
    /* a table: a row and a column added, then the table deleted */
    newLine('');
    await fromMenu('ins', 'table');
    const table = [...$$('#ed table')].pop();
    if (table) {
      const r = document.createRange();
      r.selectNodeContents(table.querySelector('td'));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      await wait(40);
      click($('[data-tcmd="rowbelow"]'));
      click($('[data-tcmd="colright"]'));
      out.tableGrown =
        table.querySelectorAll('tr').length + ' rows, ' + table.querySelector('tr').children.length + ' columns';
      click($('[data-tcmd="deltable"]'));
      out.tableDeleted = table.isConnected ? 'still there' : 'gone';
    }
    /* folding everything, then unfolding */
    newLine('A heading to fold');
    await fromMenu('head', 'fmt:h2');
    await fromMenu('ins', 'foldall');
    out.folded = $$('#ed [data-fold]').length;
    await fromMenu('ins', 'unfoldall');
    out.unfolded = $$('#ed [data-fold]').length;
    /* the Sources pane, and a citation */
    click($('[data-cmd="sources"]'));
    await wait(150);
    out.sourcesOpen = !!$('#refs') && !$('#refs').hidden;
    click($('[data-cmd="sources"]'));
    await wait(150);
    newLine('A claim needing a citation ');
    click($('[data-cmd="cite"]'));
    await wait(200);
    out.cite = html(last(), 300);
    out.sourcesAfterCite = !!$('#refs') && !$('#refs').hidden;
    key('Escape');
    /* tidying the note (keeps the text, drops stray styles) */
    await fromMenu('ins', 'tidy');
    out.tidied = $('#toast').textContent;
    return out;
  });

  /* ---- pasting: rich HTML cleaned, plain text as lines, ⇧ for plain, inside a table cell on one line ---- */
  await step('paste', async () => {
    const out = {};
    const pasteInto = async (el, data, shift) => {
      const transfer = new DataTransfer();
      Object.entries(data).forEach(([type, value]) => transfer.setData(type, value));
      if (shift) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }));
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
      if (shift) document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', shiftKey: false, bubbles: true }));
      await wait(80);
    };
    const rich =
      '<meta charset="utf-8"><style>p{color:red}</style><script>alert(1)</script>' +
      '<p>Plain​ text&nbsp;with a <b style="font-weight:normal">not bold</b> and <span style="font-weight:700">heavy</span> ' +
      '<span style="font-style:italic">slanted</span> <font face="Arial">font</font> <a href="https://example.com/x">safe link</a> ' +
      '<a href="javascript:alert(1)">unsafe link</a> <mark data-h="3">marked</mark> <sub>2</sub><sup>3</sup> <code>c</code></p>' +
      '<img src="data:image/png;base64,iVBORw0KGgo=" data-nb="1" data-w="47" data-wrap="left" alt="kept">' +
      '<img src="https://example.com/dropped.png">' +
      '<div data-callout="def" data-wct="intro" data-sp="pt9"><p>Callout text</p></div>' +
      '<div data-side="pro"><p>For</p></div><div data-side="con"><p>Against</p></div>' +
      '<div data-math="a^2" data-math-notes="[]" data-sp="pt9"></div><nav data-toc><p>old contents</p></nav>' +
      '<figure data-wct="body"><img src="data:image/png;base64,iVBORw0KGgo=" data-nb="1"><figcaption>A caption</figcaption></figure>' +
      '<figure><p>No picture here</p></figure>' +
      '<p data-cot data-sp="pt1">Comment <span data-cmt="c1" data-ct="question" data-note="why?">on this</span> and ' +
      '<span data-imath="x_i"></span> and <span data-fn="A note"></span> and ' +
      '<span data-cite="r1" data-pg="4" data-anchor="a" data-form="n">(Ref)</span></p>' +
      '<h2 data-fold>Folded heading</h2><ul data-todo><li data-done="1">done item</li><li><p>only child</p></li></ul>' +
      '<ol><li>numbered</li></ol><blockquote>quoted</blockquote><hr>' +
      '<table><tr><td colspan="2" rowspan="1">wide cell</td></tr><tr><th>h</th><td rowspan="3">tall</td></tr></table>' +
      '<p></p><strong> </strong><button>no buttons</button><h4></h4>';
    newLine('Paste after this');
    await pasteInto($('#ed'), { 'text/html': rich, 'text/plain': 'fallback' });
    out.rich = norm($('#ed').innerHTML).slice(-2600);
    newLine('');
    await pasteInto($('#ed'), { 'text/plain': 'First line\n\n  Second line  \nThird line' });
    out.plainLines = html($('#ed'), 100000).slice(-200);
    newLine('');
    await pasteInto(
      $('#ed'),
      { 'text/html': '<p><b>Bold</b> and <i>italic</i></p>', 'text/plain': 'Bold and italic' },
      true
    );
    out.shiftPaste = html($('#ed').lastElementChild, 200);
    newLine('');
    await menu('ins');
    click($('.tbmenu [data-mi="table"]'));
    await wait(120);
    const cell = [...$$('#ed table')].pop().querySelector('td');
    const r = document.createRange();
    r.selectNodeContents(cell);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    await pasteInto(cell, { 'text/html': '<p>One</p><p>Two</p>', 'text/plain': 'One\nTwo' });
    out.inCell = html(cell, 200);
    return out;
  });

  /* ---- Works Cited, and checking citations ---- */
  await step('citations', async () => {
    const out = {};
    const bar = () => text($('#citebar'), 260);
    const act = async name => {
      const b = $('#citebar [data-cc="' + name + '"]');
      out.reached = (out.reached || '') + name + (b ? ' ' : '(missing) ');
      if (b) click(b);
      await wait(150);
    };
    const filter = async name => {
      click($('#citebar [data-ccf="' + name + '"]'));
      await wait(80);
    };
    await view('wc');
    $('#refin').innerHTML =
      '<p>Smith, J. (2020) <i>A Book on Things</i>. London: Press.</p>' +
      '<p>Jones, A. and Brown, B. (2019) ‘An article’, <i>Journal</i>, 3(2), pp. 1–20.</p>' +
      '<p>Taylor, C. (2018) <i>Another Book</i>. Oxford: OUP.</p>';
    click($('#wcadd'));
    await wait(150);
    out.worksCited = text($('#main'), 400);
    await view('notes');
    newLine('A typed citation (Smith, 2020, p. 4) here.');
    newLine('Jones and Brown (2019) argue things.');
    newLine('An unknown claim (Nobody, 1999) appears.');
    newLine('He said “this is a fairly long quotation indeed” today.');
    newLine('She wrote “words that are quoted here now” (Taylor, 2018).');
    await wait(300);
    await menu('ins');
    click($('.tbmenu [data-mi="checkcites"]'));
    await wait(250);
    out.opened = bar();
    for (const name of ['unlinked', 'missing', 'incomplete', 'all']) {
      await filter(name);
      out['filter ' + name] = bar();
    }
    click($('#citebar [data-ccgo="1"]'));
    await wait(80);
    out.next = bar();
    click($('#citebar [data-ccgo="-1"]'));
    await wait(80);
    await filter('unlinked');
    await act('link');
    out.afterLink = bar();
    await act('skip');
    out.afterSkip = bar();
    await filter('all');
    out.notes = norm($('#ed').innerText).slice(-400);
    /* a quotation's citation without a page: the page is added */
    await filter('incomplete');
    const page = $('#citebar [data-ccpg]');
    if (page) {
      page.value = 'pp. 12 - 13';
      await act('page');
    }
    out.afterPage = bar();
    await filter('missing');
    await act('addcite');
    out.afterAddCite = bar();
    key('Escape');
    await filter('incomplete');
    await act('remove');
    out.afterRemove = bar();
    await filter('unlinked');
    await act('addsrc');
    out.afterAddSource = { view: $('.tabs [aria-pressed="true"]').dataset.view, toast: $('#toast').textContent };
    return out;
  });

  /* ---- the Works Cited tab and the Sources pane ---- */
  await step('works cited', async () => {
    const out = {};
    const list = () =>
      $$('#main .wci').map(li =>
        norm(li.querySelector('.wct') ? li.querySelector('.wct').innerText : li.innerText).slice(0, 30)
      );
    await view('wc');
    out.start = list();
    click($('[data-wcsort="manual"]'));
    await wait(80);
    out.manual = $('[data-wcsort="manual"]').getAttribute('aria-pressed');
    /* dragging the last reference above the first */
    const items = () => $$('#main .wci');
    const fromItem = items()[items().length - 1];
    const toItem = items()[0];
    const transfer = new DataTransfer();
    fromItem.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    const box = toItem.getBoundingClientRect();
    toItem.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, clientY: box.top + 2, dataTransfer: transfer })
    );
    toItem.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, clientY: box.top + 2, dataTransfer: transfer })
    );
    document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    await wait(100);
    out.afterDrag = list();
    click($('[data-wcsort="auto"]'));
    await wait(80);
    /* editing a reference: its surnames and year */
    click($('[data-wcedit]'));
    await wait(80);
    const id = $('#wced').closest('.wci').dataset.id;
    $('[data-rfa="' + id + '"]').value = 'Edited, Person';
    $('[data-rfy="' + id + '"]').value = '2001';
    click($('[data-wcsave="' + id + '"]'));
    await wait(80);
    out.afterEdit = norm($('#main .wc-list').innerText).slice(0, 300);
    click($('[data-wcedit]'));
    await wait(50);
    click($('[data-wccancel]'));
    await wait(50);
    out.cancelled = !$('#wced');
    /* selecting: one, then all, then clear; deleting one that's cited asks first */
    const check = (el, on) => {
      el.checked = on;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    check($('[data-wcsel]'), true);
    await wait(50);
    out.selectedOne = text($('.wc-bar'), 80);
    check($('#wcall'), true);
    await wait(50);
    out.selectedAll = text($('.wc-bar'), 80);
    click($('#wcnone'));
    await wait(50);
    out.cleared = text($('.wc-bar'), 80);
    const cited = $$('#main .wci').find(li => /cited \d/.test(li.innerText));
    if (cited) {
      const citedId = cited.dataset.id;
      click(cited.querySelector('[data-wcdelone]'));
      await wait(50);
      out.deleteAsks = norm($('[data-wcdelone="' + citedId + '"]').textContent);
      click($('[data-wcedit="' + citedId + '"]'));
      await wait(50);
      out.deleteAsksWhileEditing = norm($('[data-wcdelone="' + citedId + '"]').textContent);
      click($('[data-wccancel]'));
      await wait(50);
    }
    check($('#wcall'), true);
    await wait(50);
    click($('#wcdel'));
    await wait(50);
    out.deleteAllAsks = text($('.wc-bar'), 80);
    click($('#wcnone'));
    await wait(50);
    $('#refin').innerHTML = '<p>Draft text</p>';
    click($('#wcclr'));
    await wait(50);
    out.clearedInput = $('#refin').innerHTML;
    /* whose list: an essay's, then the notebook's again */
    const owner = $('#wcowner');
    out.owners = [...owner.options].map(o => norm(o.textContent));
    if (owner.options.length > 1) {
      owner.value = owner.options[1].value;
      owner.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(80);
      out.essayList = text($('.wc-bar'), 60);
      $('#wcowner').value = 'notes';
      $('#wcowner').dispatchEvent(new Event('change', { bubbles: true }));
      await wait(80);
    }
    /* the Sources pane: search, cite where the caret is, then change that citation's source and form */
    await view('notes');
    newLine('Cited from the pane ');
    click($('[data-cmd="sources"]'));
    await wait(120);
    const search = $('#refq');
    search.value = 'Taylor';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(50);
    out.search = $$('#reflist .refpick').length;
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(50);
    click($('#reflist .refpick'));
    await wait(120);
    const citation = [...$$('#ed span[data-cite]')].pop();
    const citationHTML = () => norm(citation.outerHTML.replace(/data-cite="[^"]*"/, 'data-cite')).slice(0, 200);
    out.citedFromPane = citation ? citationHTML() : 'none';
    if (citation) {
      const box = citation.getBoundingClientRect();
      citation.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: box.right - 1 }));
      const caret = getSelection().getRangeAt(0);
      out.caretAfter =
        caret.startContainer === citation.parentNode || caret.startContainer.previousSibling === citation;
      citation.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, altKey: true }));
      await wait(120);
      out.choosing = text($('#refs .choosing'), 120);
      const picks = $$('#reflist .refpick');
      picks[1].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      await wait(80);
      out.twoSources = citation.getAttribute('data-cite').split(',').length;
      click($$('#reflist .refpick')[1]);
      await wait(120);
      out.oneSource = citation.getAttribute('data-cite').split(',').length;
      citation.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, altKey: true }));
      await wait(120);
      click($('[data-citeform="n"]'));
      await wait(80);
      out.narrative = citationHTML();
      click($('[data-refrmcite]'));
      await wait(80);
      out.removed = !citation.isConnected;
    }
    if ($('[data-refclose]')) click($('[data-refclose]'));
    await wait(80);
    out.paneClosed = $('#refs').hidden;
    return out;
  });

  /* ---- editing the syllabus where it stands ---- */
  await step('syllabus edit in place', async () => {
    const out = {};
    const typeIn = (el, text) => {
      el.focus();
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const keyOn = (el, k, opts = {}) =>
      el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts)));
    const codes = () => $$('#syledb [data-yc]').map(s => s.textContent || '·');
    await view('syl');
    if ($('#editbtn').textContent.indexOf('Done') < 0) click($('#editbtn'));
    await wait(200);
    const firstId = $('#syledb [data-yt]').dataset.yt;
    typeIn($('[data-yc="' + firstId + '"]'), '2.1.U1x');
    typeIn($('[data-yt="' + firstId + '"]'), 'Edited statement');
    typeIn($('[data-yg="' + firstId + '"]'), 'Edited guidance');
    typeIn($('[data-ysname]'), '2.1 Renamed section');
    await wait(500);
    out.edited = text($('#syledb tr.pr'), 160);
    out.side = text($('#side'), 120);
    /* Return adds a point below; ⌘] makes it a sub-point, ⌘[ a point again */
    keyOn($('[data-yt="' + firstId + '"]'), 'Enter');
    await wait(150);
    const added = document.activeElement;
    out.afterReturn = codes().slice(0, 4);
    if (added && added.dataset.yt) {
      keyOn(added, ']', { metaKey: true });
      await wait(100);
      out.afterIndent = $('[data-yid="' + added.dataset.yt + '"]').className;
      keyOn($('[data-yt="' + added.dataset.yt + '"]'), '[', { metaKey: true });
      await wait(100);
      out.afterOutdent = $('[data-yid="' + added.dataset.yt + '"]').className;
    }
    /* renumber; delete a point (one with a rating asks first); add a section; delete it (asks first) */
    click($('[data-ynum]'));
    await wait(150);
    out.renumbered = codes().slice(0, 4);
    const rated = $('#syledb tr.pr');
    click(rated.querySelector('[data-cyc]'));
    await wait(100);
    const del = () => $('[data-ydel="' + rated.dataset.yid + '"]');
    click(del());
    await wait(100);
    out.deleteAsks = del() ? norm(del().textContent) : 'gone';
    if (del()) click(del());
    await wait(150);
    out.afterDelete = codes().slice(0, 3);
    click($('[data-yaddsec]'));
    await wait(150);
    out.sections = $$('[data-ysname]')
      .map(s => s.textContent)
      .slice(-2);
    const delSec = () => [...$$('[data-ydelsec]')].pop();
    click(delSec());
    await wait(100);
    out.deleteSectionAsks = norm(delSec().textContent);
    click(delSec());
    await wait(150);
    out.sectionsAfter = $$('[data-ysname]').length;
    /* the green + under a row adds a point there */
    const row = $$('#syledb tr.pr')[1];
    const box = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: box.left + 50, clientY: box.bottom - 4 }));
    await wait(50);
    const plus = $('#yins');
    out.plusShown = plus && !plus.hidden;
    if (plus && !plus.hidden) {
      plus.querySelector('button').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await wait(150);
    }
    out.afterPlus = codes().slice(0, 5);
    /* dragging the second point below the fourth */
    const rows = () => $$('#syledb tr.pr');
    const moving = rows()[1];
    const movingId = moving.dataset.yid;
    const from = moving.getBoundingClientRect();
    const to = rows()[3].getBoundingClientRect();
    moving
      .querySelector('.c')
      .dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: from.left + 20, clientY: from.top + 5 })
      );
    for (const y of [from.top + 15, from.top + 40, to.bottom - 2]) {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: from.left + 20, clientY: y }));
      await wait(30);
    }
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await wait(250);
    out.afterDrag = rows().findIndex(r => r.dataset.yid === movingId) + ' / ' + codes().slice(0, 5).join(' ');
    click($('#editbtn'));
    await wait(150);
    return out;
  });

  /* ---- pasted syllabi in different shapes ---- */
  await step('detect formats', async () => {
    const out = {};
    const samples = {
      specPoints:
        'Specification Point 1.1\nDescribe cells.\nSpecification Point 1.2: Explain osmosis\n- in plants\n- in animals',
      headingsAndCodes:
        'CELL BIOLOGY\n1.1 Cell theory\n1.2 Cell structure (organelles)\ncontinued description\nTopic 2: Molecules\n2.1 Water\n2.2 Carbon',
      codesOnly: '3.1.1 First\n3.1.2 Second\n3.2.1 Third\n4.1 Fourth',
      plainParagraphs: 'First idea\nSecond idea\n\nThird idea\nFourth idea\n\nFifth idea',
      plainList: 'Alpha\nBeta\nGamma',
      bullets: '# Section A\n(a) item one\n(b) item two\n• item three'
    };
    await view('syl');
    if ($('#editbtn').textContent.indexOf('Done') < 0) click($('#editbtn'));
    await wait(150);
    for (const [name, sample] of Object.entries(samples)) {
      const paste = $('#paste');
      if (!paste) {
        out[name] = 'no paste box';
        continue;
      }
      paste.value = sample;
      paste.dispatchEvent(new Event('input', { bubbles: true }));
      click($('#detect'));
      await wait(100);
      out[name] = [...$$('#review .dsec')].map(sec => {
        const title = sec.querySelector('[data-ds]').value;
        const items = [...sec.querySelectorAll('.dpt')].map(p => {
          const [code, statement] = p.querySelectorAll('input');
          return (code.value ? code.value + ' ' : '') + statement.value;
        });
        return title + ': ' + items.join(' | ');
      });
      if ($('#discard')) click($('#discard'));
      await wait(80);
    }
    click($('#editbtn'));
    await wait(100);
    return out;
  });

  /* ---- the page's own buttons (last: it replaces the syllabus) ---- */
  await step('page actions', async () => {
    const out = { reached: [] };
    const tap = (sel, label) => {
      const el = typeof sel === 'string' ? $(sel) : sel;
      out.reached.push(label + (el ? '' : ' (missing)'));
      if (el) click(el);
      return !!el;
    };
    const input = (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await view('syl');
    const rate = () => $('#main [data-cyc]');
    tap(rate(), 'rate');
    await wait(50);
    out.ratedOnce = rate().getAttribute('data-n');
    rate().dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    await wait(50);
    out.ratedBack = rate().getAttribute('data-n');
    const section = $('#side [data-gosec]');
    tap(section, 'section');
    const open = $('#main [data-open]');
    tap(open, 'open');
    await wait(300);
    out.afterOpen = $('.tabs [aria-pressed="true"]').dataset.view;
    input($('#nbtitle'), 'Smoke notebook');
    await wait(800);
    out.title = localStorage.getItem('syllabus-notebook-v1-meta') || $('#nbtitle').value;
    /* essays: a new one named, then deleted (it asks first) */
    await view('essay');
    const before = $$('#side [data-essay]').length;
    tap('#newessay', '#newessay');
    await wait(300);
    if ($('#etitle')) input($('#etitle'), 'Smoke essay');
    await wait(700);
    out.essays = norm($('#side').innerText).slice(0, 120);
    const del = $('#delessay');
    if (del) {
      tap(del, 'delete');
      out.deleteAsks = norm(del.textContent);
      tap(del, 'delete again');
      await wait(300);
    }
    out.essaysAfterDelete = $$('#side [data-essay]').length - before;
    /* the side panel folds and unfolds */
    const toggle = $('[data-sidetog]');
    if (toggle) {
      tap(toggle, 'side');
      await wait(250);
      out.sideFolded = $('#bodywrap').classList.contains('nosd');
      tap('[data-sidetog]', 'side back');
      await wait(250);
    }
    /* editing the syllabus: paste, detect, adjust the draft, add it */
    await view('syl');
    tap('#editbtn', '#editbtn');
    await wait(200);
    out.editing = norm($('#editbtn').textContent);
    const paste = $('#paste');
    if (paste) {
      input(paste, '# Smoke topic\n9.1 | First smoke point\n9.2 | Second smoke point\n9.3 | Third smoke point');
      tap('#detect', '#detect');
      await wait(200);
      out.review = text($('#review'), 200);
      input($('[data-ds="0"]'), 'Renamed smoke topic');
      tap('[data-dx="0.1"]', '[data-dx="0.1"]');
      await wait(100);
      tap('[data-dadd="0"]', '[data-dadd="0"]');
      await wait(100);
      const newest = $$('[data-dt]').pop();
      if (newest) input(newest, 'Added smoke point');
      tap('#confirmdraft', '#confirmdraft');
      await wait(300);
      out.afterAdd = { rows: $$('#main tr').length, tail: text($('#main'), 6000).slice(-200) };
    } else out.review = 'no paste box';
    /* replacing asks first when work would be lost; then the example, then an empty syllabus */
    tap('#editbtn', '#editbtn');
    await wait(150);
    if ($('#editbtn').textContent.indexOf('Done') < 0) tap('#editbtn', '#editbtn');
    await wait(150);
    const paste2 = $('#paste');
    if (paste2) {
      input(paste2, '8.1 | Only point');
      tap('#detect', '#detect');
      await wait(150);
      const replace = $('input[name=mode][value=replace]');
      if (replace) {
        replace.checked = true;
        replace.dispatchEvent(new Event('input', { bubbles: true }));
      }
      tap('#confirmdraft', '#confirmdraft');
      await wait(150);
      out.replaceWarning = text($('.warn'), 160);
      tap('#confirmdraft', '#confirmdraft');
      await wait(300);
      out.afterReplace = { rows: $$('#main tr').length, start: text($('#main'), 200) };
    }
    for (const id of ['ex', 'blank']) {
      if ($('#editbtn').textContent.indexOf('Done') < 0) tap('#editbtn', '#editbtn');
      await wait(150);
      const b = $('#' + id);
      if (!b) continue;
      tap(b, id);
      await wait(100);
      out[id + 'Asks'] = norm(($('#' + id) || {}).textContent || '');
      tap('#' + id, id + ' again');
      await wait(300);
      out[id + 'Rows'] = $$('#main tr').length;
      out[id + 'Start'] = text($('#main'), 90);
    }
    return out;
  });

  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onError);
  report.errors = errors;
  return report;
};

/* Runs the test and posts its report to serve.py as /smoke-report/<name>. On the native page (/native/…, see serve.py) it
   also posts what the page sent the fake Mac bridge, as <name>-bridge: the kinds of message and how many of each, and
   whether the last save is a whole notebook (compare it with diff: the counts matched between runs here, but they follow timing). */
window.runSmokeTo = async function (name) {
  const report = await window.runSmoke();
  await fetch('/smoke-report/' + name, { method: 'POST', body: JSON.stringify(report, null, 1) });
  if (window.__posted) {
    const counts = {};
    window.__posted.forEach(m => (counts[m.type] = (counts[m.type] || 0) + 1));
    const saves = window.__posted.filter(m => m.type === 'save');
    let last = null;
    try {
      last = JSON.parse(saves[saves.length - 1].json);
    } catch (e) {}
    const bridge = {
      messages: counts,
      lastSaveKeys: last && Object.keys(last).sort(),
      lastSaveTitle: last && last.meta && last.meta.title
    };
    await fetch('/smoke-report/' + name + '-bridge', { method: 'POST', body: JSON.stringify(bridge, null, 1) });
  }
  return report;
};
