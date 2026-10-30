import { caretInto, inEd } from '../core/caret.js';
import { KEY } from '../core/example-data.js';
import { $, isDocView, ui } from '../core/helpers-and-state.js';
import { cellsIn, rowTag, selectCells, selectColumns, selectRows, tableTarget } from './table-grid.js';
import {
  clearCells,
  deleteColumns,
  deleteRows,
  deleteTable,
  insertColumns,
  insertRows,
  mergeCells,
  moveColumns,
  moveRows,
  splitCells
} from './table-edits.js';
import {
  columnShares,
  equalColumns,
  fitColumnsToText,
  setAllRowsHeight,
  setSelectedColumnWidth,
  setSelectedRowHeight,
  setShares,
  tableVar
} from './table-sizing.js';
import {
  CELL_SHADES,
  TABLE_LINE_SPACINGS,
  TABLE_PADDINGS,
  TABLE_STYLES,
  alignCells,
  makeTableTextDefault,
  setTableLineSpacing,
  setTablePadding,
  setTableStyle,
  setTableTextSize,
  shadeCells,
  tableTextLook,
  toggleHeaderRow,
  toggleTableFlag
} from './table-look.js';
import { tableChanged } from './table-handles.js';

/* ===== the table tab: under the toolbar while working in a table. Like an inspector, it has panes (Table, Rows &
   Columns, Cell, Text), one row of controls each: segmented buttons, steppers, style and colour swatches. It acts on the
   selected cells, or the caret's ===== */
export const TABLE_ICONS = {
  rowabove: '<rect x="4" y="11" width="16" height="9" rx="1.5"/><path d="M4 15.5h16M12 3v6M9 6h6"/>',
  rowbelow: '<rect x="4" y="4" width="16" height="9" rx="1.5"/><path d="M4 8.5h16M12 15v6M9 18h6"/>',
  colleft: '<rect x="11" y="4" width="9" height="16" rx="1.5"/><path d="M15.5 4v16M3 12h6M6 9v6"/>',
  colright: '<rect x="4" y="4" width="9" height="16" rx="1.5"/><path d="M8.5 4v16M15 12h6M18 9v6"/>',
  delrows: '<rect x="4" y="8" width="16" height="8" rx="1.5"/><path d="M9 10l6 4M15 10l-6 4"/>',
  delcols: '<rect x="8" y="4" width="8" height="16" rx="1.5"/><path d="M10 9l4 6M14 9l-4 6"/>',
  deltable: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 10.5v5.5M13.5 10.5v5.5"/>',
  mvup: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  mvdown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  mvleft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  mvright: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  merge:
    '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M7 12h4M9 10l2 2-2 2M17 12h-4M15 10l-2 2 2 2"/>',
  split:
    '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M12 5v14M9 12H5M7 10l-2 2 2 2M15 12h4M17 10l2 2-2 2"/>',
  left: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  center: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  right: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  top: '<path d="M4 4h16M12 8v12M8 12l4-4 4 4"/>',
  middle: '<path d="M4 12h16M12 3v5M12 21v-5M9 6l3 2 3-2M9 18l3-2 3 2"/>',
  bottom: '<path d="M4 20h16M12 4v12M8 12l4 4 4-4"/>',
  clear: '<path d="M15.5 4.5l4 4-9 9H6.5l-2-2 9-9z"/><path d="M11 8l5 5M10.5 19.5h9"/>'
};

/* [command, what it does to the target] */
export const TABLE_TAB_COMMANDS = {
  selrow: t => selectRows(t.table, t.rect.r0, t.rect.r1),
  selcol: t => selectColumns(t.table, t.rect.c0, t.rect.c1),
  seltable: t => selectCells(t.table, { r0: 0, r1: t.grid.rows.length - 1, c0: 0, c1: t.grid.width - 1 }),
  rowabove: t => insertRows(t, t.rect.r0, t.rect.r1 - t.rect.r0 + 1),
  rowbelow: t => insertRows(t, t.rect.r1 + 1, t.rect.r1 - t.rect.r0 + 1),
  colleft: t => insertColumns(t, t.rect.c0, t.rect.c1 - t.rect.c0 + 1),
  colright: t => insertColumns(t, t.rect.c1 + 1, t.rect.c1 - t.rect.c0 + 1),
  delrows: deleteRows,
  delcols: deleteColumns,
  deltable: deleteTable,
  mvup: t => moveRows(t, -1),
  mvdown: t => moveRows(t, 1),
  mvleft: t => moveColumns(t, -1),
  mvright: t => moveColumns(t, 1),
  merge: mergeCells,
  split: splitCells,
  equalcols: equalColumns,
  fitcols: fitColumnsToText,
  hdr: toggleHeaderRow,
  band: t => toggleTableFlag(t, 'data-band'),
  fcol: t => toggleTableFlag(t, 'data-fcol'),
  left: t => alignCells(t, 'text-align', 'left'),
  center: t => alignCells(t, 'text-align', 'center'),
  right: t => alignCells(t, 'text-align', 'right'),
  top: t => alignCells(t, 'vertical-align', 'top'),
  middle: t => alignCells(t, 'vertical-align', 'middle'),
  bottom: t => alignCells(t, 'vertical-align', 'bottom'),
  clear: clearCells,
  textdefault: makeTableTextDefault
};

