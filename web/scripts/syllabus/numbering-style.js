import { $, esc, ui } from '../core/helpers-and-state.js';
import { SyllabusDetector } from './syllabus-detector.js';

/* ===== a pasted syllabus read by the numbering the user describes: "1" for section titles, "1a" for points, and so on.
   Each example becomes a pattern: a number matches any number, a single letter any letter of its case, a Roman numeral any
   Roman numeral, a Chinese numeral (第一课时) any Chinese numeral, a word ("Topic") itself, and punctuation itself ===== */
const CHINESE_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CHINESE_NUMERAL = '[' + Object.keys(CHINESE_DIGITS).join('') + '十百]+';
const STYLE_PART = new RegExp('\\d+|' + CHINESE_NUMERAL + '|[A-Za-z]+|\\s+|.', 'g');
const LIST_MARK = /^[-*•·–]\s+(?=\S)/; // a bullet before a line, as pasted from a list
const ROMAN = /^(?=[ivxlcdm])m*(?:c[md]|d?c{0,3})(?:x[cl]|l?x{0,3})(?:i[xv]|v?i{0,3})$/i;
/* the marker ends at a space, punctuation (full-width too: ：、) or the line's end, but not inside a longer number ("1" isn't
   the start of "1.1") */
const MARKER_END = '[\\s:.)\\]\u2013\u2014\uff1a\u3001\uff0e\uff09-]';
const AFTER_MARKER = '(?![.\\-][0-9A-Za-z])(?=$|' + MARKER_END + ')' + MARKER_END + '*(.*)$';

/* "1a" → /^(\d+[a-z])…/, "Topic 1" → /^([Tt][Oo][Pp][Ii][Cc]\s+\d+)…/; nothing typed → null (detected automatically) */
function styleToRegex(example) {
  const parts = (example || '').trim().match(STYLE_PART);
  return parts ? new RegExp('^(' + parts.map(stylePart).join('') + ')' + AFTER_MARKER) : null;
}

function stylePart(part) {
  if (/^\d+$/.test(part)) return '\\d+';
  if (new RegExp('^' + CHINESE_NUMERAL + '$').test(part)) return CHINESE_NUMERAL;
  if (/^\s+$/.test(part)) return '\\s+';
  if (!/^[A-Za-z]+$/.test(part)) return part.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  const lower = part === part.toLowerCase();
  if (ROMAN.test(part) && (part.length > 1 || /^[iI]$/.test(part))) return lower ? '[ivxlcdm]+' : '[IVXLCDM]+';
  if (part.length === 1) return lower ? '[a-z]' : '[A-Z]';
  return [...part].map(c => '[' + c.toUpperCase() + c.toLowerCase() + ']').join('');
}

/* "(a)" → "a", "1a." → "1a"; with Chinese numerals, the numbers alone: "第五课时-第三章节" → "5.3" */
function bareCode(marker) {
  const chinese = marker.match(new RegExp('\\d+|' + CHINESE_NUMERAL, 'g'));
  if (chinese && /[^\x00-\x7f]/.test(marker)) return chinese.map(chineseNumber).join('.');
  return marker.trim().replace(/^[([]+|[.:)\]]+$/g, '');
}

/* "十二" → 12, "二十" → 20, "一百零五" → 105, "二〇二四" → 2024, "7" → 7 */
function chineseNumber(numeral) {
  if (/^\d+$/.test(numeral)) return +numeral;
  const digit = c => CHINESE_DIGITS[c];
  if (!/[十百]/.test(numeral)) return +[...numeral].map(digit).join('');
  let total = 0;
  let unit = 0;
  [...numeral].forEach(c => {
    if (c === '十' || c === '百') {
      total += (unit || 1) * (c === '十' ? 10 : 100);
      unit = 0;
    } else unit = digit(c);
  });
  return total + unit;
}

/* a line as the style patterns see it: without a list's bullet in front */
function unlisted(line) {
  return line.replace(LIST_MARK, '');
}

