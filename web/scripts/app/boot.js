/* ===== boot: the notebook loaded (or the example made, the first time), then drawn ===== */
const IMPORT_CHECK_DELAY = 200; // ms after importing essays before their citations are checked
let booted = false; // the Mac app's calls wait for this

function boot() {
  Store.init()
    .then(Store.load)
    .then(loaded => {
      loadPoints(loaded);
      return Store.loadRefs();
    })
    .then(loadRefsList)
    .then(Store.loadDoc)
    .then(loadNotesDoc)
    .then(Store.loadEssays)
    .then(startNotebook);
}

/* the essays loaded, the page drawn */
function startNotebook(list) {
  essays = Array.isArray(list) ? list : [];
  startView();
  $('nbtitle').value = meta.title || '';
  setSave();
  render();
  booted = true;
  afterBoot();
}

/* the points in order (levels worked out if they were never saved); the example the first time */
function loadPoints(loaded) {
  const seeded = !!loaded.meta;
  meta = loaded.meta || { title: 'My notebook' };
  pts = loaded.pts.sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!pts.some(point => point.lvl != null)) inferLevels(pts);
  dropDuplicatePoints();
  if (!pts.length && !seeded) seedExample();
  else {
    try {
      Store.example = localStorage.getItem(KEY + '-ex') === '1';
    } catch (e) {}
  }
}

/* exact duplicates (the example was once seeded twice) go, keeping a copy with notes or a rating */
function dropDuplicatePoints() {
  const seen = {};
  const dupes = [];
  const used = point => point.status || (point.notes || '').trim();
  pts.forEach(point => {
    const key = [point.sec, point.code, point.text].join('\u0001');
    const earlier = seen[key];
    if (!earlier) seen[key] = point;
    else if (!used(earlier) && used(point)) {
      dupes.push(earlier);
      seen[key] = point;
    } else dupes.push(point);
  });
  if (!dupes.length) return;
  pts = pts.filter(point => !dupes.includes(point));
  dupes.forEach(point => Store.delPoint(point.id));
}

function seedExample() {
  meta = { title: 'Molecular Biology notebook' };
  pts = planApply(EXAMPLE, true).next;
  pts.forEach((point, i) => (point.order = i + 1));
  Store.example = true;
  pts.forEach(point => Store.savePoint(point));
  Store.saveMeta();
}

function loadRefsList(list) {
  refs = list.items;
  refSort = list.sort;
  nbRefs = refs;
  nbRefSort = refSort;
  refOwner = 'notes';
}

/* the notes (made from older notebooks' notes on each point, if there's no document yet) */
function loadNotesDoc(doc) {
  if (doc != null) {
    docHTML = doc;
    return;
  }
  docHTML = buildDocFromPoints() || '<p><br></p>';
  Store.saveDoc(docHTML);
}

/* the essay last open, or the essay and view the Mac app asked for before the page was ready */
function startView() {
  try {
    ui.essayId = localStorage.getItem(KEY + '-essay') || null;
  } catch (e) {}
  if (window.__nbStartEssay) {
    ui.essayId = window.__nbStartEssay;
    window.__nbStartEssay = null;
  }
  if (window.__nbStartView) {
    ui.view = window.__nbStartView;
    window.__nbStartView = null;
  }
}

/* Settings asked for before the page was ready (⌘, from Home), or open across a reload (a notebook re-linked to a
   syllabus); essays imported before it was ready */
function afterBoot() {
  let settings = window.__nbOpenSettings;
  try {
    settings = settings != null ? settings : sessionStorage.getItem(KEY + '-reopenset');
    sessionStorage.removeItem(KEY + '-reopenset');
  } catch (x) {}
  if (settings != null) {
    window.__nbOpenSettings = null;
    openSettings(settings || null);
  }
  const pending = window.__nbPendingImports;
  if (!(pending && pending.length)) return;
  window.__nbPendingImports = null;
  window.nbImportEssays(pending);
}

/* ===== the Mac app's calls ===== */
/* essays converted from Word or PDF by the Mac app */
window.nbImportEssays = list => {
  if (!booted) {
    window.__nbPendingImports = (window.__nbPendingImports || []).concat(list || []);
    return;
  }
  const made = (list || []).map(importedEssay);
  made.forEach(essay => essays.unshift(essay));
  if (!made.length) return;
  Store.saveEssays();
  if (ed()) saveDocNow();
  openEssay(made[made.length - 1].id);
  setTimeout(() => checkImported(made), IMPORT_CHECK_DELAY);
};

function importedEssay(converted) {
  let doc = sanitize(String(converted.html || ''), false);
  if (!doc.replace(/<[^>]+>/g, '').trim() && doc.indexOf('<img') < 0) doc = '<p><br></p>';
  return Object.assign(blankEssay(), { title: String(converted.title || '').trim(), doc });
}

/* the citation check opens only when there is something it can fix; sources have to exist before typed citations
   can link */
function checkImported(made) {
  const issues = ccScan();
  const what = made.length === 1 ? '“' + (made[0].title || 'Untitled essay') + '”' : made.length + ' essays';
  const fixable = issues.filter(issue => !(issue.kind === 'unlinked' && !issue.cands.length)).length;
  const noSource = issues.length - fixable;
  const plural = count => (count === 1 ? '' : 's');
  if (fixable) {
    openCiteCheck();
    toast(`Imported ${what}. ${fixable} citation${plural(fixable)} to check.`);
  } else if (noSource)
    toast(
      `Imported ${what}. Add its sources to Works Cited, then Check citations can link ${noSource} typed citation${plural(noSource)}.`
    );
  else toast('Imported ' + what);
}

window.nbOpenEssay = id => {
  if (!booted) return;
  if (ed()) saveDocNow();
  openEssay(id);
  Store.saveEssays(); // the save tells the app which essay is open
};

window.nbNewEssay = () => {
  if (!booted) return;
  if (ed()) saveDocNow();
  if (ui.view !== 'essay') {
    ui.view = 'essay';
    render();
  }
  newEssay();
};

/* the Mac app's Notes / Essay buttons */
window.nbShow = view => {
  if (!booted) {
    window.__nbStartView = view;
    return;
  }
  if (ui.view === view) return;
  if (ed()) saveDocNow();
  ui.view = view;
  render();
  window.scrollTo(0, 0);
};
