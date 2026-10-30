import { closeTbMenu } from '../core/toolbar-menu.js';
import { KEY } from '../core/example-data.js';
import { ed, esc, essays, isDocView, NATIVE, post, toast, ui } from '../core/helpers-and-state.js';
import { Store } from '../core/storage.js';
import { mk } from '../core/paste-cleaning.js';
import { ZOOMS, applyZoom } from '../view/zoom.js';
import { HLKEY, keyOf } from '../editor/highlight-key.js';
import { saveDocNow } from '../editor/notes-document.js';
import { texShowHTML } from '../equations/equation-tex.js';
import { eqPreview, eqStore } from '../equations/equation-menus.js';
import { sylInfo } from '../editor/caret-and-keys.js';
import { FONTS, THEMES, WS, WS_DEF, applyWS, saveWS, twScroll } from '../writing/typewriter-writing.js';

/* ===== Settings (⌘,): which syllabus each document follows, writing, themes, the highlight key, equations, zoom, the library ===== */
const SETTINGS_SECTIONS = [
  ['syl', 'Syllabus'],
  ['write', 'Writing'],
  ['theme', 'Themes'],
  ['key', 'Highlight key'],
  ['eq', 'Equations'],
  ['zoom', 'Zoom & panes'],
  ['lib', 'Library']
];
const DEFAULT_SECTION = 'syl';
/* the writing sliders: [setting in WS, slider id, label, min, max, step, how its value reads] */
const WRITING_RANGES = [
  ['size', 'wssize', 'Size', 12, 22, 0.5, v => v + ' pt'],
  ['lh', 'wslh', 'Line height', 1.3, 2.1, 0.05, v => (+v).toFixed(2)],
  ['ps', 'wsps', 'Paragraph spacing', 0, 1.6, 0.1, v => (+v).toFixed(1)]
];
/* colours offered by "Add colour", in order, skipping any already in the key */
const EXTRA_KEY_COLOURS = ['#A8E8C0', '#FFB3DE', '#9EE6E0', '#DDF59A', '#E2C9A6', '#D5D9DE', '#B8C4FF', '#FFD6A5'];
const FALLBACK_KEY_COLOUR = '#D5D9DE';
const KEY_COLOUR_SAVE_DELAY = 250; // ms after the last change of a colour before the key is saved
const KEY_MEANING_SAVE_DELAY = 500; // ms after the last keystroke in a meaning
/* themes that are dark although their description doesn't say so */
const DARK_THEMES = ['night', 'ink', 'macchiato', 'jazz', 'lofi', 'evdark'];

let settingsSheet = null;
let keySaveTimer = null;

/* ---- settings kept in this browser ---- */
function setPref(name, value) {
  try {
    if (value == null) localStorage.removeItem(KEY + '-' + name);
    else localStorage.setItem(KEY + '-' + name, value);
  } catch (x) {}
}

export function getPref(name) {
  try {
    return localStorage.getItem(KEY + '-' + name);
  } catch (x) {
    return null;
  }
}

/* ---- the sheet ---- */
export function openSettings(section) {
  const known = SETTINGS_SECTIONS.some(([id]) => id === section);
  ui.setSec = known ? section : ui.setSec || DEFAULT_SECTION;
  closeTbMenu();
  if (!settingsSheet) settingsSheet = makeSettingsSheet();
  drawSettings();
}

function makeSettingsSheet() {
  const sheet = mk('div');
  sheet.className = 'setov';
  sheet.innerHTML = settingsSheetHTML();
  document.body.appendChild(sheet);
  wireSettings(sheet);
  return sheet;
}

function settingsSheetHTML() {
  const nav = SETTINGS_SECTIONS.map(
    ([id, name]) => `<button type="button" data-setsec="${id}">${esc(name)}</button>`
  ).join('');
  return (
    '<div class="setwin" role="dialog" aria-modal="true" aria-label="Settings">' +
    `<nav class="setnav"><h2>Settings</h2>${nav}</nav>` +
    '<div class="setmain"><div class="sethd"><h3></h3><button type="button" class="setx" data-setclose title="Close (Esc)" ' +
    'aria-label="Close settings">×</button></div><div class="setbody"></div></div></div>'
  );
}

