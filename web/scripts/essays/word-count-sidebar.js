import { $, esc, ui } from '../core/helpers-and-state.js';
import { Store } from '../core/storage.js';
import { flash } from '../view/page-render.js';
import { ed } from '../editor/notes-document.js';
import { essayTotal, tagById, tagCounts, tagsChanged, wcOpts } from './word-count.js';
import { contentsPanel } from './word-count-contents.js';
import { closeTagPop, drawBoxes, setWcMode, tagPop } from './word-count-boxes.js';
import { curEssay, edEssayId, essays } from './essays.js';

/* ===== the word count in the essay's sidebar: the total, each tag's count and settings, the contents, the options ===== */
const PERCENT = 100;

export function renderWordCount() {
  const box = $('wcbox');
  const essay = curEssay();
  const editor = ed();
  if (!box || !essay || !editor || edEssayId() !== essay.id) return;
  const options = wcOpts(essay);
  const counts = tagCounts(editor, options);
  const keep = focusedWordCountField(box);
  ui.wcOpen = ui.wcOpen || {};
  box.innerHTML =
    modeButtonHTML() +
    totalHTML(counts.total, +options.limit || 0) +
    options.tags.map(tag => tagSectionHTML(tag, counts.by[tag.id] || 0)).join('') +
    untaggedHTML(options, counts) +
    contentsPanel(editor, options) +
    optionsHTML(options);
  if (keep) refocus(box.querySelector(keep));
  if (ui.wcMode) drawBoxes();
}

function modeButtonHTML() {
  const mode = !!ui.wcMode;
  const hint = mode
    ? '<p class="wchint">Drag down the left margin beside your paragraphs to box them as a section. Click a box’s label to change it.</p>'
    : '';
  return (
    `<button type="button" class="wcmodebtn${mode ? ' on' : ''}" id="wcmodebtn" aria-pressed="${mode}">` +
    `${mode ? 'Done tagging' : 'Word count mode'}</button>${hint}`
  );
}

/* the total, against the limit when there is one */
function totalHTML(total, limit) {
  if (!limit) return `<div class="wctot"><b>${total.toLocaleString()}</b><span>words</span></div>`;
  const over = total > limit;
  const left = over ? (total - limit).toLocaleString() + ' over' : (limit - total).toLocaleString() + ' left';
  const percent = Math.min(PERCENT, (total / limit) * PERCENT);
  return (
    `<div class="wctot"><b>${total.toLocaleString()}</b><span>of ${limit.toLocaleString()} · ${left}</span>` +
    `<div class="wcbar"><i class="${over ? 'over' : ''}" style="width:${percent}%"></i></div></div>`
  );
}

function tagSectionHTML(tag, count) {
  const limit = +tag.limit || 0;
  const open = !!ui.wcOpen[tag.id];
  const title = tag.exclude ? 'Shown but not counted in the total' : 'Show in the essay';
  const limitNote = limit ? ` <small>/ ${limit.toLocaleString()}</small>` : '';
  return (
    `<div class="wcsec"><div class="wcrow${tag.exclude ? ' off' : ''}${limit && count > limit ? ' over' : ''}" ` +
    `data-wctag="${tag.id}" title="${title}">` +
    `<button class="tw${open ? ' open' : ''}" data-wctw="${tag.id}" aria-expanded="${open}" aria-label="Settings for ${esc(tag.name)}">` +
    '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3"/></svg></button>' +
    `<i class="dot" style="background:${tag.color}"></i><span class="nm">${esc(tag.name)}</span>` +
    `<span class="ct">${count.toLocaleString()}${limitNote}</span></div>` +
    (open ? tagSettingsHTML(tag, limit) : '') +
    '</div>'
  );
}

function tagSettingsHTML(tag, limit) {
  return (
    `<div class="wctagset"><label>Name <input type="text" data-wcname="${tag.id}" value="${esc(tag.name)}"></label>` +
    `<label>Limit <input type="number" min="0" step="50" data-wctlim="${tag.id}" value="${limit || ''}" placeholder="none"></label>` +
    `<label class="ck"><input type="checkbox" data-wcexcl="${tag.id}"${tag.exclude ? '' : ' checked'}> Count in total</label>` +
    `<button type="button" class="wcdel" data-wcdeltag="${tag.id}">Remove this tag</button></div>`
  );
}

/* what isn't tagged (the whole essay, before there are tags), and a hint to start tagging */
function untaggedHTML(options, counts) {
  const tagged = options.tags.length;
  let html = '';
  if (counts.untagged || !tagged)
    html +=
      `<div class="wcrow untag${options.untagged === false && tagged ? ' off' : ''}">` +
      '<button class="tw" disabled></button><i class="dot"></i>' +
      `<span class="nm">${tagged ? 'Untagged' : 'Whole essay'}</span><span class="ct">${counts.untagged.toLocaleString()}</span></div>`;
  if (!tagged && !ui.wcMode)
    html += '<p class="wchint">Use Word count mode to box paragraphs as Introduction, Body paragraphs, Conclusion…</p>';
  return html;
}

