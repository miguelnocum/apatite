import { openEditor } from '../core/helpers-and-state.js';
import { KEY } from '../core/example-data.js';
import { makeElement } from '../core/paste-cleaning.js';
import { texLines, texShow } from './equation-tex.js';
import { renderMath } from './equation-drawing.js';
import { editCard } from './equation-note-editing.js';
import { renderIMath } from './inline-equations.js';
import { EQ_BOXES } from './math-field-look.js';
import {
  caretAfterMath,
  closeMathEditor,
  editorHTML,
  enableGripDrag,
  fitPreviews,
  mathAttr,
  mathEd,
  placeEditor,
  setMathEd
} from './equation-editor-parts.js';
import { EquationLines, focusFieldAt } from './equation-lines.js';
import { EquationGalleries } from './equation-galleries.js';
import { AnnotationPanel } from './equation-annotations.js';

/* ===== the equation editor, part 7: the editor itself — typing boxes the way Word does it, with the LaTeX behind them
   shown on request, galleries of structures, symbols and equations, and annotation ===== */
const ACCENT_TARGET = /^\s*([A-Za-z0-9]|\\[a-zA-Z]+)\s*$/; // what an accent can go on: one letter or command

export function openMathEditor(el, isNew) {
  closeMathEditor();
  new MathEditor(el, isNew); // (it makes itself the open editor)
}

class MathEditor {
  constructor(el, isNew) {
    this.el = el;
    this.attr = mathAttr(el);
    this.inline = this.attr === 'data-imath';
    this.showTex = !EQ_BOXES || readLatexPreference();
    this.typingLatex = false; // the LaTeX box (not a typing box) was last typed in
    this.popup = this.makePopup();
    this.input = this.makeLatexInput();
    this.annotations = new AnnotationPanel(this);
    this.lines = new EquationLines(this);
    this.galleries = new EquationGalleries(this);
    setMathEd(this); // the open editor from here on: drawing the equation asks it to re-place itself
    this.listen();
    this.start(isNew);
  }

  makePopup() {
    const popup = makeElement('div');
    popup.className =
      'mathpop' + (this.inline ? ' inline' : '') + (this.showTex ? ' showtex' : '') + (EQ_BOXES ? '' : ' noboxes');
    popup.el = this.el;
    this.el.classList.add('editing');
    popup.innerHTML = editorHTML();
    document.body.appendChild(popup);
    return popup;
  }

  makeLatexInput() {
    const input = this.popup.querySelector('textarea');
    input.value = this.el.getAttribute(this.attr) || '';
    if (this.inline) input.placeholder = 'LaTeX, e.g. x_i^2 or \\frac{1}{n}';
    return input;
  }

  start(isNew) {
    this.lines.build();
    this.draw();
    this.galleries.drawStrip();
    fitPreviews(this.popup.querySelector('.mp-pal'));
    this.markMode();
    if (!this.inline) this.annotations.setOn(!isNew && this.annotations.notes().length > 0);
    this.focusFirst();
  }

  focusFirst() {
    if (EQ_BOXES && !(this.showTex && !this.lines.fields.length)) {
      const field = this.lines.active();
      setTimeout(() => {
        if (mathEd === this && field) focusFieldAt(field, 'end');
      }, 0);
    } else {
      this.input.focus();
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    }
  }

  /* ---- what the page uses ---- */

  place() {
    placeEditor(this.popup, this.el);
  }

  drawList(focus) {
    this.annotations.draw(focus);
  }

  addNote(tex) {
    this.annotations.add(tex);
  }

  contains(node) {
    return this.popup.contains(node);
  }

  remove() {
    this.popup.remove();
  }

  /* ---- the equation ---- */

  /* the equation on the page, from the LaTeX; LaTeX that doesn't work is reported under it */
  draw() {
    const latex = this.input.value;
    this.el.setAttribute(this.attr, latex);
    if (this.inline) renderIMath(this.el.parentNode);
    else renderMath(this.el.parentNode || openEditor());
    this.popup.querySelector('.mp-err').textContent = this.showTex ? latexError(latex) : '';
    this.place();
  }

  finish() {
    closeMathEditor();
    caretAfterMath(this.el);
  }

