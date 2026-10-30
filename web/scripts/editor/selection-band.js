/* ===== the selection drawn as Bear draws it: one even band, from where it starts to the right edge, whole lines between,
   and from the left edge to where it ends, with no gaps between lines or paragraphs. The browser's own is hidden while
   it shows: that one is ragged, a different height at each size of text, and patchy over callouts and lists ===== */
const BAND_BLEED = 10; // px the band reaches into the left margin
let bandFrame = 0;

document.addEventListener('selectionchange', queueBand);
document.addEventListener('input', queueBand);
window.addEventListener('resize', queueBand);

/* drawn once per frame, however often the selection changes in it */
function queueBand() {
  if (bandFrame) return;
  bandFrame = requestAnimationFrame(() => {
    bandFrame = 0;
    drawBand();
  });
}

function drawBand() {
  const editor = ed();
  const layer = editor && bandLayer(editor);
  if (!layer) return;
  const range = bandRange(editor);
  const html = range ? bandHTML(range, editor, layer) : '';
  if (editor.classList.contains('banding') !== !!html) editor.classList.toggle('banding', !!html);
  if (html) layer.classList.toggle('ondark', darkPage(layer.parentNode));
  if (layer.innerHTML !== html) layer.innerHTML = html;
}

/* a dark page: the band lightens what's under it there (and darkens it on a light one), so text keeps its colour */
function darkPage(page) {
  const rgb = (getComputedStyle(page).backgroundColor.match(/[\d.]+/g) || [255, 255, 255]).map(Number);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 128;
}

/* the layer over the page the band is drawn in (outside the notes, so it's never saved) */
function bandLayer(editor) {
  const page = editor.closest('.doc');
  if (!page) return null;
  let layer = page.querySelector(':scope>.sellayer');
  if (layer) return layer;
  layer = mk('div');
  layer.className = 'sellayer';
  layer.setAttribute('contenteditable', 'false');
  page.appendChild(layer);
  return layer;
}

/* the selection, if it's text in the notes (selected table cells show their own way) */
function bandRange(editor) {
  const selection = getSelection();
  if (!selection.rangeCount || selection.isCollapsed || ui.tsel) return null;
  const range = selection.getRangeAt(0);
  return editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range : null;
}

/* the band's rectangles, in the layer's own px */
function bandHTML(range, editor, layer) {
  const rects = bandRects(range, editor);
  const origin = layer.getBoundingClientRect();
  const scale = pageScale(layer);
  const px = v => Math.round(v * 10) / 10 + 'px';
  return rects
    .filter(([l, t, r, b]) => r - l > 0.5 && b - t > 0.5)
    .map(
      ([l, t, r, b]) =>
        `<div class="selband" style="left:${px((l - origin.left) / scale)};top:${px((t - origin.top) / scale)};` +
        `width:${px((r - l) / scale)};height:${px((b - t) / scale)}"></div>`
    )
    .join('');
}

/* [left, top, right, bottom] on the screen: one rectangle on one line; otherwise the first line's end, the lines between
   and the last line's start */
function bandRects(range, editor) {
  const first = edgeRect(range, true);
  const last = edgeRect(range, false);
  if (!first || !last) return [];
  const box = editor.getBoundingClientRect();
  const left = box.left - BAND_BLEED;
  if (last.top < first.bottom - 1)
    return [[first.left, Math.min(first.top, last.top), last.right, Math.max(first.bottom, last.bottom)]];
  return [
    [first.left, first.top, box.right, first.bottom],
    [left, first.bottom, box.right, last.top],
    [left, last.top, last.right, last.bottom]
  ];
}

/* the box of the first character selected (or the last) */
function edgeRect(range, atStart) {
  const node = edgeText(range, atStart);
  if (!node) return null;
  const text = node.nodeValue;
  const piece = document.createRange();
  if (atStart) {
    const at = node === range.startContainer ? range.startOffset : text.search(/\S/);
    piece.setStart(node, at);
    piece.setEnd(node, Math.min(at + 1, text.length));
  } else {
    const at = node === range.endContainer ? range.endOffset : text.replace(/\s+$/, '').length;
    piece.setStart(node, Math.max(0, at - 1));
    piece.setEnd(node, at);
  }
  const rects = piece.getClientRects();
  return rects.length ? rects[atStart ? 0 : rects.length - 1] : null;
}

/* the first (or last) piece of text with something of it selected */
function edgeText(range, atStart) {
  const root = range.commonAncestorContainer;
  if (root.nodeType === 3) return root;
  const selected = node =>
    range.intersectsNode(node) &&
    /\S/.test(node.nodeValue) &&
    !(node === range.endContainer && range.endOffset === 0) &&
    !(node === range.startContainer && range.startOffset >= node.nodeValue.length);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => (selected(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
  });
  if (atStart) return walker.nextNode();
  /* from the selection's end, back (not from the end of the notes) */
  let end = range.endContainer;
  if (end.nodeType === 1) end = end.childNodes[range.endOffset - 1] || end;
  while (end.lastChild) end = end.lastChild;
  walker.currentNode = end;
  return end.nodeType === 3 && selected(end) ? end : walker.previousNode();
}