function closeSettings() {
  if (!settingsSheet) return;
  settingsSheet.remove();
  settingsSheet = null;
}

const nbOpenSettings = function (section) {
  openSettings(section || null);
};

function drawSettings() {
  const section = ui.setSec;
  settingsSheet.querySelectorAll('[data-setsec]').forEach(button => {
    button.classList.toggle('on', button.dataset.setsec === section);
  });
  settingsSheet.querySelector('.sethd h3').textContent = (SETTINGS_SECTIONS.find(([id]) => id === section) || [
    '',
    ''
  ])[1];
  const body = settingsSheet.querySelector('.setbody');
  body.innerHTML = SETTINGS_HTML[section]();
  body.scrollTop = 0;
}

/* ---- the sections ---- */
const SETTINGS_HTML = {
  syl: syllabusSectionHTML,
  write: writingSectionHTML,
  theme: themesSectionHTML,
  key: keySectionHTML,
  eq: equationsSectionHTML,
  zoom: zoomSectionHTML,
  lib: librarySectionHTML
};

function settingsNote(text) {
  return `<p class="setnote">${text}</p>`;
}

function settingsRow(title, note, control) {
  const noteHTML = note ? `<div class="setrn">${note}</div>` : '';
  return `<div class="setrow"><div><div class="setrt">${esc(title || 'Untitled')}</div>${noteHTML}</div>${control}</div>`;
}

/* Syllabus: every notebook, essay and deck with the syllabus it follows */
function syllabusSectionHTML() {
  if (!NATIVE)
    return settingsNote('Syllabi are kept by the Mac app; in the browser version this notebook carries its own.');
  const docs = (window.__NB__ || {}).docs || [];
  const decks = docs.filter(doc => doc.kind === 'decks');
  return (
    settingsNote(
      'Each notebook, essay and deck can follow a syllabus: its points are what you rate, tag notes and cards with, and check ' +
        'your coverage against.'
    ) +
    '<h4>Notebooks</h4>' +
    notebookRowsHTML(docs.filter(doc => doc.kind === 'notebooks')) +
    '<h4>Essays</h4>' +
    essayRowsHTML() +
    (decks.length
      ? '<h4>Decks</h4>' + decks.map(d => settingsRow(d.title, '', syllabusPicker('decks', d.id, d.syllabus))).join('')
      : '')
  );
}

/* (the web version knows only the notebook that's open) */
function notebookRowsHTML(notebooks) {
  const N = window.__NB__ || {};
  const list = notebooks.length
    ? notebooks
    : [{ id: '', title: (N.meta || {}).title, syllabus: (sylInfo().cur || {}).id, current: true }];
  return list
    .map(nb =>
      settingsRow(nb.title, nb.current ? 'Open now' : '', syllabusPicker('notebooks', nb.id, nb.syllabus, nb.current))
    )
    .join('');
}

function essayRowsHTML() {
  if (!essays.length) return settingsNote('No essays yet.');
  return essays
    .map(es => {
      const open = es.id === ui.essayId && ui.view === 'essay';
      return settingsRow(
        es.title || 'Untitled essay',
        open ? 'Open now' : '',
        syllabusPicker('essays', es.id, es.syllabus)
      );
    })
    .join('');
}

/* the syllabus a document follows; "New syllabus…" is offered for the open notebook */
function syllabusPicker(kind, id, current, canMakeNew) {
  current = current || '';
  const options = sylInfo()
    .list.map(
      s =>
        `<option value="${esc(s.id)}"${s.id === current ? ' selected' : ''}>${esc(s.title || 'Untitled syllabus')}</option>`
    )
    .join('');
  const makeNew = canMakeNew ? '<option value="__new">New syllabus…</option>' : '';
  return `<select data-setsyl="${kind}" data-id="${esc(id)}"><option value="">None</option>${options}${makeNew}</select>`;
}

