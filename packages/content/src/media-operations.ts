/**
 * Every media write, once (story 165), as `operations.ts` is for pages: the
 * backoffice and the command line call these, so a write follows the same rules
 * whoever starts it — the actor's permissions, where an item's type may go, and
 * one transaction holding the change, its audit entry, its webhook event and the
 * cache instruction. Files go after the rows they belong to have.
 */
import {
  type DocumentValue,
  mediaFileOf,
  normaliseUuid,
  ObjectTypes,
  SystemNodes,
} from '@crombolo/core'
import {
  appendCacheInstruction,
  ContentTypeRepository,
  type Db,
  DocumentRepository,
  type DocumentRepositoryOptions,
  InvalidParentError,
  NodeRepository,
  type NodeRow,
  WriteRejectedError,
} from '@crombolo/data'
import { type Actor, actorName, actorUserKey } from './actor.ts'
import type { Refusal, Result, SelectionResult } from './operations.ts'
import { mayChangeMedia } from './policy.ts'

/** A media item as a save sends it. */
export interface MediaInput {
  key: string
  contentTypeKey: string
  parentKey: string | null
  values: DocumentValue[]
  variants: Array<{ culture: string | null; segment: string | null; name: string }>
}

export type MediaEvent =
  | { type: 'created'; key: string }
  | { type: 'saved'; key: string }
  | { type: 'trashed'; key: string }
  /** `name` is read before it went, since it cannot be read after. */
  | { type: 'deleted'; key: string; name: string | null }
  | { type: 'restored'; key: string }
  | { type: 'binEmptied' }
  | { type: 'moved'; key: string }
  /** `parentKey` null: the top level. */
  | { type: 'sorted'; parentKey: string | null }

/** Where a media operation records what it did, inside the change's transaction. */
export interface MediaEventSink {
  record(tx: Db, event: MediaEvent, actor: Actor): Promise<void>
  afterCommit?(event: MediaEvent, actor: Actor): void
}

/** The audit entry a media event writes: the entries the backoffice has always written. Pure. */
export function mediaAuditFor(event: MediaEvent): {
  category: 'media'
  action: string
  entityType: 'Media'
  entityKey: string | null
} {
  const entry = (action: string, key: string | null) => ({
    category: 'media' as const,
    action,
    entityType: 'Media' as const,
    entityKey: key,
  })
  switch (event.type) {
    case 'created':
      return entry('Create', event.key)
    case 'saved':
      return entry('Save', event.key)
    case 'trashed':
      return entry('Trash', event.key)
    case 'deleted':
      return entry('Delete', event.key)
    case 'restored':
      return entry('Restore', event.key)
    case 'binEmptied':
      return entry('EmptyRecycleBin', null)
    case 'moved':
      return entry('Move', event.key)
    case 'sorted':
      return entry('Sort', event.parentKey)
  }
}

/** The webhook a media event raises, by Umbraco's alias. Pure. */
export function mediaWebhookFor(event: MediaEvent): { alias: string; key: string } | undefined {
  switch (event.type) {
    case 'created':
    case 'saved':
      return { alias: 'Umbraco.MediaSave', key: event.key }
    case 'deleted':
      return { alias: 'Umbraco.MediaDelete', key: event.key }
    default:
      return undefined
  }
}

/** The whole audit entry a media event writes, with who acted and from where. Pure. */
export function mediaAuditEntryFor(event: MediaEvent, actor: Actor) {
  return {
    ...mediaAuditFor(event),
    source: actor.origin.source,
    userKey: actorUserKey(actor),
    userName: actorName(actor),
    ipAddress: actor.origin.ipAddress ?? null,
    forwardedFor: actor.origin.forwardedFor ?? null,
    detail: null,
  }
}

export interface MediaOperationsOptions {
  db: Db
  repository?: Omit<DocumentRepositoryOptions, 'kind'>
  events: MediaEventSink
  /** Where an item's file goes when the item is deleted for good. */
  files?: { remove(path: string): Promise<void> }
  /** Told after every committed change, for a cache held in this process. */
  onChange?(): void | Promise<void>
  /** Errors a value's intake throws that are the sender's to fix, as the reason to give. */
  refusalReason?(error: unknown): string | undefined
}

