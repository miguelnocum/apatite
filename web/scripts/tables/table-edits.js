import { toast, ui } from '../core/helpers-and-state.js';
import { mk } from '../core/paste-cleaning.js';
import { fire } from '../editor/editor-commands.js';
import {
  cellsIn,
  clearCellSelection,
  crossesColumnLine,
  crossesRowLine,
  emptyCell,
  rowTag,
  selectColumns,
  selectRows,
  selectionKind,
  tableGrid,
  wholeRect
} from './table-grid.js';
import { columnInserted, columnsDeleted, columnsMoved } from './table-sizing.js';
import { tableChanged } from './table-handles.js';
import { caretInto } from '../essays/essays.js';
import { MD } from '../writing/writing.js';

/* ===== tables: rows and columns added, deleted and moved, cells merged and split; every change undoable with ⌘Z ===== */
const TABLE_UNDO_LIMIT = 50;
const tableUndos = []; // { table, copy, parent, next }: each table as it was before a change, newest last
const tableUndoHook = { undo: undoTableChange };

/* a change to a table: the table as it was kept for ⌘Z, the notes saved, the handles and tab redrawn */
export function changeTable(table, change) {
  beginTableChange(table);
  change();
  endTableChange();
}

/* (a drag begins the change when it starts and ends it when it's let go) */
export function beginTableChange(table) {
  if (MD.last !== tableUndoHook) tableUndos.length = 0;
  const copy = table.cloneNode(true);
  copy.classList.remove('tselecting');
  copy.querySelectorAll('.tsel').forEach(cell => cell.classList.remove('tsel'));
  tableUndos.push({ table: table, copy: copy, parent: table.parentNode, next: table.nextSibling });
  if (tableUndos.length > TABLE_UNDO_LIMIT) tableUndos.shift();
}

export function endTableChange() {
  MD.last = tableUndoHook;
  fire();
  tableChanged();
}

/* ⌘Z: the table put back as it was (and again, while there are earlier changes to tables) */
function undoTableChange() {
  const entry = tableUndos.pop();
  if (!entry) return;
  clearCellSelection();
  if (entry.table.isConnected) entry.table.replaceWith(entry.copy);
  else if (entry.next && entry.next.parentNode === entry.parent) entry.parent.insertBefore(entry.copy, entry.next);
  else entry.parent.appendChild(entry.copy);
  tableUndos.forEach(earlier => {
    if (earlier.table === entry.table) earlier.table = entry.copy;
  });
  caretInto(entry.copy.querySelector('td,th'));
  if (tableUndos.length) MD.last = tableUndoHook;
  tableChanged();
}

/* the caret in the cell at a place in the grid (the nearest one, if the table got smaller) */
function caretToCell(table, r, c) {
  const grid = tableGrid(table);
  const row = grid.map[Math.max(0, Math.min(r, grid.rows.length - 1))];
  caretInto(row && row[Math.max(0, Math.min(c, row.length - 1))]);
}

/* ---- rows ---- */
/* count new rows before grid row `at` (at the end, when at is the number of rows); a merged cell across the spot grows */
export function insertRows(t, at, count) {
  changeTable(t.table, () => {
    for (let i = 0; i < count; i++) insertRowAt(t.table, at);
  });
  caretToCell(t.table, at, t.rect.c0);
}

function insertRowAt(table, at) {
  const grid = tableGrid(table);
  const row = mk('tr');
  for (let c = 0; c < grid.width; ) {
    const cell = at < grid.rows.length ? grid.map[at][c] : null;
    const span = cell && grid.at.get(cell);
    if (span && span.r < at) {
      cell.rowSpan = span.rs + 1;
      c += span.cs;
    } else {
      row.appendChild(emptyCell('td'));
      c++;
    }
  }
  if (at < grid.rows.length) grid.rows[at].before(row);
  else grid.rows[grid.rows.length - 1].after(row);
}

export function deleteRows(t) {
  const { r0, r1 } = t.rect;
  if (r0 === 0 && r1 === t.grid.rows.length - 1) {
    deleteTable(t);
    return;
  }
  changeTable(t.table, () => deleteRowsAt(t.table, r0, r1));
  caretToCell(t.table, r0, t.rect.c0);
}