/* [box, what a new value does] */
const TABLE_TAB_FIELDS = {
  tcw: (t, v) => +v > 0 && setSelectedColumnWidth(t, +v),
  trh: (t, v) => setSelectedRowHeight(t, +v || 0),
  tallh: (t, v) => setAllRowsHeight(t, +v || 0),
  tstyle: setTableStyle,
  tshade: shadeCells,
  tsize: (t, v) => setTableTextSize(t, +v || 0),
  tlh: setTableLineSpacing,
  tpad: setTablePadding
};

const TABLE_TAB_PANES = [
  ['table', 'Table'],
  ['rows', 'Rows & Columns'],
  ['cell', 'Cell'],
  ['text', 'Text']
];
/* the stepper buttons' steps, and the value a stepper starts from when its box is empty */
const TABLE_STEPS = { tcw: 5, trh: 4, tallh: 4, tsize: 1 };
const TABLE_STEP_FROM = {
  tcw: t => Math.round(columnShares(t.table)[t.rect.c0]),
  trh: t => t.grid.rows[t.rect.r0].offsetHeight,
  tallh: t => t.grid.rows[t.grid.rows.length - 1].offsetHeight,
  tsize: t => tableTextLook(t.table).size
};
/* how each style's swatch is drawn: [header (grey, ink, soft or none), outline, column lines, row lines, rules] */
/* the text in a swatch's cells, as short strokes */
const SWATCH_TEXT = 'M6.5 13h5M16.5 13h5M26.5 13h5M6.5 19h5M16.5 19h5M26.5 19h5';
const STYLE_SWATCHES = {
  '': ['grey', 1, 1, 1, 0],
  lines: ['', 0, 0, 1, 1],
  accent: ['ink', 1, 1, 1, 0],
  soft: ['soft', 1, 1, 1, 0],
  minimal: ['', 0, 0, 0, 0],
  plain: ['', 0, 0, 0, 0]
};

function savedTablePane() {
  try {
    const saved = localStorage.getItem(KEY + '-ttab');
    return TABLE_TAB_PANES.some(([pane]) => pane === saved) ? saved : 'table';
  } catch (e) {
    return 'table';
  }
}

/* ---- the controls ---- */
function tabButton(command, title, label) {
  const icon = TABLE_ICONS[command];
  const face = icon ? `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>` : '';
  return (
    `<button type="button" class="${label ? 'twide' : ''}" data-tcmd="${command}" title="${title}" ` +
    `aria-label="${title}">${face}${label ? `<span>${label}</span>` : ''}</button>`
  );
}

/* buttons joined into one control */
function segmented(html) {
  return `<div class="tseg">${html}</div>`;
}

/* a control with its name above it */
function field(label, html) {
  return `<div class="tfield"><span class="tlabel">${label}</span>${html}</div>`;
}

/* a setting chosen from a few: data-tset is "box:value" */
function setButton(key, value, title, label) {
  return `<button type="button" class="twide" data-tset="${key}:${value}" title="${title}" aria-label="${title}"><span>${label}</span></button>`;
}

/* − value + */
function stepper(id, title, unit) {
  const step = TABLE_STEPS[id];
  return (
    `<div class="tstep" title="${title}"><button type="button" data-tstep="${id}" data-by="-${step}" aria-label="Less">` +
    `−</button><input id="${id}" inputmode="numeric" placeholder="auto" aria-label="${title}"><span class="tunit">${unit}` +
    `</span><button type="button" data-tstep="${id}" data-by="${step}" aria-label="More">+</button></div>`
  );
}

