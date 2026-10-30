/* ===== reading a pasted syllabus line by line into sections and points ===== */
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

/* reads a pasted syllabus line by line. Each kind of line is tried in turn: a "# heading", "Specification point 1.1" on its
   own (its statement on the next line), "code | statement | guidance", "1.1 Statement", an all-capitals title, "Topic 2: …",
   a bullet (guidance for the point before it, or a point of its own), a line continuing the one before, or a plain point */
export class SyllabusDetector {
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
