const VIEW_FOR_KEY = Object.freeze({
  w: 'week',
  s: 'symptoms',
  m: 'meds',
  h: 'handoff',
});

const INTERACTIVE = 'input, button, select, textarea, a[href], [contenteditable], ' +
  '[role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="listbox"]';

// Maps a keydown event to a workbench name, or null when the keystroke should
// do nothing: shortcuts off, a modifier held, a held-down or IME-composed key,
// a non-letter key, or focus sitting inside anything interactive.
export function shortcutFor(event, enabled) {
  if (!enabled || event.repeat || event.isComposing) return null;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (typeof event.key !== 'string' || event.key.length !== 1) return null;
  const view = VIEW_FOR_KEY[event.key.toLowerCase()];
  if (!view) return null;
  const target = event.target;
  if (target && (target.isContentEditable ||
      (typeof target.closest === 'function' && target.closest(INTERACTIVE)))) {
    return null;
  }
  return view;
}
