/**
 * Workspaces (story 375): a named place to change pages apart from Shared,
 * its owner's and shared with the people they choose. Opening one is a single
 * row; discarding one removes every row that carries it.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'
import { Locks } from '../locks.ts'
import { ChangeSourceRepository } from './change-sources.ts'
import { type ContentKind, deleteNodeRows } from './documents.ts'
import {
  type ConflictedItem,
  recordWorkspaceEvent,
  WORKSPACE_CONFLICTED,
  WORKSPACE_DISCARDED,
  WORKSPACE_MERGED,
  WORKSPACE_OPENED,
  type WorkspaceFacts,
} from './workspace-events.ts'
import { WorkspaceFileRepository } from './workspace-files.ts'

/** A change staged in a workspace (story 383), with the schedules its merge sets (story 395). */
/** How lately a workspace changed a page for someone else opening it to be told. */
/** Story 447: the key the workspace routes answer Shared by, which no workspace has. */
export const SHARED_WORKSPACE_KEY = 'shared'

export const TOUCHED_WITHIN_MS = 7 * 24 * 60 * 60 * 1000

export interface StagedChange {
  key: string
  name: string | null
  /**
   * Story 439: for a field this site changed since the change began, the value the change
   * found, by page key and merge field: the merge reads it as the field's base, so it asks.
   */
  bases?: Record<string, Record<string, unknown>>
  schedules?: Array<{
    key: string
    kind: string
    entries: Array<{
      culture: string | null
      publishTime: string | null
      unpublishTime: string | null
    }>
  }>
}

export interface Workspace {
  id: number
  key: string
  name: string
  ownerKey: string
  memberKeys: string[]
  /** A person's own, which `workspaces.required` opens for them (story 380). */
  personal: boolean
  /** Open, or merged into Shared (story 380), when it takes nothing more. */
  state: 'open' | 'merged'
  mergedAt: Date | null
  mergedBy: string | null
  createdAt: Date
  updatedAt: Date
  /** Changes from another site it holds (story 383), which its merge applies. */
  stagedChanges: StagedChange[] | null
  /** Staged to be looked at and applied: nobody edits it. A refused apply's is open to edit. */
  stagedReadOnly: boolean
  /** Who can see it (story 384): its members, or everyone who may edit, reading only. */
  visibility: 'members' | 'editors'
  /** No longer chosen: anyone opening an item it changed lately is told so. Kept as stored. */
  tellOthers: boolean
  /** What it is for, in its owner's words. */
  description: string | null
}

/** A move, reorder or delete waiting for the merge, with where its page stood (story 380). */
export interface WorkspacePending {
  /** Which kind it is, once the merge has looked (story 390). */
  objectKind?: ContentKind
  /** Null for a page Shared has since deleted. */
  key: string | null
  nodeId: number
  name: string
  kind: 'move' | 'sort' | 'trash' | 'delete' | 'orphaned' | 'gone'
  targetParentId: number | null
  sortOrder: number | null
  baseParentId: number | null
  baseSortOrder: number | null
  baseEventId: number | null
}

/** What a workspace holds that Shared does not, page by page. */
export interface WorkspaceChange {
  key: string
  name: string
  /** `changed` and `made` are its versions; the rest wait for the merge. */
  kind: 'changed' | 'made' | 'move' | 'sort' | 'trash' | 'delete' | 'orphaned' | 'gone'
}

/** How an item in conflict is kept: a file by its path, anything else by its kind and key. */
const conflictId = (item: ConflictedItem) =>
  (item.path ? `file:${item.path}` : `${item.kind}:${item.key}`).slice(0, 512)

/** A workspace as its events carry it (story 400). */
const factsOf = (workspace: Workspace): WorkspaceFacts => ({
  key: workspace.key,
  name: workspace.name,
  personal: workspace.personal,
  owner: workspace.ownerKey,
  state: workspace.state,
})

