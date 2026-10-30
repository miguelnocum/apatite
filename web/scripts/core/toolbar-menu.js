/* ===== the toolbar menu that's open (see editor/toolbar-menus.js) ===== */
export let tbMenu = null;
export function setTbMenu(value) {
  tbMenu = value;
  return value;
}

export function closeTbMenu() {
  if (!tbMenu) return;
  if (tbMenu.sub) tbMenu.sub.remove();
  tbMenu.remove();
  setTbMenu(null);
}
