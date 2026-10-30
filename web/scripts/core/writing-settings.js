import { KEY } from './example-data.js';

/* ===== the writing settings kept in this browser: theme, font, sizes, typewriter scrolling, tables' text ===== */
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
export function setWS(value) {
  WS = value;
  return value;
}

export function saveWS() {
  try {
    localStorage.setItem(KEY + '-write', JSON.stringify(WS));
  } catch (x) {}
}