/* the detector for the styles typed in (or the automatic one when both are empty) */
export function detectorFor(sectionStyle, pointStyle) {
  const sectionPattern = styleToRegex(sectionStyle);
  const pointPattern = styleToRegex(pointStyle);
  return sectionPattern || pointPattern
    ? new StyledSyllabusDetector(sectionPattern, pointPattern)
    : new SyllabusDetector();
}

/* points are tried before sections, so "1.1 Water" is a point even when "1" starts a section; a line that matches neither
   carries on the line before it (a section title given only its number takes the next line as its name) */
class StyledSyllabusDetector extends SyllabusDetector {
  constructor(sectionPattern, pointPattern) {
    super();
    this.sectionPattern = sectionPattern;
    this.pointPattern = pointPattern;
    this.untitled = false; // the section has a number and is waiting for its name
  }

  readLine(line) {
    if (!line) return;
    if (this.pendingCode != null && this.statementForCode(line)) return;
    if (this.styledPoint(unlisted(line)) || this.styledSection(unlisted(line))) return;
    const kinds = [];
    if (!this.sectionPattern) kinds.push('heading', 'capitalsTitle', 'topicTitle');
    if (!this.pointPattern) kinds.push('specPointAlone', 'pipeRow', 'codedPoint');
    if (kinds.some(kind => this[kind](line))) return;
    /* before the first section title: the document's own title and introduction, left out */
    if (this.sectionPattern && !this.current) return;
    if (this.untitled) this.nameSection(line);
    else if (!this.bullet(line) && !this.carryOn(line)) this.item('', line);
  }

  styledPoint(line) {
    const m = this.pointPattern && this.pointPattern.exec(line);
    if (!m) return false;
    this.untitled = false;
    if (m[2].trim()) this.item(bareCode(m[1]), m[2].trim());
    else this.pendingCode = bareCode(m[1]);
    return true;
  }

  styledSection(line) {
    const m = this.sectionPattern && this.sectionPattern.exec(line);
    if (!m) return false;
    this.untitled = !m[2].trim();
    return this.newSection(line);
  }

  nameSection(line) {
    this.current.title += ' ' + line;
    this.untitled = false;
  }

  /* with the points' numbering known, an unnumbered line after a point is more of it, whatever its case */
  carryOn(line) {
    if (!this.last || !this.pointPattern) return false;
    this.last.text += ' ' + line;
    return true;
  }
}

/* "4 section titles and 23 points match", under the style boxes, as the user types */
function styleMatchSummary() {
  const sectionPattern = styleToRegex(ui.secStyle);
  const pointPattern = styleToRegex(ui.ptStyle);
  if (!sectionPattern && !pointPattern) return 'Leave both empty to detect the numbering automatically.';
  const lines = (ui.paste || '').split('\n').map(line => unlisted(line.trim()));
  const points = pointPattern ? lines.filter(line => pointPattern.test(line)) : [];
  const sections = sectionPattern ? lines.filter(line => !points.includes(line) && sectionPattern.test(line)) : [];
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const counts = [];
  if (sectionPattern) counts.push(plural(sections.length, 'section title'));
  if (pointPattern) counts.push(plural(points.length, 'point'));
  return 'In the pasted text: ' + counts.join(' and ') + '.';
}

export function showStyleMatches() {
  const summary = $('stylehint');
  if (summary) summary.textContent = styleMatchSummary();
}

export function numberingStyleHTML() {
  const box = (id, value, label, example) =>
    `<label class="stylebox">${label}<input id="${id}" value="${esc(value || '')}" placeholder="auto" spellcheck="false" ` +
    `aria-label="${label}"><span>e.g. ${example}</span></label>`;
  return (
    '<div class="numstyle"><div class="numstyle-head">Numbering <span>(optional)</span></div><div class="row">' +
    box('secstyle', ui.secStyle, 'Section titles look like', '1, Topic 1, A, Unit I, 第一课时') +
    box('ptstyle', ui.ptStyle, 'Points look like', '1a, 1.1, (a), i., 第一课时-第一章节') +
    `</div><div class="stylehint" id="stylehint">${esc(styleMatchSummary())}</div></div>`
  );
}
