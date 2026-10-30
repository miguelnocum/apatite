import { ed, ui } from '../core/helpers-and-state.js';
import { Store } from '../core/storage.js';
import { mk } from '../core/paste-cleaning.js';
import { flash, render } from '../view/page-render.js';
import { saveDocSoon } from '../editor/notes-document.js';
import { edChanged } from '../editor/hydrate-and-changes.js';
import { isDocView } from '../essays/essays.js';
import { parseOne, refById, refs } from '../citations/references.js';
import { hydrateCites } from '../citations/in-text-citations.js';
import { selectRange } from '../writing/writing.js';
import { emptyLine } from '../editor/callouts.js';

/* ===== quotes and comments from the PDF reader, put in the notes or the open essay ===== */

/* Notes (or the open essay) showing, the PDF's source in this document's list, and the selection where the caret last
   was (else at the end); returns the range to put the quote in, or null without an editor */
function pdfInsertRange(o) {
  if (!isDocView()) {
    ui.view = 'notes';
    render();
  }
  const editor = ed();
  if (!editor) return null;
  addPdfSource(o);
  const range =
    ui.lastRange && editor.contains(ui.lastRange.startContainer) ? ui.lastRange.cloneRange() : endOfNotes(editor);
  editor.focus({ preventScroll: true });
  selectRange(range);
  if (!range.collapsed) range.deleteContents();
  return range;
}

/* a PDF's source that this document's list doesn't have yet comes along with the quote */
function addPdfSource(o) {
  if (!(o.refId && !refById(o.refId) && o.refRaw)) return;
  const source = parseOne(String(o.refRaw));
  source.id = o.refId;
  refs.push(source);
  Store.saveRefs();
}

/* the end of the last line (a new one, if the last block is a reference) */
function endOfNotes(editor) {
  let last = editor.lastElementChild;
  if (!last || last.classList.contains('ref')) {
    last = emptyLine();
    editor.appendChild(last);
  }
  const range = document.createRange();
  range.selectNodeContents(last);
  range.collapse(false);
  return range;
}

/* the caret just inside a text node after what was put in; drawn and saved */
function afterPdfInsert(after) {
  const range = document.createRange();
  range.setStart(after, 1);
  range.collapse(true);
  selectRange(range);
  ui.lastRange = range.cloneRange();
  hydrateCites();
  saveDocSoon();
}

function pdfCitation(o, withAnchor) {
  const citation = mk('span');
  citation.setAttribute('data-cite', o.refId);
  if (o.pg) citation.setAttribute('data-pg', o.pg);
  if (withAnchor && o.anchor) citation.setAttribute('data-anchor', o.anchor);
  return citation;
}

/* a quote from the PDF reader: "text" (Author, Year, p. N) at the cursor in Notes or the open essay */
const nbInsertQuote = o => {
  const range = pdfInsertRange(o);
  if (!range) return false;
  const start = range.startContainer;
  const before = start.nodeType === 3 ? start.nodeValue.slice(0, range.startOffset) : '';
  const text = String(o.text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const citation = pdfCitation(o, true);
  range.insertNode(citation);
  range.insertNode(document.createTextNode(lead + '“' + text + '” ')); // (before the citation)
  const after = document.createTextNode('\u00a0');
  citation.after(after);
  afterPdfInsert(after);
  citation.scrollIntoView({ block: 'center' });
  flash(citation);
  return true;
};

/* a comment from a PDF: “quote” (Author, Year, p. N) — the comment; or the comment and its citation */
const nbInsertNote = o => {
  const range = pdfInsertRange(o);
  if (!range) return false;
  const citation = o.refId ? pdfCitation(o, false) : null;
  const pieces = pdfNotePieces(
    String(o.quote || '')
      .replace(/\s+/g, ' ')
      .trim(),
    String(o.text || '').trim(),
    citation
  );
  const after = document.createTextNode(' ');
  const fragment = document.createDocumentFragment();
  fragment.append(...pieces, after);
  range.insertNode(fragment);
  afterPdfInsert(after);
  if (typeof edChanged === 'function') edChanged();
  if (citation) citation.scrollIntoView({ block: 'center' });
  return true;
};

function pdfNotePieces(quote, note, citation) {
  const text = words => document.createTextNode(words);
  if (!quote) return [text(note + ' '), ...(citation ? [citation] : [])];
  return [
    text('“' + quote + '”' + (citation ? ' ' : '')),
    ...(citation ? [citation] : []),
    ...(note ? [text(' — ' + note)] : [])
  ];
}

export function initPdfQuotes() {
  window.nbInsertQuote = nbInsertQuote;
  window.nbInsertNote = nbInsertNote;
}
