import { texLines, texTidy } from './equation-tex.js';
import { EMPTY_BOX_CHAR, EQ_BOXES } from './math-field-look.js';
import { enhanceMathField } from './math-field-selection.js';

/* ===== the equation editor, part 4: the lines of the equation, each a typing box on the whiteboard ===== */

/* typing argmin gives argmin, not "arg min" (MathLive only takes this once the box is on the page) */
const EXTRA_SHORTCUTS = { argmin: '\\operatorname*{argmin}_{#?}', argmax: '\\operatorname*{argmax}_{#?}' };

/* puts the caret in a typing box, at its 'start' or 'end' */
export function focusFieldAt(field, where) {
  field.focus();
  try {
    field.executeCommand(where === 'start' ? 'moveToMathfieldStart' : 'moveToMathfieldEnd');
  } catch (x) {}
}

export class EquationLines {
  constructor(editor) {
    this.editor = editor;
    this.box = editor.popup.querySelector('.mp-fields');
    this.fields = [];
    this.lastField = null;
    this.box.addEventListener('mousedown', ev => this.onWhiteboardPress(ev));
    /* keys are caught around the boxes, before MathLive's own handling (which would let Tab leave the box) */
    this.box.addEventListener('keydown', ev => this.onKeyDown(ev), true);
  }

  /* the boxes again, from the LaTeX (one per line; an inline equation is one line) */
  build() {
    if (!EQ_BOXES) return;
    this.box.innerHTML = '';
    const latex = this.editor.input.value;
    let lines = this.editor.inline ? [latex.replace(/\n/g, ' ')] : texLines(latex);
    if (!lines.length) lines = [''];
    this.fields = lines.map(line => this.makeField(line));
    this.fields.forEach(field => this.box.appendChild(field));
    this.lastField = this.fields[this.fields.length - 1];
  }

  /* the box being typed in (or the last one) */
  active() {
    return this.lastField && this.fields.includes(this.lastField)
      ? this.lastField
      : this.fields[this.fields.length - 1];
  }

  /* the LaTeX, from the boxes */
  toLatex() {
    return texTidy(this.fields.map(field => field.value).join('\n')).replace(/\n+$/, '');
  }

  changed() {
    this.editor.input.value = this.toLatex();
    this.editor.draw();
  }

  makeField(latex) {
    const field = document.createElement('math-field');
    field.mathVirtualKeyboardPolicy = 'manual';
    try {
      field.placeholderSymbol = EMPTY_BOX_CHAR;
    } catch (x) {}
    enhanceMathField(field);
    try {
      field.menuItems = [];
    } catch (x) {}
    this.addShortcuts(field);
    field.value = texTidy(latex);
    field.addEventListener('input', () => this.changed());
    field.addEventListener('focusin', () => {
      this.lastField = field;
      this.editor.typingLatex = false;
    });
    field.addEventListener('move-out', ev => this.onMoveOut(field, ev));
    return field;
  }

  addShortcuts(field) {
    const add = () => {
      try {
        if (field.inlineShortcuts.argmin.indexOf('{argmin}') < 0)
          field.inlineShortcuts = Object.assign({}, field.inlineShortcuts, EXTRA_SHORTCUTS);
      } catch (x) {}
    };
    field.addEventListener('mount', add);
    field.addEventListener('focusin', add);
  }

  /* a press on the whiteboard itself (not in a box): the nearest line, at its start or end */
  onWhiteboardPress(ev) {
    if (ev.target !== ev.currentTarget || !this.fields.length) return;
    ev.preventDefault();
    const field = this.nearestLine(ev.clientY);
    const box = field.getBoundingClientRect();
    focusFieldAt(field, ev.clientX < box.left + box.width / 2 ? 'start' : 'end');
  }

  nearestLine(y) {
    let nearest = this.fields[this.fields.length - 1];
    let nearestDistance = Infinity;
    this.fields.forEach(field => {
      const box = field.getBoundingClientRect();
      const distance = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
      if (distance < nearestDistance) [nearestDistance, nearest] = [distance, field];
    });
    return nearest;
  }

  onKeyDown(ev) {
    const field = ev.target && ev.target.closest && ev.target.closest('math-field');
    if (!field || ev.isComposing) return;
    const action = this.keyAction(ev, field);
    if (!action) return;
    ev.preventDefault();
    ev.stopPropagation();
    action();
  }

  /* what a key does in a line, if it's one handled here */
  keyAction(ev, field) {
    const command = ev.metaKey || ev.ctrlKey;
    if (ev.key === 'Escape' || (ev.key === 'Enter' && (command || this.editor.inline)))
      return () => this.editor.finish();
    if (ev.key === 'Enter' && !ev.shiftKey) return () => this.newLineAfter(field);
    if (ev.key === 'Tab' && !command && !ev.altKey) return () => this.tab(field, ev.shiftKey);
    if (ev.key === 'Backspace' && !field.value && this.fields.length > 1) return () => this.removeLine(field);
    return null;
  }

  newLineAfter(field) {
    const line = this.makeField('');
    this.fields.splice(this.fields.indexOf(field) + 1, 0, line);
    field.after(line);
    line.focus();
    this.changed();
  }

  /* Tab: the next box to fill in; with none left, out of the fraction (or whatever it's in) and on along the line
     (MathLive's own "next box" leaves the field when there is none, so it's only asked when there is one) */
  tab(field, backwards) {
    const before = field.position;
    if (/\\placeholder/.test(field.value))
      this.command(field, backwards ? 'moveToPreviousPlaceholder' : 'moveToNextPlaceholder');
    if (field.position === before) this.command(field, backwards ? 'moveBeforeParent' : 'moveAfterParent');
    if (document.activeElement !== field) field.focus();
  }

  command(field, name) {
    try {
      field.executeCommand(name);
    } catch (x) {}
  }

  /* Backspace in an empty line: the line goes, and the caret ends the line before */
  removeLine(field) {
    const i = this.fields.indexOf(field);
    this.fields.splice(i, 1);
    field.remove();
    focusFieldAt(this.fields[Math.max(0, i - 1)], 'end');
    this.changed();
  }

  /* arrowing off the top or bottom of a line goes to the line above or below */
  onMoveOut(field, ev) {
    const direction = ev.detail && ev.detail.direction;
    const back = direction === 'upward' || direction === 'backward';
    const on = direction === 'downward' || direction === 'forward';
    const i = this.fields.indexOf(field);
    const to = back ? this.fields[i - 1] : on ? this.fields[i + 1] : null;
    if (!to) return;
    ev.preventDefault();
    focusFieldAt(to, back ? 'end' : 'start');
  }
}
