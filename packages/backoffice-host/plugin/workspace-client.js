/**
 * Workspaces in the back office (story 384): which one this browser tab is in, kept
 * per tab and sent with every Management API call; each workspace's colour, from its
 * key; what the switch offers; and the calls the switch and its panels make.
 */

export const WORKSPACE_HEADER = 'Crombolo-Workspace'
const STORE = 'crombolo.workspace'

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

/** A fixed palette with enough contrast on white, so a colour is never chosen or stored. */
export const PALETTE = [
  '#1f6f8b',
  '#8a4f7d',
  '#2e7d32',
  '#b45309',
  '#6d28d9',
  '#b91c1c',
  '#0f766e',
  '#4d5a9b',
]

/** A workspace's colour: the same for the same key, everywhere. Pure. */
export function colourOf(key) {
  let hash = 0
  for (const ch of String(key)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

const DARK_INK = '#1f1d1a'
const LIGHT_INK = '#ffffff'

const luminance = (hex) => {
  const value = Number.parseInt(String(hex).replace('#', '').slice(0, 6), 16)
  const channel = (shift) => {
    const c = ((value >> shift) & 255) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
}

/** The contrast between two colours, 1 to 21 (WCAG). Pure. */
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The text colour that reads best on `background`: white or near-black. Pure. */
export const inkOn = (background) =>
  contrast(background, LIGHT_INK) >= contrast(background, DARK_INK) ? LIGHT_INK : DARK_INK

/**
 * The grid of workspaces on Shared's page: each one's status, as an icon and words, and
 * whether it may be merged from there. A conflicted one is settled in the workspace
 * itself, so it links there instead. Pure.
 */
export function mergeRows(workspaces, mayMerge = false) {
  return workspaces
    .filter((w) => w.state === 'open')
    .map((w) => {
      const status =
        w.conflicts > 0
          ? {
              icon: 'icon-alert',
              tone: 'danger',
              label: `${w.conflicts} conflict${w.conflicts === 1 ? '' : 's'} with Shared`,
            }
          : w.staged
            ? { icon: 'icon-download-alt', tone: 'warning', label: 'Staged from another site' }
            : !w.member
              ? { icon: 'icon-eye', tone: 'default', label: 'Yours to look at' }
              : { icon: 'icon-check', tone: 'positive', label: 'Ready to merge' }
      const merge =
        w.conflicts > 0
          ? { enabled: false, why: 'Settle its conflicts in the workspace first.' }
          : !mayMerge
            ? { enabled: false, why: 'You may not merge workspaces.' }
            : { enabled: true, why: `Merge ${w.name} into Shared` }
      return { key: w.key, name: w.name, colour: colourOf(w.key), status, merge }
    })
}

/** The workspace this tab is in, or null for Shared. */
export function currentWorkspace(storage = globalThis.sessionStorage) {
  try {
    const raw = storage?.getItem(STORE)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Puts this tab in a workspace, or in Shared with null. */
export function chooseWorkspace(workspace, storage = globalThis.sessionStorage) {
  try {
    if (workspace)
      storage?.setItem(STORE, JSON.stringify({ key: workspace.key, name: workspace.name }))
    else storage?.removeItem(STORE)
  } catch {}
}

/**
 * The header a Management API call goes with: the tab's workspace, or with a workspace
 * required and none chosen, the person's own. Shared, chosen where one is required, is
 * looked at only. Pure.
 */
export function headerFor(chosen, required) {
  if (chosen?.key === 'shared') return undefined
  if (chosen?.key) return chosen.key
  return required ? 'mine' : undefined
}

let requiredHere = false

/**
 * The header for Crombolo's own designer calls, forms and workflows (story 392), which
 * do not go through the Management API's client.
 */
export const workspaceHeaders = (storage) => {
  const header = headerFor(currentWorkspace(storage), requiredHere)
  return header ? { [WORKSPACE_HEADER]: header } : {}
}

export const PURPOSE_HEADER = 'Crombolo-Purpose'

/**
 * Story 395: whether a screen is making content, rather than building the site's types
 * and templates, by the section it is in. Pure.
 */
export const purposeFor = (pathname) =>
  /\/section\/settings(\/|$)/.test(pathname ?? '') ? undefined : 'content'

/** A request, sent in the tab's workspace unless it names one. */
export const inWorkspace = (required, storage) => (request) => {
  requiredHere = required
  const path = new URL(request.url, globalThis.location?.href ?? 'http://localhost/').pathname
  const header = headerFor(currentWorkspace(storage), required)
  if (header && path.includes('/management/api/') && !request.headers.has(WORKSPACE_HEADER))
    request.headers.set(WORKSPACE_HEADER, header)
  const purpose = purposeFor(globalThis.location?.pathname)
  if (purpose && path.includes('/management/api/') && !request.headers.has(PURPOSE_HEADER))
    request.headers.set(PURPOSE_HEADER, purpose)
  return request
}

/**
 * A request sent once the server has said which workspace this tab works in (`asked`,
 * the answer to `mine`), so none goes out before it: a fresh load straight into an
 * editor would otherwise read Shared's copy of the page.
 */
export const onceKnown = (asked, storage) => async (request) => {
  const mine = await asked
  return mine?.enabled ? inWorkspace(mine.required === true, storage)(request) : request
}

/**
 * What the switch offers, in order. Merge only where the person may merge and the
 * workspace has changes. Opening a new one and sharing are buttons beside the menu
 * (story 428), and every workspace is on the Workspaces page. Pure.
 */
export function menuFor({ current, workspaces, mayMerge, changes, required }) {
  const items = []
  // Three sections, each divided from the one before: Shared, the workspaces, what to do.
  items.push({
    action: 'shared',
    section: 'shared',
    label: required ? 'Shared (to look at)' : 'Shared',
    current: !current,
  })
  for (const w of workspaces)
    if (w.state === 'open' && w.member)
      items.push({
        action: 'enter',
        section: 'workspaces',
        workspace: w,
        label: w.name,
        current: current?.key === w.key,
      })
  if (current) {
    items.push({ action: 'changes', section: 'actions', label: `Changes (${changes})` })
    if (mayMerge && changes > 0)
      items.push({
        action: 'merge',
        section: 'actions',
        label: `Merge into Shared (${changes})`,
      })
    items.push({ action: 'address', section: 'actions', label: 'Open at its address' })
  }
  return items
}

/**
 * Story 428: which of the buttons beside the Content menu work where the tab is, and why
 * one does not. `current` is the workspace the tab is in, none in Shared.
 */
export function controlsFor({ current, workspaces, mayMerge = false, changes = 0 }) {
  const view = current ? workspaces.find((w) => w.key === current.key) : undefined
  const inShared = 'Shared is everyone’s: open a workspace first.'
  return {
    merge: !current
      ? { enabled: false, why: inShared }
      : !mayMerge
        ? { enabled: false, why: 'You may not merge workspaces.' }
        : changes === 0
          ? { enabled: false, why: 'It holds no changes to merge.' }
          : { enabled: true },
    share: !current
      ? { enabled: false, why: inShared }
      : view?.mine
        ? { enabled: true }
        : { enabled: false, why: 'Only its owner shares a workspace.' },
    remove: !current
      ? { enabled: false, why: inShared }
      : view?.personal
        ? { enabled: false, why: 'Your own workspace stays: every edit here goes in it.' }
        : { enabled: true },
  }
}

/**
 * Told on `window` when what the workspaces hold or are called may have changed: something
 * was saved through the Management API, or a workspace was opened, renamed or deleted.
 */
export const WORKSPACES_CHANGED = 'crombolo:workspaces-changed'

export const tellWorkspacesChanged = () =>
  globalThis.window?.dispatchEvent(new CustomEvent(WORKSPACES_CHANGED))

/** The workspace a tab is in: the one chosen, or with one required, the person's own. Pure but for the tab's choice. */
export const tabWorkspace = (mine, storage) => {
  const chosen = currentWorkspace(storage)
  if (chosen?.key === 'shared') return null
  if (chosen) return chosen
  return mine?.required && mine.workspace ? mine.workspace : null
}

/** What a tree's mark says of an item, by the mark the site gave it. */
export const MARK_WORDS = {
  changed: { tag: '', says: 'Changed' },
  new: { tag: 'New', says: 'New' },
  moved: { tag: 'Moved', says: 'Moved' },
  deleted: { tag: 'Deleted', says: 'Deleted' },
  below: { tag: '', says: 'Something below it is changed' },
}

/**
 * The mark an item carries, from what the workspace holds: by its key, or its path as a
 * tree names a file (`%2Fsite%dot%css` is `/site.css`). `below` for one that only holds a
 * marked item beneath it; nothing for one that is as Shared has it. Pure.
 */
export function markOf(marks, unique) {
  if (!marks || unique === undefined || unique === null) return undefined
  let id = String(unique).replaceAll('%dot%', '.')
  try {
    id = decodeURIComponent(id)
  } catch {}
  const found = marks.items?.[id] ?? marks.items?.[id.toLowerCase()]
  if (found) return found
  return (marks.below ?? []).includes(id.toLowerCase()) ? 'below' : undefined
}

/** Who can see a workspace, as the back office words the two choices. */
/**
 * Who sees a workspace, in words: always its owner and the administrators, every editor
 * when it is open to them, and the groups and people it is shared with, by name. Pure.
 */
export function whoSees(view, groups = [], people = []) {
  const names = [...groups, ...people.filter((p) => !p.owner)].map((x) => x.name)
  const parts = ['Its owner', 'the administrators']
  if (view?.visibility === 'editors') parts.push('every editor')
  parts.push(...names)
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/** The workspaces the list's filter shows: every one (`all`), or those the person is in. Pure. */
export const filtered = (workspaces, filter) =>
  filter === 'all' ? workspaces : workspaces.filter((w) => w.member)

/** The workspaces whose name holds `query`, whatever its case; all of them for none. Pure. */
export const named = (workspaces, query) => {
  const q = String(query ?? '')
    .trim()
    .toLowerCase()
  return q ? workspaces.filter((w) => String(w.name).toLowerCase().includes(q)) : workspaces
}

/** How many workspaces the list shows at once. */
export const WORKSPACES_PER_PAGE = 10

/**
 * One page of `items`, counted from 1 and kept within the pages there are, with what the
 * list says of it: `from`, `to` and `total` (11–20 of 34). Pure.
 */
export function pageOf(items, page, size = WORKSPACES_PER_PAGE) {
  const pages = Math.max(1, Math.ceil(items.length / size))
  const at = Math.min(Math.max(1, Math.floor(page) || 1), pages)
  const start = (at - 1) * size
  const shown = items.slice(start, start + size)
  return {
    items: shown,
    page: at,
    pages,
    total: items.length,
    from: items.length === 0 ? 0 : start + 1,
    to: start + shown.length,
  }
}

/**
 * The Workspaces page's list, in order: Shared, then each open workspace the person can
 * see, the one the tab is in marked `here`. `note` says what stands out: conflicts, or
 * that it is someone else's to look at. Pure.
 */
export function workspaceRows({ current, workspaces }) {
  return [
    { key: 'shared', name: 'Shared', here: !current, note: '' },
    ...workspaces
      .filter((w) => w.state === 'open')
      .map((w) => ({
        key: w.key,
        name: w.name,
        here: current?.key === w.key,
        note: !w.member
          ? 'to look at'
          : w.conflicts > 0
            ? `${w.conflicts} conflict${w.conflicts === 1 ? '' : 's'}`
            : '',
      })),
  ]
}

/**
 * What the Workspaces page says of one, as three cards: each a label, its words and a
 * line below. `members` are the people it is shared with, its owner among them. Pure.
 */
export function workspaceFacts(view, members = [], changes = 0, when = (iso) => iso, groups = []) {
  const owner = members.find((m) => m.owner)
  const others = [
    ...groups.map((g) => g.name),
    ...members.filter((m) => !m.owner).map((m) => m.name),
  ]
  const conflicts =
    view.conflicts > 0
      ? `${view.conflicts} conflict${view.conflicts === 1 ? '' : 's'} with Shared`
      : 'no conflicts'
  return [
    { label: 'Created by', value: owner?.name ?? 'Its owner', note: when(view.createdAt) },
    {
      label: 'Last changed',
      value: when(view.updatedAt),
      note:
        changes === 0
          ? 'No changes yet'
          : `${changes} change${changes === 1 ? '' : 's'}, ${conflicts}`,
    },
    {
      label: 'Shared with',
      value: others.length > 0 ? others.join(', ') : 'Nobody else',
      note: view.staged
        ? 'Holds a change from another site, to look at'
        : view.personal
          ? 'Your own: every edit of yours goes in it'
          : '',
    },
  ]
}

async function call(path, init = {}) {
  const response = await fetch(`${base()}/crombolo/api/workspaces${path}`, {
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    ...init,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}))
  if (!response.ok)
    throw Object.assign(new Error(body.message ?? `The server answered ${response.status}.`), {
      body,
      status: response.status,
    })
  return body
}

export const workspacesApi = {
  mine: () => call('/mine'),
  // Shared is listed first for tools (story 447); the back office shows only workspaces.
  list: () =>
    call('').then((body) => ({ ...body, items: (body.items ?? []).filter((w) => !w.shared) })),
  open: (name, more = {}) => call('', { method: 'POST', body: { name, ...more } }),
  describe: (key, description) => call(`/${key}`, { method: 'PATCH', body: { description } }),
  rename: (key, name) => call(`/${key}`, { method: 'PATCH', body: { name } }),
  privacy: (key, privacy) => call(`/${key}`, { method: 'PATCH', body: privacy }),
  discard: (key) => call(`/${key}`, { method: 'DELETE' }),
  changes: (key) => call(`/${key}/changes`),
  marks: (key) => call(`/${key}/marks`),
  diff: (key) => call(`/${key}/diff?against=shared`),
  drop: (key, page) => call(`/${key}/changes/${page}`, { method: 'DELETE' }),
  dropPending: (key, id) => call(`/${key}/pending/${id}`, { method: 'DELETE' }),
  plan: (key) => call(`/${key}/merge`),
  answer: (key, page, field, side) =>
    call(`/${key}/conflicts`, { method: 'POST', body: { page, answers: { [field]: side } } }),
  merge: (key, accept) => call(`/${key}/merge`, { method: 'POST', body: { accept } }),
  members: (key) => call(`/${key}/members`),
  share: (key, userKey) => call(`/${key}/members`, { method: 'POST', body: { userKey } }),
  unshare: (key, userKey) => call(`/${key}/members/${userKey}`, { method: 'DELETE' }),
  shareGroup: (key, groupKey) => call(`/${key}/groups`, { method: 'POST', body: { groupKey } }),
  unshareGroup: (key, groupKey) => call(`/${key}/groups/${groupKey}`, { method: 'DELETE' }),
  /** Who a workspace may be shared with: the users and the user groups. */
  shareOptions: () => call('/share-options'),
  address: (key, path = '/') => call(`/${key}/open`, { method: 'POST', body: { path } }),
  touched: (page) => call(`/touched/${page}`),
}
