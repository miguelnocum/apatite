import { $ } from '../core/helpers-and-state.js';
import { mk } from './paste-cleaning.js';
import { ed, saveDocSoon } from './notes-document.js';
import { positionCards } from './comments.js';
import { edBlocks } from '../essays/word-count.js';
import { mdTopBlock, selectRange } from '../writing/writing.js';
import { emptyLine } from './callouts.js';
import { drawSp } from '../spec-points/spec-point-tags.js';

/* ===== folding: the arrow beside a heading hides everything under it, down to the next heading at its level ===== */
const FOLD_BUTTON_LEFT = 30; // px left of its heading
const FOLD_BUTTON_HALF = 10; // px half the button's height
const FOLD_LINE_MAX = 40; // px: the button centres on a heading's first line, at most this tall
const FALLBACK_LINE_HEIGHT = 20;
const FOLD_REDRAW_DELAY = 80; // ms after the notes change size before the buttons move
const MAX_REVEAL_STEPS = 20; // folds opened at most, to reveal one place
let foldRO = null;
let foldRedrawTimer = null;

function hRank(el) {
  const match = /^H([1-6])$/.exec(el.tagName || '');
  return match && !el.classList.contains('ref') ? +match[1] : 0;
}

/* headings used to start at h4 (Heading / chapter); with six levels they move up two: h4->h2, h5->h3, h6->h4 */
export function shiftHeadings(html) {
  if (!html) return html;
  return String(html).replace(/<(\/?)h([456])(?=[\s>])/gi, (match, slash, level) => '<' + slash + 'h' + (+level - 2));
}

/* ===== room to type: a heading, picture, table or divider is always followed by a line you can click into (a picture
   even when a heading comes straight after it) ===== */
export function solidBlock(block) {
  if (!block || block.nodeType !== 1) return false;
  if (block.matches('h2.ref,h3.ref,table,hr,nav[data-toc],[data-callout],[data-math]')) return true;
  return pictureBlock(block);
}

/* a picture: put in by itself (as inserted or dropped), in a figure, or on a line of its own (as pasted) */
function pictureBlock(block) {
  if (block.tagName === 'IMG' || block.tagName === 'FIGURE') return true;
  return block.tagName === 'P' && !!block.querySelector('img') && !block.textContent.trim();
}

/* a list whose last item ends with a picture (one moved or put in on a bullet): as much a picture to write under */
function endsWithPicture(block) {
  if (!/^(UL|OL)$/.test(block.tagName)) return false;
  let last = block.lastElementChild && block.lastElementChild.lastChild;
  while (last && (last.nodeName === 'BR' || (last.nodeType === 3 && !last.nodeValue.trim())))
    last = last.previousSibling;
  return !!last && last.nodeType === 1 && (last.tagName === 'IMG' || pictureBlock(last));
}

/* blocks that need a plain line after them: the solid ones, quotes, and lists ending with a picture */
function roomy(block) {
  if (!block || block.nodeType !== 1) return false;
  return solidBlock(block) || block.tagName === 'BLOCKQUOTE' || endsWithPicture(block);
}

export function ensureRoom(root) {
  root = root || ed();
  if (!root || root.classList.contains('wcmode')) return false;
  let added = false;
  [...root.children].forEach(block => {
    if (block.id === 'fnlist' || !roomy(block)) return;
    let next = block.nextElementSibling;
    if (next && next.id === 'fnlist') next = null;
    const picture = pictureBlock(block) || endsWithPicture(block);
    if (next && !solidBlock(next) && !(picture && /^H[1-6]$/.test(next.tagName))) return;
    if (picture && next && pictureBlock(next))
      return; /* pictures can stack, with no line between unless you want one */
    block.after(emptyLine());
    added = true;
  });
  return added;
}

/* a click in the gap under a heading or picture puts the caret on the line below it */
const onFoldingMousedown = e => {
  const editor = ed();
  if (!editor || e.target !== editor || e.button !== 0 || editor.classList.contains('wcmode')) return;
  const above = blockAbove(editor, e.clientY);
  if (!above || !roomy(above) || above.getBoundingClientRect().bottom > e.clientY) return;
  ensureRoom(editor);
  let next = above.nextElementSibling;
  while (next && next.classList.contains('fh')) next = next.nextElementSibling;
  if (!next || roomy(next) || next.id === 'fnlist') return;
  e.preventDefault();
  const range = document.createRange();
  range.selectNodeContents(next);
  range.collapse(false);
  selectRange(range);
  editor.focus({ preventScroll: true });
};

/* the last shown block whose top is above this height */
function blockAbove(editor, y) {
  let above = null;
  [...editor.children].forEach(block => {
    if (block.id === 'fnlist' || block.classList.contains('fh')) return;
    const box = block.getBoundingClientRect();
    if (box.height && box.top <= y) above = block;
  });
  return above;
}

/* something under a heading worth folding: text, a picture, a table… (not just empty lines) */
function foldable(blocks, i) {
  const rank = hRank(blocks[i]);
  for (let k = i + 1; k < blocks.length; k++) {
    const block = blocks[k];
    const blockRank = hRank(block);
    if (blockRank && blockRank <= rank) return false;
    if (blockRank || block.textContent.trim() || hasSolidContent(block)) return true;
  }
  return false;
}

