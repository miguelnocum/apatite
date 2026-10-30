import { $, esc, ptById, pts, setPts, toast, ui, uid } from '../core/helpers-and-state.js';
import { kidsOf, lvl, normLevels, numberSection, setLevel } from './point-levels.js';
import { Store, queue } from '../core/storage.js';
import { mk } from '../core/paste-cleaning.js';
import { commit, groups } from './model.js';
import { cfHTML, renderSide } from './syllabus-view.js';
import { importHTML, sectionNames, suggestCode } from './syllabus-import.js';
import { addBanner, flash, secPts } from '../view/page-render.js';
import { inDoc } from '../editor/notes-document.js';
import { setWcEatClick } from '../essays/word-count-boxes.js';

/* ===== editing the syllabus in place: it looks like the syllabus, the text is editable where it stands,
   and the cards themselves drag (a point brings its sub-points; nudge a card right or left to change its level) ===== */
const SECTION_RENAME_DELAY = 400; // ms after typing a section's title before the side panel shows it
const INSERT_LINE_REACH = 12; // px above a row's bottom edge where the + line shows
const INSERT_LINE_TOP_REACH = 8; // px below a row's top edge that count as the gap above it
const DRAG_START = 6; // px a card moves before it's dragged
const LEVEL_NUDGE = 36; // px right (or left) that makes a dragged card a sub-point (or a point)
const NUDGE_LIMIT = 40; // px a single card can move sideways while dragged
const CARD_SETTLE = 'transform .18s ease';

/* a new, empty point */
function newPoint(section, level) {
  return { id: uid(), sec: section, code: '', text: '', guide: '', status: 0, notes: '', lvl: level };
}

/* ---- the table: the same table as the syllabus itself, column for column, so nothing moves when editing starts: the text
   becomes editable where it stands, and the tools (renumber, delete) float over the rows instead of taking room ---- */
export function renderEdit() {
  const sections = groups();
  ui.secMap = {};
  sections.forEach(g => (ui.secMap[g.idx] = g.all.map(p => p.id)));
  const rows = sections.map(g => sectionRowHTML(g) + g.all.map(pointRowHTML).join('')).join('');
  const table =
    '<div class="ywrap"><div class="tw"><table class="syl syled"><thead><tr><th class="cfh" title="Confidence">Conf.</th>' +
    `<th>Code</th><th>Statement</th><th>Guidance</th></tr></thead><tbody id="syledb">${rows}</tbody></table></div>` +
    /* the + line sits outside the scrolling table, so it isn't cut off under the last row */
    '<div class="yins" id="yins" hidden><button type="button" class="yplus" title="Add a point here" aria-label="Add a point ' +
    'here"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9"/></svg></button></div></div>';
  /* pasting a whole syllabus comes after the table, so the table starts where it always does */
  $('main').innerHTML = table + editFooterHTML() + '<div style="margin-top:22px">' + importHTML() + '</div>';
  addBanner();
}

function sectionRowHTML(g) {
  const sure = ui.confirm === 's' + g.idx;
  const count = g.all.length;
  const deleteLabel = sure ? `Delete section and its ${count} point${count === 1 ? '' : 's'}?` : '×';
  return (
    `<tr class="sr" data-ysec="${g.idx}"><td colspan="4"><span class="ysn" contenteditable="plaintext-only" spellcheck="false" ` +
    `data-ysname="${g.idx}" data-ph="Section title">${esc(g.sec)}</span><span class="ytools">` +
    `<button class="ynum" data-ynum="${g.idx}" title="Renumber this section’s points from its title: 1.1, 1.1.1">Renumber</button>` +
    `<button class="yb del${sure ? ' sure' : ''}" data-ydelsec="${g.idx}" title="Delete this section and its points">${deleteLabel}</button>` +
    '</span></td></tr>'
  );
}

function pointRowHTML(p) {
  const sure = ui.confirm === p.id;
  const kind = lvl(p) === 3 ? ' sub' : kidsOf(p).length ? ' par' : '';
  const deleteLabel = sure ? 'It has notes or a rating — delete anyway?' : '×';
  return (
    `<tr class="pr${kind}" data-yid="${p.id}" data-s="${p.status || 0}"><td class="cfc">${cfHTML(p)}</td>` +
    `<td class="c"><span contenteditable="plaintext-only" spellcheck="false" data-yc="${p.id}" data-ph="${esc(suggestCode(p) || 'Code')}">${esc(p.code)}</span></td>` +
    `<td><span contenteditable="plaintext-only" data-yt="${p.id}" data-ph="What to learn">${esc(p.text)}</span></td>` +
    `<td class="g"><span contenteditable="plaintext-only" data-yg="${p.id}" data-ph="Guidance (optional)">${esc(p.guide)}</span>` +
    `<button class="yb del ydelpt${sure ? ' sure' : ''}" data-ydel="${p.id}" title="Delete this point">${deleteLabel}</button></td></tr>`
  );
}

