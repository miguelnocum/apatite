/* ===== the notes around the equation: each near its part, above or below in turn, never on top of one another,
   with a curved line from the box to the part (measured in the page's own, unzoomed pixels) ===== */
const NOTE_GAP = 12; // px between two boxes in a row
const NOTE_MIN_WIDTH = 140; // px a box may be at most at least this wide…
const NOTE_MAX_WIDTH = 260; // …and at most this wide
const NOTE_WIDTH_SHARE = 0.46; // …and otherwise at most this share of the equation's width
const NOTE_ROW_GAP = '30px'; // between a row of boxes and the equation
const LINE_CLEARANCE = 3; // px between a line's end and its part
const LINE_INSET = 14; // px a line keeps from the ends of its box
const LINE_DOT_RADIUS = 2.4;

const annRO = window.ResizeObserver
  ? new ResizeObserver(entries =>
      entries.forEach(entry => {
        const el = entry.target.closest && entry.target.closest('[data-math]');
        if (el) annLayout(el);
      })
    )
  : null;
if (document.fonts && document.fonts.ready)
  document.fonts.ready.then(() => document.querySelectorAll('#ed [data-math]').forEach(annLayout));

function annLayout(el) {
  const wrap = el.querySelector(':scope>.mwrap');
  if (!wrap || !wrap.offsetWidth) return;
  const frame = noteFrame(wrap);
  const items = noteItems(wrap, frame);
  const rows = splitIntoRows(items, frame);
  const maxWidth = Math.max(NOTE_MIN_WIDTH, Math.min(NOTE_MAX_WIDTH, frame.width * NOTE_WIDTH_SHARE));
  rows.forEach((row, below) => placeRow(row, below ? frame.bottom : frame.top, !!below, maxWidth, frame.width));
  drawNoteLines(el, wrap, items, frame);
  if (mathEd && mathEd.el === el && mathEd.place) mathEd.place(); // the equation grew or shrank under its editor
}

/* the equation's box, its rows and lines, and the zoom (screen pixels per page pixel) */
function noteFrame(wrap) {
  const width = wrap.offsetWidth;
  const rect = wrap.getBoundingClientRect();
  return {
    width,
    rect,
    zoom: rect.width / width || 1,
    top: wrap.querySelector('.mtop'),
    bottom: wrap.querySelector('.mbot'),
    svg: wrap.querySelector('.mlines')
  };
}

/* the page's own x of an element's middle */
function middleX(el, frame) {
  const rect = el.getBoundingClientRect();
  return (rect.left + rect.width / 2 - frame.rect.left) / frame.zoom;
}

/* each box whose part is in the equation, with where the part first and last appears (left to right) */
function noteItems(wrap, frame) {
  const items = [];
  wrap.querySelectorAll('.mcard').forEach(card => {
    const i = card.getAttribute('data-ai');
    const places = wrap.querySelectorAll('.meqs .mann' + i);
    card.style.display = places.length ? '' : 'none';
    if (!places.length) return;
    const first = places[0];
    const last = places[places.length - 1];
    items.push({ i, c: card, first, last, x: middleX(first, frame), xl: middleX(last, frame) });
  });
  return items.sort((a, b) => a.x - b.x);
}

/* above and below in turn; a box above points at the part's first place, one below at its last (on the bottom line) */
function splitIntoRows(items, frame) {
  const rows = [[], []];
  items.forEach((item, n) => {
    const below = n % 2;
    item.part = below ? item.last : item.first;
    if (below) item.x = item.xl;
    rows[below].push(item);
    const row = below ? frame.bottom : frame.top;
    if (item.c.parentNode !== row) row.appendChild(item.c);
  });
  rows[1].sort((a, b) => a.x - b.x);
  return rows;
}

