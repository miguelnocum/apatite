import { KEY } from './example-data.js';
import { $, meta, pts, toast } from './helpers-and-state.js';
import { SUB_POINT } from '../syllabus/point-levels.js';
import { sanitize } from '../editor/paste-cleaning.js';

/* ===== storage: artifact database when available, this browser otherwise ===== */
const DOC_PART_SIZE = 80000; // characters per database document the notes are saved in
const POINT_SAVE_DELAY = 700; // ms after the last change to a point's notes before they're saved
export const Store = { db: null, mode: 'local', chain: {}, pending: 0 };
const timers = {};

/* what's saved of a point */
export function strip(point) {
  const saved = {
    order: point.order,
    sec: point.sec,
    code: point.code,
    text: point.text,
    guide: point.guide,
    status: point.status,
    notes: point.notes
  };
  if (point.lvl === SUB_POINT) saved.lvl = SUB_POINT;
  return saved;
}

const storeInit = () => {
  if (!(window.claude && claude.use)) return Promise.resolve();
  return claude.use('db').then(
    db => {
      Store.db = db;
      Store.mode = db ? 'db' : 'local';
    },
    () => {}
  );
};

/* the notebook's title and points (from this browser, if the database can't be read) */
const storeLoad = () => {
  if (!Store.db) return Promise.resolve(Store.loadLocal());
  return Promise.all([Store.db.doc('nb/main').get(), Store.db.collection('points').get()])
    .then(([metaDoc, points]) => ({
      meta: metaDoc.exists ? Object.assign({}, metaDoc.data()) : null,
      pts: points.docs.map(doc => Object.assign({}, doc.data(), { id: doc.id }))
    }))
    .catch(() => {
      Store.db = null;
      Store.mode = 'local';
      return Store.loadLocal();
    });
};

const storeLoadLocal = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    return saved ? { meta: saved.meta, pts: saved.pts || [] } : { meta: null, pts: [] };
  } catch (e) {
    return { meta: null, pts: [] };
  }
};

const storeSaveLocal = () => {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ meta, pts: pts.map(point => Object.assign(strip(point), { id: point.id })) })
    );
  } catch (e) {}
};

/* a database save counted while it's under way (and a failure remembered), for the save indicator */
export function track(promise) {
  Store.pending++;
  setSave();
  return promise.then(
    () => {
      Store.pending--;
      setSave();
    },
    () => {
      Store.pending--;
      Store.err = true;
      setSave();
    }
  );
}

/* each point's saves are chained, so they arrive in order */
function chainPointSave(id, write) {
  Store.chain[id] = track((Store.chain[id] || Promise.resolve()).then(write));
}

const storeSavePoint = point => {
  if (!Store.db) {
    Store.saveLocal();
    return;
  }
  const id = point.id;
  const data = strip(point);
  chainPointSave(id, () => Store.db.collection('points').doc(id).set(data));
};

const storeDelPoint = id => {
  if (!Store.db) {
    Store.saveLocal();
    return;
  }
  chainPointSave(id, () => Store.db.collection('points').doc(id).delete());
};

const storeSaveMeta = () => {
  if (!Store.db) {
    Store.saveLocal();
    return;
  }
  track(Store.db.doc('nb/main').set({ title: meta.title }));
}; /* ---- the notes document: in this browser, or in the database in parts (only the parts that changed are written) ---- */

const storeSaveDoc = html => {
  if (!Store.db) {
    saveDocLocally(html);
    return;
  }
  const parts = [];
  for (let i = 0; i < html.length; i += DOC_PART_SIZE) parts.push(html.slice(i, i + DOC_PART_SIZE));
  if (!parts.length) parts.push('');
  const previous = Store.parts;
  const db = Store.db;
  Store.parts = parts;
  Store.docChain = track(Store.docChain.then(() => writeDocParts(db, parts, previous)));
};

function saveDocLocally(html) {
  try {
    localStorage.setItem(KEY + '-doc', html);
  } catch (e) {
    toast('Notes are too large for browser storage');
  }
  setSave();
}

/* the changed parts, the count if it changed, and parts no longer needed deleted, one after another */
function writeDocParts(db, parts, previous) {
  const notes = db.collection('nbdoc');
  let chain = Promise.resolve();
  const then = write => (chain = chain.then(write));
  parts.forEach((part, i) => {
    if (previous[i] !== part) then(() => notes.doc('c' + i).set({ h: part }));
  });
  if (parts.length !== previous.length) then(() => notes.doc('meta').set({ n: parts.length }));
  for (let j = parts.length; j < previous.length; j++) then(() => notes.doc('c' + j).delete());
  return chain;
}

const storeLoadDoc = () => {
  if (Store.db)
    return Store.db
      .collection('nbdoc')
      .get()
      .then(joinDocParts)
      .catch(() => null);
  try {
    return Promise.resolve(localStorage.getItem(KEY + '-doc'));
  } catch (e) {
    return Promise.resolve(null);
  }
};

function joinDocParts(query) {
  const byId = {};
  query.docs.forEach(doc => (byId[doc.id] = doc.data()));
  if (!byId.meta) return null;
  const parts = [];
  for (let i = 0; i < byId.meta.n; i++) parts.push((byId['c' + i] || {}).h || '');
  Store.parts = parts.slice();
  return parts.join('');
}

/* the save indicator (where it saves is in Settings ▸ Library) */
export function setSave() {
  $('save').textContent = Store.pending ? 'saving…' : Store.err ? 'save failed, retry by editing' : '';
}

/* a point's notes saved a moment after the last change */
export function queue(point) {
  clearTimeout(timers[point.id]);
  setSave();
  $('save').textContent = 'editing…';
  timers[point.id] = setTimeout(() => {
    if (point.notes != null && point._raw != null) {
      point.notes = sanitize(point._raw, false);
      point._raw = null;
    }
    Store.savePoint(point);
  }, POINT_SAVE_DELAY);
}

export function initStorage() {
  Store.init = storeInit;
  Store.load = storeLoad;
  Store.loadLocal = storeLoadLocal;
  Store.saveLocal = storeSaveLocal;
  Store.savePoint = storeSavePoint;
  Store.delPoint = storeDelPoint;
  Store.saveMeta = storeSaveMeta;
  Store.parts = [];
  Store.docChain = Promise.resolve();
  Store.saveDoc = storeSaveDoc;
  Store.loadDoc = storeLoadDoc;
}
