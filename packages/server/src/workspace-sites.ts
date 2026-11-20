/**
 * A workspace's site (story 379): its pages as it has them published, rendered
 * with its own views where it changed any, from a published cache of its own.
 * Built when first asked for, kept fresh by the workspace's revision (its newest
 * event, its newest waiting change, its changed files), read with every request;
 * nothing goes on the cache instruction stream. At most so many are kept on a
 * node, and one left alone long enough is dropped.
 */
import { createHash } from 'node:crypto'
import type { Db, NodeSchemaState, WorkspaceScope } from '@crombolo/data'
import {
  PublishedCache,
  type PublishedCacheOptions,
  Renderer,
  type ViewSnapshots,
} from '@crombolo/render'
import { createPublishedContentSource } from './adapters/documents.ts'
import type { WorkspaceViews } from './workspace-views.ts'

interface Site {
  workspace: WorkspaceScope
  cache: PublishedCache
  shared: Renderer
  revision: string
  usedAt: number
}

/** What the workspace holds now, as one string: it moves with every write there. */
export async function workspaceRevision(db: Db, workspaceId: number): Promise<string> {
  const events = await db.q
    .selectFrom('content_version')
    .select((eb) => eb.fn.max('id').as('n'))
    .where('workspace_id', '=', workspaceId)
    .execute()
  const pending = await db.q
    .selectFrom('workspace_pending')
    .select((eb) => eb.fn.max('id').as('n'))
    .where('workspace_id', '=', workspaceId)
    .execute()
  const files = await db.q
    .selectFrom('workspace_file')
    .select(['path', 'hash'])
    .where('workspace_id', '=', workspaceId)
    .orderBy('path')
    .execute()
  const digest = createHash('sha256')
  for (const f of files) digest.update(`${f.path}:${f.hash ?? ''}\n`)
  return `${events[0]?.n ?? 0}|${pending[0]?.n ?? 0}|${digest.digest('hex').slice(0, 16)}`
}

export function createWorkspaceSites(options: {
  db: Db
  nodeState?: NodeSchemaState
  cacheOptions: Omit<PublishedCacheOptions, 'onInvalidate' | 'onRead'>
  views: WorkspaceViews
  componentsDir: string
  snapshots?: ViewSnapshots
  renderTimeoutMs?: number
  /** How many a node keeps. */
  limit: number
  /** How long one is kept unused. */
  idleMs: number
}) {
  const sites = new Map<string, Site>()

  const sweep = (now: number, keep: string) => {
    for (const [key, site] of sites)
      if (key !== keep && now - site.usedAt > options.idleMs) sites.delete(key)
    while (sites.size > Math.max(1, options.limit)) {
      const oldest = [...sites.entries()]
        .filter(([key]) => key !== keep)
        .sort((a, b) => a[1].usedAt - b[1].usedAt)[0]
      if (!oldest) break
      sites.delete(oldest[0])
    }
  }

  return {
    /** The workspace's cache and renderer, brought up to what it holds. */
    async siteFor(
      workspace: WorkspaceScope,
    ): Promise<{ cache: PublishedCache; renderer: Renderer; workspace: WorkspaceScope }> {
      const revision = await workspaceRevision(options.db, workspace.id)
      let site = sites.get(workspace.key)
      if (!site) {
        const cache = new PublishedCache(
          createPublishedContentSource(options.db, {
            nodeState: options.nodeState,
            workspace: workspace.id,
          }),
          options.cacheOptions,
        )
        site = {
          workspace,
          cache,
          revision,
          usedAt: 0,
          shared: new Renderer({
            cache,
            componentsDir: options.componentsDir,
            snapshots: options.snapshots,
            renderTimeoutMs: options.renderTimeoutMs,
          }),
        }
        sites.set(workspace.key, site)
      } else if (site.revision !== revision) {
        site.cache.invalidate()
        site.revision = revision
      }
      site.usedAt = Date.now()
      sweep(site.usedAt, workspace.key)
      const own = await options.views.rendererFor(workspace, site.cache)
      return { cache: site.cache, renderer: own ?? site.shared, workspace }
    },

    /** Forgets a workspace's site: it was merged or discarded. */
    forget(key: string): void {
      sites.delete(key)
    },

    get size(): number {
      return sites.size
    },
  }
}

export type WorkspaceSites = ReturnType<typeof createWorkspaceSites>
