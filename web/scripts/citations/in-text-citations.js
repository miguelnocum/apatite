import { ed, esc, NATIVE, post, toast, ui } from '../core/helpers-and-state.js';
import { mk } from '../core/paste-cleaning.js';
import { saveDocSoon } from '../editor/notes-document.js';
import { citationIds } from './citation-check.js';
import { namePart, refById, yearLabels } from './references.js';
import { openSources } from './sources-pane.js';
import { caretAnchors, lockedFirst } from '../editor/caret-and-keys.js';

/* ===== Harvard in-text citations: drawn from their references, put in where the caret is ===== */
export function citeWithPg(ids, page, labels, form) {
  const text = citeText(ids, labels, form);
  if (!text || !page || ids.length !== 1) return text;
  return text.slice(0, -1) + ', ' + (/[–-]/.test(page) ? 'pp. ' : 'p. ') + page + ')';
}

/* (Smith, 2020; Jones & Brown, 2019), or narrative (the author is part of the sentence): Smith (2020) */
export function citeText(ids, labels, form) {
  labels = labels || yearLabels();
  if (form === 'n' && ids.length === 1) {
    const r = refById(ids[0]);
    return r ? namePart(r) + ' (' + labels[r.id] + ')' : null;
  }
  const parts = ids.map(id => {
    const r = refById(id);
    return r ? namePart(r) + ', ' + labels[r.id] : null;
  });
  if (parts.includes(null)) return null;
  return '(' + parts.join('; ') + ')';
}

/* every citation's text, from its references (or a placeholder, or a note that its source is gone) */
export function hydrateCites(root) {
  root = root || ed();
  if (!root) return;
  const labels = yearLabels();
  root.querySelectorAll('span[data-cite]').forEach(citation => hydrateCitation(citation, labels));
  citePgChips(root);
}

function hydrateCitation(citation, labels) {
  citation.setAttribute('contenteditable', 'false');
  citation.className = 'cite';
  const ids = citationIds(citation);
  const form = citation.getAttribute('data-form');
  const text = ids.length ? citeWithPg(ids, citation.getAttribute('data-pg'), labels, form) : null;
  if (!ids.length) markCitation(citation, 'ph', '(x, x)', 'Choose the source for this citation');
  else if (text === null)
    markCitation(citation, 'missing', '(missing source)', 'This source was removed from your Works Cited');
  else {
    citation.textContent = text;
    if (citation.getAttribute('data-anchor')) {
      citation.classList.add('pdf');
      citation.title = 'Open this quote in the PDF (Option-click to change source)';
    } else citation.title = 'Change source';
    citation.classList.toggle('nar', form === 'n' && ids.length === 1);
    if (ui.citeTarget === citation) citation.classList.add('sel');
  }
}

function markCitation(citation, kind, text, title) {
  citation.classList.add(kind);
  citation.textContent = text;
  citation.title = title;
}

/* a citation at the caret (or where the caret last was in the notes), a space before it if it follows a word */
export function insertCitation(ids) {
  const editor = ed();
  if (!editor || !caretInEditor(editor)) return null;
  const selection = getSelection();
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const start = range.startContainer;
  const before = start.nodeType === 3 ? start.nodeValue.slice(0, range.startOffset) : '';
  const citation = mk('span');
  citation.setAttribute('data-cite', (ids || []).join(','));
  if (before && !/\s$/.test(before)) insertBefore(range, document.createTextNode(' '));
  insertBefore(range, citation);
  selection.removeAllRanges();
  selection.addRange(range);
  ui.lastRange = range.cloneRange();
  hydrateCites();
  saveDocSoon();
  return citation;
}

/* the node goes in at the range, which then follows it */
function insertBefore(range, node) {
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
}

function caretInEditor(editor) {
  const selection = getSelection();
  if (selection.rangeCount && editor.contains(selection.anchorNode)) return true;
  if (!(ui.lastRange && editor.contains(ui.lastRange.startContainer))) {
    toast('Click in your notes where the citation should go');
    return false;
  }
  editor.focus({ preventScroll: true });
  selection.removeAllRanges();
  selection.addRange(ui.lastRange);
  return true;
}

