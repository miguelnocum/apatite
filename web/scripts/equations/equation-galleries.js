/* ===== the equation editor, part 5: the pop-up galleries — a structure's layouts, every symbol, or whole equations —
   and the strip of symbols (pinned ones first) ===== */
const SYMBOL_PAGE = 72; // px the strip scrolls by: two rows of 34px cells and their 2px gaps
const STRIP_END_TOLERANCE = 4; // px from the end of the strip that count as the end
const GALLERY_GAP = 4; // px between a button and its gallery
const GALLERY_SIDE_MARGIN = 6; // px a gallery keeps from the editor's sides
const PIN_TITLE = 'Pin to the front of the strip';
const UNPIN_TITLE = 'Unpin from the strip';

class EquationGalleries {
  constructor(editor) {
    this.editor = editor;
    this.popup = editor.popup;
    this.strip = this.popup.querySelector('.mp-syms');
    this.drop = null; // the gallery that's open
    this.strip.addEventListener('scroll', () => this.markStripEnds());
  }

  /* ---- opening and closing ---- */

  close() {
    if (!this.drop) return;
    this.drop.remove();
    this.drop = null;
    this.popup.querySelectorAll('.mp-cat.on,.mp-more.on').forEach(button => button.classList.remove('on'));
  }

  /* opens a gallery under its button (the same button again closes it) */
  open(key, button, html, className) {
    const wasOpen = this.drop && this.drop.key === key;
    this.close();
    if (wasOpen) return null;
    const drop = mk('div');
    drop.className = 'mp-drop' + (className ? ' ' + className : '');
    drop.key = key;
    drop.innerHTML = html;
    this.popup.appendChild(drop);
    this.drop = drop;
    button.classList.add('on');
    fitPreviews(drop);
    this.position(drop, button);
    return drop;
  }

  position(drop, button) {
    const editor = this.popup.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    const maxLeft = editor.width - drop.offsetWidth - GALLERY_SIDE_MARGIN;
    drop.style.top = box.bottom - editor.top + GALLERY_GAP + 'px';
    drop.style.left = Math.max(GALLERY_SIDE_MARGIN, Math.min(box.left - editor.left, maxLeft)) + 'px';
  }

  /* ---- a structure's layouts (Fraction, Script, …), in sections ---- */

  openStructure(menuIndex, button) {
    const sections = EQ_MENUS[menuIndex][2];
    const html = sections
      .map(([title, items], sectionIndex) => {
        const tiles = items.map((item, i) => this.tileHTML(`${menuIndex}:${sectionIndex}:${i}`, item)).join('');
        return `<div class="mp-dh">${esc(title)}</div><div class="mp-grid">${tiles}</div>`;
      })
      .join('');
    this.open('c' + menuIndex, button, html);
  }

  tileHTML(path, [name, latex, size]) {
    const wide = size === 'w' ? ' wide' : '';
    return `<button type="button" class="mp-tile${wide}" data-mptpl="${path}" title="${esc(name)}">${eqPreview(latex)}</button>`;
  }

  /* the LaTeX of a tile, from its data-mptpl "menu:section:item" */
  static template(path) {
    const [menu, section, item] = path.split(':').map(Number);
    return { latex: EQ_MENUS[menu][2][section][1][item][1], isAccent: EQ_MENUS[menu][0] === 'Accent' };
  }

  /* ---- symbols: pinned ones lead the strip; the gallery has them all, each with a pin ---- */

  pins() {
    return eqStore('pins');
  }

  symbolName(tex) {
    for (const [, symbols] of EQ_SYMBOLS) {
      const found = symbols.find(([latex]) => latex === tex);
      if (found) return found[1];
    }
    return '';
  }

  symbolCellHTML(tex, inGallery) {
    const pinned = this.pins().includes(tex);
    const hint = inGallery ? '' : pinned ? ' · pinned (right-click to unpin)' : ' · right-click to pin';
    const title = esc((this.symbolName(tex) || tex) + hint);
    const pin = inGallery
      ? `<span class="pin" data-pin="${esc(tex)}" title="${pinned ? UNPIN_TITLE : PIN_TITLE}"></span>`
      : '';
    return (
      `<button type="button" class="mp-sym${pinned ? ' pinned' : ''}" data-symtex="${esc(tex)}" title="${title}">` +
      `${eqPreview(tex)}${pin}</button>`
    );
  }

  drawStrip() {
    const pinned = this.pins();
    const symbols = pinned.concat(EQ_STRIP.filter(tex => !pinned.includes(tex)));
    this.strip.innerHTML = symbols.map(tex => this.symbolCellHTML(tex, false)).join('');
    fitPreviews(this.strip);
    this.strip.scrollTop = 0;
    this.markStripEnds();
  }

