import { requestCommand } from '../core/commands.js';
import { keyLabel, keyShown } from './highlight-colours.js';
import { updateToolbarState } from './toolbar-state.js';
import { closeToolbarMenu, setToolbarMenu, toolbarMenu } from '../core/toolbar-menu.js';
import { closestTag, fire, restoreSel } from '../core/caret.js';
import { $, activeEditor, escapeHtml, toast, uiState } from '../core/helpers-and-state.js';
import { NATIVE } from '../core/bridge.js';
import { makeElement } from '../core/paste-cleaning.js';
import { applyHL } from './editor-commands.js';
import { ZOOMS, setZoom } from '../view/zoom.js';
import {
  CMT_TYPES,
  addComment,
  cmtAnchors,
  commentsShowing,
  isNarrow,
  renderComments,
  unfoldForComments
} from './comments.js';
import { wireCalloutSub } from './callouts.js';
import { openSettings } from '../settings/settings.js';

/* ===== the toolbar's menus: headings, lists, insert, highlight colour, zoom, comments, and the link box ===== */
const MENU_GAP = 6; // px between a toolbar button and its menu
const MENU_SIDE_MARGIN = 12; // px a menu keeps from the window's sides
/* menus that work without the caret in the notes */
const MENUS_WITHOUT_CARET = ['zoom', 'cmt'];
/* the Heading menu: [tag, name, font] */
const HEADING_STYLES = [
  ['h1', 'Title', '800 21px'],
  ['h2', 'Heading 2', '750 18px'],
  ['h3', 'Heading 3', '700 16px'],
  ['h4', 'Heading 4', '700 14.5px'],
  ['h5', 'Heading 5', '700 13.5px'],
  ['h6', 'Heading 6', '650 13px']
];

/* opens a toolbar button's menu (the same button again closes it) */
export function openToolbarMenu(button, kind) {
  const wasOpen = toolbarMenu && toolbarMenu.kind === kind;
  closeToolbarMenu();
  if (wasOpen) return;
  if (!activeEditor && !MENUS_WITHOUT_CARET.includes(kind)) toast('Click into your notes first');
  const menu = makeElement('div');
  menu.className = 'tbmenu';
  menu.setAttribute('role', 'menu');
  menu.kind = kind;
  menu.innerHTML = MENU_HTML[kind] ? MENU_HTML[kind]() : '';
  document.body.appendChild(menu);
  setToolbarMenu(menu);
  if (kind === 'list') wireCalloutSub(menu);
  positionMenu(menu, button);
  wireMenu(menu);
  if (kind === 'link') wireLinkBox(menu);
}

/* under its button; above it when there's more room there (the bar at the bottom, in focus mode), as in Bear; a menu
   taller than the room scrolls */
function positionMenu(menu, button) {
  const box = button.getBoundingClientRect();
  const maxLeft = document.documentElement.clientWidth - menu.offsetWidth - MENU_SIDE_MARGIN;
  const below = innerHeight - box.bottom - MENU_GAP - MENU_SIDE_MARGIN;
  const above = box.top - MENU_GAP - MENU_SIDE_MARGIN;
  const up = menu.offsetHeight > below && above > below;
  menu.style.maxHeight = (up ? above : below) + 'px';
  menu.style.overflowY = 'auto';
  menu.style.top = (up ? box.top - MENU_GAP - Math.min(menu.offsetHeight, above) : box.bottom + MENU_GAP) + 'px';
  menu.style.left = Math.max(MENU_SIDE_MARGIN, Math.min(box.left, maxLeft)) + 'px';
}

/* ---- the menus ---- */
const MENU_HTML = {
  head: headingMenuHTML,
  list: listMenuHTML,
  ins: insertMenuHTML,
  hl: highlightMenuHTML,
  zoom: zoomMenuHTML,
  cmt: commentMenuHTML,
  link: linkMenuHTML
};

/* Heading: spec point tagging (not in essays), Body, and the six heading levels, the current one marked */
function headingMenuHTML() {
  const block = closestTag('h1,h2,h3,h4,h5,h6');
  const current = block && !block.classList.contains('ref') ? block.tagName.toLowerCase() : 'p';
  const tagging =
    uiState.view === 'essay'
      ? ''
      : '<button data-mi="sptag"><span>Tag with spec point…<div class="sub">The paragraphs you’ve selected (or the ' +
        'one you’re in)</div></span></button><hr>';
  const levels = HEADING_STYLES.map(([tag, name, font], i) => {
    const muted = tag === 'h6' ? ';color:var(--muted)' : '';
    const on = current === tag ? 'on' : '';
    return `<button data-mi="fmt:${tag}" class="${on}" style="font:${font} var(--ui)${muted}">${name}<span class="k">⌘${i + 1}</span></button>`;
  }).join('');
  return tagging + `<button data-mi="fmt:p" class="${current === 'p' ? 'on' : ''}">Body</button>` + levels;
}

