/* ===== tables: column widths (in % of the table, kept on a <colgroup>) and row heights, set by dragging a border, by
   number in the table tab, or by a rule for the whole table: equal columns, fit to text, every row at least so high ===== */
const MIN_COLUMN_SHARE = 5; // % of the table a column keeps
const MIN_ROW_HEIGHT = 16; // px
const MAX_ROW_HEIGHT = 600;

function tableColumns(table) {
  return [...table.querySelectorAll(':scope > colgroup > col')];
}

/* the widths set on the table's columns, one each (none: the columns fit their text) */
function setShares(table) {
  const cols = tableColumns(table);
  const shares = cols.map(colShare);
  return cols.length === tableGrid(table).width && shares.every(share => share > 0) ? shares : null;
}

/* the page's scale (zoom), to turn the pointer's movement into the page's own px */
function pageScale(el) {
  return el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1;
}

/* the x of each column's left edge, and of the last one's right edge, in window px */
function columnEdges(table) {
  const grid = tableGrid(table);
  const edges = [];
  grid.at.forEach((span, cell) => {
    const box = cell.getBoundingClientRect();
    if (edges[span.c] == null) edges[span.c] = box.left;
    if (edges[span.c + span.cs] == null) edges[span.c + span.cs] = box.right;
  });
  /* a column every cell spans past gets its edge halfway */
  for (let c = 1; c < grid.width; c++) {
    if (edges[c] != null) continue;
    let next = c + 1;
    while (edges[next] == null) next++;
    edges[c] = edges[c - 1] + (edges[next] - edges[c - 1]) / (next - c + 1);
  }
  return edges;
}

/* each column's width as a share (%) of the table */
function columnShares(table) {
  const edges = columnEdges(table);
  const total = edges[edges.length - 1] - edges[0] || 1;
  return edges.slice(1).map((x, c) => ((x - edges[c]) / total) * 100);
}

/* widths given to every column (the table's layout then fixed, so they hold) */
function setColumnShares(table, shares) {
  let group = table.querySelector(':scope > colgroup');
  if (!group) group = table.insertBefore(mk('colgroup'), table.firstChild);
  group.innerHTML = shares.map(share => `<col style="width:${share.toFixed(2)}%">`).join('');
  table.setAttribute('data-fixed', '');
}

function colShare(col) {
  return parseFloat(col.style.width) || 0;
}

/* the shares scaled so they add up to the whole table */
function fillShares(shares) {
  const total = shares.reduce((sum, share) => sum + share, 0) || 1;
  return shares.map(share => (share / total) * 100);
}

/* ---- columns added, deleted and moved keep their widths (a new one as wide as its neighbour) ---- */
function columnInserted(table, at) {
  const shares = setShares(table);
  if (!shares) return;
  shares.splice(at, 0, shares[Math.min(at, shares.length - 1)]);
  setColumnShares(table, fillShares(shares));
}

function columnsDeleted(table, c0, c1) {
  const shares = setShares(table);
  if (shares) setColumnShares(table, fillShares(shares.filter((share, c) => c < c0 || c > c1)));
}

function columnsMoved(table, order) {
  const shares = setShares(table);
  if (shares)
    setColumnShares(
      table,
      order.map(c => shares[c])
    );
}

/* ---- the table tab's size boxes and rules ---- */
/* the selected columns this share each; the others share the rest as they did */
function setSelectedColumnWidth(t, share) {
  const shares = columnShares(t.table);
  const count = t.rect.c1 - t.rect.c0 + 1;
  const others = shares.length - count;
  const each = Math.max(MIN_COLUMN_SHARE, Math.min(share, (100 - others * MIN_COLUMN_SHARE) / count));
  const rest = shares.filter((s, c) => c < t.rect.c0 || c > t.rect.c1);
  const restTotal = rest.reduce((sum, s) => sum + s, 0) || 1;
  const next = shares.map((s, c) =>
    c >= t.rect.c0 && c <= t.rect.c1 ? each : Math.max(MIN_COLUMN_SHARE, (s / restTotal) * (100 - each * count))
  );
  changeTable(t.table, () => setColumnShares(t.table, others ? fillShares(next) : next));
}

function equalColumns(t) {
  const width = t.grid.width;
  changeTable(t.table, () => setColumnShares(t.table, Array(width).fill(100 / width)));
}

/* widths back to fitting the text */
function fitColumnsToText(t) {
  changeTable(t.table, () => {
    const group = t.table.querySelector(':scope > colgroup');
    if (group) group.remove();
    t.table.removeAttribute('data-fixed');
  });
}

/* the selected rows this high (px), or back to fitting their text (no height) */
function setSelectedRowHeight(t, height) {
  changeTable(t.table, () => {
    for (let r = t.rect.r0; r <= t.rect.r1; r++) setRowHeight(t.grid.rows[r], height);
  });
}

function setRowHeight(row, height) {
  if (height) row.style.height = Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, Math.round(height))) + 'px';
  else row.style.removeProperty('height');
  if (!row.getAttribute('style')) row.removeAttribute('style');
}

/* every row of the table at least this high (rows given their own height keep it) */
function setAllRowsHeight(t, height) {
  changeTable(t.table, () => setTableVar(t.table, '--row-h', height ? Math.round(height) + 'px' : ''));
}

/* a table's own setting, kept as a custom property in its style (removed when empty) */
function setTableVar(table, name, value) {
  if (value) table.style.setProperty(name, value);
  else table.style.removeProperty(name);
  if (!table.getAttribute('style')) table.removeAttribute('style');
}

function tableVar(table, name) {
  return table.style.getPropertyValue(name).trim();
}

/* ---- dragging a border: a column's right edge (its neighbour gives or takes the room), or a row's bottom edge ---- */
function startColumnResize(table, c, x) {
  beginTableChange(table);
  const edges = columnEdges(table);
  ui.tresize = { kind: 'c', table: table, c: c, x: x, edges: edges, shares: columnShares(table) };
}

function dragColumnBorder(drag, x) {
  const total = drag.edges[drag.edges.length - 1] - drag.edges[0] || 1;
  const moved = ((x - drag.x) / total) * 100;
  const pair = drag.shares[drag.c] + drag.shares[drag.c + 1];
  const left = Math.max(MIN_COLUMN_SHARE, Math.min(pair - MIN_COLUMN_SHARE, drag.shares[drag.c] + moved));
  const shares = drag.shares.slice();
  shares[drag.c] = left;
  shares[drag.c + 1] = pair - left;
  setColumnShares(drag.table, shares);
}

function startRowResize(table, r, y) {
  beginTableChange(table);
  const row = tableGrid(table).rows[r];
  ui.tresize = { kind: 'r', table: table, row: row, y: y, height: row.offsetHeight, scale: pageScale(table) };
}

function dragRowBorder(drag, y) {
  setRowHeight(drag.row, drag.height + (y - drag.y) / drag.scale);
}

function endResize() {
  ui.tresize = null;
  endTableChange();
}
