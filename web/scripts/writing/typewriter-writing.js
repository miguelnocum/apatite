import { KEY } from '../core/example-data.js';
import { $, NATIVE, post } from '../core/helpers-and-state.js';
import { inEd } from '../editor/editor-commands.js';
import { applyTableDefaults } from '../tables/table-look.js';
import { headerHeight } from '../view/zoom.js';
import { postFocus } from '../view/focus-mode.js';
import { ed } from '../editor/notes-document.js';
import { positionCards } from '../editor/comments.js';
import { isDocView } from '../essays/essays.js';
import { mdTopBlock } from './writing.js';
import { drawFolds, revealInEd } from '../editor/folding.js';

/* ===== typewriter scrolling: the line you're on stays in the middle of the window ===== */
const TYPEWRITER_LINE = 0.45; // the caret's line sits this far down the space below the header
const TYPEWRITER_SLACK = 3; // px off that line before the page scrolls
const LAYOUT_SETTLE_DELAY = 30; // ms after a change of font or size before the folds and comment cards move
let typewriterFrame = 0;

export function twScroll() {
  if (!WS.tw || !inEd()) return;
  const caret = caretBox();
  if (!caret) return;
  const header = headerHeight();
  const target = header + (innerHeight - header) * TYPEWRITER_LINE;
  const distance = caret.top + caret.height / 2 - target;
  if (Math.abs(distance) < TYPEWRITER_SLACK) return;
  const root = document.documentElement;
  const behavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  window.scrollBy(0, distance);
  root.style.scrollBehavior = behavior;
}

/* where the caret is on screen (or the element it's in, when it has no box of its own) */
function caretBox() {
  const selection = getSelection();
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(false);
  const box = range.getClientRects()[0];
  if (box) return box;
  const node = selection.focusNode;
  const el = node && (node.nodeType === 3 ? node.parentNode : node);
  return el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
}

/* the caret moving: typewriter scrolling follows it, and a fold it lands in opens */
const onTypewriterWritingSelectionchange = () => {
  if (!isDocView()) return;
  if (WS.tw) {
    cancelAnimationFrame(typewriterFrame);
    typewriterFrame = requestAnimationFrame(twScroll);
  }
  const selection = getSelection();
  const editor = ed();
  if (!(selection.rangeCount && selection.isCollapsed && editor && editor.contains(selection.anchorNode))) return;
  const block = mdTopBlock(selection.anchorNode);
  if (block && block.classList && block.classList.contains('fh')) revealInEd(block);
};

/* ===== writing settings: theme, font, size, spacing ===== */
export const FONTS = {
  serif: ['Source Serif', '"Source Serif 4",Georgia,serif'],
  ny: ['New York', 'ui-serif,"New York",Georgia,serif'],
  charter: ['Charter', 'Charter,"Bitstream Charter",Georgia,serif'],
  iowan: ['Iowan Old Style', '"Iowan Old Style",Palatino,Georgia,serif'],
  georgia: ['Georgia', 'Georgia,serif'],
  sans: ['Hanken Grotesk', '"Hanken Grotesk",system-ui,sans-serif'],
  sf: ['San Francisco', '-apple-system,system-ui,sans-serif'],
  avenir: ['Avenir Next', '"Avenir Next",Avenir,system-ui,sans-serif'],
  mono: ['IBM Plex Mono', '"IBM Plex Mono",ui-monospace,monospace']
};
export const THEMES = {
  graphite: ['System', 'Light or dark, following your Mac', '#ffffff', '#18222c', '#192027'],
  paper: ['Paper', 'Warm cream page', '#fbf7ef', '#3b3026'],
  night: ['Night', 'Soft dark', '#1f242d', '#d6dbe4'],
  ink: ['Ink', 'True black', '#000000', '#e6e6e6'],
  latte: ['Catppuccin Latte', 'Soft pastel light', '#eff1f5', '#179299'],
  macchiato: ['Catppuccin Macchiato', 'Pastel on deep blue', '#24273a', '#8bd5ca'],
  jazz: ['Shibuya Jazz', 'Black, teal and rose', '#000000', '#5fa8a0'],
  lofi: ['Shibuya Lo-fi', 'Black, lavender and amber', '#000000', '#9d8fe0'],
  evdark: ['Everforest Dark', 'Forest dusk', '#272e33', '#dbbc7f'],
  evlight: ['Everforest Light', 'Warm parchment', '#fdf6e3', '#4f5b62'],
  rosedawn: ['Rosé Pine Dawn', 'Light', '#faf4ed', '#286983'],
  rosepine: ['Rosé Pine', 'Dark', '#1f1d2e', '#c4a7e7'],
  tokyo: ['Tokyo Night', 'Dark', '#24283b', '#7aa2f7'],
  tokyolight: ['Tokyo Night Light', 'Light', '#e6e7ed', '#2e5d7d'],
  academia: ['Academia', 'Dark', '#5a4444', '#e3d1c6'],
  atom: ['Atom', 'Dark', '#282c34', '#e6e6e6'],
  gruvbox: ['Gruvbox', 'Light', '#fbf1c7', '#79740e'],
  nordlight: ['Nord Light', 'Light', '#ffffff', '#b0555f'],
  nord: ['Nord', 'Dark', '#2e3440', '#e5e9f0'],
  notes: ['Notes', 'Light', '#ffffff', '#3a3a3a'],
  darknotes: ['Dark Notes', 'Dark', '#1f1f1f', '#e8e8e8'],
  lighthaus: ['Lighthaus', 'Dark', '#18191e', '#ffee79'],
  dieci: ['Dieci', 'Dark', '#000000', '#f7cf48'],
  ayu: ['Ayu', 'Light', '#fafafa', '#6c6a85'],
  ayumirage: ['Ayu Mirage', 'Dark', '#1f2430', '#8a94a6'],
  gandalf: ['Gandalf', 'Light', '#efefef', '#3b4a63'],
  olivedunk: ['Olive Dunk', 'Light', '#f8f7ef', '#3d6b4c'],
  dboring: ['D.Boring', 'Light', '#f9f9fc', '#000000'],
  dracula: ['Dracula', 'Dark', '#363847', '#7cee82'],
  toothpaste: ['Toothpaste', 'Dark', '#252b31', '#8fcfdc'],
  cobalt: ['Cobalt', 'Dark', '#1c2638', '#dbcc5a'],
  duolight: ['Duotone Light', 'Light', '#faf8f5', '#5a503f'],
  duosnow: ['Duotone Snow', 'Light', '#fdfdfd', '#4a6799'],
  duoheat: ['Duotone Heat', 'Light', '#fbfaf9', '#8a4fb0']
};
/* themes that are always dark or light, whatever the Mac's appearance */
// prettier-ignore
const ALWAYS_DARK_THEMES = new Set(['night', 'ink', 'macchiato', 'jazz', 'lofi', 'evdark', 'rosepine', 'tokyo', 'academia', 'atom',
  'nord', 'darknotes', 'lighthaus', 'dieci', 'ayumirage', 'dracula', 'toothpaste', 'cobalt']);
