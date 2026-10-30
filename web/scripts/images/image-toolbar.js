import { $, ed, toast } from '../core/helpers-and-state.js';
import { mk } from '../core/paste-cleaning.js';
import { saveDocSoon } from '../editor/notes-document.js';
import { edChanged } from '../editor/hydrate-and-changes.js';
import { startImgMove, startImgResize } from './image-resize-move.js';
import { cancelCrop, openCrop } from './image-crop.js';
import { caretToStart } from '../writing/block-shortcuts.js';

/* ===== images: click one for layout, size, crop, move, caption, delete ===== */
const TOOLBAR_MARGIN = 8; // px between the toolbar and the picture, and the window's sides
const TOOLBAR_MIN_TOP = 70; // px: a toolbar that would sit higher than this (under the header) goes below the picture
const WRAPPED_WIDTH = '50'; // a picture wrapped by text starts at half the width
export let imgTool = null;
export let imgSel = null;
export const imgOrig = new WeakMap(); // a cropped picture's original

/* the picture, or the figure it's captioned in */
export function imgNode(img) {
  return img.closest('figure') || img;
}

export function closeImgTool() {
  cancelCrop();
  if (imgTool) {
    imgTool.remove();
    imgTool = null;
  }
  const frame = $('imgframe');
  if (frame) frame.remove();
  imgSel = null;
}

export function openImgTool(img) {
  closeImgTool();
  imgSel = img;
  const toolbar = mk('div');
  toolbar.className = 'imgbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Image');
  document.body.appendChild(toolbar);
  imgTool = toolbar;
  drawImgTool();
  /* the Move button is dragged; the others are clicked (none takes the focus from the notes) */
  toolbar.addEventListener('mousedown', e => {
    e.preventDefault();
    if (e.target.closest('[data-it=move]')) startImgMove(e);
  });
  toolbar.addEventListener('click', e => {
    const button = e.target.closest('[data-it]');
    if (button) imgAct(button.dataset.it, button);
  });
}

export function drawImgTool() {
  const img = imgSel;
  if (!img || !imgTool) return;
  imgTool.innerHTML = imageButtons(img)
    .map(group =>
      group
        .map(
          ([id, label, on, title]) =>
            `<button data-it="${id}" class="${on ? 'on' : ''}" title="${title}">${label}</button>`
        )
        .join('')
    )
    .join('<i></i>');
  placeImgTool();
}

/* the toolbar's buttons, in groups: [action, label, pressed, title] */
function imageButtons(img) {
  const caption = img.closest('figure')
    ? ['nocap', 'Remove caption', false, 'Remove the caption']
    : ['cap', 'Caption', false, 'Add a numbered caption'];
  const reset = imgOrig.has(img) ? [['uncrop', 'Reset crop', false, 'Back to the uncropped image']] : [];
  return [
    [['move', '⠿ Move', false, 'Drag to move the image between lines']],
    wrapButtons(img.getAttribute('data-wrap') || ''),
    sizeButtons(img.getAttribute('data-w')),
    [['crop', 'Crop', false, 'Crop the image'], ...reset],
    [caption, ['del', '\u{1F5D1}', false, 'Delete the image']]
  ];
}

function wrapButtons(wrap) {
  return [
    ['wrap:', 'In line', !wrap, 'On its own between lines, centred'],
    ['wrap:left', 'Wrap left', wrap === 'left', 'Image on the left, text flows around it'],
    ['wrap:right', 'Wrap right', wrap === 'right', 'Image on the right, text flows around it']
  ];
}

function sizeButtons(width) {
  return [
    ['w:25', 'S', width === '25', 'Small (a quarter of the width)'],
    ['w:50', 'M', width === '50', 'Medium (half the width)'],
    ['w:75', 'L', width === '75', 'Large (three quarters)'],
    ['w:100', 'Full', width === '100' || !width, 'Full width']
  ];
}

/* the toolbar above the image, and a frame with corner handles for resizing */
export function placeImgTool() {
  const img = imgSel;
  if (!img || !imgTool || !document.contains(img)) {
    closeImgTool();
    return;
  }
  const box = img.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const toolbar = imgTool;
  const centred = box.left + box.width / 2 - toolbar.offsetWidth / 2;
  toolbar.style.left = Math.max(TOOLBAR_MARGIN, Math.min(centred, width - toolbar.offsetWidth - TOOLBAR_MARGIN)) + 'px';
  const above = box.top - toolbar.offsetHeight - TOOLBAR_MARGIN;
  toolbar.style.top = (above < TOOLBAR_MIN_TOP ? box.bottom + TOOLBAR_MARGIN : above) + 'px';
  placeResizeFrame(img, box);
}

