import { ui } from '../core/helpers-and-state.js';
import { mk } from '../editor/paste-cleaning.js';
import { inEd } from '../editor/editor-commands.js';
import {
  cellRect,
  clearCellSelection,
  joinRects,
  selectCells,
  selectColumns,
  selectRows,
  selectionKind,
  squareTable,
  tableGrid,
  tableTarget
} from './table-grid.js';
import { deleteSelection, moveColumnBlock, moveRowBlock } from './table-edits.js';
import {
  columnEdges,
  dragColumnBorder,
  dragRowBorder,
  endResize,
  pageScale,
  startColumnResize,
  startRowResize
} from './table-sizing.js';
import { refreshTableTab } from './table-tab.js';
import { ed } from '../editor/notes-document.js';
import { caretInto } from '../essays/essays.js';

/* ===== tables: handles over the table the pointer (or caret) is in. A grip above each column and beside each row selects
   it (⇧ adds the ones between) and drags it somewhere else; a column's or row's border drags to resize it; dragging
   across cells selects them; Delete then deletes the rows or columns selected (or empties the cells) ===== */
const GRIP_GAP = 14; // px from the table's edge to its grips
const GRIP_SIZE = 9; // px
const BORDER_REACH = 3; // px either side of a border that drags it
const DRAG_THRESHOLD = 4; // px the pointer moves before a grip is dragged rather than clicked

/* the layer over the page the handles are drawn in (outside the notes, so they're never saved) */
export function tableLayer(editor) {
  const page = editor && editor.closest('.doc');
  if (!page) return null;
  let layer = page.querySelector(':scope>.tbllayer');
  if (layer) return layer;
  layer = mk('div');
  layer.className = 'tbllayer';
  layer.setAttribute('contenteditable', 'false');
  page.appendChild(layer);
  return layer;
}

/* the table to show handles on: the one pointed at, else the one being worked in */
export function handledTable() {
  const editor = ed();
  const candidates = [ui.thover, ui.tsel && ui.tsel.table, ui.tblCell && ui.tblCell.closest('table')];
  return candidates.find(t => t && t.isConnected && editor && editor.contains(t)) || null;
}

export function drawTableHandles() {
  const editor = ed();
  const layer = editor && tableLayer(editor);
  if (!layer) return;
  const table = editor.isContentEditable ? handledTable() : null;
  layer.innerHTML = table ? handlesHTML(table, layer) : '';
  layer._table = table;
}

/* everything changed after a table command: handles and tab drawn again */
export function tableChanged() {
  drawTableHandles();
  refreshTableTab();
}

function handlesHTML(table, layer) {
  const f = handleFrame(table, layer);
  return gripsHTML(f) + bordersHTML(f);
}

/* where the table's columns and rows are, in the layer's own px */
function handleFrame(table, layer) {
  const origin = layer.getBoundingClientRect();
  const scale = pageScale(layer);
  const box = table.getBoundingClientRect();
  return {
    x: v => (v - origin.left) / scale,
    y: v => (v - origin.top) / scale,
    span: (a, b) => (b - a) / scale,
    box: box,
    edges: columnEdges(table),
    rows: [...table.rows].map(row => row.getBoundingClientRect()),
    on: selectedLines(table)
  };
}

function placed(left, top, width, height) {
  const px = v => Math.round(v * 10) / 10 + 'px';
  return `style="left:${px(left)};top:${px(top)};width:${px(width)};height:${px(height)}"`;
}

function gripsHTML(f) {
  const { x, y, span, box, edges, rows, on } = f;
  const columns = edges
    .slice(0, -1)
    .map(
      (left, c) =>
        `<button class="tgrip tgc${on.columns.has(c) ? ' on' : ''}" data-tgc="${c}" title="Select column (drag to move)" ` +
        `${placed(x(left), y(box.top) - GRIP_GAP, span(left, edges[c + 1]), GRIP_SIZE)}></button>`
    );
  const rowGrips = rows.map(
    (row, r) =>
      `<button class="tgrip tgr${on.rows.has(r) ? ' on' : ''}" data-tgr="${r}" title="Select row (drag to move)" ` +
      `${placed(x(box.left) - GRIP_GAP, y(row.top), GRIP_SIZE, span(row.top, row.bottom))}></button>`
  );
  const corner =
    '<button class="tgrip tga" data-tga="1" title="Select the whole table" ' +
    `${placed(x(box.left) - GRIP_GAP, y(box.top) - GRIP_GAP, GRIP_SIZE, GRIP_SIZE)}></button>`;
  return corner + columns.join('') + rowGrips.join('');
}

