import { refs, yearLabels } from './references.js';

/* ===== linking citations typed as plain text: Whatmore (2009), (Whatmore, 2009, p. 4) ===== */
const CITE_NAME = "(?:(?:van|von|de|da|del|der|di|du|la|le|st\\.)\\s+)?\\p{Lu}[\\p{L}'’\\-]+";
const CITE_AUTH = CITE_NAME + '(?:\\s*(?:&|and)\\s*' + CITE_NAME + '|\\s+et\\s+al\\.?)?';
const CITE_TAIL = '(\\d{4}[a-z]?|n\\.d\\.)(?:,\\s*(?:pp?\\.\\s*)?(\\d+(?:\\s*[–\\-]\\s*\\d+)?))?';
export const CITE_NAR = new RegExp('(' + CITE_AUTH + ')\\s+\\(' + CITE_TAIL + '\\)', 'gu');
export const CITE_PAR = new RegExp('\\((' + CITE_AUTH + '),?\\s+' + CITE_TAIL + '\\)', 'gu');

/* a name compared without accents, case or curly apostrophes */
function plainKey(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .trim();
}

/* which Works Cited entries fit "Whatmore & Braun" + "2009a" (fewest authors first) */
export function citeCandidates(who, year) {
  const labels = yearLabels();
  const etAl = /\set\s+al\.?$/i.test(who);
  const names = who
    .replace(/\s+et\s+al\.?$/i, '')
    .split(/\s*(?:&|\band\b)\s*/)
    .map(plainKey)
    .filter(Boolean);
  return refs
    .filter(r => yearFits(r, labels, year) && authorsFit((r.authors || []).map(plainKey), names, etAl))
    .sort((a, b) => (a.authors || []).length - (b.authors || []).length);
}

/* the year as cited (2009a), or the plain year when no letter was typed */
function yearFits(r, labels, year) {
  const typed = year.toLowerCase();
  const cited = String(labels[r.id] || r.year || '').toLowerCase();
  return cited === typed || (String(r.year || '').toLowerCase() === typed && !/[a-z]$/.test(year));
}

/* the first author's surname; then both of two, or three or more for "et al." */
function authorsFit(authors, names, etAl) {
  if (!authors.length || authors[0] !== names[0]) return false;
  if (names.length === 2) return authors.length === 2 && authors[1] === names[1];
  if (etAl) return authors.length >= 3;
  return true;
}
