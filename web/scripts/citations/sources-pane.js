import { $, esc, ui } from '../core/helpers-and-state.js';
import { relayout, setPaneFold } from '../view/zoom.js';
import { ed, saveDocSoon } from '../editor/notes-document.js';
import { ccSoon, citationIds } from './citation-check.js';
import { edChanged } from '../editor/hydrate-and-changes.js';
import { renderComments } from '../editor/comments.js';
import { isDocView } from '../essays/essays.js';
import { namePart, orderedRefs, refById, refHTML, refs, yearLabels } from './references.js';
import { hydrateCites, insertCitation } from './in-text-citations.js';

/* ===== the Sources pane beside the notes: cite a source, or choose a citation's sources ===== */
export function openSources(target) {
  ui.refsOpen = true;
  document.querySelectorAll('#ed .cite.sel').forEach(citation => citation.classList.remove('sel'));
  ui.citeTarget = target || null;
  if (target) target.classList.add('sel');
  renderRefs();
  const search = $('refq');
  if (search && target) search.focus({ preventScroll: true });
}

/* the citation being chosen for, if it's still in the page */
function liveCiteTarget() {
  return ui.citeTarget && document.contains(ui.citeTarget) ? ui.citeTarget : null;
}

/* parenthetical or narrative, for the citation being chosen for */
const onSourcesPaneClick = e => {
  const button = e.target.closest && e.target.closest('[data-citeform]');
  if (!button || button.disabled) return;
  const target = ui.citeTarget;
  if (!target || !document.contains(target)) return;
  if (button.dataset.citeform === 'n') target.setAttribute('data-form', 'n');
  else target.removeAttribute('data-form');
  hydrateCites();
  saveDocSoon();
  if (typeof edChanged === 'function') edChanged();
  renderRefs();
};

export function endChoosing() {
  ccSoon();
  if (ui.citeTarget) ui.citeTarget.classList.remove('sel');
  ui.citeTarget = null;
  renderRefs();
}

/* the pane shows in the notes and essays when it's open; opening it unfolds a page folded by zoom */
export function renderRefs() {
  const pane = $('refs');
  const open = !!(isDocView() && ui.refsOpen);
  showRefsPane(pane, open);
  const button = $('srcbtn');
  if (button) button.setAttribute('aria-pressed', open ? 'true' : 'false');
  if (!open) return;
  const target = liveCiteTarget();
  if (!target) ui.citeTarget = null;
  pane.innerHTML = refsPaneHTML(target);
  drawRefList();
}

function showRefsPane(pane, open) {
  const wrap = $('bodywrap');
  const wasOpen = wrap.classList.contains('withrefs');
  pane.hidden = !open;
  wrap.classList.toggle('withrefs', open);
  if (open && !wasOpen && wrap.classList.contains('zfold')) {
    ui.zfoldOff = true;
    setPaneFold(false);
  }
  if (wasOpen === open) return;
  relayout();
  setTimeout(() => renderComments(true), 0);
}

function refsPaneHTML(target) {
  let hint = '';
  if (target) hint = citeFormHTML(target) + CHOOSING_HTML;
  else if (refs.length)
    hint = '<p class="rhint">Click a source to cite it where your cursor is, or use + Citation.</p>';
  return (
    `<div class="rh"><h4>Works cited <em>${refs.length}</em></h4>` +
    '<button class="x" data-refclose="1" aria-label="Close sources">×</button></div>' +
    hint +
    `<input type="text" id="refq" placeholder="Search author, year or title" aria-label="Search sources" value="${esc(ui.refQ || '')}">` +
    '<div id="reflist"></div>' +
    '<button class="btn sm" data-view="wc">Add or manage sources</button>'
  );
}

const CHOOSING_HTML =
  '<div class="choosing"><span>Click the source for this citation. Shift-click to cite several sources together.</span>' +
  '<div class="row"><button class="btn sm pri" data-refdone="1">Done</button>' +
  '<button class="btn sm" data-refrmcite="1">Delete citation</button></div></div>';