  deleteEquation() {
    this.el.setAttribute(this.attr, '');
    closeMathEditor();
  }

  /* what's selected, as LaTeX: in the typing box, or in the LaTeX box when that was last typed in */
  selectedLatex() {
    if (!EQ_BOXES || (this.showTex && this.typingLatex)) {
      return this.input.value.slice(this.input.selectionStart, this.input.selectionEnd);
    }
    const field = this.lines.active();
    try {
      const empty = !field || field.selection.ranges.every(([from, to]) => from === to);
      return empty ? '' : field.getValue(field.selection, 'latex');
    } catch (x) {
      return '';
    }
  }

  /* ---- putting things in ---- */

  /* a structure or symbol goes where you are typing, with boxes to fill in */
  insertTemplate(template, isAccent) {
    if (!EQ_BOXES || (this.showTex && this.typingLatex)) {
      this.insertIntoLatex(template);
      return;
    }
    const field = this.lines.active();
    if (!field) return;
    field.focus();
    if (isAccent && template.includes('#0')) this.selectLetterForAccent(field);
    field.insert(template, { selectionMode: 'placeholder', focus: true, format: 'latex' });
    this.lines.changed();
  }

  /* in the LaTeX box: anything selected goes in the first box ({}), and the caret into the first empty one */
  insertIntoLatex(template) {
    const input = this.input;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selected = input.value.slice(start, end);
    const text = template.replace('#0', selected ? '{' + selected + '}' : '{}').replace(/#\?/g, '{}');
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    const hole = text.indexOf('{}');
    const caret = start + (hole >= 0 ? hole + 1 : text.length);
    input.focus();
    input.setSelectionRange(caret, caret);
    this.draw();
    this.lines.build();
  }

  /* an accent with nothing selected goes on the letter just typed (x then Hat: x̂) */
  selectLetterForAccent(field) {
    try {
      const nothingSelected = field.selection.ranges.every(([from, to]) => from === to);
      if (!nothingSelected || field.position <= 0) return;
      field.executeCommand('extendSelectionBackward');
      const letter = field.getValue(field.selection, 'latex');
      if (!ACCENT_TARGET.test(letter || '')) field.executeCommand('moveToNextChar');
    } catch (x) {}
  }

  /* a whole equation from the gallery: it starts an empty one, or goes on a line of its own
     (in an inline one, where you're typing) */
  insertEquation(tex) {
    if (!this.input.value.trim()) {
      this.replaceLatex(tex);
      if (!this.showTex) this.focusLine(this.lines.active());
    } else if (!this.inline) {
      this.appendLine(tex);
      if (!this.showTex) this.focusLine(this.lines.fields[this.lines.fields.length - 1]);
    } else if (!EQ_BOXES || this.showTex) {
      this.insertTemplate(tex);
    } else if (texLines(tex).length > 1) {
      this.appendLine(tex);
    } else {
      const field = this.lines.active();
      field.focus();
      field.insert(tex, { format: 'latex', selectionMode: 'after', focus: true });
      this.lines.changed();
    }
  }

  replaceLatex(tex) {
    this.input.value = tex;
    this.draw();
    this.lines.build();
  }

  appendLine(tex) {
    this.replaceLatex(this.input.value.replace(/\s+$/, '') + '\n' + tex);
  }

  focusLine(field) {
    if (field) focusFieldAt(field, 'end');
  }

  /* ---- the way of typing: boxes (like Word's Unicode) or LaTeX ---- */

  setMode(latex) {
    if (!EQ_BOXES) latex = true;
    this.showTex = latex;
    this.popup.classList.toggle('showtex', latex);
    writeLatexPreference(latex);
    this.markMode();
    this.typingLatex = latex;
    if (latex) {
      this.draw();
      this.input.focus();
    } else {
      this.lines.build();
      const field = this.lines.active();
      if (field) setTimeout(() => focusFieldAt(field, 'end'), 0);
    }
    this.place();
  }

  markMode() {
    this.popup.querySelectorAll('[data-mpmode]').forEach(button => {
      button.classList.toggle('on', (button.dataset.mpmode === 't') === this.showTex);
    });
  }

  /* ordinary words in the equation: MathLive's text mode, or \text{} in LaTeX */
  toggleText() {
    if (!EQ_BOXES || this.showTex) {
      this.insertTemplate('\\text{#?}');
      return;
    }
    const field = this.lines.active();
    if (!field) return;
    field.focus();
    try {
      const inText = field.mode === 'text';
      field.executeCommand(['switchMode', inText ? 'math' : 'text']);
      this.popup.querySelector('[data-mptext]').classList.toggle('on', !inText);
    } catch (x) {}
  }

  /* ---- events ---- */

  listen() {
    /* it grows as its boxes draw (and as lines are added): kept in the window each time */
    if (window.ResizeObserver) new ResizeObserver(() => mathEd === this && this.place()).observe(this.popup);
    enableGripDrag(this.popup);
    this.input.addEventListener('input', () => {
      this.draw();
      this.lines.build();
    });
    this.input.addEventListener('focus', () => (this.typingLatex = true));
    this.input.addEventListener('keydown', ev => this.onLatexKey(ev));
    this.popup.addEventListener('mousedown', ev => this.onPress(ev));
    this.popup.addEventListener('contextmenu', ev => this.onContextMenu(ev));
    this.popup.addEventListener('click', ev => this.onClick(ev));
  }

  /* in the LaTeX box: Esc (or ⌘↩) finishes; Tab goes to the next empty {} */
  onLatexKey(ev) {
    const input = this.input;
    if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey || this.inline))) {
      ev.preventDefault();
      this.finish();
    } else if (ev.key === 'Tab') {
      ev.preventDefault();
      let hole = input.value.indexOf('{}', input.selectionEnd);
      if (hole < 0) hole = input.value.indexOf('{}');
      if (hole >= 0) input.setSelectionRange(hole + 1, hole + 1);
    }
  }

  /* buttons don't take the focus from the typing; a press outside the open gallery closes it */
  onPress(ev) {
    if (ev.target.closest('button')) ev.preventDefault();
    if (this.galleries.drop && !ev.target.closest('.mp-drop,.mp-cat,.mp-more')) this.galleries.close();
  }

  /* right-click on a symbol in the strip pins it, or unpins it */
  onContextMenu(ev) {
    const symbol = ev.target.closest('.mp-syms [data-symtex]');
    if (!symbol) return;
    ev.preventDefault();
    this.galleries.togglePin(symbol.dataset.symtex);
  }

  onClick(ev) {
    const button = ev.target.closest('button');
    if (!button) return;
    const action = EDITOR_BUTTONS.find(([matches]) => matches(button));
    if (action) action[1](this, button, ev);
  }
}