/* Writing: font, size and spacing, typewriter scrolling, with a preview */
function writingSectionHTML() {
  const fonts = Object.keys(FONTS)
    .map(k => `<option value="${k}"${WS.font === k ? ' selected' : ''}>${FONTS[k][0]}</option>`)
    .join('');
  return (
    `<div class="setgrid"><label class="setfield"><span>Font</span><select id="wsfont">${fonts}</select></label>` +
    WRITING_RANGES.map(writingRangeHTML).join('') +
    `<label class="wstw"><input type="checkbox" id="wstw"${WS.tw ? ' checked' : ''}> Typewriter scrolling ` +
    '<span class="k">⌃⌘T</span><span class="setrn">Keeps the line you’re writing in the middle of the window</span></label></div>' +
    '<div class="setprev docbody notes"><p>Supervised learning models define mappings from one or more inputs to one or more ' +
    'outputs.</p><p>The model itself is just a mathematical equation containing parameters, which training adjusts until its ' +
    'outputs match the examples.</p></div>' +
    '<button type="button" class="setbtn" data-wsreset="1">Reset writing to defaults</button>'
  );
}

function writingRangeHTML([setting, id, label, min, max, step, format]) {
  const value = WS[setting];
  return (
    `<label class="wsr"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" ` +
    `value="${value}"><output>${format(value)}</output></label>`
  );
}

/* Themes: System, then the light ones and the dark ones */
function themesSectionHTML() {
  const others = Object.keys(THEMES).filter(k => k !== 'graphite');
  const light = others.filter(k => !isDarkTheme(k));
  const dark = others.filter(isDarkTheme);
  return (
    settingsNote('The theme applies to the whole app: notes, essays, the reader and decks.') +
    `<div class="setthemes"><div class="wsth">${themeTileHTML('graphite')}</div>` +
    `<h4>Light</h4><div class="wsth">${light.map(themeTileHTML).join('')}</div>` +
    `<h4>Dark</h4><div class="wsth">${dark.map(themeTileHTML).join('')}</div></div>`
  );
}

function isDarkTheme(k) {
  return DARK_THEMES.includes(k) || THEMES[k][1] === 'Dark';
}

/* a theme's swatch: its page colour and text colour (System shows its light and dark halves) */
function themeTileHTML(k) {
  const [name, description, page, text, darkPage] = THEMES[k];
  const isSystem = k === 'graphite';
  const background = isSystem ? `linear-gradient(135deg,${page} 50%,${darkPage} 50%)` : page;
  const colour = isSystem ? '#7d8a97' : text;
  return (
    `<button type="button" data-wst="${k}" class="${WS.theme === k ? 'on' : ''}" title="${esc(description || name)}">` +
    `<span class="sw" style="background:${background};color:${colour}">Aa</span><span class="tn">${esc(name)}</span></button>`
  );
}

/* Highlight key: each colour and what it means; removed ones can be put back */
function keySectionHTML() {
  const shown = HLKEY.filter(k => !k.hidden);
  const gone = HLKEY.filter(k => k.hidden);
  return (
    settingsNote(
      'What each highlighter colour is for. It shows when you choose a colour, and when you point at a highlight, in notes, ' +
        'essays and PDFs.'
    ) +
    `<div class="setkey">${shown.map(keyRowHTML).join('')}</div>` +
    `<div class="setrowb"><button type="button" class="setbtn" data-keyadd>+ Add colour</button>${putBackHTML(gone)}</div>`
  );
}

function keyRowHTML(k) {
  const id = esc(k.id);
  return (
    `<div class="setkr"><input type="color" value="${esc(k.hex)}" data-keyhex="${id}" aria-label="Colour">` +
    `<input type="text" value="${esc(k.meaning || '')}" placeholder="What this colour means" data-keymean="${id}">` +
    `<button type="button" class="setkx" data-keyhide="${id}" title="Remove from the key (highlights already made keep their ` +
    'colour)">×</button></div>'
  );
}

