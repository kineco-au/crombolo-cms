/**
 * Viewing the back office as user groups (story 314): "View as a group…" in an
 * administrator's user menu opens a panel to choose them, and while it is on a
 * banner across the top says so, with Switch back. The server keeps it on this
 * session at <backoffice>/crombolo/api/view-as and decides what it allows.
 */

export const VIEW_AS_MODAL = 'Crombolo.Modal.ViewAs'

const endpoint = () =>
  `${(document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')}/crombolo/api/view-as`

const call = async (method, body) => {
  const response = await fetch(endpoint(), {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(answer.message ?? 'That did not work. Try again.')
  return answer
}

/** Whether this session is viewing as groups, whether it may, and the groups to choose from. */
export const readViewAs = () => call('GET')

/** Starts viewing as the groups with these keys. */
export const startViewAs = (groups) => call('POST', { groups })

/** Switches back to the person's own rights. */
export const stopViewAs = () => call('DELETE')

/** Reloads the back office, so its sections, trees and actions are fetched again. */
export const reloadBackOffice = () => window.location.reload()

export const VIEW_AS_ACTION = {
  type: 'currentUserAction',
  kind: 'default',
  alias: 'Crombolo.CurrentUser.Button.ViewAs',
  name: 'Crombolo View As A Group',
  weight: 800,
  api: () => import('./view-as-action.js'),
  meta: { label: 'View as a group…', icon: 'icon-users' },
  conditions: [{ alias: 'Umb.Condition.CurrentUser.IsAdmin' }],
}

export const VIEW_AS_PANEL = {
  type: 'modal',
  alias: VIEW_AS_MODAL,
  name: 'Crombolo View As A Group Panel',
  element: () => import('./view-as-modal.js'),
}

/** Puts the banner above the back office, which moves down to make room. */
async function showBanner(viewing) {
  await import('./view-as-banner.js')
  if (document.querySelector('crombolo-view-as-banner')) return
  const banner = document.createElement('crombolo-view-as-banner')
  banner.viewing = viewing
  document.body.prepend(banner)
  const style = document.createElement('style')
  style.id = 'crombolo-view-as-room'
  style.textContent = `umb-app { display: block; position: fixed; inset: var(--crombolo-view-as-height, 40px) 0 0 0; }`
  document.head.append(style)
}

export const onInit = async (_host, extensionRegistry) => {
  extensionRegistry.register(VIEW_AS_ACTION)
  extensionRegistry.register(VIEW_AS_PANEL)
  try {
    const status = await readViewAs()
    if (status.viewing) await showBanner(status.viewing)
  } catch {
    // Not signed in yet, or the server cannot say; nothing to show.
  }
}
