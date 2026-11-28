/**
 * The look of the dialogs this plugin opens on the page itself, outside any element's
 * shadow root, so they match the back office's own: its type, colours and buttons.
 */
const STYLE_ID = 'crombolo-dialog-styles'

const CSS = `
dialog.crombolo-dialog {
  width: min(40rem, calc(100vw - 2rem));
  max-height: calc(100vh - 4rem);
  padding: 0;
  border: 1px solid var(--uui-color-border, #d8d7d9);
  border-radius: var(--uui-border-radius, 3px);
  background: var(--uui-color-surface, #fff);
  color: var(--uui-color-text, #060606);
  box-shadow: var(--uui-shadow-depth-5, 0 10px 30px rgb(0 0 0 / 0.2));
  font-family: var(--uui-font-family, inherit);
  font-size: 14px;
  line-height: 1.5;
}
dialog.crombolo-dialog::backdrop { background: rgb(0 0 0 / 0.35); }
dialog.crombolo-dialog h4 { margin: var(--uui-size-space-5, 20px) 0 var(--uui-size-space-2, 6px); font-size: 15px; font-weight: 700; }
dialog.crombolo-dialog p { margin: 0 0 var(--uui-size-space-3, 12px); color: var(--uui-color-text-alt, #515054); }
dialog.crombolo-dialog ul { margin: 0 0 var(--uui-size-space-3, 12px); padding: 0; list-style: none; display: grid; gap: var(--uui-size-space-3, 12px); }
dialog.crombolo-dialog ul ul { margin: var(--uui-size-space-2, 6px) 0; padding-left: var(--uui-size-space-4, 16px); gap: var(--uui-size-space-1, 3px); color: var(--uui-color-text-alt, #515054); }
dialog.crombolo-dialog li > button { margin-top: var(--uui-size-space-2, 6px); }
dialog.crombolo-dialog label { display: flex; align-items: center; gap: var(--uui-size-space-2, 6px); margin: var(--uui-size-space-2, 6px) 0; }
dialog.crombolo-dialog input:not([type='checkbox']), dialog.crombolo-dialog textarea {
  font: inherit; min-width: 16rem; padding: 6px 10px;
  border: 1px solid var(--uui-color-border-standalone, #c2c2c2);
  border-radius: var(--uui-border-radius, 3px);
  background: var(--uui-color-surface, #fff); color: inherit;
}
dialog.crombolo-dialog textarea { flex: 1; resize: vertical; }
dialog.crombolo-dialog input[type='checkbox'] { accent-color: var(--uui-color-selected, #3544b1); }
dialog.crombolo-dialog button {
  font: inherit; font-weight: 700; padding: 6px 16px; margin-right: var(--uui-size-space-2, 6px); cursor: pointer;
  border: 1px solid var(--uui-color-border-standalone, #c2c2c2);
  border-radius: var(--uui-border-radius, 3px);
  background: var(--uui-color-surface, #fff); color: var(--uui-color-interactive, #1b264f);
}
dialog.crombolo-dialog button:hover:not(:disabled) { border-color: var(--uui-color-interactive-emphasis, #3544b1); color: var(--uui-color-interactive-emphasis, #3544b1); }
dialog.crombolo-dialog button:disabled { opacity: 0.5; cursor: default; }
dialog.crombolo-dialog button[data-primary] {
  border-color: transparent; background: var(--uui-color-positive, #0b8152); color: var(--uui-color-positive-contrast, #fff);
}
dialog.crombolo-dialog button[data-primary]:hover:not(:disabled) { background: var(--uui-color-positive-emphasis, #0a7148); color: var(--uui-color-positive-contrast, #fff); }
dialog.crombolo-connection-dialog { width: min(28rem, calc(100vw - 2rem)); }
dialog.crombolo-connection-dialog::backdrop { background: rgb(0 0 0 / 0.45); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
dialog.crombolo-connection-dialog .next { font-size: 13px; }
dialog.crombolo-workspace-dialog label { display: grid; grid-template-columns: 12rem minmax(0, 1fr); align-items: start; column-gap: var(--uui-size-space-4, 16px); }
dialog.crombolo-workspace-dialog label > span:first-child { padding-top: 7px; }
dialog.crombolo-workspace-dialog label > input, dialog.crombolo-workspace-dialog label > textarea { min-width: 0; width: 100%; box-sizing: border-box; }
dialog.crombolo-workspace-dialog label > [role='group'] { justify-self: start; }
dialog.crombolo-workspace-dialog .field { display: grid; grid-template-columns: 12rem minmax(0, 1fr); align-items: start; column-gap: var(--uui-size-space-4, 16px); }
dialog.crombolo-workspace-dialog .field > span:first-child { padding-top: 7px; }
dialog.crombolo-workspace-dialog .field .audience > [role='group'] { justify-self: start; }
`

/** Adds the dialogs' look to the page, once. */
export function useDialogStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.append(style)
}

/**
 * A dialog on the page itself, titled and laid out as every other is, and opened. `parts`
 * are its content; one with `slot="actions"` joins its buttons, after the one that closes
 * it, `closeLabel`.
 */
export function pageDialog(title, parts, className = '', closeLabel = 'Close') {
  useDialogStyles()
  const box = document.createElement('dialog')
  box.className = `crombolo-dialog ${className}`.trim()
  box.setAttribute('aria-label', title)
  const layout = document.createElement('uui-dialog-layout')
  layout.headline = title
  const close = document.createElement('button')
  close.type = 'button'
  close.slot = 'actions'
  close.textContent = closeLabel
  close.addEventListener('click', () => box.close())
  layout.append(close, ...parts)
  box.append(layout)
  box.addEventListener('close', () => box.remove())
  document.body.append(box)
  box.showModal()
  return box
}
