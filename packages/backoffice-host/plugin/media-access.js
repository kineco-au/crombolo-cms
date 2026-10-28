/**
 * "Permissions" on media folders and items (story 196): which member groups
 * may see and change them, and what files added to a folder later get. The
 * server keeps them at <backoffice>/crombolo/api/media-access/{key}, and
 * refuses what the user may not do whatever this shows. docs/media.md.
 */

export const MEDIA_ACCESS_MODAL = 'Crombolo.Modal.MediaAccess'

const base = () =>
  `${(document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')}/crombolo/api/media-access`

/** The permissions of a folder or item, as the dialog shows them. */
export const readMediaAccess = async (key) => {
  const response = await fetch(`${base()}/${encodeURIComponent(key)}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(problemFor(response.status))
  return response.json()
}

/** Sets them; answers the new state, or throws what went wrong. */
export const saveMediaAccess = async (key, body) => {
  const response = await fetch(`${base()}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(answer.reason ?? problemFor(response.status))
  return answer
}

export const problemFor = (status) =>
  status === 403
    ? 'You do not have permission to change who can see this.'
    : status === 404
      ? 'This media item could not be found.'
      : 'The permissions could not be loaded. Try again.'

export const NEW_READ_CHOICES = [
  { value: null, label: 'As this folder says' },
  { value: 'public', label: 'Anyone with the link' },
  { value: 'groups', label: 'Members of the groups that can see this folder' },
  { value: 'creator', label: 'Only the member who added it' },
]

export const NEW_WRITE_CHOICES = [
  { value: null, label: 'As this folder says' },
  { value: 'groups', label: 'Members of the groups that can change this folder' },
  { value: 'creator', label: 'Only the member who added it' },
  { value: 'none', label: 'No member' },
]

export const FILE_READ_CHOICES = [
  { value: 'inherit', label: 'As its folder says' },
  { value: 'public', label: 'Anyone with the link' },
  { value: 'groups', label: 'Members of the groups that can see it' },
  { value: 'creator', label: 'Only the member who added it' },
  { value: 'none', label: 'No member' },
]

export const FILE_WRITE_CHOICES = [
  { value: 'inherit', label: 'As its folder says' },
  { value: 'groups', label: 'Members of the groups that can change it' },
  { value: 'creator', label: 'Only the member who added it' },
  { value: 'none', label: 'No member' },
]

export const PUBLIC_WARNING =
  'Anyone who has the link can open these files, without signing in, and can pass the link on.'

/** One line saying who can see a folder or file. */
export function summarise(state) {
  if (!state) return ''
  if (!state.protected) return 'Anyone with the link can see this.'
  return 'Only the members chosen here, and editors who can open it in Media, can see this.'
}

/**
 * The groups a rule shows: every member group on the site, ticked as the rule
 * says, and any the rule names that no longer exists.
 */
export function groupRows(rule, memberGroups) {
  const named = new Map((rule?.groups ?? []).map((g) => [g.name.toLowerCase(), g]))
  const rows = memberGroups.map((name) => {
    const set = named.get(name.toLowerCase())
    return { name, read: set?.read ?? false, write: set?.write ?? false }
  })
  for (const g of rule?.groups ?? [])
    if (!memberGroups.some((name) => name.toLowerCase() === g.name.toLowerCase())) rows.push(g)
  return rows
}

/** Megabytes as the dialog shows a size limit; empty for none. */
export const megabytesOf = (bytes) =>
  bytes ? String(Math.round((bytes / (1024 * 1024)) * 100) / 100) : ''

/** A size limit typed in megabytes, as bytes; null when empty or not a size. */
export const bytesOf = (megabytes) => {
  const value = Number(String(megabytes ?? '').trim())
  return String(megabytes ?? '').trim() !== '' && Number.isFinite(value) && value > 0
    ? Math.round(value * 1024 * 1024)
    : null
}

/** What the dialog sends: the rule (null to follow the folder above) and a file's own setting. */
export function requestFor(form) {
  return {
    rule: form.own
      ? {
          publicRead: form.own.publicRead,
          groups: form.own.groups.filter((g) => g.read || g.write),
          newRead: form.own.newRead ?? null,
          newWrite: form.own.newWrite ?? null,
          memberTypes: form.own.memberTypes ?? [],
          memberMaxBytes: form.own.memberMaxBytes ?? null,
        }
      : null,
    ...(form.hasFile
      ? { item: { readPolicy: form.item.readPolicy, writePolicy: form.item.writePolicy } }
      : {}),
  }
}

/** Says which site features use a folder, in a sentence. */
export const usedByText = (bundles) =>
  bundles?.length ? `Used by ${bundles.join(', ')} to store members' files.` : ''

const MEDIA_WRITE = /\/management\/api\/v1\/media\/([0-9a-f-]{36})(\/move|\/move-to-recycle-bin)?$/i

/**
 * The warning to show before a request renames, moves or deletes a folder a
 * site feature uses by its name and place (story 198); undefined for anything
 * else. `used` is what `<backoffice>/crombolo/api/media-access/used` lists.
 */
export function bundleWarningFor(method, url, body, used) {
  const path = new URL(url, 'http://local').pathname
  const match = MEDIA_WRITE.exec(path)
  if (!match) return undefined
  const folder = used.find((entry) => entry.key.toLowerCase() === match[1].toLowerCase())
  if (!folder || folder.bundles.length === 0) return undefined
  const verb = method.toUpperCase()
  let doing
  if (verb === 'DELETE' || match[2] === '/move-to-recycle-bin') doing = 'delete'
  else if (match[2] === '/move') doing = 'move'
  else if (verb === 'PUT') {
    const names = (body?.variants ?? []).map((v) =>
      String(v?.name ?? '')
        .trim()
        .toLowerCase(),
    )
    if (names.length === 0 || names.every((name) => name === folder.name.trim().toLowerCase()))
      return undefined
    doing = 'rename'
  } else return undefined
  const who = folder.bundles.join(' and ')
  return {
    headline: `${doing[0].toUpperCase()}${doing.slice(1)} ${folder.name}?`,
    content: `${who} finds this folder by its name and place to store members' files. If you ${doing} it, members can no longer add files through ${who}, and the site will not start again until ${who} is set up for the new folder.`,
    confirmLabel: `${doing[0].toUpperCase()}${doing.slice(1)} anyway`,
  }
}

/** The folders site features use, for the warning above; none when they cannot be read. */
export const readUsedFolders = async () => {
  const response = await fetch(`${base()}/used`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  }).catch(() => undefined)
  return response?.ok ? response.json() : []
}

