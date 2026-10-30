/* ===== tables: the right-click menu on a cell. Right-clicking inside the selected cells keeps them selected, so they
   can be merged; anywhere else in a table, that cell becomes the one acted on ===== */
const MENU_EDGE = 8; // px a menu keeps from the window's edges

document.addEventListener('contextmenu', e => {
  const cell = e.target.closest && e.target.closest('#ed td, #ed th');
  if (!cell || !ed().isContentEditable) return;
  e.preventDefault();
  if (!cell.classList.contains('tsel')) {
    clearCellSelection();
    ui.tblCell = cell;
    caretInto(cell);
  }
  const t = tableTarget();
  if (t) openTableMenu(t, e.clientX, e.clientY);
});

function openTableMenu(t, x, y) {
  closeTbMenu();
  const menu = mk('div');
  menu.className = 'tbmenu tctx';
  menu.setAttribute('role', 'menu');
  menu.kind = 'table';
  menu.innerHTML = tableMenuHTML(t);
  document.body.appendChild(menu);
  tbMenu = menu;
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  menu.style.left = Math.max(MENU_EDGE, Math.min(x, width - menu.offsetWidth - MENU_EDGE)) + 'px';
  menu.style.top = Math.max(MENU_EDGE, Math.min(y, height - menu.offsetHeight - MENU_EDGE)) + 'px';
  menu.addEventListener('mousedown', e => e.preventDefault()); // the selection stays
  menu.addEventListener('click', tableMenuClick);
}

function tableMenuHTML(t) {
  return tableMenuGroups(t)
    .map(group => group.map(item => tableMenuItem(...item)).join(''))
    .join('<hr>');
}

/* the menu's items, in groups: [command, its label, whether it's unavailable], from what's selected (m) */
const TABLE_MENU = [
  [
    ['merge', m => (m.cells > 1 ? `Merge ${m.cells} cells` : 'Merge cells'), m => m.cells < 2],
    ['split', () => 'Split cell', m => !m.merged]
  ],
  [
    ['rowabove', m => `Insert ${m.rows} above`],
    ['rowbelow', m => `Insert ${m.rows} below`],
    ['colleft', m => `Insert ${m.columns} left`],
    ['colright', m => `Insert ${m.columns} right`]
  ],
  [
    ['delrows', m => 'Delete ' + m.rows],
    ['delcols', m => 'Delete ' + m.columns],
    ['deltable', () => 'Delete table']
  ],
  [
    ['selrow', m => 'Select ' + m.rows],
    ['selcol', m => 'Select ' + m.columns],
    ['seltable', () => 'Select table'],
    ['clear', m => (m.cells > 1 ? 'Clear cells' : 'Clear cell')]
  ]
];

function tableMenuGroups(t) {
  const cells = cellsIn(t.grid, t.rect);
  const m = {
    cells: cells.length,
    rows: countOf(t.rect.r1 - t.rect.r0 + 1, 'row'),
    columns: countOf(t.rect.c1 - t.rect.c0 + 1, 'column'),
    merged: cells.some(c => c.rowSpan > 1 || c.colSpan > 1)
  };
  return TABLE_MENU.map(group => group.map(([command, label, off]) => [command, label(m), !!(off && off(m))]));
}

/* "row", or "3 rows" */
function countOf(n, word) {
  return n > 1 ? n + ' ' + word + 's' : word;
}

function tableMenuItem(command, label, off) {
  return (
    `<button type="button" role="menuitem" data-tmi="${command}"${off ? ' disabled' : ''}>` +
    `<svg class="tmi" viewBox="0 0 24 24" aria-hidden="true">${TABLE_ICONS[command] || ''}</svg>${label}</button>`
  );
}

function tableMenuClick(e) {
  const button = e.target.closest('button');
  if (!button || button.disabled) return;
  closeTbMenu();
  const t = tableTarget();
  const command = TABLE_TAB_COMMANDS[button.dataset.tmi];
  if (t && command) command(t);
  tableChanged();
}