function optionsHTML(options) {
  const option = (key, label) =>
    `<label class="wcopt"><input type="checkbox" data-wcopt="${key}"${options[key] ? ' checked' : ''}>${label}</label>`;
  const limit = +options.limit || 0;
  return (
    '<div class="wcopts">' +
    option('figures', 'Figures, captions &amp; tables') +
    option('footnotes', 'Footnotes') +
    option('citations', 'In-text citations') +
    option('untagged', 'Untagged text') +
    '<label class="wcopt lim">Word limit ' +
    `<input type="number" min="0" step="100" data-wclim value="${limit || ''}" placeholder="none"></label></div>`
  );
}

/* the field being typed in keeps the focus (and its caret at the end) when the sidebar is redrawn */
function focusedWordCountField(box) {
  const active = document.activeElement;
  if (!(active && box.contains(active))) return null;
  const attribute = [...active.attributes].find(a => a.name.indexOf('data-wc') === 0);
  return attribute ? `[${attribute.name}="${attribute.value}"]` : null;
}

function refocus(field) {
  if (!field) return;
  field.focus();
  if (field.type !== 'text' && field.type !== 'number') return;
  const value = field.value;
  field.value = '';
  field.value = value;
}

/* a change to the open essay's options, saved and shown */
function setWc(change) {
  const essay = curEssay();
  if (!essay) return;
  essay.wc = wcOpts(essay);
  change(essay.wc);
  essay.updated = Date.now();
  Store.saveEssays();
  renderWordCount();
  updateEssayListCounts();
  drawBoxes();
}

/* each essay's total, in the list of essays */
export function updateEssayListCounts() {
  document.querySelectorAll('#side .esl a[data-essay]').forEach(link => {
    const essay = essays.find(x => x.id === link.dataset.essay);
    if (!essay) return;
    const count = essay.id === edEssayId() ? tagCounts(ed(), wcOpts(essay)).total : essayTotal(essay);
    const label = link.querySelector('.wc');
    if (label) label.textContent = count.toLocaleString() + ' word' + (count === 1 ? '' : 's');
  });
}

/* ---- the sidebar's buttons, and a box's label ---- */
const WORD_COUNT_CLICKS = [
  ['[data-wcedit]', label => openTagSettings(label.dataset.wcedit)],
  ['[data-wctw]', (twist, e) => toggleTagSettings(twist.dataset.wctw, e)],
  ['[data-wcdeltag]', button => removeTag(button.dataset.wcdeltag)],
  ['[data-wctag]', row => showTagged(row.dataset.wctag)]
];

/* anything else closes the menu for naming a box */
const onWordCountSidebarClick = e => {
  const target = e.target;
  if (target.id === 'wcmodebtn') {
    setWcMode(!ui.wcMode);
    return;
  }
  const hit =
    target.closest && WORD_COUNT_CLICKS.map(([selector, act]) => [target.closest(selector), act]).find(([el]) => el);
  if (hit) hit[1](hit[0], e);
  else if (tagPop && !target.closest('.tagpop')) closeTagPop();
};

/* clicking a box's label: the tag's settings in the sidebar, opened, its name ready to change */
function openTagSettings(id) {
  ui.wcOpen = ui.wcOpen || {};
  ui.wcOpen[id] = true;
  renderWordCount();
  const name = document.querySelector('[data-wcname="' + id + '"]');
  if (!name) return;
  name.scrollIntoView({ block: 'nearest' });
  name.focus();
  name.select();
}

function toggleTagSettings(id, e) {
  e.preventDefault();
  ui.wcOpen = ui.wcOpen || {};
  ui.wcOpen[id] = !ui.wcOpen[id];
  renderWordCount();
}

function removeTag(id) {
  ed()
    .querySelectorAll('[data-wct="' + id + '"]')
    .forEach(block => block.removeAttribute('data-wct'));
  setWc(options => (options.tags = options.tags.filter(tag => tag.id !== id)));
  tagsChanged();
}

function showTagged(id) {
  const first = ed().querySelector('[data-wct="' + id + '"]');
  if (!first) return;
  first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  flash(first);
}

/* ---- the sidebar's fields ---- */
const wholeNumber = value => Math.max(0, parseInt(value, 10) || 0);

/* a change to one tag, if it's still there */
const setTag = (id, change) =>
  setWc(options => {
    const tag = tagById(options, id);
    if (tag) change(tag);
  });

const WORD_COUNT_CHANGES = [
  [(field, data) => data.wcopt, (field, data) => setWc(options => (options[data.wcopt] = field.checked))],
  [
    field => field.hasAttribute && field.hasAttribute('data-wclim'),
    field => setWc(options => (options.limit = wholeNumber(field.value) || null))
  ],
  [
    (field, data) => data.wctlim,
    (field, data) => setTag(data.wctlim, tag => (tag.limit = wholeNumber(field.value) || null))
  ],
  [(field, data) => data.wcexcl, (field, data) => setTag(data.wcexcl, tag => (tag.exclude = !field.checked))],
  [(field, data) => data.wcname, (field, data) => renameTag(data.wcname, field.value.trim())]
];

const onWordCountSidebarChange = e => {
  const field = e.target;
  const data = field.dataset || {};
  const change = WORD_COUNT_CHANGES.find(([matches]) => matches(field, data));
  if (change) change[1](field, data);
};

function renameTag(id, name) {
  if (name) setTag(id, tag => (tag.name = name));
}

export function initWordCountSidebar() {
  document.addEventListener('click', onWordCountSidebarClick);
  document.addEventListener('change', onWordCountSidebarChange);
}
