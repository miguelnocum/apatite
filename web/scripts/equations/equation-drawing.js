import { restoreSel } from '../core/caret.js';
import { ed, esc } from '../core/helpers-and-state.js';
import { mk } from '../core/paste-cleaning.js';
import { saveDocSoon } from '../editor/notes-document.js';
import { mdTopBlock } from '../writing/writing.js';
import { KT_OPTS, texInline, texLines, texShow } from './equation-tex.js';
import { annCandidates, annotateTex } from './equation-parts.js';
import { annLayout, annRO } from './equation-note-layout.js';
import { openMathEditor } from './equation-editor.js';
import { ensureRoom } from '../editor/folding.js';

/* ===== explained equations: parts of an equation in colour, each with a note in plain words =====
   data-math-notes holds [{t:"\\sigma",c:2,n:"squashes any number to between 0 and 1"}]; every place the part appears is coloured,
   and its note sits above or below the equation with a line to it */
export const ANN_COLORS = ['#e5484d', '#3e8ef7', '#2f9e5b', '#f07a1a', '#8e4ec6', '#d6409f', '#0e9c8e', '#c08f00'];

/* an equation's notes (those naming a part) */
export function annList(el) {
  try {
    const list = JSON.parse(el.getAttribute('data-math-notes') || '[]');
    return Array.isArray(list) ? list.filter(note => note && typeof note.t === 'string' && note.t.trim()) : [];
  } catch (x) {
    return [];
  }
}

export function annSave(el, list) {
  if (list.length) el.setAttribute('data-math-notes', JSON.stringify(list));
  else el.removeAttribute('data-math-notes');
}

export function annColor(note) {
  const count = ANN_COLORS.length;
  return ANN_COLORS[(((+note.c || 0) % count) + count) % count];
}

/* what an equation is drawn from: once drawn from the same, it isn't drawn again */
export function mathKey(el) {
  return (
    (el.getAttribute('data-math') || '') +
    '\u0001' +
    (el.getAttribute('data-math-notes') || '') +
    (el.classList.contains('annot') ? '\u0001a' : '')
  );
}

/* a note's words, with maths written between dollar signs ($\{x_i, y_i\}$) drawn by KaTeX */
export function annNoteHTML(text) {
  if (!text) return '<i>Click to explain</i>';
  return String(text)
    .split(/(\$[^$\n]+\$)/)
    .map(piece => (/^\$[^$\n]+\$$/.test(piece) ? texInline(piece.slice(1, -1)) : esc(piece).replace(/\n/g, '<br>')))
    .join('');
}

/* every equation in a part of the page, drawn (unless it's drawn already from the same LaTeX and notes) */
export function renderMath(root) {
  (root || ed()).querySelectorAll('[data-math]').forEach(drawEquation);
}

function drawEquation(el) {
  el.setAttribute('contenteditable', 'false');
  const source = el.getAttribute('data-math') || '';
  const key = mathKey(el);
  if (el.__drawn === key) return;
  el.__drawn = key;
  if (!source.trim()) {
    el.innerHTML = '';
    el.classList.add('empty');
    return;
  }
  el.classList.remove('empty');
  const list = annList(el);
  el.__cands = clickableSymbols(el, source, list);
  putLines(el, equationLines(source, list, el.__cands), list);
}

/* in annotation mode, the symbols not explained yet can be clicked to explain them */
function clickableSymbols(el, source, list) {
  if (!el.classList.contains('annot')) return [];
  return annCandidates(source).filter(tex => !list.some(note => note.t === tex));
}

/* the lines in place of what was drawn before: with their notes around them, laid out once they're in the page */
function putLines(el, lines, list) {
  el.innerHTML = '';
  if (!list.length) {
    el.appendChild(lines);
    return;
  }
  el.appendChild(withNotes(lines, list));
  if (annRO) annRO.observe(lines);
  requestAnimationFrame(() => annLayout(el));
}

/* the lines, each drawn by KaTeX, with the explained parts in their colours */
function equationLines(source, list, candidates) {
  const lines = mk('div');
  lines.className = 'meqs';
  texLines(source).forEach(line => {
    const eq = mk('div');
    eq.className = 'meq';
    try {
      if (window.katex) katex.render(annotateTex(texShow(line), list, candidates), eq, KT_OPTS);
      else eq.textContent = line;
    } catch (x) {
      eq.textContent = line;
    }
    lines.appendChild(eq);
  });
  lines.querySelectorAll('[class*="mann"]').forEach(part => {
    const index = /mann(\d+)/.exec(part.className);
    if (index && list[+index[1]]) part.style.setProperty('--ac', annColor(list[+index[1]]));
  });
  return lines;
}

/* the notes: boxes above and below, each with a line to its part */
function withNotes(lines, list) {
  const wrap = mk('div');
  wrap.className = 'mwrap';
  wrap.innerHTML =
    '<div class="mrow mtop"></div><div class="mrow mbot"></div><svg class="mlines" aria-hidden="true"></svg>';
  wrap.insertBefore(lines, wrap.children[1]);
  list.forEach((note, i) => {
    const card = mk('div');
    card.className = 'mcard';
    card.setAttribute('data-ai', i);
    card.style.setProperty('--ac', annColor(note));
    card.innerHTML = annNoteHTML(note.n);
    wrap.firstChild.appendChild(card);
  });
  return wrap;
}

/* a new equation where the caret is: in place of an empty line (or "$$"), else after the line; its editor opens */
export function insertMath(replace) {
  const editor = ed();
  if (!editor) return;
  restoreSel();
  const block = replace || mdTopBlock(getSelection().anchorNode);
  const equation = mk('div');
  equation.setAttribute('data-math', '');
  if (block && block.getAttribute && block.getAttribute('data-sp'))
    equation.setAttribute('data-sp', block.getAttribute('data-sp'));
  const emptyLine =
    block && block.tagName === 'P' && !block.textContent.replace('$$', '').trim() && !block.querySelector('img');
  if (emptyLine) block.replaceWith(equation);
  else if (block) block.after(equation);
  else editor.appendChild(equation);
  ensureRoom();
  renderMath(editor);
  openMathEditor(equation, true);
  saveDocSoon();
}
