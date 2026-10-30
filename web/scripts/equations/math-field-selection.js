import { styleMathField } from './math-field-look.js';

/* ===== the equation editor, part 2: selecting in a typing box =====
   Selections take whole things. MathLive stops inside things that read as one: between a letter and its subscript, inside a
   name such as ReLU, inside the cells of a cases block or matrix, inside a big bracket. A selection whose ends are at different
   depths has its deeper end moved out to the edge of what it's in (both ends inside the same part, a numerator say, is a
   selection of that part and stays).
   Dragging is done here rather than by MathLive: its own drag jumps about over grouped things (passing over the letters of ReLU
   it selects the whole line, then not), which shows as a flicker. Each move takes the place under the pointer, snaps the
   selection to whole things and sets it once. */
const DRAG_START_DISTANCE = 5; // px a press moves before it's a drag
const SHRINK_HYSTERESIS = 6; // px the pointer must come back before a selection shrinks
const VERTICAL_DRAG_WEIGHT = 0.3; // up and down counts for less than along the line
const MATHS_EDGE_TOLERANCE = 4; // px beyond the maths' ends that still count as its start or end
const SCRIPT_LOOKAHEAD = 12; // positions searched for a letter's sub/superscript
const LEADING_SCRIPT_STEPS = 4; // positions searched back for the letter a sub/superscript belongs to
const BRACKET_SELECTOR = '[class*="delim"],.ML__open,.ML__close,.ML__left,.ML__right';
const STARTS_WITH_SCRIPT = /^[_^](\{[^{}]*\}|\\[A-Za-z]+|[A-Za-z0-9]).+/;
const ONLY_SCRIPTS = /^((_|\^)(\{[^{}]*(\{[^{}]*\}[^{}]*)*\}|\\[A-Za-z]+|[A-Za-z0-9]))+$/;

class FieldSelection {
  constructor(field) {
    this.field = field;
    this.root = field.shadowRoot;
    this.drag = null;
    this.onMove = e => this.onPointerMove(e);
    this.onUp = e => this.onPointerUp(e);
    this.listen();
  }

  listen() {
    this.field.addEventListener('pointerdown', e => this.onPointerDown(e), true);
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('blur', () => (this.drag = null));
    this.field.addEventListener('keyup', e => {
      if (e.key === 'Shift' || (e.shiftKey && /Arrow/.test(e.key))) this.snapCurrent();
    });
  }

  stopListening() {
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
  }

  /* ---- positions and depths ---- */

  /* how deep each position is (0 on the line itself), remembered for the length of one calculation */
  depths() {
    const cache = {};
    return pos => {
      if (cache[pos] == null) cache[pos] = this.depthAt(pos);
      return cache[pos];
    };
  }

  depthAt(pos) {
    const info = this.infoAt(pos);
    return info && info.depth != null ? info.depth : 0;
  }

  infoAt(pos) {
    try {
      return this.field.getElementInfo(pos);
    } catch (x) {
      return null;
    }
  }

  latex(from, to) {
    return this.field.getValue([from, to], 'latex');
  }

  /* ---- whole things ---- */

  snap(start, end) {
    if (start > end) [start, end] = [end, start];
    if (start === end) return [start, end];
    [start, end] = this.outToCommonDepth(start, end);
    start = this.withLeadingScriptsLetter(start, end);
    return [start, this.withTrailingScripts(start, end)];
  }

  outToCommonDepth(start, end) {
    const depth = this.depths();
    const last = this.field.lastOffset;
    let common = Math.min(depth(start), depth(end));
    for (let pos = start + 1; pos < end; pos++) common = Math.min(common, depth(pos));
    while (start > 0 && depth(start) > common) start--;
    while (end < last && depth(end) > common) end++;
    return [start, end];
  }

  /* starting with a sub/superscript and running on past it: its letter comes too (ϕ₁₀ + …, not ₁₀ + …) */
  withLeadingScriptsLetter(start, end) {
    for (let step = 0; step < LEADING_SCRIPT_STEPS && start > 0; step++) {
      if (!STARTS_WITH_SCRIPT.test(this.latex(start, end))) break;
      start--;
    }
    return start;
  }

  /* ending on a letter whose sub/superscript was left out: it comes too
     (in between, MathLive gives partial forms such as \phi0, which are passed over) */
  withTrailingScripts(start, end) {
    const base = this.latex(start, end);
    const limit = Math.min(this.field.lastOffset, end + SCRIPT_LOOKAHEAD);
    let best = end;
    for (let pos = end + 1; pos <= limit; pos++) {
      const longer = this.latex(start, pos);
      if (longer.slice(0, base.length) !== base) break;
      const rest = longer.slice(base.length);
      if (rest === '') continue;
      if (ONLY_SCRIPTS.test(rest)) best = pos;
      else if (/^[_^]/.test(rest)) break;
    }
    return best;
  }

  select(start, end, backward) {
    const current = this.field.selection.ranges[0] || [];
    if (Math.min(current[0], current[1]) === start && Math.max(current[0], current[1]) === end) return;
    this.field.selection = { ranges: [[start, end]], direction: backward ? 'backward' : 'forward' };
  }

  /* after Shift and the arrow keys */
  snapCurrent() {
    try {
      const ranges = this.field.selection.ranges;
      if (ranges.length !== 1 || ranges[0][0] === ranges[0][1]) return;
      const [start, end] = this.snap(ranges[0][0], ranges[0][1]);
      this.select(start, end);
    } catch (x) {}
  }

