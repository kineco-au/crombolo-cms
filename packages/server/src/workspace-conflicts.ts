/**
 * A workspace coming into conflict with Shared, found as Shared is written (story
 * 400). Each write of a page, media or Library item, or a file, asks the open
 * workspaces holding it how their merge would go for it now, and each with a conflict
 * there it was not already told of raises `Crombolo.WorkspaceConflicted`, in the
 * write's transaction. docs/workspaces.md.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { previewWorkspaceMerge } from '@crombolo/content'
import { normaliseUuid, ObjectTypes } from '@crombolo/core'
import { type ConflictedItem, type Db, WorkspaceRepository } from '@crombolo/data'
import { WORKSPACE_SCHEMA_PREFIX } from './adapters/schema-files.ts'
import { logger } from './logging.ts'

const log = logger('Workspaces')

type Repository = Parameters<typeof previewWorkspaceMerge>[1]

export interface ConflictWatch {
  /** A page, media item, Library item or blueprint written in Shared, by its key. */
  itemWritten(db: Db, key: string, by?: string | null): Promise<void>
  /** A definition or another of the site's files written in Shared, by its path. */
  fileWritten(db: Db, path: string, by?: string | null): Promise<void>
}

/** What a workspace's files would do merged now: only the conflicts are read. */
export interface FileConflicts {
  plan(workspaceId: number, db: Db): Promise<{ conflicts: ReadonlyArray<{ path: string }> }>
}

const KIND_OF: Record<string, string> = {
  [ObjectTypes.Document]: 'document',
  [ObjectTypes.Media]: 'media',
  [ObjectTypes.Element]: 'element',
  [ObjectTypes.DocumentBlueprint]: 'blueprint',
}

const shown = (path: string) =>
  path.startsWith(WORKSPACE_SCHEMA_PREFIX) ? path.slice(WORKSPACE_SCHEMA_PREFIX.length) : path

export function createConflictWatch(options: {
  repository?: Repository
  files?: () => FileConflicts | undefined
}): ConflictWatch {
  /** The open workspaces holding a Shared node: a version of their own, or a move waiting. */
  async function holding(db: Db, nodeId: number): Promise<number[]> {
    const rows = await db.q
      .selectFrom('workspace as w')
      .select('w.id')
      .where('w.state', '=', 'open')
      .where((eb) =>
        eb.or([
          eb(
            'w.id',
            'in',
            eb
              .selectFrom('workspace_document')
              .select('workspace_id')
              .where('node_id', '=', nodeId),
          ),
          eb(
            'w.id',
            'in',
            eb.selectFrom('workspace_pending').select('workspace_id').where('node_id', '=', nodeId),
          ),
        ]),
      )
      .execute()
    return rows.map((r) => Number(r.id))
  }

  return {
    async itemWritten(db, key, by = null) {
      const node = await db.q
        .selectFrom('node')
        .select(['id', 'node_object_type'])
        .where('unique_id', '=', normaliseUuid(key))
        .where('workspace_id', 'is', null)
        .executeTakeFirst()
      if (!node) return
      const ids = await holding(db, Number(node.id))
      if (ids.length === 0) return
      const kind = KIND_OF[String(node.node_object_type ?? '')] ?? 'document'
      const workspaces = new WorkspaceRepository(db)
      for (const id of ids) {
        const workspace = await workspaces.byId(id)
        if (!workspace) continue
        const plan = await previewWorkspaceMerge(db, options.repository, workspace)
        const found = plan.conflicts.find((c) => normaliseUuid(c.key) === normaliseUuid(key))
        const item: ConflictedItem = { kind, key: normaliseUuid(key), name: found?.name ?? key }
        if (found) await workspaces.conflicted(id, [item], by)
        else await workspaces.settle(id, item)
      }
    },

    async fileWritten(db, path, by = null) {
      const files = options.files?.()
      if (!files) return
      const rows = await db.q
        .selectFrom('workspace_file as f')
        .innerJoin('workspace as w', 'w.id', 'f.workspace_id')
        .select(['w.id', 'f.base_hash', 'f.hash'])
        .where('f.path', '=', path)
        .where('w.state', '=', 'open')
        .execute()
      const ids = rows
        .filter((r) => (r.base_hash ?? null) !== (r.hash ?? null))
        .map((r) => Number(r.id))
      const workspaces = new WorkspaceRepository(db)
      const item: ConflictedItem = { kind: 'file', path: shown(path), name: shown(path) }
      for (const id of ids) {
        const plan = await files.plan(id, db)
        if (plan.conflicts.some((c) => c.path === item.path))
          await workspaces.conflicted(id, [item], by)
        else await workspaces.settle(id, item)
      }
    },
  }
}

const scope = new AsyncLocalStorage<{ watch: ConflictWatch; files: Map<string, string | null> }>()

/**
 * Runs a request's `work` with `watch`, then, once it has answered and what it wrote is
 * in place, tells the open workspaces of each Shared file it wrote.
 */
export async function withConflictWatch<T>(
  watch: ConflictWatch | undefined,
  db: Db,
  work: () => Promise<T>,
): Promise<T> {
  if (!watch) return work()
  const files = new Map<string, string | null>()
  const answer = await scope.run({ watch, files }, work)
  for (const [path, by] of files)
    await watch
      .fileWritten(db, path, by)
      .catch((error: unknown) =>
        log.warning('Could not tell the workspaces of {path}: {error}', { path, error }),
      )
  return answer
}

/** A Shared file written in this request, checked against the open workspaces once it ends. */
export function noteFileWritten(path: string, by: string | null): void {
  scope.getStore()?.files.set(path, by)
}
