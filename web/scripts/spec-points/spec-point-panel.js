import { caretInto, selectRange } from '../core/caret.js';
import { tbMenu } from '../core/toolbar-menu.js';
import { STATUS } from '../core/example-data.js';
import { $, ed, esc, ptById, pts, toast, ui } from '../core/helpers-and-state.js';
import { lvl } from '../syllabus/point-levels.js';
import { Store } from '../core/storage.js';
import { mk } from '../core/paste-cleaning.js';
import { groups } from '../syllabus/model.js';
import { ratingBarHTML, sideClosed, sideHd } from '../syllabus/syllabus-view.js';
import { render } from '../view/page-render.js';
import { headerHeight } from '../view/zoom.js';
import { edBlocks } from '../essays/word-count.js';
import { mdTopBlock } from '../writing/writing.js';
import { sylInfo } from '../editor/caret-and-keys.js';
import { revealInEd, solidBlock } from '../editor/folding.js';
import { drawSp, spChanged, spOf, spRuns, spShort } from './spec-point-tags.js';
import { setSpDrag } from './spec-point-dragging.js';
import { closeSpPick, spPick } from './spec-point-picker.js';

/* ===== the spec points panel, and going to a point's notes ===== */
const FLASH_FOR = 1400; // ms a point's notes stay lit after going to them
const SCROLL_BELOW_HEADER = 24; // px between the header and a point's notes, gone to
const RATINGS = 5; // ratings run 0 (not rated) to 4

/* each click moves on to the next place the point is tagged; a point not in the notes yet gets a place */
export function spGo(id, fromMargin) {
  const point = ptById(id);
  if (!point) return;
  if (ui.view !== 'notes') {
    ui.view = 'notes';
    render();
  }
  const runs = spRuns().filter(run => run.id === id);
  ui.spCur = id;
  if (!runs.length) {
    addPlaceFor(point);
    return;
  }
  goToNextPlace(point, runs, fromMargin);
}

/* the place after the one gone to last time (the first, the first time) */
function goToNextPlace(point, runs, fromMargin) {
  const index = (ui.spNext && ui.spNext.id === point.id ? ui.spNext.i + 1 : 0) % runs.length;
  ui.spNext = { id: point.id, i: index };
  showRun(runs[index], fromMargin);
  drawSp();
  spMarkPanel(fromMargin);
  if (runs.length > 1)
    toast(`${point.code || 'This point'}: place ${index + 1} of ${runs.length} — click again for the next`);
}

/* a short heading and a line to write on, where you were writing (an empty line becomes the heading; otherwise it
   goes after the line you're on). With no place in the notes yet, after the points before it. */
function addPlaceFor(point) {
  const heading = mk(lvl(point) === 3 ? 'h3' : 'h2');
  heading.textContent = point.code || spShort(point.text);
  heading.setAttribute('data-sp', point.id);
  const line = mk('p');
  line.innerHTML = '<br>';
  line.setAttribute('data-sp', point.id);
  const here = writingBlock();
  if (here && isEmptyLine(here)) here.replaceWith(heading);
  else if (here) here.after(heading);
  else placeInPointOrder(heading, point.id);
  heading.after(line);
  revealInEd(line);
  line.scrollIntoView({ block: 'center' });
  caretInto(line);
  toast('Added a place for ' + (point.code || 'this point') + ' — rename the heading to something short');
  spChanged();
}

/* the top-level block the caret was last in */
function writingBlock() {
  const editor = ed();
  const last =
    ui.lastRange && editor.contains(ui.lastRange.startContainer) ? mdTopBlock(ui.lastRange.startContainer) : null;
  return last && last.id !== 'fnlist' && last.parentNode === editor ? last : null;
}

function isEmptyLine(block) {
  return (
    block.tagName === 'P' &&
    !block.textContent.replace(/[\u200b\s]/g, '') &&
    !block.querySelector('img,[data-cite],[data-fn],[data-imath]')
  );
}

