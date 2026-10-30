import { KEY, STATUS } from '../core/example-data.js';
import { $, escapeHtml, uiState } from '../core/helpers-and-state.js';
import { kidsOf, lvl } from './point-levels.js';
import { groups } from './model.js';
import { renderEdit } from './syllabus-editing.js';
import { addBanner, markCur } from '../view/page-render.js';
import { applyZoom, relayout } from '../view/zoom.js';
import { isNarrow } from '../editor/comments.js';
import { renderEssaySide } from '../essays/essays.js';
import { renderSpPanel } from '../spec-points/spec-point-panel.js';

/* ===== the syllabus as a table, and its side panel of sections ===== */
const RATING_ORDER = [4, 3, 2, 1, 0]; // a section's bar shows its ratings, most confident first
const CONFIDENT = 4;
// prettier-ignore
const SYLLABUS_HINT =
  '<p style="color:var(--muted);font-size:12.5px;margin-top:10px">Click a statement to open its notes. If it is not in ' +
  'your notes yet, it is added in the right section. Click a circle to step its confidence up, shift-click to step back. ' +
  '1 = I’ve never seen this, 2 = I know about 30%, 3 = I forgot some bits, 4 = I’m confident.</p>';

/* a point's confidence circle */
export function cfHTML(point) {
  const rating = point.status || 0;
  const title =
    escapeHtml(rating ? rating + ': ' + STATUS[rating] : 'Not rated') + ' (click for next, shift-click for previous)';
  const label = 'Confidence: ' + escapeHtml(rating ? rating + ', ' + STATUS[rating] : 'not rated');
  return `<button class="cf" data-cyc="${point.id}" data-n="${rating}" title="${title}" aria-label="${label}">${rating || ''}</button>`;
}

/* how many points have each rating, 0 to 4 */
function ratingCounts(points) {
  const counts = [0, 0, 0, 0, 0];
  points.forEach(point => counts[point.status || 0]++);
  return counts;
}

/* a bar of a section's ratings, each as wide as its share */
export function ratingBarHTML(points) {
  const counts = ratingCounts(points);
  return RATING_ORDER.map(rating =>
    counts[rating] ? `<span style="width:${(counts[rating] / points.length) * 100}%;--c:var(--s${rating})"></span>` : ''
  ).join('');
}

/* the header's height, for the page to sit under it (none in focus mode, where the bar floats at the bottom) */
export function measure() {
  const root = document.documentElement;
  root.style.setProperty('--hh', (root.classList.contains('focus') ? 0 : $('head').offsetHeight) + 'px');
}

export function sideClosed() {
  const wrap = $('bodywrap');
  return wrap.classList.contains('nosd') || wrap.classList.contains('zfold');
}

/* the side panel's heading, with its button to hide or show it */
export function sideHd(title) {
  const closed = sideClosed();
  const label = closed ? 'Show contents' : 'Hide contents';
  return (
    `<div class="sidehd"><h4>${title || 'Contents'}</h4>` +
    `<button type="button" class="sidetog" data-sidetog="1" title="${label}" aria-label="${label}" aria-expanded="${!closed}">` +
    `${closed ? '»' : '«'}</button></div>`
  );
}

/* in a narrow window the panel is a drawer that closes; folded by zooming, opening it keeps the panes out for this zoom */
export function toggleSide() {
  if (isNarrow()) {
    $('side').classList.remove('open');
    return;
  }
  const wrap = $('bodywrap');
  if (wrap.classList.contains('zfold')) {
    uiState.zfoldOff = true;
    applyZoom();
  } else {
    wrap.classList.toggle('nosd');
    relayout();
    try {
      localStorage.setItem(KEY + '-sd', wrap.classList.contains('nosd') ? '0' : '1');
    } catch (e) {}
  }
  renderSide();
  markCur();
}

/* the essays, the spec points, or (in the syllabus) its sections with how confident you are in each */
export function renderSide() {
  if (uiState.view === 'essay') renderEssaySide();
  else if (uiState.view === 'notes') renderSpPanel();
  else {
    const sections = groups();
    $('side').innerHTML = sections.length
      ? sideHd() + sections.map(sectionLinkHTML).join('')
      : sideHd() + '<p style="padding:8px;color:var(--muted)">No sections yet.</p>';
  }
}

function sectionLinkHTML(section) {
  const confident = ratingCounts(section.all)[CONFIDENT];
  return (
    `<a href="#sec-${section.idx}" data-gosec="${section.idx}"><div class="t"><span>${escapeHtml(section.sec || 'Untitled section')}</span>` +
    `<em title="Points rated 4 (confident)">${confident}/${section.all.length}</em></div>` +
    `<div class="prog" aria-hidden="true">${ratingBarHTML(section.all)}</div></a>`
  );
}

export function renderSyl() {
  if (uiState.edit) {
    renderEdit();
    return;
  }
  const sections = groups();
  $('main').innerHTML = sections.length
    ? '<div class="tw"><table class="syl"><thead><tr><th class="cfh" title="Confidence">Conf.</th><th>Code</th>' +
      '<th>Statement</th><th>Guidance</th></tr></thead><tbody>' +
      sections.map(sectionRowsHTML).join('') +
      '</tbody></table></div>' +
      SYLLABUS_HINT
    : '<div class="empty">No syllabus yet. Press Edit syllabus to add one.</div>';
  addBanner();
}

/* a section's heading row, then a row per point (sub-points indented, parents marked) */
function sectionRowsHTML(section) {
  const heading = `<tr class="sr" id="sec-${section.idx}" data-secidx="${section.idx}"><td colspan="4">${escapeHtml(section.sec || 'Untitled section')}</td></tr>`;
  const rows = section.items.map(point => {
    const kind = lvl(point) === 3 ? ' sub' : kidsOf(point).length ? ' par' : '';
    return (
      `<tr class="pr${kind}" id="row-${point.id}" data-s="${point.status || 0}"><td class="cfc">${cfHTML(point)}</td>` +
      `<td class="c">${escapeHtml(point.code)}</td><td><a href="#pt-${point.id}" data-open="${point.id}" title="Open notes">` +
      `${escapeHtml(point.text)}</a></td><td class="g">${escapeHtml(point.guide)}</td></tr>`
    );
  });
  return heading + rows.join('');
}

export function initSyllabusView() {
  try {
    if (localStorage.getItem(KEY + '-sd') === '0') $('bodywrap').classList.add('nosd');
  } catch (e) {}
}