/* the borders between columns, and under each row, that drag */
function bordersHTML(f) {
  const { x, y, span, box, edges, rows } = f;
  const reach = BORDER_REACH * 2;
  const columns = edges
    .slice(1, -1)
    .map(
      (edge, c) =>
        `<div class="trz trzc" data-trc="${c}" ` +
        `${placed(x(edge) - BORDER_REACH, y(box.top), reach, span(box.top, box.bottom))}></div>`
    );
  const rowBorders = rows.map(
    (row, r) =>
      `<div class="trz trzr" data-trr="${r}" ` +
      `${placed(x(box.left), y(row.bottom) - BORDER_REACH, span(box.left, box.right), reach)}></div>`
  );
  return columns.join('') + rowBorders.join('');
}

/* the rows and columns wholly selected, to show their grips as on */
function selectedLines(table) {
  const out = { rows: new Set(), columns: new Set() };
  if (!ui.tsel || ui.tsel.table !== table) return out;
  const grid = tableGrid(table);
  const kind = selectionKind(grid, ui.tsel.rect);
  const { r0, r1, c0, c1 } = ui.tsel.rect;
  if (kind === 'rows' || kind === 'table') for (let r = r0; r <= r1; r++) out.rows.add(r);
  if (kind === 'columns' || kind === 'table') for (let c = c0; c <= c1; c++) out.columns.add(c);
  return out;
}

/* ---- the pointer ---- */
const onTableHandlesMousedown = e => {
  if (e.button !== 0 || !e.target.closest) return;
  if (e.target.closest('.tbllayer .tgrip')) gripDown(e);
  else if (e.target.closest('.tbllayer .trz')) borderDown(e);
  else if (e.target.closest('#ed td, #ed th')) cellDown(e);
  else if (!e.target.closest('#tbltab, .tbmenu')) clearCellSelection();
};

function gripDown(e) {
  e.preventDefault();
  const grip = e.target.closest('.tgrip');
  const table = grip.parentNode._table;
  if (!table) return;
  const kind = grip.dataset.tgr != null ? 'r' : grip.dataset.tgc != null ? 'c' : 'a';
  const index = +(grip.dataset.tgr != null ? grip.dataset.tgr : grip.dataset.tgc || 0);
  ui.tgrip = { table: table, kind: kind, index: index, x: e.clientX, y: e.clientY, moved: false, shift: e.shiftKey };
}

function borderDown(e) {
  e.preventDefault();
  const border = e.target.closest('.trz');
  const table = border.parentNode._table;
  if (!table) return;
  if (border.dataset.trc != null) startColumnResize(table, +border.dataset.trc, e.clientX);
  else startRowResize(table, +border.dataset.trr, e.clientY);
}

/* in a cell: ⇧ selects from the caret's cell to this one; otherwise a drag from here may select cells */
function cellDown(e) {
  const cell = e.target.closest('td,th');
  const table = cell.closest('table');
  const from = ui.tsel && ui.tsel.table === table ? ui.tsel.anchor : ui.tblCell;
  if (e.shiftKey && from && from.isConnected && from.closest('table') === table) {
    e.preventDefault();
    selectFromTo(table, from, cell);
    return;
  }
  clearCellSelection();
  ui.tcellDrag = { table: table, anchor: cell };
}

function selectFromTo(table, from, to) {
  const grid = tableGrid(table);
  selectCells(table, joinRects(cellRect(grid, from), cellRect(grid, to)));
  ui.tsel.anchor = from;
}

const onTableHandlesMousemove = e => {
  if (ui.tresize) {
    if (ui.tresize.kind === 'c') dragColumnBorder(ui.tresize, e.clientX);
    else dragRowBorder(ui.tresize, e.clientY);
    drawTableHandles();
  } else if (ui.tgrip) gripMove(e);
  else if (ui.tcellDrag && e.buttons & 1) cellDragMove(e);
  else hoverTable(e);
};

/* the handles follow the pointer from table to table (they stay while it's on them) */
function hoverTable(e) {
  if (!e.target.closest || e.target.closest('.tbllayer')) return;
  const table = e.target.closest('#ed table');
  if (table === ui.thover || (!table && ui.thover && nearTable(ui.thover, e))) return;
  ui.thover = table;
  drawTableHandles();
}

/* the pointer is by the table, on its way to a grip */
function nearTable(table, e) {
  const box = table.getBoundingClientRect();
  const reach = (GRIP_GAP + GRIP_SIZE) * pageScale(table);
  const x = e.clientX;
  const y = e.clientY;
  return x > box.left - reach && x < box.right + reach && y > box.top - reach && y < box.bottom + reach;
}

function cellDragMove(e) {
  const drag = ui.tcellDrag;
  const cell = e.target.closest && e.target.closest('td,th');
  if (!cell || cell.closest('table') !== drag.table) return;
  if (cell === drag.anchor && !ui.tsel) return;
  selectFromTo(drag.table, drag.anchor, cell);
  drawTableHandles();
}

function gripMove(e) {
  const grip = ui.tgrip;
  if (!grip.moved && Math.hypot(e.clientX - grip.x, e.clientY - grip.y) < DRAG_THRESHOLD) return;
  if (grip.kind === 'a') return;
  grip.moved = true;
  grip.to = dropIndex(grip, e);
  showTableDropLine(grip);
}

