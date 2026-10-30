import { $, ed, ui } from '../core/helpers-and-state.js';
import { mk } from '../core/paste-cleaning.js';
import { tbMenu, tbState } from './editor-commands.js';
import { closeTbMenu } from '../view/zoom.js';
/* ===== highlight key: what each highlighter colour is for (the Mac app keeps it, and hands it over as window.__HLKEY__) ===== */
const DEFAULT_HIGHLIGHT_KEY = [
  { id: '1', meaning: 'General', hex: '#FFE58A' },
  { id: '5', meaning: 'Key ideas', hex: '#9CCBFF' },
  { id: '4', meaning: 'Read more / secondary references', hex: '#CDB6FF' },
  { id: '2', meaning: 'Case studies & examples', hex: '#FFC58F' },
  { id: '3', meaning: 'Controversial ideas', hex: '#FF9C9C' },
  { id: '6', meaning: '', hex: '#A8E8C0', hidden: true }
];
const DARK_MARK_STRENGTH = '42%'; // in dark mode a mark is its colour mixed this much into the page
export let HLKEY = window.__HLKEY__ || DEFAULT_HIGHLIGHT_KEY;

export function keyOf(id) {
  return (HLKEY || []).find(k => k.id === String(id));
}

/* the colours offered (removed ones stay in the key, so highlights already made keep their colour) */
export function keyShown() {
  return (HLKEY || []).filter(k => !k.hidden);
}

export function keyLabel(k) {
  return k ? k.meaning || 'No meaning yet' : '';
}

function firstKeyColourId() {
  return (keyShown()[0] || { id: '1' }).id;
}

/* mark colours from the key; in dark mode the same colour, deepened into the page */
function applyKeyStyle() {
  let style = $('hlkeystyle');
  if (!style) {
    style = mk('style');
    style.id = 'hlkeystyle';
    document.head.appendChild(style);
  }
  style.textContent = keyStyleCSS();
}

function keyStyleCSS() {
  const selector = k => `.notes mark[data-h="${k.id}"]`;
  const light = HLKEY.map(k => `html ${selector(k)}{background:${k.hex}}`).join('');
  const dark = HLKEY.map(
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
  const scope = root || ed();
  if (!scope) return;
  scope.querySelectorAll('mark[data-h]').forEach(mark => {
    const k = keyOf(mark.getAttribute('data-h'));
    mark.title = k && k.meaning ? k.meaning : '';
  });
}

/* a new key from the Mac app (edited in Settings) */
const nbSetKey = function (list) {
  if (!Array.isArray(list)) return;
  HLKEY = list;
  const current = keyOf(ui.hlColor);
  if (!current || current.hidden) ui.hlColor = firstKeyColourId();
  applyKeyStyle();
  titleMarks();
  tbState();
  if (tbMenu && tbMenu.kind === 'hl') closeTbMenu();
};

export function initHighlightKey() {
  window.nbSetKey = nbSetKey;
  applyKeyStyle();
  ui.hlColor = firstKeyColourId();
}