  /* the strip's arrows grey out at its ends */
  markStripEnds() {
    const strip = this.strip;
    this.popup.querySelector('[data-mpsrow="-1"]').disabled = strip.scrollTop < STRIP_END_TOLERANCE;
    const atEnd = strip.scrollTop + strip.clientHeight >= strip.scrollHeight - STRIP_END_TOLERANCE;
    this.popup.querySelector('[data-mpsrow="1"]').disabled = atEnd;
  }

  /* a page of symbols up (-1) or down (1) */
  scrollStrip(pages) {
    this.strip.scrollTop = Math.round(this.strip.scrollTop / SYMBOL_PAGE + pages) * SYMBOL_PAGE;
  }

  togglePin(tex) {
    const pinned = this.pins();
    const i = pinned.indexOf(tex);
    if (i >= 0) pinned.splice(i, 1);
    else pinned.push(tex);
    eqStore('pins', pinned);
    this.drawStrip();
    this.showPinInGallery(tex, i < 0);
    toast(i < 0 ? 'Pinned to the front of the symbol strip' : 'Unpinned');
  }

  showPinInGallery(tex, pinned) {
    if (!this.drop || this.drop.key !== 'syms') return;
    this.drop.querySelectorAll('[data-symtex]').forEach(cell => {
      if (cell.dataset.symtex !== tex) return;
      cell.classList.toggle('pinned', pinned);
      const pin = cell.querySelector('.pin');
      if (pin) pin.title = pinned ? UNPIN_TITLE : PIN_TITLE;
    });
  }

  openSymbols(button) {
    const pinned = this.pins();
    const group = (title, cells) => `<div class="mp-dh">${esc(title)}</div><div class="mp-symgrid">${cells}</div>`;
    const pinnedHTML = pinned.length ? group('Pinned', pinned.map(tex => this.symbolCellHTML(tex, true)).join('')) : '';
    const kindsHTML = EQ_SYMBOLS.map(([kind, symbols]) =>
      group(kind, symbols.map(([tex]) => this.symbolCellHTML(tex, true)).join(''))
    ).join('');
    const note = '<p class="mp-dnote">Click a symbol to put it in · its pin keeps it at the front of the strip</p>';
    this.open('syms', button, pinnedHTML + kindsHTML + note, 'mp-symdrop');
  }

  /* ---- the equation gallery: built in, and your own (saved from here) ---- */

  openEquations(button, saving) {
    const mine = eqStore('saved');
    const mineHTML = mine.length
      ? '<div class="mp-dh">Your equations</div>' + mine.map((x, i) => this.equationHTML(x.n, x.t, i)).join('')
      : '';
    const builtInHTML =
      '<div class="mp-dh">Built in</div>' + EQ_BUILTIN.map(([name, tex]) => this.equationHTML(name, tex)).join('');
    const drop = this.open('gal', button, mineHTML + builtInHTML + this.saveRowHTML(saving), 'mp-galdrop');
    if (drop && saving) this.askForName(drop);
  }

  /* one equation in the gallery; your own (with an index) can be removed */
  equationHTML(name, tex, ownIndex) {
    const remove =
      ownIndex == null
        ? ''
        : `<button type="button" class="mp-eqx" data-eqdel="${ownIndex}" title="Remove from your equations">×</button>`;
    return (
      `<div class="mp-eqi"><button type="button" class="mp-eq" data-eqtex="${esc(tex)}" title="Put this equation in">` +
      `<span class="mp-eqn">${esc(name)}</span><span class="mp-eqr">${texShowHTML(tex)}</span></button>${remove}</div>`
    );
  }

  saveRowHTML(saving) {
    const empty = !this.editor.input.value.trim();
    const disabled = empty ? ' disabled title="Write an equation first"' : '';
    const row = saving
      ? '<input type="text" class="mp-eqname" placeholder="Name it, e.g. Loss function">' +
        '<button type="button" class="pri" data-eqsaveok>Save</button>'
      : `<button type="button" data-eqsave${disabled}>Save this equation to the gallery…</button>`;
    return `<div class="mp-eqsave">${row}</div>`;
  }

  askForName(drop) {
    const name = drop.querySelector('.mp-eqname');
    name.focus();
    name.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.saveEquation(name.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  /* the name typed in the gallery's save row */
  typedName() {
    const name = this.drop && this.drop.querySelector('.mp-eqname');
    return name ? name.value : undefined;
  }

  saveEquation(name) {
    const tex = this.editor.input.value.trim();
    if (!tex) return;
    const mine = eqStore('saved');
    mine.unshift({ n: (name || '').trim() || 'My equation', t: tex });
    eqStore('saved', mine);
    this.close();
    toast('Saved to your equations');
  }

  removeSaved(index) {
    const mine = eqStore('saved');
    mine.splice(index, 1);
    eqStore('saved', mine);
    this.close();
    this.openEquations(this.popup.querySelector('[data-mpgal]'), false);
  }
}