/* the two forms, shown as this citation would read in each */
function citeFormHTML(target) {
  const ids = citationIds(target);
  const r = ids.length === 1 ? refById(ids[0]) : null;
  const labels = yearLabels();
  const narrative = target.getAttribute('data-form') === 'n';
  const parenthetical = r ? '(' + esc(namePart(r)) + ', ' + esc(labels[r.id]) + ')' : '(Author, Year)';
  const inSentence = r ? esc(namePart(r)) + ' (' + esc(labels[r.id]) + ')' : 'Author (Year)';
  const oneOnly = ids.length > 1 ? ' disabled title="Narrative form is for one source"' : '';
  return (
    '<div class="citeform" role="group" aria-label="Citation style">' +
    `<button data-citeform="p" aria-pressed="${!narrative}">${parenthetical}</button>` +
    `<button data-citeform="n" aria-pressed="${narrative}"${oneOnly}>${inSentence}</button></div>`
  );
}

/* the sources matching the search, those the chosen citation names marked */
function drawRefList() {
  const box = $('reflist');
  if (!box) return;
  const chosen = ui.citeTarget ? citationIds(ui.citeTarget) : [];
  const query = (ui.refQ || '').toLowerCase();
  const labels = yearLabels();
  const matches = orderedRefs().filter(
    r => !query || (r.raw + ' ' + r.authors.join(' ') + ' ' + r.year).toLowerCase().indexOf(query) >= 0
  );
  const empty = refs.length ? 'No sources match.' : 'No sources yet. Add them in the Works Cited tab.';
  box.innerHTML = matches.map(r => sourceHTML(r, labels, chosen)).join('') || `<p class="rhint">${empty}</p>`;
}

function sourceHTML(r, labels, chosen) {
  return (
    `<div class="refi${chosen.includes(r.id) ? ' on' : ''}"><button class="refpick" data-refpick="${r.id}">` +
    `<b>(${esc(namePart(r))}, ${esc(labels[r.id])})</b><span>${refHTML(r)}</span></button></div>`
  );
}

/* ---- the pane's buttons and search ---- */
const onSourcesPaneRefsMousedown = e => {
  if (e.target.closest('button')) e.preventDefault();
};

const onSourcesPaneRefsInput = e => {
  if (e.target.id !== 'refq') return;
  ui.refQ = e.target.value;
  drawRefList();
};

const REFS_PANE_ACTIONS = [
  [
    data => data.refclose,
    () => {
      ui.refsOpen = false;
      endChoosing();
    }
  ],
  [data => data.refdone, () => endChoosing()],
  [data => data.refrmcite, () => removeChosenCitation()],
  [data => data.refpick, (data, e) => pickSource(data.refpick, e.shiftKey || e.metaKey || e.ctrlKey)]
];

const onSourcesPaneRefsClick = e => {
  const button = e.target.closest('button');
  if (!button) return;
  const action = REFS_PANE_ACTIONS.find(([matches]) => matches(button.dataset));
  if (action) action[1](button.dataset, e);
};

function removeChosenCitation() {
  const citation = ui.citeTarget;
  ui.citeTarget = null;
  if (citation) citation.remove();
  saveDocSoon();
  renderRefs();
}

/* with no citation chosen, a source is cited at the caret; otherwise it becomes the citation's source
   (or, with ⇧, is added to or taken from its sources) */
function pickSource(id, several) {
  const target = liveCiteTarget();
  if (!target) {
    insertCitation([id]);
    ui.refsOpen = false;
    renderRefs();
    return;
  }
  setCitationSources(target, chosenSources(target, id, several));
  if (several) {
    drawRefList();
    return;
  }
  ui.refsOpen = false;
  endChoosing();
  caretAfter(target);
}

function chosenSources(target, id, several) {
  const ids = citationIds(target);
  if (!several) return [id];
  const at = ids.indexOf(id);
  if (at >= 0) ids.splice(at, 1);
  else ids.push(id);
  return ids;
}

/* a citation whose sources change loses its page and PDF quote */
function setCitationSources(target, ids) {
  if (target.getAttribute('data-cite') !== ids.join(',')) {
    target.removeAttribute('data-pg');
    target.removeAttribute('data-anchor');
  }
  target.setAttribute('data-cite', ids.join(','));
  hydrateCites();
  saveDocSoon();
}

function caretAfter(node) {
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  const selection = getSelection();
  ed().focus({ preventScroll: true });
  selection.removeAllRanges();
  selection.addRange(range);
}

export function initSourcesPane() {
  document.addEventListener('click', onSourcesPaneClick);
  $('refs').addEventListener('mousedown', onSourcesPaneRefsMousedown);
  $('refs').addEventListener('input', onSourcesPaneRefsInput);
  $('refs').addEventListener('click', onSourcesPaneRefsClick);
}