/* each box centred over its part where there's room, pushed right of the one before, then back left from the edge */
function placeRow(row, box, below, maxWidth, width) {
  let height = 0;
  let previousEnd = -Infinity;
  row.forEach(item => {
    item.c.style.maxWidth = maxWidth + 'px';
    item.w = item.c.offsetWidth;
    item.h = item.c.offsetHeight;
    height = Math.max(height, item.h);
    item.left = Math.max(0, Math.max(item.x - item.w / 2, previousEnd + NOTE_GAP));
    previousEnd = item.left + item.w;
  });
  slideBackLeft(row, width);
  row.forEach(item => {
    item.c.style.left = item.left + 'px';
    item.c.style.top = (below ? 0 : height - item.h) + 'px';
  });
  box.style.height = (row.length ? height : 0) + 'px';
  box.style.marginBottom = !below && row.length ? NOTE_ROW_GAP : '0';
  box.style.marginTop = below && row.length ? NOTE_ROW_GAP : '0';
}

/* too far right: slide back left */
function slideBackLeft(row, width) {
  let limit = width;
  for (let n = row.length - 1; n >= 0; n--) {
    const item = row[n];
    if (item.left + item.w > limit) item.left = Math.max(0, limit - item.w);
    limit = item.left - NOTE_GAP;
  }
}

/* the lines, now everything has its place */
function drawNoteLines(el, wrap, items, frame) {
  const height = wrap.offsetHeight;
  const svg = frame.svg;
  svg.setAttribute('width', frame.width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', '0 0 ' + frame.width + ' ' + height);
  const list = annList(el);
  const paths = items.map(item => noteLineSVG(item, frame, annColor({ c: (list[+item.i] || {}).c }))).join('');
  if (svg.innerHTML !== paths) svg.innerHTML = paths;
}

/* a curve from the box's edge (kept off its corners) to just above or below the part, and a dot there */
function noteLineSVG(item, frame, colour) {
  const { rect, zoom } = frame;
  const part = item.part.getBoundingClientRect();
  const card = item.c.getBoundingClientRect();
  const up = item.c.parentNode === frame.top;
  const px = (part.left + part.width / 2 - rect.left) / zoom;
  const py = up ? (part.top - rect.top) / zoom - LINE_CLEARANCE : (part.bottom - rect.top) / zoom + LINE_CLEARANCE;
  const cx = Math.max(
    (card.left - rect.left) / zoom + LINE_INSET,
    Math.min((card.right - rect.left) / zoom - LINE_INSET, px)
  );
  const cy = up ? (card.bottom - rect.top) / zoom : (card.top - rect.top) / zoom;
  const my = (cy + py) / 2;
  const [x1, y1, ym, x2, y2] = [cx, cy, my, px, py].map(n => n.toFixed(1));
  return (
    `<path class="mpath" data-ai="${item.i}" stroke="${colour}" d="M${x1} ${y1} C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}"/>` +
    `<circle class="mpath" data-ai="${item.i}" cx="${x2}" cy="${y2}" r="${LINE_DOT_RADIUS}" fill="${colour}"/>`
  );
}

/* pointing at a part, its box or its row in the editor lights up all three */
document.addEventListener('mouseover', e => {
  const target = e.target;
  const el =
    target.closest && (target.closest('#ed [data-math]') || (target.closest('.mathpop') && mathEd && mathEd.el));
  document.querySelectorAll('.annhl').forEach(lit => lit.classList.remove('annhl'));
  if (!el || !target.closest) return;
  const i = pointedNote(target);
  if (i == null) return;
  el.querySelectorAll('.mann' + i + ',.mcard[data-ai="' + i + '"],.mpath[data-ai="' + i + '"]').forEach(part =>
    part.classList.add('annhl')
  );
});

/* the note a box, an editor row or a coloured part belongs to */
function pointedNote(target) {
  const row = target.closest('.mcard,.mp-a');
  if (row) return row.getAttribute('data-ai');
  const part = target.closest('[class*="mann"]');
  return part ? (/mann(\d+)/.exec(part.getAttribute('class')) || [])[1] : null;
}
