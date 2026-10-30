import { $, curEssay, openEditor, escapeHtml, uiState } from '../core/helpers-and-state.js';
import { Store } from '../core/storage.js';
import { makeElement } from '../core/paste-cleaning.js';
import { countedIn, edBlocks, tagById, tagCounts, tagNamed, tagsChanged, wcOpts } from './word-count.js';
import { renderWordCount } from './word-count-sidebar.js';

/* ===== word count mode: the text is locked and boxes can be drawn down the left margin to tag paragraphs ===== */
const BOX_PADDING = 8; // px a box reaches above and below its paragraphs
const BOX_OUTSET = 18; // px a box reaches past each side of the text
const EAT_CLICK_FOR = 250; // ms after a drag in which its click is swallowed
const POPUP_MARGIN = 12; // px the naming menu keeps from the window's edges

export function setWcMode(on) {
  const editor = openEditor();
  uiState.wcMode = !!on && uiState.view === 'essay' && !!editor;
  closeTagPop();
  if (editor) {
    editor.setAttribute('contenteditable', uiState.wcMode ? 'false' : 'true');
    editor.classList.toggle('wcmode', uiState.wcMode);
  }
  const page = document.querySelector('.doc');
  if (page) page.classList.toggle('wcmode', uiState.wcMode);
  renderWordCount();
  drawBoxes();
}

/* the layer the boxes are drawn in, on the page */
function boxLayer() {
  const page = document.querySelector('.doc');
  if (!page) return null;
  let layer = $('wclayer');
  if (!layer) {
    layer = makeElement('div');
    layer.id = 'wclayer';
    page.appendChild(layer);
  }
  return layer;
}

/* consecutive paragraphs with the same tag make one box */
export function drawBoxes() {
  if (!uiState.wcMode || uiState.view !== 'essay' || !openEditor()) {
    removeBoxes();
    return;
  }
  const layer = boxLayer();
  const options = wcOpts(curEssay());
  const runs = tagRuns(openEditor(), options);
  spaceRuns(runs); // spacing first, then measure
  const totals = tagCounts(openEditor(), options).by;
  layer.innerHTML = runs.map((run, i) => boxHTML(run, i, runs, options, totals)).join('');
  layer.runs = runs;
}

function removeBoxes() {
  const layer = $('wclayer');
  if (layer) layer.remove();
  if (openEditor())
    openEditor()
      .querySelectorAll('.wcgap,.wcgap-after')
      .forEach(block => block.classList.remove('wcgap', 'wcgap-after'));
}

/* runs of consecutive blocks with the same (existing) tag: { t: tag id, b: blocks } */
function tagRuns(editor, options) {
  const runs = [];
  let run = null;
  edBlocks(editor).forEach(block => {
    let tagId = block.getAttribute('data-wct');
    if (tagId && !tagById(options, tagId)) tagId = null;
    if (tagId && run && run.t === tagId) run.b.push(block);
    else {
      run = tagId ? { t: tagId, b: [block] } : null;
      if (run) runs.push(run);
    }
  });
  return runs;
}

/* room above each box and below it (when untagged text follows) */
function spaceRuns(runs) {
  edBlocks(openEditor()).forEach(block => block.classList.remove('wcgap', 'wcgap-after'));
  runs.forEach(run => {
    run.b[0].classList.add('wcgap');
    const next = run.b[run.b.length - 1].nextElementSibling;
    if (next && next.id !== 'fnlist' && !next.getAttribute('data-wct')) next.classList.add('wcgap-after');
  });
}

/* a box, labelled with its count (and its tag's whole count, on the tag's first box) */
function boxHTML(run, i, runs, options, totals) {
  const tag = tagById(options, run.t);
  const place = geom(run.b[0], run.b[run.b.length - 1]);
  const count = countedIn(run.b, options);
  const first = runs.findIndex(other => other.t === run.t) === i;
  const label = boxLabel(tag, count, first ? totals[run.t] || 0 : count);
  return (
    `<div class="wcbx${tag.exclude ? ' off' : ''}" style="--c:${tag.color};${placeCSS(place)}">` +
    `<button type="button" class="wclab" data-wcedit="${tag.id}">${label}</button>` +
    `<span class="hdl top" data-wcrs="${i}:top" title="Drag to resize"></span>` +
    `<span class="hdl bot" data-wcrs="${i}:bot" title="Drag to resize"></span></div>`
  );
}

/* "Introduction · 120 (of 300) / 500 · not counted": the tag, this box's count, the tag's whole count when it differs,
   its limit, and whether it's counted */
