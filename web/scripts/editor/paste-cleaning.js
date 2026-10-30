import { esc } from '../core/helpers-and-state.js';
import { CALLOUTS } from './callouts.js';

/* ===== cleaning HTML (pasted, or loaded from a file): only what notes can hold is kept, the rest unwrapped or dropped ===== */
/* elements kept, and what they become */
// prettier-ignore
const KEEP = {
  H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h5', H6: 'h6',
  HR: 'hr', BR: 'br', P: 'p', DIV: 'p', BLOCKQUOTE: 'blockquote',
  STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', U: 'u', S: 's', STRIKE: 's', DEL: 's',
  SUB: 'sub', SUP: 'sup', CODE: 'code', MARK: 'mark', A: 'a',
  UL: 'ul', OL: 'ol', LI: 'li',
  TABLE: 'table', THEAD: 'thead', TBODY: 'tbody', TR: 'tr', TH: 'th', TD: 'td', COLGROUP: 'colgroup', COL: 'col'
};
/* elements dropped with everything in them */
// prettier-ignore
const DROP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'IMG', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME',
  'OBJECT', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'NOSCRIPT']);
/* containers whose whitespace between children isn't text */
const STRUCTURAL = new Set(['TABLE', 'THEAD', 'TBODY', 'TR', 'UL', 'OL', 'COLGROUP']);
const BOLD_WEIGHT = 600; // a font weight at least this is bold
/* attributes a kept element keeps: [attribute, on which kinds of element, how its value is copied] */
const KEPT_ATTRIBUTES = [
  ['data-wct', /^(p|h[1-6]|ul|ol|blockquote|table)$/, 'value'],
  ['data-sp', /^(p|h[1-6]|ul|ol|blockquote|table|hr)$/, 'value'],
  ['colspan', /^t[dh]$/, 'span'],
  ['rowspan', /^t[dh]$/, 'span'],
  ['style', /^(table|col|tr|td|th)$/, 'style'],
  ['data-ts', /^table$/, 'value'],
  ['data-tpad', /^table$/, 'value'],
  ['data-band', /^table$/, 'present'],
  ['data-fcol', /^table$/, 'present'],
  ['data-fixed', /^table$/, 'present'],
  ['data-shade', /^t[dh]$/, 'value'],
  ['data-h', /^mark$/, 'value'],
  ['data-todo', /^ul$/, 'present'],
  ['data-fold', /^h[1-6]$/, 'present'],
  ['data-cot', /^p$/, 'present'],
  ['data-done', /^li$/, 'one']
];
/* image widths are kept in steps of this many percent, between these */
const IMAGE_WIDTH_STEP = 5;
const IMAGE_WIDTH_MIN = 5;
const IMAGE_WIDTH_MAX = 100;
/* the only styles kept, and only on tables: [property, on which elements, the values it may have] */
const TABLE_PX = /^\d{1,3}(\.\d+)?px$/;
const KEPT_STYLES = [
  ['width', /^col$/, /^\d{1,3}(\.\d+)?%$/],
  ['height', /^tr$/, TABLE_PX],
  ['--row-h', /^table$/, TABLE_PX],
  ['--tfs', /^table$/, TABLE_PX],
  ['--tlh', /^table$/, /^[0-3](\.\d+)?$/],
  ['text-align', /^t[dh]$/, /^(left|center|right|justify)$/],
  ['vertical-align', /^t[dh]$/, /^(top|middle|bottom)$/]
];

export function mk(tag) {
  return document.createElement(tag);
}

/* copies what's allowed of src's children into dst */
function walk(src, dst) {
  src.childNodes.forEach(node => cleanNode(node, dst));
}

