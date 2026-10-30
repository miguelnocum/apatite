import { KEY } from '../core/example-data.js';
import { esc, toast, ui } from '../core/helpers-and-state.js';
import { Store, setSave, track } from '../core/storage.js';
import { docHTML, ed, serializeDoc } from '../editor/notes-document.js';
import { edEssayId, essays } from '../essays/essays.js';

/* ===== the references of a Works Cited, and how they're kept ===== */
/* every notebook and essay keeps its own Works Cited; `refs` is always the open list */
export let refs = [];
export function setRefs(value) {
  refs = value;
  return value;
}
export let refSort = 'auto';
export function setRefSort2(value) {
  refSort = value;
  return value;
}
export let nbRefs = null;
export function setNbRefs(value) {
  nbRefs = value;
  return value;
}
export let nbRefSort = 'auto';
export function setNbRefSort(value) {
  nbRefSort = value;
  return value;
}
export let refOwner = 'notes';
export function setRefOwner(value) {
  refOwner = value;
  return value;
}
const MIN_REFERENCE_LENGTH = 4; // shorter pasted lines aren't references
const LIST_MARKER = /^(\[\d+\]|\d+[.)]|[-•*])\s+/; // "[1] ", "1. ", "• " before a reference
const ET_AL_FROM = 3; // this many authors and more are cited as "First et al."
const LETTER_A = 97; // years shared by one author are told apart as 2020a, 2020b…

function ownerEssay(owner) {
  return essays.find(essay => essay.id === (owner || refOwner));
}

/* the open list is put back where it belongs (the notebook, or its essay) */
export function stashRefs() {
  if (refOwner === 'notes') {
    nbRefs = refs;
    nbRefSort = refSort;
    return;
  }
  const essay = ownerEssay();
  if (!essay) return;
  essay.refs = refs;
  essay.refSort = refSort;
}

export function useRefs(owner) {
  if (owner !== 'notes' && !ownerEssay(owner)) owner = 'notes';
  if (owner === refOwner) return;
  stashRefs();
  refOwner = owner;
  if (owner === 'notes') {
    refs = nbRefs || [];
    refSort = nbRefSort || 'auto';
  } else {
    const essay = ownerEssay(owner);
    refs = essay.refs || (essay.refs = []);
    refSort = essay.refSort || 'auto';
  }
  ui.wcSel = {};
  ui.refEdit = null;
  ui.confirm = null;
}

/* the open list's document, as HTML (for "cited 3 times" and delete warnings) */
export function ownerDoc() {
  const essayId = edEssayId();
  const open = ed() ? serializeDoc() : null;
  if (refOwner === 'notes') {
    const notesOpen = open != null && !essayId && ed().getAttribute('data-doc') === 'notes';
    return (notesOpen ? open : docHTML) || '';
  }
  return (essayId === refOwner && open != null ? open : (ownerEssay() || {}).doc) || '';
}

/* ---- storage ---- */
const storeSaveEssays = () => {
  try {
    localStorage.setItem(KEY + '-essays', JSON.stringify(essays));
  } catch (e) {
    toast('Essays are too large for browser storage');
  }
  setSave();
};

const storeLoadEssays = () => {
  try {
    return Promise.resolve(JSON.parse(localStorage.getItem(KEY + '-essays') || '[]'));
  } catch (e) {
    return Promise.resolve([]);
  }
};

/* an essay's list is saved with the essay; the notebook's on its own */
const storeSaveRefs = () => {
  stashRefs();
  if (refOwner !== 'notes') {
    Store.saveEssays();
    return;
  }
  const data = {
    sort: refSort,
    items: refs.map(r => ({ id: r.id, raw: r.raw, html: r.html || '', authors: r.authors, year: r.year }))
  };
  if (Store.db) saveRefsToDatabase(data);
  else saveRefsLocally(data);
};

function saveRefsLocally(data) {
  try {
    localStorage.setItem(KEY + '-refs', JSON.stringify(data));
  } catch (e) {}
  setSave();
}

/* saves are chained, so they arrive in order */
function saveRefsToDatabase(data) {
  const db = Store.db;
  Store.refChain = track((Store.refChain || Promise.resolve()).then(() => db.doc('refs/main').set(data)));
}

const storeLoadRefs = () => {
  const normalize = data => ({ items: (data && data.items) || [], sort: (data && data.sort) || 'auto' });
  if (Store.db)
    return Store.db
      .doc('refs/main')
      .get()
      .then(snap => normalize(snap.exists ? JSON.parse(JSON.stringify(snap.data())) : null))
      .catch(() => normalize(null));
  try {
    return Promise.resolve(normalize(JSON.parse(localStorage.getItem(KEY + '-refs') || 'null')));
  } catch (e) {
    return Promise.resolve(normalize(null));
  }
};

export function refById(id) {
  return refs.find(r => r.id === id);
}

/* ---- reading a Harvard reference: its year, and the surnames its in-text citation uses ---- */
export function parseOne(raw, html) {
  raw = raw.replace(/\s+/g, ' ').trim().replace(LIST_MARKER, '');
  const found =
    /\((\d{4}[a-z]?|n\.\s?d\.?)\)/i.exec(raw) || /(?:^|[\s,.])(\d{4}[a-z]?|n\.\s?d\.)(?=[\s.,;:)]|$)/i.exec(raw);
  const year = found ? found[1].replace(/\s/g, '') : 'n.d.';
  const authorPart = found ? raw.slice(0, found.index) : raw.split('. ')[0];
  let names = surnames(authorPart);
  if (!names.length) names = [raw.split(/[,.(]/)[0].trim()];
  return {
    id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    raw,
    html: html || esc(raw),
    authors: names,
    year
  };
}

