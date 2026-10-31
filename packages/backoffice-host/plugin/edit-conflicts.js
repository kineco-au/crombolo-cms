/**
 * An older copy of a page cannot overwrite a newer one (story 172). The server
 * answers a page's read with its revision (`ETag`) and refuses a save based on
 * an older one (412). This remembers, for each page open in an editor, the
 * revision that editor loaded, sends it back with the page's writes, and keeps
 * it current from the editor's own successful writes.
 *
 * Only the editor's own load sets it: another read of the same page (a tree
 * action, the rollback dialog) must not quietly make a stale copy look current.
 */

const PAGE_WRITE =
  /\/management\/api\/v1\/document\/([0-9a-f-]{36})(?:\/(update-and-publish|publish|patch))?$/i
const PAGE_READ = /\/management\/api\/v1\/document\/([0-9a-f-]{36})$/i

export function createRevisionTracker() {
  /** The revision each open page was loaded at, by key. */
  const based = new Map()
  /** Pages whose editor is loading them now. */
  const loading = new Map()
  /** Pages a save was refused for, because someone else changed them. */
  const conflicts = new Set()
  const listeners = new Set()
  const changed = () => {
    for (const listener of listeners) listener()
  }

  const pathOf = (url) => new URL(url, 'http://local').pathname

  return {
    beginLoad(key) {
      loading.set(key, (loading.get(key) ?? 0) + 1)
    },
    endLoad(key) {
      const count = (loading.get(key) ?? 1) - 1
      if (count > 0) loading.set(key, count)
      else loading.delete(key)
    },
    revisionOf: (key) => based.get(key),
    hasConflict: (key) => conflicts.has(key),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** Adds `If-Match` to a write of a page whose editor loaded it. */
    onRequest(request) {
      if (request.method === 'GET' || request.headers.has('if-match')) return request
      const write = PAGE_WRITE.exec(pathOf(request.url))
      const revision = write ? based.get(write[1].toLowerCase()) : undefined
      if (revision) request.headers.set('if-match', revision)
      return request
    },

    /** Learns the revision from the editor's load and its own writes, and hears of a refusal. */
    onResponse(response, request) {
      const path = pathOf(request.url)
      const etag = response.headers.get('etag')
      if (request.method === 'GET') {
        const read = PAGE_READ.exec(path)
        const key = read?.[1].toLowerCase()
        if (key && etag && response.ok && loading.has(key)) {
          based.set(key, etag)
          if (conflicts.delete(key)) changed()
        }
        return response
      }
      const write = PAGE_WRITE.exec(path)
      if (!write) return response
      const key = write[1].toLowerCase()
      if (response.status === 412) {
        conflicts.add(key)
        changed()
      } else if (response.ok && etag) {
        based.set(key, etag)
        if (conflicts.delete(key)) changed()
      }
      return response
    },
  }
}

export const tracker = createRevisionTracker()

export const CONFLICT_BANNER = {
  type: 'workspaceFooterApp',
  alias: 'Crombolo.WorkspaceFooterApp.EditConflict',
  name: 'Crombolo Edit Conflict',
  element: () => import('./edit-conflict-banner.js'),
  weight: 1000,
  conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', match: 'Umb.Workspace.Document' }],
}

/**
 * What the fork's `onEntityLoad` seam calls as an editor reads its entity: for a
 * page, the tracker knows the read is the editor's own until it ends.
 */
export function entityLoads(revisions = tracker) {
  return (entityType, unique) => {
    const key = String(unique ?? '').toLowerCase()
    if (entityType !== 'document' || !key) return undefined
    revisions.beginLoad(key)
    return () => revisions.endLoad(key)
  }
}

export const onInit = async (_host, extensionRegistry) => {
  const [{ umbHttpClient }, { umbCromboloHooks }] = await Promise.all([
    import('@umbraco-cms/backoffice/http-client'),
    import('@umbraco-cms/backoffice/extension-registry'),
  ])
  umbHttpClient.interceptors.request.use((request) => tracker.onRequest(request))
  umbHttpClient.interceptors.response.use((response, request) =>
    tracker.onResponse(response, request),
  )
  umbCromboloHooks.onEntityLoad = entityLoads()
  extensionRegistry.register(CONFLICT_BANNER)
}