function boxLabel(tag, count, total) {
  const limit = +tag.limit || 0;
  return (
    escapeHtml(tag.name) +
    ' · ' +
    count.toLocaleString() +
    (total !== count ? ' (of ' + total.toLocaleString() + ')' : '') +
    (limit ? ' / ' + limit.toLocaleString() : '') +
    (tag.exclude ? ' · not counted' : '')
  );
}

function placeCSS(place) {
  return `top:${place.top}px;height:${place.h}px;left:${place.left}px;width:${place.w}px`;
}

/* a block range's place on the page, in the page's own (unzoomed) pixels */
function geom(first, last) {
  const editor = openEditor();
  return {
    top: first.offsetTop - BOX_PADDING,
    h: last.offsetTop + last.offsetHeight - first.offsetTop + BOX_PADDING * 2,
    left: editor.offsetLeft - BOX_OUTSET,
    w: editor.offsetWidth + BOX_OUTSET * 2
  };
}

/* which paragraph is at this height on screen (nearest one) */
function blockAtY(y) {
  let best = null;
  let bestDistance = Infinity;
  edBlocks(openEditor()).forEach(block => {
    const box = block.getBoundingClientRect();
    const distance = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = block;
    }
  });
  return best;
}

/* ---- dragging: a new box from the margin, or a box's end to resize it ---- */
let wcDrag = null;

const onWordCountBoxesMousedown = e => {
  if (!uiState.wcMode || e.button !== 0) return;
  if (!document.querySelector('.doc') || !openEditor()) return;
  const handle = e.target.closest && e.target.closest('[data-wcrs]');
  wcDrag = handle ? resizeDrag(handle) : newBoxDrag(e);
  if (!wcDrag) return;
  e.preventDefault();
  closeTagPop();
  drawTemp();
};

/* resizing: the opposite end of the box is held still */
function resizeDrag(handle) {
  const [index, end] = handle.dataset.wcrs.split(':');
  const run = $('wclayer').runs[+index];
  const firstBlock = run.b[0];
  const lastBlock = run.b[run.b.length - 1];
  return {
    anchor: end === 'top' ? lastBlock : firstBlock,
    cur: end === 'top' ? firstBlock : lastBlock,
    tag: run.t,
    old: run.b.slice()
  };
}

/* only the left margin starts a box */
function newBoxDrag(e) {
  if (e.target.closest('.wclab,.tagpop')) return null;
  const text = openEditor().getBoundingClientRect();
  const page = document.querySelector('.doc').getBoundingClientRect();
  if (e.clientX >= text.left || e.clientX < page.left) return null;
  const block = blockAtY(e.clientY);
  return block ? { anchor: block, cur: block, tag: null } : null;
}

const onWordCountBoxesMousemove = e => {
  if (!wcDrag) return;
  const block = blockAtY(e.clientY);
  if (!block || block === wcDrag.cur) return;
  wcDrag.cur = block;
  drawTemp();
};

// the click that ends a drag must not close the menu the drag just opened
export let wcEatClick = false;
export function setWcEatClick(value) {
  wcEatClick = value;
  return value;
}
const onWordCountBoxesClick = e => {
  if (!wcEatClick) return;
  wcEatClick = false;
  e.stopPropagation();
  e.preventDefault();
};

const onWordCountBoxesMouseup = () => {
  if (!wcDrag) return;
  const drag = wcDrag;
  wcDrag = null;
  wcEatClick = true;
  setTimeout(() => (wcEatClick = false), EAT_CLICK_FOR);
  const range = dragRange(drag);
  const temp = $('wctemp');
  if (!drag.tag) {
    openTagPop(range, temp);
    return;
  }
  // resize: the old run loses its tag, the new range gets it
  drag.old.forEach(block => {
    if (block.getAttribute('data-wct') === drag.tag) block.removeAttribute('data-wct');
  });
  range.forEach(block => block.setAttribute('data-wct', drag.tag));
  if (temp) temp.remove();
  tagsChanged();
};

