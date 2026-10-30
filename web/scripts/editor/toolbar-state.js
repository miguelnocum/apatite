import { $, uiState } from '../core/helpers-and-state.js';
import { closestTag, inEd } from '../core/caret.js';
import { keyOf } from './highlight-colours.js';

/* ===== the toolbar shows where the caret is ===== */
/* buttons light up for what the caret is in: a heading, a list, bold, italic, a highlight; the highlighter shows its colour */
export function updateToolbarState() {
  const inEditor = inEd();
  const light = (id, on) => {
    const button = document.getElementById(id);
    if (button) button.classList.toggle('on', !!(inEditor && on));
  };
  light('tb-head', closestTag('h1,h2,h3,h4,h5,h6'));
  light('tb-list', closestTag('ol,ul,blockquote,[data-callout]'));
  light('tb-b', commandState('bold'));
  light('tb-i', commandState('italic'));
  light('tb-hl', closestTag('mark'));
  const colour = keyOf(uiState.hlColor);
  const swatch = $('hlsw');
  if (swatch) swatch.style.background = colour ? colour.hex : 'var(--h1)';
  const highlighter = $('tb-hl');
  if (highlighter) highlighter.title = 'Highlight' + (colour && colour.meaning ? ': ' + colour.meaning : '');
}

function commandState(name) {
  try {
    return document.queryCommandState(name);
  } catch (e) {
    return false;
  }
}