/* what each of the editor's buttons does: [is it this button, what to do] */
const EDITOR_BUTTONS = [
  [b => b.dataset.mpcat != null, (editor, b) => editor.galleries.openStructure(+b.dataset.mpcat, b)],
  [b => !!b.dataset.mptpl, (editor, b) => insertTile(editor, b.dataset.mptpl)],
  [b => b.hasAttribute('data-mpsyms'), (editor, b) => editor.galleries.openSymbols(b)],
  [b => !!b.dataset.mpsrow, (editor, b) => editor.galleries.scrollStrip(+b.dataset.mpsrow)],
  [b => b.hasAttribute('data-mpgal'), (editor, b) => editor.galleries.openEquations(b, false)],
  [b => b.dataset.symtex != null, (editor, b, ev) => symbolClicked(editor, b, ev)],
  [b => b.dataset.eqtex != null, (editor, b) => galleryEquationClicked(editor, b.dataset.eqtex)],
  [b => b.dataset.eqdel != null, (editor, b) => editor.galleries.removeSaved(+b.dataset.eqdel)],
  [b => b.hasAttribute('data-eqsave'), editor => reopenToSave(editor)],
  [b => b.hasAttribute('data-eqsaveok'), editor => editor.galleries.saveEquation(editor.galleries.typedName())],
  [b => !!b.dataset.mpmode, (editor, b) => editor.setMode(b.dataset.mpmode === 't')],
  [b => b.hasAttribute('data-mptext'), editor => editor.toggleText()],
  [b => b.hasAttribute('data-mpdone'), editor => editor.finish()],
  [b => b.hasAttribute('data-mpdel'), editor => editor.deleteEquation()],
  [b => b.hasAttribute('data-mpann'), editor => editor.annotations.setOn(!editor.annotations.isOn())],
  [b => b.hasAttribute('data-annsel'), editor => editor.annotations.explainSelection()],
  [b => b.dataset.annc != null, (editor, b) => editor.annotations.nextColour(+b.dataset.annc)],
  [b => b.dataset.annx != null, (editor, b) => editor.annotations.remove(+b.dataset.annx)]
];

