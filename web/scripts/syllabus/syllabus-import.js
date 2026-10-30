/* ===== a whole syllabus pasted in: its sections and points detected, reviewed as a draft, then added ===== */
const SPEC_CODE_LINE =
  /^(?:spec(?:ification)?\.?\s*point\s*)?(\d+(?:\.[0-9A-Za-z]+)+|\d+(?=[.)]\s))[:.)\s–—-]+\s*(.+)$/i;
const SPEC_POINT_ALONE = /^spec(?:ification)?\.?\s*point\s*(\d+(?:\.[0-9A-Za-z]+)*)\s*[:.\-–]?\s*$/i;
const TOPIC_TITLE = /^(?:topic|unit|chapter|section|module|theme|part)\s*\d*\s*[:.\-–—]?\s*(.*)$/i;
const BULLET_LINE = /^(?:\(?[a-z]\)|\(?[ivx]+\)|[-•–*·])\s+(.+)$/i;
const MARKDOWN_HEADING = /^#+\s*(.+)$/;
const SMALL_TITLE_WORDS = /^(and|or|of|the|a|an|in|on|to|for|with|vs)$/i;
const MAX_TITLE_LENGTH = 80; // longer lines are statements, not titles
const MIN_CAPITALS_TITLE_LETTERS = 4; // an all-capitals line with this many letters is a title
/* the kinds of line, tried in this order (each a SyllabusDetector method that takes the line if it's of its kind) */
const LINE_KINDS = ['heading', 'specPointAlone', 'pipeRow', 'codedPoint', 'capitalsTitle', 'topicTitle', 'bullet'];

/* "CELL BIOLOGY" → "Cell Biology" (small words stay small, after the first) */
function titleCase(text) {
  return text
    .toLowerCase()
    .replace(/[a-z0-9]+/g, (word, at) =>
      at > 0 && SMALL_TITLE_WORDS.test(word) ? word : word[0].toUpperCase() + word.slice(1)
    );
}

function detect(text) {
  return detectorFor(ui.secStyle, ui.ptStyle).read(text);
}

/* reads a pasted syllabus line by line. Each kind of line is tried in turn: a "# heading", "Specification point 1.1" on its
   own (its statement on the next line), "code | statement | guidance", "1.1 Statement", an all-capitals title, "Topic 2: …",
   a bullet (guidance for the point before it, or a point of its own), a line continuing the one before, or a plain point */
class SyllabusDetector {
  constructor() {
    this.groups = [];
    this.current = null; // the section being read
    this.last = null; // the last point read
    this.pendingCode = null; // a spec point's number, waiting for its statement
    this.afterBlank = true;
    this.anyCode = false;
    this.anySection = false;
  }

  read(text) {
    text
      .replace(/\r/g, '')
      .split('\n')
      .forEach(raw => this.readLine(raw.trim()));
    return this.arranged();
  }

  readLine(line) {
    if (!line) {
      this.afterBlank = true;
      return;
    }
    if (this.pendingCode != null && this.statementForCode(line)) return;
    if (LINE_KINDS.some(kind => this[kind](line))) {
      this.afterBlank = false;
      return;
    }
    if (this.continuation(line)) return;
    this.item('', line);
    this.afterBlank = false;
  }

  section(title) {
    this.current = { title: title, items: [] };
    this.groups.push(this.current);
    this.last = null;
  }

  item(code, text, guide) {
    if (!this.current) this.section('');
    this.last = { code: code, text: text, guide: guide || '', bs: this.afterBlank };
    if (code) this.anyCode = true;
    this.current.items.push(this.last);
  }

  newSection(title) {
    this.section(title);
    this.anySection = true;
    return true;
  }

