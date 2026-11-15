/**
 * Every Library write, once (story 361), as `operations.ts` is for pages and
 * `media-operations.ts` for media: the back office and the command line call
 * these, so a write follows the same rules whoever starts it — the Library
 * verbs a user's groups hold, and one transaction holding the change, its audit
 * entry and the cache instruction.
 *
 * The storage beneath is the elements adapter, which keeps the menu alias rule
 * and appends the cache instruction. The Library has no approvals and no start
 * nodes, so what is decided here is who may, and what is recorded.
 */
import type { DocumentValidationError } from '@crombolo/core'
import { type Db, Locks } from '@crombolo/data'
import { type Actor, actorUserKey } from './actor.ts'
import type { ElementEvent, ElementEventSink } from './events.ts'
import type { DocumentInput, Refusal, Result, ScheduleEntry } from './operations.ts'
import { type ElementWriteKind, mayInLibrary } from './policy.ts'

/** An element as a save sends it; it has no template, whatever `componentKey` says. */
export type ElementInput = DocumentInput

/** Whom a version names as its author: a user, by key. */
export type ElementAuthor = { id: string } | null

/** A storage write that did not happen, and why. */
export interface StoreFailure {
  ok: false
  reason: string
  status?: number
  errors?: DocumentValidationError[]
}

/** The writes beneath the operations, on one database handle: the elements adapter. */
export interface ElementStore {
  create(
    input: ElementInput,
    author: ElementAuthor,
  ): Promise<{ ok: true; key: string } | StoreFailure>
  update(
    key: string,
    input: ElementInput,
    author: ElementAuthor,
  ): Promise<{ ok: true } | StoreFailure>
  createAndPublish(
    input: ElementInput,
    cultures: string[] | null,
    author: ElementAuthor,
  ): Promise<{ ok: true; key: string } | StoreFailure>
  updateAndPublish(
    key: string,
    input: ElementInput,
    cultures: string[] | null,
    author: ElementAuthor,
  ): Promise<{ ok: true } | StoreFailure>
  publish(
    key: string,
    cultures: string[] | null,
    schedules?: readonly ScheduleEntry[],
  ): Promise<{ ok: true; scheduledOnly: boolean } | StoreFailure>
  unpublish(key: string, cultures: string[] | null): Promise<{ ok: true } | StoreFailure>
  copy(
    key: string,
    targetKey: string | null,
    options: { includeDescendants: boolean },
    author: ElementAuthor,
  ): Promise<{ ok: true; key: string } | StoreFailure>
  move(key: string, targetKey: string | null): Promise<{ ok: true } | StoreFailure>
  moveToRecycleBin(key: string): Promise<boolean>
  moveFolder(key: string, targetKey: string | null): Promise<{ ok: true } | StoreFailure>
  folderToRecycleBin(key: string): Promise<boolean>
  folders: {
    createFolder(input: {
      key?: string
      name: string
      parentKey: string | null
    }): Promise<{ key: string }>
    renameFolder(key: string, name: string): Promise<boolean>
  }
}

export interface ElementOperationsOptions {
  db: Db
  /** The storage on a handle: the operations hand it the change's transaction. */
  store(db: Db): ElementStore
  events: ElementEventSink
  /** Told after every committed change, for a cache held in this process. */
  onChange?(): void | Promise<void>
}

export type ElementOperations = ReturnType<typeof createElementOperations>

const FORBIDDEN = 'You may not do that in the Library.'

/** A storage failure as a refusal, its status kept for the transport. */
function refusalOf(failure: StoreFailure): Refusal {
  const status = failure.status ?? 400
  const kind: Refusal['kind'] = failure.errors
    ? 'validation'
    : status === 404
      ? 'notFound'
      : status === 403
        ? 'forbidden'
        : status === 409
          ? 'conflict'
          : 'invalid'
  return {
    ok: false,
    kind,
    status,
    reason: failure.reason,
    ...(failure.errors ? { errors: failure.errors } : {}),
  }
}

/** Thrown inside a write's transaction so a refused write leaves nothing behind. */
class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.reason)
  }
}

