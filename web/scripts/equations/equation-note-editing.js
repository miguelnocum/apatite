import { mk } from '../core/paste-cleaning.js';
import { saveDocSoon } from '../editor/notes-document.js';
import { annList, annNoteHTML, annSave, mathKey } from './equation-drawing.js';
import { annLayout } from './equation-note-layout.js';
import { mathEd } from './equation-editor-parts.js';

/* ===== the note boxes are written in where they stand: click one to type in it (Return or Esc to finish) =====
   A box is written in as a plain text field laid over its words: selecting, dragging and ⌘A stay inside it
   (an editable box nested in the editable notes lets a drag run off across the page). `at` is where it was clicked. */
const NOTE_EDIT_MIN_WIDTH = 190; // px a box is at least, while it's written in

export function editCard(el, i, at) {
  const card = el.querySelector('.mcard[data-ai="' + i + '"]');
  const note = annList(el)[i];
  if (!card || !note) return;
  let field = card.querySelector('textarea');
  let offset = null;
  if (!field) {
    offset = clickedOffset(card, note, at);
    field = noteField(el, card, i, note);
  }
  field.focus();
  const caret = offset == null ? field.value.length : Math.min(offset, field.value.length);
  field.setSelectionRange(caret, caret);
  annLayout(el);
}

/* the caret goes where the click was (the words are the same as typed when there's no maths in them) */
function clickedOffset(card, note, at) {
  if (!(at && document.caretRangeFromPoint && !/\$/.test(note.n || ''))) return null;
  const hit = document.caretRangeFromPoint(at.x, at.y);
  if (!(hit && card.contains(hit.startContainer))) return null;
  const before = document.createRange();
  before.selectNodeContents(card);
  before.setEnd(hit.startContainer, hit.startOffset);
  return before.toString().length;
}

/* the box's words become a text field; leaving it draws them again */
function noteField(el, card, i, note) {
  card.style.width = Math.max(card.offsetWidth, NOTE_EDIT_MIN_WIDTH) + 'px';
  card.classList.add('editing');
  const field = mk('textarea');
  field.className = 'mcta';
  field.rows = 1;
  field.spellcheck = true;
  field.value = note.n || '';
  field.placeholder = 'What it means…  ($x_i$ for maths)';
  card.innerHTML = '';
  card.appendChild(field);
  field.addEventListener('blur', () => finishNote(el, card, i));
  annGrow(field);
  return field;
}

function finishNote(el, card, i) {
  if (!card.isConnected) return;
  card.classList.remove('editing');
  card.style.width = '';
  card.innerHTML = annNoteHTML((annList(el)[i] || {}).n);
  annLayout(el);
  saveDocSoon();
  if (mathEd && mathEd.el === el && mathEd.drawList) mathEd.drawList();
}

/* a field as tall as its words */
function annGrow(field) {
  field.style.height = 'auto';
  field.style.height = field.scrollHeight + 'px';
}

/* typing in a box is its own: the editor's shortcuts, Markdown and paste cleaning stay out of it */
function annEditing(target) {
  return target && target.closest ? target.closest('#ed .mcard textarea') : null;
}

/* Return (without ⇧) or Esc finishes */
function noteKey(e, field) {
  if (e.isComposing || !(e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey))) return;
  e.preventDefault();
  field.blur();
}

/* each change is saved as it's typed; the boxes and lines follow on the next frame */
function noteTyped(field) {
  const card = field.closest('.mcard');
  const el = field.closest('[data-math]');
  const i = +card.getAttribute('data-ai');
  const list = annList(el);
  if (!list[i]) return;
  list[i].n = field.value.replace(/\n+$/, '');
  annSave(el, list);
  el.__drawn = mathKey(el);
  saveDocSoon();
  annGrow(field);
  cancelAnimationFrame(card.__lay);
  card.__lay = requestAnimationFrame(() => annLayout(el));
}

export function initEquationNoteEditing() {
  ['keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'paste', 'cut', 'drop'].forEach(type => {
    window.addEventListener(
      type,
      e => {
        const field = annEditing(e.target);
        if (!field) return;
        e.stopPropagation();
        if (type === 'keydown') noteKey(e, field);
        else if (type === 'input') noteTyped(field);
      },
      true
    );
  });
}
