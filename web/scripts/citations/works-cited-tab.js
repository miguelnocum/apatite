import { $, esc, meta, toast, ui } from '../core/helpers-and-state.js';
import { Store } from '../core/storage.js';
import { essays } from '../essays/essays.js';
import {
  citeCount,
  orderedRefs,
  ownerDoc,
  parseOne,
  refById,
  refHTML,
  refOwner,
  refSort,
  refs,
  setRefSort2,
  setRefs,
  sortedRefs,
  splitRich,
  yearLabels
} from './references.js';
import { citeText } from './in-text-citations.js';

/* ===== the Works Cited tab: add, edit, order and delete references ===== */
export function renderWC() {
  const selected = ui.wcSel || (ui.wcSel = {});
  const labels = yearLabels();
  const src = ownerDoc();
  const selectedCount = refs.filter(r => selected[r.id]).length;
  const items = orderedRefs().map(r => {
    const citedCount = citeCount(r.id, src);
    return ui.refEdit === r.id ? editingItemHTML(r, citedCount) : itemHTML(r, citedCount, selected, labels);
  });
  const empty = refs.length
    ? ''
    : '<div class="empty" style="margin-top:12px">No references yet. Paste your list above.</div>';
  $('main').innerHTML =
    '<div class="wc">' +
    ownerHTML() +
    ADD_REFERENCES_HTML +
    barHTML(selectedCount) +
    `<ol class="wc-list">${items.join('')}</ol>${empty}</div>`;
}

/* whose list this is: the notebook's, or one of its essays' */
function ownerHTML() {
  const option = (value, label) => `<option value="${value}"${refOwner === value ? ' selected' : ''}>${label}</option>`;
  const options =
    option('notes', 'Notebook — ' + esc(meta.title || 'Notebook')) +
    essays.map(essay => option(essay.id, 'Essay — ' + esc(essay.title || 'Untitled essay'))).join('');
  return (
    `<div class="wc-owner"><label for="wcowner">Sources for</label><select id="wcowner">${options}</select>` +
    '<span class="rhint">Each notebook and essay keeps its own list.</span></div>'
  );
}

const ADD_REFERENCES_HTML =
  '<section class="wc-add"><div class="wc-addhd"><h3>Add references</h3><span class="rhint">' +
  'Copy your citations from MyBib (or anywhere) and paste them here, one reference per line. Italics are kept.</span></div>' +
  '<div id="refin" class="wc-in" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true" ' +
  'aria-label="Paste references" data-ph="Paste one or more Harvard references"></div>' +
  '<div class="row"><button class="btn pri" id="wcadd">Add to Works Cited</button>' +
  '<button class="btn" id="wcclr">Clear</button></div></section>';

/* select all, what's selected (and deleting it), and the order */
function barHTML(selectedCount) {
  const allChecked = refs.length && selectedCount === refs.length ? ' checked' : '';
  const status = selectedCount ? selectionHTML(selectedCount) : countHTML();
  return (
    `<div class="wc-bar"><input type="checkbox" id="wcall"${allChecked} aria-label="Select all references"` +
    `${refs.length ? '' : ' disabled'}>${status}<span class="sp"></span>` +
    '<div class="seg" role="group" aria-label="Order">' +
    `<button data-wcsort="auto" aria-pressed="${refSort === 'auto'}">Auto sort A–Z</button>` +
    `<button data-wcsort="manual" aria-pressed="${refSort === 'manual'}">Manual order</button></div></div>`
  );
}

function selectionHTML(selectedCount) {
  const deleteLabel = ui.confirm === 'wcdel' ? `Delete ${selectedCount}? Some are cited in your notes` : 'Delete';
  return (
    `<span class="wc-n">${selectedCount} selected</span>` +
    `<button class="btn sm danger" id="wcdel">${deleteLabel}</button>` +
    '<button class="btn sm" id="wcnone">Clear selection</button>'
  );
}

function countHTML() {
  return `<span class="wc-style">Harvard style</span><span class="rhint">${refs.length} reference${refs.length === 1 ? '' : 's'}</span>`;
}