function editFooterHTML() {
  return (
    '<div class="row yfoot"><button class="btn" data-yaddsec="1">+ Add section</button><button class="btn pri" id="editbtn2">' +
    'Done editing</button><span class="yhint">Hover under a row and click + to add a point there · drag a card to move ' +
    'it (nudge right for a sub-point, left for a point) · Return adds a point below</span></div>'
  );
}

/* after a change: saved, and the table and side panel drawn again (a change of the user's own: not the example any more) */
function syllabusEdited(ownChange) {
  if (ownChange) Store.example = false;
  Store.saveLocal();
  renderEdit();
  renderSide();
}

/* the caret at the end of a field in the table */
function focusSyllabusField(selector) {
  const field = document.querySelector(selector);
  if (!field) return;
  field.scrollIntoView({ block: 'nearest' });
  field.focus();
  const range = document.createRange();
  range.selectNodeContents(field);
  range.collapse(false);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/* ---- typing in place ---- */
const onSyllabusEditingInput = function (e) {
  const field = e.target;
  const data = field.dataset || {};
  if (!field.closest || !field.closest('.syled')) return;
  const id = data.yc || data.yt || data.yg;
  if (id) pointTyped(ptById(id), data, field.textContent);
  else if (data.ysname != null) sectionRenamed(data.ysname, field.textContent.trim());
};

function pointTyped(point, data, value) {
  if (!point) return;
  if (data.yc) point.code = value.trim();
  else if (data.yt) point.text = value;
  else point.guide = value;
  Store.example = false;
  queue(point);
}

function sectionRenamed(sectionIndex, name) {
  (ui.secMap[sectionIndex] || []).forEach(id => {
    const point = ptById(id);
    if (!point) return;
    point.sec = name;
    queue(point);
  });
  Store.example = false;
  clearTimeout(ui.sideT);
  ui.sideT = setTimeout(renderSide, SECTION_RENAME_DELAY);
}

/* a point after another (and after its sub-points), at its level, with the caret in its statement */
function addPointAfter(point) {
  const family = [point].concat(kidsOf(point));
  const added = newPoint(point.sec, lvl(point));
  pts.splice(pts.indexOf(family[family.length - 1]) + 1, 0, added);
  commit(pts.slice());
  numberSection(point.sec, true);
  syllabusEdited(true);
  focusSyllabusField(`[data-yt="${added.id}"]`);
}

/* Esc leaves a field; Return adds a point below (in a section title, goes to its first point); ⌘] and ⌘[ change the level */
const onSyllabusEditingKeydown = function (e) {
  const field = e.target;
  const data = field.dataset || {};
  if (!field.closest || !field.closest('.syled')) return;
  if (e.key === 'Escape') field.blur();
  else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    returnInSyllabus(field, data);
  } else if ((e.metaKey || e.ctrlKey) && (e.key === ']' || e.key === '[')) changeLevelByKey(e, field, data);
};

function returnInSyllabus(field, data) {
  if (data.ysname != null) {
    const first = (ui.secMap[data.ysname] || [])[0];
    if (first) focusSyllabusField(`[data-yt="${first}"]`);
    else field.blur();
    return;
  }
  const point = ptById(data.yc || data.yt || data.yg);
  if (point) addPointAfter(point);
}

function changeLevelByKey(e, field, data) {
  const row = field.closest('tr.pr');
  if (!row) return;
  e.preventDefault();
  const attribute = data.yt ? 'data-yt' : data.yg ? 'data-yg' : 'data-yc';
  setLevel(row.dataset.yid, e.key === ']' ? 3 : 2);
  focusSyllabusField(`[${attribute}="${row.dataset.yid}"]`);
}

/* pasted into a field: plain text, on one line */
const onSyllabusEditingPaste = function (e) {
  if (!e.target.closest || !e.target.closest('.syled [contenteditable]')) return;
  e.preventDefault();
  const text = (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' ');
  document.execCommand('insertText', false, text);
};

