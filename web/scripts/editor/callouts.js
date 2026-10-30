import { requestCommand } from '../core/commands.js';
import { closeToolbarMenu } from '../core/toolbar-menu.js';
import { fire, restoreSel, selectRange } from '../core/caret.js';
import { openEditor } from '../core/helpers-and-state.js';
import { makeElement } from '../core/paste-cleaning.js';
import { CALLOUTS } from '../core/callout-kinds.js';
import { mdTopBlock } from '../writing/writing.js';

/* ===== callouts ===== */
const CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'];
const SUBMENU_MARGIN = 12; // px a submenu keeps from the window's bottom
const SUBMENU_GAP = 4; // px between a submenu and its menu
const CALLOUT_SUBMENU_HTML = () =>
  CALLOUT_TYPES.map(
    kind => `<button data-mi="callout:${kind}"><i class="coi" data-k="${kind}"></i>${CALLOUTS[kind]}</button>`
  ).join('') +
  '<hr><button data-mi="callout:def"><i class="coi" data-k="def"></i>Definition</button>' +
  '<button data-mi="callout:pc"><i class="coi" style="background:linear-gradient(90deg,#2f9e5b 50%,#d6453d 50%)"></i>' +
  'Advantages vs disadvantages</button>';

/* ---- the List menu's Callout submenu: opens on hover (or click); the menu's other items close it ---- */
export function wireCalloutSub(menu) {
  const trigger = menu.querySelector('[data-sub="callout"]');
  if (!trigger) return;
  const open = () => {
    if (!menu.sub) menu.sub = openCalloutSubmenu(trigger);
  };
  const close = () => {
    if (!menu.sub) return;
    menu.sub.remove();
    menu.sub = null;
    trigger.classList.remove('hov');
  };
  trigger.addEventListener('mouseenter', open);
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    if (menu.sub) close();
    else open();
  });
  menu.querySelectorAll('button:not([data-sub])').forEach(button => button.addEventListener('mouseenter', close));
}

/* beside its item (on the left when there's no room on the right) */
function openCalloutSubmenu(trigger) {
  const submenu = makeElement('div');
  submenu.className = 'tbmenu tbsub';
  submenu.setAttribute('role', 'menu');
  submenu.innerHTML = CALLOUT_SUBMENU_HTML();
  document.body.appendChild(submenu);
  trigger.classList.add('hov');
  placeSubmenu(submenu, trigger.getBoundingClientRect());
  submenu.addEventListener('mousedown', e => {
    if (e.target.closest('button')) e.preventDefault();
  });
  submenu.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    closeToolbarMenu();
    restoreSel();
    requestCommand(button.dataset.mi);
  });
  return submenu;
}

function placeSubmenu(submenu, box) {
  const width = submenu.offsetWidth;
  const room = document.documentElement.clientWidth;
  submenu.style.top = Math.min(box.top - 6, innerHeight - submenu.offsetHeight - SUBMENU_MARGIN) + 'px';
  submenu.style.left = (box.right + width + 8 > room ? box.left - width - SUBMENU_GAP : box.right + SUBMENU_GAP) + 'px';
}

/* older callouts get a title line, as Bear's have */
export function upgradeCallouts(root) {
  (root || openEditor()).querySelectorAll('[data-callout]').forEach(callout => {
    let kind = callout.getAttribute('data-callout');
    if (kind === 'warn') {
      kind = 'warning';
      callout.setAttribute('data-callout', kind);
    }
    if (kind === 'pc' || (callout.firstElementChild && callout.firstElementChild.hasAttribute('data-cot'))) return;
    callout.insertBefore(calloutTitle(kind), callout.firstChild);
  });
}

function calloutTitle(kind) {
  const title = makeElement('p');
  title.setAttribute('data-cot', '');
  title.textContent = CALLOUTS[kind] || 'Note';
  return title;
}

export function emptyLine(tag = 'p') {
  const line = makeElement(tag);
  line.innerHTML = '<br>';
  return line;
}

/* ---- a new callout where the caret is ---- */
export function insertCallout(kind) {
  const editor = openEditor();
  if (!editor) return;
  restoreSel();
  const selection = getSelection();
  let block = selection.rangeCount ? mdTopBlock(selection.anchorNode) : null;
  if (block && block.closest && block.closest('[data-callout]')) block = block.closest('[data-callout]');
  const callout = makeElement('div');
  callout.setAttribute('data-callout', kind);
  let first = fillCallout(callout, kind);
  first = putCallout(callout, block, kind, first, editor);
  if (!callout.nextElementSibling) callout.after(emptyLine());
  const range = document.createRange();
  range.selectNodeContents(first);
  range.collapse(false);
  selectRange(range);
  editor.focus({ preventScroll: true });
  fire();
}

/* a title and an empty line; or, for pros and cons, two lists. Returns where writing starts. */
function fillCallout(callout, kind) {
  if (kind === 'pc') {
    callout.innerHTML =
      '<div data-side="pro"><ul><li><br></li></ul></div><div data-side="con"><ul><li><br></li></ul></div>';
    return callout.querySelector('li');
  }
  const first = emptyLine();
  callout.append(calloutTitle(kind), first);
  return first;
}

/* in place of an empty line; around a line of text (it becomes the callout's first line); else after the block */
function putCallout(callout, block, kind, first, editor) {
  const isLine = block && block.tagName === 'P';
  if (isLine && !block.textContent.trim() && !block.querySelector('img')) block.replaceWith(callout);
  else if (isLine && kind !== 'pc') {
    block.replaceWith(callout);
    callout.replaceChild(block, first);
    return block;
  } else if (block) block.after(callout);
  else editor.appendChild(callout);
  return first;
}