/**
 * Asks before a rename, move or delete of a folder a site feature uses. A
 * request the user cancels is aborted, as a closed dialog is.
 */
export async function confirmFolderChange(host, request, confirm) {
  if (request.method === 'GET') return request
  if (!MEDIA_WRITE.test(new URL(request.url, 'http://local').pathname)) return request
  const body =
    request.method === 'PUT'
      ? await request
          .clone()
          .json()
          .catch(() => undefined)
      : undefined
  const warning = bundleWarningFor(request.method, request.url, body, await readUsedFolders())
  if (!warning) return request
  try {
    await confirm(host, { color: 'danger', ...warning })
    return request
  } catch {
    return new Request(request, { signal: AbortSignal.abort() })
  }
}

export const MEDIA_ACCESS_ACTION = {
  type: 'entityAction',
  kind: 'default',
  alias: 'Crombolo.EntityAction.Media.Permissions',
  name: 'Crombolo Media Permissions',
  forEntityTypes: ['media'],
  weight: 150,
  api: () => import('./media-access-action.js'),
  meta: { icon: 'icon-lock', label: 'Permissions' },
  conditions: [
    { alias: 'Umb.Condition.EntityIsNotTrashed' },
    { alias: 'Umb.Condition.UserPermission.Fallback', allOf: ['Crombolo.Media.Update'] },
  ],
}

export const MEDIA_ACCESS_DIALOG = {
  type: 'modal',
  alias: MEDIA_ACCESS_MODAL,
  name: 'Crombolo Media Permissions Dialog',
  element: () => import('./media-access-modal.js'),
}

export const MEDIA_ACCESS_INFO = {
  type: 'workspaceInfoApp',
  alias: 'Crombolo.WorkspaceInfoApp.Media.Access',
  name: 'Crombolo Media Access Info',
  element: () => import('./media-access-info.js'),
  weight: 90,
  conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', match: 'Umb.Workspace.Media' }],
}

export const onInit = async (host, extensionRegistry) => {
  extensionRegistry.register(MEDIA_ACCESS_ACTION)
  extensionRegistry.register(MEDIA_ACCESS_DIALOG)
  extensionRegistry.register(MEDIA_ACCESS_INFO)
  const [{ umbHttpClient }, { umbConfirmModal }] = await Promise.all([
    import('@umbraco-cms/backoffice/http-client'),
    import('@umbraco-cms/backoffice/modal'),
  ])
  umbHttpClient.interceptors.request.use((request) =>
    confirmFolderChange(host, request, umbConfirmModal),
  )
}
