/* ===== keyboard shortcuts in the notes, the image picker, and checklists ===== */
const FORMAT_KEYS = { b: 'bold', i: 'italic', u: 'underline' };
const TAB_SPACE = '\u2003\u2003'; // what Tab types in ordinary text: two em spaces

document.addEventListener('keydown', onEditorShortcut);

/* Esc closes a menu; ⌘K links, ⌥⌘M comments, ⌘B/I/U format, Tab indents or moves on (the shortcuts never overlap) */
function onEditorShortcut(e) {
  const command = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (e.key === 'Escape' && tbMenu) closeTbMenu();
  else if (command && !e.shiftKey && key === 'k' && inEd()) shortcut(e, () => cmd('link'));
  else if (command && e.altKey && (key === 'm' || e.code === 'KeyM') && inEd()) shortcut(e, () => addComment('note'));
  else if (command && !e.shiftKey && !e.altKey && inEd()) formatByKey(e);
  else if (e.key === 'Tab' && !command && !e.altKey && inEd()) shortcut(e, () => tab(e.shiftKey));
}

function shortcut(e, action) {
  e.preventDefault();
  action();
}

/* ⌘B / ⌘I / ⌘U */
function formatByKey(e) {
  const format = FORMAT_KEYS[e.key.toLowerCase()];
  if (!format) return;
  e.preventDefault();
  document.execCommand(format);
  tbState();
}

/* Tab: the next table cell, or a bullet indented (⇧Tab outdents), otherwise a tab-width space; it never leaves the editor */
function tab(backwards) {
  const cell = closestTag('td,th');
  if (cell) {
    tabToCell(cell, backwards);
    return;
  }
  const item = closestTag('li');
  if (item) {
    indentListItem(item, backwards);
    return;
  }
  if (!backwards) document.execCommand('insertText', false, TAB_SPACE);
}

function tabToCell(cell, backwards) {
  const cells = [...cell.closest('table').querySelectorAll('td,th')];
  const next = cells[cells.indexOf(cell) + (backwards ? -1 : 1)];
  if (!next) return;
  const range = document.createRange();
  range.selectNodeContents(next);
  range.collapse(false);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/* an indented checklist item stays a checklist item */
function indentListItem(item, outdent) {
  const inChecklist = !!item.closest('ul[data-todo]');
  document.execCommand(outdent ? 'outdent' : 'indent');
  if (inChecklist) {
    const moved = closestTag('li');
    const list = moved && moved.parentElement;
    if (list && list.tagName === 'UL' && !list.hasAttribute('data-todo')) list.setAttribute('data-todo', '');
  }
  tbState();
}

/* pictures chosen with Insert ▸ Image */
$('mediain').addEventListener('change', function () {
  const files = [...(this.files || [])];
  this.value = '';
  if (files.length) insertImages(files);
});

/* checklists: click the box to tick it; a new line starts unticked */
document.addEventListener('mousedown', function (e) {
  const item = e.target.closest && e.target.closest('#ed ul[data-todo]>li');
  if (!item || e.clientX > item.getBoundingClientRect().left) return; // (the box is in the margin, left of the text)
  e.preventDefault();
  item.setAttribute('data-done', item.getAttribute('data-done') === '1' ? '0' : '1');
  saveDocSoon();
});

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' || !closestTag('#ed ul[data-todo]>li')) return;
  setTimeout(() => {
    const item = closestTag('#ed ul[data-todo]>li');
    if (item && !item.textContent.trim()) item.removeAttribute('data-done');
  }, 0);
});