/* where a dragged row (or column) would go: before the row whose middle is below the pointer */
function dropIndex(grip, e) {
  if (grip.kind === 'r') {
    const rows = [...grip.table.rows].map(row => row.getBoundingClientRect());
    return rows.filter(row => (row.top + row.bottom) / 2 < e.clientY).length;
  }
  const edges = columnEdges(grip.table);
  return edges.slice(0, -1).filter((left, c) => (left + edges[c + 1]) / 2 < e.clientX).length;
}

function showTableDropLine(grip) {
  const layer = tableLayer(ed());
  let line = layer.querySelector('.tdrop');
  if (!line) line = layer.appendChild(mk('div'));
  line.className = 'tdrop ' + (grip.kind === 'r' ? 'tdropr' : 'tdropc');
  const origin = layer.getBoundingClientRect();
  const scale = pageScale(layer);
  const box = grip.table.getBoundingClientRect();
  if (grip.kind === 'r') {
    const rows = [...grip.table.rows];
    const at = grip.to < rows.length ? rows[grip.to].getBoundingClientRect().top : box.bottom;
    line.style.cssText = `left:${(box.left - origin.left) / scale}px;top:${(at - origin.top) / scale - 1}px;width:${box.width / scale}px`;
  } else {
    const at = columnEdges(grip.table)[grip.to];
    line.style.cssText = `top:${(box.top - origin.top) / scale}px;left:${(at - origin.left) / scale - 1}px;height:${box.height / scale}px`;
  }
}

const onTableHandlesMouseup = () => {
  if (ui.tresize) endResize();
  if (ui.tgrip) gripUp(ui.tgrip);
  if (ui.tcellDrag && ui.tsel) caretInto(ui.tcellDrag.anchor);
  ui.tgrip = null;
  ui.tcellDrag = null;
};

/* a grip let go: clicked, it selects its row or column (⇧: from the one selected to it); dragged, it moves them */
function gripUp(grip) {
  const table = grip.table;
  if (!table.isConnected) return;
  const t = { table: table, grid: squareTable(table) };
  if (grip.moved) moveByGrip(t, grip);
  else selectByGrip(t, grip);
  drawTableHandles();
}

function selectByGrip(t, grip) {
  const held = ui.tsel && ui.tsel.table === t.table && grip.shift ? ui.tsel.rect : null;
  if (grip.kind === 'a') selectCells(t.table, { r0: 0, r1: t.grid.rows.length - 1, c0: 0, c1: t.grid.width - 1 });
  else if (grip.kind === 'r') selectRows(t.table, held ? held.r0 : grip.index, grip.index);
  else selectColumns(t.table, held ? held.c0 : grip.index, grip.index);
  caretInto(t.grid.map[ui.tsel.rect.r0][ui.tsel.rect.c0]);
}

/* the selected rows (or columns) move, if the grip dragged is one of them; otherwise just its own */
function moveByGrip(t, grip) {
  const held = ui.tsel && ui.tsel.table === t.table ? ui.tsel.rect : null;
  const kind = held ? selectionKind(t.grid, held) : '';
  if (grip.kind === 'r') {
    const inHeld = kind === 'rows' && grip.index >= held.r0 && grip.index <= held.r1;
    t.rect = inHeld ? held : { r0: grip.index, r1: grip.index, c0: 0, c1: t.grid.width - 1 };
    moveRowBlock(t, grip.to);
  } else {
    const inHeld = kind === 'columns' && grip.index >= held.c0 && grip.index <= held.c1;
    t.rect = inHeld ? held : { r0: 0, r1: t.grid.rows.length - 1, c0: grip.index, c1: grip.index };
    moveColumnBlock(t, grip.to);
  }
}

/* ---- keys, while cells are selected: Delete deletes them, Escape lets go, typing goes into the first ---- */
const onTableHandlesKeydown = e => {
  if (!ui.tsel || !inEd() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    e.stopImmediatePropagation();
    const t = tableTarget();
    if (t) deleteSelection(t);
  } else if (e.key === 'Escape' || e.key.length === 1 || e.key === 'Enter') {
    clearCellSelection();
    drawTableHandles();
  }
};

/* the handles move with the table as it's typed in and as the window changes */
const onTableHandlesInput = e => {
  const layer = e.target && e.target.id === 'ed' && tableLayer(ed());
  if (layer && layer._table) requestAnimationFrame(drawTableHandles);
};
const onTableHandlesWindowResize = () => requestAnimationFrame(drawTableHandles);

export function initTableHandles() {
  document.addEventListener('mousedown', onTableHandlesMousedown, true);
  document.addEventListener('mousemove', onTableHandlesMousemove);
  document.addEventListener('mouseup', onTableHandlesMouseup);
  document.addEventListener('keydown', onTableHandlesKeydown, true);
  document.addEventListener('input', onTableHandlesInput);
  window.addEventListener('resize', onTableHandlesWindowResize);
}