/* a tick box for a table option (it's a button that shows on or off) */
function option(command, title, label) {
  return (
    `<button type="button" class="tchk" data-tcmd="${command}" title="${title}" aria-pressed="false">` +
    `<span class="tbox" aria-hidden="true"></span>${label}</button>`
  );
}

/* each pane's controls, in order: [name, kind, what], where kind is seg (buttons [command, title, label]), segs
   (two rows of them), set (choices [box, value, title, label]), step ([box, title, unit]), checks ([command, title,
   label]) or html (a function drawing it) */
const TABLE_PANE_CONTROLS = {
  table: [
    ['Style', 'html', () => `<div class="tswatches">${TABLE_STYLES.map(styleSwatchHTML).join('')}</div>`],
    [
      'Options',
      'checks',
      [
        ['hdr', 'The first row as headings', 'Header row'],
        ['band', 'Every other row shaded', 'Banded rows'],
        ['fcol', 'The first column in bold', 'First column']
      ]
    ],
    [
      'Column widths',
      'seg',
      [
        ['equalcols', 'Give every column the same width', 'Equal'],
        ['fitcols', 'Fit every column to its text', 'Fit to text']
      ]
    ],
    ['Rows at least', 'step', ['tallh', 'Every row at least this high (rows with their own height keep it)', 'px']],
    ['Delete', 'seg', [['deltable', 'Delete the table', 'Table']]]
  ],
  rows: [
    [
      'Select',
      'seg',
      [
        ['selrow', 'Select the row', 'Row'],
        ['selcol', 'Select the column', 'Column'],
        ['seltable', 'Select the whole table', 'All']
      ]
    ],
    [
      'Insert',
      'seg',
      [
        ['rowabove', 'Insert a row above'],
        ['rowbelow', 'Insert a row below'],
        ['colleft', 'Insert a column to the left'],
        ['colright', 'Insert a column to the right']
      ]
    ],
    [
      'Delete',
      'seg',
      [
        ['delrows', 'Delete the row (or selected rows)'],
        ['delcols', 'Delete the column (or selected columns)']
      ]
    ],
    [
      'Move',
      'seg',
      [
        ['mvup', 'Move the row up'],
        ['mvdown', 'Move the row down'],
        ['mvleft', 'Move the column left'],
        ['mvright', 'Move the column right']
      ]
    ],
    ['Column width', 'step', ['tcw', 'Width of the selected column(s), as a share of the table', '%']],
    ['Row height', 'step', ['trh', 'Height of the selected row(s); empty fits the text', 'px']]
  ],
  cell: [
    [
      'Merge',
      'seg',
      [
        ['merge', 'Merge the selected cells (or right-click them)', 'Merge'],
        ['split', 'Split merged cells', 'Split']
      ]
    ],
    ['Fill', 'html', () => `<div class="tshades">${CELL_SHADES.map(shadeSwatchHTML).join('')}</div>`],
    ['Contents', 'seg', [['clear', 'Empty the selected cells', 'Clear']]]
  ],
  text: [
    ['Size', 'step', ['tsize', 'Text size in this table (independent of the notes)', 'px']],
    [
      'Alignment',
      'segs',
      [
        [
          ['left', 'Align text left'],
          ['center', 'Centre text'],
          ['right', 'Align text right']
        ],
        [
          ['top', 'Text at the top of the cell'],
          ['middle', 'Text in the middle of the cell'],
          ['bottom', 'Text at the bottom of the cell']
        ]
      ]
    ],
    ['Line spacing', 'set', TABLE_LINE_SPACINGS.map(([value, name]) => ['tlh', value, 'Line spacing: ' + name, name])],
    ['Cell room', 'set', TABLE_PADDINGS.map(([value, name]) => ['tpad', value, 'Room around the text: ' + name, name])],
    [
      'All tables',
      'seg',
      [['textdefault', 'Use this table’s text size, spacing and cell room for every table', 'Make default']]
    ]
  ]
};

/* how each kind of control is drawn */
const TABLE_CONTROL_KINDS = {
  seg: items => segmented(items.map(item => tabButton(...item)).join('')),
  segs: rows => rows.map(items => segmented(items.map(item => tabButton(...item)).join(''))).join(''),
  set: items => segmented(items.map(item => setButton(...item)).join('')),
  step: item => stepper(...item),
  checks: items => `<div class="tchks">${items.map(item => option(...item)).join('')}</div>`,
  html: draw => draw()
};

