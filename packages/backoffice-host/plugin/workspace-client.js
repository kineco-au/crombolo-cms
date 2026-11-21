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

/** A request, sent in the tab's workspace unless it names one. */
export const inWorkspace = (required, storage) => (request) => {
  const path = new URL(request.url, globalThis.location?.href ?? 'http://localhost/').pathname
  const header = headerFor(currentWorkspace(storage), required)
  if (header && path.includes('/management/api/') && !request.headers.has(WORKSPACE_HEADER))
    request.headers.set(WORKSPACE_HEADER, header)
  return request
}

/**
 * What the switch offers, in order. Merge only where the person may merge and the
 * workspace has changes; Share only to its owner. Pure.
 */
export function menuFor({ current, workspaces, mayMerge, changes, required }) {
  const items = []
  items.push({
    action: 'shared',
    label: required ? 'Shared (to look at)' : 'Shared',
    current: !current,
  })
  for (const w of workspaces)
    if (w.state === 'open' && w.member)
      items.push({ action: 'enter', workspace: w, label: w.name, current: current?.key === w.key })
  items.push({ action: 'new', label: 'New workspace' })
  if (current) {
    items.push({ action: 'changes', label: `Changes (${changes})` })
    if (mayMerge && changes > 0)
      items.push({ action: 'merge', label: `Merge into Shared (${changes})` })
    items.push({ action: 'address', label: 'Open at its address' })
    const mine = workspaces.find((w) => w.key === current.key)
    if (mine?.mine) items.push({ action: 'share', label: 'Share' })
  }
  items.push({ action: 'all', label: 'All workspaces' })
  return items
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
  list: () => call(''),
  open: (name, privacy = {}) => call('', { method: 'POST', body: { name, ...privacy } }),
  privacy: (key, privacy) => call(`/${key}`, { method: 'PATCH', body: privacy }),
  changes: (key) => call(`/${key}/changes`),
  diff: (key) => call(`/${key}/diff?against=shared`),
  drop: (key, page) => call(`/${key}/changes/${page}`, { method: 'DELETE' }),
  dropPending: (key, id) => call(`/${key}/pending/${id}`, { method: 'DELETE' }),
  plan: (key) => call(`/${key}/merge`),
  answer: (key, page, field, side) =>
    call(`/${key}/conflicts`, { method: 'POST', body: { page, answers: { [field]: side } } }),
  merge: (key, accept) => call(`/${key}/merge`, { method: 'POST', body: { accept } }),
  members: (key) => call(`/${key}/members`),
  share: (key, email) => call(`/${key}/members`, { method: 'POST', body: { email } }),
  unshare: (key, userKey) => call(`/${key}/members/${userKey}`, { method: 'DELETE' }),
  address: (key, path = '/') => call(`/${key}/open`, { method: 'POST', body: { path } }),
  touched: (page) => call(`/touched/${page}`),
}
