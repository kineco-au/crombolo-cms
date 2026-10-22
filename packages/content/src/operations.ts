/**
 * Every document write, once (story 170). The backoffice, the command line, the
 * scheduled job, approvals and form workflows all call these, so a write follows
 * the same rules whoever starts it: the actor's permissions, the approval gate,
 * one transaction, redirect tracking, and one event for the transport to announce.
 *
 * The repository keeps the SQL, the locking and the publish rules that guard
 * every path (published ancestors, mandatory languages, filled mandatory fields).
 * What it does not decide — who may, and whether a page needs approval — is here.
 * docs/architecture.md, "Document writes".
 */
import type { DocumentValidationError, DocumentValue } from '@crombolo/core'
import { normaliseUuid } from '@crombolo/core'
import {
  appendCacheInstruction,
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
  status: number
  reason: string
  errors?: DocumentValidationError[]
}

export type Done<T extends object = object> = { ok: true } & T
export type Result<T extends object = object> = Done<T> | Refusal

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
  const reason = extra?.(error)
  if (reason) return refuse('invalid', 400, reason)
  throw error
}

export type DocumentOperations = ReturnType<typeof createDocumentOperations>

export function createDocumentOperations(options: DocumentOperationsOptions) {
  const { db, events } = options
  const repo = new DocumentRepository(db, options.repository)
  const nodes = new NodeRepository(db)
  const changed = () => options.onChange?.()
  const emit = (event: DocumentEvent, actor: Actor) => events.emit(event, actor)

  /** The version author: the user's row, when the actor is one. */
  const userIdOf = async (actor: Actor): Promise<number | undefined> => {
    if (actor.kind !== 'user') return undefined
    const rows = await db.query<{ id: number }>('SELECT id FROM user_account WHERE key = ?', [
      actor.principal.id,
    ])
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
    if (actor.kind !== 'user') return true
    if (key === 'root' || key === 'bin') return mayAt(actor.principal, WRITE_VERBS[kind], key)
    const place = await placeOf(key)
    if (!place) return true
    return mayAt(actor.principal, WRITE_VERBS[kind], place.chain, place.trashed)
  }

  const forbidden = () => refuse('forbidden', 403, 'You may not do that to this page.')

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
    const rows = await db.query<{ alias: string; unique_id: string; name: string }>(
      `WITH RECURSIVE ancestry(id) AS (
         SELECT ?
         UNION
         SELECT c.parent_content_type_id FROM content_type_composition c JOIN ancestry a ON a.id = c.child_content_type_id
       )
       SELECT p.alias, p.unique_id, p.name FROM property_type p
       WHERE p.content_type_id IN (SELECT id FROM ancestry) AND p.retired_at IS NULL`,
      [type.id],
    )
    return rows.map((row) => ({
      alias: String(row.alias),
      key: normaliseUuid(String(row.unique_id)),
      name: String(row.name),
    }))
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
      try {
        const created = await repo.create({ ...input, userId: await userIdOf(actor) })
        changed()
        await emit({ type: 'created', key: created.key }, actor)
        return { ok: true, key: created.key }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async save(actor: Actor, key: string, input: DocumentInput): Promise<Result> {
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
      const gate = gateFor(actor)
      if (!gate.skip) {
        const waiting = await options.approvals?.beforeSave(gate.who, key)
        if (waiting) return needsApproval(waiting)
      }
      try {
        // The content type never changes on a save.
        const updated = await repo.update({
          ...input,
          key,
          contentTypeKey: existing.contentTypeKey,
          userId: await userIdOf(actor),
        })
        if (!updated) return refuse('notFound', 404, NOT_FOUND)
        changed()
        if (!gate.skip) await options.approvals?.afterSave(gate.who, key)
        await emit({ type: 'saved', key }, actor)
        return { ok: true }
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
        const result = await repo.atomically((tx) =>
          tx.createAndPublish({ ...input, userId }, cultures),
        )
        if (!result.ok) return validationRefusal(result.errors)
        changed()
        await emit({ type: 'createdAndPublished', key: result.document.key, cultures }, actor)
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
    ): Promise<Result> {
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
        const result = await repo.atomically((tx) =>
          tx.updateAndPublish({ ...input, key, userId }, cultures),
        )
        if (!result) return refuse('notFound', 404, NOT_FOUND)
        if (!result.ok) return validationRefusal(result.errors)
        changed()
        await options.redirects?.commit(before)
        if (!gate.skip) await options.approvals?.afterDirectPublish(gate.who, key, 'published it')
        await emit({ type: 'savedAndPublished', key, cultures }, actor)
        return { ok: true }
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
      },
    ): Promise<Result<{ scheduledOnly: boolean }>> {
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
        if (schedules.length > 0)
          await repo.setSchedule(
            key,
            schedules.map((s) => ({ ...s, publishTime: later(s) ? s.publishTime : null })),
          )
        const immediate = schedules.filter((s) => !later(s))
        if (schedules.length > 0 && immediate.length === 0) {
          changed()
          if (!gate.skip)
            await options.approvals?.afterDirectPublish(gate.who, key, 'rescheduled it')
          await emit({ type: 'scheduled', key }, actor)
          return { ok: true, scheduledOnly: true }
        }
        const cultures = immediate.some((s) => s.culture !== null)
          ? immediate.flatMap((s) => (s.culture === null ? [] : [s.culture]))
          : request.cultures
        const before = await options.redirects?.capture(key)
        const published = await repo.publish(key, cultures)
        if (!published) return refuse('notFound', 404, NOT_FOUND)
        changed()
        await options.redirects?.commit(before)
        if (!gate.skip) await options.approvals?.afterDirectPublish(gate.who, key, 'published it')
        await emit({ type: 'published', key, cultures }, actor)
        return { ok: true, scheduledOnly: false }
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
        const result = await repo.unpublish(key, cultures)
        if (!result) return refuse('notFound', 404, NOT_FOUND)
        changed()
        if (!gate.skip) await options.approvals?.afterDirectPublish(gate.who, key, 'took it down')
        await emit({ type: 'unpublished', key, cultures }, actor)
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
        const done = await repo.atomically(async (tx) => {
          const out: string[] = []
          for (const node of targets) {
            const result =
              action === 'publish'
                ? await tx.publish(node.key, cultures)
                : await tx.unpublish(node.key, cultures)
            if (result) out.push(node.key)
          }
          return out
        })
        changed()
        for (const key of done) {
          if (action === 'publish') await options.redirects?.commit(befores.get(key))
          if (!gate.skip)
            await options.approvals?.afterDirectPublish(
              gate.who,
              key,
              action === 'publish' ? 'published it' : 'took it down',
            )
          await emit(
            action === 'publish'
              ? { type: 'published', key, cultures }
              : { type: 'unpublished', key, cultures },
            actor,
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
        await repo.setSchedule(key, entries)
        changed()
        if (!gate.skip) await options.approvals?.afterDirectPublish(gate.who, key, 'rescheduled it')
        await emit({ type: 'scheduled', key }, actor)
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
        const below = await db.query<{ unique_id: string }>(
          'SELECT unique_id FROM node WHERE id = ? OR path LIKE ?',
          [root.node.id, `${root.node.path},%`],
        )
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
        const result = await repo.publishBranch(key, cultures, includeUnpublished)
        if (!result) return refuse('notFound', 404, NOT_FOUND)
        changed()
        await options.redirects?.commit(before)
        if (!gate.skip)
          for (const published of result.published)
            await options.approvals?.afterDirectPublish(gate.who, published, 'published its branch')
        await emit({ type: 'branchPublished', key, published: result.published }, actor)
        return { ok: true, ...result }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async trash(actor: Actor, key: string): Promise<Result> {
      if (!(await permits(actor, 'trash', key))) return forbidden()
      const moved = await repo.moveToRecycleBin(key)
      if (!moved) return refuse('notFound', 404, NOT_FOUND)
      changed()
      await emit({ type: 'trashed', key }, actor)
      return { ok: true }
    },

    /** Deletes a page for good; `fromBin` refuses one that is not in the recycle bin. */
    async delete(actor: Actor, key: string, options_: { fromBin?: boolean } = {}): Promise<Result> {
      const node = await nodes.byKey(key)
      if (!node || node.objectType !== repo.objectType) return refuse('notFound', 404, NOT_FOUND)
      if (options_.fromBin && !node.trashed)
        return refuse('invalid', 400, 'The document is not in the recycle bin')
      if (!(await permits(actor, 'delete', options_.fromBin ? 'bin' : key))) return forbidden()
      const removed = await repo.delete(key)
      if (!removed) return refuse('notFound', 404, NOT_FOUND)
      changed()
      await emit({ type: 'deleted', key, name: node.text ?? null }, actor)
      return { ok: true }
    },

    async emptyBin(actor: Actor): Promise<Result<{ deleted: number }>> {
      if (!(await permits(actor, 'emptyBin', 'bin'))) return forbidden()
      let deleted = 0
      for (const node of await repo.trashedRoots()) if (await repo.delete(node.key)) deleted++
      changed()
      await emit({ type: 'binEmptied' }, actor)
      return { ok: true, deleted }
    },

    async restore(
      actor: Actor,
      key: string,
      targetKey: string | null | undefined,
    ): Promise<Result> {
      if (!(await permits(actor, 'restore', 'bin'))) return forbidden()
      try {
        const result = await repo.restore(key, targetKey)
        if (result === 'notFound')
          return refuse('notFound', 404, 'The document is not in the recycle bin.')
        if (result === 'invalid')
          return refuse(
            'invalid',
            400,
            'The restore target does not exist or is in the recycle bin.',
          )
        changed()
        await emit({ type: 'restored', key }, actor)
        return { ok: true }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async move(actor: Actor, key: string, targetKey: string | null): Promise<Result> {
      if (!(await permits(actor, 'move', key))) return forbidden()
      if (!(await permits(actor, 'intoTarget', targetKey ?? 'root'))) return forbidden()
      try {
        const before = await options.redirects?.capture(key)
        const result = await repo.move(key, targetKey)
        if (result === 'notFound')
          return refuse('notFound', 404, 'The document or target could not be found.')
        if (result === 'invalid')
          return refuse(
            'invalid',
            400,
            'A document cannot be moved below itself or into the recycle bin.',
          )
        changed()
        await options.redirects?.commit(before)
        await emit({ type: 'moved', key }, actor)
        return { ok: true }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async copy(
      actor: Actor,
      key: string,
      targetKey: string | null,
      copyOptions: { includeDescendants: boolean },
    ): Promise<Result<{ key: string }>> {
      if (!(await permits(actor, 'copy', key))) return forbidden()
      if (!(await permits(actor, 'intoTarget', targetKey ?? 'root'))) return forbidden()
      try {
        const copied = await repo.copy(key, targetKey, {
          includeDescendants: copyOptions.includeDescendants,
          userId: await userIdOf(actor),
        })
        if (!copied) return refuse('notFound', 404, 'The document or target could not be found.')
        changed()
        await emit({ type: 'copied', key, copyKey: copied }, actor)
        return { ok: true, key: copied }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async sort(
      actor: Actor,
      parentKey: string | null,
      sorting: ReadonlyArray<{ key: string; sortOrder: number }>,
    ): Promise<Result> {
      if (!(await permits(actor, 'sort', parentKey ?? 'root'))) return forbidden()
      for (const item of sorting) if (!(await permits(actor, 'sort', item.key))) return forbidden()
      try {
        const before = await options.redirects?.captureChildren(parentKey)
        const result = await repo.sort(parentKey, sorting)
        if (result === 'notFound')
          return refuse(
            'notFound',
            404,
            'The parent, or one of the items, could not be found under it.',
          )
        changed()
        await options.redirects?.commit(before)
        await emit({ type: 'sorted', parentKey }, actor)
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
        const result = await repo.sortChildrenBy(parentKey, field, direction)
        if (result === 'notFound') return refuse('notFound', 404, NOT_FOUND)
        changed()
        await options.redirects?.commit(before)
        await emit({ type: 'sorted', parentKey }, actor)
        return { ok: true }
      } catch (error) {
        return refusalFrom(error, options.refusalReason)
      }
    },

    async rollback(actor: Actor, versionId: string): Promise<Result> {
      const document = await repo.atVersion(versionId)
      if (!document) return refuse('notFound', 404, 'The version could not be found.')
      if (!(await permits(actor, 'rollback', document.document.key))) return forbidden()
      try {
        const result = await repo.rollback(versionId)
        if (!result) return refuse('notFound', 404, 'The version could not be found.')
        changed()
        await emit({ type: 'rolledBack', key: result.key, versionId }, actor)
        return { ok: true }
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
      const result = await new DomainRepository(db).setForNode(node.id, assignment)
      if (result.status !== 'ok') return result
      // Every node routes by hostname from its published cache, so they are all told.
      await repoInstruction(node.key)
      changed()
      const file = await options.afterDomains?.(node, assignment)
      await emit({ type: 'domainsAssigned', key: node.key }, actor)
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
      const saved = await new PublicAccessRepository(db).save({
        nodeKey: key,
        loginNodeKey: input.loginDocumentKey,
        errorNodeKey: input.errorDocumentKey,
        memberGroupNames: input.memberGroupNames,
        memberUserNames: input.memberUserNames,
      })
      if (!saved) return 'content-not-found'
      changed()
      await emit({ type: 'publicAccessChanged', key, change }, actor)
      return 'ok'
    },

    async removePublicAccess(actor: Actor, key: string): Promise<PublicAccessStatus> {
      if (!(await isDocument(key))) return 'content-not-found'
      if (!(await permits(actor, 'publicAccess', key))) return 'forbidden'
      if (!(await new PublicAccessRepository(db).remove(key))) return 'entry-not-found'
      changed()
      await emit({ type: 'publicAccessChanged', key, change: 'removed' }, actor)
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
  async function repoInstruction(key: string): Promise<void> {
    await appendCacheInstruction(db, {
      kind: 'content',
      payload: { key },
      by: options.repository?.nodeId,
    })
  }
}
