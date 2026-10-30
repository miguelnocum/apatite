/* ===== helpers ===== */
/* inside the Mac app (WKWebView with the "nb" handler) rather than as a web artifact */
export const NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nb);
const TOAST_FOR = 2400; // ms a message stays up
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
let toastTimer = null;

/* a message to the Mac app */
export function post(message) {
  try {
    window.webkit.messageHandlers.nb.postMessage(message);
  } catch (e) {}
}

export function $(id) {
  return document.getElementById(id);
}

/* the open notes or essay's editor (null when none is open) */
export function ed() {
  return document.getElementById('ed');
}

export function esc(text) {
  return String(text == null ? '' : text).replace(/[&<>"]/g, c => HTML_ESCAPES[c]);
}

export function uid() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function toast(message) {
  const box = $('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), TOAST_FOR);
}

/* ===== state ===== */
export let meta = { title: 'My notebook' };
export function setMeta(value) {
  meta = value;
  return value;
}
export let pts = [];
export function setPts(value) {
  pts = value;
  return value;
}
export function ptById(id) {
  return pts.find(point => point.id === id);
}
export const ui = {
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
export let curEd = null;
export function setCurEd(value) {
  curEd = value;
  return value;
}
/* the essays (free writing on the same page, no syllabus) */
export let essays = [];
export function setEssays(value) {
  essays = value;
  return value;
}

/* which document the open editor holds; saving follows the editor, not the tab */
export function edEssayId() {
  const editor = ed();
  return editor && editor.getAttribute('data-doc') === 'essay' ? editor.getAttribute('data-essay') : null;
}

export function isDocView() {
  return ui.view === 'notes' || ui.view === 'essay';
}

export function curEssay() {
  return essays.find(essay => essay.id === ui.essayId) || null;
}
