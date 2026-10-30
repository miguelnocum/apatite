/* ===== the bridge to the Mac app: the one place the page talks to it (and the only place that touches
   window.webkit or installs a window.nb* function). Outside the app (the web version) every message goes nowhere and
   no entry point is ever called. The app's side of this is app/Sources/Apatite/PageBridge.swift. ===== */

/* inside the Mac app (WKWebView with the "nb" handler) rather than as a web artifact */
export const NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nb);

/* ----- messages the page sends to the app (the app decodes each in PageMessage) -----
   save            {json, gen}            the whole notebook as JSON text, to write to the project's files; gen is the
                                          page load it belongs to (the app drops a save from a replaced page)
   theme           {id, dark, bg, panel, fg, muted, line, accent, heading}   the writing theme's colours, for the app's own windows
   focus           {on, bg}               focus mode turned on or off, and its background colour
   linkSyllabus    {id, view}             this notebook follows another syllabus ("" for none, "__new" for a new one)
   linkDocSyllabus {kind, id, sid}        another notebook or deck follows a syllabus (Settings > Syllabus)
   setKey          {key}                  the highlight key, edited in Settings
   revealLibrary   {}                     show the library folder in Finder
   importEssay     {}                     ask for Word or PDF files to import as essays
   openAnchor      {anchor}               a PDF citation was clicked: open that highlight in the reader
   export          {html, filename}       the notes as a web page, for the app to save to a file
   (the app also knows "editKey", open Settings at the highlight key; the page does not send it today) */
function post(message) {
  try {
    window.webkit.messageHandlers.nb.postMessage(message);
  } catch (e) {}
}

export const toApp = {
  save: (json, gen) => post({ type: 'save', json, gen }),
  theme: colours => post({ type: 'theme', ...colours }),
  focus: (on, bg) => post({ type: 'focus', on, bg }),
  linkSyllabus: (id, view) => post({ type: 'linkSyllabus', id, view }),
  linkDocSyllabus: (kind, id, sid) => post({ type: 'linkDocSyllabus', kind, id, sid }),
  setKey: key => post({ type: 'setKey', key }),
  revealLibrary: () => post({ type: 'revealLibrary' }),
  importEssay: () => post({ type: 'importEssay' }),
  openAnchor: anchor => post({ type: 'openAnchor', anchor }),
  exportHtml: (html, filename) => post({ type: 'export', html, filename })
};

/* ----- calls the app makes on the page (window.nb*, installed with fromApp) -----
   nbFlush         ()          save the open document now; returns the notebook as JSON text (closing, switching, tests)
   nbAddRef        (raw)       a source typed in the app (the PDF reader); returns {id, refs} as JSON text
   nbImportEssays  (list)      essays [{title, html}] converted from Word or PDF; queued until the page has booted
   nbOpenEssay     (id)        open that essay
   nbNewEssay      ()          a new essay
   nbShow          (view)      the Notes or Essay screen ("notes" | "essay" | "syl"); queued until the page has booted
   nbOpenSettings  (section)   the settings sheet ("" for its top, "key" for the highlight key)
   nbSetKey        (key)       the highlight key changed in the app (a list of colours)
   nbInsertQuote   (quote)     a PDF quote with its citation, at the cursor
   nbInsertNote    (note)      a PDF comment with its quote and citation, at the cursor
   nbToggleFocus   ()          View > Focus Mode */
const FROM_APP = [
  'nbFlush',
  'nbAddRef',
  'nbImportEssays',
  'nbOpenEssay',
  'nbNewEssay',
  'nbShow',
  'nbOpenSettings',
  'nbSetKey',
  'nbInsertQuote',
  'nbInsertNote',
  'nbToggleFocus'
];

/* a feature offers its function as one of the entry points above */
export function fromApp(name, handler) {
  if (!FROM_APP.includes(name)) throw new Error('not an entry point listed in core/bridge.js: ' + name);
  window[name] = handler;
}

/* the page's own call of an entry point (the web version has no app to make it) */
export function callEntry(name, ...args) {
  return window[name](...args);
}

/* ----- what the app hands over before the page's scripts run (its boot script; names are shared with
   PageBridge.swift) or leaves for the page when a call came too early -----
   __NB__ (notebook), __NBGEN__ (page load number), __HLKEY__ (highlight key), __NBLIB__ (library folder):
   read where they are used. The ones the page takes and clears are here. */
export const pending = {
  get essay() {
    return window.__nbStartEssay;
  },
  set essay(id) {
    window.__nbStartEssay = id;
  },
  get view() {
    return window.__nbStartView;
  },
  set view(view) {
    window.__nbStartView = view;
  },
  get settings() {
    return window.__nbOpenSettings;
  },
  set settings(section) {
    window.__nbOpenSettings = section;
  },
  get imports() {
    return window.__nbPendingImports;
  },
  set imports(list) {
    window.__nbPendingImports = list;
  }
};

/* the page load's number, which a save carries back */
export function pageGeneration() {
  return window.__NBGEN__ || 0;
}
