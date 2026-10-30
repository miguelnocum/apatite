import { toast } from '../core/helpers-and-state.js';
import { mk } from '../editor/paste-cleaning.js';
import { restoreSel } from '../view/zoom.js';
import { ed, saveDocSoon } from '../editor/notes-document.js';
import { texShow } from './equation-tex.js';
import { caretAfterMath, mathEd } from './equation-editor-parts.js';
import { openMathEditor } from './equation-editor.js';
import { caretAnchors } from '../editor/caret-and-keys.js';

/* ===== inline equations: <span data-imath="LaTeX"> in a line of text ===== */
const INLINE_KATEX_OPTIONS = { displayMode: false, throwOnError: false, strict: 'ignore' };

export function renderIMath(root) {
  (root || ed()).querySelectorAll('[data-imath]').forEach(drawInlineEquation);
}

function drawInlineEquation(el) {
  el.setAttribute('contenteditable', 'false');
  const source = el.getAttribute('data-imath') || '';
  if (el.__drawn === source && el.firstChild) return; // already showing this
  el.__drawn = source;
  const empty = !source.trim();
  el.classList.toggle('empty', empty);
  if (empty) {
    el.innerHTML = '';
    return;
  }
  try {
    if (window.katex) katex.render(texShow(source), el, INLINE_KATEX_OPTIONS);
    else el.textContent = source;
  } catch (x) {
    el.textContent = source;
  }
}

/* an inline equation where the caret is: the selected text becomes its LaTeX, or an empty one opens to be written */
export function insertIMath() {
  const editor = ed();
  if (!editor) return;
  restoreSel();
  const selection = getSelection();
  if (!selection.rangeCount || !editor.contains(selection.anchorNode)) {
    toast('Click in the text where the equation goes');
    return;
  }
  const range = selection.getRangeAt(0);
  const tex = range.toString().trim();
  const equation = replaceWithInlineEquation(range, tex);
  if (tex) caretAfterMath(equation);
  else openMathEditor(equation, true);
}

function replaceWithInlineEquation(range, tex) {
  range.deleteContents();
  const equation = mk('span');
  equation.setAttribute('data-imath', tex);
  range.insertNode(equation);
  renderIMath(equation.parentNode);
  caretAnchors(equation.parentNode);
  saveDocSoon();
  return equation;
}

/* a press on an inline equation opens its editor (it's never edited as text) */
const onInlineEquationsMousedown = function (e) {
  const equation = e.target.closest && e.target.closest('#ed [data-imath]');
  if (!equation || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  if (!mathEd || mathEd.el !== equation) openMathEditor(equation, false);
};

export function initInlineEquations() {
  document.addEventListener('mousedown', onInlineEquationsMousedown, true);
}
