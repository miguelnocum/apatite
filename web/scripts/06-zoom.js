/* ===== page zoom: the page is scaled, the wrapper takes the scaled size so scrolling stays right ===== */
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const ZMIN = 0.25;
const ZMAX = 3;
const PAGE_WIDTH = 816; // px: a letter-size page at 96 dpi
const LEFT_PANE = 270; // px the side panel takes…
const LEFT_PANE_CLOSED = 40; // …and when it's closed
const SOURCES_PANE = 340;
const COMMENTS_PANE = 290;
const PANE_GAP = 22;
const NARROWED_PAGE_MIN = 300; // px a page narrowed by zooming is at least
const NARROWED_PAD_MIN = 56; // its side padding: between these…
const NARROWED_PAD_MAX = 96;
const NARROWED_PAD_SHARE = 0.11; // …and otherwise this share of its width
const NARROWED_PAD_TOP_EXTRA = 16; // px more padding at the top than the sides
const TOOLBAR_EDGE = 12; // px the toolbar keeps from the window's sides
const RELAYOUT_AFTER = 260; // ms: the panes' slide
const ZOOM_EPSILON = 0.001;
const DEFAULT_HEADER_HEIGHT = 150; // px, before the header has been measured
let zoomRO = null;
let tbShift = 0;
let relayoutTimer = null;
let pinchFrom = 1;

ui.zoom = savedZoom();

/* the zoom to start at: one chosen in Settings, else the last used (Fit, the first time) */
function savedZoom() {
  const clamp = value => Math.min(ZMAX, Math.max(ZMIN, +value) || 1);
  try {
    const start = localStorage.getItem(KEY + '-zoomstart');
    if (start) return start === 'fit' ? 'fit' : clamp(start);
    const last = localStorage.getItem(KEY + '-zoom');
    return last === 'fit' || !last ? 'fit' : clamp(last);
  } catch (e) {
    return 'fit';
  }
}

/* the height of the header over the page (measured into --hh) */
function headerHeight() {
  return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hh')) || DEFAULT_HEADER_HEIGHT;
}

/* the width inside the writing area's padding */
function writingRoom() {
  const main = $('main');
  const style = getComputedStyle(main);
  return main.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
}

function zoomedPage() {
  const wrap = $('zwrap');
  return wrap && wrap.firstElementChild;
}

function pageZoom() {
  if (ui.zoom !== 'fit') return ui.zoom;
  if (inFocus()) return 1; // (the page fills the window already)
  const page = zoomedPage();
  if (!page) return 1;
  return Math.max(ZMIN, Math.min(1, writingRoom() / page.offsetWidth));
}

/* would the page, at this zoom, be wider than the room the open panes leave it? (worked out from the layout's columns,
   so it's the same answer whether or not they're folded at the moment) */
function zoomFold(zoom) {
  const wrap = $('bodywrap');
  if (getPref('zfold') === '0' || ui.zoom === 'fit' || !wrap.classList.contains('notesview') || isNarrow() || inFocus())
    return false;
  const right = wrap.classList.contains('withrefs')
    ? SOURCES_PANE
    : wrap.classList.contains('withcmts')
      ? COMMENTS_PANE
      : 0;
  const left = wrap.classList.contains('nosd') ? LEFT_PANE_CLOSED : LEFT_PANE;
  if (left === LEFT_PANE_CLOSED && !right) return false; // nothing open to fold
  const room = wrap.clientWidth - left - PANE_GAP - (right ? right + PANE_GAP : 0);
  return PAGE_WIDTH * zoom > room + 1;
}

function setPaneFold(on) {
  const wrap = $('bodywrap');
  if (wrap.classList.contains('zfold') === on) return;
  /* straight to the new layout (no slide), so the page can be measured and your place kept */
  wrap.style.transition = 'none';
  wrap.classList.toggle('zfold', on);
  void wrap.offsetWidth;
  requestAnimationFrame(() => (wrap.style.transition = ''));
  renderSide();
  markCur();
  if (!on) setTimeout(() => renderComments(true), 0);
}

function applyZoom() {
  if (isDocView()) foldForZoom();
  const zoom = pageZoom();
  const wrap = $('zwrap');
  const page = zoomedPage();
  if (inFocus()) {
    if (page) applyFocusZoom(page, wrap);
    alignToolbar();
    return;
  }
  $('zlab').textContent = Math.round(zoom * 100) + '%';
  if (!page) return;
  narrowPage(page, zoom);
  page.style.transform = zoom === 1 ? '' : 'scale(' + zoom + ')';
  wrap.style.width = page.offsetWidth * zoom + 'px';
  wrap.style.height = page.offsetHeight * zoom + 'px';
  alignToolbar();
}