/* a merged cell that starts in a deleted row moves down to the first row kept, a row shorter */
function deleteRowsAt(table, r0, r1) {
  const grid = tableGrid(table);
  grid.at.forEach((span, cell) => {
    const overlap = Math.min(span.r + span.rs - 1, r1) - Math.max(span.r, r0) + 1;
    if (overlap <= 0 || overlap === span.rs) return;
    if (span.r >= r0) {
      const below = grid.rows[r1 + 1];
      const anchor = [...below.cells].find(other => grid.at.get(other).c > span.c);
      below.insertBefore(cell, anchor || null);
    }
    cell.rowSpan = span.rs - overlap;
  });
  for (let r = r1; r >= r0; r--) grid.rows[r].remove();
}

/* rows r0…r1 (and any merged with them) moved up or down past the row (or merged rows) next to them */
export function moveRows(t, step) {
  const grid = t.grid;
  const rect = wholeRect(grid, { r0: t.rect.r0, r1: t.rect.r1, c0: 0, c1: grid.width - 1 });
  t = Object.assign({}, t, { rect: rect });
  let to = step < 0 ? rect.r0 - 1 : rect.r1 + 2;
  while (to > 0 && to < grid.rows.length && crossesRowLine(grid, to)) to += step;
  if (to < 0 || to > grid.rows.length) return;
  moveRowBlock(t, to);
}

/* rows r0…r1 put before grid row `to` (the end, when to is the number of rows) */
export function moveRowBlock(t, to) {
  const { grid, rect, table } = t;
  if (crossesRowLine(grid, rect.r0) || crossesRowLine(grid, rect.r1 + 1) || crossesRowLine(grid, to)) {
    toast('Unmerge the cells across these rows first');
    return;
  }
  if (to >= rect.r0 && to <= rect.r1 + 1) return;
  const block = grid.rows.slice(rect.r0, rect.r1 + 1);
  const ref = grid.rows[to] || null;
  const parent = ref ? ref.parentNode : grid.rows[grid.rows.length - 1].parentNode;
  changeTable(table, () => block.forEach(row => parent.insertBefore(row, ref)));
  const r0 = to > rect.r1 ? to - block.length : to;
  selectRows(table, r0, r0 + block.length - 1);
}

/* ---- columns ---- */
export function insertColumns(t, at, count) {
  changeTable(t.table, () => {
    for (let i = 0; i < count; i++) insertColumnAt(t.table, at);
  });
  caretToCell(t.table, t.rect.r0, at);
}

/* a column before grid column `at`: a header cell in a header row; a merged cell across the spot grows */
function insertColumnAt(table, at) {
  const grid = tableGrid(table);
  grid.rows.forEach((row, r) => {
    const cell = at < grid.width ? grid.map[r][at] : null;
    const span = cell && grid.at.get(cell);
    if (span && span.c < at) {
      if (span.r === r) cell.colSpan = span.cs + 1;
      return;
    }
    const anchor = [...row.cells].find(other => grid.at.get(other).c >= at);
    row.insertBefore(emptyCell(rowTag(row)), anchor || null);
  });
  columnInserted(table, at);
}

export function deleteColumns(t) {
  const { c0, c1 } = t.rect;
  if (c0 === 0 && c1 === t.grid.width - 1) {
    deleteTable(t);
    return;
  }
  changeTable(t.table, () => {
    const grid = tableGrid(t.table);
    grid.at.forEach((span, cell) => {
      const overlap = Math.min(span.c + span.cs - 1, c1) - Math.max(span.c, c0) + 1;
      if (overlap <= 0) return;
      if (overlap === span.cs) cell.remove();
      else cell.colSpan = span.cs - overlap;
    });
    columnsDeleted(t.table, c0, c1);
  });
  caretToCell(t.table, t.rect.r0, c0);
}

export function moveColumns(t, step) {
  const grid = t.grid;
  const rect = wholeRect(grid, { r0: 0, r1: grid.rows.length - 1, c0: t.rect.c0, c1: t.rect.c1 });
  t = Object.assign({}, t, { rect: rect });
  let to = step < 0 ? rect.c0 - 1 : rect.c1 + 2;
  while (to > 0 && to < grid.width && crossesColumnLine(grid, to)) to += step;
  if (to < 0 || to > grid.width) return;
  moveColumnBlock(t, to);
}

