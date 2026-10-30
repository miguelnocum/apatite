import { ui } from '../core/helpers-and-state.js';
import { mk } from '../editor/paste-cleaning.js';
import { closestTag, inEd } from '../editor/editor-commands.js';
import { refreshTableTab } from './table-tab.js';

/* ===== tables, Word-style: the grid behind a table, where a merged cell takes several places, and the cells selected in it.
   A rect is { r0, r1, c0, c1 }: rows r0 to r1 and columns c0 to c1 of the grid, both ends included ===== */

/* the table's grid: map[r][c] is the cell at row r, column c; at holds each cell's own place and spans */
export function tableGrid(table) {
  const rows = [...table.rows];
  const map = rows.map(() => []);
  const at = new Map();
  rows.forEach((row, r) => {
    let c = 0;
    [...row.cells].forEach(cell => {
      while (map[r][c]) c++;
      const rs = Math.min(cell.rowSpan || rows.length - r, rows.length - r);
      const cs = Math.max(1, cell.colSpan || 1);
      at.set(cell, { r: r, c: c, rs: rs, cs: cs });
      for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) map[i][j] = cell;
      c += cs;
    });
  });
  const width = Math.max(0, ...map.map(line => line.length));
  return { table: table, rows: rows, map: map, at: at, width: width };
}

/* a row short of cells (pasted from elsewhere) is filled out, so every place in the grid has a cell */
export function squareTable(table) {
  const grid = tableGrid(table);
  grid.rows.forEach((row, r) => {
    for (let c = 0; c < grid.width; c++) if (!grid.map[r][c]) row.appendChild(emptyCell(rowTag(row)));
  });
  return tableGrid(table);
}

export function emptyCell(tag) {
  const cell = mk(tag);
  cell.innerHTML = '<br>';
  return cell;
}

/* a header row (all th) takes header cells; any other row ordinary ones */
export function rowTag(row) {
  const cells = [...row.cells];
  return cells.length && cells.every(cell => cell.tagName === 'TH') ? 'th' : 'td';
}

export function cellRect(grid, cell) {
  const span = grid.at.get(cell);
  return { r0: span.r, r1: span.r + span.rs - 1, c0: span.c, c1: span.c + span.cs - 1 };
}

/* the cells in a rect, each once */
export function cellsIn(grid, rect) {
  const cells = new Set();
  for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) cells.add(grid.map[r][c]);
  cells.delete(undefined);
  return [...cells];
}

/* a rect grown until no merged cell sticks out of it */
export function wholeRect(grid, rect) {
  const out = Object.assign({}, rect);
  let grew = true;
  while (grew) {
    grew = false;
    cellsIn(grid, out).forEach(cell => {
      const own = cellRect(grid, cell);
      const wider = own.r0 < out.r0 || own.r1 > out.r1 || own.c0 < out.c0 || own.c1 > out.c1;
      if (!wider) return;
      Object.assign(out, joinRects(out, own));
      grew = true;
    });
  }
  return out;
}

export function joinRects(a, b) {
  return {
    r0: Math.min(a.r0, b.r0),
    r1: Math.max(a.r1, b.r1),
    c0: Math.min(a.c0, b.c0),
    c1: Math.max(a.c1, b.c1)
  };
}

/* a merged cell crosses the line above row b (or left of column c) */
export function crossesRowLine(grid, b) {
  return [...grid.at.values()].some(span => span.r < b && span.r + span.rs > b);
}

export function crossesColumnLine(grid, b) {
  return [...grid.at.values()].some(span => span.c < b && span.c + span.cs > b);
}

/* ---- a text selection kept to one cell: WebKit often ends one at the very start of the next cell, and wrapping
   that (in a comment or highlight) would copy pieces of both cells into the first ---- */
export function rangeWithinCell(range) {
  const start = cellOf(range.startContainer);
  const end = cellOf(range.endContainer);
  if (start === end) return range;
  const clipped = range.cloneRange();
  if (start) {
    clipped.setEnd(start, start.childNodes.length);
    if (clipped.toString().trim() || !end) return clipped;
    clipped.setStart(end, 0); // nothing of the first cell was selected: the cell it ends in
    clipped.setEnd(range.endContainer, range.endOffset);
  } else clipped.setEndBefore(end.closest('table')); // from text above a table: up to the table
  return clipped;
}

function cellOf(node) {
  const el = node && (node.nodeType === 3 ? node.parentNode : node);
  return el && el.closest ? el.closest('td,th') : null;
}

/* ---- the selected cells: ui.tsel is { table, rect } while more than the caret's cell is selected ---- */
export function selectCells(table, rect) {
  clearCellSelection();
  const grid = tableGrid(table);
  const whole = wholeRect(grid, rect);
  ui.tsel = { table: table, rect: whole };
  cellsIn(grid, whole).forEach(cell => cell.classList.add('tsel'));
  table.classList.add('tselecting');
  refreshTableTab();
}

export function clearCellSelection() {
  if (!ui.tsel) return;
  const table = ui.tsel.table;
  ui.tsel = null;
  table.classList.remove('tselecting');
  if (!table.getAttribute('class')) table.removeAttribute('class');
  table.querySelectorAll('.tsel').forEach(cell => {
    cell.classList.remove('tsel');
    if (!cell.getAttribute('class')) cell.removeAttribute('class');
  });
}

/* the whole of rows r0…r1 (or columns c0…c1, or the table) selected */
export function selectRows(table, r0, r1) {
  const grid = tableGrid(table);
  selectCells(table, { r0: Math.min(r0, r1), r1: Math.max(r0, r1), c0: 0, c1: grid.width - 1 });
}

export function selectColumns(table, c0, c1) {
  const grid = tableGrid(table);
  selectCells(table, { r0: 0, r1: grid.rows.length - 1, c0: Math.min(c0, c1), c1: Math.max(c0, c1) });
}

/* what the selection covers: 'table', 'rows', 'columns' or 'cells' */
export function selectionKind(grid, rect) {
  const allRows = rect.r0 === 0 && rect.r1 === grid.rows.length - 1;
  const allColumns = rect.c0 === 0 && rect.c1 === grid.width - 1;
  if (allRows && allColumns) return 'table';
  if (allColumns) return 'rows';
  if (allRows) return 'columns';
  return 'cells';
}

/* ---- what a table command acts on: the selected cells, or the cell the caret is in ---- */
export function tableTarget() {
  const cell = ui.tblCell && ui.tblCell.isConnected ? ui.tblCell : null;
  const table = ui.tsel && ui.tsel.table.isConnected ? ui.tsel.table : cell && cell.closest('table');
  if (!table) return null;
  const grid = squareTable(table);
  if (ui.tsel && ui.tsel.table === table) return { table: table, grid: grid, rect: wholeRect(grid, ui.tsel.rect) };
  if (!cell || !grid.at.has(cell)) return null;
  return { table: table, grid: grid, rect: cellRect(grid, cell), cell: cell };
}

/* the cell the caret is in, kept for the table tab's boxes (which take the focus from the notes) */
export function noteCaretCell() {
  if (!inEd()) return;
  const cell = closestTag('td,th');
  ui.tblCell = cell && cell.closest('.notes') ? cell : null;
  if (ui.tsel && !(ui.tblCell && ui.tblCell.classList.contains('tsel'))) clearCellSelection();
}