/* the panes fold away while the page at its zoom needs the room (unless they were brought back) */
function foldForZoom() {
  const need = zoomFold(pageZoom());
  if (!need) ui.zfoldOff = false;
  setPaneFold(need && !ui.zfoldOff);
}

/* zoomed past the width of the window: the page narrows so the bigger text rewraps instead of running off the edges */
function narrowPage(page, zoom) {
  const room = writingRoom();
  let width = '';
  let padding = '';
  if (ui.zoom !== 'fit' && room > 0 && PAGE_WIDTH * zoom > room) {
    const narrowed = Math.max(NARROWED_PAGE_MIN, Math.floor(room / zoom));
    const side = Math.round(Math.max(NARROWED_PAD_MIN, Math.min(NARROWED_PAD_MAX, narrowed * NARROWED_PAD_SHARE)));
    width = narrowed + 'px';
    padding = Math.min(NARROWED_PAD_MAX, side + NARROWED_PAD_TOP_EXTRA) + 'px ' + side + 'px';
  }
  if (page.style.width !== width) page.style.width = width;
  if (page.style.padding !== padding) page.style.padding = padding;
}

/* the page is centred on the writing area (right of Contents); the toolbar slides to sit over it */
function alignToolbar() {
  const toolbar = $('tb');
  const main = $('main');
  if (!isDocView() || !main.clientWidth || inFocus()) {
    tbShift = 0;
    toolbar.style.transform = '';
    return;
  }
  const shift = toolbarShift(toolbar, main);
  if (Math.abs(shift - tbShift) < 0.5) return;
  tbShift = shift;
  toolbar.style.transform = Math.abs(shift) < 0.5 ? '' : 'translateX(' + shift + 'px)';
  const citeBar = $('citebar');
  if (citeBar) citeBar.style.transform = toolbar.style.transform;
}

/* how far the toolbar moves from where it would be to centre over the writing area (kept inside the window) */
function toolbarShift(toolbar, main) {
  const area = main.getBoundingClientRect();
  const style = getComputedStyle(main);
  const left = parseFloat(style.paddingLeft) || 0;
  const right = parseFloat(style.paddingRight) || 0;
  const target = area.left + left + (main.clientWidth - left - right) / 2;
  const box = toolbar.getBoundingClientRect();
  const natural = (box.left + box.right) / 2 - tbShift;
  const width = document.documentElement.clientWidth;
  const shift = target - natural;
  return Math.max(
    TOOLBAR_EDGE - (natural - box.width / 2),
    Math.min(shift, width - TOOLBAR_EDGE - (natural + box.width / 2))
  );
}

window.addEventListener('resize', () => {
  if (isDocView()) applyZoom();
});

// panels opening or closing resize the writing area; re-place the page and toolbar now and when the slide ends
function relayout() {
  if (!isDocView()) return;
  applyZoom();
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => {
    applyZoom();
    centreScroll();
  }, RELAYOUT_AFTER);
}

$('bodywrap').addEventListener('transitionend', e => {
  if (e.target === $('bodywrap')) relayout();
});

function centreScroll() {
  const main = $('main');
  if (main.scrollWidth > main.clientWidth) main.scrollLeft = (main.scrollWidth - main.clientWidth) / 2;
}

/* zooming keeps your place: the spot under the pointer (pinch, ctrl-scroll) or your caret (keys, buttons) stays where it is on the screen */
function zoomScroller() {
  for (let el = $('main'); el && el !== document.body; el = el.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1) return el;
  }
  return null;
}

/* the caret, if it's on screen; else the middle of the writing area */
function zoomPoint() {
  const header = headerHeight();
  const caret = caretOnScreen(header);
  if (caret) return caret;
  const area = $('main').getBoundingClientRect();
  return { x: (area.left + area.right) / 2, y: (Math.max(area.top, header) + Math.min(area.bottom, innerHeight)) / 2 };
}

function caretOnScreen(header) {
  const editor = ed();
  const selection = getSelection();
  if (!(editor && selection.rangeCount && editor.contains(selection.anchorNode))) return null;
  const rects = selection.getRangeAt(0).getClientRects();
  const node = selection.anchorNode;
  const box = rects.length ? rects[0] : (node.nodeType === 1 ? node : node.parentNode).getBoundingClientRect();
  if (!(box.bottom > header && box.top < innerHeight)) return null;
  return { x: box.left, y: (box.top + box.bottom) / 2, range: selection.getRangeAt(0).cloneRange() };
}

