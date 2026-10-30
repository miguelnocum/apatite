import { updateToolbarState } from './toolbar-state.js';
import { fire } from '../core/caret.js';
import { openEditor } from '../core/helpers-and-state.js';
import { makeElement } from '../core/paste-cleaning.js';
import { edBlocks } from '../essays/word-count.js';
import { hydrateCites } from '../citations/in-text-citations.js';
import { mdTopBlock } from '../writing/writing.js';

/* ===== Body / heading: the whole of every block the selection touches changes, citations and all
   (WebKit's formatBlock stops at locked pieces such as citations and splits the line there) ===== */
const KEPT_BLOCK_ATTRIBUTES = ['data-sp', 'data-wct', 'data-fold']; // (data-fold only on headings)

export function setBlockType(tag) {
  const selection = getSelection();
  const range = openEditor() && selection.rangeCount ? selection.getRangeAt(0) : null;
  const targets = range ? blocksToChange(range, tag) : [];
  if (!targets.length) return false;
  const { startContainer, startOffset, endContainer, endOffset } = range; // (the live range moves as blocks change)
  const ends = { startContainer, startOffset, endContainer, endOffset };
  const replaced = new Map();
  targets.forEach(block => {
    if (block.tagName.toLowerCase() === tag) return;
    if (isQuoteOfLines(block)) unwrapQuoteLines(block, replaced);
    else replaced.set(block, retag(block, tag));
  });
  restoreBlockSelection(selection, ends, replaced, targets[0]);
  hydrateCites();
  fire();
  updateToolbarState();
  return true;
}

/* the top-level blocks the selection touches that can change: a quote can turn back into plain lines; anything else
   changes only between body and headings (not callouts, equations or pros and cons) */
function blocksToChange(range, tag) {
  const first = mdTopBlock(range.startContainer);
  const last = mdTopBlock(range.endContainer);
  const blocks = edBlocks(openEditor());
  const from = blocks.indexOf(first);
  const to = blocks.indexOf(last);
  if (!first || !last || from < 0 || to < 0) return [];
  const changeable = tag === 'p' ? /^(P|DIV|H[1-6]|BLOCKQUOTE)$/ : /^(P|DIV|H[1-6])$/;
  return blocks
    .slice(Math.min(from, to), Math.max(from, to) + 1)
    .filter(
      block =>
        changeable.test(block.tagName) &&
        !['data-callout', 'data-math', 'data-side'].some(attribute => block.hasAttribute(attribute))
    );
}

/* the block's spec point, word count tag and fold go with it to its new element */
function keepBlockAttributes(from, to) {
  KEPT_BLOCK_ATTRIBUTES.forEach(attribute => {
    if (from.hasAttribute(attribute) && (attribute !== 'data-fold' || /^h/.test(to.tagName.toLowerCase())))
      to.setAttribute(attribute, from.getAttribute(attribute));
  });
}

/* the block's contents in a new element (with a line break if it's empty, so it has height) */
function retag(block, tag) {
  const next = makeElement(tag);
  keepBlockAttributes(block, next);
  while (block.firstChild) next.appendChild(block.firstChild);
  if (!next.firstChild) next.innerHTML = '<br>';
  block.replaceWith(next);
  return next;
}

function isQuoteOfLines(block) {
  return block.tagName === 'BLOCKQUOTE' && [...block.children].some(child => /^(P|DIV)$/.test(child.tagName));
}

/* a quote holding lines of its own gives each of them back as a line (loose text between them, as lines of its own) */
function unwrapQuoteLines(quote, replaced) {
  let loose = null;
  [...quote.childNodes].forEach(node => {
    if (node.nodeType === 1 && /^(P|DIV)$/.test(node.tagName)) {
      loose = null;
      replaced.set(node, quotedLine(quote, node));
    } else if (node.nodeType === 1 || node.nodeValue.trim()) {
      if (!loose) {
        loose = makeElement('p');
        keepBlockAttributes(quote, loose);
        quote.before(loose);
      }
      loose.appendChild(node);
    }
  });
  quote.remove();
}

/* a line of a quote, as a line of its own before the quote */
function quotedLine(quote, node) {
  const line = makeElement('p');
  keepBlockAttributes(quote, line);
  while (node.firstChild) line.appendChild(node.firstChild);
  if (!line.firstChild) line.innerHTML = '<br>';
  quote.before(line);
  return line;
}

/* the selection where it was, in the blocks that took the old ones' places (else at the end of the first) */
function restoreBlockSelection(selection, ends, replaced, first) {
  const { startContainer, startOffset, endContainer, endOffset } = ends;
  const restored = document.createRange();
  try {
    restored.setStart(replaced.get(startContainer) || startContainer, startOffset);
    restored.setEnd(replaced.get(endContainer) || endContainer, endOffset);
  } catch (x) {
    restored.selectNodeContents(replaced.get(first) || first);
    restored.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(restored);
}
