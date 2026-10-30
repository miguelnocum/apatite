import { tbState } from '../editor/toolbar-state.js';
import { closestTag, fire, inEd } from '../core/caret.js';
import { isDocView, toast } from '../core/helpers-and-state.js';
import { cmd } from '../editor/editor-commands.js';
import { MD, anchorElement, mdCaret, mdOff, mdPara, mdSel, textAfterCaret } from './writing.js';
import { mdArrow, mdDash, mdIMath, mdInline } from './inline-shortcuts.js';
import { TYPED_SPACE, mdBlock, mdCallout, mdRule, mdRuleTyped, quoteExit } from './block-shortcuts.js';
import { codeExit } from './inline-code.js';
import { insertMath } from '../equations/equation-drawing.js';
import { ZW, blockBackspace, joinLocked, listBackspace } from '../editor/caret-and-keys.js';
import { calloutBackspace, calloutEnter } from '../editor/callout-keys.js';
import { WS, applyWS, saveWS, twScroll } from './typewriter-writing.js';

/* ===== typing in the notes: smart quotes and pairs, stepping out of formatting, the shortcuts, and their ⌘Z ===== */
const PAIRS = { '(': ')', '[': ']', '{': '}', '“': '”' };
const OPENS_QUOTE = /[\s([{“‘—–/-]/; // after these (or at the start), a quote mark opens
const PAIR_MAY_FOLLOW = /[\s.,;:!?)\]}]/; // a pair is typed whole only before these (or nothing)
const SAME_KEYSTROKE = 30; // ms within which a second input notice belongs to the same keystroke

/* the characters just before and after the caret */
function mdChars() {
  const selection = getSelection();
  const node = selection.rangeCount ? selection.anchorNode : null;
  if (!node || node.nodeType !== 3) return { b: '', a: '' };
  const offset = selection.anchorOffset;
  return { b: node.nodeValue.charAt(offset - 1), a: node.nodeValue.charAt(offset) };
}

/* typing an opening mark with text selected wraps it, keeping it selected */
function mdWrapSel(open, close) {
  const selection = getSelection();
  if (selection.isCollapsed || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (range.startContainer !== range.endContainer || range.startContainer.nodeType !== 3) return false;
  const text = range.toString();
  document.execCommand('insertText', false, open + text + close);
  const caret = mdCaret();
  if (caret) mdSel(caret.node, caret.off - 1 - text.length, caret.off - 1);
  return true;
}

function moveCaret(selection, direction) {
  selection.modify('move', direction, 'character');
}

const onTypingBeforeinput = e => {
  if (!e.target || e.target.id !== 'ed' || e.inputType !== 'insertText' || e.data == null) return;
  const selection = getSelection();
  if (!selection.rangeCount) return;
  if (MD.esc && typedAfterFormatting(e, selection)) return;
  if (e.data === '`' && selection.isCollapsed && backtickLeavesCode(e, selection)) return;
  if (mdOff(selection.anchorNode)) return;
  if (e.data === '"' || e.data === "'") typeQuote(e, selection);
  else if (PAIRS[e.data]) typePair(e, selection);
  else if (/^[)\]}]$/.test(e.data) && selection.isCollapsed && mdChars().a === e.data) {
    e.preventDefault();
    moveCaret(selection, 'forward');
  }
};

/* typing straight after a shortcut's formatting carries on in plain text */
function typedAfterFormatting(e, selection) {
  const el = MD.esc;
  MD.esc = null;
  if (!(el.isConnected && selection.isCollapsed && caretAtEndOfFormatting(el, selection))) return false;
  e.preventDefault();
  const next = el.nextSibling;
  let typed = e.data;
  /* a plain space with nothing after it isn't drawn, and the caret would slip back into the formatting */
  if (typed === ' ' && !(next && next.nodeType === 3 && /^[^\s]/.test(next.nodeValue))) typed = '\u00a0';
  let text = next;
  if (next && next.nodeType === 3) next.nodeValue = typed + next.nodeValue;
  else {
    text = document.createTextNode(typed);
    el.after(text);
  }
  mdSel(text, typed.length);
  MD.last = null;
  fire();
  return true;
}

function caretAtEndOfFormatting(el, selection) {
  const node = selection.anchorNode;
  const offset = selection.anchorOffset;
  if (el.contains(node)) return textAfterCaret(el) === '';
  if (node === el.nextSibling && offset === 0) return true;
  return node === el.parentNode && node.childNodes[offset - 1] === el;
}

/* ` at the end of a piece of code steps out of it */
function backtickLeavesCode(e, selection) {
  const el = anchorElement(selection);
  const code = el && el.closest && el.closest('#ed code');
  if (!code || textAfterCaret(code).replace(/\u200b/g, '')) return false;
  e.preventDefault();
  code.textContent = code.textContent.replace(/\u200b/g, '') || ZW;
  codeExit(code);
  fire();
  return true;
}

/* curly quotes: opening after a space or bracket, closing otherwise; typing " before its closing one steps over it */
function typeQuote(e, selection) {
  e.preventDefault();
  const around = mdChars();
  const opens = !around.b || OPENS_QUOTE.test(around.b);
  const double = e.data === '"';
  const mark = double ? (opens ? '“' : '”') : opens ? '‘' : '’';
  if (double && mdWrapSel('“', '”')) return;
  if (mark === '”' && around.a === '”') moveCaret(selection, 'forward');
  else if (mark === '“' && selection.isCollapsed && (!around.a || PAIR_MAY_FOLLOW.test(around.a))) {
    document.execCommand('insertText', false, '“”');
    moveCaret(selection, 'backward');
  } else document.execCommand('insertText', false, mark);
}

