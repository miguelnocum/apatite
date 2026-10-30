import { ed } from '../editor/notes-document.js';
import { closeFn, fnPop, openFn } from '../editor/footnotes.js';
import { closeImgTool, imgTool, openImgTool } from './image-toolbar.js';

/* ===== clicks in the notes on footnotes and pictures; anything else closes their popups ===== */
const onNoteClicksClick = e => {
  const target = e.target;
  const marker = target.closest && target.closest('#ed .fn');
  const listed = !marker && target.closest && target.closest('#fnlist li');
  const picture = !marker && !listed && target.closest && target.closest('#ed img');
  if (marker) {
    e.preventDefault();
    openFn(marker);
  } else if (listed) openListedFootnote(listed);
  else if (picture) openImgTool(picture);
  else {
    if (fnPop && !target.closest('.fnpop')) closeFn();
    if (imgTool && !target.closest('.imgbar,#imgframe,#cropper')) closeImgTool();
  }
};

/* a footnote in the list at the end: its marker in the text, scrolled to and opened */
function openListedFootnote(item) {
  const marker = ed().querySelectorAll('.fn')[+item.dataset.fni];
  if (!marker) return;
  marker.scrollIntoView({ block: 'center' });
  openFn(marker);
}

/* pictures aren't dragged out as files (Move moves them) */
const onNoteClicksDragstart = e => {
  if (e.target.closest && e.target.closest('#ed img')) e.preventDefault();
};

export function initNoteClicks() {
  document.addEventListener('click', onNoteClicksClick);
  document.addEventListener('dragstart', onNoteClicksDragstart, true);
}
