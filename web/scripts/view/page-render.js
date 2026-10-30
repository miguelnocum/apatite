import { $, ed, NATIVE, pts, ui } from '../core/helpers-and-state.js';
import { Store } from '../core/storage.js';
import { measure, renderSide, renderSyl } from '../syllabus/syllabus-view.js';
import { alignToolbar, closeTbMenu, headerHeight } from './zoom.js';
import { applyFocus } from './focus-mode.js';
import { renderNotes, saveDocNow } from '../editor/notes-document.js';
import { ccRefresh, citeCheck, closeCiteCheck } from '../citations/citation-check.js';
import { renderComments } from '../editor/comments.js';
import { closeTagPop } from '../essays/word-count-boxes.js';
import { isDocView, renderEssay } from '../essays/essays.js';
import { renderRefs } from '../citations/sources-pane.js';
import { renderWC } from '../citations/works-cited-tab.js';

/* ===== drawing the page for the view that's open ===== */
const CURRENT_SECTION_SLACK = 40; // px below the header a section's top can be and still count as the one being read
const CITATION_CHECK_REFRESH_DELAY = 50;

/* the points of a section, by its index in the syllabus being edited */
export function secPts(index) {
  const ids = (ui.secMap && ui.secMap[index]) || [];
  return pts.filter(p => ids.includes(p.id));
}

export function render() {
  if (ed()) saveDocNow();
  closeTbMenu();
  if (ui.view === 'setup') ui.view = 'syl';
  renderHeader();
  layoutForView();
  applyFocus();
  setTimeout(() => renderComments(true), 0);
  if (citeCheck && !isDocView()) closeCiteCheck();
  else if (citeCheck) setTimeout(() => citeCheck && ccRefresh(0), CITATION_CHECK_REFRESH_DELAY);
  renderViewContent();
  $('side').classList.remove('open');
  $('back').hidden = !(ui.back && ui.view === 'notes');
  if (!isDocView()) ui.citeTarget = null;
  renderRefs();
  measure();
  alignToolbar();
}

/* the view buttons, the toolbar (notes and essays only) and the Edit syllabus button */
function renderHeader() {
  document.querySelectorAll('.tabs button').forEach(b => {
    const on = b.dataset.view === ui.view;
    b.setAttribute('aria-pressed', on);
    if (NATIVE && !b.classList.contains('doctab'))
      b.title = on ? 'Back to your ' + (ui.lastDoc === 'essay' ? 'essay' : 'notes') : '';
  });
  $('tb').style.display = isDocView() ? '' : 'none';
  $('tb').classList.toggle('essay', ui.view === 'essay');
  const edit = $('editbtn');
  edit.hidden = ui.view !== 'syl';
  edit.textContent = ui.edit ? 'Done editing' : 'Edit syllabus';
  edit.classList.toggle('pri', !!ui.edit);
  measure();
}

function layoutForView() {
  $('bodywrap').classList.toggle('wcview', ui.view === 'wc');
  $('bodywrap').classList.toggle('notesview', isDocView());
  if (ui.view === 'essay') return;
  ui.wcMode = false;
  closeTagPop();
}

function renderViewContent() {
  if (ui.view === 'notes') {
    renderNotes();
    renderSide();
  } else if (ui.view === 'essay') {
    renderEssay();
    renderSide();
  } else if (ui.view === 'wc') {
    $('side').innerHTML = '';
    renderWC();
  } else {
    renderSide();
    renderSyl();
  }
}

/* the side panel marks the section being read (the last one whose top has scrolled up past the header) */
export function markCur() {
  const header = headerHeight();
  let current = null;
  document.querySelectorAll('[data-secidx]').forEach(section => {
    if (section.getBoundingClientRect().top <= header + CURRENT_SECTION_SLACK) current = section.dataset.secidx;
  });
  document.querySelectorAll('.side a').forEach(link => link.classList.toggle('cur', link.dataset.gosec === current));
}

/* a brief highlight, to show where something is (restarted if it's already running) */
export function flash(el) {
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

/* "Back to syllabus" from a point's notes: to where the syllabus was, the point flashed */
export function backToSyl() {
  if (ed()) saveDocNow();
  const back = ui.back;
  ui.back = null;
  ui.view = 'syl';
  render();
  window.scrollTo(0, back ? back.scroll : 0);
  if (back) flash(document.getElementById('row-' + back.id));
}

/* the example syllabus says so; shown while editing too (without its button), so the table stays where it was */
export function addBanner() {
  if (!Store.example) return;
  $('main').insertAdjacentHTML(
    'afterbegin',
    '<div class="banner"><span>This is an example syllabus (topic 2 of your Biology file). Ratings and notes you add are saved. ' +
      'Replace it with your own whenever you like.</span>' +
      `<button class="btn sm" data-edit="1"${ui.edit ? ' style="visibility:hidden"' : ''}>Edit syllabus</button></div>`
  );
}
