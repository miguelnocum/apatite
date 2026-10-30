import { $, ed, esc, ptById, ui } from '../core/helpers-and-state.js';
import { mk } from '../core/paste-cleaning.js';
import { renderSide } from '../syllabus/syllabus-view.js';
import { saveDocSoon } from '../editor/notes-document.js';
import { positionCards } from '../editor/comments.js';
import { edBlocks } from '../essays/word-count.js';
import { spDrag, spTemp } from './spec-point-dragging.js';

/* ===== spec points: a side panel, and parts of the notes tagged with them =====
   A paragraph (or list, table, picture…) carries data-sp="<point id>". Consecutive blocks with the same point show
   as one bracket in the left margin; drag down the margin to tag, drag a bracket's ends to resize it. */
const SHORT_NAME_WORDS = 6; // a point without a code is named by this many of its words
const BRACKET_PAD = 3; // px a bracket reaches above and below its blocks
const BRACKET_LEFT = 50; // px left of the text a bracket sits
const TINT_PAD = 4; // px the tinted box behind the blocks reaches past the bracket, above and below
const TINT_OUTSET = 14; // px the tinted box reaches past each side of the text
const HANDLE_HALF = 6; // px half the height of a resize handle
const GUTTER_MIN = 20; // px the margin to drag in is at least this wide
const GUTTER_GAP = 38; // px between the margin to drag in and the text

/* the point a block is tagged with, if that point still exists */
export function spOf(block) {
  const id = block && block.getAttribute && block.getAttribute('data-sp');
  return id && ptById(id) ? id : null;
}

/* runs of consecutive blocks tagged with the same point: { id, b: blocks } */
export function spRuns() {
  const editor = ed();
  const runs = [];
  let run = null;
  if (!editor) return runs;
  edBlocks(editor).forEach(block => {
    const id = spOf(block);
    if (id && run && run.id === id) run.b.push(block);
    else {
      run = id ? { id, b: [block] } : null;
      if (run) runs.push(run);
    }
  });
  return runs;
}

export function spShort(text) {
  const words = String(text || '')
    .trim()
    .split(/\s+/);
  return words.length > SHORT_NAME_WORDS ? words.slice(0, SHORT_NAME_WORDS).join(' ') + '…' : words.join(' ');
}

/* the visible part of a run of blocks, in the page's own pixels */
export function spGeom(blocks) {
  const visible = blocks.filter(block => block.offsetHeight > 0);
  if (!visible.length) return null;
  const first = visible[0];
  const last = visible[visible.length - 1];
  return {
    top: first.offsetTop - BRACKET_PAD,
    h: last.offsetTop + last.offsetHeight - first.offsetTop + BRACKET_PAD * 2,
    left: ed().offsetLeft - BRACKET_LEFT
  };
}

/* the tinted box behind a run: its top, height, left and width */
export function spTintGeom(place) {
  const editor = ed();
  return {
    top: place.top - TINT_PAD,
    h: place.h + TINT_PAD * 2,
    left: editor.offsetLeft - TINT_OUTSET,
    w: editor.offsetWidth + TINT_OUTSET * 2
  };
}

/* a layer of the page, made (or moved back onto the page) if need be */
function pageLayer(id, putFirst) {
  const page = ed() && ed().closest('.doc');
  if (!page) return null;
  let layer = $(id);
  if (layer && layer.parentNode === page) return layer;
  if (layer) layer.remove();
  layer = mk('div');
  layer.id = id;
  if (putFirst) page.insertBefore(layer, page.firstChild);
  else page.appendChild(layer);
  return layer;
}

/* the tinted boxes sit behind the text; brackets and handles in front */
export function spBg() {
  return pageLayer('spbg', true);
}

export function spLayer() {
  return pageLayer('splayer', false);
}

export function drawSp() {
  const layer = spLayer();
  if (!layer) return;
  const behind = spBg();
  if (ui.view !== 'notes' || !ui.spMode) {
    layer.innerHTML = '';
    if (behind) behind.innerHTML = '';
    return;
  }
  const runs = spRuns();
  const drawn = runs.map((run, i) => [spGeom(run.b), run, i]).filter(([place]) => place);
  const gutterWidth = Math.max(GUTTER_MIN, ed().offsetLeft - GUTTER_GAP);
  if (behind) behind.innerHTML = drawn.map(([place, run]) => tintHTML(place, run)).join('');
  layer.innerHTML =
    `<div class="spgut" style="width:${gutterWidth}px" title="Drag down here to tag your notes with a spec point"></div>` +
    drawn.map(([place, run, i]) => bracketHTML(place, run, i)).join('');
  layer.runs = runs;
  if (spDrag) spTemp();
}

/* a run's colour (its point's rating) and whether it's the current point */
function runLook(run) {
  const point = ptById(run.id);
  return { point, color: '--c:var(--s' + (point.status || 0) + ')', cur: ui.spCur === run.id ? ' cur' : '' };
}

export function boxStyle(place) {
  return `top:${place.top}px;height:${place.h}px;left:${place.left}px;width:${place.w}px`;
}

function tintHTML(place, run) {
  const look = runLook(run);
  return `<div class="spbox${look.cur}" style="${look.color};${boxStyle(spTintGeom(place))}"></div>`;
}

/* the bracket, its label, and a handle on the tinted box's top and bottom */
function bracketHTML(place, run, i) {
  const { point, color, cur } = runLook(run);
  const tint = spTintGeom(place);
  const handle = (end, top, title) =>
    `<div class="sph ${end}${cur}" data-sprs="${i}:${end}" style="${color};top:${top}px;left:${tint.left}px;` +
    `width:${tint.w}px" title="${title}"></div>`;
  return (
    `<div class="spbr${cur}" style="${color};top:${place.top}px;height:${place.h}px;left:${place.left}px" ` +
    `title="${esc((point.code ? point.code + ': ' : '') + point.text)}">` +
    `<button type="button" class="splab" data-splab="${run.id}">${esc(point.code || spShort(point.text))}</button></div>` +
    handle('top', tint.top - HANDLE_HALF, 'Drag to move the top of this block') +
    handle('bot', tint.top + tint.h - HANDLE_HALF, 'Drag to move the bottom of this block')
  );
}

export function spChanged() {
  saveDocSoon();
  drawSp();
  renderSide();
  if (!$('cmts').hidden) positionCards();
}
