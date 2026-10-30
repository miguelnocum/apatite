import { selectRange } from '../core/caret.js';
import { $, ed, esc, toast } from '../core/helpers-and-state.js';
import { mk } from '../core/paste-cleaning.js';
import { saveDocSoon } from './notes-document.js';
import { edChanged, hydrateExtras } from './hydrate-and-changes.js';

/* ===== footnotes: a marker in the text, the numbered notes under the page; click one to write it ===== */
const FOOTNOTE_POPUP_MARGIN = 12; // px the footnote box keeps from the window's edges
const FOOTNOTE_POPUP_GAP = 8; // px between the box and its marker
const FOOTNOTE_POPUP_SHIFT = 20; // px the box sits left of its marker
const FOOTNOTE_POPUP_HTML =
  '<textarea placeholder="Write the footnote"></textarea>' +
  '<div class="row"><button class="del" data-fnact="del">Delete footnote</button><button data-fnact="done">Done</button></div>';
export let fnPop = null;

export function renderFootnotes() {
  const editor = ed();
  if (!editor) return;
  const markers = [...editor.querySelectorAll('.fn')];
  let list = $('fnlist');
  if (!markers.length) {
    if (list) list.remove();
    return;
  }
  if (!list) {
    list = mk('ol');
    list.id = 'fnlist';
    list.className = 'fnlist';
    editor.after(list);
  }
  list.innerHTML = markers.map(footnoteItemHTML).join('');
}

function footnoteItemHTML(marker, i) {
  const note = marker.getAttribute('data-fn') || '';
  return `<li data-fni="${i}" class="${note ? '' : 'empty'}">${note ? esc(note) : 'Empty footnote, click to write it'}</li>`;
}

/* a marker after the selection, its box open to write in */
export function insertFootnote() {
  const editor = ed();
  const selection = getSelection();
  if (!editor || !selection.rangeCount || !editor.contains(selection.anchorNode)) {
    toast('Click in the text where the footnote goes');
    return;
  }
  const marker = putFootnoteMarker(selection.getRangeAt(0), editor);
  saveDocSoon();
  edChanged();
  // after this click has finished bubbling, or the click-outside handler would close it again
  setTimeout(() => openFn(marker), 0);
}

/* a marker at the end of the range, the caret after it */
function putFootnoteMarker(range, editor) {
  range.collapse(false);
  const marker = mk('span');
  marker.setAttribute('data-fn', '');
  range.insertNode(marker);
  hydrateExtras(editor);
  const after = document.createRange();
  after.setStartAfter(marker);
  after.collapse(true);
  selectRange(after);
  return marker;
}

export function closeFn() {
  if (!fnPop) return;
  if (fnPop.target) fnPop.target.classList.remove('sel');
  fnPop.remove();
  fnPop = null;
}

export function openFn(marker) {
  closeFn();
  const number = [...ed().querySelectorAll('.fn')].indexOf(marker) + 1;
  const pop = mk('div');
  pop.className = 'fnpop';
  pop.target = marker;
  marker.classList.add('sel');
  pop.innerHTML = `<h5>Footnote ${number}</h5>` + FOOTNOTE_POPUP_HTML;
  document.body.appendChild(pop);
  fnPop = pop;
  const field = pop.querySelector('textarea');
  field.value = marker.getAttribute('data-fn') || '';
  placeFootnotePopup(pop, marker.getBoundingClientRect());
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
  listenToFootnote(pop, field, marker);
}

/* below the marker (above, if there's no room), kept inside the window */
function placeFootnotePopup(pop, near) {
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  const room = document.documentElement.clientWidth;
  const left = Math.min(near.left - FOOTNOTE_POPUP_SHIFT, room - width - FOOTNOTE_POPUP_MARGIN);
  pop.style.left = Math.max(FOOTNOTE_POPUP_MARGIN, left) + 'px';
  const below = near.bottom + FOOTNOTE_POPUP_GAP;
  const above = Math.max(FOOTNOTE_POPUP_MARGIN, near.top - height - FOOTNOTE_POPUP_GAP);
  pop.style.top = (below + height > innerHeight ? above : below) + 'px';
}

/* typing saves the note; Return or Esc closes; Delete removes the footnote */
function listenToFootnote(pop, field, marker) {
  field.addEventListener('input', () => {
    marker.setAttribute('data-fn', field.value);
    marker.title = field.value || 'Empty footnote';
    saveDocSoon();
    edChanged();
  });
  field.addEventListener('keydown', e => {
    if (e.key !== 'Escape' && !(e.key === 'Enter' && !e.shiftKey)) return;
    e.preventDefault();
    closeFn();
  });
  pop.addEventListener('click', e => {
    const button = e.target.closest('[data-fnact]');
    if (!button) return;
    if (button.dataset.fnact === 'del') deleteFootnote(marker);
    else closeFn();
  });
}

function deleteFootnote(marker) {
  marker.remove();
  closeFn();
  saveDocSoon();
  edChanged();
  renderFootnotes();
  toast('Footnote deleted');
}