function surnames(authorPart) {
  // first name first with a middle initial ("Simon J.D. Prince", "Donna J. Haraway"): keep the surname
  const withoutFirstNames = authorPart.replace(/\b[A-Z][a-zà-ÿ]+\s+((?:[A-Z]\.\s?-?)+)\s*([A-Z][\w'’À-ſ-]+)/g, '$2');
  const withoutInitials = withoutFirstNames
    .replace(/\(eds?\.?\)/gi, '')
    .replace(/\bet al\.?/gi, '')
    .replace(/\b[A-Z]\.(?:\s?-?[A-Z]\.)*/g, '')
    .replace(/(^|[\s,])[A-Z]{1,2}(?=[\s,]|$)/g, '$1');
  return withoutInitials
    .split(/,|;|&|\band\b/)
    .map(name => name.replace(/[()[\]]/g, '').trim())
    .filter(name => /[A-Za-z]/.test(name));
}

/* ---- splitting pasted rich text into references, keeping only italics ---- */
const REFERENCE_SKIPPED = /^(SCRIPT|STYLE|META|LINK|TITLE|HEAD)$/;
const REFERENCE_BLOCK = /^(P|DIV|LI|H[1-6]|TR|BLOCKQUOTE|UL|OL|TABLE|SECTION|ARTICLE|PRE)$/;

class ReferenceSplitter {
  constructor() {
    this.out = [];
    this.html = '';
    this.text = '';
  }

  /* the reference read so far ends here */
  flush() {
    const text = this.text.replace(/\s+/g, ' ').trim();
    if (text.length >= MIN_REFERENCE_LENGTH) {
      const html = this.html
        .replace(/\s+/g, ' ')
        .replace(/<em>\s*<\/em>/g, '')
        .trim()
        .replace(LIST_MARKER, '');
      this.out.push({ raw: text, html });
    }
    this.html = '';
    this.text = '';
  }

  walk(node) {
    node.childNodes.forEach(child => {
      if (child.nodeType === 3) this.readText(child);
      else if (child.nodeType === 1 && !REFERENCE_SKIPPED.test(child.tagName)) this.readElement(child);
    });
  }

  /* a line break in plain text (pasted as text, or in a <pre>) ends a reference */
  readText(node) {
    const breaksLines =
      /\n/.test(node.nodeValue) && node.parentNode && /^(PRE|BODY|DIV)$/.test(node.parentNode.tagName);
    node.nodeValue.split(/\n\s*\n|\n/).forEach((part, i) => {
      if (i > 0 && breaksLines) this.flush();
      this.html += esc(part);
      this.text += part;
    });
  }

  readElement(el) {
    const tag = el.tagName;
    if (tag === 'BR') {
      this.flush();
      return;
    }
    const block = REFERENCE_BLOCK.test(tag);
    const italic = tag === 'I' || tag === 'EM' || (el.style && el.style.fontStyle === 'italic');
    if (block) this.flush();
    if (italic) this.html += '<em>';
    this.walk(el);
    if (italic) this.html += '</em>';
    if (block) this.flush();
  }
}

export function splitRich(html) {
  const splitter = new ReferenceSplitter();
  splitter.walk(new DOMParser().parseFromString(html, 'text/html').body);
  splitter.flush();
  return splitter.out;
}

/* ---- ordering, counting and naming ---- */
export function sortedRefs() {
  return refs.slice().sort((a, b) => a.raw.localeCompare(b.raw, undefined, { sensitivity: 'base' }));
}

export function orderedRefs() {
  return refSort === 'manual' ? refs.slice() : sortedRefs();
}

export function refHTML(r) {
  return r.html || esc(r.raw);
}

/* how many citations in a document's HTML name this reference */
export function citeCount(id, src) {
  const citations = new RegExp('data-cite="[^"]*' + id, 'g');
  return ((src || '').match(citations) || []).length;
}

export function namePart(r) {
  const authors = r.authors || [];
  if (authors.length >= ET_AL_FROM) return authors[0] + ' et al.';
  if (authors.length === 2) return authors[0] + ' & ' + authors[1];
  return authors[0] || 'Anon.';
}

/* each reference's year as cited: 2020a and 2020b when one author has two from the same year */
export function yearLabels() {
  const groups = {};
  const labels = {};
  sortedRefs().forEach(r => {
    const key = namePart(r) + '|' + r.year;
    (groups[key] = groups[key] || []).push(r);
  });
  Object.values(groups).forEach(group => {
    group.forEach((r, i) => {
      const lettered = group.length > 1 && /^\d{4}$/.test(r.year);
      labels[r.id] = r.year + (lettered ? String.fromCharCode(LETTER_A + i) : '');
    });
  });
  return labels;
}

export function initReferences() {
  Store.saveEssays = storeSaveEssays;
  Store.loadEssays = storeLoadEssays;
  Store.saveRefs = storeSaveRefs;
  Store.loadRefs = storeLoadRefs;
}
