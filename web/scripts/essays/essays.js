import { KEY } from '../core/example-data.js';
import {
  $,
  curEssay,
  ed,
  edEssayId,
  esc,
  essays,
  NATIVE,
  ptById,
  pts,
  setCurEd,
  setEssays,
  toast,
  ui,
  uid
} from '../core/helpers-and-state.js';
import { Store } from '../core/storage.js';
import { renderSide, sideHd } from '../syllabus/syllabus-view.js';
import { render } from '../view/page-render.js';
import { watchZoom } from '../view/zoom.js';
import { hydrate } from '../editor/notes-document.js';
import { essayTotal, tagCounts, wcOpts } from './word-count.js';
import { renderWordCount, updateEssayListCounts } from './word-count-sidebar.js';
import { closeTagPop } from './word-count-boxes.js';
import { useRefs } from '../citations/references.js';
import { shiftHeadings } from '../editor/folding.js';
import { spGo } from '../spec-points/spec-point-panel.js';

/* ===== essays: free writing on the same page, no syllabus ===== */
function rememberEssay() {
  try {
    localStorage.setItem(KEY + '-essay', ui.essayId || '');
  } catch (e) {}
}

export function blankEssay() {
  return {
    id: uid(),
    title: '',
    doc: '<p><br></p>',
    refs: [],
    refSort: 'auto',
    created: Date.now(),
    updated: Date.now()
  };
}

export function newEssay() {
  const essay = blankEssay();
  essays.unshift(essay);
  Store.saveEssays();
  openEssay(essay.id);
  const title = $('etitle');
  if (title) title.focus();
}

export function openEssay(id) {
  ui.essayId = id;
  ui.delSure = false;
  rememberEssay();
  if (ui.view !== 'essay') {
    ui.view = 'essay';
    render();
  } else {
    renderEssay();
    renderSide();
  }
}

export function deleteEssay() {
  setEssays(essays.filter(essay => essay.id !== ui.essayId));
  ui.delSure = false;
  Store.saveEssays();
  ui.essayId = essays.length ? essays[0].id : null;
  rememberEssay();
  renderEssay();
  renderSide();
  toast('Essay deleted');
}

/* the open essay (there's always one), its title above the page */
export function renderEssay() {
  ui.wcMode = false;
  closeTagPop();
  const essay = openableEssay();
  useRefs(essay.id);
  if (essay.hv !== 2) {
    essay.doc = shiftHeadings(essay.doc);
    essay.hv = 2;
    Store.saveEssays();
  }
  $('main').innerHTML =
    '<div class="zwrap" id="zwrap"><div class="doc">' +
    `<input class="etitle" id="etitle" type="text" placeholder="Untitled essay" aria-label="Essay title" value="${esc(essay.title)}">` +
    `<div id="ed" class="notes docbody" data-doc="essay" data-essay="${essay.id}" contenteditable="true" spellcheck="true" ` +
    `aria-label="Essay">${essay.doc || '<p><br></p>'}</div></div></div>`;
  const editor = ed();
  hydrate(editor);
  setCurEd(editor);
  watchZoom();
}

/* the essay chosen, else the first (one is made if there are none) */
function openableEssay() {
  if (!essays.length) {
    essays.push(blankEssay());
    Store.saveEssays();
  }
  if (!curEssay()) {
    ui.essayId = essays[0].id;
    rememberEssay();
  }
  return curEssay();
}

/* the sidebar: the essays with their word counts (on the web), the word count, and Delete */
export function renderEssaySide() {
  if (ui.view !== 'essay') return;
  const box = $('wcbox');
  if (document.activeElement && box && box.contains(document.activeElement)) {
    updateEssayListCounts(); // typing in the word count's settings: they stay as they are
    renderWordCount();
    return;
  }
  // in the Mac app, essays are switched from the toolbar's project menu; the sidebar is just the word count
  $('side').innerHTML =
    (NATIVE ? sideHd('Word count') : sideHd('Essays') + essayListHTML()) +
    `<div class="wcb${NATIVE ? ' first' : ''}" id="wcbox"></div>` +
    (essays.length ? '<button type="button" class="delessay" id="delessay">Delete this essay</button>' : '');
  renderWordCount();
}

function essayListHTML() {
  const items = essays.map(essay => {
    const count = essay.id === edEssayId() ? tagCounts(ed(), wcOpts(essay)).total : essayTotal(essay);
    return (
      `<a href="#" data-essay="${essay.id}" class="${essay.id === ui.essayId ? 'cur' : ''}">` +
      `<div class="t"><span>${esc(essay.title || 'Untitled essay')}</span></div>` +
      `<span class="wc">${count.toLocaleString()} word${count === 1 ? '' : 's'}</span></a>`
    );
  });
  return (
    '<div class="esbtns"><button type="button" class="newes" id="newessay">+ New essay</button></div>' +
    `<div class="esl">${items.join('')}</div>`
  );
}

/* point -> notes: jump to it, or add it in the right section */
export function openPoint(id) {
  if (!ptById(id)) return;
  ui.back = { scroll: window.scrollY, id };
  ui.scroll.syl = window.scrollY;
  ui.view = 'notes';
  render();
  spGo(id);
}

/* older notebooks kept notes on each point: they become one document, with the old spec point headings */
export function buildDocFromPoints() {
  let html = '';
  let section = null;
  pts.forEach(point => {
    if (!(point.notes || '').trim()) return;
    if (point.sec !== section) {
      section = point.sec;
      html += `<h2 data-sec="${esc(section)}"></h2>`;
    }
    html += `<h3 data-pt="${esc(point.id)}"></h3>` + point.notes;
  });
  return html;
}
