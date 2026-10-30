/* ===== the toolbar menu that's open (see editor/toolbar-menus.js) ===== */
export let toolbarMenu = null;
export function setToolbarMenu(value) {
  toolbarMenu = value;
  return value;
}

export function closeToolbarMenu() {
  if (!toolbarMenu) return;
  if (toolbarMenu.sub) toolbarMenu.sub.remove();
  toolbarMenu.remove();
  setToolbarMenu(null);
}
