import { $, ed, esc, toast, ui } from '../core/helpers-and-state.js';
import { mk } from '../core/paste-cleaning.js';
import { measure } from '../syllabus/syllabus-view.js';
import { render } from '../view/page-render.js';
import { CITE_NAR, CITE_PAR, citeCandidates, saveDocSoon } from '../editor/notes-document.js';
import { edChanged } from '../editor/hydrate-and-changes.js';
import { words } from '../essays/word-count.js';
import { isDocView } from '../essays/essays.js';
import { namePart, refById, yearLabels } from './references.js';
import { hydrateCites, insertCitation } from './in-text-citations.js';
import { openSources } from './sources-pane.js';

/* ===== citation check: step through problems like Find & Replace =====
   Three kinds: citations typed as text but not linked to a source; quotations with no citation; and linked citations
   that are incomplete (no source chosen, the source removed, or a quotation's citation without a page number). */
const CC_KINDS = { unlinked: 'Unlinked', missing: 'Missing', incomplete: 'Incomplete' };
const CC_TOKEN = ''; // a linked citation's place in a block's text (one character)
const CHECKED_BLOCKS = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,figcaption';
const MIN_QUOTE_WORDS = 4; // shorter quoted words aren't quotations to cite
const LEADING_CITATION_REACH = 4; // characters into the next paragraph a block quote's citation can start
const QUOTATION = /“([^”]+)”|"([^"]+)"/g;
const CITE_CHECK_TYPING_DELAY = 500; // ms after typing before the list is checked again/* the citation forms typed as text: [pattern, form ('p' in parentheses, 'n' in the sentence)] */

let TYPED_CITATIONS;

/* the check that's open: { items, i (the one shown), filter ('all' or a kind) }, or null */
export let citeCheck = null;

/* ---- reading the notes ---- */

/* the blocks of text to check (a paragraph, list item, table cell…; not inside another, not the contents list) */
function ccBlocks(root) {
  return [...root.querySelectorAll(CHECKED_BLOCKS)].filter(block => {
    const outer = block.parentElement.closest(CHECKED_BLOCKS);
    return (!outer || !root.contains(outer)) && !block.closest('nav[data-toc]');
  });
}

/* one block as a string: text nodes in order, each linked citation as a single token (footnotes and equations left out) */
function ccMap(block) {
  const map = { block: block, text: '', segs: [], cites: [] };
  mapChildren(block, map);
  return map;
}

function mapChildren(node, map) {
  node.childNodes.forEach(child => {
    if (child.nodeType === 3) {
      map.segs.push({ node: child, start: map.text.length, end: map.text.length + child.nodeValue.length });
      map.text += child.nodeValue;
    } else if (child.nodeType !== 1) return;
    else if (child.matches('span[data-cite]')) {
      map.cites.push({ el: child, pos: map.text.length });
      map.text += CC_TOKEN;
    } else if (!child.matches('.fn,span[data-fn],[data-imath]')) mapChildren(child, map);
  });
}

/* a stretch of a block's text as a range in the page */
function ccRange(map, start, end) {
  const range = document.createRange();
  let started = false;
  for (const seg of map.segs) {
    if (!started && start >= seg.start && start <= seg.end) {
      range.setStart(seg.node, start - seg.start);
      started = true;
    }
    if (started && end >= seg.start && end <= seg.end) {
      range.setEnd(seg.node, end - seg.start);
      return range;
    }
  }
  return null;
}

