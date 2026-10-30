/* ===== Bear-style writing =====
   Typed shortcuts are commands: "**word**", "# ", "- " and friends turn into formatting the moment they are complete
   and the symbols are gone, never hidden in the text. ⌘Z straight after gives back exactly what was typed. */
/* last: how to undo the last conversion; esc: the formatting just made, which the next letter typed steps out of;
   at: when the last conversion happened */
const MD = { last: null, esc: null, at: 0 };

/* places where typing stays literal */
function mdOff(node) {
  const el = node && (node.nodeType === 3 ? node.parentNode : node);
  return (
    !el || !el.closest || !!el.closest('code,.fn,.cite,span[data-cite],nav[data-toc],h2[data-sec],h3[data-pt],.ref')
  );
}

/* the selection set to a node's offsets (a caret, when there's no end) */
function mdSel(node, start, end) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end == null ? start : end);
  selectRange(range);
}

function selectRange(range) {
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/* the caret, when it's in a text node: the node, its offset, and the text before it */
function mdCaret() {
  const selection = getSelection();
  if (!selection.rangeCount || !selection.isCollapsed) return null;
  const node = selection.anchorNode;
  if (!node || node.nodeType !== 3) return null;
  return { node, off: selection.anchorOffset, before: node.nodeValue.slice(0, selection.anchorOffset) };
}

/* the editor's child that holds a node */
function mdTopBlock(node) {
  const editor = ed();
  if (!editor || !node) return null;
  if (node.nodeType === 3) node = node.parentNode;
  while (node && node.parentNode !== editor) node = node.parentNode;
  return node;
}

/* the element a selection's anchor is in */
function anchorElement(selection) {
  const node = selection.anchorNode;
  return node && (node.nodeType === 3 ? node.parentNode : node);
}

/* the plain paragraph the caret is in (not a heading, list item, table cell, caption…) */
function mdPara() {
  const selection = getSelection();
  if (!selection.rangeCount || !selection.isCollapsed || !selection.anchorNode) return null;
  const el = anchorElement(selection);
  const block = el.closest && el.closest('p,li,td,th,h1,h2,h3,h4,h5,h6,figcaption,blockquote');
  if (!block || block.tagName !== 'P' || !ed().contains(block) || block.closest('li,td,th,figure')) return null;
  return block;
}

/* the text from the start of an element to the caret */
function mdBefore(el) {
  const selection = getSelection();
  const range = document.createRange();
  range.setStart(el, 0);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString();
}

/* the text from the caret to the end of an element */
function textAfterCaret(el) {
  const selection = getSelection();
  const range = document.createRange();
  range.setStart(selection.anchorNode, selection.anchorOffset);
  range.setEnd(el, el.childNodes.length);
  return range.toString();
}

const FULL_WIDTH_OFFSET = 0xfee0; // ＃ is # plus this

/* input methods (Pinyin and others) can type full-width marks: ＃ ＞ － ＊ ［ ］ １． */
function mdAscii(text) {
  return String(text)
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - FULL_WIDTH_OFFSET))
    .replace(/[。．]/g, '.')
    .replace(/【/g, '[')
    .replace(/】/g, ']');
}