// prettier-ignore
const ALWAYS_LIGHT_THEMES = new Set(['paper', 'latte', 'evlight', 'rosedawn', 'tokyolight', 'gruvbox', 'nordlight', 'notes', 'ayu',
  'gandalf', 'olivedunk', 'dboring', 'duolight', 'duosnow', 'duoheat']);
/* tfs, tlh, tpad: every table's text size (px), line spacing and cell room, unless a table has its own */
export const WS_DEF = {
  theme: 'graphite',
  font: 'serif',
  size: 15.5,
  lh: 1.65,
  ps: 0.6,
  tw: false,
  tfs: 14,
  tlh: '',
  tpad: ''
};
export let WS;

/* the saved settings, each one missing (or a theme or font no longer offered) at its default */
function loadWritingSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY + '-write') || '{}') || {};
  } catch (x) {}
  const settings = {};
  Object.keys(WS_DEF).forEach(key => (settings[key] = saved[key] != null ? saved[key] : WS_DEF[key]));
  if (!THEMES[settings.theme]) settings.theme = 'graphite';
  if (!FONTS[settings.font]) settings.font = 'serif';
  return settings;
}

export function saveWS() {
  try {
    localStorage.setItem(KEY + '-write', JSON.stringify(WS));
  } catch (x) {}
}

export function applyWS() {
  const root = document.documentElement;
  root.setAttribute('data-skin', WS.theme);
  if (ALWAYS_LIGHT_THEMES.has(WS.theme)) root.setAttribute('data-theme', 'light');
  else if (ALWAYS_DARK_THEMES.has(WS.theme)) root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  root.style.setProperty('--edf', FONTS[WS.font][1]);
  root.style.setProperty('--eds', WS.size + 'px');
  root.style.setProperty('--edsb', WS.size + 'px'); // (focus mode's zoom scales it)
  root.style.setProperty('--edl', String(WS.lh));
  root.style.setProperty('--edp', WS.ps + 'em');
  document.body.classList.toggle('twmode', !!WS.tw);
  applyTableDefaults();
  if (NATIVE) postTheme(root);
  postFocus();
  if (!ed()) return;
  setTimeout(drawFolds, LAYOUT_SETTLE_DELAY);
  if (!$('cmts').hidden) setTimeout(positionCards, LAYOUT_SETTLE_DELAY);
}

/* the Mac app's own windows take the theme's colours */
function postTheme(root) {
  const styles = getComputedStyle(root);
  const colour = name => styles.getPropertyValue(name).trim();
  post({
    type: 'theme',
    id: WS.theme,
    dark: root.getAttribute('data-theme') === 'dark',
    bg: colour('--bg'),
    panel: colour('--panel'),
    fg: colour('--fg'),
    muted: colour('--muted'),
    line: colour('--line'),
    accent: colour('--ink'),
    heading: colour('--hd') || colour('--fg')
  });
}

export function initTypewriterWriting() {
  document.addEventListener('selectionchange', onTypewriterWritingSelectionchange);
  WS = loadWritingSettings();
  applyWS();
}