/* a reference being edited: its text, the surnames and year its citations use */
function editingItemHTML(r, citedCount) {
  const deleteLabel = ui.confirm === 'one' + r.id ? `Delete? It is cited ${citedCount}×` : 'Delete reference';
  return (
    `<li class="wci editing" data-id="${r.id}"><div class="wced">` +
    `<div class="wc-in" contenteditable="true" id="wced" aria-label="Reference text">${refHTML(r)}</div>` +
    '<div class="row"><label class="fld">Surnames used in the in-text citation, in order' +
    `<input type="text" data-rfa="${r.id}" value="${esc(r.authors.join(', '))}"></label>` +
    `<label class="fld" style="flex:0 0 110px">Year<input type="text" data-rfy="${r.id}" value="${esc(r.year)}"></label></div>` +
    `<div class="row"><button class="btn sm pri" data-wcsave="${r.id}">Save</button>` +
    '<button class="btn sm" data-wccancel="1">Cancel</button><span class="sp"></span>' +
    `<button class="btn sm danger" data-wcdelone="${r.id}">${deleteLabel}</button></div></div></li>`
  );
}

function itemHTML(r, citedCount, selected, labels) {
  const on = selected[r.id];
  const deleteLabel = ui.confirm === 'one' + r.id ? `Delete? Cited ${citedCount}×` : 'Delete';
  return (
    `<li class="wci${on ? ' on' : ''}" data-id="${r.id}" draggable="true">` +
    '<span class="grip" title="Drag to reorder" aria-hidden="true">⠿</span>' +
    `<input type="checkbox" data-wcsel="${r.id}"${on ? ' checked' : ''} aria-label="Select reference">` +
    `<div class="wct">${refHTML(r)}</div>` +
    `<div class="wcm"><span class="wcin" title="In-text citation">${esc(citeText([r.id], labels) || '')}</span>` +
    `<span>${citedCount ? 'cited ' + citedCount + '×' : 'not cited yet'}</span>` +
    `<div class="wcacts"><button class="btn sm" data-wcedit="${r.id}">Edit</button>` +
    `<button class="btn sm danger" data-wcdelone="${r.id}">${deleteLabel}</button></div></div></li>`
  );
}

/* a reference dragged before or after another; an automatic order becomes manual */
function moveRef(id, target, after) {
  if (id === target) return;
  const wasAuto = refSort === 'auto';
  const moved = refById(id);
  if (!moved) return;
  const list = orderedRefs().filter(r => r.id !== id);
  const at = list.findIndex(r => r.id === target);
  if (at < 0) return;
  list.splice(after ? at + 1 : at, 0, moved);
  setRefs(list);
  setRefSort2('manual');
  saveAndRenderWC();
  if (wasAuto) toast('Switched to manual order');
}

function saveAndRenderWC() {
  Store.saveRefs();
  renderWC();
}

/* ---- the tab's buttons ---- */
const WORKS_CITED_ACTIONS = [
  [button => button.id === 'wcadd', () => addPastedReferences()],
  [button => button.id === 'wcclr', () => ($('refin').innerHTML = '')],
  [(button, data) => data.wcsort, (button, data) => setRefSort(data.wcsort)],
  [(button, data) => data.wcedit, (button, data) => startEditingRef(data.wcedit)],
  [(button, data) => data.wccancel, () => stopEditingRef()],
  [(button, data) => data.wcsave, (button, data) => saveEditedRef(data.wcsave)],
  [(button, data) => data.wcdelone, (button, data) => deleteRefs([data.wcdelone], 'one' + data.wcdelone)],
  [button => button.id === 'wcnone', () => clearRefSelection()],
  [button => button.id === 'wcdel', () => deleteRefs(selectedRefIds(), 'wcdel')]
];

const onWorksCitedTabClick = e => {
  if (ui.view !== 'wc') return;
  const button = e.target.closest('button');
  if (!button) return;
  const action = WORKS_CITED_ACTIONS.find(([matches]) => matches(button, button.dataset));
  if (action) action[1](button, button.dataset);
};

/* pasted references are added, except those already listed */
function addPastedReferences() {
  const entries = splitRich($('refin').innerHTML);
  if (!entries.length) {
    toast('Paste at least one reference first');
    return;
  }
  const listed = new Set(refs.map(r => r.raw));
  const added = entries.filter(entry => !listed.has(entry.raw)).map(entry => parseOne(entry.raw, entry.html));
  if (!added.length) {
    toast('Those references are already in your list');
    return;
  }
  setRefs(refs.concat(added));
  saveAndRenderWC();
  const skipped = entries.length - added.length;
  const alreadyListed = skipped > 0 ? ` (${skipped} already listed)` : '';
  toast(`${added.length} reference${added.length === 1 ? '' : 's'} added${alreadyListed}`);
}

/* manual order starts from the automatic one */
function setRefSort(sort) {
  if (sort === 'manual' && refSort === 'auto') setRefs(sortedRefs());
  setRefSort2(sort);
  saveAndRenderWC();
}

