/**
 * What the Workspaces place shares between its list, in the sidebar, and what it shows
 * beside it. Which workspace is chosen, and whether it is being merged, are in the
 * address (`?workspace=<key>&view=merge`), so Back, a reload and a link all come to the
 * same view.
 */
import { WORKSPACES } from './content-strip-items.js'
import { tellWorkspacesChanged } from './workspace-client.js'

const listeners = new Set()

const tell = (what) => {
  for (const listener of listeners) listener(what)
}

/** The key of the workspace the address names, `shared` for Shared; none until one is. */
export const chosenWorkspace = () =>
  new URLSearchParams(location.search).get('workspace') ?? undefined

/** What is shown of it: `merge`, or what it is. */
export const chosenView = () =>
  new URLSearchParams(location.search).get('view') === 'merge' ? 'merge' : 'info'

/**
 * Shows a workspace, or its merge, at Workspaces; the tab stays in the workspace it is
 * in. `replace` keeps the step out of the history, for the one first shown.
 */
export function showWorkspace(key, view = 'info', replace = false) {
  const to = new URL(WORKSPACES.path, document.baseURI)
  to.searchParams.set('workspace', key)
  if (view === 'merge') to.searchParams.set('view', 'merge')
  const address = `${to.pathname}${to.search}`
  if (`${location.pathname}${location.search}` !== address)
    history[replace ? 'replaceState' : 'pushState'](null, '', address)
  tell('chosen')
}

/** Says a workspace was opened, renamed, deleted or otherwise changed, so the list reads again. */
export function workspacesChanged() {
  tell('changed')
  tellWorkspacesChanged()
}

/** Calls `listener` with `chosen` or `changed`; answers how to stop. */
export function watchWorkspaces(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

window.addEventListener('popstate', () => tell('chosen'))
