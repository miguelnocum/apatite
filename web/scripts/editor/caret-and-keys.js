import { updateToolbarState } from './toolbar-state.js';
import { caretToStart, fire, selectRange } from '../core/caret.js';
import { openEditor } from '../core/helpers-and-state.js';
import { makeElement } from '../core/paste-cleaning.js';
import { anchorElement, mdTopBlock } from '../writing/writing.js';

/* ===== a place for the caret beside a citation or footnote at the start or end of a line (on screen only; never saved) ===== */
export const ZW = '\u200b';
const LOCKED_PIECES = '[data-cite],[data-fn],[data-imath]';

export function caretAnchors(root) {
  root = root || openEditor();
  if (!root) return;
  root.querySelectorAll(LOCKED_PIECES).forEach(el => {
    ensureTextBeside(el, el.previousSibling, node => el.before(node));
    ensureTextBeside(el, el.nextSibling, node => el.after(node));
  });
}

/* an empty text node beside a locked piece holds a zero-width space; with none there, one is put in */
function ensureTextBeside(el, beside, put) {
  if (beside && beside.nodeType === 3 && beside.nodeValue.length) return;
  if (beside && beside.nodeType === 3) beside.nodeValue = ZW;
  else put(document.createTextNode(ZW));
}

/* the text of a range, without zero-width spaces */
function visibleText(range) {
  return range.toString().replace(/\u200b/g, '');
}

/* ===== joining two lines where one starts with a citation or footnote (WebKit can't delete into a locked piece) ===== */
export function lockedFirst(block) {
  let node = block.firstChild;
  while (node && node.nodeType === 3 && !node.nodeValue.replace(/\u200b/g, '').trim()) node = node.nextSibling;
  return !!(
    node &&
    node.nodeType === 1 &&
    (node.getAttribute('contenteditable') === 'false' || node.matches('.cite,.fn,[data-cite],[data-fn]'))
  );
}

function caretAtEndOf(el) {
  const selection = getSelection();
  if (!selection.rangeCount || !selection.isCollapsed) return false;
  const range = document.createRange();
  range.setStart(selection.anchorNode, selection.anchorOffset);
  range.setEnd(el, el.childNodes.length);
  return !visibleText(range) && !range.cloneContents().querySelector('img,[data-cite],[data-fn]');
}

/* Backspace at the start of a line beginning with a locked piece, or Delete at the end of the line before one */
export function joinLocked(e, back) {
  const selection = getSelection();
  if (!selection.rangeCount || !selection.isCollapsed) return false;
  const block = mdTopBlock(selection.anchorNode);
  if (!block || !/^(P|H[1-6])$/.test(block.tagName) || block.classList.contains('ref')) return false;
  const pair = back ? joinBackward(block) : joinForward(block);
  if (!pair) return false;
  const first = intoContainer(pair.first);
  if (!first || !/^(P|DIV|BLOCKQUOTE|H[1-6])$/.test(first.tagName)) return false;
  e.preventDefault();
  const join = joinLines(first, pair.second);
  const range = document.createRange();
  range.setStart(join, join.nodeValue.length);
  range.collapse(true);
  selectRange(range);
  fire();
  return true;
}

/* the two lines to join, if they can be */
function joinBackward(block) {
  if (!caretAtStartOf(block) || !lockedFirst(block)) return null;
  return checkedPair(block.previousElementSibling, block);
}

function joinForward(block) {
  if (!caretAtEndOf(block)) return null;
  const second = block.nextElementSibling;
  if (!second || !lockedFirst(second)) return null;
  return checkedPair(block, second);
}

function checkedPair(first, second) {
  if (!first || !second || !/^(P|H[1-6])$/.test(second.tagName) || first.classList.contains('ref')) return null;
  return { first, second };
}

/* into a quote or callout above: its last line */
function intoContainer(first) {
  if (first.tagName !== 'BLOCKQUOTE' && !first.hasAttribute('data-callout')) return first;
  const lines = [...first.children].filter(
    child => /^(P|DIV)$/.test(child.tagName) && !child.hasAttribute('data-cot') && !child.hasAttribute('data-side')
  );
  return lines.pop() || (first.tagName === 'BLOCKQUOTE' ? first : null);
}

/* the second line's contents onto the end of the first, with a space between; returns the space's text node */
function joinLines(first, second) {
  trimLineEnd(first);
  const words = first.textContent.replace(/\u200b/g, '');
  const join = document.createTextNode(words && !/\s$/.test(words) ? ' ' : '');
  first.appendChild(join);
  while (second.firstChild) {
    const node = second.firstChild;
    if (node.nodeName === 'BR' && second.childNodes.length === 1) {
      node.remove();
      break;
    }
    first.appendChild(node);
  }
  second.remove();
  if (join.nextSibling && join.nextSibling.nodeType === 3 && join.nextSibling.nodeValue === ZW)
    join.nextSibling.remove();
  return join;
}