/* ---- the table's buttons ---- */
const onSyllabusEditingClick = function (e) {
  const button = e.target.closest && e.target.closest('.syled .yb,.syled .ynum,[data-yaddsec]');
  if (!button) return;
  e.preventDefault();
  const data = button.dataset;
  if (data.ydel) deletePoint(data.ydel);
  else if (data.ydelsec != null) deleteSection(data.ydelsec);
  else if (data.yaddpt != null) addPointToSection(data.yaddpt);
  else if (data.ynum != null) renumberSection(data.ynum);
  else if (data.yaddsec) addSection();
};

/* a point with notes or a rating asks first */
function deletePoint(id) {
  const point = ptById(id);
  if (!point) return;
  if ((inDoc(point.id) || point.status) && ui.confirm !== point.id) {
    ui.confirm = point.id;
    renderEdit();
    return;
  }
  ui.confirm = null;
  setPts(pts.filter(p => p !== point));
  Store.delPoint(point.id);
  normLevels();
  numberSection(point.sec, true);
  syllabusEdited(false);
}

/* a section always asks first */
function deleteSection(index) {
  if (ui.confirm !== 's' + index) {
    ui.confirm = 's' + index;
    renderEdit();
    return;
  }
  const points = secPts(index);
  ui.confirm = null;
  points.forEach(p => Store.delPoint(p.id));
  setPts(pts.filter(p => !points.includes(p)));
  syllabusEdited(false);
}

/* a point at the end of a section (after its last point, not a sub-point) */
function addPointToSection(index) {
  const points = secPts(index);
  if (points.length) addPointAfter(points.filter(p => lvl(p) === 2).pop() || points[points.length - 1]);
}

function renumberSection(index) {
  const first = secPts(index)[0];
  if (!first || !numberSection(first.sec, false)) return;
  Store.example = false;
  Store.saveLocal();
  renderEdit();
  toast('Section renumbered');
}

