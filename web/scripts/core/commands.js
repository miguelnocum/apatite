import { emit } from './channel.js';

/* ===== a toolbar command (bold, a heading, insert a table...) is run by the editor; anything may ask for one ===== */
export function cmd(command) {
  emit('command', command);
}