function putBackHTML(gone) {
  if (!gone.length) return '';
  const options = gone.map(k => `<option value="${esc(k.id)}">${esc(k.meaning || k.hex)}</option>`).join('');
  return `<select data-keyback><option value="">Put back…</option>${options}</select>`;
}

/* Equations: the way of typing, your saved equations, pinned symbols */
function equationsSectionHTML() {
  return (
    '<h4>Typing equations</h4>' +
    typingChoiceHTML(getPref('latex') === '1') +
    '<h4>Your saved equations</h4>' +
    savedEquationsHTML(eqStore('saved')) +
    '<h4>Pinned symbols</h4>' +
    pinnedSymbolsHTML(eqStore('pins'))
  );
}

function typingChoiceHTML(latex) {
  return (
    `<div class="setchoice"><label><input type="radio" name="seteqm" value="v"${latex ? '' : ' checked'}> <b>Visual</b>` +
    '<span class="setrn">Boxes to fill in, as in Word</span></label>' +
    `<label><input type="radio" name="seteqm" value="t"${latex ? ' checked' : ''}> <b>LaTeX</b>` +
    '<span class="setrn">The code behind the boxes</span></label></div>'
  );
}

function savedEquationsHTML(saved) {
  if (!saved.length)
    return settingsNote(
      'None yet: in the equation editor, open the π Equation gallery and choose “Save this equation to the gallery”.'
    );
  const rows = saved.map(
    (eq, i) =>
      `<div class="seteq"><input type="text" value="${esc(eq.n)}" data-eqname="${i}" aria-label="Name">` +
      `<div class="seteqr">${texShowHTML(eq.t)}</div><button type="button" class="setkx" data-eqdel2="${i}" title="Remove">×</button></div>`
  );
  return `<div class="seteqs">${rows.join('')}</div>`;
}

function pinnedSymbolsHTML(pins) {
  if (!pins.length)
    return settingsNote(
      'None yet: in the full symbol list, click a symbol’s pin to keep it at the front of the strip.'
    );
  const chips = pins.map(
    (tex, i) =>
      `<span class="setpin">${eqPreview(tex)}<button type="button" data-unpin="${i}" title="Unpin" aria-label="Unpin">×</button></span>`
  );
  return `<div class="setpins">${chips.join('')}</div><button type="button" class="setbtn" data-unpinall>Unpin all</button>`;
}

/* Zoom & panes: the zoom a document opens at, and whether panes fold away */
function zoomSectionHTML() {
  const start = getPref('zoomstart') || 'last';
  const fold = getPref('zfold') !== '0';
  const option = (value, label) =>
    `<option value="${value}"${start === String(value) ? ' selected' : ''}>${label}</option>`;
  const options =
    option('last', 'Use the last zoom') +
    option('fit', 'Fit to window') +
    ZOOMS.map(z => option(z, Math.round(z * 100) + '%')).join('');
  return (
    `<label class="setfield"><span>When a document opens</span><select data-zoomstart>${options}</select></label>` +
    `<label class="wstw"><input type="checkbox" data-zfold${fold ? ' checked' : ''}> Fold panes away when zoomed in` +
    '<span class="setrn">Once the page is wider than the room beside the open panes, they fold away so it can fill the window; ' +
    'they come back when you zoom out</span></label>' +
    settingsNote('Zoom with ⌘+ and ⌘−, a trackpad pinch, or the buttons in the toolbar. Your place stays where it is.')
  );
}

/* Library: where everything is saved */
function librarySectionHTML() {
  if (!NATIVE)
    return settingsNote(
      'This version saves in this browser only. Clearing the browser’s site data removes your notes, so export them from time to time.'
    );
  return (
    settingsNote('Everything saves automatically as you type, into your library folder on this Mac.') +
    `<div class="setrow"><div><div class="setrt">Library folder</div><div class="setrn setpath">${esc(window.__NBLIB__ || '')}` +
    '</div></div><button type="button" class="setbtn" data-revlib>Show in Finder</button></div>'
  );
}

