import { ptById, pts, toast, ui } from '../core/helpers-and-state.js';
import { POINT, SUB_POINT } from '../core/saved-format.js';
import { Store } from '../core/storage.js';
import { renderSide } from './syllabus-view.js';
import { renderEdit } from './syllabus-editing.js';
import { secPrefix } from './syllabus-import.js';
import { flash, render } from '../view/page-render.js';
/* ===== three levels: the section is the chapter (1), points are headings (1.1), sub-points sit under the point above (1.1.1) ===== */

export function lvl(point) {
  return point && point.lvl === SUB_POINT ? SUB_POINT : POINT;
}

/* how many parts a code has: 2.1.3 has three */
function codeDepth(code) {
  code = (code || '').trim();
  return code ? code.split('.').filter(Boolean).length : 0;
}

/* the points of each section in turn */
function eachSection(list, visit) {
  let start = 0;
  while (start < list.length) {
    let end = start;
    while (end < list.length && list[end].sec === list[start].sec) end++;
    visit(list.slice(start, end));
    start = end;
  }
}

/* levels from codes: in each section the shallowest codes are points and deeper ones sub-points */
export function inferLevels(list) {
  eachSection(list, section => {
    const depths = section.map(point => codeDepth(point.code)).filter(Boolean);
    const shallowest = depths.length ? Math.min(...depths) : 0;
    section.forEach(point => (point.lvl = shallowest && codeDepth(point.code) > shallowest ? SUB_POINT : POINT));
  });
  normLevels(list);
}

/* a section never starts with a sub-point */
export function normLevels(list) {
  eachSection(list || pts, section => {
    if (section[0] && section[0].lvl === SUB_POINT) section[0].lvl = POINT;
  });
}

/* the sub-points right under a point */
export function kidsOf(point) {
  const at = pts.indexOf(point);
  const kids = [];
  if (at < 0 || lvl(point) === SUB_POINT) return kids;
  for (let k = at + 1; k < pts.length && pts[k].sec === point.sec && lvl(pts[k]) === SUB_POINT; k++) kids.push(pts[k]);
  return kids;
}

/* renumber a section 1.1, 1.1.1 … when its codes are plain numbers (textbook style); other schemes are left alone */
export function numberSection(section, quiet) {
  const list = pts.filter(point => point.sec === section);
  if (!list.length) return false;
  const prefix = sectionNumber(section, list);
  if (!prefix) {
    if (!quiet) toast('Start the section title with its number (e.g. "1 Cells") to auto-number');
    return false;
  }
  if (quiet && !list.every(point => !(point.code || '').trim() || /^\d+(\.\d+)*$/.test(point.code.trim())))
    return false;
  renumber(list, prefix);
  return true;
}

/* 1.1, 1.2, 1.2.1 …: points count up, sub-points count up under their point */
function renumber(list, prefix) {
  let pointNumber = 0;
  let subNumber = 0;
  list.forEach(point => {
    if (lvl(point) === POINT) {
      pointNumber++;
      subNumber = 0;
      point.code = prefix + '.' + pointNumber;
    } else point.code = prefix + '.' + pointNumber + '.' + ++subNumber;
    Store.savePoint(point);
  });
}

/* the section's number: from its title, else from the codes of its points */
function sectionNumber(section, list) {
  const fromTitle = secPrefix(section);
  if (fromTitle) return fromTitle;
  const numbered = list.find(point => codeDepth(point.code) > 1 && lvl(point) === POINT);
  return numbered ? numbered.code.trim().split('.').slice(0, -1).join('.') : '';
}

/* a point made a sub-point (or back); its section renumbered if it's numbered plainly */
export function setLevel(id, to) {
  const point = ptById(id);
  if (!point) return;
  const at = pts.indexOf(point);
  if (to === SUB_POINT && (at <= 0 || pts[at - 1].sec !== point.sec)) {
    toast('The first point in a section can’t be a sub-point');
    return;
  }
  point.lvl = to;
  normLevels();
  Store.example = false;
  Store.savePoint(point);
  const renumbered = numberSection(point.sec, true);
  Store.saveLocal();
  if (ui.edit) renderEdit();
  else render();
  renderSide();
  flash(document.getElementById('row-' + id));
  toast((to === SUB_POINT ? 'Now a sub-point' : 'Now a point') + (renumbered ? ' · renumbered' : ''));
}