function tableTabHTML() {
  const switcher = TABLE_TAB_PANES.map(
    ([pane, name]) => `<button type="button" role="tab" data-tpane="${pane}" aria-selected="false">${name}</button>`
  ).join('');
  const panes = TABLE_TAB_PANES.map(
    ([pane]) => `<div class="tpane" data-pane="${pane}" role="tabpanel">${paneHTML(pane)}</div>`
  ).join('');
  return `<div class="tswitch" role="tablist" aria-label="Table settings">${switcher}</div><div class="tpanes">${panes}</div>`;
}

function paneHTML(pane) {
  return TABLE_PANE_CONTROLS[pane].map(([name, kind, what]) => field(name, TABLE_CONTROL_KINDS[kind](what))).join('');
}

/* a little table drawn in a style: [header (grey, ink, soft or none), outline, column lines, row lines, rules] */
function styleSwatchHTML([value, name, description]) {
  const [header, outline, columns, rows, rules] = STYLE_SWATCHES[value];
  const head = header ? `<rect class="sw-${header}" x="4" y="4" width="30" height="6"/>` : '';
  const frame = outline ? '<rect class="sw-frame" x="4" y="4" width="30" height="18"/>' : '';
  const rule = rules ? '<path class="sw-rule" d="M4 4H34M4 22H34"/>' : '';
  return (
    `<button type="button" class="tswatch" data-tset="tstyle:${value}" title="${name}: ${description}" aria-label="${name}">` +
    `<svg viewBox="0 0 38 26" aria-hidden="true">${head}<path class="sw-line" d="${swatchLines(value, columns, rows)}"/>` +
    `${frame}${rule}<path class="sw-text" d="${SWATCH_TEXT}"/></svg></button>`
  );
}

/* the swatch's inner lines: between columns, between rows, and under the header */
function swatchLines(value, columns, rows) {
  let lines = '';
  if (columns) lines += 'M14 4V22M24 4V22';
  if (rows) lines += 'M4 10H34M4 16H34';
  if (value === 'minimal' || value === 'lines') lines += 'M4 10H34';
  return lines;
}

function shadeSwatchHTML([value, name]) {
  return (
    `<button type="button" class="tshade" data-tset="tshade:${value}" data-shade-swatch="${value}" title="${value ? name : 'No fill'}" ` +
    `aria-label="${value ? name : 'No fill'}"></button>`
  );
}

/* ---- showing it, and showing what's set for the table it's working on ---- */
export function refreshTableTab() {
  const tab = $('tbltab');
  if (!tab) return;
  const t = isDocView() ? tableTarget() : null;
  const working = inEd() || tab.contains(document.activeElement);
  tab.hidden = !(t && working);
  if (tab.hidden) return;
  if (!tab.firstChild) tab.innerHTML = tableTabHTML();
  showTablePane(tab);
  showTableSettings(tab, t);
}

function showTablePane(tab) {
  tab
    .querySelectorAll('[data-tpane]')
    .forEach(button => button.setAttribute('aria-selected', button.dataset.tpane === ui.ttab ? 'true' : 'false'));
  tab.querySelectorAll('.tpane').forEach(pane => (pane.hidden = pane.dataset.pane !== ui.ttab));
}

function showTableSettings(tab, t) {
  const cell = t.grid.map[t.rect.r0][t.rect.c0];
  const pressed = pressedCommands(t, getComputedStyle(cell));
  Object.keys(pressed).forEach(command => {
    const button = tab.querySelector(`[data-tcmd="${command}"]`);
    if (button) button.setAttribute('aria-pressed', pressed[command] ? 'true' : 'false');
  });
  const cells = cellsIn(t.grid, t.rect);
  tab.querySelector('[data-tcmd="split"]').disabled = !cells.some(c => c.rowSpan > 1 || c.colSpan > 1);
  tab.querySelector('[data-tcmd="merge"]').disabled = cells.length < 2;
  showTableSets(tab, t, cell);
  showTableFields(t);
}

/* the options on and the alignment of the first cell acted on */
function pressedCommands(t, look) {
  return {
    hdr: rowTag(t.grid.rows[0]) === 'th',
    band: t.table.hasAttribute('data-band'),
    fcol: t.table.hasAttribute('data-fcol'),
    left: /^(left|start)$/.test(look.textAlign),
    center: look.textAlign === 'center',
    right: /^(right|end)$/.test(look.textAlign),
    top: look.verticalAlign === 'top',
    middle: look.verticalAlign === 'middle',
    bottom: look.verticalAlign === 'bottom'
  };
}

