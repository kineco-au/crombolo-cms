/**
 * A site that takes its content by change (story 388): every page, media item and
 * Library item opens read-only, with a line saying where it is edited and, where the
 * site names that address, a link to the same item there. The server refuses the
 * writes too; this only says so before anyone types.
 */

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

/** The workspaces whose items arrive by change. */
export const LOCKED_WORKSPACES = [
  'Umb.Workspace.Document',
  'Umb.Workspace.Media',
  'Umb.Workspace.Element',
  // Story 392: changes carry these too.
  'Umb.Workspace.Dictionary',
  'Umb.Workspace.Language',
  'Umb.Workspace.DocumentBlueprint',
]

/** What the line says. */
export const LOCKED_LINE =
  'This site takes its content by change: it is edited where it is made, and arrives here when that change is applied.'

/**
 * The same item on the site where it is edited: this page's place in the back office,
 * under that site's back office address.
 */
export const editedHref = (editedAt, pathname, here = base()) => {
  if (!linkable(editedAt)) return undefined
  const path = pathname.startsWith(here) ? pathname.slice(here.length) : pathname
  return `${editedAt.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

/** Whether an address may be made a link: `http` or `https` only (story 412). */
export const linkable = (address) => {
  if (typeof address !== 'string' || !address) return false
  try {
    return ['http:', 'https:'].includes(new URL(address).protocol)
  } catch {
    return false
  }
}

/** What a locked site's refusal says where it names the address (story 412). */
export const editedAtLine = (editedAt) =>
  `This site's content is edited at ${editedAt}. Changes reach it from there.`

/**
 * The notice beside a refused save that names where content is edited, with a link to
 * the same item there (story 412); undefined for any other answer.
 */
export const lockedNotice = (status, body, pathname, here = base()) => {
  const editedAt = typeof body?.editedAt === 'string' ? body.editedAt : ''
  if (status !== 409 || !editedAt) return undefined
  return {
    headline: 'This is edited on another site',
    message: editedAtLine(editedAt),
    href: editedHref(editedAt, pathname, here),
  }
}

/** Where the site says its content is edited, once known. */
export const lockedState = { editedAt: null }

export const LOCKED_GUARD = {
  type: 'workspaceContext',
  alias: 'Crombolo.WorkspaceContext.ContentLocked',
  name: 'Crombolo Content Locked',
  api: () => import('./content-locked-guard.js'),
  conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', oneOf: LOCKED_WORKSPACES }],
}

export const LOCKED_INFO = {
  type: 'workspaceInfoApp',
  alias: 'Crombolo.WorkspaceInfoApp.ContentLocked',
  name: 'Crombolo Content Locked Info',
  element: () => import('./content-locked-info.js'),
  weight: 1000,
  conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', oneOf: LOCKED_WORKSPACES }],
}

export const onInit = async (_host, extensionRegistry) => {
  const response = await fetch(`${base()}/crombolo/api/workspaces/mine`, {
    credentials: 'include',
  }).catch(() => undefined)
  if (!response?.ok) return
  const { contentLocked, editedAt } = await response.json()
  if (!contentLocked) return
  lockedState.editedAt = editedAt ?? null
  extensionRegistry.register(LOCKED_GUARD)
  extensionRegistry.register(LOCKED_INFO)
  if (editedAt) await (await import('./content-locked-notice.js')).watchRefusals(_host)
}
