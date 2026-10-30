/* ===== the equation editor, part 3: what it's made of — its markup, where it sits, closing it ===== */

/* the editor that's open (a MathEditor), or null */
let mathEd = null;

function mathAttr(el) {
  return el.hasAttribute('data-imath') ? 'data-imath' : 'data-math';
}

function closeMathEditor() {
  if (!mathEd) return;
  const editor = mathEd;
  mathEd = null;
  const el = editor.el;
  const attr = mathAttr(el);
  editor.remove();
  if (el.isConnected && !(el.getAttribute(attr) || '').trim()) el.remove(); // nothing written: no equation
  if (el.isConnected) {
    el.classList.remove('editing', 'annot');
    if (attr === 'data-imath') renderIMath(el.parentNode);
    else renderMath(el.parentNode || ed());
  }
  ensureRoom();
  saveDocSoon();
  edChanged();
}

/* the caret goes on after an equation once it's edited: below a block one, straight after an inline one */
function caretAfterMath(el) {
  if (!el.isConnected) return;
  if (el.hasAttribute('data-imath')) {
    caretAfterInlineMath(el);
    return;
  }
  const next = el.nextElementSibling;
  if (next && !solidBlock(next)) caretInto(next);
}

function caretAfterInlineMath(el) {
  caretAnchors(el.parentNode);
  const text = el.nextSibling;
  if (!text || text.nodeType !== 3) return;
  const range = document.createRange();
  range.setStart(text, text.nodeValue.charAt(0) === ZW ? 1 : 0);
  range.collapse(true);
  const selection = getSelection();
  ed().focus({ preventScroll: true });
  selection.removeAllRanges();
  selection.addRange(range);
}

/* ---- the markup: as in Word, one row of captioned groups (the gallery and the way of typing, a strip of symbols, the
   structures), the lines of the equation, its LaTeX, the annotation list, and the buttons ---- */
function editorHTML() {
  return (
    '<div class="mp-grip" title="Drag to move"><i></i></div>' +
    `<div class="mp-pal">${toolsGroupHTML()}${symbolsGroupHTML()}${structuresGroupHTML()}</div>` +
    '<div class="mp-fields"></div>' +
    '<div class="mp-texwrap"><textarea spellcheck="false" autocapitalize="off" placeholder="LaTeX, e.g. \\hat{y} = ' +
    '\\sigma(\\mathbf{w}^T \\mathbf{x} + b). Each line is a line of the equation."></textarea><div class="mp-err"></div></div>' +
    annotationsHTML() +
    '<div class="mp-row"><button type="button" data-mpdel class="del">Delete</button>' +
    '<button type="button" data-mpann class="annb" title="Colour parts of the equation and explain them">✎ Annotate</button>' +
    '<span class="k"></span><button type="button" data-mpdone class="pri ok">Done</button></div>'
  );
}

function toolsGroupHTML() {
  const visual = EQ_BOXES
    ? '<button type="button" data-mpmode="v" title="Type with boxes to fill in (like Word\u2019s Unicode)"><i>\u2215</i>Visual</button>'
    : '';
  return (
    '<div class="mp-grp"><div class="mp-gb mp-tools"><button type="button" class="mp-cat mp-gal" data-mpgal ' +
    'title="Equation gallery: ready-made equations and the ones you save">' +
    `<span class="mp-ci">${texInline('\\pi')}</span><span class="mp-cl">Equation</span></button>` +
    `<div class="mp-modes">${visual}` +
    '<button type="button" data-mpmode="t" title="Type LaTeX, the code behind the boxes"><i>{ }</i>LaTeX</button>' +
    '<button type="button" data-mptext title="Ordinary words inside the equation (click again to go back to maths)">' +
    '<i>ab</i>Text</button></div></div><div class="mp-gl">Tools</div></div>'
  );
}

function symbolsGroupHTML() {
  return (
    '<div class="mp-grp"><div class="mp-gb mp-strip"><div class="mp-syms"></div><div class="mp-sbtns">' +
    '<button type="button" data-mpsrow="-1" title="Previous symbols">\u25B4</button>' +
    '<button type="button" data-mpsrow="1" title="More symbols">\u25BE</button>' +
    '<button type="button" class="mp-more" data-mpsyms title="Every symbol, by kind. Pin the ones you use to the front of ' +
    'this strip">\u2304</button></div></div><div class="mp-gl">Symbols</div></div>'
  );
}

function structuresGroupHTML() {
  const buttons = EQ_MENUS.map(
    ([name, icon], i) =>
      `<button type="button" class="mp-cat" data-mpcat="${i}" title="${esc(name)}">` +
      `<span class="mp-ci">${texInline(icon)}</span><span class="mp-cl">${esc(name)}</span></button>`
  ).join('');
  return `<div class="mp-grp mp-sgrp"><div class="mp-gb mp-cats">${buttons}</div><div class="mp-gl">Structures</div></div>`;
}

function annotationsHTML() {
  return (
    '<div class="mp-ann"><div class="mp-annh"><span>Click any symbol in the equation to explain it, then type in its box. ' +
    '<code>$x_i$</code> writes maths.</span><button type="button" data-annsel title="For a bigger part, such as a fraction: ' +
    'select it in the boxes above first">Explain selection</button></div><div class="mp-list"></div></div>'
  );
}

/* ---- where it sits: below the equation, or above it; the equation itself stays in view to be clicked (the page scrolls to
   make room). Once moved by hand, it stays where it was put, kept inside the window. ---- */