/* a new section at the end, its title selected to be typed over */
function addSection() {
  let name = 'New section';
  for (let n = 2; sectionNames().includes(name); n++) name = 'New section ' + n;
  pts.push(newPoint(name, 2));
  commit(pts.slice());
  syllabusEdited(true);
  const titles = document.querySelectorAll('[data-ysname]');
  const title = titles[titles.length - 1];
  if (!title) return;
  title.scrollIntoView({ block: 'center' });
  title.focus();
  const range = document.createRange();
  range.selectNodeContents(title);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/* ---- the green + line: hover just under a row to add a point exactly there ---- */
let yIns = null; // the row the + line is under

const onSyllabusEditingMousemove = function (e) {
  const line = $('yins');
  if (!line || !ui.edit || ui.view !== 'syl') return;
  if (yd && yd.on) {
    line.hidden = true;
    return;
  }
  const area = line.parentNode.getBoundingClientRect();
  if (!line.contains(e.target)) {
    const row = rowAboveInsertLine(e, line.parentNode);
    yIns = row;
    if (!row) {
      line.hidden = true;
      return;
    }
    line.hidden = false;
    line.style.top = row.getBoundingClientRect().bottom - area.top + 'px';
  }
  followPointer(line.firstElementChild, e.clientX - area.left, area.width);
};

/* the + slides along its line under the pointer, kept inside the table */
function followPointer(plus, x, width) {
  const half = plus.offsetWidth / 2;
  plus.style.left = Math.max(4, Math.min(width - 2 * half - 4, x - half)) + 'px';
}

/* the row whose bottom edge the pointer is at (or the row above, when at the top of a row) */
function rowAboveInsertLine(e, table) {
  const row = e.target.closest && e.target.closest('#syledb tr');
  if (!row || !table.contains(row)) return null;
  const box = row.getBoundingClientRect();
  if (box.bottom - e.clientY <= INSERT_LINE_REACH) return row;
  const above = row.previousElementSibling;
  return above && e.clientY - box.top <= INSERT_LINE_TOP_REACH ? above : null;
}

const onSyllabusEditingMousedown = function (e) {
  if (!e.target.closest || !e.target.closest('#yins') || !yIns) return;
  e.preventDefault();
  e.stopPropagation();
  addPointAtInsertLine(yIns);
};

function addPointAtInsertLine(row) {
  const spot = insertSpot(row);
  if (!spot) return;
  pts.splice(spot.index, 0, spot.point);
  commit(pts.slice());
  numberSection(spot.point.sec, true);
  Store.example = false;
  Store.saveLocal();
  $('yins').hidden = true;
  yIns = null;
  renderEdit();
  renderSide();
  focusSyllabusField(`[data-yt="${spot.point.id}"]`);
}

/* the new point and where it goes: under a section title, first in the section; under a point, after it, at the level that
   fits the spot (under a sub-point, or just above one, it's a sub-point) */
function insertSpot(row) {
  if (row.classList.contains('sr')) {
    const first = ptById((ui.secMap[row.dataset.ysec] || [])[0]);
    return first ? { point: newPoint(first.sec, 2), index: pts.indexOf(first) } : null;
  }
  const point = ptById(row.dataset.yid);
  if (!point) return null;
  const next = row.nextElementSibling;
  const sub = row.classList.contains('sub') || !!(next && next.classList.contains('sub'));
  return { point: newPoint(point.sec, sub ? 3 : 2), index: pts.indexOf(point) + 1 };
}

/* ---- dragging the cards ---- */
let yd = null; // the drag in progress

function yRows() {
  return [...($('syledb') || { children: [] }).children];
}

/* rows that moved slide to their new places */
function yAnimate(move) {
  const rows = yRows();
  const before = new Map(rows.map(r => [r, r.getBoundingClientRect().top]));
  move();
  rows.forEach(row => {
    if (row.classList.contains('yghost')) return;
    const offset = before.get(row) - row.getBoundingClientRect().top;
    if (!offset) return;
    row.style.transition = 'none';
    row.style.transform = `translateY(${offset}px)`;
    requestAnimationFrame(() => {
      row.style.transition = CARD_SETTLE;
      row.style.transform = '';
    });
  });
}

const onSyllabusEditingMousedown2 = function (e) {
  if (e.button !== 0 || !ui.edit || ui.view !== 'syl') return;
  const row = e.target.closest && e.target.closest('#syledb tr');
  if (!row || e.target.closest('.yb')) return;
  const field = e.target.closest('[contenteditable]');
  if (field && document.activeElement === field) return; // already editing: drag selects text
  yd = { tr: row, x: e.clientX, y: e.clientY, on: false };
};

/* a section brings its points; a point brings its sub-points */
function dragFamily(row) {
  const rows = yRows();
  const start = rows.indexOf(row);
  const belongs = row.classList.contains('sr')
    ? r => !r.classList.contains('sr')
    : row.classList.contains('sub')
      ? () => false
      : r => r.classList.contains('sub');
  const family = [row];
  for (let i = start + 1; i < rows.length && belongs(rows[i]); i++) family.push(rows[i]);
  return family;
}

function yStart() {
  const row = yd.tr;
  const family = dragFamily(row);
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  getSelection().removeAllRanges();
  const box = row.getBoundingClientRect();
  const floating = dragImage(family, row.closest('table'), box);
  family.forEach(r => r.classList.add('yghost'));
  document.body.classList.add('ydragging');
  Object.assign(yd, dragState(row, family), { on: true, fl: floating, top: box.top });
}

/* what's dragged: a section, a point (with its sub-points) or a sub-point; one card on its own can change level */
function dragState(row, family) {
  const kind = row.classList.contains('sr') ? 'sec' : row.classList.contains('sub') ? 'sub' : 'pt';
  return {
    kind: kind,
    grp: family,
    single: kind === 'sub' || (kind === 'pt' && family.length === 1),
    lv: row.classList.contains('sub') ? 3 : 2,
    from: row.dataset.yid ? ptById(row.dataset.yid).sec : null
  };
}

/* a copy of the dragged rows that follows the pointer (each cell its original width) */
function dragImage(family, table, box) {
  const floating = mk('div');
  floating.className = 'ydrag';
  const copy = mk('table');
  copy.className = table.className;
  copy.style.width = table.getBoundingClientRect().width + 'px';
  const body = mk('tbody');
  copy.appendChild(body);
  family.forEach(row => {
    const clone = row.cloneNode(true);
    [...row.children].forEach((cell, n) => (clone.children[n].style.width = cell.getBoundingClientRect().width + 'px'));
    body.appendChild(clone);
  });
  floating.appendChild(copy);
  document.body.appendChild(floating);
  floating.style.left = table.getBoundingClientRect().left + 'px';
  floating.style.top = box.top + 'px';
  return floating;
}

const onSyllabusEditingMousemove2 = function (e) {
  if (!yd) return;
  if (!yd.on) {
    if (Math.abs(e.clientX - yd.x) + Math.abs(e.clientY - yd.y) < DRAG_START) return;
    yStart();
  }
  e.preventDefault();
  const dx = e.clientX - yd.x;
  const sideways = yd.single ? Math.max(-NUDGE_LIMIT, Math.min(NUDGE_LIMIT, dx)) : 0;
  yd.fl.style.transform = `translate(${sideways}px,${e.clientY - yd.y}px) rotate(.4deg)`;
  moveCardsTo(dropBefore(e.clientY));
  if (yd.single) nudgeLevel(dx);
};

/* the row the dragged cards would land before (null: the end) */
function dropBefore(y) {
  const rows = yRows().filter(r => !yd.grp.includes(r));
  const above = candidates =>
    candidates.find(r => y < r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2) || null;
  if (yd.kind === 'sec') return above(rows.filter(r => r.classList.contains('sr')));
  let ref = above(rows);
  if (ref && ref === rows[0]) ref = rows[1] || null; // never above the first section title
  if (yd.kind === 'pt') while (ref && ref.classList.contains('sub')) ref = nextUndragged(ref.nextElementSibling);
  return ref;
}

function nextUndragged(row) {
  while (row && yd.grp.includes(row)) row = row.nextElementSibling;
  return row;
}

function moveCardsTo(ref) {
  const last = yd.grp[yd.grp.length - 1];
  if (ref === nextUndragged(last.nextElementSibling)) return;
  yAnimate(() => {
    const body = $('syledb');
    yd.grp.forEach(row => body.insertBefore(row, ref));
  });
}

/* level: nudge right for a sub-point, left for a point (a section's first card is always a point) */
function nudgeLevel(dx) {
  const first = yd.grp[0];
  let level = dx > LEVEL_NUDGE ? 3 : dx < -LEVEL_NUDGE ? 2 : yd.lv;
  const previous = first.previousElementSibling;
  if (!previous || previous.classList.contains('sr')) level = 2;
  yd.want = level;
  first.classList.toggle('sub', level === 3);
  yd.fl.querySelector('tr').classList.toggle('sub', level === 3);
}

const onSyllabusEditingMouseup = function () {
  if (!yd) return;
  const drag = yd;
  yd = null;
  if (!drag.on) return;
  document.body.classList.remove('ydragging');
  drag.fl.remove();
  drag.grp.forEach(r => r.classList.remove('yghost'));
  setWcEatClick(true); // the click that ends a drag isn't a click on what's under it
  setTimeout(() => setWcEatClick(false), 200);
  saveDraggedOrder(drag);
};

/* the new order, read from the table: each point takes the section it now sits in */
function saveDraggedOrder(drag) {
  const order = orderFromTable();
  finishDrag(drag, order.list, order.touched);
}

/* the points in the table's order, each in the section it now sits under; touched: the sections that changed */
function orderFromTable() {
  const list = [];
  const touched = {};
  let section = null;
  yRows().forEach(row => {
    if (row.classList.contains('sr')) {
      const title = row.querySelector('[data-ysname]');
      section = title ? title.textContent.trim() : '';
      return;
    }
    const point = ptById(row.dataset.yid);
    if (!point) return;
    if (point.sec !== section) touched[point.sec] = 1;
    point.sec = section;
    touched[section] = 1;
    list.push(point);
  });
  return { list: list, touched: touched };
}

function finishDrag(drag, list, touched) {
  if (drag.single) {
    const moved = ptById(drag.grp[0].dataset.yid);
    if (moved) moved.lvl = drag.want || drag.lv;
  }
  commit(list);
  Object.keys(touched).forEach(section => numberSection(section, true));
  syllabusEdited(true);
  const id = drag.grp[0].dataset.yid;
  const row = id ? document.querySelector(`[data-yid="${id}"]`) : null;
  if (row) flash(row);
}

export function initSyllabusEditing() {
  document.addEventListener('input', onSyllabusEditingInput);
  document.addEventListener('keydown', onSyllabusEditingKeydown);
  document.addEventListener('paste', onSyllabusEditingPaste);
  document.addEventListener('click', onSyllabusEditingClick);
  document.addEventListener('mousemove', onSyllabusEditingMousemove);
  document.addEventListener('mousedown', onSyllabusEditingMousedown, true);
  document.addEventListener('mousedown', onSyllabusEditingMousedown2);
  document.addEventListener('mousemove', onSyllabusEditingMousemove2);
  document.addEventListener('mouseup', onSyllabusEditingMouseup);
}
