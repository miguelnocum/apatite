import { $, esc, toast, ui, uid } from '../core/helpers-and-state.js';
import { mk } from './paste-cleaning.js';
import { blockOf } from './pasting-and-images.js';
import { rangeWithinCell } from '../tables/table-grid.js';
import { relayout, setPaneFold } from '../view/zoom.js';
import { inFocus } from '../view/focus-mode.js';
import { ed, saveDocSoon } from './notes-document.js';
import { edChanged, hydrateExtras } from './hydrate-and-changes.js';
import { isDocView } from '../essays/essays.js';

/* ===== comments on text in notes and essays, in styles ===== */
export const CMT_TYPES = [
  { id: 'note', label: 'Comment', icon: '\u{1F4AC}', c: '#6f7d8c' },
  { id: 'q', label: 'Question', icon: '?', c: '#8a5cf6' },
  { id: 'explain', label: 'Explanation', icon: 'i', c: '#1c9ea6' },
  { id: 'research', label: 'Needs research', icon: '!', c: '#e0872a' },
  { id: 'fix', label: 'To fix', icon: '✎', c: '#d6455d' }
];
const NARROW_WINDOW = '(max-width:900px)'; // narrower than this (or in focus mode), comments are a drawer opened by a button
const QUOTE_LENGTH = 80; // characters of the commented text a card shows
const CARD_GAP = 8; // px between cards
const CARD_RAISE = 6; // px a card sits above its text's top
const FOCUS_DELAY = 30; // ms before an opened card's field takes the focus

export function cmtType(id) {
  return CMT_TYPES.find(type => type.id === id) || CMT_TYPES[0];
}

export function cmtAnchors() {
  const editor = ed();
  return editor ? [...editor.querySelectorAll('span[data-cmt]')] : [];
}

function cmtAnchor(id) {
  return ed().querySelector('[data-cmt="' + id + '"]');
}

/* comments as a drawer over the page, rather than a column beside it */
export function isNarrow() {
  return inFocus() || matchMedia(NARROW_WINDOW).matches;
}

/* the selected text gets a comment of this style (within one paragraph), and its card opens */
export function addComment(type) {
  const editor = ed();
  const selection = getSelection();
  const range = commentRange(editor, selection);
  if (!range) return;
  const anchor = mk('span');
  anchor.setAttribute('data-cmt', 'c' + uid());
  anchor.setAttribute('data-ct', type);
  anchor.setAttribute('data-note', '');
  anchor.appendChild(range.extractContents());
  range.insertNode(anchor);
  selection.removeAllRanges();
  commentAdded(editor, anchor);
}

/* the selection, cut to the end of its first paragraph; null (and why) if it can't be commented on */
function commentRange(editor, selection) {
  if (!editor || !selection.rangeCount || selection.isCollapsed || !editor.contains(selection.anchorNode)) {
    toast('Select the text you want to comment on');
    return null;
  }
  const range = rangeWithinCell(selection.getRangeAt(0));
  const block = blockOf(range.startContainer, editor);
  if (block && !block.contains(range.endContainer)) range.setEnd(block, block.childNodes.length);
  const start = range.startContainer.parentNode;
  if (start && start.closest && start.closest('span[data-cmt]')) {
    toast('That text already has a comment');
    return null;
  }
  if (!range.toString().trim()) {
    toast('Select the text you want to comment on');
    return null;
  }
  return range;
}

function commentAdded(editor, anchor) {
  unfoldForComments();
  hydrateExtras(editor);
  Object.assign(ui, { cmtOpen: true, cmtDrawer: true, cmtFilter: null, cmtActive: anchor.getAttribute('data-cmt') });
  saveDocSoon();
  edChanged();
  renderComments();
  focusOpenCard();
}

function focusOpenCard() {
  setTimeout(() => {
    const field = document.querySelector('#cmts .cmtcard.on textarea');
    if (field) field.focus();
  }, FOCUS_DELAY);
}

/* the column of cards, each level with its text; cards never overlap */
export function renderComments(keepFocus) {
  const box = $('cmts');
  if (!box) return;
  const list = isDocView() ? cmtAnchors() : [];
  const show = !!(list.length && ui.cmtOpen && !$('bodywrap').classList.contains('withrefs') && isDocView());
  showCommentColumn(box, show);
  updateCommentButton(list, show);
  box.classList.toggle('drawer-open', !!(show && isNarrow() && ui.cmtDrawer));
  if (!show) return;
  const active = document.activeElement;
  if (keepFocus && active && box.contains(active) && active.tagName === 'TEXTAREA') {
    positionCards(); // typing in a card: it stays as it is
    return;
  }
  box.innerHTML = commentsHeadHTML(list) + '<div class="cmtlayer">' + commentCardsHTML(list) + '</div>';
  positionCards();
  cmtAnchors().forEach(anchor => anchor.classList.toggle('on', anchor.getAttribute('data-cmt') === ui.cmtActive));
}

