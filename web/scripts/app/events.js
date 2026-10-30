import { requestCommand } from '../core/commands.js';
import { saveDocNow, saveDocSoon } from '../core/save-doc.js';
import { closeToolbarMenu } from '../core/toolbar-menu.js';
import { EXAMPLE } from '../core/example-data.js';
import {
  $,
  curEssay,
  isDocView,
  meta,
  NATIVE,
  post,
  syllabusPoints,
  setActiveEditor,
  setSyllabusPoints,
  toast,
  uiState
} from '../core/helpers-and-state.js';
import { Store } from '../core/storage.js';
import { commit, planApply } from '../syllabus/model.js';
import { cfHTML, measure, renderSide, toggleSide } from '../syllabus/syllabus-view.js';
import { detect, renderSetup, secPrefix, sectionNames, suggestGrouping } from '../syllabus/syllabus-import.js';
import { showStyleMatches } from '../syllabus/numbering-style.js';
import { backToSyl, markCur, render, switchView } from '../view/page-render.js';
import { tableState } from '../editor/editor-commands.js';
import { stepZoom } from '../view/zoom.js';
import { openToolbarMenu } from '../editor/toolbar-menus.js';
import { hydrate } from '../editor/notes-document.js';
import { notesEdited } from '../editor/hydrate-and-changes.js';
import { deleteEssay, newEssay, openEssay, openPoint, renderEssaySide } from '../essays/essays.js';
import { exportHTML } from '../editor/export.js';
import { useRefs } from '../citations/references.js';
import { renderWC } from '../citations/works-cited-tab.js';
import { openSettings } from '../settings/settings.js';

/* ===== events: the page's own fields and buttons ===== */
const TITLE_SAVE_DELAY = 500; // ms after the last keystroke in an essay's title before it's saved
const NOTEBOOK_TITLE_SAVE_DELAY = 700;
const CONFIDENCE_LEVELS = 5; // 0 (not rated) to 4

/* the notes or essay being typed in */
const onEventsFocusin = function (e) {
  const notes = e.target.closest && e.target.closest('.notes');
  if (!notes) return;
  setActiveEditor(notes);
  tableState();
};

/* Works Cited: whose list is shown */
const onEventsChange = function (e) {
  if (e.target.id !== 'wcowner') return;
  useRefs(e.target.value);
  renderWC();
};

/* ---- typing in the page's fields ---- */
const onEventsInput = function (e) {
  const action = PAGE_INPUTS.find(([matches]) => matches(e.target));
  if (action) action[1](e.target);
};

/* [is it this field, what typing in it does] */
const PAGE_INPUTS = [
  [t => t.id === 'etitle', renameEssay],
  [t => t.id === 'ed', notesTyped],
  [t => t.dataset.ds != null, t => (uiState.draft[+t.dataset.ds].title = t.value)],
  [t => t.dataset.dc != null, t => (draftItem(t.dataset.dc).code = t.value)],
  [t => t.dataset.dt != null, t => (draftItem(t.dataset.dt).text = t.value)],
  [t => t.id === 'paste', pasteTyped],
  [t => t.id === 'secstyle', t => styleTyped('secStyle', t.value)],
  [t => t.id === 'ptstyle', t => styleTyped('ptStyle', t.value)],
  [t => t.name === 'mode', chooseDraftMode],
  [t => t.id === 'nbtitle', renameNotebook]
];

function pasteTyped(field) {
  uiState.paste = field.value;
  showStyleMatches();
}

/* a numbering style typed: kept, and the count of lines it matches shown */
function styleTyped(key, value) {
  uiState[key] = value;
  showStyleMatches();
}

function renameEssay(field) {
  const essay = curEssay();
  if (!essay) return;
  essay.title = field.value;
  essay.updated = Date.now();
  clearTimeout(Store.et);
  Store.et = setTimeout(() => {
    Store.saveEssays();
    renderEssaySide();
  }, TITLE_SAVE_DELAY);
}

/* the notes changed: saved soon; a citation typed as text is made into one */
function notesTyped(editor) {
  saveDocSoon();
  notesEdited();
  if (editor.querySelector('span[data-cite]:not(.cite)')) {
    hydrate();
    renderSide();
  }
}

/* a point in the syllabus draft, from its "section.item" */
function draftItem(path) {
  const [section, item] = path.split('.').map(Number);
  return uiState.draft[section].items[item];
}

function chooseDraftMode(radio) {
  uiState.mode = radio.value;
  uiState.confirmApply = null;
}

function renameNotebook(field) {
  meta.title = field.value;
  clearTimeout(Store.mt);
  Store.mt = setTimeout(() => Store.saveMeta(), NOTEBOOK_TITLE_SAVE_DELAY);
}

