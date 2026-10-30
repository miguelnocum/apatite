import { $, NATIVE, meta, post, pts, ui } from '../core/helpers-and-state.js';
import { Store, setSave, strip } from '../core/storage.js';
import { docHTML, ed, saveDocNow } from '../editor/notes-document.js';
import { essays } from '../essays/essays.js';
import { nbRefSort, nbRefs, parseOne, refs, stashRefs } from '../citations/references.js';
import { hydrateCites } from '../citations/in-text-citations.js';
import { renderWC } from '../citations/works-cited-tab.js';

/* ===== Mac app bridge: local files instead of the artifact database ===== */
const NATIVE_SAVE_DELAY = 400; // ms after the last change before the notebook is sent to the app to save
const NATIVE_SAVES = ['savePoint', 'delPoint', 'saveMeta', 'saveDoc', 'saveRefs', 'saveEssays', 'saveLocal'];
let nativeTimer = null;

function nbRef(r) {
  return { id: r.id, raw: r.raw, html: r.html || '', authors: r.authors, year: r.year };
}

/* the whole notebook, as the app saves it */
function nbState() {
  stashRefs();
  return JSON.stringify({
    meta,
    pts: pts.map(point => Object.assign(strip(point), { id: point.id })),
    doc: docHTML,
    essays: essays.map(essay => Object.assign({}, essay, { refs: (essay.refs || []).map(nbRef) })),
    refs: (nbRefs || []).map(nbRef),
    refSort: nbRefSort,
    activeRefs: refs.map(nbRef),
    view: ui.view,
    essayId: ui.essayId || null,
    savedAt: new Date().toISOString()
  });
}

function nativeSave() {
  clearTimeout(nativeTimer);
  const indicator = $('save');
  if (indicator) indicator.textContent = 'saving…';
  nativeTimer = setTimeout(() => {
    nativeTimer = null;
    post({ type: 'save', json: nbState(), gen: window.__NBGEN__ || 0 });
    setSave();
  }, NATIVE_SAVE_DELAY);
}

function useNativeStore(notebook) {
  const copies = list => (list || []).map(item => Object.assign({}, item));
  Store.mode = 'native';
  Store.init = () => Promise.resolve();
  Store.load = () => Promise.resolve({ meta: notebook.meta || null, pts: copies(notebook.pts) });
  Store.loadDoc = () => Promise.resolve(notebook.doc == null ? null : notebook.doc);
  Store.loadRefs = () => Promise.resolve({ items: copies(notebook.refs), sort: notebook.refSort || 'auto' });
  Store.loadEssays = () => Promise.resolve(copies(notebook.essays));
  NATIVE_SAVES.forEach(name => (Store[name] = () => nativeSave()));
}

/* the app asks for the notebook now (closing, switching) */
const nbFlush = () => {
  try {
    if (ed()) saveDocNow();
  } catch (e) {}
  clearTimeout(nativeTimer);
  nativeTimer = null;
  return nbState();
};

/* a source added from the app (the PDF reader) */
const nbAddRef = raw => {
  const r = parseOne(String(raw));
  refs.push(r);
  Store.saveRefs();
  if (ui.view === 'wc') renderWC();
  hydrateCites();
  return JSON.stringify({
    id: r.id,
    refs: refs.map(x => ({ id: x.id, raw: x.raw, authors: x.authors, year: x.year }))
  });
};

export function initMacBridge() {
  /* in the app, the notebook comes with the page (window.__NB__) and every save sends the whole of it back */
  if (NATIVE) useNativeStore(window.__NB__ || {});
  window.nbFlush = nbFlush;
  window.nbAddRef = nbAddRef;
}
