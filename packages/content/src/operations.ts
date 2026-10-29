/**
 * Every document write, once (story 170). The backoffice, the command line, the
 * scheduled job, approvals and form workflows all call these, so a write follows
 * the same rules whoever starts it: the actor's permissions, the approval gate,
 * one transaction, redirect tracking, and one event for the transport to announce.
 *
 * The repository keeps the SQL, the locking and the publish rules that guard
 * every path (published ancestors, mandatory languages, filled mandatory fields).
 * What it does not decide — who may, and whether a page needs approval — is here.
 * docs/architecture.md, "Content writes".
 */
import type { DocumentValidationError, DocumentValue } from '@crombolo/core'
import { normaliseUuid, SystemNodes } from '@crombolo/core'
import {
  appendCacheInstruction,
  ContentTypeRepository,
  type Db,
  DocumentRepository,
  type DocumentRepositoryOptions,
  DomainRepository,
  InvalidParentError,
  NodeRepository,
  type NodeRow,
  PublicAccessRepository,
  PublishBlockedError,
  type SetDomainsResult,
  StaleRevisionError,
  sql,
  WriteRejectedError,
} from '@crombolo/data'
import type { Actor, ContentPrincipal } from './actor.ts'
import type { DocumentEvent, EventSink } from './events.ts'
import {
  deniedPropertyWrite,
  mayAt,
  mayUseCultures,
  WRITE_VERBS,
  type WriteKind,
  writesEveryProperty,
} from './policy.ts'

/** A page as a save sends it. */
export interface DocumentInput {
  key: string
  contentTypeKey: string
  componentKey: string | null
  parentKey: string | null
  values: DocumentValue[]
  variants: Array<{ culture: string | null; segment: string | null; name: string }>
}

export interface ScheduleEntry {
  culture: string | null
  publishTime: Date | null
  unpublishTime: Date | null
}

/** Why an operation did nothing: the transport turns `kind` into its own answer. */
export interface Refusal {
  ok: false
  kind:
    | 'notFound'
    | 'forbidden'
    | 'needsApproval'
    | 'invalid'
    | 'conflict'
    | 'blocked'
    | 'validation'
    /** The page changed after the copy the write was based on (412). */
    | 'stale'
    /** A user's write named no revision to check against (428). */
    | 'revisionRequired'
  status: number
  reason: string
  errors?: DocumentValidationError[]
}

export type Done<T extends object = object> = { ok: true } & T
export type Result<T extends object = object> = Done<T> | Refusal

/** Why each item of a selection cannot be written; any one of them stops the whole selection. */
export type Blocked = Array<{ key: string; reasons: string[] }>

/**
 * What a write over several items did: the items it changed (or, in a dry run,
 * would change) and those already as asked; or, refused, each item's reasons.
 */
export type SelectionResult =
  | Done<{ changed: string[]; unchanged: string[] }>
  | (Refusal & { blocked?: Blocked })

/**
 * The approval workflows' say over a write (story 028). `who` is the user, or
 * undefined for a local operator, who has no publishing rights of their own.
 */
export interface ApprovalsGate {
  publishRefusal(
    who: ContentPrincipal | undefined,
    key: string,
    action: 'publish' | 'unpublish',
  ): Promise<string | undefined>
  branchRefusal(who: ContentPrincipal | undefined, key: string): Promise<string | undefined>
  newPageRefusal(
    who: ContentPrincipal | undefined,
    parentKey: string | null,
    contentTypeKey: string,
  ): Promise<string | undefined>
  beforeSave(who: ContentPrincipal | undefined, key: string): Promise<string | undefined>
  afterSave(who: ContentPrincipal | undefined, key: string): Promise<void>
  /** A publish, schedule or unpublish that passed the gate supersedes a scheduled request. */
  afterDirectPublish(who: ContentPrincipal | undefined, key: string, what: string): Promise<void>
}

/** Records redirects from the addresses a page had, once it has new ones. */
export interface RedirectTracking {
  capture(key: string): Promise<unknown>
  captureChildren(parentKey: string | null): Promise<unknown>
  commit(before: unknown): Promise<void>
}

export interface DocumentOperationsOptions {
  db: Db
  repository?: DocumentRepositoryOptions
  events: EventSink
  approvals?: ApprovalsGate
  redirects?: RedirectTracking
  /** Told after every committed change, for a cache held in this process. */
  onChange?(): void
  /**
   * After a page's hostnames were saved: a site that keeps `domains.toml` writes
   * them there too. Answers the file it wrote, if any.
   */
  afterDomains?(node: NodeRow, assignment: DomainAssignment): Promise<string | undefined>
  /**
   * Errors a value's intake throws that are the sender's to fix — an upload that
   * expired — as the reason to give; anything else not a rule is thrown on.
   */
  refusalReason?(error: unknown): string | undefined
}

export interface DomainAssignment {
  defaultIsoCode: string | null
  domains: Array<{ domainName: string; isoCode: string }>
}

export interface PublicAccessInput {
  loginDocumentKey: string
  errorDocumentKey: string
  memberGroupNames: string[]
  memberUserNames: string[]
}

export type PublicAccessStatus =
  | 'ok'
  | 'content-not-found'
  | 'login-node-not-found'
  | 'error-node-not-found'
  | 'entry-not-found'
  | 'forbidden'

const NOT_FOUND = 'The document could not be found.'
const STALE =
  'Someone else changed this page after you opened it. Your changes have not been saved; copy what you need, then reload the page to see theirs.'