function cleanNode(node, dst) {
  if (node.nodeType === 3) {
    if (STRUCTURAL.has(dst.tagName) && !node.nodeValue.trim()) return;
    dst.appendChild(document.createTextNode(node.nodeValue.replace(/\u200b/g, '').replace(/\u00a0/g, ' ')));
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toUpperCase();
  const special = SPECIAL_ELEMENTS.find(([is]) => is(node, tag));
  if (special) special[1](node, dst);
  else if (!DROP.has(tag)) cleanElement(node, tag, dst);
}

/* ---- the notes' own elements, kept with the attributes that make them what they are ---- */
const SPECIAL_ELEMENTS = [
  [(n, tag) => tag === 'IMG', copyImage],
  [(n, tag) => tag === 'DIV' && !!CALLOUTS[n.getAttribute('data-callout')], copyCallout],
  [
    (n, tag) => tag === 'DIV' && /^(pro|con)$/.test(n.getAttribute('data-side') || ''),
    (n, dst) => dst.appendChild(copyWith('div', n, ['data-side']))
  ],
  [(n, tag) => tag === 'DIV' && n.hasAttribute('data-math'), copyEquation],
  [
    (n, tag) => tag === 'NAV' && n.hasAttribute('data-toc'),
    (n, dst) => dst.appendChild(mk('nav')).setAttribute('data-toc', '')
  ],
  [(n, tag) => tag === 'FIGURE', copyFigure],
  [(n, tag) => tag === 'FIGCAPTION', (n, dst) => dst.appendChild(copyWith('figcaption', n, []))],
  [(n, tag) => tag === 'SPAN' && n.hasAttribute('data-cmt'), copyComment],
  [
    (n, tag) => tag === 'SPAN' && n.hasAttribute('data-imath'),
    (n, dst) => dst.appendChild(emptyWith('span', n, 'data-imath'))
  ],
  [
    (n, tag) => tag === 'SPAN' && n.hasAttribute('data-fn'),
    (n, dst) => dst.appendChild(emptyWith('span', n, 'data-fn'))
  ],
  [(n, tag) => tag === 'SPAN' && n.hasAttribute('data-cite'), copyCitation]
];

/* a new element with the same children (cleaned), and the given attributes when they have a value */
function copyWith(tag, node, attributes) {
  const copy = mk(tag);
  attributes.forEach(a => {
    if (node.getAttribute(a)) copy.setAttribute(a, node.getAttribute(a));
  });
  walk(node, copy);
  return copy;
}

/* an element of the notes that holds no text of its own (an equation, a footnote): its one attribute, even if empty */
function emptyWith(tag, node, attribute) {
  const copy = mk(tag);
  copy.setAttribute(attribute, node.getAttribute(attribute) || '');
  return copy;
}

/* only the notes' own pictures (data-nb), with their width (rounded to a step) and wrap */
function copyImage(node, dst) {
  const src = node.getAttribute('src') || '';
  if (!node.hasAttribute('data-nb') || !src) return;
  const image = mk('img');
  image.setAttribute('src', src);
  image.setAttribute('data-nb', '1');
  image.setAttribute('alt', node.getAttribute('alt') || '');
  const width = +node.getAttribute('data-w');
  if (width >= IMAGE_WIDTH_MIN && width <= IMAGE_WIDTH_MAX)
    image.setAttribute('data-w', String(Math.round(width / IMAGE_WIDTH_STEP) * IMAGE_WIDTH_STEP));
  const wrap = node.getAttribute('data-wrap');
  if (wrap === 'left' || wrap === 'right') image.setAttribute('data-wrap', wrap);
  dst.appendChild(image);
}

function copyCallout(node, dst) {
  const callout = mk('div');
  callout.setAttribute('data-callout', node.getAttribute('data-callout'));
  ['data-wct', 'data-sp'].forEach(a => {
    if (node.getAttribute(a)) callout.setAttribute(a, node.getAttribute(a));
  });
  walk(node, callout);
  dst.appendChild(callout);
}

function copyEquation(node, dst) {
  const equation = emptyWith('div', node, 'data-math');
  ['data-sp', 'data-wct', 'data-math-notes'].forEach(a => {
    if (node.getAttribute(a)) equation.setAttribute(a, node.getAttribute(a));
  });
  dst.appendChild(equation);
}

/* a figure without a picture isn't one: what was in it stays, unwrapped */
function copyFigure(node, dst) {
  const figure = copyWith('figure', node, ['data-wct', 'data-sp']);
  if (figure.querySelector('img')) dst.appendChild(figure);
  else while (figure.firstChild) dst.appendChild(figure.firstChild);
}

/* a comment around nothing is dropped */
function copyComment(node, dst) {
  const comment = mk('span');
  ['data-cmt', 'data-ct', 'data-note'].forEach(a => {
    if (node.hasAttribute(a)) comment.setAttribute(a, node.getAttribute(a));
  });
  walk(node, comment);
  if (comment.childNodes.length) dst.appendChild(comment);
}

/* a citation is drawn from its attributes, so its text isn't kept */
function copyCitation(node, dst) {
  const citation = mk('span');
  ['data-cite', 'data-pg', 'data-anchor', 'data-form'].forEach(a => {
    if (node.hasAttribute(a)) citation.setAttribute(a, node.getAttribute(a));
  });
  dst.appendChild(citation);
}

/* ---- everything else ---- */
function cleanElement(node, tag, dst) {
  const style = node.style || {};
  const target = KEEP[tag];
  if ((tag === 'B' || tag === 'STRONG') && (style.fontWeight === 'normal' || style.fontWeight === '400'))
    walk(node, dst);
  else if (!target || tag === 'SPAN' || tag === 'FONT') walk(node, styledWrapper(style, dst));
  else if (tag === 'A') copyLink(node, dst);
  else if ((tag === 'TD' || tag === 'TH') && dst.tagName !== 'TR')
    walk(node, dst); // a cell in a cell is just its text
  else {
    const kept = mk(target);
    copyKeptAttributes(node, target, kept);
    dst.appendChild(kept);
    walk(node, kept);
  }
}

/* a span or unknown element is unwrapped, keeping bold and italic set by its style */
function styledWrapper(style, dst) {
  let inner = dst;
  if (style.fontWeight === 'bold' || +style.fontWeight >= BOLD_WEIGHT) inner = inner.appendChild(mk('strong'));
  if (style.fontStyle === 'italic') inner = inner.appendChild(mk('em'));
  return inner;
}

/* web links are kept (opening in the browser); any other link is just its text */
function copyLink(node, dst) {
  const href = node.getAttribute('href') || '';
  if (!/^https?:/i.test(href)) {
    walk(node, dst);
    return;
  }
  const link = mk('a');
  link.setAttribute('href', href);
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
  dst.appendChild(link);
  walk(node, link);
}

function copyKeptAttributes(node, target, kept) {
  KEPT_ATTRIBUTES.forEach(([attribute, on, how]) => {
    if (!on.test(target)) return;
    const value = node.getAttribute(attribute);
    if (how === 'value' && value) kept.setAttribute(attribute, value);
    else if (how === 'span' && value && +value > 1) kept.setAttribute(attribute, value);
    else if (how === 'present' && node.hasAttribute(attribute)) kept.setAttribute(attribute, '');
    else if (how === 'one' && value === '1') kept.setAttribute(attribute, '1');
    else if (how === 'style' && value) keepStyles(node, target, kept);
  });
}

/* a table's widths, heights, text settings and alignment (nothing else from a style) */
function keepStyles(node, target, kept) {
  KEPT_STYLES.forEach(([property, on, allowed]) => {
    const value = on.test(target) && node.style.getPropertyValue(property).trim();
    if (value && allowed.test(value)) kept.style.setProperty(property, value);
  });
}

/* an empty line (only the caret markers beside citations, or nothing at all) keeps a line break, or it has no height
   and can't take the caret: a click on it lands in the line above, often a heading */
const FILLABLE = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,figcaption';
export function fillEmpty(root, keep) {
  root.querySelectorAll(FILLABLE).forEach(block => {
    if (
      block === keep ||
      block.contains(keep) ||
      block.firstElementChild ||
      block.textContent.replace(/[\u200b\s]/g, '')
    )
      return;
    block.innerHTML = '<br>';
  });
}

/* clean HTML. prune (for pasting): empty elements dropped, a lone paragraph in a list item unwrapped, tables given a body */
export function sanitize(html, prune) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = mk('div');
  walk(doc.body, out);
  if (prune) pruneCleaned(out);
  else fillEmpty(out);
  return out.innerHTML;
}

function pruneCleaned(out) {
  const elements = out.querySelectorAll('strong,em,u,sub,sup,code,mark,a,p,li,ul,ol,blockquote,h4');
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!el.textContent.trim() && !el.querySelector('br,table')) el.remove();
  }
  out.querySelectorAll('li > p:only-child').forEach(p => {
    while (p.firstChild) p.parentNode.insertBefore(p.firstChild, p);
    p.remove();
  });
  out.querySelectorAll('table').forEach(table => {
    if (table.querySelector('tbody') || table.querySelector('thead')) return;
    const body = mk('tbody');
    while (table.firstChild) body.appendChild(table.firstChild);
    table.appendChild(body);
  });
}

/* plain text as notes: each line a paragraph (or all on one line, inline) */
export function plainToHTML(text, inline) {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (inline || lines.length <= 1) return esc(lines.join(' '));
  return lines.map(line => `<p>${esc(line)}</p>`).join('');
}
