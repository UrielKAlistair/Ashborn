// Whether a single-key shortcut on the page leaves a key alone: typed into a field, or pressed while a
// dialog covers the page (the keys list, a question), whose keys aren't meant for what lies behind it
export function keyNotForPage(event: KeyboardEvent) {
  if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return true;
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}