function startEditingRef(id) {
  ui.refEdit = id;
  ui.confirm = null;
  renderWC();
  const text = $('wced');
  if (text) text.focus();
}

function stopEditingRef() {
  ui.refEdit = null;
  ui.confirm = null;
  renderWC();
}

function saveEditedRef(id) {
  const r = refById(id);
  const text = $('wced');
  if (!r || !text) return;
  const parts = splitRich(text.innerHTML);
  if (parts.length) {
    r.raw = parts.map(part => part.raw).join(' ');
    r.html = parts.map(part => part.html).join(' ');
  }
  r.authors = document
    .querySelector('[data-rfa="' + r.id + '"]')
    .value.split(',')
    .map(name => name.trim())
    .filter(Boolean);
  r.year = document.querySelector('[data-rfy="' + r.id + '"]').value.trim() || 'n.d.';
  ui.refEdit = null;
  saveAndRenderWC();
  toast('Reference saved');
}

function selectedRefIds() {
  return refs.filter(r => ui.wcSel[r.id]).map(r => r.id);
}

function clearRefSelection() {
  ui.wcSel = {};
  ui.confirm = null;
  renderWC();
}

/* references that are cited ask first (the button asks; a second click deletes) */
function deleteRefs(ids, confirmKey) {
  const src = ownerDoc();
  if (ids.some(id => citeCount(id, src)) && ui.confirm !== confirmKey) {
    ui.confirm = confirmKey;
    renderWC();
    return;
  }
  setRefs(refs.filter(r => !ids.includes(r.id)));
  if (confirmKey === 'wcdel') ui.wcSel = {};
  else ui.refEdit = null;
  ui.confirm = null;
  saveAndRenderWC();
  if (confirmKey === 'wcdel') toast(ids.length + ' deleted');
}

/* ---- selecting ---- */
const onWorksCitedTabChange = e => {
  if (ui.view !== 'wc') return;
  const box = e.target;
  if (box.id === 'wcall') selectAllRefs(box.checked);
  else if (box.dataset && box.dataset.wcsel) selectRef(box.dataset.wcsel, box.checked);
};

function selectAllRefs(on) {
  ui.wcSel = {};
  if (on) refs.forEach(r => (ui.wcSel[r.id] = 1));
  ui.confirm = null;
  renderWC();
}

function selectRef(id, on) {
  ui.wcSel = ui.wcSel || {};
  if (on) ui.wcSel[id] = 1;
  else delete ui.wcSel[id];
  ui.confirm = null;
  renderWC();
}

/* ---- dragging to reorder ---- */
const clearDropMarks = classes =>
  document
    .querySelectorAll(classes.map(name => '.wci.' + name).join(','))
    .forEach(item => item.classList.remove(...classes));

const onWorksCitedTabDragstart = e => {
  const item = e.target.closest && e.target.closest('.wci[draggable="true"]');
  if (!item) return;
  ui.dragId = item.dataset.id;
  item.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try {
    e.dataTransfer.setData('text/plain', item.dataset.id);
  } catch (x) {}
};

/* the reference dragged over shows which side it would go */
const onWorksCitedTabDragover = e => {
  if (!ui.dragId) return;
  const item = e.target.closest && e.target.closest('.wci');
  if (!item) return;
  e.preventDefault();
  const box = item.getBoundingClientRect();
  clearDropMarks(['dropa', 'dropb']);
  item.classList.add(e.clientY > box.top + box.height / 2 ? 'dropa' : 'dropb');
};

const onWorksCitedTabDrop = e => {
  if (!ui.dragId) return;
  const item = e.target.closest && e.target.closest('.wci');
  if (!item) return;
  e.preventDefault();
  const id = ui.dragId;
  ui.dragId = null;
  moveRef(id, item.dataset.id, item.classList.contains('dropa'));
};

const onWorksCitedTabDragend = () => {
  ui.dragId = null;
  clearDropMarks(['dragging', 'dropa', 'dropb']);
};

export function initWorksCitedTab() {
  document.addEventListener('click', onWorksCitedTabClick);
  document.addEventListener('change', onWorksCitedTabChange);
  document.addEventListener('dragstart', onWorksCitedTabDragstart);
  document.addEventListener('dragover', onWorksCitedTabDragover);
  document.addEventListener('drop', onWorksCitedTabDrop);
  document.addEventListener('dragend', onWorksCitedTabDragend);
}
