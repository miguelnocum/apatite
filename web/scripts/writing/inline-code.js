import { updateToolbarState } from '../editor/toolbar-state.js';
import { closestTag, fire, selectRange } from '../core/caret.js';
import { openEditor, toast } from '../core/helpers-and-state.js';
import { makeElement } from '../core/paste-cleaning.js';
import { MD } from './writing.js';
import { ZW } from '../editor/caret-and-keys.js';

/* ===== inline code: the selection becomes code (or stops being code); with nothing selected, an empty piece of code
   to type in (` or Inline code again steps out of it). Built by hand: WebKit's insertHTML turns <code> into a styled span. ===== */

/* the caret just after a piece of code (in a zero-width space, if nothing follows it) */
export function codeExit(code) {
  let after = code.nextSibling;
  if (!after || after.nodeType !== 3) {
    after = document.createTextNode(ZW);
    code.after(after);
  }
  const range = document.createRange();
  range.setStart(after, after.nodeValue.charAt(0) === ZW ? 1 : 0);
  range.collapse(true);
  selectRange(range);
  MD.esc = code; // WebKit would put the next letters back inside the code: they go after it
}

export function inlineCode() {
  const editor = openEditor();
  const selection = getSelection();
  if (!editor || !selection.rangeCount || !editor.contains(selection.anchorNode)) {
    toast('Click in your notes first');
    return;
  }
  const code = closestTag('code');
  if (code && editor.contains(code)) leaveCode(code, selection);
  else makeCode(selection.getRangeAt(0), selection);
  fire();
  updateToolbarState();
}

/* in code with nothing selected: step out of it (an empty one goes); with a selection: it stops being code */
function leaveCode(code, selection) {
  if (selection.isCollapsed) {
    code.textContent = code.textContent.replace(/\u200b/g, '');
    if (!code.textContent) code.remove();
    else codeExit(code);
    return;
  }
  const first = code.firstChild;
  const last = code.lastChild;
  while (code.firstChild) code.parentNode.insertBefore(code.firstChild, code);
  code.remove();
  if (!(first && last)) return;
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  selectRange(range);
}

/* the selection as code, the caret after it; or empty code with the caret inside */
function makeCode(range, selection) {
  const code = makeElement('code');
  if (!range.collapsed) {
    code.textContent = range.toString();
    range.deleteContents();
    range.insertNode(code);
    codeExit(code);
    return;
  }
  code.textContent = ZW;
  range.insertNode(code);
  const inside = document.createRange();
  inside.setStart(code.firstChild, 1);
  inside.collapse(true);
  selection.removeAllRanges();
  selection.addRange(inside);
}