  /* the line after "Specification point 1.1" is its statement (unless it's a heading) */
  statementForCode(line) {
    const code = this.pendingCode;
    this.pendingCode = null;
    if (/^#/.test(line)) return false;
    this.item(code, line.replace(/^[:\s]+/, ''));
    this.afterBlank = false;
    return true;
  }

  heading(line) {
    const m = MARKDOWN_HEADING.exec(line);
    return !!m && this.newSection(m[1].trim());
  }

  specPointAlone(line) {
    const m = SPEC_POINT_ALONE.exec(line);
    if (m) this.pendingCode = m[1];
    return !!m;
  }

  pipeRow(line) {
    if (!(line.indexOf('|') > 0 && /^[^|]+\|[^|]+/.test(line))) return false;
    const cells = line.split('|').map(cell => cell.trim());
    this.item(cells[0], cells[1], cells.slice(2).join(' | '));
    return true;
  }

  codedPoint(line) {
    const m = SPEC_CODE_LINE.exec(line);
    if (m) this.item(m[1], m[2].trim());
    return !!m;
  }

  capitalsTitle(line) {
    const letters = line.replace(/[^A-Za-z]/g, '');
    const isTitle = letters.length >= MIN_CAPITALS_TITLE_LETTERS && line === line.toUpperCase() && looksLikeTitle(line);
    return isTitle && this.newSection(titleCase(line));
  }

  topicTitle(line) {
    const m = TOPIC_TITLE.exec(line);
    return !!m && looksLikeTitle(line) && !!(m[1] || /\d/.test(line)) && this.newSection(line);
  }

  /* a bullet under a numbered point is its guidance; otherwise it's a point */
  bullet(line) {
    const m = BULLET_LINE.exec(line);
    if (!m) return false;
    if (this.last && this.last.code) this.last.guide = (this.last.guide ? this.last.guide + '; ' : '') + m[1];
    else this.item('', m[1]);
    return true;
  }

  /* a line starting in lower case, straight after a point, carries on its statement */
  continuation(line) {
    if (!(this.last && !this.afterBlank && /^[a-z(]/.test(line))) return false;
    this.last.text += ' ' + line;
    return true;
  }

  /* without section titles: numbered points are grouped by their numbers; plain ones by the blank lines between them */
  arranged() {
    const groups = this.groups.filter(g => g.items.length);
    const points = groups.flatMap(g => g.items);
    if (this.anySection) return groups;
    if (this.anyCode) return groupByCode(points);
    return groupByParagraph(points);
  }
}

function looksLikeTitle(line) {
  return line.length <= MAX_TITLE_LENGTH && !/[.;]$/.test(line);
}

/* 2.1.3 goes under "Topic 2.1", 4.1 under "Topic 4"; points without numbers under "Other" */
function groupByCode(points) {
  const groups = [];
  let current = null;
  points.forEach(point => {
    const parts = (point.code || '').split('.');
    const prefix = parts.length >= 3 ? parts.slice(0, -1).join('.') : parts[0];
    const title = point.code ? 'Topic ' + prefix : 'Other';
    if (!current || current.title !== title) {
      current = { title: title, items: [] };
      groups.push(current);
    }
    current.items.push(point);
  });
  return groups;
}

/* points after a blank line start a new section (when there are at least two such starts) */
function groupByParagraph(points) {
  if (points.filter(p => p.bs).length < 2) return [{ title: 'Syllabus', items: points }];
  const groups = [];
  let current = null;
  points.forEach(point => {
    if (!current || point.bs) {
      current = { title: 'Section ' + (groups.length + 1), items: [] };
      groups.push(current);
    }
    current.items.push(point);
  });
  return groups;
}

/* ---- "Suggest grouping with Claude": the points, grouped into titled sections ---- */
function suggestGrouping() {
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
function sectionNames() {
  const names = [];
  pts.forEach(p => {
    if (!names.includes(p.sec)) names.push(p.sec);
  });
  return names;
}

function secPrefix(section) {
  const m = /^\s*(\d+(?:\.\d+)*)(?=[\s.:)\-–—]|$)/.exec(section || '');
  return m ? m[1] : '';
}

/* "2.1.4" → "2.1.5" */
function bump(code) {
  const m = /^(.*?)(\d+)$/.exec(code || '');
  return m ? m[1] + (+m[2] + 1) : '';
}

/* the number a point would have: one after the last numbered point before it, or the first in its section */
function suggestCode(point) {
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
function importHTML() {
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

function renderSetup() {
  render();
}
