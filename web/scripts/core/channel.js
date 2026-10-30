/* ===== the page's event channel: the editor says what just happened, the features that care are told ===== */
/* emit() calls the listeners of that event right there, one after another, in the order they were added with on();
   nothing is deferred or skipped, so it behaves like the direct calls it replaces. Who listens, and in which order, is
   written in one place: app/wiring.js. The events (what the editor says, when):
     command            a toolbar command was asked for (core/commands.js); the one listener runs it
     notes-edited       the moment the notes were edited (edChanged)
     footnotes-redrawn  a moment after an edit, once the footnotes are redrawn
     folds-applied      the folds are in place (after an edit, and when the notes are first laid out)
     contents-redrawn   a moment after an edit, once the contents, folds and caret places are redrawn
     essay-saved        an essay's text was just saved (saveDocNow)
     callouts-upgraded  the notes (or an essay) being shown have their callouts upgraded; the root is passed */
const listeners = new Map();

export function on(event, listener) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(listener);
}

export function emit(event, ...args) {
  for (const listener of listeners.get(event) || []) listener(...args);
}