/* the chosen style, fill, spacing and cell room show as pressed */
function showTableSets(tab, t, cell) {
  const table = t.table;
  const current = {
    tstyle: table.getAttribute('data-ts') || '',
    tshade: cell.getAttribute('data-shade') || '',
    tlh: tableVar(table, '--tlh'),
    tpad: table.getAttribute('data-tpad') || ''
  };
  tab.querySelectorAll('[data-tset]').forEach(button => {
    const [key, value] = button.dataset.tset.split(':');
    button.setAttribute('aria-pressed', current[key] === value ? 'true' : 'false');
  });
}

function showTableFields(t) {
  const table = t.table;
  setField('tsize', tableVar(table, '--tfs') ? String(tableTextLook(table).size) : '');
  setField('tcw', setShares(table) ? Math.round(columnShares(table)[t.rect.c0]) : '');
  setField('trh', parseFloat(t.grid.rows[t.rect.r0].style.height) || '');
  setField('tallh', parseFloat(tableVar(table, '--row-h')) || '');
  const size = $('tsize');
  if (size) size.placeholder = String(tableTextLook(table).size);
}

/* a box shows the table's setting (not while it's being typed in) */
function setField(id, value) {
  const box = $(id);
  if (box && document.activeElement !== box) box.value = value == null ? '' : String(value);
}

/* ---- using it ---- */
const onTableTabMousedown = e => {
  if (e.target.closest && e.target.closest('#tbltab button')) e.preventDefault(); // the notes keep the caret
};

const onTableTabClick = e => {
  const button = e.target.closest && e.target.closest('#tbltab button');
  if (!button || button.disabled) return;
  if (button.dataset.tpane) {
    chooseTablePane(button.dataset.tpane);
    return;
  }
  const t = tableTarget();
  if (!t) return;
  if (button.dataset.tcmd && TABLE_TAB_COMMANDS[button.dataset.tcmd]) TABLE_TAB_COMMANDS[button.dataset.tcmd](t);
  else if (button.dataset.tset) applyTableSet(t, button.dataset.tset);
  else if (button.dataset.tstep) stepTableField(t, button.dataset.tstep, +button.dataset.by);
  tableChanged();
};

function chooseTablePane(pane) {
  ui.ttab = pane;
  try {
    localStorage.setItem(KEY + '-ttab', pane);
  } catch (e) {}
  refreshTableTab();
}

function applyTableSet(t, set) {
  const at = set.indexOf(':');
  TABLE_TAB_FIELDS[set.slice(0, at)](t, set.slice(at + 1));
}

/* − or + on a stepper: from its value (or, when it's empty, from what the table has now) */
function stepTableField(t, id, by) {
  const box = $(id);
  const from = +box.value || TABLE_STEP_FROM[id](t);
  const value = Math.max(1, Math.round(from + by));
  box.value = String(value);
  TABLE_TAB_FIELDS[id](t, String(value));
}

const onTableTabChange = e => {
  const box = e.target;
  if (!box.closest || !box.closest('#tbltab')) return;
  const t = tableTarget();
  const apply = TABLE_TAB_FIELDS[box.id];
  if (t && apply) apply(t, box.value);
  tableChanged();
};

/* Return in a box applies it (as the box loses the focus) and goes back to the table; Escape goes back without */
const onTableTabFocusin = e => {
  if (e.target.closest && e.target.closest('#tbltab input')) e.target.dataset.was = e.target.value;
};

const onTableTabKeydown = e => {
  const box = e.target;
  if (!box.closest || !box.closest('#tbltab input')) return;
  if (e.key !== 'Enter' && e.key !== 'Escape') return;
  e.preventDefault();
  if (e.key === 'Escape') box.value = box.dataset.was || '';
  if (ui.tblCell) caretInto(ui.tblCell);
};

export function initTableTab() {
  ui.ttab = savedTablePane();
  document.addEventListener('mousedown', onTableTabMousedown);
  document.addEventListener('click', onTableTabClick);
  document.addEventListener('change', onTableTabChange);
  document.addEventListener('focusin', onTableTabFocusin);
  document.addEventListener('keydown', onTableTabKeydown);
}