/* List: the list kinds, quote and callout (the one the caret is in marked), then divider and equations */
function listMenuHTML() {
  const todo = closestTag('ul[data-todo]');
  const on = test => (test ? 'on' : '');
  return (
    `<button data-mi="ul" class="${on(closestTag('ul') && !todo)}"><i class="lico">&#8226;</i>Bulleted list<span class="k">⌘L</span></button>` +
    `<button data-mi="ol" class="${on(closestTag('ol'))}"><i class="lico">1.</i>Numbered list<span class="k">⇧⌘L</span></button>` +
    `<button data-mi="todo" class="${on(todo)}"><i class="lico">&#9744;</i>Checklist<span class="k">[] </span></button>` +
    `<button data-mi="quote" class="${on(closestTag('blockquote'))}"><i class="lico">&#10077;</i>Quote<span class="k">⇧⌘T</span></button>` +
    `<button data-sub="callout" class="${on(closestTag('[data-callout]'))}"><i class="lico">&#9636;</i>Callout<span class="k">›</span></button>` +
    '<hr><button data-mi="hr"><i class="lico">—</i>Divider<span class="k">⌥⌘S</span></button>' +
    '<button data-mi="math"><i class="lico">∑</i>Equation<span class="k">$$ ↩</span></button>' +
    '<button data-mi="imath"><i class="lico">π</i>Inline equation<span class="k">$x$ · ⇧⌘E</span></button>'
  );
}

function insertMenuHTML() {
  return (
    '<div class="mlab">Insert</div><button data-mi="media">Image<span class="k">or paste</span></button>' +
    '<button data-mi="table">Table</button><button data-mi="link">Link<span class="k">⌘K</span></button>' +
    '<button data-mi="footnote">Footnote</button><button data-mi="toc">Table of contents</button><hr>' +
    '<div class="mlab">Format</div><button data-mi="underline">Underline<span class="k">⌘U</span></button>' +
    '<button data-mi="strike">Strikethrough<span class="k">~~text~~</span></button>' +
    '<button data-mi="code">Inline code<span class="k">`text`</span></button><hr>' +
    '<div class="mlab">Tools</div><button data-mi="checkcites">Check citations…</button>' +
    '<button data-mi="foldall">Fold all sections</button><button data-mi="unfoldall">Unfold all sections</button>' +
    '<button data-mi="tidy">Tidy this note<span class="k">fonts</span></button>'
  );
}

/* Highlight: the key's colours, each with what it means */
function highlightMenuHTML() {
  const colours = keyShown()
    .map(
      k =>
        `<button data-hc="${k.id}" class="${uiState.hlColor === k.id ? 'on' : ''}"><i style="background:${k.hex}"></i>` +
        `<span${k.meaning ? '' : ' class="none"'}>${escapeHtml(keyLabel(k))}</span></button>`
    )
    .join('');
  const editKey = NATIVE ? '<button data-mi="editkey">Edit key…</button>' : '';
  return `<div class="keyl">${colours}</div><hr><button data-mi="hl0">Remove highlight</button>${editKey}`;
}

function zoomMenuHTML() {
  const levels = ZOOMS.map(
    z => `<button data-mi="zoom:${z}" class="${uiState.zoom === z ? 'on' : ''}">${Math.round(z * 100)}%</button>`
  );
  return (
    levels.join('') +
    `<hr><button data-mi="zoom:fit" class="${uiState.zoom === 'fit' ? 'on' : ''}">Fit to Window</button>`
  );
}

function commentMenuHTML() {
  const kinds = CMT_TYPES.map(t => {
    const shortcut = t.id === 'note' ? '<span class="k">⌥⌘M</span>' : '';
    return `<button data-mi="cmt:${t.id}"><span class="cmtico" style="--c:${t.c}">${t.icon}</span>${t.label}${shortcut}</button>`;
  });
  return kinds.join('') + `<hr><button data-mi="cmtshow">${commentsShowing() ? 'Hide' : 'Show'} comments</button>`;
}