/* a line break at the end goes, then an empty (or zero-width) text node there */
function trimLineEnd(line) {
  if (line.lastChild && line.lastChild.nodeName === 'BR') line.lastChild.remove();
  const last = line.lastChild;
  if (last && last.nodeType === 3 && !last.nodeValue.replace(/\u200b/g, '')) last.remove();
}

/* ===== Backspace at the start of a line ===== */
function caretAtStartOf(el) {
  const selection = getSelection();
  if (!selection.rangeCount || !selection.isCollapsed) return false;
  if (!el.contains(selection.anchorNode) && selection.anchorNode !== el) return false;
  const range = document.createRange();
  range.setStart(el, 0);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return !visibleText(range) && !range.cloneContents().querySelector('img');
}

/* a bullet: the first Backspace takes the bullet away and leaves the words where they are (nested: one level out) */
export function listBackspace(e) {
  const selection = getSelection();
  if (!selection.rangeCount || !selection.isCollapsed) return false;
  const el = anchorElement(selection);
  const item = el && el.closest && el.closest('#ed li');
  /* only when the caret is on the item's own first line, not in a list nested inside it */
  if (!item || !caretAtStartOf(item) || el.closest('li') !== item) return false;
  e.preventDefault();
  const list = item.parentElement;
  if (list.parentElement && list.parentElement.closest('li')) document.execCommand('outdent');
  else caretToStart(bulletToLine(item, list));
  fire();
  updateToolbarState();
  return true;
}

/* the item's words as a line after the list; its sub-bullets and the bullets after it carry on as one list below */
function bulletToLine(item, list) {
  const { line, nested } = splitItem(item, list);
  const after = [];
  for (let next = item.nextElementSibling; next; next = next.nextElementSibling) after.push(next);
  item.remove();
  const rest = after.length || nested.length ? restOfList(list, nested, after) : null;
  list.after(line);
  let last = line;
  nested.forEach(sublist => {
    if (!sublist.firstChild) return;
    last.after(sublist);
    last = sublist;
  });
  if (rest && rest.children.length) last.after(rest);
  if (!list.children.length) list.remove();
  return line;
}

/* the item's own words as a line (with its list's spec point), and the lists nested in it */
function splitItem(item, list) {
  const line = makeElement('p');
  const nested = [];
  [...item.childNodes].forEach(child => {
    if (child.nodeType === 1 && /^(UL|OL)$/.test(child.tagName)) nested.push(child);
    else line.appendChild(child);
  });
  if (!line.textContent && !line.querySelector('img')) line.innerHTML = '<br>';
  if (list.getAttribute('data-sp')) line.setAttribute('data-sp', list.getAttribute('data-sp'));
  return { line, nested };
}

/* a new list of the list's kind, with the items of nested lists of that kind, then the bullets after */
function restOfList(list, nested, after) {
  const rest = list.cloneNode(false);
  nested.forEach(sublist => {
    if (sublist.tagName === list.tagName) while (sublist.firstChild) rest.appendChild(sublist.firstChild);
  });
  after.forEach(item => rest.appendChild(item));
  return rest;
}

/* a line right after a callout, quote or table: never merged into it; an empty line goes, the caret steps up */
export function blockBackspace(e) {
  const selection = getSelection();
  if (!selection.rangeCount || !selection.isCollapsed) return false;
  const block = mdTopBlock(selection.anchorNode);
  if (!block || block.tagName !== 'P' || !caretAtStartOf(block)) return false;
  const above = block.previousElementSibling;
  if (!above || !above.matches('[data-callout],blockquote,table,nav[data-toc]')) return false;
  e.preventDefault();
  const empty = !block.textContent.trim() && !block.querySelector('img');
  const target = lastPlaceIn(above);
  if (empty && block.nextElementSibling) block.remove();
  if (target) {
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    selectRange(range);
  }
  fire();
  return true;
}

/* where the caret goes in the block above: a table's last cell, a list's or callout's last line (not in contents) */
function lastPlaceIn(above) {
  if (above.matches('table')) return above.querySelector('tr:last-child td:last-child,tr:last-child th:last-child');
  if (above.matches('nav')) return null;
  return above.querySelector('li:last-child,p:last-child') || above;
}

/* ===== which syllabus this notebook follows (the Mac app keeps syllabi as their own files) ===== */
export function sylInfo() {
  const notebook = window.__NB__ || {};
  return { cur: notebook.syllabus || null, list: notebook.syllabi || [] };
}
