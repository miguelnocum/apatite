/* ===== helpers ===== */
/* inside the Mac app (WKWebView with the "nb" handler) rather than as a web artifact */
const NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nb);
const TOAST_FOR = 2400; // ms a message stays up
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
let toastTimer = null;

/* a message to the Mac app */
function post(message) {
  try {
    window.webkit.messageHandlers.nb.postMessage(message);
  } catch (e) {}
}

function $(id) {
  return document.getElementById(id);
}

function esc(text) {
  return String(text == null ? '' : text).replace(/[&<>"]/g, c => HTML_ESCAPES[c]);
}

function uid() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function toast(message) {
  const box = $('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), TOAST_FOR);
}

/* ===== state ===== */
let meta = { title: 'My notebook' };
let pts = [];
const ui = {
  view: 'syl',
  status: null,
  type: null,
  q: '',
  confirm: null,
  scroll: {},
  back: null,
  draft: null,
  auto: true,
  mode: 'add',
  secStyle: '', // how a pasted syllabus numbers its section titles ("1", "Topic 1"); empty: detected automatically
  ptStyle: '' // and its points ("1a", "1.1")
};
let curEd = null;