/* the sentence around [a,b) in a block's text (a citation straight after the full stop still belongs to it) */
function ccSentence(text, a, b) {
  let start = a;
  while (start > 0 && !/[.!?]["”’)]?\s$/.test(text.slice(Math.max(0, start - 3), start))) start--;
  const stop = /[.!?](?=["”’)]?(\s|$))/g;
  stop.lastIndex = b;
  const found = stop.exec(text);
  let end = found ? found.index + 1 : text.length;
  while (end < text.length && /[\s]/.test(text[end]) && text.slice(end).trim()[0] === CC_TOKEN) end++;
  return [start, end];
}

/* ---- finding the problems ---- */
export function ccScan() {
  const editor = ed();
  if (!editor) return [];
  const years = yearLabels();
  const issues = ccBlocks(editor).flatMap(block => blockIssues(block, years));
  return issues.sort(inDocumentOrder).filter(issue => !(ui.ccSkip || {})[ccKey(issue)]);
}

function blockIssues(block, years) {
  const map = ccMap(block);
  const typed = [];
  return typedCitationIssues(map, years, typed).concat(linkedCitationIssues(map), quotationIssues(block, map, typed));
}

function inDocumentOrder(a, b) {
  if (a.m.block !== b.m.block)
    return a.m.block.compareDocumentPosition(b.m.block) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  return a.start - b.start;
}

/* citations typed as text: each one (not overlapping another) is an issue; typed collects where they are */
function typedCitationIssues(map, years, typed) {
  const issues = [];
  TYPED_CITATIONS.forEach(([pattern, form]) => {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(map.text))) {
      const start = match.index;
      const end = start + match[0].length;
      if (typed.some(t => start < t.end && end > t.start)) continue;
      typed.push({ start: start, end: end, pg: match[3] || '' });
      issues.push(unlinkedIssue(map, match, form, years));
    }
  });
  return issues;
}

function unlinkedIssue(map, match, form, years) {
  const who = match[1].replace(/\s+/g, ' ');
  const year = match[2];
  const candidates = citeCandidates(who, year);
  const start = match.index;
  return {
    kind: 'unlinked',
    m: map,
    start: start,
    end: start + match[0].length,
    text: match[0],
    form: form,
    pg: match[3] ? match[3].replace(/\s*[–\-]\s*/, '–') : '',
    cands: candidates,
    who: who,
    year: year,
    title: candidates.length ? 'Typed citation, not linked' : 'No source for this citation',
    note: unlinkedNote(who, year, candidates, years)
  };
}

function unlinkedNote(who, year, candidates, years) {
  if (!candidates.length) return `There is no ${esc(who)} (${esc(year)}) in this project’s Works Cited.`;
  const which =
    candidates.length === 1
      ? esc(namePart(candidates[0])) + ', ' + esc(years[candidates[0].id])
      : 'one of ' + candidates.length + ' matching sources';
  return 'Link it to ' + which + ' so it follows your Works Cited.';
}

/* linked citations with nothing behind them: no source chosen, or a source no longer in Works Cited */
const INCOMPLETE_CITATIONS = {
  empty: ['Citation with no source', 'Choose which source this citation is for.'],
  gone: ['Source removed', 'This citation’s source is no longer in Works Cited.']
};

function linkedCitationIssues(map) {
  return map.cites
    .map(cite => {
      const problem = citationProblem(cite.el);
      return problem ? incompleteCitation(map, cite, problem) : null;
    })
    .filter(Boolean);
}

function citationProblem(el) {
  const ids = citationIds(el);
  if (!ids.length) return 'empty';
  return ids.some(id => !refById(id)) ? 'gone' : null;
}

function incompleteCitation(map, cite, problem) {
  const [title, note] = INCOMPLETE_CITATIONS[problem];
  return {
    kind: 'incomplete',
    sub: problem,
    m: map,
    start: cite.pos,
    end: cite.pos + 1,
    el: cite.el,
    title: title,
    note: note
  };
}

export function citationIds(el) {
  return (el.getAttribute('data-cite') || '').split(',').filter(Boolean);
}

/* quotations: need a citation in the same sentence, and that citation needs a page number */
function quotationIssues(block, map, typed) {
  const isBlockQuote = block.tagName === 'BLOCKQUOTE';
  const quotes = quotationsIn(map.text);
  if (isBlockQuote && words(map.text) >= MIN_QUOTE_WORDS && !quotes.length) quotes.push([0, map.text.length]);
  return quotes.map(quote => quotationIssue(block, map, typed, quote, isBlockQuote)).filter(Boolean);
}

function quotationsIn(text) {
  const quotes = [];
  QUOTATION.lastIndex = 0;
  let match;
  while ((match = QUOTATION.exec(text))) {
    if (words(match[1] || match[2]) >= MIN_QUOTE_WORDS) quotes.push([match.index, match.index + match[0].length]);
  }
  return quotes;
}

/* a quotation without any citation is missing one; one cited (and linked) without a page number is incomplete
   (a typed citation in the sentence is linked first, so it isn't reported twice) */
function quotationIssue(block, map, typed, [start, end], isBlockQuote) {
  const sentence = isBlockQuote ? [0, map.text.length] : ccSentence(map.text, start, end);
  const linked = quotationCitations(block, map, sentence, isBlockQuote);
  const typedInSentence = typed.filter(t => t.start >= sentence[0] && t.end <= sentence[1]);
  if (!linked.length && !typedInSentence.length)
    return {
      kind: 'missing',
      m: map,
      start: start,
      end: end,
      quoteEnd: end,
      title: 'Quotation without a citation',
      note: 'Quotes need a citation with a page number in the same sentence.'
    };
  if (typedInSentence.length) return null;
  return pageIssue(map, linked, start, end);
}

/* the linked citations in the sentence (a block quote's may start the paragraph after it) */
function quotationCitations(block, map, sentence, isBlockQuote) {
  const inSentence = map.cites.filter(c => c.pos >= sentence[0] && c.pos < sentence[1]);
  if (!isBlockQuote || inSentence.length || !block.nextElementSibling) return inSentence;
  return ccMap(block.nextElementSibling).cites.filter(c => c.pos < LEADING_CITATION_REACH);
}

function pageIssue(map, linked, start, end) {
  if (linked.some(c => c.el.getAttribute('data-pg'))) return null;
  const single = linked.filter(c => citationIds(c.el).length === 1 && refById(c.el.getAttribute('data-cite')));
  if (!single.length) return null;
  const target = single.find(c => c.pos >= end) || single[single.length - 1];
  return {
    kind: 'incomplete',
    sub: 'page',
    m: map,
    start: start,
    end: end,
    el: target.el,
    title: 'Quotation without a page number',
    note: 'Add the page this quote is on to ' + esc(target.el.textContent) + '.'
  };
}

/* an issue's identity across checks (to remember which were skipped) */
function ccKey(issue) {
  return issue.kind + '|' + (issue.sub || '') + '|' + issue.m.text.slice(Math.max(0, issue.start - 20), issue.end + 20);
}

/* ---- the bar ---- */
export function openCiteCheck() {
  if (!isDocView() || !ed()) {
    toast('Open your notes or an essay first');
    return;
  }
  citeCheck = { items: [], i: 0, filter: 'all' };
  ui.ccSkip = {};
  ccRefresh(0);
}

export function closeCiteCheck() {
  citeCheck = null;
  const bar = $('citebar');
  if (bar) {
    bar.hidden = true;
    bar.innerHTML = '';
  }
  measure();
}

function ccVisible() {
  return citeCheck.items.filter(issue => citeCheck.filter === 'all' || issue.kind === citeCheck.filter);
}

/* checks again and shows issue number i (kept in range); quiet: the bar is updated without moving your cursor */
export function ccRefresh(i, quiet) {
  if (!citeCheck) return;
  citeCheck.items = ccScan();
  const visible = ccVisible();
  citeCheck.i = Math.max(0, Math.min(i == null ? citeCheck.i : i, visible.length - 1));
  ccRender();
  if (!quiet) ccShow();
}

/* the issue shown is selected in the notes and scrolled to */
function ccShow() {
  const issue = ccVisible()[citeCheck.i];
  if (!issue) return;
  let range = ccRange(issue.m, issue.start, issue.end);
  if (issue.el) {
    range = document.createRange();
    range.selectNode(issue.el);
  }
  if (!range) return;
  ed().focus({ preventScroll: true });
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  ui.lastRange = range.cloneRange();
  (issue.el || issue.m.block).scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function ccRender() {
  const bar = $('citebar');
  if (!bar || !citeCheck) return;
  const issue = ccVisible()[citeCheck.i];
  bar.innerHTML = ccTopHTML() + (issue ? issueRowHTML(issue) : nothingLeftHTML());
  bar.hidden = false;
  measure();
  const page = bar.querySelector('[data-ccpg]');
  if (!page) return;
  page.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    ccAct('page');
  });
}

/* the filters, where you are in the list, and closing */
function ccTopHTML() {
  const visible = ccVisible();
  const position = visible.length
    ? `<button class="cc-nav" data-ccgo="-1" aria-label="Previous">‹</button><span class="cc-pos">${citeCheck.i + 1} of ` +
      `${visible.length}</span><button class="cc-nav" data-ccgo="1" aria-label="Next">›</button>`
    : '';
  return (
    `<div class="cc-top"><b>Citation check</b><div class="cc-f" role="group" aria-label="Show">${filterButtonsHTML()}</div>` +
    `<span class="sp"></span>${position}<button class="cc-x" data-cc="close" aria-label="Close citation check">×</button></div>`
  );
}

/* All, and each kind, with how many there are */
function filterButtonsHTML() {
  const count = kind => (kind === 'all' ? citeCheck.items.length : citeCheck.items.filter(x => x.kind === kind).length);
  return [['all', 'All']]
    .concat(Object.entries(CC_KINDS))
    .map(
      ([kind, name]) =>
        `<button data-ccf="${kind}" aria-pressed="${citeCheck.filter === kind}">${name} <em>${count(kind)}</em></button>`
    )
    .join('');
}

function nothingLeftHTML() {
  return `<div class="cc-row done">${citeCheck.items.length ? 'Nothing left in this filter.' : 'All citations look complete.'}</div>`;
}

function issueRowHTML(issue) {
  return (
    `<div class="cc-row"><span class="cc-tag ${issue.kind}">${CC_KINDS[issue.kind]}</span>` +
    `<div class="cc-what"><b>${issue.title}</b><span>${issue.note}</span></div>` +
    `<div class="cc-act">${issueActionsHTML(issue)}<button class="btn sm" data-cc="skip">Skip</button></div></div>`
  );
}

/* what can be done about an issue */
function issueActionsHTML(issue) {
  if (issue.kind === 'unlinked' && issue.cands.length) return linkActionsHTML(issue);
  if (issue.kind === 'unlinked') return '<button class="btn sm" data-cc="addsrc">Add source</button>';
  if (issue.kind === 'missing') return '<button class="btn sm pri" data-cc="addcite">Add citation</button>';
  if (issue.sub === 'page')
    return (
      '<label class="cc-pg">p.<input type="text" data-ccpg placeholder="12" size="5"></label>' +
      '<button class="btn sm pri" data-cc="page">Add page</button>'
    );
  return '<button class="btn sm pri" data-cc="choose">Choose source</button><button class="btn sm" data-cc="remove">Remove</button>';
}

/* Link (a choice of source when several match), and Link all for every citation with just one match */
function linkActionsHTML(issue) {
  const years = yearLabels();
  const choice =
    issue.cands.length > 1
      ? '<select data-ccsel>' +
        issue.cands
          .map(
            r =>
              `<option value="${r.id}">${esc(namePart(r))}, ${esc(years[r.id])} — ${esc((r.raw || '').slice(0, 50))}</option>`
          )
          .join('') +
        '</select>'
      : '';
  const linkable = linkableIssues().length;
  const all = linkable > 1 ? `<button class="btn sm" data-cc="linkall">Link all ${linkable}</button>` : '';
  return choice + '<button class="btn sm pri" data-cc="link">Link</button>' + all;
}

function linkableIssues() {
  return citeCheck.items.filter(issue => issue.kind === 'unlinked' && issue.cands.length === 1);
}

/* ---- doing something about an issue ---- */

/* a typed citation becomes a linked one, keeping its form and page */
function ccLink(issue, id) {
  const range = ccRange(issue.m, issue.start, issue.end);
  if (!range) return false;
  range.deleteContents();
  const citation = mk('span');
  citation.setAttribute('data-cite', id);
  if (issue.form === 'n') citation.setAttribute('data-form', 'n');
  if (issue.pg) citation.setAttribute('data-pg', issue.pg);
  range.insertNode(citation);
  return true;
}

function ccAct(action) {
  if (action === 'close') {
    closeCiteCheck();
    return;
  }
  const issue = ccVisible()[citeCheck.i];
  if (!issue) return;
  const handler = CITE_CHECK_ACTIONS[action];
  if (!handler || handler(issue) === 'done') return; // ('done': nothing in the notes changed)
  hydrateCites();
  saveDocSoon();
  if (typeof edChanged === 'function') edChanged();
  ccRefresh(citeCheck.i);
}

/* each returns 'done' when nothing in the notes changed (or the bar has gone) */
const CITE_CHECK_ACTIONS = {
  skip: issue => {
    ui.ccSkip[ccKey(issue)] = 1;
    ccRefresh(citeCheck.i);
    return 'done';
  },
  link: issue => {
    const choice = $('citebar').querySelector('[data-ccsel]');
    ccLink(issue, choice ? choice.value : issue.cands[0].id);
  },
  /* last first, so earlier positions in the same paragraph stay valid */
  linkall: () =>
    linkableIssues()
      .reverse()
      .forEach(issue => ccLink(issue, issue.cands[0].id)),
  addsrc: issue => {
    closeCiteCheck();
    ui.view = 'wc';
    render();
    toast(`Add ${issue.who} (${issue.year}) here, then run Check citations again`);
    return 'done';
  },
  addcite: addCitationAfterQuote,
  page: addPageNumber,
  choose: issue => {
    openSources(issue.el);
    return 'done';
  },
  remove: issue => issue.el.remove()
};

/* a citation straight after the quotation, its source to be chosen */
function addCitationAfterQuote(issue) {
  const range = ccRange(issue.m, issue.quoteEnd, issue.quoteEnd);
  if (!range) return 'done';
  const selection = getSelection();
  ed().focus({ preventScroll: true });
  selection.removeAllRanges();
  selection.addRange(range);
  ui.lastRange = range.cloneRange();
  const citation = insertCitation([]);
  if (citation) openSources(citation);
}

/* the page typed in the bar ("p. 12", "12 - 13" → "12–13") */
function addPageNumber(issue) {
  const typed = ($('citebar').querySelector('[data-ccpg]') || {}).value || '';
  const page = typed
    .trim()
    .replace(/^pp?\.\s*/i, '')
    .replace(/\s*[–\-]\s*/, '–');
  if (!page) {
    toast('Type the page number');
    return 'done';
  }
  issue.el.setAttribute('data-pg', page);
}

/* ---- the bar's buttons ---- */
const onCitationCheckMousedown = function (e) {
  if (e.target.closest && e.target.closest('#citebar button')) e.preventDefault(); // the notes keep the selection
};

const onCitationCheckClick = function (e) {
  const button = e.target.closest && e.target.closest('#citebar [data-cc],#citebar [data-ccgo],#citebar [data-ccf]');
  if (!button || !citeCheck) return;
  if (button.dataset.ccf) showFilter(button.dataset.ccf);
  else if (button.dataset.ccgo) stepCiteCheck(+button.dataset.ccgo);
  else ccAct(button.dataset.cc);
};

function showFilter(filter) {
  citeCheck.filter = filter;
  citeCheck.i = 0;
  ccRender();
  ccShow();
}

/* the next (1) or previous (-1) issue, round from the last to the first */
function stepCiteCheck(by) {
  const count = ccVisible().length;
  if (!count) return;
  citeCheck.i = (citeCheck.i + by + count) % count;
  ccRender();
  ccShow();
}

/* typing elsewhere, choosing a source, switching documents: the list is kept current */
export function ccSoon() {
  if (!citeCheck) return;
  clearTimeout(ccSoon.t);
  ccSoon.t = setTimeout(() => {
    if (citeCheck && ed()) ccRefresh(citeCheck.i, true);
  }, CITE_CHECK_TYPING_DELAY);
}

export function initCitationCheck() {
  TYPED_CITATIONS = [
    [CITE_PAR, 'p'],
    [CITE_NAR, 'n']
  ];
  document.addEventListener('mousedown', onCitationCheckMousedown);
  document.addEventListener('click', onCitationCheckClick);
}
