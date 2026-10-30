/* ===== the equation editor, part 1: the typing boxes (MathLive) and how they look =====
   Each line of a block equation is its own box; Return adds a line. Without MathLive (the web version) it's the LaTeX text box. */
const EQ_BOXES = !!(window.MathfieldElement && window.customElements && customElements.get('math-field'));
if (EQ_BOXES) {
  try {
    MathfieldElement.soundsDirectory = null;
    MathfieldElement.plonkSound = null;
    MathfieldElement.keypressSound = null;
  } catch (x) {}
}

/* the empty boxes: a square that centres under an accent, drawn light and a little larger, as in Word
   (MathLive gives them no class of its own, so they're found by their character as it draws them) */
const EMPTY_BOX_CHAR = '□';
const EMPTY_BOX_ONLY = /^\\placeholder(\[[^\]]*\])?\{\}$/;

/* styles added inside each box (MathLive draws in its own shadow DOM, out of reach of the page's styles) */
const MATH_FIELD_STYLE = [
  '.apbox{position:relative;color:transparent!important;display:inline-block;min-width:.72em;height:.95em;margin:0 .06em;' +
    'vertical-align:-.16em;border-radius:.16em;background:var(--box-fill,rgba(128,140,160,.22))}',
  /* the box you're in: a little stronger, with the usual blinking caret in it (MathLive selects the box, so typing replaces it) */
  ':host(:focus-within) .apbox.ML__selected,:host(:focus-within) .ML__selected .apbox{background:var(--box-on,rgba(110,90,220,.3))}',
  ':host(:focus-within) .apbox.ML__selected::after,:host(:focus-within) .ML__selected .apbox::after{content:"";position:absolute;' +
    'left:.16em;top:.12em;bottom:.12em;width:1.5px;border-radius:1px;background:var(--caret-color,#5b4bd6);' +
    'animation:ML__caret-blink 1.05s step-end infinite}',
  /* a selection: MathLive draws a rectangle per piece, over the maths and see-through, so overlaps go darker.
     Drawn solid and behind the maths instead, the pieces merge into one even shape */
  '.ML__content{isolation:isolate}',
  '::selection{background:transparent!important}',
  ':host(:focus) .ML__selection.ML__selection{background:var(--sel-solid,#d9d3f5)!important;z-index:-1;border-radius:3px}',
  ':host(.apon) .ML__selection.ML__selection{background:transparent!important}',
  /* nor MathLive's tint over the group the caret is in (it reads as a stray selection) */
  '.ML__contains-highlight.ML__contains-highlight{background:transparent!important;box-shadow:none!important}',
  /* nor its colouring of the brackets around the caret (it flashed as a selection came and went) */
  '.ML__contains-caret.ML__close,.ML__contains-caret.ML__open,.ML__contains-caret>.ML__close,.ML__contains-caret>.ML__open,' +
    '.ML__contains-caret .ML__sqrt-sign,.ML__contains-caret .ML__sqrt-line{color:inherit!important}'
].join('');

/* selection pieces closer than this are joined into one band */
const BAND_JOIN_GAP = 8;
const BAND_RADIUS = '4px';

/* the box's styles, the shaded empty boxes, and its selection drawn as one band */
function styleMathField(field) {
  const root = field.shadowRoot;
  if (!root) return;
  const style = document.createElement('style');
  style.textContent = MATH_FIELD_STYLE;
  root.appendChild(style);
  /* in an empty box, its own shading and caret show where you are, not a selection rectangle */
  field.addEventListener('selection-change', () => field.classList.toggle('apon', isInEmptyBox(field)));
  new MutationObserver(() => {
    markEmptyBoxes(root);
    joinSelectionPieces(root);
  }).observe(root, { childList: true, subtree: true });
  markEmptyBoxes(root);
}

function isInEmptyBox(field) {
  try {
    return EMPTY_BOX_ONLY.test((field.getValue(field.selection, 'latex') || '').trim());
  } catch (x) {
    return false;
  }
}

function markEmptyBoxes(root) {
  root.querySelectorAll('span').forEach(span => {
    const isBox = !span.firstElementChild && span.textContent === EMPTY_BOX_CHAR;
    if (isBox && !span.classList.contains('apbox')) span.classList.add('apbox');
  });
}

/* MathLive draws a selection as a rectangle per piece, each its own height (θ, then its ₁₀ lower down): the pieces on a line
   are given the line's full height and closed up into one band, before anything is painted */
function joinSelectionPieces(root) {
  const pieces = [...root.querySelectorAll('.ML__selection')];
  if (pieces.length < 2) return;
  selectionRows(pieces).forEach(shapeSelectionRow);
}

/* the pieces grouped into rows: pieces that overlap vertically are on the same row */
function selectionRows(pieces) {
  const rows = [];
  pieces.forEach(el => {
    const top = parseFloat(el.style.top);
    const bottom = top + parseFloat(el.style.height);
    const left = parseFloat(el.style.left);
    let row = rows.find(r => top < r.bottom && bottom > r.top);
    if (!row) {
      row = { top: top, bottom: bottom, pieces: [] };
      rows.push(row);
    }
    row.top = Math.min(row.top, top);
    row.bottom = Math.max(row.bottom, bottom);
    row.pieces.push({ el: el, left: left, right: left + parseFloat(el.style.width) });
  });
  return rows;
}

/* one row's pieces: the row's height, stretched to meet the next piece, rounded only at the band's ends */
function shapeSelectionRow(row) {
  row.pieces.sort((a, b) => a.left - b.left);
  row.pieces.forEach((piece, i) => {
    const next = row.pieces[i + 1];
    const right = next && next.left - piece.right < BAND_JOIN_GAP ? next.left : piece.right;
    const startsBand = i === 0 || row.pieces[i - 1].right < piece.left - BAND_JOIN_GAP;
    const endsBand = right === piece.right;
    const style = piece.el.style;
    style.top = row.top + 'px';
    style.height = row.bottom - row.top + 'px';
    style.width = right - piece.left + 'px';
    style.borderRadius = bandCorners(startsBand, endsBand);
  });
}

function bandCorners(startsBand, endsBand) {
  const start = startsBand ? BAND_RADIUS : '0';
  const end = endsBand ? BAND_RADIUS : '0';
  return start + ' ' + end + ' ' + end + ' ' + start;
}