/* after the last block tagged with a point that comes before this one (else at the end, before the footnotes) */
function placeInPointOrder(heading, id) {
  const editor = ed();
  const order = pts.map(point => point.id);
  const position = order.indexOf(id);
  let after = null;
  edBlocks(editor).forEach(block => {
    const tagged = spOf(block);
    if (tagged && order.indexOf(tagged) < position) after = block;
  });
  const footnotes = $('fnlist');
  if (after) after.after(heading);
  else if (footnotes && footnotes.parentNode === editor) editor.insertBefore(heading, footnotes);
  else editor.appendChild(heading);
}

/* scrolled to (below the header), lit up, and (unless from the margin) the caret at the end of its first text */
function showRun(run, fromMargin) {
  revealInEd(run.b[0]);
  const header = headerHeight();
  window.scrollTo(0, run.b[0].getBoundingClientRect().top + window.scrollY - header - SCROLL_BELOW_HEADER);
  run.b.forEach(spFlash);
  const text = !fromMargin && run.b[0] ? run.b.find(block => !solidBlock(block)) : null;
  if (!text) return;
  const range = document.createRange();
  range.selectNodeContents(text);
  range.collapse(false);
  selectRange(range);
  ed().focus({ preventScroll: true });
}

/* lit up for a moment (restarted if it's already lit) */
function spFlash(block) {
  block.classList.remove('spflash');
  void block.offsetWidth;
  block.classList.add('spflash');
  setTimeout(() => block.classList.remove('spflash'), FLASH_FOR);
}

/* the panel follows the caret: the point of the paragraph you're in is marked */
function spMarkPanel(scroll) {
  document.querySelectorAll('#side .spi').forEach(row => row.classList.toggle('cur', row.dataset.spgo === ui.spCur));
  if (scroll) {
    const current = document.querySelector('#side .spi.cur');
    if (current) current.scrollIntoView({ block: 'nearest' });
  }
  document.querySelectorAll('#splayer .spbr').forEach((bracket, i) => {
    const run = $('splayer').runs[i];
    bracket.classList.toggle('cur', !!run && run.id === ui.spCur);
  });
}

const onSpecPointPanelSelectionchange = () => {
  if (ui.view !== 'notes' || !ed()) return;
  const selection = getSelection();
  if (!selection.rangeCount || !ed().contains(selection.anchorNode)) return;
  const block = mdTopBlock(selection.anchorNode);
  const id = block && spOf(block);
  if (!id || id === ui.spCur) return;
  ui.spCur = id;
  spMarkPanel(true);
};

/* hovering a point in the panel lights up its notes */
const onSpecPointPanelMouseover = e => {
  const row = e.target.closest && e.target.closest('#side .spi');
  const id = row && row.dataset.spgo;
  if (id === ui.spHover) return;
  ui.spHover = id;
  const editor = ed();
  if (!editor) return;
  editor.querySelectorAll('.sphover').forEach(block => block.classList.remove('sphover'));
  if (!id) return;
  editor.querySelectorAll('[data-sp="' + id + '"]').forEach(block => {
    if (block.parentNode === editor) block.classList.add('sphover');
  });
};

/* ---- the panel: the points by section, each with its rating and how often it's in the notes ---- */
/* after an edit, in the notes: the panel is redrawn */
export function redrawSpPanel() {
  if (ui.view === 'notes') renderSpPanel();
}

export function renderSpPanel() {
  const current = sylInfo().cur;
  const head = sideHd(current && current.title ? esc(current.title) : 'Syllabus');
  const sections = sideClosed() ? null : groups();
  if (!sections) $('side').innerHTML = head;
  else if (!sections.length) $('side').innerHTML = head + noPointsHTML();
  else {
    const counts = {};
    spRuns().forEach(run => (counts[run.id] = (counts[run.id] || 0) + 1));
    $('side').innerHTML = head + spModeHTML() + sections.map(section => sectionHTML(section, counts)).join('');
  }
}

function noPointsHTML() {
  const message =
    sylInfo().cur || !window.__NB__
      ? 'No points yet. Add them in the Syllabus view.'
      : 'This notebook doesn’t follow a syllabus. Pick one with Syllabus at the top, or start one in the Syllabus view.';
  return `<p class="sphint">${message}</p>`;
}

