import { mk } from '../core/paste-cleaning.js';
import { fire, tbState } from '../editor/editor-commands.js';
import { caretInto } from '../essays/essays.js';
import {
  MD,
  anchorElement,
  mdAscii,
  mdBefore,
  mdCaret,
  mdPara,
  mdSel,
  selectRange,
  textAfterCaret
} from './writing.js';
import { CALLOUTS } from '../core/callout-kinds.js';

/* ===== typed shortcuts at the start of a line: "# " a heading, "- " a list, "> " a quote, "> [!NOTE] " a callout,
   "---" then a space or Return a divider; and leaving a quote ===== */
const MD_BLOCK = [
  [/^#{1,6}$/, 'h'],
  [/^[-*+•]$/, 'ul'],
  [/^1[.)]$/, 'ol'],
  [/^\[ ?\]$/, 'todo'],
  [/^\[x\]$/i, 'done'],
  [/^>$/, 'quote']
];
export const TYPED_SPACE = /[ \u00a0\u3000]$/; // a space as typed, by a keyboard or an input method

export function mdBlock() {
  const line = mdPara();
  if (!line || line.closest('[data-side]')) return false;
  const before = mdBefore(line);
  if (!TYPED_SPACE.test(before)) return false;
  const key = mdAscii(before.slice(0, -1));
  const found = MD_BLOCK.find(([re]) => re.test(key));
  if (!found) return false;
  const caret = mdCaret();
  if (!caret || caret.before !== before) return false; /* the shortcut has to be plain text at the start of the line */
  caret.node.nodeValue = caret.node.nodeValue.slice(caret.off);
  const { block, host } = newBlock(found[1], key);
  moveLineInto(line, host);
  line.replaceWith(block);
  if (caret.node.isConnected && caret.node.nodeValue) mdSel(caret.node, 0);
  else caretToStart(host);
  undoBlock(line, block, host, before);
  tbState();
  return true;
}

/* the line's contents into the new block (which keeps a line break when empty, so it has height) */
function moveLineInto(line, host) {
  while (line.firstChild) host.appendChild(line.firstChild);
  if (!host.textContent && !host.querySelector('br,img')) host.appendChild(mk('br'));
}

/* the new block, and the element in it that takes the line's contents */
function newBlock(kind, key) {
  const tag = kind === 'h' ? 'h' + key.length : { quote: 'blockquote' }[kind];
  if (tag) {
    const block = mk(tag);
    return { block, host: block };
  }
  const block = mk(kind === 'ol' ? 'ol' : 'ul');
  const host = mk('li');
  block.appendChild(host);
  if (kind === 'todo' || kind === 'done') block.setAttribute('data-todo', '');
  if (kind === 'done') host.setAttribute('data-done', '1');
  return { block, host };
}

export function caretToStart(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  selectRange(range);
}

/* ⌘Z straight after: the line back as it was, with what was typed */
function undoBlock(line, block, host, typed) {
  MD.last = {
    undo: () => {
      if (!block.isConnected) return;
      while (line.firstChild) line.removeChild(line.firstChild);
      while (host.firstChild) line.appendChild(host.firstChild);
      line.querySelectorAll('br').forEach(br => {
        if (line.textContent) br.remove();
      });
      const text = document.createTextNode(typed);
      line.insertBefore(text, line.firstChild);
      block.replaceWith(line);
      mdSel(text, typed.length);
    }
  };
}

/* the quote the caret is in (not a callout's) */
function caretQuote(selection) {
  const el = anchorElement(selection);
  const quote = el && el.closest && el.closest('#ed blockquote');
  return quote && !quote.closest('[data-callout]') ? quote : null;
}

/* Bear's callout syntax: "> [!NOTE] " (or TIP, IMPORTANT, WARNING, CAUTION) */
export function mdCallout() {
  const selection = getSelection();
  if (!selection.rangeCount || !selection.isCollapsed) return false;
  const quote = caretQuote(selection);
  if (!quote) return false;
  const match = /^\[!(note|tip|important|warning|caution)\]?[ \u00a0]$/i.exec(mdBefore(quote).replace(/\]\]/, ']'));
  if (!match) return false;
  const kind = match[1].toLowerCase();
  const { callout, title } = newCallout(kind, textAfterCaret(quote).replace(/^\]/, '').trim() || CALLOUTS[kind]);
  quote.replaceWith(callout);
  const range = document.createRange();
  range.selectNodeContents(title);
  selectRange(range);
  undoCallout(callout, '[!' + match[1] + '] ');
  return true;
}

/* a callout: its title line, and an empty line to write in */
function newCallout(kind, titleText) {
  const callout = mk('div');
  callout.setAttribute('data-callout', kind);
  const title = mk('p');
  title.setAttribute('data-cot', '');
  title.textContent = titleText;
  const body = mk('p');
  body.innerHTML = '<br>';
  callout.append(title, body);
  return { callout, title };
}

/* ⌘Z straight after: the quote back, with what was typed */
function undoCallout(callout, typed) {
  MD.last = {
    undo: () => {
      if (!callout.isConnected) return;
      const quote = mk('blockquote');
      quote.textContent = typed;
      callout.replaceWith(quote);
      mdSel(quote.firstChild, quote.firstChild.nodeValue.length);
    }
  };
}

/* "---" then a space, as in Bear: a divider (macOS may have made the first two a dash, but a dash alone isn't one) */
const RULE_TYPED = /^(-{3,}|\*{3,}|_{3,}|[—–]-+)$/;
export function mdRuleTyped() {
  const line = mdPara();
  if (!line) return false;
  const text = line.textContent;
  if (!TYPED_SPACE.test(text) || mdBefore(line) !== text) return false;
  return RULE_TYPED.test(text.slice(0, -1)) && mdRule();
}

/* "---" then Return (or a space): a divider */
export function mdRule() {
  const line = mdPara();
  if (!line || !/^(-{3,}|\*{3,}|_{3,}|—-?|–-)$/.test(line.textContent.trim()) || line.closest('[data-callout]'))
    return false;
  const rule = mk('hr');
  const after = mk('p');
  after.innerHTML = '<br>';
  line.replaceWith(rule);
  rule.after(after);
  caretInto(after);
  MD.last = null;
  return true;
}

/* ===== quotes: Return on an empty quote line (or Backspace at its start) goes back to plain text ===== */
export function quoteExit(e, back) {
  const selection = getSelection();
  if (!selection.isCollapsed || !selection.rangeCount) return false;
  const quote = caretQuote(selection);
  if (!quote) return false;
  let line = anchorElement(selection).closest('p,div,li');
  if (line && (!quote.contains(line) || line === quote)) line = null;
  const empty = line || quote;
  if (empty.textContent.replace(/\u00a0/g, '').trim() || empty.querySelector('img')) return false;
  if (back && mdBefore(empty)) return false;
  e.preventDefault();
  const plain = mk('p');
  plain.innerHTML = '<br>';
  if (line) splitQuoteAt(quote, line, plain);
  else quote.replaceWith(plain);
  caretInto(plain);
  fire();
  tbState();
  return true;
}

/* the empty line becomes a paragraph after the quote; the lines after it, a quote of their own */
function splitQuoteAt(quote, line, plain) {
  const rest = [];
  for (let next = line.nextSibling; next; next = next.nextSibling) rest.push(next);
  line.remove();
  quote.after(plain);
  if (rest.length) {
    const second = mk('blockquote');
    rest.forEach(node => second.appendChild(node));
    plain.after(second);
  }
  if (!quote.textContent.trim() && !quote.querySelector('img')) quote.remove();
}