export function createElementOperations(options: ElementOperationsOptions) {
  const { db, events } = options

  /**
   * Whether the actor may do `kind` in the Library. Only a user is checked: an
   * operator holds the database and the system acts on what was already decided.
   */
  const permits = (actor: Actor, kind: ElementWriteKind): boolean =>
    actor.kind !== 'user' || mayInLibrary(actor.principal, kind)

  const authorOf = (actor: Actor): ElementAuthor => {
    const key = actorUserKey(actor)
    return key ? { id: key } : null
  }

  /**
   * The write, its events and the cache instruction in one transaction: a
   * refused write rolls back whatever it began. What only a running server does
   * follows the commit.
   */
  const commit = async <T extends object>(
    actor: Actor,
    kind: ElementWriteKind,
    write: (store: ElementStore) => Promise<({ ok: true } & T) | StoreFailure>,
    announce: (done: { ok: true } & T) => ElementEvent,
  ): Promise<Result<T>> => {
    if (!permits(actor, kind))
      return { ok: false, kind: 'forbidden', status: 403, reason: FORBIDDEN }
    let event: ElementEvent | undefined
    try {
      // The tree lock before the transaction, as every page and element write takes them.
      const done = await db.locks.withLock(Locks.ContentTree, () =>
        db.transaction(async (tx) => {
          const result = await write(options.store(tx))
          if (!result.ok) throw new Refused(refusalOf(result))
          event = announce(result)
          await events.record(tx, event, actor)
          return result
        }),
      )
      if (event) events.afterCommit?.(event, actor)
      await options.onChange?.()
      return done as Result<T>
    } catch (error) {
      if (error instanceof Refused) return error.refusal
      throw error
    }
  }

  /** A write the storage answers with true or false: false is not found. */
  const found = (done: boolean, reason: string): { ok: true } | StoreFailure =>
    done ? { ok: true } : { ok: false, reason, status: 404 }

  return {
    create: (actor: Actor, input: ElementInput) =>
      commit(
        actor,
        'create',
        (store) => store.create(input, authorOf(actor)),
        (done) => ({ type: 'created', key: done.key }),
      ),

    save: (actor: Actor, key: string, input: ElementInput) =>
      commit(
        actor,
        'save',
        (store) => store.update(key, input, authorOf(actor)),
        () => ({ type: 'saved', key }),
      ),

    createAndPublish: (actor: Actor, input: ElementInput, cultures: string[] | null) =>
      commit(
        actor,
        'createAndPublish',
        (store) => store.createAndPublish(input, cultures, authorOf(actor)),
        (done) => ({ type: 'createdAndPublished', key: done.key }),
      ),

    saveAndPublish: (actor: Actor, key: string, input: ElementInput, cultures: string[] | null) =>
      commit(
        actor,
        'saveAndPublish',
        (store) => store.updateAndPublish(key, input, cultures, authorOf(actor)),
        () => ({ type: 'savedAndPublished', key }),
      ),

    /** Publishes now, or schedules: a publish time still to come schedules that culture. */
    publish: (
      actor: Actor,
      key: string,
      cultures: string[] | null,
      schedules: readonly ScheduleEntry[] = [],
    ) =>
      commit(
        actor,
        'publish',
        (store) => store.publish(key, cultures, schedules),
        () => ({ type: 'published', key }),
      ),

    unpublish: (actor: Actor, key: string, cultures: string[] | null) =>
      commit(
        actor,
        'unpublish',
        (store) => store.unpublish(key, cultures),
        () => ({ type: 'unpublished', key }),
      ),

    copy: (
      actor: Actor,
      key: string,
      targetKey: string | null,
      copyOptions: { includeDescendants: boolean } = { includeDescendants: false },
    ) =>
      commit(
        actor,
        'copy',
        (store) => store.copy(key, targetKey, copyOptions, authorOf(actor)),
        (done) => ({ type: 'copied', key, copyKey: done.key }),
      ),

    move: (actor: Actor, key: string, targetKey: string | null) =>
      commit(
        actor,
        'move',
        (store) => store.move(key, targetKey),
        () => ({ type: 'moved', key }),
      ),

    trash: (actor: Actor, key: string) =>
      commit(
        actor,
        'trash',
        async (store) =>
          found(await store.moveToRecycleBin(key), 'The element could not be found.'),
        () => ({ type: 'trashed', key }),
      ),

    createFolder: (actor: Actor, input: { key?: string; name: string; parentKey: string | null }) =>
      commit(
        actor,
        'createFolder',
        async (store) => ({ ok: true as const, ...(await store.folders.createFolder(input)) }),
        (done) => ({ type: 'folderCreated', key: done.key }),
      ),

    renameFolder: (actor: Actor, key: string, name: string) =>
      commit(
        actor,
        'renameFolder',
        async (store) =>
          found(await store.folders.renameFolder(key, name), 'The folder could not be found.'),
        () => ({ type: 'folderRenamed', key }),
      ),

    moveFolder: (actor: Actor, key: string, targetKey: string | null) =>
      commit(
        actor,
        'moveFolder',
        (store) => store.moveFolder(key, targetKey),
        () => ({ type: 'folderMoved', key }),
      ),

    trashFolder: (actor: Actor, key: string) =>
      commit(
        actor,
        'trashFolder',
        async (store) =>
          found(await store.folderToRecycleBin(key), 'The folder could not be found.'),
        () => ({ type: 'folderTrashed', key }),
      ),
  }
}
