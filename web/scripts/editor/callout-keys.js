import { caretInto, fire, selectRange } from '../core/caret.js';
import { makeElement } from '../core/paste-cleaning.js';
import { anchorElement, mdBefore } from '../writing/writing.js';
import { emptyLine } from './callouts.js';
import { CALLOUTS } from '../core/callout-kinds.js';

/* ===== Return and Backspace in callouts ===== */

/* the callout the caret is in, and the element the caret is in */
function caretCallout(selection) {
  const el = anchorElement(selection);
  const callout = el && el.closest && el.closest('#ed [data-callout]');
  return callout ? { el, callout } : null;
}

function hasContent(el) {
  return !!(el.textContent.trim() || el.querySelector('img'));
}

/* Return on an empty last line leaves the callout (in pros and cons, the first one moves you across to the cons) */
export function calloutEnter(e) {
  const selection = getSelection();
  const at = selection.isCollapsed ? caretCallout(selection) : null;
  if (!at) return false;
  const title = at.el.closest('[data-cot]');
  if (title && at.callout.contains(title)) {
    e.preventDefault();
    titleEnter(title);
    return true;
  }
  const line = at.el.closest('li,p');
  if (!line || !at.callout.contains(line) || hasContent(line)) return false;
  const left = line.tagName === 'LI' ? leaveCalloutList(e, line, at.callout) : leaveCalloutLine(e, line, at.callout);
  if (left !== 'out') return left === 'moved';
  const after = emptyLine();
  at.callout.after(after);
  caretInto(after);
  fire();
  return true;
}

/* Return in the title goes to the first line (made if there isn't one) */
function titleEnter(title) {
  let next = title.nextElementSibling;
  if (!next) {
    next = emptyLine();
    title.after(next);
  }
  caretInto(next);
}

/* an empty last bullet: in the pros, over to the cons ('moved'); otherwise out of the callout ('out'), or not ('no') */
function leaveCalloutList(e, item, callout) {
  const side = item.closest('[data-side]');
  const list = item.parentElement;
  if (list.lastElementChild !== item || list.parentElement !== (side || callout)) return 'no';
  e.preventDefault();
  if (list.children.length > 1) item.remove();
  if (!(side && side.getAttribute('data-side') === 'pro')) return 'out';
  toTheCons(callout);
  fire();
  return 'moved';
}

/* the caret on the cons' last bullet (a new one, if the last has words) */
function toTheCons(callout) {
  const cons = callout.querySelector('[data-side=con] ul,[data-side=con] ol');
  let target = cons && cons.lastElementChild;
  if (target && target.textContent.trim()) {
    target = emptyLine('li');
    cons.appendChild(target);
  }
  if (target) caretInto(target);
}

/* an empty last line (not the only one): out of the callout, the line gone if there are others */
function leaveCalloutLine(e, line, callout) {
  if (line.parentElement !== callout || callout.lastElementChild !== line || callout.children.length < 2) return 'no';
  e.preventDefault();
  if (callout.children.length > 2) line.remove();
  return 'out';
}

/* Backspace in an empty callout turns it back into a plain line */
export function calloutBackspace(e) {
  const selection = getSelection();
  const at = selection.isCollapsed ? caretCallout(selection) : null;
  if (!at) return false;
  const title = at.callout.querySelector(':scope>[data-cot]');
  const body = [...at.callout.children].filter(child => child !== title);
  if (!title) return untitledBackspace(e, at.callout);
  if (title.contains(selection.anchorNode)) return titleBackspace(e, at.callout, title, body);
  /* at the start of the first line under the title: up into the title */
  const line = at.el.closest('p,li,div');
  if (!line || line === at.callout || body[0] !== line || mdBefore(line)) return false;
  e.preventDefault();
  if (!hasContent(line) && body.length > 1) line.remove();
  const range = document.createRange();
  range.selectNodeContents(title);
  range.collapse(false);
  selectRange(range);
  fire();
  return true;
}

/* a callout without a title (pros and cons): an empty one becomes a line */
function untitledBackspace(e, callout) {
  if (hasContent(callout)) return false;
  e.preventDefault();
  replaceCallout(callout, emptyLine());
  return true;
}

/* at the start of the title of an empty callout: back to a plain line, keeping the title's words (unless they're the
   usual title) */
function titleBackspace(e, callout, title, body) {
  if (mdBefore(title) || body.some(hasContent)) return false;
  e.preventDefault();
  const line = makeElement('p');
  if (hasContent(title) && title.textContent.trim() !== CALLOUTS[callout.getAttribute('data-callout')])
    line.textContent = title.textContent;
  else line.innerHTML = '<br>';
  replaceCallout(callout, line);
  return true;
}

function replaceCallout(callout, line) {
  callout.replaceWith(line);
  caretInto(line);
  fire();
}
