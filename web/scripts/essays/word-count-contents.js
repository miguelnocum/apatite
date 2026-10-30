import { esc, toast, ui } from '../core/helpers-and-state.js';
import { Store } from '../core/storage.js';
import { flash } from '../view/page-render.js';
import { ed } from '../editor/notes-document.js';
import { countedIn, edBlocks, tagById, tagNamed, tagsChanged, wcOpts } from './word-count.js';
import { curEssay } from './essays.js';

/* ===== tagging from the contents: a heading and everything under it, down to the next heading at its level ===== */
function headingLevel(el) {
  const match = /^H([1-6])$/.exec(el.tagName || '');
  return match && !el.classList.contains('ref') ? +match[1] : 0;
}

/* the level chapters are at: the highest heading level used */
function topLevel(ranges) {
  return ranges.length ? Math.min(...ranges.map(range => range.level)) : 0;
}

function headingRanges(root) {
  const blocks = edBlocks(root);
  const ranges = [];
  blocks.forEach((block, i) => {
    const level = headingLevel(block);
    if (!level || !block.textContent.trim()) return;
    const range = [block];
    for (let k = i + 1; k < blocks.length; k++) {
      const next = headingLevel(blocks[k]);
      if (next && next <= level) break;
      range.push(blocks[k]);
    }
    ranges.push({ el: block, level, title: block.textContent.trim(), blocks: range });
  });
  return ranges;
}

/* "1 Introduction" -> "Introduction", "Chapter 2: Methods" -> "Methods" */
function sectionName(title) {
  return (
    title
      .replace(/^\s*(chapter|part|section)\s+[\divxlc]+[.:\s–-]*/i, '')
      .replace(/^\s*\d+(\.\d+)*\.?\s+/, '')
      .trim() || title.trim()
  );
}

/* the one tag covering all of a range, if there is one */
function rangeTag(options, blocks) {
  const tagId = blocks[0].getAttribute('data-wct');
  if (!tagId || !tagById(options, tagId)) return null;
  return blocks.every(block => block.getAttribute('data-wct') === tagId) ? tagById(options, tagId) : null;
}

export function contentsPanel(editor, options) {
  const ranges = headingRanges(editor);
  const head = `<details class="wctoc"${ui.wcTocOpen !== false ? ' open' : ''}><summary>Contents</summary>`;
  if (!ranges.length)
    return (
      head + '<p class="wchint">Add headings (Heading 1 for chapters) to tag whole sections from here.</p></details>'
    );
  const chapters = ranges.filter(range => range.level === topLevel(ranges)).length;
  const tagAll = chapters
    ? `<button type="button" class="wctocall" data-wctocall="1">Tag every chapter (${chapters})</button>`
    : '';
  return head + tagAll + ranges.map((range, i) => contentsRowHTML(range, i, options)).join('') + '</details>';
}

/* a heading's row: its own tag (named after it), or one it sits inside (its chapter's), or none yet */
function contentsRowHTML(range, i, options) {
  const tag = rangeTag(options, range.blocks);
  const name = sectionName(range.title);
  const own = tag && tag.name.toLowerCase() === name.toLowerCase();
  let tip = 'Tag “' + name + '” and everything under it';
  if (own) tip = 'Tagged as ' + tag.name;
  else if (tag) tip = 'Counted in ' + tag.name + '. Click to count it separately';
  const end = own
    ? `<button type="button" class="untag" data-wctocun="${i}" aria-label="Untag ${esc(range.title)}">×</button>`
    : '<span class="plus" aria-hidden="true">+</span>';
  return (
    `<div class="wctoci lv${range.level}${own ? ' on' : tag ? ' inh' : ''}" data-wctoc="${i}" title="${esc(tip)}">` +
    `<i class="dot" style="${tag ? 'background:' + tag.color : ''}"></i><span class="nm">${esc(range.title)}</span>` +
    `<b>${countedIn(range.blocks, options).toLocaleString()}</b>${end}</div>`
  );
}

/* tag several ranges with one save; tags left with no paragraphs go */
function tagRanges(ranges) {
  const essay = curEssay();
  if (!essay) return;
  essay.wc = wcOpts(essay);
  ranges.forEach(range => {
    const tag = tagNamed(essay.wc, sectionName(range.title));
    range.blocks.forEach(block => block.setAttribute('data-wct', tag.id));
  });
  const used = new Set(edBlocks(ed()).map(block => block.getAttribute('data-wct')));
  essay.wc.tags = essay.wc.tags.filter(tag => used.has(tag.id));
  Store.saveEssays();
  tagsChanged();
}

function tagEveryChapter() {
  const ranges = headingRanges(ed());
  const level = topLevel(ranges);
  tagRanges(ranges.filter(range => range.level === level));
  toast('Tagged every chapter');
}

function untagRange(button) {
  const range = headingRanges(ed())[+button.dataset.wctocun];
  if (!range) return;
  range.blocks.forEach(block => block.removeAttribute('data-wct'));
  tagRanges([]);
}

/* a row already tagged as itself shows where it is; any other is tagged */
function contentsRowClicked(row) {
  const range = headingRanges(ed())[+row.dataset.wctoc];
  if (!range) return;
  if (!row.classList.contains('on')) {
    tagRanges([range]);
    return;
  }
  range.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  flash(range.el);
}

const onWordCountContentsClick = e => {
  const target = e.target;
  if (!target.closest) return;
  if (target.closest('[data-wctocall]')) {
    tagEveryChapter();
    return;
  }
  const untag = target.closest('[data-wctocun]');
  if (untag) {
    e.stopPropagation();
    untagRange(untag);
    return;
  }
  const row = target.closest('[data-wctoc]');
  if (row) contentsRowClicked(row);
};

const onWordCountContentsToggle = e => {
  if (e.target.classList && e.target.classList.contains('wctoc')) ui.wcTocOpen = e.target.open;
};

export function initWordCountContents() {
  document.addEventListener('click', onWordCountContentsClick);
  document.addEventListener('toggle', onWordCountContentsToggle, true);
}
