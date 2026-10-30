import { $, esc, pts, toast, ui } from '../core/helpers-and-state.js';
import { Store } from '../core/storage.js';
import { detectorFor, numberingStyleHTML } from './numbering-style.js';
import { render } from '../view/page-render.js';

/* ===== a whole syllabus pasted in: its sections and points detected, reviewed as a draft, then added ===== */
export function detect(text) {
  return detectorFor(ui.secStyle, ui.ptStyle).read(text);
}

/* ---- "Suggest grouping with Claude": the points, grouped into titled sections ---- */
export function suggestGrouping() {
  const draft = ui.draft || detect($('paste') ? $('paste').value : '');
  const points = draft.flatMap(g => g.items);
  if (points.length < 2) {
    toast('Paste a syllabus first');
    return;
  }
  if (!(window.claude && claude.use)) {
    toast('Claude suggestions are not available here');
    return;
  }
  claude
    .use('sample')
    .then(sample => askForGrouping(sample, points))
    .catch(e => {
      if (e && e.code === 'not_granted') toast('Permission for Claude suggestions was declined');
      else toast('Suggestion failed. Try again or edit the sections by hand.');
    });
}

function askForGrouping(sample, points) {
  if (!sample) {
    toast('Claude suggestions are not available here');
    return;
  }
  toast('Asking Claude to group the points…');
  const list = points.map((point, i) => i + ': ' + point.text).join('\n');
  const prompt =
    'Below is a numbered list of points from a course syllabus or study specification. Group them into logical sections, ' +
    'keeping the original order. Give each section a short title of 2 to 6 words, in the same style as a textbook chapter ' +
    'title. Every point index must appear exactly once.\n\nReturn JSON only in this shape: ' +
    '{"sections":[{"title":"...","points":[0,1,2]}]}\n\nPoints:\n' +
    list;
  return sample.json(prompt, { modelTier: 'quick', cache: false }).then(result => useGrouping(result, points));
}

/* the suggested sections (each point once; any it left out go under "Other") */
function useGrouping(result, points) {
  const sections = result && result.sections;
  if (!sections || !sections.length) {
    toast('Could not read the suggestion');
    return;
  }
  ui.draft = suggestedGroups(sections, points);
  renderSetup();
  toast('Grouping suggested. Check the titles before adding.');
}

function suggestedGroups(sections, points) {
  const seen = {};
  const groups = [];
  sections.forEach(section => {
    const group = { title: String(section.title || 'Section'), items: [] };
    (section.points || []).forEach(i => {
      if (!points[i] || seen[i]) return;
      seen[i] = 1;
      group.items.push(points[i]);
    });
    if (group.items.length) groups.push(group);
  });
  const missed = points.filter((_, i) => !seen[i]);
  if (missed.length) groups.push({ title: 'Other', items: missed });
  return groups;
}

/* ---- sections and their numbering: a section titled "2.1 Water" numbers its points 2.1.1, 2.1.2, ... ---- */
export function sectionNames() {
  const names = [];
  pts.forEach(p => {
    if (!names.includes(p.sec)) names.push(p.sec);
  });
  return names;
}

export function secPrefix(section) {
  const m = /^\s*(\d+(?:\.\d+)*)(?=[\s.:)\-–—]|$)/.exec(section || '');
  return m ? m[1] : '';
}

/* "2.1.4" → "2.1.5" */
function bump(code) {
  const m = /^(.*?)(\d+)$/.exec(code || '');
  return m ? m[1] + (+m[2] + 1) : '';
}

/* the number a point would have: one after the last numbered point before it, or the first in its section */
export function suggestCode(point) {
  let previous = null;
  for (let i = 0; i < pts.length && pts[i] !== point; i++) {
    if (pts[i].sec === point.sec && (pts[i].code || '').trim()) previous = pts[i];
  }
  const next = previous ? bump(previous.code.trim()) : '';
  if (next) return next;
  const prefix = secPrefix(point.sec);
  return prefix ? prefix + '.1' : '';
}