function dragRange(drag) {
  const blocks = edBlocks(openEditor());
  const from = blocks.indexOf(drag.anchor);
  const to = blocks.indexOf(drag.cur);
  if (from < 0 || to < 0) return [];
  return blocks.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/* the box being dragged, with how much it holds */
function drawTemp() {
  const layer = boxLayer();
  if (!layer) return;
  let temp = $('wctemp');
  if (!temp) {
    temp = makeElement('div');
    temp.id = 'wctemp';
    temp.className = 'wcbx temp';
    layer.appendChild(temp);
  }
  const range = dragRange(wcDrag);
  temp.style.cssText = placeCSS(geom(range[0], range[range.length - 1]));
  const count = countedIn(range, wcOpts(curEssay()));
  const paragraphs = range.length + ' paragraph' + (range.length === 1 ? '' : 's');
  temp.setAttribute('data-n', paragraphs + ' · ' + count.toLocaleString() + ' words');
}

/* ---- naming a box ---- */
export let tagPop = null;

export function closeTagPop() {
  if (!tagPop) return;
  if (tagPop.tmp && tagPop.tmp.parentNode) tagPop.tmp.remove();
  tagPop.remove();
  tagPop = null;
}

/* the usual section names not used yet (the next body paragraph's number among them) */
function presetNames(options) {
  const used = new Set(options.tags.map(tag => tag.name.toLowerCase()));
  let body = 1;
  while (used.has('body paragraph ' + body)) body++;
  return ['Abstract', 'Introduction', 'Body paragraph ' + body, 'Conclusion', 'References'].filter(
    name => !used.has(name.toLowerCase())
  );
}

function openTagPop(range, temp) {
  closeTagPop();
  if (!range.length) {
    if (temp) temp.remove();
    return;
  }
  const pop = makeElement('div');
  pop.className = 'tagpop';
  pop.tmp = temp;
  pop.range = range;
  pop.innerHTML = tagPopHTML(range, wcOpts(curEssay()));
  document.body.appendChild(pop);
  tagPop = pop;
  placeTagPop(pop, (temp || range[0]).getBoundingClientRect());
  const name = pop.querySelector('input');
  name.focus();
  name.addEventListener('keydown', e => tagPopKey(e, name, range));
  pop.addEventListener('click', e => tagPopClick(e, range));
}

function tagPopHTML(range, options) {
  const existing = options.tags.map(
    tag =>
      `<button data-tpuse="${tag.id}"><i class="dot" style="background:${tag.color}"></i>${escapeHtml(tag.name)}</button>`
  );
  const presets = presetNames(options).map(
    name => `<button data-tpnew="${escapeHtml(name)}"><i class="dot new"></i>${escapeHtml(name)}</button>`
  );
  const untag = range.some(block => block.hasAttribute('data-wct'))
    ? '<button data-tpclear class="del">Untag these</button>'
    : '<span></span>';
  return (
    `<h5>Tag ${range.length} paragraph${range.length === 1 ? '' : 's'} as</h5>` +
    `<div class="tp-list">${existing.join('')}${presets.join('')}</div>` +
    '<input type="text" placeholder="Or type a name and press Return">' +
    `<div class="tp-row">${untag}<button data-tpcancel>Cancel</button></div>`
  );
}

/* beside the box, kept inside the window */
function placeTagPop(pop, near) {
  const width = document.documentElement.clientWidth;
  pop.style.left = Math.max(POPUP_MARGIN, Math.min(near.left, width - pop.offsetWidth - POPUP_MARGIN)) + 'px';
  pop.style.top = Math.max(POPUP_MARGIN, Math.min(near.top, innerHeight - pop.offsetHeight - POPUP_MARGIN)) + 'px';
}

function tagPopKey(e, name, range) {
  if (e.key === 'Enter' && name.value.trim()) {
    e.preventDefault();
    applyTag(range, null, name.value.trim());
  } else if (e.key === 'Escape') closeTagPop();
}

function tagPopClick(e, range) {
  const button = e.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-tpcancel')) closeTagPop();
  else if (button.hasAttribute('data-tpclear')) {
    range.forEach(block => block.removeAttribute('data-wct'));
    closeTagPop();
    tagsChanged();
  } else if (button.dataset.tpuse) applyTag(range, button.dataset.tpuse);
  else if (button.dataset.tpnew) applyTag(range, null, button.dataset.tpnew);
}

/* an existing tag (by id), or one by name (made if it's new) */
function applyTag(range, id, name) {
  closeTagPop();
  if (!id) {
    const essay = curEssay();
    essay.wc = wcOpts(essay);
    id = tagNamed(essay.wc, name).id;
    Store.saveEssays();
  }
  range.forEach(block => block.setAttribute('data-wct', id));
  tagsChanged();
}

export function initWordCountBoxes() {
  document.addEventListener('mousedown', onWordCountBoxesMousedown);
  document.addEventListener('mousemove', onWordCountBoxesMousemove);
  document.addEventListener('click', onWordCountBoxesClick, true);
  document.addEventListener('mouseup', onWordCountBoxesMouseup);
}
