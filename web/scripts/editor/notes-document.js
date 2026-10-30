import { docHTML, setDocHTML } from '../core/save-doc.js';
import { $, openEditor, meta, setActiveEditor, toast } from '../core/helpers-and-state.js';
import { Store } from '../core/storage.js';
import { fillEmpty } from '../core/paste-cleaning.js';
import { addBanner, markCur } from '../view/page-render.js';
import { watchZoom } from '../view/zoom.js';
import { hydrateExtras } from './hydrate-and-changes.js';
import { useRefs } from '../citations/references.js';
import { hydrateCites } from '../citations/in-text-citations.js';
import { emptyLine } from './callouts.js';
import { shiftHeadings } from './folding.js';
import { convertSpecHeadings } from '../spec-points/older-spec-notes.js';

/* ===== notes document: one Word-style page; spec points tag its paragraphs (see the side panel below) ===== */
const CONVERTED_TOAST_DELAY = 300;
/* the notes as shown: empty lines that can take the caret, a last line, citations and the notes' own pieces drawn */
export function hydrate(root) {
  root = root || openEditor();
  if (!root) return;
  const selection = getSelection();
  fillEmpty(root, selection.rangeCount ? selection.anchorNode : null);
  if (!root.lastElementChild) root.appendChild(emptyLine());
  hydrateCites(root);
  hydrateExtras(root);
}

export function renderNotes() {
  useRefs('notes');
  upgradeOldNotes();
  $('main').innerHTML =
    '<div class="zwrap" id="zwrap"><div class="doc"><div id="ed" class="notes docbody" data-doc="notes" ' +
    'contenteditable="true" spellcheck="true" aria-label="Notes">' +
    (docHTML || '<p><br></p>') +
    '</div></div></div>';
  const editor = openEditor();
  hydrate(editor);
  setActiveEditor(editor);
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
      setDocHTML(shifted);
      Store.saveDoc(shifted);
    }
    Store.saveMeta();
  }
  const converted = convertSpecHeadings(docHTML);
  if (converted == null) return;
  setDocHTML(converted);
  Store.saveDoc(converted);
  setTimeout(
    () => toast('Spec points now live in the side panel; your notes under them are tagged'),
    CONVERTED_TOAST_DELAY
  );
}
