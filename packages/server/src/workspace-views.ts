/**
 * Rendering with a workspace's views (story 377). A workspace that changed a
 * component has a tree of its own: its full copy of the components, written from
 * its file list into a folder of its own, with a snapshot over it, so each save
 * is read fresh at a new path, as Shared's views are. One that changed none
 * renders with Shared's. Only so many trees are kept in this process
 * (`CROMBOLO_WORKSPACE_VIEWS_LIMIT`): past it the least recently used goes, until
 * story 378 moves them into processes of their own.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { type Db, fileHash, WorkspaceFileRepository, type WorkspaceScope } from '@crombolo/data'
import { type PublishedCache, Renderer, ViewSnapshots } from '@crombolo/render'
import type { CromboloConfig } from './config.ts'

const PREFIX = 'components/'

interface Tree {
  renderer: Renderer
  snapshots: ViewSnapshots
  root: string
  written: Map<string, string>
  usedAt: number
}

/** A page as a workspace's views render it, for the routes to answer. */
export type WorkspaceRender =
  | { status: 'ok'; html: string; views: 'workspace' | 'shared' }
  | { status: 'notFound' | 'noTemplate' | 'redirect' | 'outcome'; views: 'workspace' | 'shared' }
  | { status: 'error'; error: string; views: 'workspace' | 'shared' }

export function createWorkspaceViews(options: {
  db: Db
  config: CromboloConfig
  cache: PublishedCache
  /** Shared's renderer, for a workspace that changed no view. */
  shared: Renderer
  limit: number
}) {
  const trees = new Map<string, Tree>()
  const base = resolve(`${options.config.componentsCacheDir}-workspaces`)
  const store = new WorkspaceFileRepository(options.db)

  const drop = (key: string) => {
    const tree = trees.get(key)
    if (!tree) return
    trees.delete(key)
    rmSync(tree.root, { recursive: true, force: true })
  }

  /** The workspace's renderer, its tree brought up to its files; undefined when it changed no view. */
  async function rendererFor(workspace: WorkspaceScope): Promise<Renderer | undefined> {
    if ((await store.changes(workspace.id, PREFIX)).length === 0) return undefined
    const files = await store.files(workspace.id, PREFIX)
    let tree = trees.get(workspace.key)
    const created = !tree
    if (!tree) {
      const root = join(base, workspace.key)
      const src = join(root, 'src')
      mkdirSync(src, { recursive: true })
      const snapshots = new ViewSnapshots({ sourceDir: src, cacheDir: join(root, 'gen') })
      tree = {
        root,
        snapshots,
        written: new Map(),
        usedAt: 0,
        renderer: new Renderer({
          cache: options.cache,
          componentsDir: src,
          snapshots,
          renderTimeoutMs: options.config.renderTimeoutMs,
        }),
      }
      trees.set(workspace.key, tree)
    }
    const src = join(tree.root, 'src')
    let changed = false
    for (const [key, text] of files) {
      const hash = fileHash(text)
      if (tree.written.get(key) === hash) continue
      const target = join(src, ...key.slice(PREFIX.length).split('/'))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, text)
      tree.written.set(key, hash)
      changed = true
    }
    for (const key of [...tree.written.keys()])
      if (!files.has(key)) {
        rmSync(join(src, ...key.slice(PREFIX.length).split('/')), { force: true })
        tree.written.delete(key)
        changed = true
      }
    if (created) await tree.snapshots.prepare()
    else if (changed) await tree.snapshots.refresh()
    tree.usedAt = Date.now()
    // Past the limit, the least recently used tree goes.
    while (trees.size > Math.max(1, options.limit)) {
      const oldest = [...trees.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)[0]
      if (!oldest || oldest[0] === workspace.key) break
      drop(oldest[0])
    }
    return tree.renderer
  }

  return {
    rendererFor,

    /** One page, as the workspace's views render it, on Shared's published content. */
    async render(workspace: WorkspaceScope, path: string): Promise<WorkspaceRender> {
      const own = await rendererFor(workspace)
      const views = own ? ('workspace' as const) : ('shared' as const)
      const result = await (own ?? options.shared).render(path)
      if (result.status === 'ok') return { status: 'ok', html: result.html, views }
      if (result.status === 'error') return { status: 'error', error: result.error.message, views }
      return { status: result.status, views }
    },

    /** Forgets a workspace's tree: it was merged or discarded. */
    forget(key: string): void {
      drop(key)
    },

    /** How many trees this process holds now. */
    get size(): number {
      return trees.size
    },

    /** Removes every tree, as the process stops. */
    clear(): void {
      for (const key of [...trees.keys()]) drop(key)
      if (existsSync(base)) rmSync(base, { recursive: true, force: true })
    },
  }
}

export type WorkspaceViews = ReturnType<typeof createWorkspaceViews>
