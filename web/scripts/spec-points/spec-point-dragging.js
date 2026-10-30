/* ===== dragging in the margin to tag notes with a spec point (the page scrolls along when you reach the edge) ===== */
const AUTOSCROLL_EDGE = 70; // px from the window's top (below the header) or bottom where the page starts scrolling
const AUTOSCROLL_MAX = 24; // px per frame at most
const AUTOSCROLL_EASE = 2.5; // the speed grows by 1px per this many px further into the edge
const AUTOSCROLL_MIN = 2; // px per frame at least, once scrolling
const DRAG_CLICK_EATEN_FOR = 250; // ms after a drag in which its click is swallowed

let spDrag = null;
let spY = 0;
let spScrollRaf = 0;

/* the nearest visible block to a height on screen */
function spBlockAt(y) {
  let best = null;
  let bestDistance = Infinity;
  edBlocks(ed()).forEach(block => {
    if (!block.offsetHeight) return;
    const box = block.getBoundingClientRect();
    const distance = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = block;
    }
  });
  return best;
}

function spRange(drag) {
  const blocks = edBlocks(ed());
  const from = blocks.indexOf(drag.anchor);
  const to = blocks.indexOf(drag.cur);
  if (from < 0 || to < 0) return [];
  return blocks.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/* the bracket and box being dragged out */
function spTemp() {
  const layer = spLayer();
  if (!layer || !spDrag) return;
  const range = spRange(spDrag);
  const place = spGeom(range);
  const bracket = layerChild(() => layer, 'sptemp', 'spbr temp');
  if (!place) return;
  bracket.style.cssText = `top:${place.top}px;height:${place.h}px;left:${place.left}px`;
  layerChild(() => spBg() || layer, 'sptempbox', 'spbox temp').style.cssText = boxStyle(spTintGeom(place));
  if (spDrag.id) hideResizedBox(layer);
  bracket.setAttribute('data-n', range.length + ' block' + (range.length === 1 ? '' : 's'));
}

/* an element of a layer, by id, made (in the layer that layerOf gives) if it isn't there */
function layerChild(layerOf, id, className) {
  let el = $(id);
  if (el) return el;
  el = mk('div');
  el.id = id;
  el.className = className;
  layerOf().appendChild(el);
  return el;
}

/* while resizing, the block's own box steps aside */
function hideResizedBox(layer) {
  document.querySelectorAll('#spbg .spbox:not(.temp)').forEach((box, i) => {
    const run = layer.runs && layer.runs[i];
    box.style.visibility = run && run.id === spDrag.id && run.b[0] === spDrag.old[0] ? 'hidden' : '';
  });
}

/* how fast to scroll: down near the bottom, up near the header, not at all in between */
function autoScrollSpeed() {
  const header = headerHeight();
  const speed = depth => Math.min(AUTOSCROLL_MAX, depth / AUTOSCROLL_EASE + AUTOSCROLL_MIN);
  if (spY > innerHeight - AUTOSCROLL_EDGE) return speed(spY - (innerHeight - AUTOSCROLL_EDGE));
  if (spY < header + AUTOSCROLL_EDGE) return -speed(header + AUTOSCROLL_EDGE - spY);
  return 0;
}

function spAutoScroll() {
  spScrollRaf = 0;
  if (!spDrag) return;
  const speed = autoScrollSpeed();
  if (!speed) return;
  const root = document.documentElement;
  const behavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  window.scrollBy(0, speed);
  root.style.scrollBehavior = behavior;
  dragTo(spBlockAt(spY));
  spScrollRaf = requestAnimationFrame(spAutoScroll);
}

function dragTo(block) {
  if (!block || block === spDrag.cur) return;
  spDrag.cur = block;
  spTemp();
}

/* a bracket's label goes to its point; its handles resize it; the margin starts a new one */
document.addEventListener('mousedown', e => {
  if (ui.view !== 'notes' || !ui.spMode || e.button !== 0 || !ed()) return;
  const label = e.target.closest && e.target.closest('[data-splab]');
  if (label) {
    e.preventDefault();
    spGo(label.dataset.splab, true);
    return;
  }
  const drag = startSpDrag(e);
  if (!drag) return;
  spDrag = drag;
  e.preventDefault();
  closeSpPick();
  spY = e.clientY;
  spTemp();
});

function startSpDrag(e) {
  const handle = e.target.closest && e.target.closest('[data-sprs]');
  if (handle) return resizeSpDrag(handle);
  if (!(e.target.closest && e.target.closest('.spgut'))) return null;
  const block = spBlockAt(e.clientY);
  return block ? { anchor: block, cur: block, id: null } : null;
}

/* resizing: the opposite end is held still */
function resizeSpDrag(handle) {
  const [index, end] = handle.dataset.sprs.split(':');
  const run = $('splayer').runs[+index];
  if (!run) return null;
  const first = run.b[0];
  const last = run.b[run.b.length - 1];
  return { anchor: end === 'top' ? last : first, cur: end === 'top' ? first : last, id: run.id, old: run.b.slice() };
}

document.addEventListener('mousemove', e => {
  if (!spDrag) return;
  spY = e.clientY;
  dragTo(spBlockAt(e.clientY));
  if (!spScrollRaf) spScrollRaf = requestAnimationFrame(spAutoScroll);
});

/* a new bracket asks which point; a resized one moves its tag to the new range */
document.addEventListener('mouseup', () => {
  if (!spDrag) return;
  const drag = spDrag;
  spDrag = null;
  cancelAnimationFrame(spScrollRaf);
  spScrollRaf = 0;
  wcEatClick = true;
  setTimeout(() => (wcEatClick = false), DRAG_CLICK_EATEN_FOR);
  const range = spRange(drag);
  if (!drag.id) {
    openSpPick(range);
    return;
  }
  drag.old.forEach(block => {
    if (block.getAttribute('data-sp') === drag.id) block.removeAttribute('data-sp');
  });
  range.forEach(block => block.setAttribute('data-sp', drag.id));
  closeSpPick();
  spChanged();
});