function placeResizeFrame(img, box) {
  let frame = $('imgframe');
  if (!frame) {
    frame = mk('div');
    frame.id = 'imgframe';
    frame.innerHTML = '<span class="h bl" data-rs="-1"></span><span class="h br" data-rs="1"></span>';
    document.body.appendChild(frame);
    frame.addEventListener('mousedown', startImgResize);
  }
  Object.assign(frame.style, {
    left: box.left + 'px',
    top: box.top + 'px',
    width: box.width + 'px',
    height: box.height + 'px'
  });
  const line = (imgNode(img).parentElement || ed()).getBoundingClientRect().width || 1;
  frame.setAttribute('data-size', Math.round((box.width / line) * 100) + '%');
}

const onImageToolbarWindowScroll = () => {
  if (imgSel) placeImgTool();
};
const onImageToolbarWindowResize = () => {
  if (imgSel) placeImgTool();
};

export function imgChanged() {
  saveDocSoon();
  edChanged();
  setTimeout(drawImgTool, 0);
}

/* ---- the toolbar's buttons ---- */
const IMAGE_ACTIONS = [
  [action => action.indexOf('wrap:') === 0, (action, img) => setWrap(img, action.slice(5))],
  [action => action.indexOf('w:') === 0, (action, img) => setWidth(img, action.slice(2))],
  [action => action === 'crop', (action, img) => openCrop(img)],
  [action => action === 'uncrop', (action, img) => uncrop(img)],
  [action => action === 'del', (action, img) => deleteImage(img)],
  [action => action === 'nocap', (action, img) => removeCaption(img)],
  [action => action === 'cap', (action, img) => addCaption(img)]
];

function imgAct(action) {
  const img = imgSel;
  if (!img) return;
  const found = IMAGE_ACTIONS.find(([matches]) => matches(action));
  if (found) found[1](action, img);
}

/* in line, or wrapped left or right (a wrapped picture is at most half the width to start with) */
function setWrap(img, wrap) {
  if (wrap) img.setAttribute('data-wrap', wrap);
  else img.removeAttribute('data-wrap');
  if (wrap && !img.getAttribute('data-w')) img.setAttribute('data-w', WRAPPED_WIDTH);
  imgChanged();
}

/* full width is no width, for a picture in line */
function setWidth(img, width) {
  if (width === '100' && !img.getAttribute('data-wrap')) img.removeAttribute('data-w');
  else img.setAttribute('data-w', width);
  imgChanged();
}

function uncrop(img) {
  img.setAttribute('src', imgOrig.get(img));
  imgOrig.delete(img);
  imgChanged();
}

/* the picture (and its caption) goes, and the line it was on if that's left empty */
function deleteImage(img) {
  const node = imgNode(img);
  const parent = node.parentNode;
  node.remove();
  closeImgTool();
  if (parent && parent.tagName === 'P' && !parent.textContent.trim() && !parent.querySelector('img')) parent.remove();
  saveDocSoon();
  edChanged();
  toast('Image deleted');
}

function removeCaption(img) {
  imgNode(img).replaceWith(img);
  closeImgTool();
  saveDocSoon();
  edChanged();
}

/* a numbered caption under the picture, the caret in it */
function addCaption(img) {
  const figure = mk('figure');
  const caption = mk('figcaption');
  const host = img.parentNode;
  // a figure cannot sit inside a paragraph: take the paragraph's place, or follow it
  if (host && host !== ed() && host.tagName === 'P') {
    if (!host.textContent.trim() && host.querySelectorAll('img').length === 1) host.replaceWith(figure);
    else host.after(figure);
  } else img.before(figure);
  caption.innerHTML = '<br>';
  figure.append(img, caption);
  closeImgTool();
  ed().focus({ preventScroll: true });
  caretToStart(caption);
  saveDocSoon();
  edChanged();
}

export function initImageToolbar() {
  window.addEventListener('scroll', onImageToolbarWindowScroll, { passive: true });
  window.addEventListener('resize', onImageToolbarWindowResize);
}
