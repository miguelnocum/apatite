/* ===== the syllabus: reading it from text, merging a new version into the points, saving ===== */
const NUMBERED_POINT = /^(\d+(?:\.\w+)+)\s+(.+)$/; // "2.1.U1 Statement", without a | between

/* "# Section" lines, then "code | statement | guidance" (or "2.1.U1 statement") lines */
function parseSyllabus(text) {
  let section = '';
  const points = [];
  text.split('\n').forEach(line => {
    line = line.trim();
    if (!line) return;
    if (line[0] === '#') section = line.replace(/^#+\s*/, '');
    else points.push(Object.assign({ sec: section }, parsePointLine(line)));
  });
  return points;
}

function parsePointLine(line) {
  const parts = line.split('|').map(part => part.trim());
  if (parts.length >= 2) return { code: parts[0], text: parts[1], guide: parts.slice(2).join(' | ') };
  const numbered = NUMBERED_POINT.exec(line);
  return numbered ? { code: numbered[1], text: numbered[2], guide: '' } : { code: '', text: line, guide: '' };
}

/* a point is the same point in a new version if it has the same code (or, without one, the same words) */
function pointKey(point) {
  return (point.code || '').trim().toLowerCase() || 't:' + point.text.trim().toLowerCase();
}

/* the points after applying a syllabus (text or parsed): matching points keep their ratings and notes; with replace,
   the others go, otherwise new ones are added after the old */
function planApply(text, replace) {
  const parsed = typeof text === 'string' ? parseSyllabus(text) : text;
  inferLevels(parsed);
  const old = {};
  pts.forEach(point => (old[pointKey(point)] = point));
  const used = {};
  const next = parsed.map(point => matchedPoint(point, old, used));
  return {
    next: replace ? next : pts.concat(next.filter(point => !old[pointKey(point)])),
    removed: replace ? pts.filter(point => !used[pointKey(point)]) : [],
    parsed
  };
}

/* the old point updated to the new version's words, or a new point */
function matchedPoint(point, old, used) {
  const key = pointKey(point);
  const match = old[key] && !used[key] ? old[key] : null;
  const words = { sec: point.sec, code: point.code, text: point.text, guide: point.guide };
  if (!match) return Object.assign({ id: uid() }, words, { status: 0, notes: '', lvl: point.lvl });
  used[key] = 1;
  return Object.assign(match, words, { lvl: point.lvl });
}

/* the points saved in this order (and those removed deleted) */
function commit(list, removed) {
  normLevels(list);
  list.forEach((point, i) => (point.order = i + 1));
  pts = list;
  (removed || []).forEach(point => Store.delPoint(point.id));
  Store.saveLocal();
  pts.forEach(point => Store.savePoint(point));
}

/* the points, section by section (idx counts every section, in order) */
function groups() {
  const sections = [];
  let section = null;
  pts.forEach(point => {
    if (!section || section.sec !== point.sec) {
      section = { sec: point.sec, idx: sections.length, items: [], all: [] };
      sections.push(section);
    }
    section.all.push(point);
    section.items.push(point);
  });
  return sections;
}
