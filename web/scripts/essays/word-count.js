import { saveDocNow } from '../core/save-doc.js';
import { ed, ui, uid } from '../core/helpers-and-state.js';
import { mk } from '../core/paste-cleaning.js';
import { renderWordCount, updateEssayListCounts } from './word-count-sidebar.js';
import { drawBoxes } from './word-count-boxes.js';
import { hydrateCites } from '../citations/in-text-citations.js';

/* ===== an essay's word count: what's counted, and tags that group paragraphs into sections ===== */
const WC_DEFAULT = { figures: false, footnotes: true, citations: true, untagged: true, limit: null, tags: [] };
const TAG_COLORS = ['#4f7fe8', '#2f9e5b', '#e0872a', '#9b5fd6', '#d6455d', '#1c9ea6', '#b8961a', '#6b7a8c'];
/* sections named like these are shown but not counted in the total */
const WC_EXCLUDE_RE =
  /^(abstract|references?|reference list|bibliography|works cited|appendix|appendices|contents|table of contents|acknowledg(e)?ments?|list of .*)\b/i;

/* an essay's options, copied (so they can be changed and saved back) */
export function wcOpts(essay) {
  const options = Object.assign({}, WC_DEFAULT, (essay && essay.wc) || {});
  options.tags = (options.tags || []).map(tag => Object.assign({}, tag));
  return options;
}

/* a word has at least one letter or digit */
export function words(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(word => /[\p{L}\p{N}]/u.test(word)).length;
}

/* counts one block: running text, figure/table text, citation text, footnote text */
function blockCounts(el) {
  const counts = { main: 0, fig: 0, cite: 0, fn: 0 };
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) countText(node, counts);
  if (el.querySelectorAll)
    el.querySelectorAll('span[data-fn]').forEach(footnote => (counts.fn += words(footnote.getAttribute('data-fn'))));
  return counts;
}

function countText(node, counts) {
  const parent = node.parentNode;
  const count = words(node.nodeValue);
  if (!count || parent.closest('.fn') || parent.closest('[data-math],[data-imath]')) return;
  const citation = parent.closest('.cite,span[data-cite]');
  if (parent.closest('figure,figcaption,table')) counts.fig += count;
  else if (citation) countCitation(citation, node.nodeValue, count, counts);
  else counts.main += count;
}

/* a narrative citation's author is part of the sentence; only the bracketed year is citation */
function countCitation(citation, text, count, counts) {
  const bracket = text.indexOf(' (');
  if (citation.getAttribute('data-form') === 'n' && bracket > 0) {
    counts.main += words(text.slice(0, bracket));
    counts.cite += words(text.slice(bracket));
  } else counts.cite += count;
}

function counted(counts, options) {
  return (
    counts.main +
    (options.figures ? counts.fig : 0) +
    (options.citations ? counts.cite : 0) +
    (options.footnotes ? counts.fn : 0)
  );
}

export function countedIn(blocks, options) {
  return blocks.reduce((total, block) => total + counted(blockCounts(block), options), 0);
}

/* the editor's blocks, without the footnote list and the table of contents */
export function edBlocks(root) {
  return [...root.children].filter(
    block => block.id !== 'fnlist' && !(block.matches && block.matches('nav[data-toc]'))
  );
}

/* totals per tag, untagged, and the counted total (tags marked "not counted" are left out) */
export function tagCounts(root, options) {
  const totals = { by: {}, untagged: 0, total: 0 };
  const tags = {};
  options.tags.forEach(tag => {
    totals.by[tag.id] = 0;
    tags[tag.id] = tag;
  });
  edBlocks(root).forEach(block => {
    const count = counted(blockCounts(block), options);
    const tag = tags[block.getAttribute('data-wct')];
    if (tag) totals.by[tag.id] += count;
    else totals.untagged += count;
    if (tag ? !tag.exclude : options.untagged !== false) totals.total += count;
  });
  return totals;
}

/* a saved essay's total, counted from its HTML */
export function essayTotal(essay) {
  const box = mk('div');
  box.innerHTML = essay.doc || '';
  hydrateCites(box);
  return tagCounts(box, wcOpts(essay)).total;
}

export function tagById(options, id) {
  return options.tags.find(tag => tag.id === id);
}

/* the essay's tag with this name, made if there isn't one */
export function tagNamed(options, name) {
  const found = options.tags.find(tag => tag.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const tag = {
    id: 't' + uid(),
    name,
    color: TAG_COLORS[options.tags.length % TAG_COLORS.length],
    exclude: WC_EXCLUDE_RE.test(name),
    limit: null
  };
  options.tags.push(tag);
  return tag;
}

/* the paragraphs' tags changed: saved (the text is unlocked for that), and everything that shows counts redrawn */
export function tagsChanged() {
  const editor = ed();
  editor.setAttribute('contenteditable', 'true');
  saveDocNow();
  editor.setAttribute('contenteditable', ui.wcMode ? 'false' : 'true');
  renderWordCount();
  updateEssayListCounts();
  drawBoxes();
}