function insertTile(editor, path) {
  const tile = EquationGalleries.template(path);
  editor.galleries.close();
  editor.insertTemplate(tile.latex, tile.isAccent);
}

/* a symbol: its pin pins it; anywhere else puts it in */
function symbolClicked(editor, button, ev) {
  const pin = ev.target.closest('[data-pin]');
  if (pin) {
    editor.galleries.togglePin(pin.dataset.pin);
    return;
  }
  editor.galleries.close();
  editor.insertTemplate(button.dataset.symtex);
}

function galleryEquationClicked(editor, tex) {
  editor.galleries.close();
  editor.insertEquation(tex);
}

function reopenToSave(editor) {
  editor.galleries.close();
  editor.galleries.openEquations(editor.popup.querySelector('[data-mpgal]'), true);
}

/* ---- the way of typing is remembered ---- */
function readLatexPreference() {
  try {
    return localStorage.getItem(KEY + '-latex') === '1';
  } catch (x) {
    return false;
  }
}

function writeLatexPreference(latex) {
  try {
    localStorage.setItem(KEY + '-latex', latex ? '1' : '0');
  } catch (x) {}
}

/* the first line of LaTeX that KaTeX can't draw, as its message ('' when they all work) */
function latexError(latex) {
  if (!window.katex) return '';
  let error = '';
  texLines(latex).some(line => {
    try {
      katex.renderToString(texShow(line), { displayMode: true, throwOnError: true, strict: 'ignore' });
      return false;
    } catch (x) {
      error = String(x.message || x).replace(/^KaTeX parse error:\s*/, '');
      return true;
    }
  });
  return error;
}

/* ---- presses on block equations in the page ---- */
const onEquationEditorMousedown = function (e) {
  const equation = e.target.closest && e.target.closest('#ed [data-math]');
  if (equation) {
    pressOnEquation(e, equation);
    return;
  }
  const inEditorMenus = e.target.closest && e.target.closest('[class*="ML__"],.ui-menu-container,math-field');
  if (mathEd && !mathEd.contains(e.target) && !inEditorMenus) closeMathEditor();
};

/* a press on an equation: on a note's box or a coloured part, that note opens; in annotation mode, a symbol is explained;
   otherwise the equation's editor opens */
function pressOnEquation(e, equation) {
  const card = e.target.closest('.mcard');
  if (card && card.classList.contains('editing')) return; // already typing in it: the click (or drag) is the field's own
  e.preventDefault();
  const note = noteIndexAt(e.target, card);
  if (note != null) {
    editCard(equation, +note, card ? { x: e.clientX, y: e.clientY } : null);
    return;
  }
  if (mathEd && mathEd.el === equation) {
    explainClickedSymbol(e.target, equation);
    return;
  }
  openMathEditor(equation, false);
}

function noteIndexAt(target, card) {
  if (card) return card.getAttribute('data-ai');
  const part = target.closest('[class*="mann"]');
  return part ? (/mann(\d+)/.exec(part.getAttribute('class')) || [])[1] : null;
}

/* annotation mode: a click on a symbol explains it, and its box opens to type in */
function explainClickedSymbol(target, equation) {
  const symbol = target.closest('[class*="mcand"]');
  if (!symbol || !equation.__cands) return;
  const i = (/mcand(\d+)/.exec(symbol.getAttribute('class')) || [])[1];
  if (i != null && equation.__cands[+i] != null) mathEd.addNote(equation.__cands[+i]);
}

export function initEquationEditor() {
  document.addEventListener('mousedown', onEquationEditorMousedown);
}