/* the column shows or hides (opened while folded by zooming: the panes come back) */
function showCommentColumn(box, show) {
  const wrap = $('bodywrap');
  const wasShown = wrap.classList.contains('withcmts');
  box.hidden = !show;
  wrap.classList.toggle('withcmts', show);
  if (show && !wasShown && wrap.classList.contains('zfold')) {
    ui.zfoldOff = true;
    setPaneFold(false);
  }
  if (wasShown !== show) relayout();
}

/* in a narrow window, a button shows how many comments there are and opens them */
function updateCommentButton(list, show) {
  let button = $('cmtfab');
  if (!button) button = makeCommentButton();
  button.hidden = !(isDocView() && list.length && isNarrow() && !(show && ui.cmtDrawer));
  button.innerHTML =
    '<span class="cmtico" style="--c:#6f7d8c">💬</span>' + list.length + ' comment' + (list.length === 1 ? '' : 's');
}

function makeCommentButton() {
  const button = mk('button');
  button.id = 'cmtfab';
  button.className = 'cmtfab';
  button.type = 'button';
  button.title = 'Show comments';
  document.body.appendChild(button);
  button.addEventListener('click', () => {
    ui.cmtOpen = true;
    ui.cmtDrawer = true;
    renderComments();
  });
  return button;
}

/* the heading, and a filter for each style in use */
function commentsHeadHTML(list) {
  const counts = {};
  list.forEach(anchor => {
    const type = anchor.getAttribute('data-ct');
    counts[type] = (counts[type] || 0) + 1;
  });
  const filters = CMT_TYPES.filter(type => counts[type.id]).map(
    type =>
      `<button data-cmtf="${type.id}" class="${ui.cmtFilter === type.id ? 'on' : ''}">` +
      `<span class="cmtico" style="--c:${type.c}">${type.icon}</span>${counts[type.id]}</button>`
  );
  return (
    '<div class="cmthd"><b>Comments</b><span class="sp"></span>' +
    '<button class="x" data-cmtclose title="Hide comments">×</button></div><div class="cmtf">' +
    `<button data-cmtf="" class="${ui.cmtFilter ? '' : 'on'}">All ${list.length}</button>` +
    filters.join('') +
    '</div>'
  );
}

function commentCardsHTML(list) {
  return list
    .filter(anchor => !ui.cmtFilter || cmtType(anchor.getAttribute('data-ct')).id === ui.cmtFilter)
    .map(commentCardHTML)
    .join('');
}

/* a card: its style, the text it's on, and its note (open: a field to write in, and Resolve / Done) */
function commentCardHTML(anchor) {
  const type = cmtType(anchor.getAttribute('data-ct'));
  const id = anchor.getAttribute('data-cmt');
  const open = ui.cmtActive === id;
  const words = anchor.textContent;
  const quote = esc(words.slice(0, QUOTE_LENGTH)) + (words.length > QUOTE_LENGTH ? '…' : '');
  return (
    `<div class="cmtcard${open ? ' on' : ''}" data-cmtid="${id}" style="--c:${type.c}">` +
    `<div class="cmtt"><span class="cmtico" style="--c:${type.c}">${type.icon}</span><span class="lab">${type.label}</span>` +
    (open ? styleMenuHTML(id, type) : '') +
    `</div><div class="cmtq">“${quote}”</div>` +
    (open
      ? openNoteHTML(id, type, anchor.getAttribute('data-note') || '')
      : closedNoteHTML(anchor.getAttribute('data-note') || '')) +
    '</div>'
  );
}

function styleMenuHTML(id, type) {
  const options = CMT_TYPES.map(
    other => `<option value="${other.id}"${other.id === type.id ? ' selected' : ''}>${other.label}</option>`
  );
  return `<select data-cmttype="${id}" aria-label="Comment style">${options.join('')}</select>`;
}

function openNoteHTML(id, type, note) {
  return (
    `<textarea data-cmtnote="${id}" placeholder="Write the ${type.label.toLowerCase()}">${esc(note)}</textarea>` +
    `<div class="cmtbtns"><button data-cmtresolve="${id}">Resolve</button><button data-cmtdone>Done</button></div>`
  );
}

function closedNoteHTML(note) {
  return `<div class="cmtn${note ? '' : ' empty'}">${note ? esc(note) : 'Click to write'}</div>`;
}

/* each card level with its text, pushed down below the one before (in a narrow window: the open card scrolled to) */
export function positionCards() {
  const box = $('cmts');
  const layer = box && box.querySelector('.cmtlayer');
  if (!layer) return;
  if (isNarrow()) {
    const open = layer.querySelector('.cmtcard.on');
    if (open && box.classList.contains('drawer-open')) open.scrollIntoView({ block: 'nearest' });
    return;
  }
  stackCards(layer);
}

