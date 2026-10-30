/* ===== the notes' own pieces drawn (comments, pictures, contents, footnotes, callouts, equations), and what follows
   an edit ===== */
const COMMENTS_AFTER_EDIT = 300; // ms after the last edit before the comment cards move
const CONTENTS_AFTER_EDIT = 400; // …the contents, folds and spec point brackets are redrawn
const FOOTNOTES_AFTER_EDIT = 250; // …the footnotes and word count are redrawn
let edTimer = null;
let commentsTimer = null;
let contentsTimer = null;

function hydrateExtras(root) {
  root = root || ed();
  if (!root) return;
  root.querySelectorAll('span[data-cmt]').forEach(styleComment);
  if (root === ed()) setTimeout(() => renderComments(true), 0);
  root.querySelectorAll('img').forEach(img => img.setAttribute('draggable', 'false'));
  titleMarks(root);
  renderTOC(root);
  root.querySelectorAll('span[data-fn]').forEach(styleFootnote);
  if (root === ed()) hydrateEditor(root);
}

/* a comment's colour and tooltip, from its style and note */
function styleComment(anchor) {
  anchor.classList.add('cmt');
  const type = cmtType(anchor.getAttribute('data-ct'));
  anchor.style.setProperty('--cc', type.c);
  anchor.title = type.label + (anchor.getAttribute('data-note') ? ': ' + anchor.getAttribute('data-note') : '');
}

function styleFootnote(marker) {
  marker.classList.add('fn');
  marker.setAttribute('contenteditable', 'false');
  marker.title = marker.getAttribute('data-fn') || 'Empty footnote';
}

/* the open editor's: footnotes, callouts, equations and caret places now; room, folds and brackets once it's laid out */
function hydrateEditor(root) {
  renderFootnotes();
  upgradeCallouts(root);
  renderMath(root);
  renderIMath(root);
  caretAnchors(root);
  setTimeout(() => {
    ensureRoom();
    applyFolds();
    watchFolds();
    drawSp();
  }, 0);
}

/* after an edit: each thing that shows the notes catches up a moment after typing stops */
function edChanged() {
  if (imgSel) setTimeout(placeImgTool, 0);
  ccSoon();
  clearTimeout(commentsTimer);
  commentsTimer = setTimeout(() => renderComments(true), COMMENTS_AFTER_EDIT);
  clearTimeout(contentsTimer);
  contentsTimer = setTimeout(contentsChanged, CONTENTS_AFTER_EDIT);
  clearTimeout(edTimer);
  edTimer = setTimeout(() => {
    renderFootnotes();
    if (ui.view === 'essay') renderWordCount();
  }, FOOTNOTES_AFTER_EDIT);
}

function contentsChanged() {
  renderTOC();
  ensureRoom();
  applyFolds();
  drawSp();
  caretAnchors();
  if (ui.view === 'notes') renderSpPanel();
}