/* columns c0…c1 put before grid column `to`: each row's cells put in the new order */
export function moveColumnBlock(t, to) {
  const { grid, rect, table } = t;
  if (crossesColumnLine(grid, rect.c0) || crossesColumnLine(grid, rect.c1 + 1) || crossesColumnLine(grid, to)) {
    toast('Unmerge the cells across these columns first');
    return;
  }
  if (to >= rect.c0 && to <= rect.c1 + 1) return;
  const order = movedOrder(grid.width, rect.c0, rect.c1, to);
  const place = [];
  order.forEach((column, i) => (place[column] = i));
  changeTable(table, () => {
    grid.rows.forEach(row => {
      const cells = [...row.cells].sort((a, b) => place[grid.at.get(a).c] - place[grid.at.get(b).c]);
      cells.forEach(cell => row.appendChild(cell));
    });
    columnsMoved(table, order);
  });
  const c0 = place[rect.c0];
  selectColumns(table, c0, c0 + rect.c1 - rect.c0);
}

/* the columns' old numbers in their new order: c0…c1 moved before `to` */
function movedOrder(width, c0, c1, to) {
  const all = [...Array(width).keys()];
  const block = all.slice(c0, c1 + 1);
  const rest = all.filter(c => c < c0 || c > c1);
  const at = rest.filter(c => c < to).length;
  return rest.slice(0, at).concat(block, rest.slice(at));
}

/* ---- the whole table ---- */
export function deleteTable(t) {
  const table = t.table;
  const after = table.nextElementSibling;
  clearCellSelection();
  changeTable(table, () => table.remove());
  ui.tblCell = null;
  if (after) caretInto(after);
  tableChanged();
}

/* ---- merging and splitting ---- */
/* the selected cells become one: the first keeps its place, the others' text follows it, a line each */
export function mergeCells(t) {
  const cells = cellsIn(t.grid, t.rect);
  if (cells.length < 2) {
    toast('Select two or more cells to merge (drag across them)');
    return;
  }
  const first = t.grid.map[t.rect.r0][t.rect.c0];
  changeTable(t.table, () => {
    cells.filter(cell => cell !== first).forEach(cell => mergeInto(first, cell));
    first.rowSpan = t.rect.r1 - t.rect.r0 + 1;
    first.colSpan = t.rect.c1 - t.rect.c0 + 1;
  });
  clearCellSelection();
  caretInto(first);
}

function mergeInto(first, cell) {
  if (cellHasContent(cell)) {
    if (cellHasContent(first)) first.appendChild(mk('br'));
    else first.innerHTML = '';
    while (cell.firstChild) first.appendChild(cell.firstChild);
  }
  cell.remove();
}

function cellHasContent(cell) {
  return !!(cell.textContent.trim() || cell.querySelector('img,[data-math],[data-imath]'));
}

/* each merged cell selected (or the caret's) split back into single cells, the new ones empty */
export function splitCells(t) {
  const merged = cellsIn(t.grid, t.rect).filter(cell => t.grid.at.get(cell).rs > 1 || t.grid.at.get(cell).cs > 1);
  if (!merged.length) {
    toast('Only merged cells can be split');
    return;
  }
  changeTable(t.table, () => merged.forEach(cell => splitCell(t.grid, cell)));
  clearCellSelection();
}

function splitCell(grid, cell) {
  const span = grid.at.get(cell);
  for (let r = span.r; r < span.r + span.rs; r++) {
    const row = grid.rows[r];
    const anchor = [...row.cells].find(other => other !== cell && grid.at.get(other).c > span.c);
    for (let c = span.c; c < span.c + span.cs; c++) {
      if (r === span.r && c === span.c) continue;
      const added = emptyCell(cell.tagName.toLowerCase());
      ['style', 'data-shade'].forEach(a => cell.hasAttribute(a) && added.setAttribute(a, cell.getAttribute(a)));
      row.insertBefore(added, anchor || null);
    }
  }
  cell.removeAttribute('rowspan');
  cell.removeAttribute('colspan');
}

/* ---- the selected cells' contents cleared (Delete on cells that aren't whole rows or columns) ---- */
export function clearCells(t) {
  changeTable(t.table, () => cellsIn(t.grid, t.rect).forEach(cell => (cell.innerHTML = '<br>')));
}

/* Delete or Backspace on a selection: whole rows or columns go, the whole table goes, otherwise the cells are emptied */
export function deleteSelection(t) {
  const kind = selectionKind(t.grid, t.rect);
  if (kind === 'table') deleteTable(t);
  else if (kind === 'rows') deleteRows(t);
  else if (kind === 'columns') deleteColumns(t);
  else clearCells(t);
}
