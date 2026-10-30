import { $, ed, edEssayId, essays, meta, setCurEd, toast } from '../core/helpers-and-state.js';
import { Store, setSave } from '../core/storage.js';
import { fillEmpty, sanitize } from '../core/paste-cleaning.js';
import { addBanner, markCur } from '../view/page-render.js';
import { watchZoom } from '../view/zoom.js';
import { hydrateExtras } from './hydrate-and-changes.js';
import { renderEssaySide } from '../essays/essays.js';
import { refs, useRefs, yearLabels } from '../citations/references.js';
import { hydrateCites } from '../citations/in-text-citations.js';
import { emptyLine } from './callouts.js';
import { shiftHeadings } from './folding.js';
import { convertSpecHeadings } from '../spec-points/older-spec-notes.js';

/* ===== notes document: one Word-style page; spec points tag its paragraphs (see the side panel below) ===== */
const SAVE_AFTER_TYPING = 900; // ms after the last change before the notes are saved
const CONVERTED_TOAST_DELAY = 300;
export let docHTML = null;
export function setDocHTML(value) {
  docHTML = value;
  return value;
}
let docTimer = null;

/* the notes as shown: empty lines that can take the caret, a last line, citations and the notes' own pieces drawn */
export function hydrate(root) {
  root = root || ed();
  if (!root) return;
  const selection = getSelection();
  fillEmpty(root, selection.rangeCount ? selection.anchorNode : null);
  if (!root.lastElementChild) root.appendChild(emptyLine());
  hydrateCites(root);
  hydrateExtras(root);
}

/* the open document as saved: cleaned, citations without their drawn text */
export function serializeDoc() {
  const editor = ed();
  if (!editor) return docHTML || '';
  const copy = editor.cloneNode(true);
  copy.querySelectorAll('.cite').forEach(citation => (citation.textContent = ''));
  return sanitize(copy.innerHTML, false);
}

export function saveDocSoon() {
  clearTimeout(docTimer);
  $('save').textContent = 'editing…';
  docTimer = setTimeout(saveDocNow, SAVE_AFTER_TYPING);
}

/* the open document saved, if it changed: an essay with the essays, the notes on their own */
export function saveDocNow() {
  clearTimeout(docTimer);
  docTimer = null;
  if (!ed()) return;
  const html = serializeDoc();
  const essayId = edEssayId();
  if (essayId) saveEssayDoc(essayId, html);
  else if (html === docHTML) setSave();
  else {
    docHTML = html;
    Store.saveDoc(html);
  }
}

function saveEssayDoc(essayId, html) {
  const essay = essays.find(x => x.id === essayId);
  if (!essay || html === essay.doc) {
    setSave();
    return;
  }
  essay.doc = html;
  essay.updated = Date.now();
  Store.saveEssays();
  renderEssaySide();
}

export function inDoc(id) {
  return !!docHTML && docHTML.indexOf('data-sp="' + id + '"') >= 0;
}

export function renderNotes() {
  useRefs('notes');
  upgradeOldNotes();
  $('main').innerHTML =
    '<div class="zwrap" id="zwrap"><div class="doc"><div id="ed" class="notes docbody" data-doc="notes" ' +
    'contenteditable="true" spellcheck="true" aria-label="Notes">' +
    (docHTML || '<p><br></p>') +
    '</div></div></div>';
  const editor = ed();
  hydrate(editor);
  setCurEd(editor);
  watchZoom();
  addBanner();
  markCur();
}

/* notes saved by older versions: headings moved up two levels (once), spec point headings made into tags */
function upgradeOldNotes() {
  if (meta.hv !== 2) {
    meta.hv = 2;
    const shifted = docHTML ? shiftHeadings(docHTML) : docHTML;
    if (shifted !== docHTML) {
      docHTML = shifted;
      Store.saveDoc(shifted);
    }
    Store.saveMeta();
  }
  const converted = convertSpecHeadings(docHTML);
  if (converted == null) return;
  docHTML = converted;
  Store.saveDoc(converted);
  setTimeout(
    () => toast('Spec points now live in the side panel; your notes under them are tagged'),
    CONVERTED_TOAST_DELAY
  );
}

/* ===== linking citations typed as plain text: Whatmore (2009), (Whatmore, 2009, p. 4) ===== */
const CITE_NAME = "(?:(?:van|von|de|da|del|der|di|du|la|le|st\\.)\\s+)?\\p{Lu}[\\p{L}'’\\-]+";
const CITE_AUTH = CITE_NAME + '(?:\\s*(?:&|and)\\s*' + CITE_NAME + '|\\s+et\\s+al\\.?)?';
const CITE_TAIL = '(\\d{4}[a-z]?|n\\.d\\.)(?:,\\s*(?:pp?\\.\\s*)?(\\d+(?:\\s*[–\\-]\\s*\\d+)?))?';
export const CITE_NAR = new RegExp('(' + CITE_AUTH + ')\\s+\\(' + CITE_TAIL + '\\)', 'gu');
export const CITE_PAR = new RegExp('\\((' + CITE_AUTH + '),?\\s+' + CITE_TAIL + '\\)', 'gu');

/* a name compared without accents, case or curly apostrophes */
function plainKey(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .trim();
}

/* which Works Cited entries fit "Whatmore & Braun" + "2009a" (fewest authors first) */
export function citeCandidates(who, year) {
  const labels = yearLabels();
  const etAl = /\set\s+al\.?$/i.test(who);
  const names = who
    .replace(/\s+et\s+al\.?$/i, '')
    .split(/\s*(?:&|\band\b)\s*/)
    .map(plainKey)
    .filter(Boolean);
  return refs
    .filter(r => yearFits(r, labels, year) && authorsFit((r.authors || []).map(plainKey), names, etAl))
    .sort((a, b) => (a.authors || []).length - (b.authors || []).length);
}

/* the year as cited (2009a), or the plain year when no letter was typed */
function yearFits(r, labels, year) {
  const typed = year.toLowerCase();
  const cited = String(labels[r.id] || r.year || '').toLowerCase();
  return cited === typed || (String(r.year || '').toLowerCase() === typed && !/[a-z]$/.test(year));
}

/* the first author's surname; then both of two, or three or more for "et al." */
function authorsFit(authors, names, etAl) {
  if (!authors.length || authors[0] !== names[0]) return false;
  if (names.length === 2) return authors.length === 2 && authors[1] === names[1];
  if (etAl) return authors.length >= 3;
  return true;
}
