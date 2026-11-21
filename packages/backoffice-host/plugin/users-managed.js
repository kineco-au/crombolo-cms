/**
 * A site whose people come from a directory outside it (story 389): the Users section
 * keeps no way to add, invite, remove, disable, enable or unlock a person, or to change
 * their groups, and each person links to the directory where the site names it. A
 * person is saved here only when they are an API user. The server refuses the rest too.
 */

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

export const MANAGED_ENDPOINT = () => `${base()}/crombolo/api/users-managed`

/** The actions a directory's people have no use for here. */
export const MANAGED_HIDDEN = [
  'Umb.CollectionAction.User.Invite',
  'Umb.EntityAction.User.Invite',
  'Umb.EntityAction.User.ResendInvite',
  'Umb.EntityCreateOptionAction.User.Default',
  'Umb.EntityAction.User.Delete',
  'Umb.EntityAction.User.Disable',
  'Umb.EntityAction.User.Enable',
  'Umb.EntityAction.User.Unlock',
  'Umb.EntityAction.User.ChangePassword',
  'Umb.EntityAction.User.ConfigureMfa',
  'Umb.EntityBulkAction.User.Disable',
  'Umb.EntityBulkAction.User.Enable',
  'Umb.EntityBulkAction.User.Unlock',
  'Umb.EntityBulkAction.User.SetGroup',
  'Umb.WorkspaceAction.User.Save',
]

export const API_USER_CONDITION = {
  type: 'condition',
  alias: 'Crombolo.Condition.User.IsApiUser',
  name: 'Crombolo User Is An API User',
  api: () => import('./users-managed-condition.js'),
}

/** Save, for an API user only: they stay the site's own. */
export const API_USER_SAVE = {
  type: 'workspaceAction',
  kind: 'default',
  alias: 'Crombolo.WorkspaceAction.User.Save',
  name: 'Crombolo Save API User',
  weight: 90,
  api: () => import('./users-managed-save.js'),
  meta: { label: '#buttons_save', look: 'primary', color: 'positive' },
  conditions: [
    { alias: 'Umb.Condition.WorkspaceAlias', match: 'Umb.Workspace.User' },
    { alias: API_USER_CONDITION.alias },
  ],
}

export const OPEN_IN_DIRECTORY = {
  type: 'entityAction',
  kind: 'default',
  alias: 'Crombolo.EntityAction.User.OpenInDirectory',
  name: 'Crombolo Open User In Directory',
  forEntityTypes: ['user'],
  weight: 1100,
  api: () => import('./users-managed-action.js'),
  meta: { icon: 'icon-out', label: 'Open where this person is managed' },
}

/** Where the directory keeps this person, or null. */
export async function directoryHref(key, fetcher = fetch) {
  const response = await fetcher(`${MANAGED_ENDPOINT()}?user=${encodeURIComponent(key)}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  }).catch(() => undefined)
  if (!response?.ok) return null
  const { href } = await response.json().catch(() => ({}))
  return typeof href === 'string' ? href : null
}

/** What the Users section becomes on a site whose people the directory keeps. */
export function applyManaged(extensionRegistry, { managed, linked }) {
  if (!managed) return false
  for (const alias of MANAGED_HIDDEN) extensionRegistry.exclude(alias)
  extensionRegistry.register(API_USER_CONDITION)
  extensionRegistry.register(API_USER_SAVE)
  if (linked) extensionRegistry.register(OPEN_IN_DIRECTORY)
  return true
}

export const onInit = async (_host, extensionRegistry) => {
  const response = await fetch(MANAGED_ENDPOINT(), { credentials: 'include' }).catch(
    () => undefined,
  )
  if (!response?.ok) return
  applyManaged(extensionRegistry, await response.json())
}