/* an opening bracket wraps the selection, or (before a space or the end) comes with its closing one */
function typePair(e, selection) {
  const open = e.data;
  if (mdWrapSel(open, PAIRS[open])) {
    e.preventDefault();
    return;
  }
  const next = mdChars().a;
  if (!(selection.isCollapsed && (!next || /[\s.,;:!?)\]}”]/.test(next)))) return;
  e.preventDefault();
  document.execCommand('insertText', false, open + PAIRS[open]);
  moveCaret(selection, 'backward');
}

/* after each letter typed: does it complete a shortcut? */
const onTypingInput = e => {
  if (!e.target || e.target.id !== 'ed') return;
  if (!e.inputType || e.isComposing) return; /* our own change notices, or text still being composed */
  /* WebKit can send a second notice for the same keystroke, straight after a conversion: that one isn't a new edit */
  const viaIME = /^insert(FromComposition|CompositionText|ReplacementText)$/.test(e.inputType);
  if (e.inputType !== 'insertText' && !viaIME) {
    if (performance.now() - MD.at > SAME_KEYSTROKE) MD.last = null;
    return;
  }
  MD.last = null;
  if (convertTyped(e.data, viaIME)) {
    MD.at = performance.now();
    fire();
  }
};

function convertTyped(data, viaIME) {
  const space = TYPED_SPACE.test(data || '') || (viaIME && TYPED_SPACE.test((mdCaret() || { before: '' }).before));
  return (
    (space && (mdCallout() || mdBlock() || mdRuleTyped() || mdDash())) ||
    (data && /[>\-=—–]$/.test(data) && mdArrow()) ||
    (data && /[*_=~`]$/.test(data) && mdInline()) ||
    (data && /\$$/.test(data) && mdIMath())
  );
}

/* ---- keys ---- */
/* ⌘1 to ⌘6 a heading (the same again: back to body text), ⌘L a list (⇧ numbered), ⌘⇧T a quote, ⌘⌥S a divider,
   ⌘⇧E an inline equation */
function listShortcut(e) {
  const level = /^Digit([1-6])$/.exec(e.code);
  if (level && !e.shiftKey && !e.altKey) return headingKey(level[1]);
  if (e.code === 'KeyL') return e.shiftKey ? 'ol' : e.altKey ? null : 'ul';
  if (e.code === 'KeyT' && e.shiftKey && !e.altKey) return 'quote';
  if (e.code === 'KeyS' && e.altKey && !e.shiftKey) return 'hr';
  if (e.code === 'KeyE' && e.shiftKey && !e.altKey) return 'imath';
  return null;
}

const onTypingKeydown = e => {
  const mod = e.metaKey || e.ctrlKey;
  if (typewriterKey(e) || !inEd()) return;
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && MD.last) {
    undoShortcut(e);
    return;
  }
  if (/^Arrow|^Home$|^End$|^Page/.test(e.key)) {
    MD.esc = null;
    MD.last = null;
  }
  if (e.key === 'Backspace' && !mod && !e.altKey && backspaceKey(e)) return;
  if (e.metaKey && !e.ctrlKey && commandKey(e)) return;
  if (e.key === 'Delete' && !mod && !e.altKey && joinLocked(e, false)) return;
  if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey) enterKey(e);
};

function headingKey(level) {
  const block = closestTag('h1,h2,h3,h4,h5,h6');
  const current = block && !block.classList.contains('ref') ? block.tagName.toLowerCase() : 'p';
  return current === 'h' + level ? 'fmt:p' : 'fmt:h' + level;
}

function commandKey(e) {
  const command = listShortcut(e);
  if (!command) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  cmd(command);
  return true;
}

/* ⌃⌘T turns typewriter scrolling on or off */
function typewriterKey(e) {
  if (!(e.key && e.key.toLowerCase() === 't' && e.metaKey && e.ctrlKey && isDocView())) return false;
  e.preventDefault();
  toggleTypewriter();
  return true;
}

function toggleTypewriter() {
  WS.tw = !WS.tw;
  saveWS();
  applyWS();
  toast('Typewriter scrolling ' + (WS.tw ? 'on' : 'off'));
  twScroll();
}

/* ⌘Z straight after a shortcut gives back what was typed, in one step */
function undoShortcut(e) {
  e.preventDefault();
  e.stopImmediatePropagation();
  const undo = MD.last;
  MD.last = null;
  MD.esc = null;
  undo.undo();
  fire();
  tbState();
}

/* Backspace between an empty pair deletes both; then the editor's own Backspaces, in turn */
function backspaceKey(e) {
  const selection = getSelection();
  const around = mdChars();
  if (
    selection.isCollapsed &&
    around.b &&
    PAIRS[around.b] &&
    around.a === PAIRS[around.b] &&
    !mdOff(selection.anchorNode)
  ) {
    e.preventDefault();
    const caret = mdCaret();
    mdSel(caret.node, caret.off - 1, caret.off + 1);
    document.execCommand('delete');
    return true;
  }
  return joinLocked(e, true) || listBackspace(e) || calloutBackspace(e) || quoteExit(e, true) || blockBackspace(e);
}

/* Return: "---" a divider, "$$" an equation, then callouts and quotes */
function enterKey(e) {
  if (mdRule()) {
    e.preventDefault();
    fire();
    return;
  }
  const line = mdPara();
  if (line && line.textContent.trim() === '$$') {
    e.preventDefault();
    insertMath(line);
    return;
  }
  if (calloutEnter(e)) return;
  quoteExit(e);
}

const onTypingMousedown = () => {
  MD.esc = null;
  MD.last = null;
};

export function initTyping() {
  document.addEventListener('beforeinput', onTypingBeforeinput, true);
  document.addEventListener('input', onTypingInput, true);
  document.addEventListener('keydown', onTypingKeydown, true);
  document.addEventListener('mousedown', onTypingMousedown, true);
}
