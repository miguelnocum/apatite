import { fromApp } from '../core/bridge.js';
import { HIGHLIGHT_KEY, keyOf, keyShown, setHighlightKey } from './highlight-colours.js';
import { updateToolbarState } from './toolbar-state.js';
import { closeToolbarMenu, toolbarMenu } from '../core/toolbar-menu.js';
import { $, openEditor, uiState } from '../core/helpers-and-state.js';
import { makeElement } from '../core/paste-cleaning.js';
const DARK_MARK_STRENGTH = '42%'; // in dark mode a mark is its colour mixed this much into the page

function firstKeyColourId() {
  return (keyShown()[0] || { id: '1' }).id;
}

/* mark colours from the key; in dark mode the same colour, deepened into the page */
function applyKeyStyle() {
  let style = $('hlkeystyle');
  if (!style) {
    style = makeElement('style');
    style.id = 'hlkeystyle';
    document.head.appendChild(style);
  }
  style.textContent = keyStyleCSS();
}

function keyStyleCSS() {
  const selector = k => `.notes mark[data-h="${k.id}"]`;
  const light = HIGHLIGHT_KEY.map(k => `html ${selector(k)}{background:${k.hex}}`).join('');
  const dark = HIGHLIGHT_KEY.map(
    k => `${selector(k)}{background:color-mix(in srgb,${k.hex} ${DARK_MARK_STRENGTH},var(--panel))}`
  );
  const within = prefix => dark.map(rule => prefix + ' ' + rule).join('');
  return (
    light +
    `@media(prefers-color-scheme:dark){${within(':root:not([data-theme=light])')}}` +
    within(':root[data-theme=dark]')
  );
}

/* pointing at a highlight says what it means */
export function titleMarks(root) {
  const scope = root || openEditor();
  if (!scope) return;
  scope.querySelectorAll('mark[data-h]').forEach(mark => {
    const k = keyOf(mark.getAttribute('data-h'));
    mark.title = k && k.meaning ? k.meaning : '';
  });
}

/* a new key from the Mac app (edited in Settings) */
const nbSetKey = function (list) {
  if (!Array.isArray(list)) return;
  setHighlightKey(list);
  const current = keyOf(uiState.hlColor);
  if (!current || current.hidden) uiState.hlColor = firstKeyColourId();
  applyKeyStyle();
  titleMarks();
  updateToolbarState();
  if (toolbarMenu && toolbarMenu.kind === 'hl') closeToolbarMenu();
};

export function initHighlightKey() {
  fromApp('nbSetKey', nbSetKey);
  applyKeyStyle();
  uiState.hlColor = firstKeyColourId();
}