const EDITOR_GAP = 8; // px between the equation and its editor
const WINDOW_MARGIN = 10; // px kept clear at the window's top and bottom
const SIDE_MARGIN = 12; // px kept clear at its sides
const MOVED_MARGIN = 4; // px kept clear once it's been moved by hand
const GRIP_BOTTOM_ROOM = 60; // px of a dragged editor that stay in the window at the bottom

function placeEditor(popup, el) {
  if (popup.moved) {
    keepInWindow(popup);
    return;
  }
  const header = headerHeight();
  const box = scrollForEditor(popup, el, header);
  popup.style.top = editorTop(popup, box, header) + 'px';
  const width = popup.offsetWidth;
  const windowWidth = document.documentElement.clientWidth;
  const centred = box.left + box.width / 2 - width / 2;
  popup.style.left = Math.max(SIDE_MARGIN, Math.min(centred, windowWidth - width - SIDE_MARGIN)) + 'px';
}

function keepInWindow(popup) {
  const windowWidth = document.documentElement.clientWidth;
  const left = Math.min(popup.offsetLeft, windowWidth - popup.offsetWidth - MOVED_MARGIN);
  const top = Math.min(popup.offsetTop, innerHeight - popup.offsetHeight - MOVED_MARGIN);
  popup.style.left = Math.max(MOVED_MARGIN, left) + 'px';
  popup.style.top = Math.max(MOVED_MARGIN, top) + 'px';
}

/* no room below and none above: the page scrolls up so it fits below (the equation box after scrolling is returned) */
function scrollForEditor(popup, el, header) {
  const box = el.getBoundingClientRect();
  const height = popup.offsetHeight;
  const need = box.bottom + EDITOR_GAP + height - (innerHeight - WINDOW_MARGIN);
  const noRoomAbove = box.top - header - WINDOW_MARGIN < height + EDITOR_GAP;
  const staysVisible = box.top - need >= header + WINDOW_MARGIN;
  if (!(need > 0 && noRoomAbove && staysVisible)) return box;
  const root = document.documentElement;
  const behaviour = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  window.scrollBy(0, need);
  root.style.scrollBehavior = behaviour;
  return el.getBoundingClientRect();
}

function editorTop(popup, box, header) {
  const height = popup.offsetHeight;
  let top = box.bottom + EDITOR_GAP;
  if (top + height > innerHeight - WINDOW_MARGIN) {
    top = box.top - height - EDITOR_GAP;
    if (top < header) {
      const moreRoomBelow = innerHeight - box.bottom > box.top;
      top = moreRoomBelow ? Math.min(box.bottom + EDITOR_GAP, innerHeight - height - WINDOW_MARGIN) : WINDOW_MARGIN;
    }
  }
  return Math.max(WINDOW_MARGIN, Math.min(top, innerHeight - height - WINDOW_MARGIN)); // never off the bottom of the window
}

/* the grip along its top moves it */
function enableGripDrag(popup) {
  popup.querySelector('.mp-grip').addEventListener('mousedown', function (ev) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const box = popup.getBoundingClientRect();
    const offsetX = ev.clientX - box.left;
    const offsetY = ev.clientY - box.top;
    popup.classList.add('dragging');
    const move = e => movePopup(popup, e.clientX - offsetX, e.clientY - offsetY);
    const release = () => {
      popup.classList.remove('dragging');
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mouseup', release, true);
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', release, true);
  });
}

function movePopup(popup, left, top) {
  popup.moved = true;
  const maxLeft = document.documentElement.clientWidth - popup.offsetWidth - MOVED_MARGIN;
  popup.style.left = Math.max(MOVED_MARGIN, Math.min(left, maxLeft)) + 'px';
  popup.style.top = Math.max(MOVED_MARGIN, Math.min(top, innerHeight - GRIP_BOTTOM_ROOM)) + 'px';
}

/* ---- every preview in the equation menus sized to its cell: big ones (cases, matrices, tall brackets) shrink so nothing is
   cut off, small ones (a binomial, a single symbol) grow in the gallery tiles so they can be read ---- */
const TILE_FILL_WIDTH = 0.84; // of a gallery tile a preview may take
const TILE_FILL_HEIGHT = 0.8;
const CELL_FILL = 0.9; // of a symbol cell or toolbar icon
const TILE_MAX_GROW = 1.4; // a small preview grows at most this much (symbols and icons only shrink)
const SCALE_TOLERANCE = 0.03; // closer to 1 than this is left as it is

function fitPreviews(root) {
  root.querySelectorAll('.mp-tile,.mp-sym,.mp-ci').forEach(fitPreview);
}

function fitPreview(cell) {
  const preview = cell.querySelector('.katex');
  if (!preview) return;
  preview.style.fontSize = '';
  const scale = previewScale(cell, preview);
  if (scale == null || Math.abs(scale - 1) <= SCALE_TOLERANCE) return;
  preview.style.fontSize = parseFloat(getComputedStyle(preview).fontSize) * scale + 'px';
}

function previewScale(cell, preview) {
  const style = getComputedStyle(cell);
  const isTile = cell.classList.contains('mp-tile');
  const isIcon = cell.classList.contains('mp-ci');
  const width = cell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = cell.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const size = preview.getBoundingClientRect();
  if (!size.width || !size.height || !height) return null;
  const byWidth = isIcon ? Infinity : (width * (isTile ? TILE_FILL_WIDTH : CELL_FILL)) / size.width;
  const byHeight = (height * (isTile ? TILE_FILL_HEIGHT : CELL_FILL)) / size.height;
  return Math.min(byWidth, byHeight, isTile ? TILE_MAX_GROW : 1);
}