export class WorkspaceRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async open(input: {
    name: string
    ownerKey: string
    personal?: boolean
    visibility?: 'members' | 'editors'
    tellOthers?: boolean
    description?: string | null
    /** Opened only to see what something would do, then discarded: raises nothing. */
    quiet?: boolean
  }): Promise<Workspace> {
    const key = normaliseUuid(crypto.randomUUID())
    if (key === SHARED_WORKSPACE_KEY) throw new Error('No workspace may have the key of Shared.')
    const now = DbDate.toDb(new Date())
    await this.#db.q
      .insertInto('workspace')
      .values({
        key,
        name: input.name,
        owner_key: normaliseUuid(input.ownerKey),
        personal: this.#db.dialect.boolValue(input.personal === true) as boolean,
        visibility: input.visibility ?? 'members',
        tell_others: this.#db.dialect.boolValue(input.tellOthers !== false) as boolean,
        description: input.description?.trim() || null,
        created_at: now,
        updated_at: now,
      })
      .execute()
    const opened = (await this.byKey(key)) as Workspace
    if (!input.quiet)
      await recordWorkspaceEvent(this.#db, WORKSPACE_OPENED, factsOf(opened), {
        by: input.ownerKey,
      })
    return opened
  }

  /** A person's own unnamed workspace, while it is open (story 380). */
  async ownOf(userKey: string): Promise<Workspace | undefined> {
    const rows = await this.#db.q
      .selectFrom('workspace')
      .selectAll()
      .where('owner_key', '=', normaliseUuid(userKey))
      .where('personal', '=', this.#db.dialect.boolValue(true) as boolean)
      .where('state', '=', 'open')
      .execute()
    return (await this.#withMembers(rows))[0]
  }

  async byId(id: number): Promise<Workspace | undefined> {
    const rows = await this.#db.q.selectFrom('workspace').selectAll().where('id', '=', id).execute()
    return (await this.#withMembers(rows))[0]
  }

  async byKey(key: string): Promise<Workspace | undefined> {
    if (normaliseUuid(key) === SHARED_WORKSPACE_KEY) return undefined
    const rows = await this.#db.q
      .selectFrom('workspace')
      .selectAll()
      .where('key', '=', normaliseUuid(key))
      .execute()
    return (await this.#withMembers(rows))[0]
  }

  /** Those a person owns or is a member of, newest first. */
  async forUser(userKey: string): Promise<Workspace[]> {
    const user = normaliseUuid(userKey)
    const rows = await this.#db.q
      .selectFrom('workspace')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb('owner_key', '=', user),
          eb(
            'id',
            'in',
            eb.selectFrom('workspace_member').select('workspace_id').where('user_key', '=', user),
          ),
        ]),
      )
      .orderBy('id', 'desc')
      .execute()
    return this.#withMembers(rows)
  }

  /** Every workspace, for an administrator clearing ones left behind. */
  async all(): Promise<Workspace[]> {
    const rows = await this.#db.q
      .selectFrom('workspace')
      .selectAll()
      .orderBy('id', 'desc')
      .execute()
    return this.#withMembers(rows)
  }

  async rename(id: number, name: string): Promise<void> {
    await this.#db.q
      .updateTable('workspace')
      .set({ name, updated_at: DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .execute()
  }

  /** Adds a member; false when they already are one. */
  async addMember(id: number, userKey: string): Promise<boolean> {
    const user = normaliseUuid(userKey)
    const existing = await this.#db.q
      .selectFrom('workspace_member')
      .select('user_key')
      .where('workspace_id', '=', id)
      .where('user_key', '=', user)
      .execute()
    if (existing.length > 0) return false
    await this.#db.q
      .insertInto('workspace_member')
      .values({ workspace_id: id, user_key: user, added_at: DbDate.toDb(new Date()) })
      .execute()
    return true
  }

  /** Removes a member; false when they were not one. */
  async removeMember(id: number, userKey: string): Promise<boolean> {
    const user = normaliseUuid(userKey)
    const existing = await this.#db.q
      .selectFrom('workspace_member')
      .select('user_key')
      .where('workspace_id', '=', id)
      .where('user_key', '=', user)
      .execute()
    if (existing.length === 0) return false
    await this.#db.q
      .deleteFrom('workspace_member')
      .where('workspace_id', '=', id)
      .where('user_key', '=', user)
      .execute()
    return true
  }

  /** The pages it changed or made, and what waits for the merge, by page. */
  async changes(id: number): Promise<WorkspaceChange[]> {
    const touched = await this.#db.q
      .selectFrom('workspace_document as wd')
      .innerJoin('node as n', 'n.id', 'wd.node_id')
      .select(['n.unique_id', 'n.text', 'wd.created', 'wd.node_id'])
      .where('wd.workspace_id', '=', id)
      .orderBy('wd.node_id')
      .execute()
    const heads = new Map<number, string>()
    for (const row of await this.#db.q
      .selectFrom('content_version')
      .select(['node_id', 'text', 'id'])
      .where('workspace_id', '=', id)
      .orderBy('id')
      .execute())
      heads.set(Number(row.node_id), String(row.text ?? ''))
    const pending = await this.#db.q
      .selectFrom('workspace_pending as p')
      .leftJoin('node as n', 'n.id', 'p.node_id')
      .select(['n.unique_id', 'n.text', 'p.kind', 'p.name', 'p.node_id'])
      .where('p.workspace_id', '=', id)
      .orderBy('p.id')
      .execute()
    return [
      ...touched.map((row) => ({
        key: normaliseUuid(String(row.unique_id)),
        name: heads.get(Number(row.node_id)) ?? String(row.text ?? ''),
        kind: (Number(row.created) ? 'made' : 'changed') as WorkspaceChange['kind'],
      })),
      ...pending.map((row) => ({
        // A page Shared deleted since is named by what it was called.
        key: row.unique_id ? normaliseUuid(String(row.unique_id)) : `gone:${row.node_id}`,
        name: String(row.text ?? row.name ?? ''),
        kind: String(row.kind) as WorkspaceChange['kind'],
      })),
    ]
  }

  /** Removes the workspace and everything carrying it; Shared is as it was. `by` discarded it. */
  /**
   * Story 434: what outside this workspace is of a content type it made, by name, with the
   * workspace that holds it, null for Shared. While any is, it cannot be discarded.
   */
  async typesUsedElsewhere(
    id: number,
  ): Promise<Array<{ name: string; type: string; workspace: string | null }>> {
    const rows = await this.#db.q
      .selectFrom('content as c')
      .innerJoin('content_type as t', 't.node_id', 'c.content_type_id')
      .innerJoin('node as n', 'n.id', 'c.node_id')
      .leftJoin('workspace as w', 'w.id', 'n.workspace_id')
      .select(['n.text', 't.alias', 'w.name'])
      .where('t.workspace_id', '=', id)
      .where((eb) => eb.or([eb('n.workspace_id', 'is', null), eb('n.workspace_id', '!=', id)]))
      .execute()
    return rows.map((row) => ({
      name: String(row.text ?? ''),
      type: String(row.alias),
      workspace: row.name === null || row.name === undefined ? null : String(row.name),
    }))
  }

  async discard(id: number, by?: string | null, options: { quiet?: boolean } = {}): Promise<void> {
    await this.#db.locks.withLock(Locks.ContentTree, () =>
      this.#db.transaction(async (tx) => {
        const gone = await new WorkspaceRepository(tx).byId(id)
        if (gone && !options.quiet)
          await recordWorkspaceEvent(tx, WORKSPACE_DISCARDED, factsOf(gone), { by })
        const versions = () =>
          tx.q.selectFrom('content_version').select('id').where('workspace_id', '=', id)
        // Story 434: its pages first; its types and data types go with its schema, after them.
        const made = (
          await tx.q
            .selectFrom('node')
            .select('id')
            .where('workspace_id', '=', id)
            .where('id', 'not in', (eb) =>
              eb.selectFrom('content_type').select('node_id').where('workspace_id', '=', id),
            )
            .where('id', 'not in', (eb) =>
              eb.selectFrom('data_type').select('node_id').where('workspace_id', '=', id),
            )
            .execute()
        ).map((row) => Number(row.id))
        await tx.q.deleteFrom('property_value').where('workspace_id', '=', id).execute()
        await tx.q
          .deleteFrom('content_version_culture_variation')
          .where('version_id', 'in', versions())
          .execute()
        await tx.q.deleteFrom('document_version').where('id', 'in', versions()).execute()
        await tx.q.deleteFrom('content_version').where('workspace_id', '=', id).execute()
        await tx.q.deleteFrom('content_schedule').where('workspace_id', '=', id).execute()
        await tx.q.deleteFrom('workspace_schedule').where('workspace_id', '=', id).execute()
        await tx.q.deleteFrom('workspace_schedule').where('workspace_id', '=', id).execute()
        for (const table of [
          'workspace_pending',
          'workspace_document_culture',
          'workspace_document',
          'workspace_member',
          'workspace_link',
          'workspace_conflict_raised',
          'change_source_staged',
        ] as const)
          await tx.q.deleteFrom(table).where('workspace_id', '=', id).execute()
        if (made.length > 0) await deleteNodeRows(tx, { ids: made })
        await dropWorkspaceSchema(tx, id)
        await tx.q.deleteFrom('workspace').where('id', '=', id).execute()
      }),
    )
  }

  /** Whether the workspace has rows of its own for its types yet (story 376). */
  /** Its owner's choice of who sees it and whether others are told (story 384). */
  async setPrivacy(
    id: number,
    privacy: { visibility?: 'members' | 'editors'; tellOthers?: boolean },
  ): Promise<void> {
    const set: Record<string, unknown> = {}
    if (privacy.visibility) set.visibility = privacy.visibility
    if (privacy.tellOthers !== undefined)
      set.tell_others = this.#db.dialect.boolValue(privacy.tellOthers)
    if (Object.keys(set).length === 0) return
    await this.#db.q.updateTable('workspace').set(set).where('id', '=', id).execute()
  }

  /** What it is for, changed by its owner; empty clears it. */
  async setDescription(id: number, description: string | null): Promise<void> {
    await this.#db.q
      .updateTable('workspace')
      .set({ description: description?.trim() || null })
      .where('id', '=', id)
      .execute()
  }

  /**
   * Open workspaces, other than `except`'s own, that changed a page lately (story 384):
   * since `since`, seven days ago unless said. An older change is not worth a warning.
   */
  async touching(
    nodeId: number,
    exceptUser: string,
    since = new Date(Date.now() - TOUCHED_WITHIN_MS),
  ): Promise<Workspace[]> {
    const from = DbDate.toDb(since)
    const documents = await this.#db.q
      .selectFrom('content_version')
      .select('workspace_id')
      .where('node_id', '=', nodeId)
      .where('workspace_id', 'is not', null)
      .where('version_date', '>=', from)
      .execute()
    const pending = await this.#db.q
      .selectFrom('workspace_pending')
      .select('workspace_id')
      .where('node_id', '=', nodeId)
      .where('recorded_at', '>=', from)
      .execute()
    const ids = [...new Set([...documents, ...pending].map((r) => Number(r.workspace_id)))]
    if (ids.length === 0) return []
    const rows = await this.#db.q
      .selectFrom('workspace')
      .selectAll()
      .where('id', 'in', ids)
      .where('state', '=', 'open')
      .execute()
    return (await this.#withMembers(rows)).filter(
      (w) =>
        w.ownerKey !== normaliseUuid(exceptUser) &&
        !w.memberKeys.includes(normaliseUuid(exceptUser)),
    )
  }

  /** Marks a workspace as holding changes from another site, read-only or open to edit (story 383). */
  async setStaged(
    id: number,
    changes: readonly StagedChange[] | null,
    readOnly = true,
  ): Promise<void> {
    await this.#db.q
      .updateTable('workspace')
      .set({ staged_changes: changes ? JSON.stringify({ readOnly, changes }) : null })
      .where('id', '=', id)
      .execute()
  }

  /** Story 439: a page's staged bases, every change's together; none once answered. */
  async stagedBases(id: number, pageKey: string): Promise<Record<string, unknown>> {
    const row = await this.#db.q
      .selectFrom('workspace')
      .select('staged_changes')
      .where('id', '=', id)
      .executeTakeFirst()
    const key = normaliseUuid(pageKey)
    const out: Record<string, unknown> = {}
    for (const change of stagedOf(row?.staged_changes as string | null).stagedChanges ?? [])
      Object.assign(out, change.bases?.[key] ?? {})
    return out
  }

  /** Story 439: a page's conflicts answered, its staged bases go. */
  async clearStagedBases(id: number, pageKey: string): Promise<void> {
    const row = await this.#db.q
      .selectFrom('workspace')
      .select('staged_changes')
      .where('id', '=', id)
      .executeTakeFirst()
    const staged = stagedOf(row?.staged_changes as string | null)
    if (!staged.stagedChanges) return
    const key = normaliseUuid(pageKey)
    const changes = staged.stagedChanges.map((change) => {
      if (!change.bases?.[key]) return change
      const { [key]: _gone, ...rest } = change.bases
      return { ...change, bases: rest }
    })
    await this.setStaged(id, changes, staged.stagedReadOnly)
  }

  async schemaBuilt(id: number): Promise<boolean> {
    const rows = await this.#db.q
      .selectFrom('workspace')
      .select('schema_built')
      .where('id', '=', id)
      .execute()
    return fromDbBool(rows[0]?.schema_built)
  }

  /** Marks the workspace's types as built, or not, so the next save builds them again. */
  async setSchemaBuilt(id: number, built: boolean): Promise<void> {
    await this.#db.q
      .updateTable('workspace')
      .set({ schema_built: this.#db.dialect.boolValue(built) as boolean })
      .where('id', '=', id)
      .execute()
  }

  /** What waits for the merge: each page's latest move, reorder and delete, and each marker. */
  async pending(id: number): Promise<WorkspacePending[]> {
    const rows = await this.#db.q
      .selectFrom('workspace_pending as p')
      .leftJoin('node as n', 'n.id', 'p.node_id')
      .select([
        'n.unique_id',
        'n.text',
        'p.node_id',
        'p.name',
        'p.kind',
        'p.target_parent_id',
        'p.sort_order',
        'p.base_parent_id',
        'p.base_sort_order',
        'p.base_event_id',
      ])
      .where('p.workspace_id', '=', id)
      .orderBy('p.id')
      .execute()
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return rows.map((row) => ({
      key: row.unique_id ? normaliseUuid(String(row.unique_id)) : null,
      nodeId: Number(row.node_id),
      name: String(row.text ?? row.name ?? ''),
      kind: String(row.kind) as WorkspacePending['kind'],
      targetParentId: num(row.target_parent_id),
      sortOrder: num(row.sort_order),
      baseParentId: num(row.base_parent_id),
      baseSortOrder: num(row.base_sort_order),
      baseEventId: num(row.base_event_id),
    }))
  }

  /** Drops what waits for the merge for one page, or one marker: the change is not to go. */
  /**
   * The pages a workspace set a schedule for (story 414), each with Shared's schedule as
   * it was when it first did.
   */
  async scheduled(
    id: number,
  ): Promise<Array<{ nodeId: number; key: string; name: string; base: unknown[] }>> {
    const rows = await this.#db.q
      .selectFrom('workspace_schedule as w')
      .innerJoin('node as n', 'n.id', 'w.node_id')
      .select(['w.node_id', 'n.unique_id', 'n.text', 'w.base'])
      .where('w.workspace_id', '=', id)
      .execute()
    return rows.map((r) => ({
      nodeId: Number(r.node_id),
      key: normaliseUuid(String(r.unique_id)),
      name: String(r.text ?? ''),
      base: JSON.parse(String(r.base)) as unknown[],
    }))
  }

  /** Story 414: a page's schedule gone into Shared with a merge of it alone. */
  async dropSchedule(id: number, nodeId: number): Promise<void> {
    await this.#db.q
      .deleteFrom('content_schedule')
      .where('workspace_id', '=', id)
      .where('node_id', '=', nodeId)
      .execute()
    await this.#db.q
      .deleteFrom('workspace_schedule')
      .where('workspace_id', '=', id)
      .where('node_id', '=', nodeId)
      .execute()
  }

  async dropPending(
    id: number,
    nodeId: number,
    kinds?: ReadonlyArray<WorkspacePending['kind']>,
  ): Promise<void> {
    let rows = this.#db.q
      .deleteFrom('workspace_pending')
      .where('workspace_id', '=', id)
      .where('node_id', '=', nodeId)
    if (kinds) rows = rows.where('kind', 'in', [...kinds])
    await rows.execute()
  }

  /** A page merged alone from a person's own workspace (story 380): its rows there go. */
  async dropPage(id: number, nodeId: number): Promise<void> {
    const versions = () =>
      this.#db.q
        .selectFrom('content_version')
        .select('id')
        .where('workspace_id', '=', id)
        .where('node_id', '=', nodeId)
    await this.#db.q
      .deleteFrom('property_value')
      .where('workspace_id', '=', id)
      .where('node_id', '=', nodeId)
      .execute()
    await this.#db.q
      .deleteFrom('content_version_culture_variation')
      .where('version_id', 'in', versions())
      .execute()
    await this.#db.q.deleteFrom('document_version').where('id', 'in', versions()).execute()
    await this.#db.q
      .deleteFrom('content_version')
      .where('workspace_id', '=', id)
      .where('node_id', '=', nodeId)
      .execute()
    for (const table of ['workspace_document_culture', 'workspace_document'] as const)
      await this.#db.q
        .deleteFrom(table)
        .where('workspace_id', '=', id)
        .where('node_id', '=', nodeId)
        .execute()
  }

  /**
   * Closes a merged workspace (story 380): every row carrying it goes, as a
   * discard removes them, and the workspace stays, marked merged, by whom and
   * when. Called inside the merge's transaction, holding the tree's lock.
   */
  async closeMerged(id: number, by: string): Promise<void> {
    // Story 436: its own copies of items Shared had already went in as changes to Shared's.
    const copies = (
      await this.#db.q
        .selectFrom('node')
        .select('id')
        .where('workspace_id', '=', id)
        .where('id', 'not in', (eb) =>
          eb.selectFrom('content_type').select('node_id').where('workspace_id', '=', id),
        )
        .where('id', 'not in', (eb) =>
          eb.selectFrom('data_type').select('node_id').where('workspace_id', '=', id),
        )
        .execute()
    ).map((row) => Number(row.id))
    if (copies.length > 0) await deleteNodeRows(this.#db, { ids: copies })
    const versions = () =>
      this.#db.q.selectFrom('content_version').select('id').where('workspace_id', '=', id)
    await this.#db.q.deleteFrom('property_value').where('workspace_id', '=', id).execute()
    await this.#db.q
      .deleteFrom('content_version_culture_variation')
      .where('version_id', 'in', versions())
      .execute()
    await this.#db.q.deleteFrom('document_version').where('id', 'in', versions()).execute()
    await this.#db.q.deleteFrom('content_version').where('workspace_id', '=', id).execute()
    await this.#db.q.deleteFrom('content_schedule').where('workspace_id', '=', id).execute()
    await this.#db.q.deleteFrom('workspace_schedule').where('workspace_id', '=', id).execute()
    for (const table of [
      'workspace_pending',
      'workspace_document_culture',
      'workspace_document',
      'workspace_conflict_raised',
    ] as const)
      await this.#db.q.deleteFrom(table).where('workspace_id', '=', id).execute()
    await dropWorkspaceSchema(this.#db, id)
    // Story 399: what it staged from a source is now that source's base.
    await new ChangeSourceRepository(this.#db).merged(id)
    const now = DbDate.toDb(new Date())
    await this.#db.q
      .updateTable('workspace')
      .set({ state: 'merged', merged_at: now, merged_by: normaliseUuid(by), updated_at: now })
      .where('id', '=', id)
      .execute()
  }

  /** Story 400: a merge closed it, making `change`: raises `WorkspaceMerged`, in the merge's transaction. */
  async announceMerged(
    id: number,
    change: { key: string; name: string | null },
    by: string | null,
  ): Promise<void> {
    const merged = await this.byId(id)
    if (merged)
      await recordWorkspaceEvent(this.#db, WORKSPACE_MERGED, factsOf(merged), { by, change })
  }

  /**
   * Story 400: the items now in conflict with Shared. Those not raised before raise
   * `WorkspaceConflicted` together, and are kept so they are raised once until settled.
   */
  async conflicted(id: number, items: readonly ConflictedItem[], by: string | null): Promise<void> {
    if (items.length === 0) return
    const raised = new Set(
      (
        await this.#db.q
          .selectFrom('workspace_conflict_raised')
          .select('item')
          .where('workspace_id', '=', id)
          .execute()
      ).map((r) => String(r.item)),
    )
    const fresh = items.filter((i) => !raised.has(conflictId(i)))
    if (fresh.length === 0) return
    const now = DbDate.toDb(new Date())
    for (const item of fresh)
      await this.#db.q
        .insertInto('workspace_conflict_raised')
        .values({ workspace_id: id, item: conflictId(item), raised_at: now })
        .execute()
    const workspace = await this.byId(id)
    if (workspace)
      await recordWorkspaceEvent(this.#db, WORKSPACE_CONFLICTED, factsOf(workspace), {
        by,
        items: fresh,
      })
  }

  /** Story 407: how many items each workspace has in conflict, as last found; none where it has none. */
  async conflictCounts(ids: readonly number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>()
    if (ids.length === 0) return out
    for (const row of await this.#db.q
      .selectFrom('workspace_conflict_raised')
      .select(['workspace_id', (eb) => eb.fn.countAll<number>().as('n')])
      .where('workspace_id', 'in', [...ids])
      .groupBy('workspace_id')
      .execute())
      out.set(Number(row.workspace_id), Number(row.n))
    return out
  }

  /**
   * Story 400: what a person settled in the workspace, a page by its key or a file by its
   * path, so a conflict there later is raised again. `keepFiles` are files still in conflict.
   */
  async settled(id: number, settled: { key?: string; files?: { keep: readonly string[] } }) {
    if (settled.key) {
      const key = normaliseUuid(settled.key)
      await this.#db.q
        .deleteFrom('workspace_conflict_raised')
        .where('workspace_id', '=', id)
        .where(
          'item',
          'in',
          ['document', 'media', 'element', 'blueprint'].map((kind) => `${kind}:${key}`),
        )
        .execute()
    }
    if (settled.files) {
      let query = this.#db.q
        .deleteFrom('workspace_conflict_raised')
        .where('workspace_id', '=', id)
        .where('item', 'like', 'file:%')
      const keep = settled.files.keep.map((path) => `file:${path}`)
      if (keep.length > 0) query = query.where('item', 'not in', keep)
      await query.execute()
    }
  }

  /** Story 400: an item no longer in conflict, so a conflict there later is raised again. */
  async settle(id: number, item: ConflictedItem): Promise<void> {
    await this.#db.q
      .deleteFrom('workspace_conflict_raised')
      .where('workspace_id', '=', id)
      .where('item', '=', conflictId(item))
      .execute()
  }

  async #withMembers(
    rows: ReadonlyArray<{
      id: number
      key: string
      name: string
      owner_key: string
      personal?: unknown
      state?: string | null
      merged_at?: unknown
      merged_by?: string | null
      created_at: unknown
      updated_at: unknown
      staged_changes?: string | null
      visibility?: string | null
      tell_others?: unknown
      description?: string | null
    }>,
  ): Promise<Workspace[]> {
    if (rows.length === 0) return []
    const members = await this.#db.q
      .selectFrom('workspace_member')
      .select(['workspace_id', 'user_key'])
      .where(
        'workspace_id',
        'in',
        rows.map((row) => Number(row.id)),
      )
      .orderBy('added_at')
      .execute()
    return rows.map((row) => ({
      id: Number(row.id),
      key: normaliseUuid(String(row.key)),
      name: String(row.name),
      ownerKey: normaliseUuid(String(row.owner_key)),
      memberKeys: members
        .filter((m) => Number(m.workspace_id) === Number(row.id))
        .map((m) => normaliseUuid(String(m.user_key))),
      personal: fromDbBool(row.personal),
      state: row.state === 'merged' ? 'merged' : 'open',
      mergedAt: DbDate.fromDb(row.merged_at) ?? null,
      mergedBy: row.merged_by ? normaliseUuid(String(row.merged_by)) : null,
      createdAt: DbDate.fromDb(row.created_at) ?? new Date(0),
      updatedAt: DbDate.fromDb(row.updated_at) ?? new Date(0),
      ...stagedOf(row.staged_changes),
      visibility: row.visibility === 'editors' ? 'editors' : 'members',
      tellOthers: row.tell_others === undefined ? true : fromDbBool(row.tell_others),
      description: row.description ?? null,
    }))
  }
}

/**
 * Removes a workspace's own schema (story 376): its copies of types and data types,
 * with their properties, groups and relations, then its file list and every text
 * nothing else keeps. Its pages must be gone, or moved to Shared's types, first.
 */
export async function dropWorkspaceSchema(db: Db, id: number): Promise<void> {
  const types = (
    await db.q.selectFrom('content_type').select('node_id').where('workspace_id', '=', id).execute()
  ).map((row) => Number(row.node_id))
  const dataTypes = (
    await db.q.selectFrom('data_type').select('node_id').where('workspace_id', '=', id).execute()
  ).map((row) => Number(row.node_id))
  if (types.length > 0) {
    const properties = () =>
      db.q.selectFrom('property_type').select('id').where('content_type_id', 'in', types)
    await db.q.deleteFrom('property_value').where('property_type_id', 'in', properties()).execute()
    await db.q
      .deleteFrom('member_property_type')
      .where('property_type_id', 'in', properties())
      .execute()
    await db.q.deleteFrom('property_type').where('content_type_id', 'in', types).execute()
    await db.q
      .deleteFrom('property_type_group')
      .where('content_type_node_id', 'in', types)
      .execute()
    await db.q
      .deleteFrom('content_type_composition')
      .where((eb) =>
        eb.or([
          eb('child_content_type_id', 'in', types),
          eb('parent_content_type_id', 'in', types),
        ]),
      )
      .execute()
    await db.q
      .deleteFrom('content_type_allowed_child')
      .where((eb) =>
        eb.or([eb('content_type_id', 'in', types), eb('allowed_content_type_id', 'in', types)]),
      )
      .execute()
    await db.q
      .deleteFrom('content_type_template')
      .where('content_type_node_id', 'in', types)
      .execute()
    await db.q.deleteFrom('content_type').where('workspace_id', '=', id).execute()
  }
  await db.q.deleteFrom('data_type').where('workspace_id', '=', id).execute()
  const nodes = [...types, ...dataTypes]
  if (nodes.length > 0) await db.q.deleteFrom('node').where('id', 'in', nodes).execute()
  await new WorkspaceFileRepository(db).discard(id)
}

function stagedOf(
  text: string | null | undefined,
): Pick<Workspace, 'stagedChanges' | 'stagedReadOnly'> {
  if (!text) return { stagedChanges: null, stagedReadOnly: false }
  const parsed = JSON.parse(String(text)) as { readOnly: boolean; changes: StagedChange[] }
  return { stagedChanges: parsed.changes, stagedReadOnly: parsed.readOnly }
}
