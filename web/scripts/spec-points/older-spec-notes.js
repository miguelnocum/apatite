import { KEY } from '../core/example-data.js';
import { lvl } from '../syllabus/point-levels.js';
import { Store } from '../core/storage.js';
import { mk } from '../editor/paste-cleaning.js';
import { ed, ptById, saveDocNow } from '../editor/notes-document.js';
import { spShort } from './spec-point-tags.js';

/* ===== older notes: spec points were headings in the text; they become tags on the notes under them ===== */
const OLD_SPEC_MARKUP = /data-sec=|<h3 data-pt=|data-pick=/;

function isOldSpecHeading(node) {
  return (
    node &&
    /^H[23]$/.test(node.tagName) &&
    (node.hasAttribute('data-sec') || node.hasAttribute('data-pt') || node.hasAttribute('data-pick'))
  );
}

/* the notes as tags, or null when there's nothing to convert */
export function convertSpecHeadings(html) {
  if (!html || !OLD_SPEC_MARKUP.test(html)) return null;
  const box = mk('div');
  box.innerHTML = html;
  let current = null;
  [...box.children].forEach(block => {
    if (block.tagName === 'H2' && isOldSpecHeading(block)) {
      current = null;
      block.remove();
    } else if (block.tagName === 'H3' && isOldSpecHeading(block)) current = convertPointHeading(block);
    else if (current && block.id !== 'fnlist' && !block.getAttribute('data-sp')) block.setAttribute('data-sp', current);
  });
  if (!box.firstElementChild) box.innerHTML = '<p><br></p>';
  return box.innerHTML;
}

/* a point's heading with notes under it becomes a short tagged heading (the point the notes after it are tagged
   with); one with nothing under it goes */
function convertPointHeading(heading) {
  const point = ptById(heading.getAttribute('data-pt'));
  if (!(point && hasNotesUnder(heading))) {
    heading.remove();
    return null;
  }
  const short = mk(lvl(point) === 3 ? 'h3' : 'h2');
  short.textContent = point.code || spShort(point.text);
  short.setAttribute('data-sp', point.id);
  if (heading.hasAttribute('data-fold')) short.setAttribute('data-fold', '');
  heading.replaceWith(short);
  return point.id;
}

function hasNotesUnder(heading) {
  for (let node = heading.nextElementSibling; node && !isOldSpecHeading(node); node = node.nextElementSibling) {
    if (node.textContent.trim() || node.querySelector('img,table') || /^(TABLE|HR|FIGURE)$/.test(node.tagName))
      return true;
  }
  return false;
}

/* leaving the page saves the notes, and whether the example syllabus is showing */
const onOlderSpecNotesWindowPagehide = () => {
  try {
    if (ed()) saveDocNow();
  } catch (e) {}
  try {
    localStorage.setItem(KEY + '-ex', Store.example ? '1' : '0');
  } catch (e) {}
};

export function initOlderSpecNotes() {
  window.addEventListener('pagehide', onOlderSpecNotesWindowPagehide);
}
