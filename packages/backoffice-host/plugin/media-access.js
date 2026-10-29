/**
 * "Permissions" on media folders and items (story 204): who may read and
 * change them, and what files added to a folder later get. The
 * server keeps them at <backoffice>/crombolo/api/media-access/{key}, and
 * refuses what the user may not do whatever this shows. docs/rendering.md, "Protected media".
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

export const PUBLIC_NOTE =
  'Anyone who has the link can open these files, without signing in, and can pass the link on.'

/** One line saying who can see and change a folder or file, as saved. */
export const summarise = (state) => (state ? describeAccess(formFor(state), state) : '')

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

/** Read audiences; the default, Enabled, lets anyone with the link see a file. */
export const READ_MODES = [
  { value: 'public', label: 'Enabled' },
  { value: 'private', label: 'Disabled' },
  { value: 'custom', label: 'Custom' },
]
/** Write audiences: members are never allowed to change files publicly. */
export const WRITE_MODES = [
  { value: 'private', label: 'No Public Access' },
  { value: 'custom', label: 'Custom' },
]

/** An existing setting shown without broadening its audience. */
export function accessMode(policy, action, rule) {
  if (policy === 'none' || (action === 'write' && ['public', 'members'].includes(policy)))
    return 'private'
  if (policy === 'public') return 'public'
  if (policy !== 'inherit') return 'custom'
  if (action === 'read' && (!rule || rule.publicRead)) return 'public'
  const flag = action === 'read' ? 'read' : 'write'
  return [...(rule?.groups ?? []), ...(rule?.members ?? [])].some((grant) => grant[flag])
    ? 'custom'
    : 'private'
}

/** Whether a folder or item follows the folder above it, with no settings of its own. */
export const inheritsParent = (state) =>
  Boolean(state.hasParent) &&
  !state.own &&
  state.item.readPolicy === 'inherit' &&
  state.item.writePolicy === 'inherit'

/**
 * The dialog's form: the audiences a rule and an item's own policies come to.
 * A file that may only be seen by the member who added it lists that member.
 */
export function viewOf(rule, item, state) {
  const members = (rule?.members ?? []).map((m) => ({ ...m }))
  const creator = item.creator?.key
  for (const action of ['read', 'write']) {
    if (item[`${action}Policy`] !== 'creator' || !creator) continue
    const existing = members.find((m) => m.key === creator)
    if (existing) existing[action] = true
    else members.push({ key: creator, read: action === 'read', write: action === 'write' })
  }
  const kept = (value) => (value === 'creator' ? value : null)
  return {
    read: accessMode(item.readPolicy, 'read', rule),
    write: accessMode(item.writePolicy, 'write', rule),
    allMembers: item.readPolicy === 'members',
    groups: groupRows(rule, state.memberGroups ?? []),
    members,
    newRead: kept(state.own?.newRead),
    newWrite: kept(state.own?.newWrite),
    memberTypes: [...(rule?.memberTypes ?? [])],
    memberMaxBytes: rule?.memberMaxBytes ?? null,
  }
}

const INHERITED_ITEM = { readPolicy: 'inherit', writePolicy: 'inherit' }

/** The form for a folder or item as saved: following the folder above, or its own settings. */
export function formFor(state) {
  const inherit = inheritsParent(state)
  return {
    inherit,
    ...(inherit
      ? viewOf(state.inherited, INHERITED_ITEM, state)
      : viewOf(state.own ?? state.inherited, state.item, state)),
  }
}

/** The form when "Inherit parent permissions" is ticked again: the folder above's settings. */
export const inheritedForm = (state) => ({
  inherit: true,
  ...viewOf(state.inherited, INHERITED_ITEM, state),
})

const listed = (names) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

const chosen = (form, action) => {
  const groups = form.groups.filter((g) => g[action]).map((g) => g.name)
  const count = form.members.filter((m) => m[action]).length
  return listed([...groups, ...(count ? [`${count} chosen member${count === 1 ? '' : 's'}`] : [])])
}

/** Where a form's settings come from and who they let in, in a sentence or two. */
export function describeAccess(form, state) {
  const source = form.inherit
    ? state.inherited?.from
      ? `Inherited from ${state.inherited.from.name}.`
      : 'Default permissions.'
    : state.hasParent
      ? 'Set for this item.'
      : ''
  const readers = chosen(form, 'read')
  const writers = chosen(form, 'write')
  const read =
    form.read === 'public'
      ? 'Anyone with the link can see this.'
      : form.read === 'private'
        ? 'Only back-office users can see this.'
        : form.allMembers
          ? 'All signed-in members can see this.'
          : readers
            ? `Only ${readers} can see this.`
            : 'Nobody has been chosen to see this yet.'
  const write =
    form.write === 'custom' && writers ? `${writers} can change it.` : 'No members can change it.'
  return [source, read, write].filter(Boolean).join(' ')
}

/**
 * What the dialog sends: no settings of its own when it inherits, else a rule
 * holding both audiences. An all-members read nobody changed is kept as it was.
 */
export function requestFor(form, original = INHERITED_ITEM) {
  if (form.inherit) return { rule: null, item: { ...INHERITED_ITEM } }
  const grants = (list) =>
    list
      .map((g) => ({
        ...g,
        read: form.read === 'custom' && g.read,
        write: form.write === 'custom' && g.write,
      }))
      .filter((g) => g.read || g.write)
  const members = grants(form.members)
  return {
    rule: {
      publicRead: form.read === 'public',
      groups: grants(form.groups),
      ...(members.length ? { members } : {}),
      newRead: form.newRead ?? null,
      newWrite: form.newWrite ?? null,
      memberTypes: form.memberTypes ?? [],
      memberMaxBytes: form.memberMaxBytes ?? null,
    },
    item: {
      readPolicy: form.allMembers && original.readPolicy === 'members' ? 'members' : 'inherit',
      writePolicy: 'inherit',
    },
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
