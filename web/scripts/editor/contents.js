import { saveDocSoon } from '../core/save-doc.js';
import { closestTag } from '../core/caret.js';
import { openEditor, escapeHtml, toast } from '../core/helpers-and-state.js';
import { makeElement } from '../core/paste-cleaning.js';
import { flash } from '../view/page-render.js';
import { notesEdited } from './hydrate-and-changes.js';
import { emptyLine } from './callouts.js';

/* ===== table of contents: every heading, indented by level, kept up to date; click to jump ===== */
function tocHeadings(root) {
  return [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(
    heading =>
      !heading.classList.contains('ref') &&
      !heading.closest('nav[data-toc]') &&
      !heading.closest('[data-callout]') &&
      heading.textContent.trim()
  );
}

export function renderTOC(root) {
  root = root || openEditor();
  if (!root) return;
  const navs = root.querySelectorAll('nav[data-toc]');
  if (!navs.length) return;
  const html = '<div class="toc-h">Contents</div>' + contentsListHTML(tocHeadings(root));
  navs.forEach(nav => {
    nav.setAttribute('contenteditable', 'false');
    if (nav.innerHTML !== html) nav.innerHTML = html;
  });
}

function contentsListHTML(headings) {
  if (!headings.length) return '<p class="toc-empty">Headings you add will be listed here.</p>';
  const items = headings.map(
    (heading, i) =>
      `<li class="toc-${heading.tagName.toLowerCase()}" data-toci="${i}">${escapeHtml(heading.textContent.trim())}</li>`
  );
  return `<ol class="toc-l">${items.join('')}</ol>`;
}

/* after the line the caret is on (or at the top); one per document */
export function insertTOC() {
  const editor = openEditor();
  if (!editor) return;
  const existing = editor.querySelector('nav[data-toc]');
  if (existing) {
    existing.scrollIntoView({ block: 'center' });
    toast('This document already has a table of contents');
    return;
  }
  const block = topBlockAtCaret(editor);
  const nav = makeElement('nav');
  nav.setAttribute('data-toc', '');
  if (block) block.after(nav);
  else editor.insertBefore(nav, editor.firstChild);
  if (!nav.nextElementSibling) nav.after(emptyLine());
  renderTOC();
  saveDocSoon();
  notesEdited();
  nav.scrollIntoView({ block: 'center' });
}

/* the editor's child the caret's line is in */
function topBlockAtCaret(editor) {
  let block = closestTag('p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table,figure');
  while (block && block.parentNode !== editor) block = block.parentNode;
  return block;
}

const onContentsClick = e => {
  const item = e.target.closest && e.target.closest('#ed nav[data-toc] li[data-toci]');
  const heading = item && tocHeadings(openEditor())[+item.dataset.toci];
  if (!heading) return;
  heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
  flash(heading);
};

export function initContents() {
  document.addEventListener('click', onContentsClick);
}
