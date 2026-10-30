import { emit } from './channel.js';
import { $, openEditor, edEssayId, essays } from './helpers-and-state.js';
import { sanitize } from './paste-cleaning.js';
import { Store, setSave } from './storage.js';

/* ===== the open document, and saving it (the notes on their own, or an essay with the essays) ===== */
const SAVE_AFTER_TYPING = 900; // ms after the last change before the notes are saved
export let docHTML = null;
export function setDocHTML(value) {
  docHTML = value;
  return value;
}
let docTimer = null;

/* the open document as saved: cleaned, citations without their drawn text */
export function serializeDoc() {
  const editor = openEditor();
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
  if (!openEditor()) return;
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
  emit('essay-saved');
}

export function inDoc(id) {
  return !!docHTML && docHTML.indexOf('data-sp="' + id + '"') >= 0;
}