const NOT_FOUND = 'The media item could not be found.'

const refuse = (kind: Refusal['kind'], status: number, reason: string): Refusal => ({
  ok: false,
  kind,
  status,
  reason,
})

function refusalFrom(error: unknown, extra?: (error: unknown) => string | undefined): Refusal {
  if (error instanceof WriteRejectedError) return refuse('conflict', 409, error.message)
  if (error instanceof InvalidParentError) return refuse('invalid', 400, error.message)
  const reason = extra?.(error)
  if (reason) return refuse('invalid', 400, reason)
  throw error
}

export type MediaOperations = ReturnType<typeof createMediaOperations>

export function createMediaOperations(options: MediaOperationsOptions) {
  const { db, events } = options
  const repo = new DocumentRepository(db, { ...options.repository, kind: 'media' })
  const nodes = new NodeRepository(db)
  const types = new ContentTypeRepository(db, { kind: 'media' })
  const nodeId = options.repository?.nodeId
  const changed = async () => {
    await options.onChange?.()
  }

  /** The change, its events and the cache instruction in one transaction (stories 171, 174). */
  const commit = async <T>(
    actor: Actor,
    write: (tx: DocumentRepository, txDb: Db) => Promise<T>,
    announce: (result: T) => readonly MediaEvent[],
  ): Promise<T> => {
    const recorded: MediaEvent[] = []
    const result = await repo.atomically(async (tx, txDb) => {
      const written = await write(tx, txDb)
      const said = announce(written)
      if (said.length > 0)
        await appendCacheInstruction(txDb, {
          kind: 'content',
          payload: { media: true },
          by: nodeId,
        })
      for (const event of said) {
        await events.record(txDb, event, actor)
        recorded.push(event)
      }
      return written
    })
    for (const event of recorded) events.afterCommit?.(event, actor)
    if (recorded.length > 0) await changed()
    return result
  }

  const userIdOf = async (actor: Actor): Promise<number | undefined> => {
    if (actor.kind !== 'user') return undefined
    const rows = await db.query<{ id: number }>('SELECT id FROM user_account WHERE key = ?', [
      actor.principal.id,
    ])
    return rows[0] ? Number(rows[0].id) : undefined
  }

  /** A media item and its media ancestors' keys, root first. */
  const placeOf = async (key: string) => {
    const node = await nodes.byKey(key)
    if (!node || node.objectType !== ObjectTypes.Media) return undefined
    const ids = node.path
      .split(',')
      .map(Number)
      .filter((id) => id > 0)
    const byId = new Map((await nodes.byIds(ids)).map((row) => [row.id, row]))
    const chain = ids.flatMap((id) => {
      const row = byId.get(id)
      return row && row.objectType === ObjectTypes.Media ? [row.key] : []
    })
    return { node, chain }
  }

  /** Whether the actor may change media at `key`, the root or the bin; only a user is checked. */
  const permits = async (actor: Actor, key: string | 'root' | 'bin'): Promise<boolean> => {
    if (actor.kind !== 'user') return true
    if (key === 'root' || key === 'bin') return mayChangeMedia(actor.principal, key)
    const place = await placeOf(key)
    if (!place) return mayChangeMedia(actor.principal, [])
    return mayChangeMedia(actor.principal, place.chain, place.node.trashed)
  }
  const forbidden = () => refuse('forbidden', 403, 'You may not do that to this media item.')

  /** Where an item of this type may go; the system acts on what was already decided. */
  const placement = async (actor: Actor, typeKey: string, parentKey: string | null) =>
    actor.kind === 'system' ? undefined : types.placementRefusal(typeKey, parentKey)
  const typeOf = async (key: string): Promise<string | undefined> => {
    const rows = await db.query<{ unique_id: string }>(
      `SELECT t.unique_id FROM node n JOIN content c ON c.node_id = n.id
       JOIN node t ON t.id = c.content_type_id WHERE n.unique_id = ?`,
      [normaliseUuid(key)],
    )
    return rows[0] ? normaliseUuid(String(rows[0].unique_id)) : undefined
  }

  /** The files a branch holds, read before its rows go. */
  const filesIn = async (root: NodeRow): Promise<string[]> => {
    const rows = await db.query<{ unique_id: string }>(
      'SELECT unique_id FROM node WHERE (id = ? OR path LIKE ?) AND node_object_type = ?',
      [root.id, `${root.path},%`, ObjectTypes.Media],
    )
    const found: string[] = []
    for (const row of rows) {
      const media = await repo.byKey(normaliseUuid(String(row.unique_id)))
      const file = media ? mediaFileOf(media) : null
      if (file) found.push(file)
    }
    return found
  }
  const removeFiles = async (paths: readonly string[]) => {
    for (const path of paths) await options.files?.remove(path)
  }

  /** Every item checked before any is written: the reasons each one cannot be moved there. */
  const moveBlockers = async (
    actor: Actor,
    targets: readonly NodeRow[],
    target: NodeRow | undefined,
  ) => {
    const blocked: Array<{ key: string; reasons: string[] }> = []
    for (const node of targets) {
      const reasons: string[] = []
      if (target && (target.id === node.id || `${target.path},`.startsWith(`${node.path},`)))
        reasons.push('A media item cannot move below itself.')
      const type = await typeOf(node.key)
      const misplaced = type ? await placement(actor, type, target?.key ?? null) : undefined
      if (misplaced) reasons.push(misplaced)
      if (reasons.length > 0) blocked.push({ key: node.key, reasons })
    }
    return blocked
  }

  /** The items the actor may not change, as one refusal naming each. */
  const deniedOf = async (
    actor: Actor,
    found: readonly NodeRow[],
    reason: string,
  ): Promise<(Refusal & { blocked: Array<{ key: string; reasons: string[] }> }) | undefined> => {
    const blocked: Array<{ key: string; reasons: string[] }> = []
    for (const node of found)
      if (!(await permits(actor, node.key))) blocked.push({ key: node.key, reasons: [reason] })
    if (blocked.length === 0) return undefined
    return {
      ...refuse(
        'forbidden',
        403,
        `You may not change ${blocked.length} of ${found.length} item(s), so nothing was changed.`,
      ),
      blocked,
    }
  }

  const nodesFor = async (keys: readonly string[]): Promise<NodeRow[] | Refusal> => {
    const out: NodeRow[] = []
    for (const key of keys) {
      const node = await nodes.byKey(key)
      if (!node || node.objectType !== ObjectTypes.Media) return refuse('notFound', 404, NOT_FOUND)
      if (!out.some((seen) => seen.id === node.id)) out.push(node)
    }
    return out
  }

  const operations = {
    async create(actor: Actor, input: MediaInput): Promise<Result<{ key: string }>> {
      if (!(await permits(actor, input.parentKey ?? 'root'))) return forbidden()
      const misplaced = await placement(actor, input.contentTypeKey, input.parentKey)
      if (misplaced) return refuse('invalid', 400, misplaced)
      try {
        const userId = await userIdOf(actor)
        const created = await commit(
          actor,
          (tx) => tx.create({ ...input, componentKey: null, userId }),
          (doc) => [{ type: 'created', key: doc.key }],
        )
        return { ok: true, key: created.key }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    /** Saves an item's values and names; its type and place stay as they are. */
    async save(actor: Actor, key: string, input: Omit<MediaInput, 'key'>): Promise<Result> {
      const before = await repo.byKey(key)
      if (!before) return refuse('notFound', 404, NOT_FOUND)
      if (!(await permits(actor, key))) return forbidden()
      try {
        const userId = await userIdOf(actor)
        const updated = await commit(
          actor,
          (tx) =>
            tx.update({
              ...input,
              key,
              contentTypeKey: before.contentTypeKey,
              parentKey: before.parentKey,
              componentKey: null,
              userId,
            }),
          (doc) => (doc ? [{ type: 'saved', key }] : []),
        )
        if (!updated) return refuse('notFound', 404, NOT_FOUND)
        // A replaced file is no longer anyone's: Umbraco deletes it too.
        const was = mediaFileOf(before)
        if (was && was !== mediaFileOf(updated)) await removeFiles([was])
        return { ok: true }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async trash(actor: Actor, key: string): Promise<Result> {
      const result = await operations.trashMany(actor, [key])
      return result.ok ? { ok: true } : result
    },

    /**
     * Moves several items to the recycle bin in one transaction, every one
     * checked first. One already there is unchanged; one below another in the
     * selection goes with it.
     */
    async trashMany(
      actor: Actor,
      keys: readonly string[],
      many: { dryRun?: boolean } = {},
    ): Promise<SelectionResult> {
      const found = await nodesFor(keys)
      if (!Array.isArray(found)) return found
      const denied = await deniedOf(actor, found, 'You may not delete this media item.')
      if (denied) return denied
      const covered = (node: NodeRow) =>
        found.some((other) => other.id !== node.id && `${node.path},`.startsWith(`${other.path},`))
      const writes = found.filter((node) => !node.trashed && !covered(node))
      const unchanged = found.filter((node) => node.trashed).map((node) => node.key)
      const changedKeys = found.filter((node) => !node.trashed).map((node) => node.key)
      if (many.dryRun || writes.length === 0) return { ok: true, changed: changedKeys, unchanged }
      await commit(
        actor,
        async (tx) => {
          const out: string[] = []
          for (const node of writes) if (await tx.moveToRecycleBin(node.key)) out.push(node.key)
          return out
        },
        (done) => done.map((key): MediaEvent => ({ type: 'trashed', key })),
      )
      return { ok: true, changed: changedKeys, unchanged }
    },

    /** Deletes an item and its branch for good, with their files; `fromBin` only one in the bin. */
    async delete(actor: Actor, key: string, deleting: { fromBin?: boolean } = {}): Promise<Result> {
      const node = await nodes.byKey(key)
      if (!node || node.objectType !== ObjectTypes.Media) return refuse('notFound', 404, NOT_FOUND)
      if (deleting.fromBin && !node.trashed)
        return refuse('invalid', 400, 'The media item is not in the recycle bin')
      if (!(await permits(actor, deleting.fromBin ? 'bin' : key))) return forbidden()
      const paths = await filesIn(node)
      const removed = await commit(
        actor,
        (tx) => tx.delete(key),
        (done) => (done ? [{ type: 'deleted', key, name: node.text ?? null }] : []),
      )
      if (!removed) return refuse('notFound', 404, NOT_FOUND)
      await removeFiles(paths)
      return { ok: true }
    },

    async emptyBin(actor: Actor): Promise<Result<{ deleted: number }>> {
      if (!(await permits(actor, 'bin'))) return forbidden()
      const roots = await repo.trashedRoots()
      const paths: string[] = []
      for (const node of roots) paths.push(...(await filesIn(node)))
      const gone = await commit(
        actor,
        async (tx) => {
          const out: Array<{ key: string; name: string | null }> = []
          for (const node of roots)
            if (await tx.delete(node.key)) out.push({ key: node.key, name: node.text ?? null })
          return out
        },
        (done): MediaEvent[] => [
          ...done.map((node): MediaEvent => ({ type: 'deleted', ...node })),
          { type: 'binEmptied' },
        ],
      )
      await removeFiles(paths)
      return { ok: true, deleted: gone.length }
    },

    async restore(
      actor: Actor,
      key: string,
      targetKey: string | null | undefined,
    ): Promise<Result> {
      if (!(await permits(actor, 'bin'))) return forbidden()
      if (targetKey !== undefined) {
        const type = await typeOf(key)
        const misplaced = type ? await placement(actor, type, targetKey) : undefined
        if (misplaced) return refuse('invalid', 400, misplaced)
      }
      const result = await commit(
        actor,
        (tx) => tx.restore(key, targetKey),
        (done) => (done === 'restored' ? [{ type: 'restored', key }] : []),
      )
      if (result === 'notFound')
        return refuse('notFound', 404, 'The media item is not in the recycle bin.')
      if (result === 'invalid')
        return refuse('invalid', 400, 'The restore target does not exist or is in the recycle bin.')
      return { ok: true }
    },

    async move(actor: Actor, key: string, targetKey: string | null): Promise<Result> {
      const result = await operations.moveMany(actor, [key], targetKey)
      if (result.ok) return { ok: true }
      const first = 'blocked' in result ? result.blocked?.[0]?.reasons[0] : undefined
      return first ? { ...result, reason: first } : result
    },

    /**
     * Moves several items under `targetKey` (null: the top level) in one
     * transaction, every one checked first. One already there is unchanged.
     */
    async moveMany(
      actor: Actor,
      keys: readonly string[],
      targetKey: string | null,
      many: { dryRun?: boolean } = {},
    ): Promise<SelectionResult> {
      const found = await nodesFor(keys)
      if (!Array.isArray(found)) return found
      const target = targetKey ? await nodes.byKey(targetKey) : undefined
      if (targetKey && (!target || target.objectType !== ObjectTypes.Media))
        return refuse('notFound', 404, 'The media item or target could not be found.')
      if (target?.trashed) return refuse('invalid', 400, "Media can't move into the recycle bin.")
      if (!(await permits(actor, target?.key ?? 'root'))) return forbidden()
      const denied = await deniedOf(actor, found, 'You may not move this media item.')
      if (denied) return denied
      const blocked = await moveBlockers(actor, found, target)
      if (blocked.length > 0)
        return {
          ...refuse(
            'invalid',
            400,
            `${blocked.length} of ${found.length} item(s) cannot be moved there, so nothing was moved.`,
          ),
          blocked,
        }
      const parentId = target?.id ?? SystemNodes.Root
      const stays = (node: NodeRow) => !node.trashed && node.parentId === parentId
      const writes = found.filter((node) => !stays(node))
      const unchanged = found.filter(stays).map((node) => node.key)
      if (many.dryRun || writes.length === 0)
        return { ok: true, changed: writes.map((node) => node.key), unchanged }
      try {
        const done = await commit(
          actor,
          async (tx) => {
            const out: string[] = []
            for (const node of writes)
              if ((await tx.move(node.key, targetKey)) === 'moved') out.push(node.key)
            return out
          },
          (moved) => moved.map((key): MediaEvent => ({ type: 'moved', key })),
        )
        return { ok: true, changed: done, unchanged }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async sort(
      actor: Actor,
      parentKey: string | null,
      sorting: ReadonlyArray<{ key: string; sortOrder: number }>,
      sortOptions: { dryRun?: boolean } = {},
    ): Promise<Result> {
      if (!(await permits(actor, parentKey ?? 'root'))) return forbidden()
      for (const item of sorting) if (!(await permits(actor, item.key))) return forbidden()
      if (sortOptions.dryRun) {
        const parentId = parentKey ? (await nodes.byKey(parentKey))?.id : SystemNodes.Root
        const children = await nodes.byKeys(sorting.map((item) => item.key))
        const fits =
          parentId !== undefined &&
          children.length === sorting.length &&
          children.every(
            (node) => node.objectType === ObjectTypes.Media && node.parentId === parentId,
          )
        return fits
          ? { ok: true }
          : refuse('notFound', 404, 'The parent, or one of the items, could not be found under it.')
      }
      const result = await commit(
        actor,
        (tx) => tx.sort(parentKey, sorting),
        (done) => (done === 'sorted' ? [{ type: 'sorted', parentKey }] : []),
      )
      return result === 'sorted'
        ? { ok: true }
        : refuse('notFound', 404, 'The parent, or one of the items, could not be found under it.')
    },

    async sortChildrenBy(
      actor: Actor,
      parentKey: string | null,
      field: 'Name' | 'CreateDate' | 'UpdateDate',
      direction: 'Ascending' | 'Descending',
    ): Promise<Result> {
      if (!(await permits(actor, parentKey ?? 'root'))) return forbidden()
      const result = await commit(
        actor,
        (tx) => tx.sortChildrenBy(parentKey, field, direction),
        (done) => (done === 'sorted' ? [{ type: 'sorted', parentKey }] : []),
      )
      return result === 'sorted' ? { ok: true } : refuse('notFound', 404, NOT_FOUND)
    },

    /** The repository these operations write through, for reads that go with them. */
    repository: repo,
  }
  return operations
}
