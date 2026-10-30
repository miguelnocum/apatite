import { $ } from '../core/helpers-and-state.js';
import { mk } from '../core/paste-cleaning.js';
import { drawImgTool, imgChanged, imgOrig, imgTool } from './image-toolbar.js';
import { dragWithMouse } from './image-resize-move.js';

/* ===== crop: drag the frame's edges and corners, then Done (or Return; Escape or a click elsewhere cancels). The
   frame follows the picture as the notes scroll or the window changes ===== */
const CROP_MIN = 24; // px the crop frame is at least, each way
const CROP_JPEG_QUALITY = 0.92;
let cropping = null; // the cropper open, if one is
const CROP_HTML =
  '<div class="cbox"><span data-c="n"></span><span data-c="s"></span><span data-c="e"></span><span data-c="w"></span>' +
  '<span data-c="nw"></span><span data-c="ne"></span><span data-c="sw"></span><span data-c="se"></span></div>' +
  '<div class="cbar"><button data-cr="cancel">Cancel</button><button data-cr="done" class="pri">Done</button></div>';

class Cropper {
  constructor(img) {
    this.img = img;
    this.rect = img.getBoundingClientRect();
    this.box = { x: 0, y: 0, w: this.rect.width, h: this.rect.height };
    this.el = mk('div');
    this.el.id = 'cropper';
    this.el.innerHTML = CROP_HTML;
    this.frame = this.el.querySelector('.cbox');
    this.follow = () => this.place();
    this.onKey = e => this.key(e);
  }

  /* over the picture, the image toolbar and resize frame out of the way */
  open() {
    if (cropping) cropping.close();
    cropping = this;
    document.body.appendChild(this.el);
    if (imgTool) imgTool.style.visibility = 'hidden';
    const resizeFrame = $('imgframe');
    if (resizeFrame) resizeFrame.style.display = 'none';
    this.place();
    this.el.addEventListener('mousedown', e => this.startDrag(e));
    this.el.addEventListener('click', e => this.onClick(e));
    window.addEventListener('scroll', this.follow, true); // (any scrolling, the page's or a pane's)
    window.addEventListener('resize', this.follow);
    document.addEventListener('keydown', this.onKey, true);
  }

  /* over the picture where it is now; if it's been drawn at another size, the frame keeps the same part of it */
  place() {
    if (!this.img.isConnected) {
      this.close();
      return;
    }
    const rect = this.img.getBoundingClientRect();
    const scale = rect.width / (this.rect.width || 1);
    if (Math.abs(scale - 1) > 0.001) ['x', 'y', 'w', 'h'].forEach(side => (this.box[side] *= scale));
    this.rect = rect;
    const { left, top, width, height } = rect;
    Object.assign(this.el.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
    this.draw();
  }

  /* Return crops, Escape cancels */
  key(e) {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.finish(e.key === 'Enter');
  }

  /* gone, with nothing of it left behind, and the picture's toolbar and resize frame back */
  close() {
    this.el.remove();
    window.removeEventListener('scroll', this.follow, true);
    window.removeEventListener('resize', this.follow);
    document.removeEventListener('keydown', this.onKey, true);
    if (cropping === this) cropping = null;
    if (imgTool) imgTool.style.visibility = '';
    const resizeFrame = $('imgframe');
    if (resizeFrame) resizeFrame.style.display = '';
  }

  draw() {
    const { x, y, w, h } = this.box;
    Object.assign(this.frame.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  }

  /* an edge or corner moves those sides; inside the frame moves all of it */
  startDrag(e) {
    const handle = e.target.closest('[data-c]');
    if (!handle && !e.target.closest('.cbox')) return;
    e.preventDefault();
    const sides = handle ? handle.dataset.c : 'all';
    const start = { x: e.clientX, y: e.clientY, box: Object.assign({}, this.box) };
    dragWithMouse(
      move => {
        this.dragTo(sides, move.clientX - start.x, move.clientY - start.y, start.box);
        this.draw();
      },
      () => {}
    );
  }

  dragTo(sides, dx, dy, from) {
    const box = this.box;
    const { width, height } = this.rect;
    if (sides === 'all') {
      box.x = Math.max(0, Math.min(width - from.w, from.x + dx));
      box.y = Math.max(0, Math.min(height - from.h, from.y + dy));
      return;
    }
    if (sides.indexOf('w') >= 0) [box.x, box.w] = movedStart(from.x, from.w, dx);
    if (sides.indexOf('e') >= 0) box.w = Math.max(CROP_MIN, Math.min(width - from.x, from.w + dx));
    if (sides.indexOf('n') >= 0) [box.y, box.h] = movedStart(from.y, from.h, dy);
    if (sides.indexOf('s') >= 0) box.h = Math.max(CROP_MIN, Math.min(height - from.y, from.h + dy));
  }

  /* Done crops (when the frame is smaller than the picture); either button closes */
  onClick(e) {
    const button = e.target.closest('[data-cr]');
    if (button) this.finish(button.dataset.cr === 'done');
  }

  finish(done) {
    this.close();
    const smaller = this.box.w < this.rect.width - 1 || this.box.h < this.rect.height - 1;
    if (done && smaller) this.crop();
    else drawImgTool();
  }

  /* the picture redrawn from the framed part, at its own resolution (the original kept, to reset to) */
  crop() {
    const { img, box, rect } = this;
    const scaleX = img.naturalWidth / rect.width;
    const toNaturalY = y => (y * img.naturalHeight) / rect.height;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(box.w * scaleX);
    canvas.height = Math.round(toNaturalY(box.h));
    const source = [box.x * scaleX, toNaturalY(box.y), box.w * scaleX, toNaturalY(box.h)];
    canvas.getContext('2d').drawImage(img, ...source, 0, 0, canvas.width, canvas.height);
    if (!imgOrig.has(img)) imgOrig.set(img, img.getAttribute('src'));
    const jpeg = /^data:image\/jpe?g/.test(img.getAttribute('src'));
    img.setAttribute('src', canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', CROP_JPEG_QUALITY));
    img.onload = () => {
      img.onload = null;
      imgChanged();
    };
  }
}

/* the left (or top) side moved: the new start and size, the far side staying where it was */
function movedStart(start, size, delta) {
  const moved = Math.max(0, Math.min(start + size - CROP_MIN, start + delta));
  return [moved, size + (start - moved)];
}

export function openCrop(img) {
  new Cropper(img).open();
}

/* cropping stops, without cropping (a click elsewhere, the picture's toolbar closing) */
export function cancelCrop() {
  if (cropping) cropping.close();
}