function spModeHTML() {
  const mode = !!ui.spMode;
  const hint = mode
    ? '<p class="sphint">Drag down the left margin of your notes to tag them; drag a bracket’s ends to resize it. Esc when you’re done.</p>'
    : '';
  return (
    `<button type="button" class="wcmodebtn${mode ? ' on' : ''}" data-spmode="1" aria-pressed="${mode}">` +
    `${mode ? 'Done tagging' : 'Tag notes with spec points'}</button>${hint}`
  );
}

/* a section: how many of its points are in the notes, a bar of its ratings, and its points */
function sectionHTML(section, counts) {
  const bar = ratingBarHTML(section.all);
  const inNotes = section.all.filter(point => counts[point.id]).length;
  return (
    `<div class="sps"><div class="spsh"><span>${esc(section.sec || 'Untitled section')}</span>` +
    `<em>${inNotes}/${section.all.length}</em></div><div class="prog" aria-hidden="true">${bar}</div>` +
    section.all.map(point => spPointRowHTML(point, counts[point.id] || 0)).join('') +
    '</div>'
  );
}

function spPointRowHTML(point, count) {
  const rating = point.status || 0;
  const className = (lvl(point) === 3 ? ' sub' : '') + (count ? '' : ' none') + (ui.spCur === point.id ? ' cur' : '');
  const title =
    (count ? 'Go to its notes' : 'Not in your notes yet: click to add a place for it') +
    ' · ' +
    (point.code ? point.code + ': ' : '') +
    point.text;
  const ratingTitle =
    (rating ? rating + ': ' + STATUS[rating] : 'Not rated') + ' (click for next, shift-click for previous)';
  return (
    `<div class="spi${className}" data-spgo="${point.id}" role="button" tabindex="0" title="${esc(title)}">` +
    `<button type="button" class="spdot" data-spcyc="${point.id}" style="--c:var(--s${rating})" title="${esc(ratingTitle)}">` +
    `${rating || ''}</button><span class="spx"><code>${esc(point.code || '')}</code>${esc(point.text)}</span>` +
    (count ? `<em>${count > 1 ? count + '×' : '✓'}</em>` : '') +
    '</div>'
  );
}

/* ---- the panel's clicks: a rating, tagging mode, a point ---- */
const onSpecPointPanelClick = e => {
  const target = e.target.closest ? e.target : null;
  const rating = target && target.closest('[data-spcyc]');
  const modeButton = target && target.closest('[data-spmode]');
  const row = target && target.closest('#side .spi');
  if (rating) {
    e.stopPropagation();
    cycleRating(rating.dataset.spcyc, e.shiftKey);
  } else if (modeButton) {
    e.stopPropagation();
    setSpMode(!ui.spMode);
  } else if (row) {
    e.preventDefault();
    spGo(row.dataset.spgo);
  }
};

/* the next rating (⇧: the one before), round from 4 to not rated */
function cycleRating(id, back) {
  const point = ptById(id);
  if (!point) return;
  point.status = ((point.status || 0) + (back ? RATINGS - 1 : 1)) % RATINGS;
  Store.savePoint(point);
  renderSpPanel();
  drawSp();
}

/* tagging mode: the brackets and the margin to drag in only show while it's on */
function setSpMode(on) {
  ui.spMode = !!on;
  if (!on) {
    closeSpPick();
    setSpDrag(null);
  }
  drawSp();
  renderSpPanel();
}

const onSpecPointPanelKeydown = e => {
  if (e.key === 'Escape' && ui.spMode && !spPick && ui.view === 'notes' && !tbMenu) setSpMode(false);
};

export function initSpecPointPanel() {
  document.addEventListener('selectionchange', onSpecPointPanelSelectionchange);
  document.addEventListener('mouseover', onSpecPointPanelMouseover);
  document.addEventListener('click', onSpecPointPanelClick, true);
  document.addEventListener('keydown', onSpecPointPanelKeydown);
}