const REVISION_REQUIRED =
  'Read the page first and send back the revision it came with (its ETag, as If-Match), so a newer change is not overwritten.'

/** What a write was based on (story 172). */
export interface Precondition {
  /** The page's revision when the copy being saved was read. */
  expectedRevision?: string
  /** The sender said to replace whatever is there (`If-Match: *`): checked by no revision. */
  overwrite?: boolean
}

const refuse = (kind: Refusal['kind'], status: number, reason: string): Refusal => ({
  ok: false,
  kind,
  status,
  reason,
})

/** A write the repository refused as a rule, as a refusal; anything else is thrown on. */
function refusalFrom(error: unknown, extra?: (error: unknown) => string | undefined): Refusal {
  if (error instanceof WriteRejectedError) return refuse('conflict', 409, error.message)
  if (error instanceof InvalidParentError) return refuse('invalid', 400, error.message)
  if (error instanceof PublishBlockedError) return refuse('blocked', 400, error.message)
  if (error instanceof StaleRevisionError) return refuse('stale', 412, STALE)
  const reason = extra?.(error)
  if (reason) return refuse('invalid', 400, reason)
  throw error
}

export type DocumentOperations = ReturnType<typeof createDocumentOperations>

export function createDocumentOperations(options: DocumentOperationsOptions) {
  const { db, events } = options
  const repo = new DocumentRepository(db, options.repository)
  const nodes = new NodeRepository(db)
  const types = new ContentTypeRepository(db, {
    kind: repo.kind === 'media' ? 'media' : 'document',
  })
  const changed = () => options.onChange?.()

  /**
   * Writes and records in one transaction (story 171): the change, its audit
   * entry and what it announces commit together or not at all. What only a
   * running server does follows the commit.
   */
  const commit = async <T>(
    actor: Actor,
    write: (tx: DocumentRepository, txDb: Db) => Promise<T>,
    announce: (result: T) => readonly DocumentEvent[],
  ): Promise<T> => {
    const recorded: DocumentEvent[] = []
    const result = await repo.atomically(async (tx, txDb) => {
      const written = await write(tx, txDb)
      for (const event of announce(written)) {
        await events.record(txDb, event, actor)
        recorded.push(event)
      }
      return written
    })
    for (const event of recorded) events.afterCommit?.(event, actor)
    return result
  }

  /** The version author: the user's row, when the actor is one. */
  const userIdOf = async (actor: Actor): Promise<number | undefined> => {
    if (actor.kind !== 'user') return undefined
    const rows = await db.q
      .selectFrom('user_account')
      .select('id')
      .where('key', '=', actor.principal.id)
      .execute()
    return rows[0] ? Number(rows[0].id) : undefined
  }

  /** A document's place: its ancestors' keys then its own, root first. */
  const placeOf = async (
    key: string,
  ): Promise<{ node: NodeRow; chain: string[]; trashed: boolean } | undefined> => {
    const node = await nodes.byKey(key)
    if (!node || node.objectType !== repo.objectType) return undefined
    const ids = node.path
      .split(',')
      .map(Number)
      .filter((id) => id > 0)
    const byId = new Map((await nodes.byIds(ids)).map((row) => [row.id, row]))
    const chain = ids.flatMap((id) => {
      const row = byId.get(id)
      return row && row.objectType === repo.objectType ? [row.key] : []
    })
    return { node, chain, trashed: node.trashed }
  }

  /**
   * Whether the actor may do `kind` at `key` (or the root, or the bin). Only a
   * user is checked: an operator holds the database and the system acts on what
   * was already decided. A page that does not exist is not refused here: the
   * operation answers that it is not found.
   */
  const permits = async (
    actor: Actor,
    kind: WriteKind,
    key: string | 'root' | 'bin',
  ): Promise<boolean> => {
    // A member acts on media only (story 198); the type says so, and this holds without it.
    if ((actor as { kind: string }).kind === 'member') return false
    if (actor.kind !== 'user') return true
    if (key === 'root' || key === 'bin') return mayAt(actor.principal, WRITE_VERBS[kind], key)
    const place = await placeOf(key)
    if (!place) return true
    return mayAt(actor.principal, WRITE_VERBS[kind], place.chain, place.trashed)
  }

  const forbidden = () => refuse('forbidden', 403, 'You may not do that to this page.')
  /** A user replaces a draft only from a copy whose revision is checked; the site acts on the head. */
  const revisionRefusal = (actor: Actor, precondition: Precondition): Refusal | undefined =>
    actor.kind === 'user' && precondition.expectedRevision === undefined && !precondition.overwrite
      ? refuse('revisionRequired', 428, REVISION_REQUIRED)
      : undefined

  /** Whether the actor may work in these languages; only a user is limited to some. */
  const languagesAllowed = (actor: Actor, cultures: readonly string[] | null) =>
    actor.kind !== 'user' || !cultures || mayUseCultures(actor.principal, cultures)

  /** The cultures a save names, so a user is held to their languages. */
  const culturesSaved = (input: Pick<DocumentInput, 'variants' | 'values'>) => [
    ...new Set([...input.variants, ...input.values].flatMap((v) => (v.culture ? [v.culture] : []))),
  ]

  /** The approval gate, as the actor meets it; `skip` for the system and an operator who chose to. */
  const gateFor = (actor: Actor): { skip: boolean; who: ContentPrincipal | undefined } => {
    if (actor.kind === 'user') return { skip: false, who: actor.principal }
    if (actor.kind === 'operator') return { skip: actor.skipApproval === true, who: undefined }
    return { skip: true, who: undefined }
  }
  const needsApproval = (reason: string) => refuse('needsApproval', 400, reason)

  /** A user may not change a property their groups only read (story 088). */
  const propertyRefusal = async (
    actor: Actor,
    properties: Array<{ alias: string; key: string; name: string }> | undefined,
    before: readonly DocumentValue[],
    after: readonly DocumentValue[],
  ): Promise<Refusal | undefined> => {
    if (actor.kind !== 'user' || !properties || writesEveryProperty(actor.principal))
      return undefined
    const denied = deniedPropertyWrite(actor.principal, properties, before, after)
    return denied
      ? refuse('forbidden', 403, `You may not change "${denied.name}" (${denied.alias}).`)
      : undefined
  }

  /** The properties a page of this type has, compositions included, for the property check. */
  const propertiesOfType = async (contentTypeKey: string) => {
    const type = await nodes.byKey(contentTypeKey)
    if (!type) return undefined
    const rows = await db.q
      .withRecursive('ancestry(id)', (qb) =>
        qb
          .selectNoFrom(sql<number>`${type.id}`.as('id'))
          .union(
            qb
              .selectFrom('content_type_composition as c')
              .innerJoin('ancestry as a', 'a.id', 'c.child_content_type_id')
              .select('c.parent_content_type_id as id'),
          ),
      )
      .selectFrom('property_type as p')
      .select(['p.alias', 'p.unique_id', 'p.name'])
      .where('p.content_type_id', 'in', (eb) => eb.selectFrom('ancestry').select('id'))
      .where('p.retired_at', 'is', null)
      .execute()
    return rows.map((row) => ({
      alias: String(row.alias),
      key: normaliseUuid(String(row.unique_id)),
      name: String(row.name),
    }))
  }

  /** Where a page of this type may go; the system acts on what was already decided. */
  const placement = async (actor: Actor, typeKey: string, parentKey: string | null) =>
    actor.kind === 'system' || repo.kind === 'blueprint'
      ? undefined
      : types.placementRefusal(typeKey, parentKey)
  const typeOf = async (key: string): Promise<string | undefined> => {
    const rows = await db.q
      .selectFrom('node as n')
      .innerJoin('content as c', 'c.node_id', 'n.id')
      .innerJoin('node as t', 't.id', 'c.content_type_id')
      .select('t.unique_id')
      .where('n.unique_id', '=', normaliseUuid(key))
      .execute()
    return rows[0] ? normaliseUuid(String(rows[0].unique_id)) : undefined
  }
  const misplacedAt = async (actor: Actor, key: string, parentKey: string | null) => {
    const type = await typeOf(key)
    return type ? placement(actor, type, parentKey) : undefined
  }

  /** The selection's pages, each once, or the refusal for one that is not a page. */
  const pagesFor = async (keys: readonly string[]): Promise<NodeRow[] | Refusal> => {
    const out: NodeRow[] = []
    for (const key of keys) {
      const node = await nodes.byKey(key)
      if (!node || node.objectType !== repo.objectType) return refuse('notFound', 404, NOT_FOUND)
      if (!out.some((seen) => seen.id === node.id)) out.push(node)
    }
    return out
  }

  /** The pages of a selection the actor may not `kind`, as one refusal naming each. */
  const deniedOf = async (
    actor: Actor,
    kind: WriteKind,
    found: readonly NodeRow[],
  ): Promise<(Refusal & { blocked: Blocked }) | undefined> => {
    const blocked: Blocked = []
    for (const node of found)
      if (!(await permits(actor, kind, node.key)))
        blocked.push({ key: node.key, reasons: ['You may not do that to this page.'] })
    if (blocked.length === 0) return undefined
    return {
      ...refuse(
        'forbidden',
        403,
        found.length === 1
          ? 'You may not do that to this page.'
          : `You may not change ${blocked.length} of ${found.length} page(s), so nothing was changed.`,
      ),
      blocked,
    }
  }

  /**
   * Moves pages under `targetKey` (null: the top level) in one transaction,
   * every one checked first; one already there is unchanged.
   */
  const moveMany = async (
    actor: Actor,
    keys: readonly string[],
    targetKey: string | null,
    many: { dryRun?: boolean } = {},
  ): Promise<SelectionResult> => {
    const found = await pagesFor(keys)
    if (!Array.isArray(found)) return found
    const target = targetKey ? await nodes.byKey(targetKey) : undefined
    if (targetKey && (!target || target.objectType !== repo.objectType))
      return refuse('notFound', 404, 'The document or target could not be found.')
    const denied = await deniedOf(actor, 'move', found)
    if (denied) return denied
    if (!(await permits(actor, 'intoTarget', targetKey ?? 'root'))) return forbidden()
    const blocked: Blocked = []
    for (const node of found) {
      const reasons: string[] = []
      if (
        target &&
        (target.trashed || target.id === node.id || `${target.path},`.startsWith(`${node.path},`))
      )
        reasons.push('A document cannot be moved below itself or into the recycle bin.')
      const misplaced = await misplacedAt(actor, node.key, targetKey)
      if (misplaced) reasons.push(misplaced)
      if (reasons.length > 0) blocked.push({ key: node.key, reasons })
    }
    if (blocked.length > 0)
      return {
        ...refuse(
          'invalid',
          400,
          found.length === 1
            ? (blocked[0]?.reasons[0] as string)
            : `${blocked.length} of ${found.length} page(s) cannot be moved there, so nothing was moved.`,
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
      const befores: unknown[] = []
      for (const node of writes) befores.push(await options.redirects?.capture(node.key))
      const done = await commit(
        actor,
        async (tx) => {
          const out: string[] = []
          for (const node of writes)
            if ((await tx.move(node.key, targetKey)) === 'moved') out.push(node.key)
          return out
        },
        (moved) => moved.map((key): DocumentEvent => ({ type: 'moved', key })),
      )
      changed()
      for (const before of befores) await options.redirects?.commit(before)
      return { ok: true, changed: done, unchanged }
    } catch (error) {
      return refusalFrom(error, options.refusalReason)
    }
  }

  /**
   * Moves pages to the recycle bin in one transaction, every one checked first.
   * One already there is unchanged; one below another in the selection goes
   * with it.
   */
  const trashMany = async (
    actor: Actor,
    keys: readonly string[],
    many: { dryRun?: boolean } = {},
  ): Promise<SelectionResult> => {
    const found = await pagesFor(keys)
    if (!Array.isArray(found)) return found
    const denied = await deniedOf(actor, 'trash', found)
    if (denied) return denied
    const covered = (node: NodeRow) =>
      found.some((other) => other.id !== node.id && `${node.path},`.startsWith(`${other.path},`))
    const writes = found.filter((node) => !node.trashed && !covered(node))
    const changedKeys = found.filter((node) => !node.trashed).map((node) => node.key)
    const unchanged = found.filter((node) => node.trashed).map((node) => node.key)
    if (many.dryRun || writes.length === 0) return { ok: true, changed: changedKeys, unchanged }
    await commit(
      actor,
      async (tx) => {
        const out: string[] = []
        for (const node of writes) if (await tx.moveToRecycleBin(node.key)) out.push(node.key)
        return out
      },
      (done) => done.map((key): DocumentEvent => ({ type: 'trashed', key })),
    )
    changed()
    return { ok: true, changed: changedKeys, unchanged }
  }

  const validationRefusal = (errors: DocumentValidationError[]): Refusal => ({
    ...refuse('validation', 400, 'One or more properties did not pass validation'),
    errors,
  })

  return {
    async create(actor: Actor, input: DocumentInput): Promise<Result<{ key: string }>> {
      if (!(await permits(actor, 'create', input.parentKey ?? 'root'))) return forbidden()
      if (!languagesAllowed(actor, culturesSaved(input))) return forbidden()
      const denied = await propertyRefusal(
        actor,
        await propertiesOfType(input.contentTypeKey),
        [],
        input.values,
      )
      if (denied) return denied
      const misplaced = await placement(actor, input.contentTypeKey, input.parentKey)
      if (misplaced) return refuse('invalid', 400, misplaced)
      try {
        const userId = await userIdOf(actor)
        const created = await commit(
          actor,
          (tx) => tx.create({ ...input, userId }),
          (doc) => [{ type: 'created', key: doc.key }],
        )
        changed()
        return { ok: true, key: created.key }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async save(
      actor: Actor,
      key: string,
      input: DocumentInput,
      precondition: Precondition = {},
    ): Promise<Result<{ revision?: string }>> {
      const existing = await repo.byKey(key)
      if (!existing) return refuse('notFound', 404, NOT_FOUND)
      if (!(await permits(actor, 'save', key))) return forbidden()
      if (!languagesAllowed(actor, culturesSaved(input))) return forbidden()
      const denied = await propertyRefusal(
        actor,
        await repo.propertyTypeKeys(key),
        existing.values,
        input.values,
      )
      if (denied) return denied
      const unbased = revisionRefusal(actor, precondition)
      if (unbased) return unbased
      const gate = gateFor(actor)
      if (!gate.skip) {
        const waiting = await options.approvals?.beforeSave(gate.who, key)
        if (waiting) return needsApproval(waiting)
      }
      try {
        const userId = await userIdOf(actor)
        const updated = await commit(
          actor,
          (tx) =>
            tx.update({
              ...input,
              key,
              // The content type never changes on a save.
              contentTypeKey: existing.contentTypeKey,
              userId,
              expectedRevision: precondition.expectedRevision,
            }),
          (doc) => (doc ? [{ type: 'saved', key }] : []),
        )
        if (!updated) return refuse('notFound', 404, NOT_FOUND)
        changed()
        if (!gate.skip) await options.approvals?.afterSave(gate.who, key)
        return { ok: true, revision: updated.revision }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async createAndPublish(
      actor: Actor,
      input: DocumentInput,
      cultures: string[] | null,
    ): Promise<Result<{ key: string }>> {
      if (!(await permits(actor, 'publish', input.parentKey ?? 'root'))) return forbidden()
      if (!languagesAllowed(actor, cultures) || !languagesAllowed(actor, culturesSaved(input)))
        return forbidden()
      const denied = await propertyRefusal(
        actor,
        await propertiesOfType(input.contentTypeKey),
        [],
        input.values,
      )
      if (denied) return denied
      const misplaced = await placement(actor, input.contentTypeKey, input.parentKey)
      if (misplaced) return refuse('invalid', 400, misplaced)
      const gate = gateFor(actor)
      if (!gate.skip) {
        const refusal = await options.approvals?.newPageRefusal(
          gate.who,
          input.parentKey,
          input.contentTypeKey,
        )
        if (refusal) return needsApproval(refusal)
      }
      const errors = await repo.validate(input, cultures)
      if (errors.length > 0) return validationRefusal(errors)
      try {
        const userId = await userIdOf(actor)
        // One transaction: a page that cannot be published is not left behind as a draft.
        const result = await commit(
          actor,
          (tx) => tx.createAndPublish({ ...input, userId }, cultures),
          (done) =>
            done.ok ? [{ type: 'createdAndPublished', key: done.document.key, cultures }] : [],
        )
        if (!result.ok) return validationRefusal(result.errors)
        changed()
        return { ok: true, key: result.document.key }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async saveAndPublish(
      actor: Actor,
      key: string,
      input: DocumentInput,
      cultures: string[] | null,
      precondition: Precondition = {},
    ): Promise<Result<{ revision?: string }>> {
      const existing = await repo.byKey(key)
      if (!existing) return refuse('notFound', 404, NOT_FOUND)
      if (!(await permits(actor, 'publish', key))) return forbidden()
      if (!languagesAllowed(actor, cultures) || !languagesAllowed(actor, culturesSaved(input)))
        return forbidden()
      const denied = await propertyRefusal(
        actor,
        await repo.propertyTypeKeys(key),
        existing.values,
        input.values,
      )
      if (denied) return denied
      const unbased = revisionRefusal(actor, precondition)
      if (unbased) return unbased
      const gate = gateFor(actor)
      if (!gate.skip) {
        const refusal =
          (await options.approvals?.beforeSave(gate.who, key)) ??
          (await options.approvals?.publishRefusal(gate.who, key, 'publish'))
        if (refusal) return needsApproval(refusal)
      }
      try {
        const before = await options.redirects?.capture(key)
        const userId = await userIdOf(actor)
        const result = await commit(
          actor,
          (tx) =>
            tx.updateAndPublish(
              { ...input, key, userId, expectedRevision: precondition.expectedRevision },
              cultures,
            ),
          (done) => (done?.ok ? [{ type: 'savedAndPublished', key, cultures }] : []),
        )
        if (!result) return refuse('notFound', 404, NOT_FOUND)
        if (!result.ok) return validationRefusal(result.errors)
        changed()
        await options.redirects?.commit(before)
        if (!gate.skip) await options.approvals?.afterDirectPublish(gate.who, key, 'published it')
        return { ok: true, revision: result.document.revision }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    /**
     * Publishes a page now, or schedules it: a schedule entry with a publish time
     * still to come schedules that culture instead of publishing it.
     */
    async publish(
      actor: Actor,
      key: string,
      request: {
        cultures: string[] | null
        schedules?: readonly ScheduleEntry[]
        now?: number
        /** Checked when sent: a publish from a stale copy would publish what its sender never saw. */
        expectedRevision?: string
        /** The event an approval was given for; a later one is not published. */
        expectedHead?: number
      },
    ): Promise<Result<{ scheduledOnly: boolean; revision?: string }>> {
      if (!(await repo.byKey(key))) return refuse('notFound', 404, NOT_FOUND)
      if (!(await permits(actor, 'publish', key))) return forbidden()
      const schedules = request.schedules ?? []
      const named = [
        ...(request.cultures ?? []),
        ...schedules.flatMap((s) => (s.culture ? [s.culture] : [])),
      ]
      if (!languagesAllowed(actor, named)) return forbidden()
      const gate = gateFor(actor)
      if (!gate.skip) {
        const refusal = await options.approvals?.publishRefusal(gate.who, key, 'publish')
        if (refusal) return needsApproval(refusal)
      }
      const now = request.now ?? Date.now()
      const later = (s: ScheduleEntry) => s.publishTime !== null && s.publishTime.getTime() > now
      try {
        const immediate = schedules.filter((s) => !later(s))
        const scheduledOnly = schedules.length > 0 && immediate.length === 0
        const cultures = immediate.some((s) => s.culture !== null)
          ? immediate.flatMap((s) => (s.culture === null ? [] : [s.culture]))
          : request.cultures
        const before = scheduledOnly ? undefined : await options.redirects?.capture(key)
        // The schedule and the publish are one change: neither lands without the other.
        const published = await commit(
          actor,
          async (tx) => {
            if (schedules.length > 0)
              await tx.setSchedule(
                key,
                schedules.map((s) => ({ ...s, publishTime: later(s) ? s.publishTime : null })),
              )
            if (scheduledOnly) return 'scheduled' as const
            return tx.publish(key, cultures, {
              expectedRevision: request.expectedRevision,
              expectedHead: request.expectedHead,
            })
          },
          (done): DocumentEvent[] =>
            done === 'scheduled'
              ? [{ type: 'scheduled', key }]
              : done
                ? [{ type: 'published', key, cultures }]
                : [],
        )
        if (published === 'scheduled') {
          changed()
          if (!gate.skip)
            await options.approvals?.afterDirectPublish(gate.who, key, 'rescheduled it')
          return { ok: true, scheduledOnly: true }
        }
        if (!published) return refuse('notFound', 404, NOT_FOUND)
        changed()
        await options.redirects?.commit(before)
        if (!gate.skip) await options.approvals?.afterDirectPublish(gate.who, key, 'published it')
        return { ok: true, scheduledOnly: false, revision: published.revision }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async unpublish(actor: Actor, key: string, cultures: string[] | null): Promise<Result> {
      if (!(await repo.byKey(key))) return refuse('notFound', 404, NOT_FOUND)
      if (!(await permits(actor, 'unpublish', key))) return forbidden()
      if (!languagesAllowed(actor, cultures)) return forbidden()
      const gate = gateFor(actor)
      if (!gate.skip) {
        const refusal = await options.approvals?.publishRefusal(gate.who, key, 'unpublish')
        if (refusal) return needsApproval(refusal)
      }
      try {
        const result = await commit(
          actor,
          (tx) => tx.unpublish(key, cultures),
          (done) => (done ? [{ type: 'unpublished', key, cultures }] : []),
        )
        if (!result) return refuse('notFound', 404, NOT_FOUND)
        changed()
        if (!gate.skip) await options.approvals?.afterDirectPublish(gate.who, key, 'took it down')
        return { ok: true }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    /**
     * Publishes or unpublishes several pages as one change: every page is checked
     * first, then all are written in one transaction, so a run never stops half
     * done. Parents first, so a child is not blocked by an ancestor the same run
     * takes live.
     */
    async publishMany(
      actor: Actor,
      keys: readonly string[],
      cultures: string[] | null,
      action: 'publish' | 'unpublish',
    ): Promise<
      | Result<{ changed: string[] }>
      | (Refusal & { blocked?: Array<{ key: string; reasons: string[] }> })
    > {
      const targets: NodeRow[] = []
      for (const key of keys) {
        const node = await nodes.byKey(key)
        if (!node || node.objectType !== repo.objectType) return refuse('notFound', 404, NOT_FOUND)
        targets.push(node)
      }
      targets.sort((a, b) => a.level - b.level)
      for (const node of targets) if (!(await permits(actor, action, node.key))) return forbidden()
      if (!languagesAllowed(actor, cultures)) return forbidden()
      const gate = gateFor(actor)
      if (!gate.skip)
        for (const node of targets) {
          const refusal = await options.approvals?.publishRefusal(gate.who, node.key, action)
          if (refusal) return needsApproval(refusal)
        }
      if (action === 'publish') {
        const selection = new Set(targets.map((node) => node.id))
        const blocked: Array<{ key: string; reasons: string[] }> = []
        for (const node of targets) {
          const reasons = await repo.publishBlockers(node.key, cultures, selection)
          if (reasons.length > 0) blocked.push({ key: node.key, reasons })
        }
        if (blocked.length > 0)
          return {
            ...refuse(
              'blocked',
              400,
              `${blocked.length} of ${targets.length} page(s) cannot be published, so nothing was published.`,
            ),
            blocked,
          }
      }
      try {
        const befores = new Map<string, unknown>()
        if (action === 'publish')
          for (const node of targets)
            befores.set(node.key, await options.redirects?.capture(node.key))
        const done = await commit(
          actor,
          async (tx) => {
            const out: string[] = []
            for (const node of targets) {
              const result =
                action === 'publish'
                  ? await tx.publish(node.key, cultures)
                  : await tx.unpublish(node.key, cultures)
              if (result) out.push(node.key)
            }
            return out
          },
          (keys) =>
            keys.map(
              (key): DocumentEvent =>
                action === 'publish'
                  ? { type: 'published', key, cultures }
                  : { type: 'unpublished', key, cultures },
            ),
        )
        changed()
        for (const key of done) {
          if (action === 'publish') await options.redirects?.commit(befores.get(key))
          if (!gate.skip)
            await options.approvals?.afterDirectPublish(
              gate.who,
              key,
              action === 'publish' ? 'published it' : 'took it down',
            )
        }
        return { ok: true, changed: done }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    /** Sets when a page goes live or comes down, without publishing anything now. */
    async schedule(actor: Actor, key: string, entries: readonly ScheduleEntry[]): Promise<Result> {
      if (!(await repo.byKey(key))) return refuse('notFound', 404, NOT_FOUND)
      if (!(await permits(actor, 'publish', key))) return forbidden()
      if (
        !languagesAllowed(
          actor,
          entries.flatMap((e) => (e.culture ? [e.culture] : [])),
        )
      )
        return forbidden()
      const gate = gateFor(actor)
      if (!gate.skip) {
        const refusal = await options.approvals?.publishRefusal(gate.who, key, 'publish')
        if (refusal) return needsApproval(refusal)
      }
      try {
        await commit(
          actor,
          (tx) => tx.setSchedule(key, entries),
          () => [{ type: 'scheduled', key }],
        )
        changed()
        if (!gate.skip) await options.approvals?.afterDirectPublish(gate.who, key, 'rescheduled it')
        return { ok: true }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async publishBranch(
      actor: Actor,
      key: string,
      cultures: string[] | null,
      includeUnpublished: boolean,
    ): Promise<Result<{ published: string[]; failed: Array<{ key: string; reason: string }> }>> {
      const root = await placeOf(key)
      if (!root) return refuse('notFound', 404, NOT_FOUND)
      if (actor.kind === 'user') {
        const below = await db.q
          .selectFrom('node')
          .select('unique_id')
          .where((eb) =>
            eb.or([eb('id', '=', root.node.id), eb('path', 'like', `${root.node.path},%`)]),
          )
          .execute()
        for (const row of below)
          if (!(await permits(actor, 'publish', normaliseUuid(String(row.unique_id)))))
            return forbidden()
      }
      if (!languagesAllowed(actor, cultures)) return forbidden()
      const gate = gateFor(actor)
      if (!gate.skip) {
        const refusal = await options.approvals?.branchRefusal(gate.who, key)
        if (refusal) return needsApproval(refusal)
      }
      try {
        const before = await options.redirects?.capture(key)
        const result = await commit(
          actor,
          (tx) => tx.publishBranch(key, cultures, includeUnpublished),
          (done) => (done ? [{ type: 'branchPublished', key, published: done.published }] : []),
        )
        if (!result) return refuse('notFound', 404, NOT_FOUND)
        changed()
        await options.redirects?.commit(before)
        if (!gate.skip)
          for (const published of result.published)
            await options.approvals?.afterDirectPublish(gate.who, published, 'published its branch')
        return { ok: true, ...result }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async trash(actor: Actor, key: string): Promise<Result> {
      const result = await trashMany(actor, [key])
      if (result.ok) return { ok: true }
      return result.kind === 'forbidden' ? forbidden() : result
    },

    trashMany,

    /** Deletes a page for good; `fromBin` refuses one that is not in the recycle bin. */
    async delete(actor: Actor, key: string, options_: { fromBin?: boolean } = {}): Promise<Result> {
      const node = await nodes.byKey(key)
      if (!node || node.objectType !== repo.objectType) return refuse('notFound', 404, NOT_FOUND)
      if (options_.fromBin && !node.trashed)
        return refuse('invalid', 400, 'The document is not in the recycle bin')
      if (!(await permits(actor, 'delete', options_.fromBin ? 'bin' : key))) return forbidden()
      const removed = await commit(
        actor,
        (tx) => tx.delete(key),
        (done) => (done ? [{ type: 'deleted', key, name: node.text ?? null }] : []),
      )
      if (!removed) return refuse('notFound', 404, NOT_FOUND)
      changed()
      return { ok: true }
    },

    async emptyBin(actor: Actor): Promise<Result<{ deleted: number }>> {
      if (!(await permits(actor, 'emptyBin', 'bin'))) return forbidden()
      // One change: each page deleted is announced as a delete from the bin is,
      // and the emptying itself is recorded once.
      const deleted = await commit(
        actor,
        async (tx) => {
          const gone: Array<{ key: string; name: string | null }> = []
          for (const node of await tx.trashedRoots())
            if (await tx.delete(node.key)) gone.push({ key: node.key, name: node.text ?? null })
          return gone
        },
        (gone): DocumentEvent[] => [
          ...gone.map((node): DocumentEvent => ({ type: 'deleted', ...node })),
          { type: 'binEmptied' },
        ],
      )
      changed()
      return { ok: true, deleted: deleted.length }
    },

    async restore(
      actor: Actor,
      key: string,
      targetKey: string | null | undefined,
    ): Promise<Result> {
      if (!(await permits(actor, 'restore', 'bin'))) return forbidden()
      if (targetKey !== undefined) {
        const misplaced = await misplacedAt(actor, key, targetKey)
        if (misplaced) return refuse('invalid', 400, misplaced)
      }
      try {
        const result = await commit(
          actor,
          (tx) => tx.restore(key, targetKey),
          (done) => (done === 'notFound' || done === 'invalid' ? [] : [{ type: 'restored', key }]),
        )
        if (result === 'notFound')
          return refuse('notFound', 404, 'The document is not in the recycle bin.')
        if (result === 'invalid')
          return refuse(
            'invalid',
            400,
            'The restore target does not exist or is in the recycle bin.',
          )
        changed()
        return { ok: true }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async move(actor: Actor, key: string, targetKey: string | null): Promise<Result> {
      const result = await moveMany(actor, [key], targetKey)
      if (result.ok) return { ok: true }
      return result.kind === 'forbidden' ? forbidden() : result
    },

    moveMany,

    async copy(
      actor: Actor,
      key: string,
      targetKey: string | null,
      copyOptions: { includeDescendants: boolean; dryRun?: boolean },
    ): Promise<Result<{ key: string | null }>> {
      if (!(await permits(actor, 'copy', key))) return forbidden()
      if (!(await permits(actor, 'intoTarget', targetKey ?? 'root'))) return forbidden()
      if (!(await isDocument(key)))
        return refuse('notFound', 404, 'The document or target could not be found.')
      // Only the top page is placed anew: the pages below it keep the parents they had.
      const misplaced = await misplacedAt(actor, key, targetKey)
      if (misplaced) return refuse('invalid', 400, misplaced)
      if (copyOptions.dryRun) {
        const target = targetKey ? await nodes.byKey(targetKey) : undefined
        if (targetKey && (!target || target.objectType !== repo.objectType))
          return refuse('notFound', 404, 'The document or target could not be found.')
        if (target?.trashed) return refuse('invalid', 400, 'The parent is in the recycle bin.')
        return { ok: true, key: null }
      }
      try {
        const userId = await userIdOf(actor)
        const copied = await commit(
          actor,
          (tx) =>
            tx.copy(key, targetKey, { includeDescendants: copyOptions.includeDescendants, userId }),
          (copyKey) => (copyKey ? [{ type: 'copied', key, copyKey }] : []),
        )
        if (!copied) return refuse('notFound', 404, 'The document or target could not be found.')
        changed()
        return { ok: true, key: copied }
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
      if (!(await permits(actor, 'sort', parentKey ?? 'root'))) return forbidden()
      for (const item of sorting) if (!(await permits(actor, 'sort', item.key))) return forbidden()
      if (sortOptions.dryRun) {
        const parentId = parentKey ? (await nodes.byKey(parentKey))?.id : SystemNodes.Root
        const children = await nodes.byKeys(sorting.map((item) => item.key))
        const fits =
          parentId !== undefined &&
          children.length === sorting.length &&
          children.every(
            (node) => node.objectType === repo.objectType && node.parentId === parentId,
          )
        return fits
          ? { ok: true }
          : refuse('notFound', 404, 'The parent, or one of the items, could not be found under it.')
      }
      try {
        const before = await options.redirects?.captureChildren(parentKey)
        const result = await commit(
          actor,
          (tx) => tx.sort(parentKey, sorting),
          (done) => (done === 'notFound' ? [] : [{ type: 'sorted', parentKey }]),
        )
        if (result === 'notFound')
          return refuse(
            'notFound',
            404,
            'The parent, or one of the items, could not be found under it.',
          )
        changed()
        await options.redirects?.commit(before)
        return { ok: true }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async sortChildrenBy(
      actor: Actor,
      parentKey: string | null,
      field: 'Name' | 'CreateDate' | 'UpdateDate',
      direction: 'Ascending' | 'Descending',
    ): Promise<Result> {
      if (!(await permits(actor, 'sort', parentKey ?? 'root'))) return forbidden()
      try {
        const before = await options.redirects?.captureChildren(parentKey)
        const result = await commit(
          actor,
          (tx) => tx.sortChildrenBy(parentKey, field, direction),
          (done) => (done === 'notFound' ? [] : [{ type: 'sorted', parentKey }]),
        )
        if (result === 'notFound') return refuse('notFound', 404, NOT_FOUND)
        changed()
        await options.redirects?.commit(before)
        return { ok: true }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async rollback(
      actor: Actor,
      versionId: string,
      precondition: Precondition = {},
    ): Promise<Result<{ revision?: string }>> {
      const document = await repo.atVersion(versionId)
      if (!document) return refuse('notFound', 404, 'The version could not be found.')
      if (!(await permits(actor, 'rollback', document.document.key))) return forbidden()
      try {
        const result = await commit(
          actor,
          (tx) => tx.rollback(versionId, precondition),
          (done) => (done ? [{ type: 'rolledBack', key: done.key, versionId }] : []),
        )
        if (!result) return refuse('notFound', 404, 'The version could not be found.')
        changed()
        return { ok: true, revision: result.revision }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async setDomains(
      actor: Actor,
      key: string,
      assignment: DomainAssignment,
    ): Promise<
      | Exclude<SetDomainsResult, { status: 'ok' }>
      | { status: 'notFound' }
      | { status: 'forbidden' }
      | { status: 'ok'; file?: string }
    > {
      const node = await nodes.byKey(key)
      if (!node || node.objectType !== repo.objectType) return { status: 'notFound' }
      if (!(await permits(actor, 'domains', key))) return { status: 'forbidden' }
      const result = await commit(
        actor,
        async (_tx, txDb) => {
          const set = await new DomainRepository(txDb).setForNode(node.id, assignment)
          // Every node routes by hostname from its published cache, so they are all told.
          if (set.status === 'ok') await repoInstruction(node.key, txDb)
          return set
        },
        (set) => (set.status === 'ok' ? [{ type: 'domainsAssigned', key: node.key }] : []),
      )
      if (result.status !== 'ok') return result
      changed()
      const file = await options.afterDomains?.(node, assignment)
      return file ? { status: 'ok', file } : { status: 'ok' }
    },

    async setPublicAccess(
      actor: Actor,
      key: string,
      input: PublicAccessInput,
      change: 'added' | 'set',
    ): Promise<PublicAccessStatus> {
      if (!(await isDocument(key))) return 'content-not-found'
      if (!(await permits(actor, 'publicAccess', key))) return 'forbidden'
      if (!(await isDocument(input.loginDocumentKey))) return 'login-node-not-found'
      if (!(await isDocument(input.errorDocumentKey))) return 'error-node-not-found'
      const saved = await commit(
        actor,
        (_tx, txDb) =>
          new PublicAccessRepository(txDb).save({
            nodeKey: key,
            loginNodeKey: input.loginDocumentKey,
            errorNodeKey: input.errorDocumentKey,
            memberGroupNames: input.memberGroupNames,
            memberUserNames: input.memberUserNames,
          }),
        (done) => (done ? [{ type: 'publicAccessChanged', key, change }] : []),
      )
      if (!saved) return 'content-not-found'
      changed()
      return 'ok'
    },

    async removePublicAccess(actor: Actor, key: string): Promise<PublicAccessStatus> {
      if (!(await isDocument(key))) return 'content-not-found'
      if (!(await permits(actor, 'publicAccess', key))) return 'forbidden'
      const removed = await commit(
        actor,
        (_tx, txDb) => new PublicAccessRepository(txDb).remove(key),
        (done) => (done ? [{ type: 'publicAccessChanged', key, change: 'removed' }] : []),
      )
      if (!removed) return 'entry-not-found'
      changed()
      return 'ok'
    },

    /** The repository these operations write through, for reads that go with them. */
    repository: repo,
  }

  async function isDocument(key: string): Promise<boolean> {
    const node = await nodes.byKey(key)
    return node?.objectType === repo.objectType
  }

  /** The content cache instruction other nodes rebuild on. */
  async function repoInstruction(key: string, on: Db = db): Promise<void> {
    await appendCacheInstruction(on, {
      kind: 'content',
      payload: { key },
      by: options.repository?.nodeId,
    })
  }
}