function stackCards(layer) {
  const layerTop = layer.getBoundingClientRect().top;
  let next = 0;
  layer.querySelectorAll('.cmtcard').forEach(card => {
    const anchor = cmtAnchor(card.dataset.cmtid);
    if (!anchor) return;
    card.hidden = !anchor.getClientRects().length;
    if (card.hidden) return;
    const top = Math.max(next, anchor.getBoundingClientRect().top - layerTop - CARD_RAISE);
    card.style.top = top + 'px';
    next = top + card.offsetHeight + CARD_GAP;
  });
  layer.style.height = next + 'px';
}

const onCommentsWindowResize = () => {
  if (!inFocus()) renderComments(true); // (hidden in focus mode: resizing stays light)
};

/* ---- clicks: on commented text, and in the column ---- */
const COMMENT_CLICKS = [
  ['[data-cmtclose]', () => hideComments()],
  ['[data-cmtf]', filter => setCommentFilter(filter.dataset.cmtf || null)],
  ['[data-cmtresolve]', button => resolveComment(button.dataset.cmtresolve)],
  ['[data-cmtdone]', () => setActiveComment(null)],
  ['.cmtcard', card => openCard(card)]
];

const onCommentsClick = e => {
  const target = e.target;
  const anchor = target.closest && target.closest('#ed span[data-cmt]');
  if (anchor && (ui.cmtActive !== anchor.getAttribute('data-cmt') || !ui.cmtDrawer)) openFromText(anchor);
  if (!target.closest || !target.closest('#cmts')) return;
  const hit = COMMENT_CLICKS.map(([selector, act]) => [target.closest(selector), act]).find(([el]) => el);
  if (hit) hit[1](hit[0]);
};

function openFromText(anchor) {
  unfoldForComments();
  Object.assign(ui, { cmtActive: anchor.getAttribute('data-cmt'), cmtOpen: true, cmtDrawer: true, cmtFilter: null });
  renderComments();
}

/* the comments are wanted: if zooming in had folded the panes away, they come back (as when the column first opens) */
export function unfoldForComments() {
  if (!$('bodywrap').classList.contains('zfold')) return;
  ui.zfoldOff = true;
  setPaneFold(false);
}

/* the comments can be seen: open (the drawer, where they're one), and not folded away by zooming */
export function commentsShowing() {
  if (isNarrow()) return !!(ui.cmtOpen && ui.cmtDrawer && cmtAnchors().length);
  return ui.cmtOpen && !$('bodywrap').classList.contains('zfold');
}

/* in a narrow window the drawer closes; otherwise the column hides */
function hideComments() {
  if (isNarrow()) ui.cmtDrawer = false;
  else ui.cmtOpen = false;
  renderComments();
}

function setCommentFilter(filter) {
  ui.cmtFilter = filter;
  renderComments();
}

function setActiveComment(id) {
  ui.cmtActive = id;
  renderComments();
}

/* the comment goes; its text stays */
function resolveComment(id) {
  const anchor = cmtAnchor(id);
  if (anchor) {
    while (anchor.firstChild) anchor.parentNode.insertBefore(anchor.firstChild, anchor);
    anchor.remove();
  }
  ui.cmtActive = null;
  saveDocSoon();
  renderComments();
  toast('Comment resolved');
}

/* a closed card opens, its text scrolled into view */
function openCard(card) {
  if (ui.cmtActive === card.dataset.cmtid) return;
  setActiveComment(card.dataset.cmtid);
  const anchor = cmtAnchor(card.dataset.cmtid);
  if (anchor) anchor.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  focusOpenCard();
}

/* ---- writing a note, and changing a comment's style ---- */
const onCommentsInput = e => {
  const field = e.target.closest && e.target.closest('[data-cmtnote]');
  const anchor = field && cmtAnchor(field.dataset.cmtnote);
  if (!anchor) return;
  anchor.setAttribute('data-note', field.value);
  anchor.title = cmtType(anchor.getAttribute('data-ct')).label + (field.value ? ': ' + field.value : '');
  saveDocSoon();
  positionCards();
};

const onCommentsChange = e => {
  const menu = e.target.closest && e.target.closest('[data-cmttype]');
  const anchor = menu && cmtAnchor(menu.dataset.cmttype);
  if (!anchor) return;
  anchor.setAttribute('data-ct', menu.value);
  hydrateExtras(ed());
  saveDocSoon();
  renderComments();
};

export function initComments() {
  ui.cmtOpen = true;
  ui.cmtFilter = null;
  window.addEventListener('resize', onCommentsWindowResize);
  document.addEventListener('click', onCommentsClick);
  document.addEventListener('input', onCommentsInput);
  document.addEventListener('change', onCommentsChange);
}
