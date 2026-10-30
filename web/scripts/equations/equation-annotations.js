import { saveDocSoon } from '../core/save-doc.js';
import { openEditor, toast } from '../core/helpers-and-state.js';
import { texInline } from './equation-tex.js';
import { ANN_COLORS, annColor, annList, annNoteHTML, annSave, renderMath } from './equation-drawing.js';
import { editCard } from './equation-note-editing.js';

/* ===== the equation editor, part 6: annotation mode — symbols in the equation can be clicked, and their notes are listed
   in the editor ===== */
export class AnnotationPanel {
  constructor(editor) {
    this.editor = editor;
    this.popup = editor.popup;
    this.el = editor.el;
    this.list = this.popup.querySelector('.mp-list');
    this.popup.addEventListener('mousedown', ev => {
      const note = ev.target.closest('[data-annedit]');
      if (!note) return;
      ev.preventDefault();
      editCard(this.el, +note.dataset.annedit);
    });
  }

  notes() {
    return annList(this.el);
  }

  isOn() {
    return this.popup.classList.contains('annot');
  }

  setOn(on) {
    this.popup.classList.toggle('annot', on);
    this.el.classList.toggle('annot', on);
    this.popup.querySelector('[data-mpann]').classList.toggle('on', on);
    renderMath(this.el.parentNode || openEditor());
    this.draw();
    this.editor.place();
  }

  /* the list of explained parts; focus is the index of a note to open for typing */
  draw(focus) {
    this.list.innerHTML = this.notes()
      .map((note, i) => this.noteHTML(note, i))
      .join('');
    this.editor.place();
    if (focus != null) this.focusNote(focus);
  }

  noteHTML(note, i) {
    const text = note.n ? annNoteHTML(note.n) : 'Write in its box';
    return (
      `<div class="mp-a" data-ai="${i}" style="--ac:${annColor(note)}">` +
      `<button type="button" class="mp-sw" data-annc="${i}" title="Another colour"></button>` +
      `<span class="mp-at">${texInline(note.t)}</span>` +
      `<span class="mp-an${note.n ? '' : ' none'}" data-annedit="${i}" title="Write in its box">${text}</span>` +
      `<button type="button" class="x" data-annx="${i}" title="Stop explaining this">×</button></div>`
    );
  }

  focusNote(i) {
    editCard(this.el, i);
  }

  saved(list) {
    annSave(this.el, list);
    renderMath(this.el.parentNode || openEditor());
    saveDocSoon();
  }

  /* explains a part (its LaTeX): a new note in the first colour not yet used, or the one it already has */
  add(tex) {
    tex = String(tex || '').trim();
    if (!tex) return;
    const list = this.notes();
    let i = list.findIndex(note => note.t === tex);
    if (i < 0) {
      list.push({ t: tex, c: this.unusedColour(list), n: '' });
      i = list.length - 1;
      this.saved(list);
    }
    if (!this.isOn()) this.setOn(true);
    this.draw(i);
  }

  unusedColour(list) {
    const used = list.map(note => (+note.c || 0) % ANN_COLORS.length);
    let colour = 0;
    while (used.includes(colour) && colour < ANN_COLORS.length - 1) colour++;
    return used.includes(colour) ? list.length : colour;
  }

  nextColour(i) {
    const list = this.notes();
    const note = list[i];
    if (!note) return;
    note.c = ((+note.c || 0) + 1) % ANN_COLORS.length;
    this.saved(list);
    this.draw();
  }

  remove(i) {
    const list = this.notes();
    list.splice(i, 1);
    this.saved(list);
    this.draw();
  }

  /* "Explain selection": what's selected in the boxes (or the LaTeX) */
  explainSelection() {
    const tex = (this.editor.selectedLatex() || '').trim();
    if (!tex) {
      toast('Select part of the equation first, or click a symbol in it');
      return;
    }
    this.add(tex);
  }
}