/* the link box: the link the caret is in can be changed or removed */
function linkMenuHTML() {
  const link = closestTag('a');
  return (
    `<div class="lk"><input id="lkurl" type="url" placeholder="Paste or type a web address" value="${escapeHtml(link ? link.getAttribute('href') : '')}">` +
    `<button data-mi="linkok">${link ? 'Update' : 'Add'}</button></div>` +
    (link ? '<button data-mi="unlink">Remove link</button>' : '')
  );
}

/* ---- what the menu items do ---- */
function wireMenu(menu) {
  menu.addEventListener('mousedown', e => {
    if (e.target.closest('button')) e.preventDefault(); // the notes keep the selection
  });
  menu.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button || button.disabled) return;
    const item = button.dataset.mi;
    if (!button.dataset.hc && !item) return;
    const action = MENU_ACTIONS.find(([matches]) => matches(button, item));
    if (action) action[1](button, item);
  });
}

/* [is it this item, what to do]; anything else is a command for the notes */
const MENU_ACTIONS = [
  [b => !!b.dataset.hc, b => chooseHighlightColour(b.dataset.hc)],
  [(b, item) => item === 'editkey', () => afterMenu(() => openSettings('key'))],
  [
    (b, item) => item.indexOf('zoom:') === 0,
    (b, item) => afterMenu(() => setZoom(item === 'zoom:fit' ? 'fit' : +item.slice(5)))
  ],
  [(b, item) => item.indexOf('cmt:') === 0, (b, item) => inNotes(() => addComment(item.slice(4)))],
  [(b, item) => item === 'cmtshow', () => afterMenu(toggleComments)],
  [(b, item) => item === 'linkok', addLinkFromBox],
  [(b, item) => item === 'unlink', () => inNotes(removeLink)],
  [(b, item) => item === 'hl0', () => inNotes(() => applyHL(0), true)],
  [() => true, (b, item) => inNotes(() => requestCommand(item))]
];

function afterMenu(then) {
  closeToolbarMenu();
  then();
}

/* the menu closes and the selection in the notes comes back before the item acts on it */
function inNotes(then, updateToolbar) {
  closeToolbarMenu();
  restoreSel();
  then();
  if (updateToolbar) updateToolbarState();
}

function chooseHighlightColour(id) {
  uiState.hlColor = id;
  inNotes(() => applyHL(uiState.hlColor), true);
}

/* (folded away by zooming, they're shown rather than hidden) */
function toggleComments() {
  const open = !commentsShowing();
  if (isNarrow())
    Object.assign(uiState, { cmtOpen: true, cmtDrawer: open }); // (a drawer: it opens and closes)
  else uiState.cmtOpen = open;
  if (open) unfoldForComments();
  renderComments();
  if (open && !cmtAnchors().length) toast('No comments yet: select text and add one');
}

/* the link box: an address without a scheme is taken as https:// */
function addLinkFromBox() {
  let url = $('lkurl').value.trim();
  closeToolbarMenu();
  if (!url) return;
  if (!/^[a-z]+:/i.test(url)) url = 'https://' + url;
  restoreSel();
  const link = closestTag('a');
  if (link) link.setAttribute('href', url);
  else if (getSelection().isCollapsed)
    document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
  else document.execCommand('createLink', false, url);
  fire();
  updateToolbarState();
}

/* the link goes; its text stays */
function removeLink() {
  const link = closestTag('a');
  if (link) {
    while (link.firstChild) link.parentNode.insertBefore(link.firstChild, link);
    link.remove();
    fire();
  }
  updateToolbarState();
}

/* Return adds the link, Esc leaves it */
function wireLinkBox(menu) {
  const box = $('lkurl');
  box.focus();
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      menu.querySelector('[data-mi=linkok]').click();
    } else if (e.key === 'Escape') {
      closeToolbarMenu();
      restoreSel();
    }
  });
}

/* a press anywhere else closes the menu (but not on the toolbar, whose buttons open and close menus themselves) */
const onToolbarMenusMousedown = function (e) {
  if (!toolbarMenu || toolbarMenu.contains(e.target)) return;
  if (toolbarMenu.sub && toolbarMenu.sub.contains(e.target)) return;
  if (!e.target.closest('#tb')) closeToolbarMenu();
};

export function initToolbarMenus() {
  document.addEventListener('mousedown', onToolbarMenusMousedown);
  window.addEventListener('resize', closeToolbarMenu);
}
