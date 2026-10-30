/* ===== typed shortcuts inside a line: **bold**, *italic*, ==highlight==, ~~strike~~, `code`, $math$, dashes, arrows =====
   each conversion records how to put back exactly what was typed (⌘Z straight after) */
const MD_PRE = '(^|[\\s(\\[{"\'“‘—–/-])'; // what may come just before an opening mark
const MD_INLINE = [
  { re: new RegExp(MD_PRE + '\\*\\*([^*\\s](?:[^*]*?[^*\\s])?)\\*\\*$'), tag: 'strong' },
  { re: new RegExp(MD_PRE + '__([^_\\s](?:[^_]*?[^_\\s])?)__$'), tag: 'strong' },
  { re: new RegExp(MD_PRE + '==([^=\\s](?:[^=]*?[^=\\s])?)==$'), tag: 'mark' },
  { re: new RegExp(MD_PRE + '~~([^~\\s](?:[^~]*?[^~\\s])?)~~$'), tag: 's' },
  { re: new RegExp(MD_PRE + '\\*([^*\\s](?:[^*]*?[^*\\s])?)\\*$'), tag: 'em' },
  { re: new RegExp(MD_PRE + '_([^_\\s](?:[^_]*?[^_\\s])?)_$'), tag: 'em' },
  { re: /(^|[^`])`([^`\s](?:[^`]*?[^`\s])?)`$/, tag: 'code' }
];
/* a coloured circle at the start of ==highlighted text== picks the highlight's colour */
const HIGHLIGHT_EMOJI = {
  '🟡': '1',
  '🔵': '5',
  '🟣': '4',
  '🟠': '2',
  '🔴': '3',
  '🟢': '6'
};

/* the caret, when it's somewhere shortcuts work */
function shortcutCaret() {
  const caret = mdCaret();
  return caret && !mdOff(caret.node) ? caret : null;
}

/* the text from `start` to the caret is taken out, and `el` put in its place; the caret goes after it.
   Returns what was typed. */
function replaceTyped(caret, start, el) {
  const after = caret.node.splitText(caret.off);
  caret.node.nodeValue = caret.node.nodeValue.slice(0, start);
  caret.node.after(el);
  return after;
}

/* ⌘Z straight after puts the typed text back in place of what it became */
function undoToText(el, typed, normalize) {
  MD.last = {
    undo: () => {
      if (!el.isConnected) return;
      const text = document.createTextNode(typed);
      el.replaceWith(text);
      const parent = text.parentNode;
      mdSel(text, typed.length);
      if (normalize) parent.normalize();
    }
  };
}

function mdInline() {
  const caret = shortcutCaret();
  if (!caret) return false;
  for (const { re, tag } of MD_INLINE) {
    const match = re.exec(caret.before);
    if (match) {
      convertInline(caret, match, tag);
      return true;
    }
  }
  return false;
}

function convertInline(caret, match, tag) {
  const start = match.index + match[1].length;
  const typed = caret.before.slice(start);
  const el = mk(tag);
  const { text, colour } = tag === 'mark' ? highlightColour(match[2]) : { text: match[2] };
  el.textContent = text;
  if (tag === 'mark') el.setAttribute('data-h', colour);
  mdSel(replaceTyped(caret, start, el), 0);
  if (tag === 'mark') titleMarks();
  MD.esc = el;
  undoToText(el, typed, true);
}

/* the colour a coloured circle picks (if it's in the highlight key), else the colour in use */
function highlightColour(text) {
  const emoji = Object.keys(HIGHLIGHT_EMOJI).find(circle => text.indexOf(circle) === 0);
  if (!(emoji && keyOf(HIGHLIGHT_EMOJI[emoji]))) return { text, colour: ui.hlColor || '1' };
  return { text: text.slice(emoji.length).replace(/^\s+/, '') || text, colour: HIGHLIGHT_EMOJI[emoji] };
}

/* "$x^2$" in a line: an inline equation (no space just inside the dollars, so "$5 and $10" stays as it is) */
function mdIMath() {
  const caret = shortcutCaret();
  const match = caret && /(^|[^$\\\w])\$([^$\s](?:[^$]*?[^$\s\\])?)\$$/.exec(caret.before);
  if (!match) return false;
  const start = match.index + match[1].length;
  const typed = caret.before.slice(start);
  const equation = mk('span');
  equation.setAttribute('data-imath', match[2]);
  const after = replaceTyped(caret, start, equation);
  renderIMath(equation.parentNode);
  if (!after.nodeValue) after.nodeValue = ZW;
  mdSel(after, after.nodeValue === ZW ? 1 : 0);
  undoToText(equation, typed, false);
  saveDocSoon();
  return true;
}

/* "word -- word" -> "word – word" */
function mdDash() {
  const caret = shortcutCaret();
  if (!caret || !/\S[ \u00a0]--[ \u00a0]$/.test(caret.before)) return false;
  const { node, off } = caret;
  const value = node.nodeValue;
  node.nodeValue = value.slice(0, off - 3) + '–' + value.slice(off - 1);
  mdSel(node, off - 1);
  MD.last = {
    undo: () => {
      if (!node.isConnected) return;
      const now = node.nodeValue;
      if (now.charAt(off - 3) !== '–') return;
      node.nodeValue = now.slice(0, off - 3) + '--' + now.slice(off - 2);
      mdSel(node, off);
    }
  };
  return true;
}

/* arrows, as in Word: --> → , <-- ← , <--> ↔ , ==> ⇒ , <== ⇐ , <==> ⇔
   (macOS may already have turned "--" into a dash, so "—>" counts too) */
const MD_ARROWS = [
  [/(?:--|[—–])>$/, '→'],
  [/<(?:--|[—–])$/, '←'],
  [/←>$/, '↔'],
  [/==>$/, '⇒'],
  [/<==$/, '⇐'],
  [/⇐>$/, '⇔']
];

function mdArrow() {
  const caret = shortcutCaret();
  if (!caret) return false;
  const found = MD_ARROWS.map(([re, arrow]) => [re.exec(caret.before), arrow]).find(([match]) => match);
  if (!found) return false;
  const [match, arrow] = found;
  const { node, off } = caret;
  const from = off - match[0].length;
  const typed = match[0].replace(/[—–]/, '--');
  node.nodeValue = node.nodeValue.slice(0, from) + arrow + node.nodeValue.slice(off);
  mdSel(node, from + 1);
  MD.last = {
    undo: () => {
      if (!node.isConnected || node.nodeValue.charAt(from) !== arrow) return;
      node.nodeValue = node.nodeValue.slice(0, from) + typed + node.nodeValue.slice(from + 1);
      mdSel(node, from + typed.length);
    }
  };
  return true;
}