/* ---- the draft, to review before it's added ---- */
function draftCard() {
  const draft = ui.draft;
  const count = draft.reduce((sum, g) => sum + g.items.length, 0);
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  return (
    `<div class="card" id="review"><h3>Review: ${plural(count, 'point')} in ${plural(draft.length, 'section')}</h3>` +
    '<p>Edit titles and numbers, and remove any line you do not want. Empty numbers are filled in for you.</p>' +
    `<div class="draft">${draft.map(draftSectionHTML).join('')}</div>` +
    draftModeHTML() +
    (ui.confirmApply
      ? `<div class="warn">Replacing will delete ${ui.confirmApply} point(s) that have notes or ratings and are not in this list. ` +
        'Click again to confirm.</div>'
      : '') +
    `<div class="row"><button class="btn pri" id="confirmdraft">${ui.confirmApply ? 'Confirm replace' : 'Add ' + plural(count, 'point')}` +
    '</button><button class="btn" id="discard">Discard</button></div></div>'
  );
}

function draftSectionHTML(section, i) {
  const items = section.items
    .map(
      (item, j) =>
        `<div class="dpt"><input class="cd" data-dc="${i}.${j}" value="${esc(item.code)}" placeholder="auto" aria-label="Number">` +
        `<input data-dt="${i}.${j}" value="${esc(item.text)}" aria-label="Statement">` +
        `<button class="x" data-dx="${i}.${j}" aria-label="Remove line">×</button></div>`
    )
    .join('');
  return (
    `<div class="dsec"><input class="stt" data-ds="${i}" value="${esc(section.title)}" placeholder="Section title" aria-label="Section title">` +
    `${items}<div><button class="btn sm" data-dadd="${i}">+ Point</button></div></div>`
  );
}

function draftModeHTML() {
  const checked = mode => (ui.mode === mode ? ' checked' : '');
  return (
    `<div class="row"><label class="row" style="gap:6px"><input type="radio" name="mode" value="add"${checked('add')}> Add to ` +
    'current syllabus</label><label class="row" style="gap:6px">' +
    `<input type="radio" name="mode" value="replace"${checked('replace')}> Replace current syllabus (keeps notes where numbers ` +
    'match)</label></div>'
  );
}

/* the paste box (open while there's something in it), the draft, and the example and empty-syllabus buttons */
export function importHTML() {
  return (
    pasteBoxHTML() +
    (ui.draft ? draftCard() : '') +
    '<div class="row" style="margin-bottom:14px"><button class="btn sm" id="ex">Load Biology example</button>' +
    '<button class="btn sm" id="blank">Start with an empty syllabus</button><button class="btn sm" id="exp">Save notes (.html)</button>' +
    `<span style="color:var(--muted);font-size:12px">${savedWhere()}</span></div>`
  );
}

function pasteBoxHTML() {
  return (
    `<details class="card imp"${ui.paste || ui.draft ? ' open' : ''}><summary>Paste a whole syllabus</summary>` +
    '<p>Paste from a document, a chat or a web page. Numbered points (1.1, Specification Point 1.1, 2.1.U1) and section titles ' +
    '(capitals, # headings, or \u201cTopic 1: \u2026\u201d) are picked up automatically. A plain list with no numbering is split ' +
    'into sections you can review. If your syllabus is numbered another way, show how below.</p>' +
    '<textarea id="paste" spellcheck="false" placeholder="Paste syllabus text here" aria-label="Syllabus text to import">' +
    `${esc(ui.paste || '')}</textarea>` +
    numberingStyleHTML() +
    '<div class="row"><button class="btn pri" id="detect">Detect sections and points</button><button class="btn" id="suggest">' +
    'Suggest grouping with Claude</button></div></details>'
  );
}

function savedWhere() {
  if (Store.mode === 'native') return 'Saved in Documents/Apatite.';
  if (Store.mode === 'db') return 'Saved to this artifact\u2019s private database.';
  return 'Saved in this browser only.';
}

export function renderSetup() {
  render();
}