/* ---- what the controls do ---- */
function wireSettings(sheet) {
  sheet.addEventListener('mousedown', e => {
    if (e.target === sheet) closeSettings(); // a press on the dimmed page around it
  });
  sheet.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeSettings();
  });
  sheet.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (button) runSettingsAction(SETTINGS_CLICKS, button);
  });
  sheet.addEventListener('input', e => runSettingsAction(SETTINGS_INPUTS, e.target));
  sheet.addEventListener('change', e => runSettingsAction(SETTINGS_CHANGES, e.target));
}

/* the first [is it this control, what to do] that matches */
function runSettingsAction(actions, control) {
  const action = actions.find(([matches]) => matches(control));
  if (action) action[1](control);
}

const SETTINGS_CLICKS = [
  [b => !!b.dataset.setsec, b => showSettingsSection(b.dataset.setsec)],
  [b => b.hasAttribute('data-setclose'), closeSettings],
  [b => !!b.dataset.wst, chooseTheme],
  [b => b.hasAttribute('data-wsreset'), resetWriting],
  [b => !!b.dataset.keyhide, b => setKeyColourHidden(b.dataset.keyhide, true)],
  [b => b.hasAttribute('data-keyadd'), addKeyColour],
  [b => b.dataset.eqdel2 != null, b => changeStoredList('saved', list => list.splice(+b.dataset.eqdel2, 1))],
  [b => b.dataset.unpin != null, b => changeStoredList('pins', list => list.splice(+b.dataset.unpin, 1))],
  [b => b.hasAttribute('data-unpinall'), () => changeStoredList('pins', list => list.splice(0))],
  [b => b.hasAttribute('data-revlib'), () => post({ type: 'revealLibrary' })]
];

const SETTINGS_INPUTS = [
  [t => WRITING_RANGES.some(([, id]) => id === t.id), changeWritingRange],
  [
    t => !!t.dataset.keyhex,
    t => changeKeyColour(t.dataset.keyhex, 'hex', t.value.toUpperCase(), KEY_COLOUR_SAVE_DELAY)
  ],
  [t => !!t.dataset.keymean, t => changeKeyColour(t.dataset.keymean, 'meaning', t.value, KEY_MEANING_SAVE_DELAY)],
  [t => t.dataset.eqname != null, renameSavedEquation]
];

const SETTINGS_CHANGES = [
  [t => t.id === 'wsfont', t => changeWriting('font', t.value)],
  [t => t.id === 'wstw', changeTypewriter],
  [t => t.name === 'seteqm', t => setPref('latex', t.value === 't' ? '1' : '0')],
  [t => t.hasAttribute('data-zoomstart'), t => setPref('zoomstart', t.value === 'last' ? null : t.value)],
  [t => t.hasAttribute('data-zfold'), changePaneFolding],
  [t => t.hasAttribute('data-keyback'), t => setKeyColourHidden(t.value, false)],
  [t => !!t.dataset.setsyl, t => linkSyllabus(t.dataset.setsyl, t.dataset.id, t.value)]
];

function showSettingsSection(section) {
  ui.setSec = section;
  drawSettings();
}

/* ---- writing and themes ---- */
function changeWriting(setting, value) {
  WS[setting] = value;
  saveWS();
  applyWS();
}

function chooseTheme(button) {
  changeWriting('theme', button.dataset.wst);
  settingsSheet.querySelectorAll('[data-wst]').forEach(tile => tile.classList.toggle('on', tile === button));
}

function changeWritingRange(slider) {
  const [setting, , , , , , format] = WRITING_RANGES.find(([, id]) => id === slider.id);
  const reading = slider.nextElementSibling;
  if (reading) reading.textContent = format(slider.value);
  changeWriting(setting, +slider.value);
}

function changeTypewriter(checkbox) {
  changeWriting('tw', checkbox.checked);
  twScroll();
}