  /* ---- big brackets: the brace of a cases block, a matrix's brackets, \left( \right) ---- */

  /* clicking one selects the whole block it belongs to */
  selectBlockAtBracket(x, y) {
    try {
      const el = this.root.elementFromPoint(x, y);
      if (!el || !el.closest || !el.closest(BRACKET_SELECTOR)) return;
      const [start, end] = this.blockAround(this.field.position);
      if (end > start) this.select(start, end);
    } catch (x) {}
  }

  blockAround(pos) {
    const depth = this.depths();
    const last = this.field.lastOffset;
    const here = depth(pos);
    let start = pos;
    let end = pos;
    if (pos < last && depth(pos + 1) > here) {
      end = pos + 1; // the opening bracket: the block starts here
      while (end < last && depth(end) > here) end++;
    } else if (pos > 0 && depth(pos - 1) > here) {
      start = pos - 1; // the closing one: it ends here
      while (start > 0 && depth(start) > here) start--;
    } else if (here > 0) {
      while (start > 0 && depth(start) >= here) start--; // inside: the block around
      while (end < last && depth(end) >= here) end++;
    }
    return [start, end];
  }

  /* ---- the place under the pointer ---- */

  /* MathLive's answer is sometimes the very start (or end) of the line for a point in the middle of it (over a name such as
     ReLU, or past a tall bracket); then the gap between top-level pieces nearest the pointer is used instead */
  positionAt(x, y, bias) {
    const pos = this.field.getOffsetFromPoint(x, y, { bias: bias });
    const last = this.field.lastOffset;
    if (pos !== 0 && pos !== last) return pos;
    const maths = this.root.querySelector('.ML__latex');
    const bounds = maths && maths.getBoundingClientRect();
    if (!bounds) return pos;
    if (pos === 0 && x <= bounds.left + MATHS_EDGE_TOLERANCE) return 0;
    if (pos === last && x >= bounds.right - MATHS_EDGE_TOLERANCE) return last;
    return this.positionAmongPieces(x, bias, bounds, pos);
  }

  /* over a piece (a letter, a name, a whole cases block): its far side in the direction of the drag; between pieces, the nearest gap */
  positionAmongPieces(x, bias, bounds, fallback) {
    const depth = this.depths();
    let best = fallback;
    let bestGap = Infinity;
    let previous = 0;
    for (let pos = 1; pos <= this.field.lastOffset; pos++) {
      if (depth(pos) !== 0) continue;
      const info = this.infoAt(pos);
      if (info && info.bounds) {
        if (x > info.bounds.left && x < info.bounds.right) return bias < 0 ? previous : pos;
        const gap = Math.abs(info.bounds.right - x);
        if (gap < bestGap) [bestGap, best] = [gap, pos];
      }
      previous = pos;
    }
    return Math.abs(bounds.left - x) < bestGap ? 0 : best;
  }

  /* ---- dragging ---- */

  onPointerDown(e) {
    const plainPress = e.button === 0 && !e.shiftKey && e.pointerType !== 'touch';
    this.drag = plainPress ? { x: e.clientX, y: e.clientY, anchor: null, moved: false } : null;
  }

  onPointerMove(e) {
    if (!this.field.isConnected) return this.stopListening();
    if (!this.drag) return; // (the press is tracked here, from pointerdown to pointerup: not every mouse reports its buttons on moves)
    e.stopImmediatePropagation(); // MathLive never sees these moves, even the first few pixels: it selected and unselected there
    e.preventDefault();
    const travelled = Math.abs(e.clientX - this.drag.x) + Math.abs(e.clientY - this.drag.y);
    if (!this.drag.moved && travelled < DRAG_START_DISTANCE) return;
    try {
      this.dragTo(e);
    } catch (x) {}
  }

  dragTo(e) {
    const drag = this.drag;
    if (!drag.moved) {
      drag.moved = true;
      drag.anchor = this.positionAt(drag.x, drag.y, 0);
    }
    const pos = this.positionAt(e.clientX, e.clientY, e.clientX < drag.x ? -1 : 1);
    if (pos < 0 || drag.anchor < 0) return;
    const range = this.snap(drag.anchor, pos);
    const distance = Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) * VERTICAL_DRAG_WEIGHT;
    if (this.isWobble(range, distance)) return;
    drag.last = range;
    drag.lastDistance = distance;
    this.select(range[0], range[1], pos < drag.anchor);
  }

  /* it only shrinks when the pointer has come back towards where it started: MathLive's answer wobbles (now and then it gives
     the starting place itself), and taken as it comes that empties the selection for a moment, which shows as a blink */
  isWobble(range, distance) {
    const last = this.drag.last;
    if (!last) return false;
    const inside = range[0] >= last[0] && range[1] <= last[1];
    const same = range[0] === last[0] && range[1] === last[1];
    return inside && !same && distance > this.drag.lastDistance - SHRINK_HYSTERESIS;
  }

  onPointerUp(e) {
    if (!this.field.isConnected) return this.stopListening();
    if (!this.drag) return;
    const wasDrag = this.drag.moved;
    this.drag = null;
    if (wasDrag) return; // (MathLive still sees the release, to end its own tracking)
    setTimeout(() => this.selectBlockAtBracket(e.clientX, e.clientY), 0);
  }
}

/* a typing box made to look and select as it should */
export function enhanceMathField(field) {
  if (!field.shadowRoot) return;
  styleMathField(field);
  new FieldSelection(field);
}
