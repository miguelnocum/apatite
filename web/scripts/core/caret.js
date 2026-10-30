import { curEd, ed, ui } from './helpers-and-state.js';

/* ===== where the caret is: in the notes or essay being written, and what is around it ===== */
/* the caret (or selection) is in the notes or essay being written (not in the equation editor) */
export function inEd() {
  const active = document.activeElement;
  if (active && active.closest && active.closest('.mathpop')) return false;
  const selection = getSelection();
  return curEd && selection.rangeCount && curEd.contains(selection.anchorNode);
}

/* the notes changed (saved and redrawn as if typed) */
export function fire() {
  if (curEd) curEd.dispatchEvent(new Event('input', { bubbles: true }));
}

/* the nearest element around the caret that matches */
export function closestTag(selector) {
  const selection = getSelection();
  if (!selection.anchorNode) return null;
  const node = selection.anchorNode.nodeType === 3 ? selection.anchorNode.parentNode : selection.anchorNode;
  return node.closest ? node.closest(selector) : null;
}

/* the focus back in the notes, with the selection they last had */
export function restoreSel() {
  const editor = ed();
  if (!editor) return;
  editor.focus({ preventScroll: true });
  if (!(ui.lastRange && editor.contains(ui.lastRange.startContainer))) return;
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(ui.lastRange);
}

export function selectRange(range) {
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

export function caretToStart(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  selectRange(range);
}

/* the caret at the start of a line, in the editor */
export function caretInto(line) {
  if (!line) return;
  caretToStart(line);
  ed().focus({ preventScroll: true });
}