/* everything but the theme back to how it started */
function resetWriting() {
  const theme = WS.theme;
  Object.keys(WS_DEF).forEach(k => (WS[k] = WS_DEF[k]));
  WS.theme = theme;
  saveWS();
  applyWS();
  drawSettings();
}

/* ---- the highlight key ---- */
function saveKey() {
  if (NATIVE) post({ type: 'setKey', key: HLKEY });
  else window.nbSetKey(HLKEY);
}

/* typing and colour picking save a moment after the last change */
function changeKeyColour(id, field, value, delay) {
  const colour = keyOf(id);
  if (!colour) return;
  colour[field] = value;
  clearTimeout(keySaveTimer);
  keySaveTimer = setTimeout(saveKey, delay);
}

function setKeyColourHidden(id, hidden) {
  const colour = keyOf(id);
  if (!colour) return;
  colour.hidden = hidden;
  saveKey();
  drawSettings();
}

function addKeyColour() {
  const used = HLKEY.map(k => k.hex.toUpperCase());
  const hex = EXTRA_KEY_COLOURS.find(c => !used.includes(c)) || FALLBACK_KEY_COLOUR;
  HLKEY.push({ id: 'k' + Math.random().toString(36).slice(2, 10), meaning: '', hex: hex, hidden: false });
  saveKey();
  drawSettings();
  const meanings = settingsSheet.querySelectorAll('[data-keymean]');
  if (meanings.length) meanings[meanings.length - 1].focus();
}

/* ---- saved equations and pinned symbols ---- */
function changeStoredList(name, change) {
  const list = eqStore(name);
  change(list);
  eqStore(name, list);
  drawSettings();
}

function renameSavedEquation(input) {
  const saved = eqStore('saved');
  const eq = saved[+input.dataset.eqname];
  if (!eq) return;
  eq.n = input.value;
  eqStore('saved', saved);
}

/* ---- zoom ---- */
function changePaneFolding(checkbox) {
  setPref('zfold', checkbox.checked ? null : '0');
  if (isDocView()) applyZoom();
}

/* ---- which syllabus a document follows ---- */
function linkSyllabus(kind, id, syllabusId) {
  if (kind === 'essays') {
    linkEssaySyllabus(id, syllabusId);
    return;
  }
  const doc = ((window.__NB__ || {}).docs || []).find(d => d.kind === kind && d.id === id);
  if (kind === 'notebooks' && (!doc || doc.current)) {
    linkOpenNotebookSyllabus(syllabusId);
    return;
  }
  if (doc) doc.syllabus = syllabusId || null;
  post({ type: 'linkDocSyllabus', kind: kind, id: id, sid: syllabusId });
  toast(syllabusId ? 'Linked to the syllabus' : 'No longer linked to a syllabus');
}

function linkEssaySyllabus(id, syllabusId) {
  const essay = essays.find(es => es.id === id);
  if (!essay) return;
  essay.syllabus = syllabusId || null;
  essay.updated = Date.now();
  Store.saveEssays();
  toast(syllabusId ? 'Essay linked to the syllabus' : 'Essay no longer linked to a syllabus');
}

/* the open notebook: the Mac app reloads the page with the new syllabus, and Settings opens again after */
function linkOpenNotebookSyllabus(syllabusId) {
  if (ed()) saveDocNow();
  try {
    sessionStorage.setItem(KEY + '-reopenset', 'syl');
  } catch (x) {}
  post({ type: 'linkSyllabus', id: syllabusId, view: ui.view });
}

/* ⌘, in the web version (the Mac app's own Settings… menu item does it there) */
const onSettingsKeydown = function (e) {
  if (NATIVE) return;
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === ',') {
    e.preventDefault();
    if (settingsSheet) closeSettings();
    else openSettings();
  }
};

export function initSettings() {
  window.nbOpenSettings = nbOpenSettings;
  document.addEventListener('keydown', onSettingsKeydown);
}
