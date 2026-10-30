import { on } from '../core/channel.js';
import { renderEssaySide } from '../essays/essays.js';
import { ccSoon } from '../citations/citation-check.js';
import { followEdit } from '../images/image-toolbar.js';
import { wordCountAfterEdit } from '../essays/word-count-sidebar.js';
import { renderMath } from '../equations/equation-drawing.js';
import { renderIMath } from '../equations/inline-equations.js';
import { drawSp } from '../spec-points/spec-point-tags.js';
import { redrawSpPanel } from '../spec-points/spec-point-panel.js';

/* ===== who listens to what the editor reports (see core/channel.js) =====
   Listeners of one event run in the order written here, which is the order the editor used to call them in. */
export function initWiring() {
  on('essay-saved', renderEssaySide);
  on('notes-edited', followEdit);
  on('notes-edited', ccSoon);
  on('footnotes-redrawn', wordCountAfterEdit);
  on('folds-applied', drawSp);
  on('contents-redrawn', redrawSpPanel);
  on('callouts-upgraded', renderMath);
  on('callouts-upgraded', renderIMath);
}
