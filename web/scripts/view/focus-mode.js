import { KEY } from '../core/example-data.js';
import { $, NATIVE, meta, post, toast, ui } from '../core/helpers-and-state.js';
import { measure } from '../syllabus/syllabus-view.js';
import { alignToolbar, applyZoom, keepAnchor, zoomAnchor, zoomPoint } from './zoom.js';
import { switchView } from '../app/events.js';
import { renderComments } from '../editor/comments.js';
import { curEssay, isDocView } from '../essays/essays.js';
import { queueBand } from '../editor/selection-band.js';

let focusPosted = null; // what the Mac app was last told
const FOCUS_TITLE_AFTER = 24; // px scrolled before the title shows at the top

function savedFocus() {
  try {
    return localStorage.getItem(KEY + '-focus') === '1';
  } catch (e) {
    return false;
  }
}

/* focus mode is on and showing */
export function inFocus() {
  return ui.focus && isDocView();
}

/* on or off (turned on from the syllabus, it goes to the notes) */
function setFocus(on) {
  ui.focus = !!on;
  try {
    localStorage.setItem(KEY + '-focus', ui.focus ? '1' : '0');
  } catch (e) {}
  if (ui.focus && !isDocView()) switchView('notes');
  else {
    applyFocus();
    renderComments(true); // (a column beside the page, or a drawer over it)
  }
  toast(ui.focus ? 'Focus mode: ⇧⌘F to bring everything back' : 'Focus mode off');
}

export function toggleFocus() {
  setFocus(!ui.focus);
}

/* the page laid out for it (after every render), and the Mac app told, so its window can follow */
export function applyFocus() {
  const on = inFocus();
  const root = document.documentElement;
  root.classList.toggle('focus', on);
  if (!on) root.style.removeProperty('--fz');
  showFocusTitle();
  const button = $('tb-focus');
  if (button) button.setAttribute('aria-pressed', on ? 'true' : 'false');
  measure();
  if (isDocView()) applyZoom();
  alignToolbar(); // (centred in the window: the nudge that puts it over the page beside the panes comes off)
  postFocus();
}

/* the Mac app told whether focus mode is on, and the page's colour (its title bar takes it, so the page runs up under
   it with no seam); again when the theme changes */
export function postFocus() {
  if (!NATIVE) return;
  const on = inFocus();
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (focusPosted === on + bg) return;
  focusPosted = on + bg;
  post({ type: 'focus', on: on, bg: bg });
}

/* ---- zoom in focus mode is the text's own size, as in Bear (not a scaled picture of the page): the page is laid out
   by its style alone, so the text rewraps as the window is resized with no work here, and stays sharp ---- */
const FOCUS_ZOOMS = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2];
const FOCUS_WHEEL_STEP = 60; // px of ctrl-scrolling (or pinching, as a wheel) per step
let focusWheelSum = 0;

function savedFocusZoom() {
  try {
    const zoom = +localStorage.getItem(KEY + '-fzoom');
    return FOCUS_ZOOMS.includes(zoom) ? zoom : 1;
  } catch (e) {
    return 1;
  }
}

/* the page's own layout, and the text at the zoom (the page zoom's sizes and scale taken off) */
export function applyFocusZoom(page, wrap) {
  ['transform', 'width', 'padding'].forEach(name => {
    if (page.style[name]) page.style[name] = '';
  });
  if (wrap.style.width) wrap.style.width = '';
  if (wrap.style.height) wrap.style.height = '';
  document.documentElement.style.setProperty('--fz', String(ui.fzoom));
  $('zlab').textContent = Math.round(ui.fzoom * 100) + '%';
}

/* the nearest step to a zoom, keeping your place (the caret, or what's under the pointer, stays where it is) */
export function setFocusZoom(zoom, point) {
  const next = nearestFocusZoom(zoom === 'fit' ? 1 : zoom);
  if (next === ui.fzoom) return;
  const anchor = zoomAnchor(point || zoomPoint());
  ui.fzoom = next;
  try {
    localStorage.setItem(KEY + '-fzoom', String(next));
  } catch (e) {}
  const root = document.documentElement;
  const behavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  applyZoom();
  if (anchor) keepAnchor(anchor);
  root.style.scrollBehavior = behavior;
  queueBand();
}

function nearestFocusZoom(zoom) {
  return FOCUS_ZOOMS.reduce((best, step) => (Math.abs(step - zoom) < Math.abs(best - zoom) ? step : best));
}

export function stepFocusZoom(direction) {
  const at = FOCUS_ZOOMS.indexOf(ui.fzoom);
  setFocusZoom(FOCUS_ZOOMS[Math.max(0, Math.min(FOCUS_ZOOMS.length - 1, at + direction))]);
}

/* ctrl-scrolling (a pinch, in some browsers) steps the zoom, rather than laying the notes out again at every tick */
export function focusWheel(e) {
  focusWheelSum += e.deltaY;
  if (Math.abs(focusWheelSum) < FOCUS_WHEEL_STEP) return;
  stepFocusZoom(focusWheelSum < 0 ? 1 : -1);
  focusWheelSum = 0;
}

/* ---- the top: the traffic lights float over the page (in the Mac app); once it's scrolled, the text fades out under
   a strip with the note's title, as in Bear ---- */
function showFocusTitle() {
  const title = $('focustitle');
  if (!title) return;
  const essay = ui.view === 'essay' && curEssay();
  title.textContent = essay ? essay.title || 'Untitled essay' : meta.title || '';
}

const onFocusModeWindowScroll = () => {
  const root = document.documentElement;
  const scrolled = scrollY > FOCUS_TITLE_AFTER;
  if (root.classList.contains('scrolled') !== scrolled) root.classList.toggle('scrolled', scrolled);
};

const onFocusModeKeydown = e => {
  if (!(e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'f')) return;
  e.preventDefault();
  toggleFocus();
};

export function initFocusMode() {
  /* ===== focus mode, as in Bear: just the notes (or essay) and the formatting bar, for writing in a small window beside
   others. The title row, panes and page edges go, the page fills the window and rewraps as it narrows, and the bar
   floats at the bottom. It only applies to the notes and essays, and is remembered. ⇧⌘F, or the bar's last button ===== */
  ui.focus = savedFocus();
  if (NATIVE) document.documentElement.classList.add('native');
  ui.fzoom = savedFocusZoom();
  window.addEventListener('scroll', onFocusModeWindowScroll, { passive: true });
  document.addEventListener('keydown', onFocusModeKeydown);
  /* the Mac app's View menu */
  window.nbToggleFocus = toggleFocus;
}
