import { saveWritingSettings, writingSettings } from '../core/writing-settings.js';
import { toast, uiState } from '../core/helpers-and-state.js';
import { makeElement } from '../core/paste-cleaning.js';
import { cellsIn, rowTag } from './table-grid.js';
import { changeTable } from './table-edits.js';
import { setTableVar, tableVar } from './table-sizing.js';

/* ===== tables: how they look. A style for the whole table (data-ts), a header row, banded rows and a bold first column,
   shaded and aligned cells, and the table's own text size, line spacing and cell padding (its defaults set for all
   tables in the writing settings, so tables can be smaller than the notes around them) ===== */
/* [value, name, what it looks like] */
export const TABLE_STYLES = [
  ['', 'Grid', 'Lines around every cell, a shaded header'],
  ['lines', 'Lines', 'Rules between rows only, a heavier rule around the header (as in papers)'],
  ['accent', 'Accent', 'A header in the theme colour, light lines'],
  ['soft', 'Soft', 'Light lines, a lightly shaded header'],
  ['minimal', 'Minimal', 'No lines but under the header'],
  ['plain', 'Plain', 'No lines or shading at all']
];
export const CELL_SHADES = [
  ['', 'None'],
  ['1', 'Red'],
  ['2', 'Orange'],
  ['3', 'Yellow'],
  ['4', 'Green'],
  ['5', 'Blue'],
  ['6', 'Purple'],
  ['7', 'Grey']
];
export const TABLE_LINE_SPACINGS = [
  ['', 'As notes'],
  ['1.1', 'Single'],
  ['1.3', '1.3'],
  ['1.5', '1.5']
];
export const TABLE_PADDINGS = [
  ['compact', 'Compact', '2px 5px'],
  ['', 'Normal', '5px 8px'],
  ['roomy', 'Roomy', '9px 12px']
];
const TABLE_DEFAULT_SIZE = 14; // px, until the user makes another the default

/* ---- the whole table ---- */
export function setTableStyle(t, style) {
  changeTable(t.table, () => setOrRemove(t.table, 'data-ts', style));
}

function setOrRemove(el, attribute, value) {
  if (value) el.setAttribute(attribute, value);
  else el.removeAttribute(attribute);
}

export function toggleTableFlag(t, attribute) {
  changeTable(t.table, () => t.table.toggleAttribute(attribute));
}

/* the first row's cells become header cells (th), or ordinary ones again */
export function toggleHeaderRow(t) {
  const first = t.grid.rows[0];
  const tag = rowTag(first) === 'th' ? 'td' : 'th';
  changeTable(t.table, () => [...first.cells].forEach(cell => retagCell(cell, tag)));
}

function retagCell(cell, tag) {
  const copy = makeElement(tag);
  [...cell.attributes].forEach(a => copy.setAttribute(a.name, a.value));
  while (cell.firstChild) copy.appendChild(cell.firstChild);
  cell.replaceWith(copy);
  if (uiState.tblCell === cell) uiState.tblCell = copy;
}

/* ---- the selected cells ---- */
export function shadeCells(t, shade) {
  changeTable(t.table, () => cellsIn(t.grid, t.rect).forEach(cell => setOrRemove(cell, 'data-shade', shade)));
}

/* text-align (left, center, right) or vertical-align (top, middle, bottom) for the selected cells */
export function alignCells(t, property, value) {
  changeTable(t.table, () =>
    cellsIn(t.grid, t.rect).forEach(cell => {
      cell.style.setProperty(property, value);
      if (!cell.getAttribute('style')) cell.removeAttribute('style');
    })
  );
}

/* ---- the table's text: its own size, spacing and padding (empty: the default for all tables) ---- */
export function setTableTextSize(t, size) {
  changeTable(t.table, () => setTableVar(t.table, '--tfs', size ? size + 'px' : ''));
}

export function setTableLineSpacing(t, spacing) {
  changeTable(t.table, () => setTableVar(t.table, '--tlh', spacing));
}

export function setTablePadding(t, padding) {
  changeTable(t.table, () => setOrRemove(t.table, 'data-tpad', padding));
}

/* what the table's text looks like now: its own setting, or the default */
export function tableTextLook(table) {
  return {
    size: parseFloat(tableVar(table, '--tfs')) || writingSettings.tfs || TABLE_DEFAULT_SIZE,
    spacing: tableVar(table, '--tlh') || writingSettings.tlh || '',
    padding: table.hasAttribute('data-tpad') ? table.getAttribute('data-tpad') : writingSettings.tpad || ''
  };
}

/* this table's text becomes the default for every table (and this one then just follows the default) */
export function makeTableTextDefault(t) {
  const look = tableTextLook(t.table);
  writingSettings.tfs = look.size;
  writingSettings.tlh = look.spacing;
  writingSettings.tpad = look.padding;
  saveWritingSettings();
  applyTableDefaults();
  changeTable(t.table, () => {
    setTableVar(t.table, '--tfs', '');
    setTableVar(t.table, '--tlh', '');
    t.table.removeAttribute('data-tpad');
  });
  toast('Every table now uses this text size and spacing, unless it has its own');
}

/* the defaults, as CSS variables every table falls back on */
export function applyTableDefaults() {
  const root = document.documentElement;
  const padding = TABLE_PADDINGS.find(p => p[0] === (writingSettings.tpad || '')) || TABLE_PADDINGS[1];
  root.style.setProperty('--tfs-d', (writingSettings.tfs || TABLE_DEFAULT_SIZE) + 'px');
  root.style.setProperty('--tlh-d', writingSettings.tlh || 'var(--edl, 1.65)');
  root.style.setProperty('--tpad-d', padding[2]);
}
