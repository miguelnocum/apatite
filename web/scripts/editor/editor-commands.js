import { updateToolbarState } from './toolbar-state.js';
import { caretInto, restoreSel } from '../core/caret.js';
import { $, activeEditor, openEditor, isDocView, toast, uiState } from '../core/helpers-and-state.js';
import { closestTag, fire, inEd } from '../core/caret.js';
import { makeElement, sanitize } from '../core/paste-cleaning.js';
import { noteCaretCell, rangeWithinCell } from '../tables/table-grid.js';
import { drawTableHandles, handledTable, tableLayer } from '../tables/table-handles.js';
import { refreshTableTab } from '../tables/table-tab.js';
import { toggleFocus } from '../view/focus-mode.js';
import { titleMarks } from './highlight-key.js';
import { openToolbarMenu } from './toolbar-menus.js';
import { openCiteCheck } from '../citations/citation-check.js';
import { insertTOC } from './contents.js';
import { insertFootnote } from './footnotes.js';
import { insertCitation } from '../citations/in-text-citations.js';
import { endChoosing, openSources, renderRefs } from '../citations/sources-pane.js';
import { mdTopBlock } from '../writing/writing.js';
import { inlineCode } from '../writing/inline-code.js';
import { insertMath } from '../equations/equation-drawing.js';
import { insertIMath } from '../equations/inline-equations.js';
import { setBlockType } from './block-types.js';
import { insertCallout } from './callouts.js';
import { foldAll } from './folding.js';
import { spTagSelection } from '../spec-points/spec-point-picker.js';

/* ===== the editor's commands: the toolbar's buttons and menu items, and highlighting ===== */
const NEW_TABLE_COLUMNS = 3;
const NEW_TABLE_BODY_ROWS = 2;

/* ---- highlighting: a colour from the key (0 removes it). In a highlight, it changes or goes; otherwise the selection is
   highlighted (any highlights inside it replaced) ---- */
export function applyHL(colour) {
  if (!inEd()) {
    toast('Select some text in your notes first');
    return;
  }
  const range = rangeWithinCell(getSelection().getRangeAt(0));
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  const mark = markAround(range);
  if (mark) {
    recolourMark(mark, colour);
    fire();
  } else if (range.collapsed) toast('Select some text first');
  else {
    document.execCommand('insertHTML', false, highlightedHTML(range, colour));
    titleMarks();
  }
}

/* the highlight the selection is in, if any */
function markAround(range) {
  const node = range.commonAncestorContainer;
  const element = node.nodeType === 3 ? node.parentNode : node;
  const mark = element.closest && element.closest('mark');
  return mark && activeEditor.contains(mark) ? mark : null;
}

function recolourMark(mark, colour) {
  if (colour) {
    mark.setAttribute('data-h', colour);
    titleMarks();
  } else unwrap(mark);
}

function unwrap(el) {
  while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
  el.remove();
}

/* the selection's HTML, its highlights taken out and (with a colour) each piece of its text marked */
function highlightedHTML(range, colour) {
  const box = makeElement('div');
  box.appendChild(range.cloneContents());
  box.querySelectorAll('mark').forEach(unwrap);
  if (colour) markTexts(box, colour);
  return box.innerHTML;
}

/* (whitespace between table cells and list items isn't text to mark) */
function markTexts(box, colour) {
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  texts.forEach(text => {
    if (!text.nodeValue.trim() && /^(TABLE|TBODY|THEAD|TR|UL|OL)$/.test(text.parentNode.tagName)) return;
    const mark = makeElement('mark');
    mark.setAttribute('data-h', colour);
    text.parentNode.insertBefore(mark, text);
    mark.appendChild(text);
  });
}

/* ---- commands ---- */
export function runCommand(command) {
  if (!activeEditor && command !== 'x' && command !== 'focus') {
    toast('Click into a note first');
    return;
  }
  const special = SPECIAL_COMMANDS.find(([matches]) => matches(command));
  if (special) special[1](command);
  else formatCommand(command);
}

/* a change to the text, after which the notes are saved and the toolbar updated (inline code does its own updating) */
function formatCommand(command) {
  activeEditor.focus();
  if (command === 'code') {
    inlineCode();
    return;
  }
  const format = FORMAT_COMMANDS[command] || (/^fmt:/.test(command) ? () => setHeadingOrBody(command.slice(4)) : null);
  if (format) format();
  fire();
  tableState();
  updateToolbarState();
}