/* what's at the point, and where in it the point is */
function zoomAnchor(point) {
  const page = zoomedPage();
  if (!page) return null;
  let el = document.elementFromPoint(point.x, point.y);
  if (!el || !page.contains(el)) el = page;
  const box = el.getBoundingClientRect();
  return {
    el,
    range: point.range,
    x: point.x,
    y: point.y,
    fx: box.width ? (point.x - box.left) / box.width : 0,
    fy: box.height ? (point.y - box.top) / box.height : 0
  };
}

/* scrolled so the anchor (or the caret) is back where it was on the screen */
function keepAnchor(anchor) {
  if (!anchor || !anchor.el.isConnected) return;
  const { dx, dy } = anchorDrift(anchor);
  const scroller = zoomScroller();
  const main = $('main');
  if (Math.abs(dy) > 0.5) {
    if (scroller) scroller.scrollTop += dy;
    else window.scrollBy(0, dy);
  }
  if (main.scrollWidth > main.clientWidth && Math.abs(dx) > 0.5) main.scrollLeft += dx;
}

function anchorDrift(anchor) {
  const caret = anchor.range && anchor.range.getClientRects()[0];
  if (caret) return { dx: caret.left - anchor.x, dy: (caret.top + caret.bottom) / 2 - anchor.y };
  const box = anchor.el.getBoundingClientRect();
  return { dx: box.left + anchor.fx * box.width - anchor.x, dy: box.top + anchor.fy * box.height - anchor.y };
}

function setZoom(zoom, point) {
  if (inFocus()) {
    setFocusZoom(zoom, point);
    return;
  }
  const anchor = zoomAnchor(point || zoomPoint());
  ui.zoom = zoom === 'fit' ? 'fit' : Math.min(ZMAX, Math.max(ZMIN, Math.round(zoom * 100) / 100));
  try {
    localStorage.setItem(KEY + '-zoom', String(ui.zoom));
  } catch (e) {}
  const root = document.documentElement;
  const behavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  applyZoom();
  if (anchor) keepAnchor(anchor);
  else centreScroll();
  root.style.scrollBehavior = behavior;
}

/* the next zoom in the list, up or down */
function stepZoom(direction) {
  if (inFocus()) {
    stepFocusZoom(direction);
    return;
  }
  const zoom = pageZoom();
  const next =
    direction > 0
      ? ZOOMS.find(step => step > zoom + ZOOM_EPSILON)
      : [...ZOOMS].reverse().find(step => step < zoom - ZOOM_EPSILON);
  setZoom(next || (direction > 0 ? ZOOMS[ZOOMS.length - 1] : ZOOMS[0]));
}

function watchZoom() {
  if (zoomRO) zoomRO.disconnect();
  const page = $('zwrap').firstElementChild;
  if (window.ResizeObserver) {
    zoomRO = new ResizeObserver(applyZoom);
    zoomRO.observe(page);
    zoomRO.observe($('main'));
  }
  applyZoom();
  centreScroll();
}

/* ⌘+ and ⌘− */
document.addEventListener('keydown', e => {
  if (!isDocView() || !(e.metaKey || e.ctrlKey) || e.altKey) return;
  const direction = e.key === '=' || e.key === '+' ? 1 : e.key === '-' || e.key === '_' ? -1 : 0;
  if (!direction) return;
  e.preventDefault();
  stepZoom(direction);
});

// trackpad pinch: Safari/WebKit gesture events, or ctrl+wheel elsewhere
document.addEventListener('gesturestart', e => {
  if (!isDocView()) return;
  e.preventDefault();
  pinchFrom = inFocus() ? ui.fzoom : pageZoom();
});
document.addEventListener('gesturechange', e => {
  if (!isDocView()) return;
  e.preventDefault();
  setZoom(pinchFrom * e.scale, e.clientX != null ? { x: e.clientX, y: e.clientY } : null);
});
document.addEventListener(
  'wheel',
  e => {
    if (!isDocView() || !e.ctrlKey) return;
    e.preventDefault();
    if (inFocus()) focusWheel(e);
    else setZoom(pageZoom() * Math.exp(-e.deltaY / 100), { x: e.clientX, y: e.clientY });
  },
  { passive: false }
);

function closeTbMenu() {
  if (!tbMenu) return;
  if (tbMenu.sub) tbMenu.sub.remove();
  tbMenu.remove();
  tbMenu = null;
}

/* the focus back in the notes, with the selection they last had */
function restoreSel() {
  const editor = ed();
  if (!editor) return;
  editor.focus({ preventScroll: true });
  if (!(ui.lastRange && editor.contains(ui.lastRange.startContainer))) return;
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(ui.lastRange);
}