function hasSolidContent(block) {
  return (
    (block.querySelector && block.querySelector('img,table,hr')) || block.tagName === 'HR' || block.tagName === 'TABLE'
  );
}

/* folded headings hide what's under them; a fold with nothing to hide (or an empty heading) is dropped */
export function applyFolds() {
  const editor = ed();
  if (!editor) return;
  let hiding = 0;
  const blocks = edBlocks(editor);
  blocks.forEach((block, i) => {
    const rank = hRank(block);
    if (hiding && rank && rank <= hiding) hiding = 0;
    if (block.classList.contains('fh') !== !!hiding) block.classList.toggle('fh', !!hiding);
    if (hiding || !rank || !block.hasAttribute('data-fold')) return;
    if (block.textContent.trim() && foldable(blocks, i)) hiding = rank;
    else block.removeAttribute('data-fold');
  });
  drawFolds();
}

/* an arrow beside each shown heading with something to fold */
export function drawFolds() {
  const editor = ed();
  const layer = foldLayer(editor);
  if (!layer) return;
  if (editor.classList.contains('wcmode')) {
    layer.innerHTML = '';
    return;
  }
  const blocks = edBlocks(editor);
  const headings = blocks.filter(
    (block, i) =>
      hRank(block) &&
      !block.classList.contains('fh') &&
      block.textContent.trim() &&
      (block.hasAttribute('data-fold') || foldable(blocks, i))
  );
  const html = headings.map(foldButtonHTML).join('');
  layer._hs = headings;
  if (layer.innerHTML !== html) layer.innerHTML = html;
}

function foldLayer(editor) {
  const page = editor && editor.closest('.doc');
  if (!page) return null;
  let layer = page.querySelector(':scope>.foldlayer');
  if (layer) return layer;
  layer = mk('div');
  layer.className = 'foldlayer';
  layer.setAttribute('contenteditable', 'false');
  page.appendChild(layer);
  return layer;
}

function foldButtonHTML(heading, i) {
  const lineHeight = parseFloat(getComputedStyle(heading).lineHeight) || FALLBACK_LINE_HEIGHT;
  const folded = heading.hasAttribute('data-fold');
  const top = Math.round(heading.offsetTop + Math.min(lineHeight, FOLD_LINE_MAX) / 2 - FOLD_BUTTON_HALF);
  const left = Math.round(heading.offsetLeft - FOLD_BUTTON_LEFT);
  return (
    `<button class="foldbtn${folded ? ' on' : ''}" data-foldi="${i}" style="top:${top}px;left:${left}px" ` +
    `title="${folded ? 'Show this section' : 'Fold this section'}" aria-label="${folded ? 'Unfold' : 'Fold'}" ` +
    `aria-expanded="${!folded}"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg></button>`
  );
}

function setFold(heading, on) {
  if (on) heading.setAttribute('data-fold', '');
  else heading.removeAttribute('data-fold');
  foldsChanged();
}

function foldsChanged() {
  applyFolds();
  saveDocSoon();
  if (!$('cmts').hidden) positionCards();
}

const onFoldingMousedown2 = e => {
  const button = e.target.closest && e.target.closest('.foldbtn');
  if (!button) return;
  e.preventDefault();
  const layer = button.parentNode;
  const heading = layer._hs && layer._hs[+button.dataset.foldi];
  if (heading) setFold(heading, !heading.hasAttribute('data-fold'));
};

/* the caret or a jump landing in folded text opens the fold */
export function revealInEd(node) {
  const editor = ed();
  if (!editor || !node || !editor.contains(node)) return;
  const block = mdTopBlock(node);
  let steps = 0;
  while (block && block.classList && block.classList.contains('fh') && steps++ < MAX_REVEAL_STEPS) {
    openFoldAbove(editor, block);
    applyFolds();
  }
  if (steps) saveDocSoon();
}

/* the nearest shown folded heading above a block opens */
function openFoldAbove(editor, block) {
  const blocks = edBlocks(editor);
  for (let k = blocks.indexOf(block) - 1; k >= 0; k--) {
    if (blocks[k].hasAttribute('data-fold') && !blocks[k].classList.contains('fh')) {
      blocks[k].removeAttribute('data-fold');
      return;
    }
  }
}

export function foldAll(on) {
  const editor = ed();
  if (!editor) return;
  const blocks = edBlocks(editor);
  blocks.forEach((block, i) => {
    if (!hRank(block) || !block.textContent.trim() || (on && !foldable(blocks, i))) return;
    if (on) block.setAttribute('data-fold', '');
    else block.removeAttribute('data-fold');
  });
  foldsChanged();
}

/* the arrows (and spec point brackets) follow the notes as they change size */
export function watchFolds() {
  const editor = ed();
  if (!editor || !window.ResizeObserver) return;
  if (foldRO) foldRO.disconnect();
  foldRO = new ResizeObserver(() => {
    clearTimeout(foldRedrawTimer);
    foldRedrawTimer = setTimeout(() => {
      drawFolds();
      drawSp();
    }, FOLD_REDRAW_DELAY);
  });
  foldRO.observe(editor);
}

export function initFolding() {
  document.addEventListener('mousedown', onFoldingMousedown);
  document.addEventListener('mousedown', onFoldingMousedown2);
  /* anything scrolled into view in the notes is revealed first */
  (() => {
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      try {
        revealInEd(this);
      } catch (x) {}
      return scrollIntoView.apply(this, args);
    };
  })();
}