/* commands that do it all themselves: [is it this command, what to do] */
const SPECIAL_COMMANDS = [
  [c => c === 'cite', citeHere],
  [c => c === 'footnote', () => insertFootnote()],
  [c => c === 'checkcites', () => openCiteCheck()],
  [c => c === 'toc', () => insertTOC()],
  [c => c === 'math', () => insertMath()],
  [c => c === 'imath', () => insertIMath()],
  [c => c === 'sptag', () => spTagSelection()],
  [c => c.indexOf('callout:') === 0, c => insertCallout(c.slice(8))],
  [c => c === 'foldall' || c === 'unfoldall', c => foldAll(c === 'foldall')],
  [c => c === 'hr', insertDivider],
  [c => c === 'media', chooseImages],
  [c => c === 'link', () => openToolbarMenu(document.getElementById('tb-ins'), 'link')],
  [c => c === 'hl', highlightWithCurrentColour],
  [c => c === 'sources', toggleSources],
  [c => c === 'focus', toggleFocus]
];

/* commands that change the text, after which the notes are saved and the toolbar updated */
const FORMAT_COMMANDS = {
  bold: () => execute('bold'),
  italic: () => execute('italic'),
  underline: () => execute('underline'),
  ul: toggleBullets,
  todo: toggleChecklist,
  strike: () => execute('strikeThrough'),
  quote: toggleQuote,
  ol: () => execute('insertOrderedList'),
  table: insertTable,
  tidy: tidyNote
};

function execute(name) {
  document.execCommand(name);
}

function citeHere() {
  const citation = insertCitation([]);
  if (citation) openSources(citation);
}

/* a divider after the block the caret is in, and an empty line after it to go on in */
function insertDivider() {
  restoreSel();
  const block = mdTopBlock(getSelection().anchorNode);
  const divider = makeElement('hr');
  const after = makeElement('p');
  after.innerHTML = '<br>';
  if (block) {
    block.after(divider);
    divider.after(after);
  } else {
    openEditor().appendChild(divider);
    openEditor().appendChild(after);
  }
  caretInto(after);
  fire();
}

/* the image picker, with the caret put back where the image goes */
function chooseImages() {
  if (uiState.lastRange) {
    activeEditor.focus({ preventScroll: true });
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(uiState.lastRange);
  }
  $('mediain').click();
}

function highlightWithCurrentColour() {
  applyHL(uiState.hlColor || '1');
  updateToolbarState();
}

function toggleSources() {
  uiState.refsOpen = !uiState.refsOpen;
  if (!uiState.refsOpen) endChoosing();
  else renderRefs();
}

/* bullets on or off (a checklist becomes plain bullets) */
function toggleBullets() {
  const checklist = closestTag('ul[data-todo]');
  if (checklist) checklist.removeAttribute('data-todo');
  else document.execCommand('insertUnorderedList');
}

/* a checklist on or off (from plain text, a numbered list or bullets) */
function toggleChecklist() {
  if (closestTag('ul[data-todo]')) {
    document.execCommand('insertUnorderedList');
    return;
  }
  const list = closestTag('ul,ol');
  if (!list || list.tagName === 'OL') document.execCommand('insertUnorderedList');
  const bullets = closestTag('ul');
  if (bullets) bullets.setAttribute('data-todo', '');
}

function toggleQuote() {
  const inQuote = closestTag('blockquote');
  if (!setBlockType(inQuote ? 'p' : 'blockquote'))
    document.execCommand('formatBlock', false, inQuote ? '<p>' : '<blockquote>');
}

function setHeadingOrBody(tag) {
  if (!setBlockType(tag)) document.execCommand('formatBlock', false, '<' + tag + '>');
}

/* a table with a header row, and a line after it to go on in */
function insertTable() {
  const cells = tag => `<tr>${`<${tag}><br></${tag}>`.repeat(NEW_TABLE_COLUMNS)}</tr>`;
  const html = `<table><tbody>${cells('th')}${cells('td').repeat(NEW_TABLE_BODY_ROWS)}</tbody></table><p><br></p>`;
  document.execCommand('insertHTML', false, html);
}

/* one font, no stray styles */
function tidyNote() {
  activeEditor.innerHTML = sanitize(activeEditor.innerHTML, false);
  toast('Note tidied: one font, no stray styles');
}

/* ---- the toolbar shows where the caret is ---- */
/* (in a table: the table tab shows, and the table's handles) */
export function tableState() {
  noteCaretCell();
  $('tb').classList.toggle('intable', !!(inEd() && closestTag('table')));
  refreshTableTab();
  const layer = openEditor() && tableLayer(openEditor());
  if (layer && layer._table !== handledTable()) drawTableHandles();
}

/* the selection in the notes is kept, to come back to after a menu or the image picker */
const onEditorCommandsSelectionchange = function () {
  if (!isDocView()) return;
  tableState();
  const selection = getSelection();
  const editor = openEditor();
  if (!editor || !selection.rangeCount || !editor.contains(selection.anchorNode)) return;
  uiState.lastRange = selection.getRangeAt(0).cloneRange();
  updateToolbarState();
};

export function initEditorCommands() {
  document.addEventListener('selectionchange', onEditorCommandsSelectionchange);
  uiState.hlColor = '1'; // set from the key once it loads (see 07-highlight-key)
}