/* citations read as text; only the page number is a box you click (to open the quote in the PDF) */
function citePgChips(root) {
  (root || ed()).querySelectorAll('span[data-cite].cite').forEach(pageChip);
  caretAnchors(root);
}

function pageChip(citation) {
  const page = citation.getAttribute('data-pg');
  citation.classList.toggle('haspg', false);
  if (!page || citation.classList.contains('missing') || citation.classList.contains('ph')) return;
  const parts = /^(.*?)(pp?\. [^)]*)(\)?)$/.exec(citation.textContent);
  if (!parts) return;
  const title = citation.getAttribute('data-anchor') ? 'Open this quote in the PDF' : 'Page';
  citation.innerHTML = `${esc(parts[1])}<span class="cpg" title="${title}">${esc(parts[2])}</span>${esc(parts[3])}`;
  citation.classList.add('haspg');
  citation.title = 'Option-click to change the source';
}

/* clicking a citation's words, or just left of one that starts a line, puts the caret beside it like ordinary text */
function caretBeside(el, after) {
  caretAnchors(el.parentNode);
  const text = after ? el.nextSibling : el.previousSibling;
  if (!text || text.nodeType !== 3) return;
  const range = document.createRange();
  range.setStart(text, after ? 0 : text.nodeValue.length);
  range.collapse(true);
  const selection = getSelection();
  ed().focus({ preventScroll: true });
  selection.removeAllRanges();
  selection.addRange(range);
}

const LINE_BLOCKS = '#ed > p, #ed > h1, #ed > h2, #ed > h3, #ed > h4, #ed > h5, #ed > h6, #ed li';
const TOP_LINES = ':scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6';
const BESIDE_FIRST_SLACK = 2; // px right of a line's first citation's left edge that still counts as left of it

const onInTextCitationsMousedown = e => {
  if (e.button !== 0 || e.altKey) return;
  const citation = e.target.closest && e.target.closest('#ed .cite');
  if (citation) clickOnCitation(e, citation);
  else clickBeforeFirstCitation(e);
};

function clickOnCitation(e, citation) {
  // the page box (and empty or broken citations) keep their own click
  if (e.target.closest('.cpg') || citation.classList.contains('ph') || citation.classList.contains('missing')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const box = citation.getBoundingClientRect();
  caretBeside(citation, e.clientX > box.left + box.width / 2);
}

/* a click left of a line that starts with a citation (or footnote): the caret before it */
function clickBeforeFirstCitation(e) {
  const line = (e.target.closest && e.target.closest(LINE_BLOCKS)) || marginLine(e);
  if (!line || !(e.target === line || !line.contains(e.target)) || !lockedFirst(line)) return;
  const first = line.querySelector('[data-cite],[data-fn]');
  if (first && e.clientX <= first.getBoundingClientRect().left + BESIDE_FIRST_SLACK) {
    e.preventDefault();
    caretBeside(first, false);
  }
}

/* a click in the page's margin, level with a line: that line */
function marginLine(e) {
  const editor = ed();
  const inMargin =
    editor &&
    e.target.closest &&
    e.target.closest('.doc') &&
    !e.target.closest('#ed > *') &&
    !e.target.closest('button,.foldlayer,#splayer,.spbr,.sph');
  if (!inMargin) return null;
  const line = [...editor.querySelectorAll(TOP_LINES)].find(block => {
    const box = block.getBoundingClientRect();
    return e.clientY >= box.top && e.clientY <= box.bottom;
  });
  return line && e.clientX <= line.getBoundingClientRect().left ? line : null;
}

/* Option-click on a citation (or a click on its page box, or on an empty or broken one): choose its sources;
   in the app, a click on a quote from a PDF opens it there */
const onInTextCitationsMousedown2 = e => {
  if (e.button !== 0) return;
  const citation = e.target.closest && e.target.closest('#ed .cite');
  if (!citation) return;
  e.preventDefault();
  if (NATIVE && citation.getAttribute('data-anchor') && !e.altKey) {
    post({ type: 'openAnchor', anchor: citation.getAttribute('data-anchor') });
    return;
  }
  openSources(citation);
};

export function initInTextCitations() {
  document.addEventListener('mousedown', onInTextCitationsMousedown, true);
  document.addEventListener('mousedown', onInTextCitationsMousedown2, true);
}