/* ---- the toolbar ---- */
const onEventsMousedown = function (e) {
  if (e.target.closest('#tb button')) e.preventDefault(); // the notes keep the selection
};

const onEventsTbClick = function (e) {
  const button = e.target.closest('button');
  if (!button) return;
  if (button.dataset.menu) {
    openToolbarMenu(button, button.dataset.menu);
    return;
  }
  closeToolbarMenu();
  if (button.dataset.zoom) stepZoom(+button.dataset.zoom);
  else if (button.dataset.cmd) requestCommand(button.dataset.cmd);
};

/* ---- the page's buttons and links ---- */
const onEventsClick = function (e) {
  const target = e.target.closest('button,a');
  if (!target) return;
  const action = PAGE_CLICKS.find(([matches]) => matches(target));
  if (action) action[1](target, e);
};

/* [is it this button, what clicking it does] */
const PAGE_CLICKS = [
  [t => !!t.dataset.sidetog, () => toggleSide()],
  [t => !!t.dataset.essay, chooseEssay],
  [t => t.id === 'newessay', () => afterSaving(newEssay)],
  [t => t.id === 'importessay', () => afterSaving(() => post({ type: 'importEssay' }))],
  [t => t.id === 'delessay', askThenDeleteEssay],
  [t => !!t.dataset.view, chooseView],
  [t => !!t.dataset.cyc, rateConfidence],
  [t => t.dataset.gosec != null, goToSection],
  [t => !!t.dataset.open, (t, e) => openPointFromLink(t, e)],
  [t => t.id === 'editbtn' || t.id === 'editbtn2' || !!t.dataset.edit, toggleSyllabusEditing],
  [t => t.id === 'back', () => backToSyl()],
  [t => t.id === 'mapbtn', () => $('side').classList.toggle('open')],
  [t => !!(t.closest && t.closest('#setbtn')), () => openSettings()],
  [t => t.id === 'detect', () => detectSyllabus()],
  [t => t.id === 'suggest', () => suggestFromPaste()],
  [t => !!t.dataset.dx, t => removeDraftItem(t.dataset.dx)],
  [t => t.dataset.dadd != null, t => addDraftItem(+t.dataset.dadd)],
  [t => t.id === 'discard', () => discardDraft()],
  [t => t.id === 'confirmdraft', () => confirmDraft()],
  [t => t.id === 'ex' || t.id === 'blank', startSyllabusOver],
  [t => t.id === 'exp', () => exportHTML()]
];

function afterSaving(then) {
  saveDocNow();
  then();
}

/* ---- essays ---- */
function chooseEssay(link, e) {
  e.preventDefault();
  const id = link.dataset.essay;
  if (id !== uiState.essayId) afterSaving(() => openEssay(id));
  $('side').classList.remove('open');
}

/* the first click asks; the second deletes */
function askThenDeleteEssay(button) {
  if (uiState.delSure) {
    deleteEssay();
    return;
  }
  uiState.delSure = true;
  button.classList.add('sure');
  button.textContent = 'Click again to delete this essay';
}

/* ---- views ---- */
/* a view's tab: in the Mac app (where notes and essays open from the project folder), the Syllabus or Works Cited tab
   that's showing goes back to the notes or essay you came from */
function chooseView(tab) {
  const view = tab.dataset.view;
  if (NATIVE && view === uiState.view && !isDocView()) switchView(uiState.lastDoc || 'notes');
  else switchView(view);
}

/* a confidence circle: one step up (⇧ one down), round from 4 to not rated */
function rateConfidence(circle, e) {
  const point = syllabusPoints.find(p => p.id === circle.dataset.cyc);
  if (!point) return;
  const step = e.shiftKey ? CONFIDENCE_LEVELS - 1 : 1;
  point.status = ((point.status || 0) + step) % CONFIDENCE_LEVELS;
  Store.savePoint(point);
  renderSide();
  markCur();
  circle.outerHTML = cfHTML(point);
  const row = document.getElementById('row-' + point.id);
  if (row) row.dataset.s = point.status || 0;
  const redrawn = document.querySelector(`[data-cyc="${point.id}"]`);
  if (redrawn) redrawn.focus();
}

function goToSection(link, e) {
  e.preventDefault();
  const section = document.getElementById('sec-' + link.dataset.gosec);
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('side').classList.remove('open');
}

function openPointFromLink(link, e) {
  e.preventDefault();
  openPoint(link.dataset.open);
}

/* Edit syllabus / Done editing (editbtn2 only ever finishes; data-edit only ever starts) */
function toggleSyllabusEditing(button) {
  uiState.view = 'syl';
  uiState.edit = !uiState.edit && !(button.id === 'editbtn2');
  if (button.dataset.edit) uiState.edit = true;
  uiState.confirm = null;
  uiState.confirmApply = null;
  render();
  if (!uiState.edit) Store.saveLocal();
}

/* ---- a pasted syllabus: detected, reviewed as a draft, then added ---- */
function detectSyllabus() {
  uiState.paste = $('paste').value;
  if (!uiState.paste.trim()) {
    toast('Paste some text first');
    return;
  }
  uiState.draft = detect(uiState.paste);
  uiState.confirmApply = null;
  renderSetup();
  const review = $('review');
  if (review) review.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function suggestFromPaste() {
  uiState.paste = $('paste').value;
  suggestGrouping();
}

/* a line of the draft goes; a section left empty goes with it */
function removeDraftItem(path) {
  const [sectionIndex, itemIndex] = path.split('.').map(Number);
  const section = uiState.draft[sectionIndex];
  section.items.splice(itemIndex, 1);
  if (!section.items.length) uiState.draft.splice(sectionIndex, 1);
  if (!uiState.draft.length) uiState.draft = null;
  renderSetup();
}

function addDraftItem(sectionIndex) {
  uiState.draft[sectionIndex].items.push({ code: '', text: '', guide: '' });
  renderSetup();
}

function discardDraft() {
  uiState.draft = null;
  uiState.confirmApply = null;
  renderSetup();
}

/* adds the draft (or replaces the syllabus with it: that asks first if it would delete points with notes or ratings) */
function confirmDraft() {
  const replacing = uiState.mode === 'replace';
  const points = draftPoints();
  if (!points.length) {
    toast('Nothing to add');
    return;
  }
  const plan = planApply(points, replacing);
  const atRisk = plan.removed.filter(p => (p.notes || '').trim() || p.status).length;
  if (replacing && atRisk && !uiState.confirmApply) {
    uiState.confirmApply = atRisk;
    renderSetup();
    return;
  }
  commit(plan.next, plan.removed);
  uiState.draft = null;
  uiState.paste = '';
  uiState.confirmApply = null;
  showNewSyllabus(points.length + ' point' + (points.length === 1 ? '' : 's') + ' processed', false);
}

/* the draft's points (empty lines left out; missing numbers made from the section's) */
function draftPoints() {
  const firstSection = uiState.mode === 'add' ? sectionNames().length : 0;
  const points = [];
  uiState.draft.forEach((section, si) => {
    section.items.forEach((item, j) => {
      const text = (item.text || '').trim();
      if (!text) return;
      const code = (item.code || '').trim() || (secPrefix(section.title) || firstSection + si + 1) + '.' + (j + 1);
      points.push({ sec: (section.title || '').trim(), code: code, text: text, guide: item.guide || '' });
    });
  });
  return points;
}

/* back to the syllabus, at the top, with the work done */
function showNewSyllabus(message, isExample) {
  Store.example = isExample;
  uiState.view = 'syl';
  uiState.edit = false;
  render();
  window.scrollTo(0, 0);
  toast(message);
}

/* "Load Biology example" / "Start with an empty syllabus": asks first if there are notes or ratings to lose */
function startSyllabusOver(button) {
  const hasWork = syllabusPoints.some(p => (p.notes || '').trim() || p.status);
  if (hasWork && uiState.confirmReplace !== button.id) {
    uiState.confirmReplace = button.id;
    button.textContent = 'Replace everything? Click again';
    return;
  }
  uiState.confirmReplace = null;
  const example = button.id === 'ex';
  const gone = syllabusPoints;
  setSyllabusPoints([]);
  commit(example ? planApply(EXAMPLE, true).next : [], gone);
  uiState.draft = null;
  showNewSyllabus(example ? 'Example loaded' : 'Empty syllabus', example);
}

/* ---- the side panel follows the scroll; the header's height is kept for layout ---- */
const onEventsWindowScroll = function () {
  if (markCur.t) return;
  markCur.t = requestAnimationFrame(() => {
    markCur.t = 0;
    if (uiState.view !== 'setup') markCur();
  });
};

export function initEvents() {
  document.addEventListener('focusin', onEventsFocusin);
  document.addEventListener('change', onEventsChange);
  document.addEventListener('input', onEventsInput);
  document.addEventListener('mousedown', onEventsMousedown);
  $('tb').addEventListener('click', onEventsTbClick);
  document.addEventListener('click', onEventsClick);
  window.addEventListener('scroll', onEventsWindowScroll, { passive: true });
  window.addEventListener('resize', measure);
  if (window.ResizeObserver) new ResizeObserver(measure).observe($('head'));
}
