/**
 * Every change to a site, recorded (story 381). A change is a run, as an applied
 * bundle is: a merged workspace, a direct edit of the definitions or files, or a
 * revert. Its files are `change_item` rows, each with its text before and after,
 * kept once by hash; its pages are the run's `content_transfer_change` rows. A
 * person's direct edits gather in one change until ten minutes pass with none;
 * their page edits are counted on it from the pages' own history, not listed.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'
import { currentSchemaState } from '../schema-state.ts'
import { fileHash } from './workspace-files.ts'

/** `replace`: a whole site applied over one that held pages (story 383). */
export type ChangeSource = 'bundle' | 'replace' | 'merge' | 'edit' | 'revert'

/** How long a person's direct edits keep gathering in one change. */
export const EDIT_WINDOW_MS = 10 * 60 * 1000

/** Where a change keeps a page's schedule among its items (story 395): `schedules/<page key>`. */
export const SCHEDULE_PREFIX = 'schedules/'

/** Story 411: where a change keeps a page's place and whether it was published: `places/<key>`. */
export const PLACE_PREFIX = 'places/'

/** Story 411: where a change keeps the order of a parent's children: `orders/<key>` or `orders/root`. */
export const ORDER_PREFIX = 'orders/'

/** Where a page stood, beside its content, as a change carries it (story 411). */
export interface PagePlace {
  parentKey: string | null
  published: boolean
  /** In the recycle bin. */
  trashed?: boolean
}

/** Story 425: where a change keeps the order a page it made or moved stood in: `siblings/<parent>` or `siblings/root`. */
export const SIBLINGS_PREFIX = 'siblings/'

/** The item path for the order a parent's children stood in when a change put a page among them. */
export const siblingsPath = (parentKey: string | null) =>
  `${SIBLINGS_PREFIX}${parentKey ? normaliseUuid(parentKey) : 'root'}`

/** The item path for a parent's children's order. */
export const orderPath = (parentKey: string | null) =>
  `${ORDER_PREFIX}${parentKey ? normaliseUuid(parentKey) : 'root'}`

export interface Change {
  id: string
  kind: ChangeSource
  name: string | null
  /** The identity that travels with it to another site (story 383). */
  key: string
  madeBy: string | null
  appliedBy: string | null
  workspaceKey: string | null
  revertsId: string | null
  status: string
  startedAt: Date
  finishedAt: Date | null
  closedAt: Date | null
  items: number
  pages: number
}

export interface ChangeItem {
  id: number
  changeId: string
  path: string
  kind: string
  class: string
  before: string | null
  after: string | null
}

/** One item as it is recorded. */
export interface ChangeItemInput {
  path: string
  kind: string
  class: string
  before: string | null
  after: string | null
}

export class ChangeRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async #put(text: string | null): Promise<string | null> {
    if (text === null) return null
    const hash = fileHash(text)
    const found = await this.#db.q
      .selectFrom('file_blob')
      .select('hash')
      .where('hash', '=', hash)
      .execute()
    if (found.length === 0)
      await this.#db.q
        .insertInto('file_blob')
        .values({ hash, text, size: Buffer.byteLength(text) })
        .execute()
    return hash
  }

  /** Starts a change; its id is its key, which travels with it. */
  async begin(change: {
    kind: Exclude<ChangeSource, 'bundle' | 'replace'>
    name: string | null
    madeBy: string | null
    appliedBy?: string | null
    workspaceKey?: string | null
    revertsId?: string | null
    key?: string
  }): Promise<string> {
    const id = normaliseUuid(change.key ?? crypto.randomUUID())
    const state = await currentSchemaState(this.#db)
    const now = DbDate.toDb(new Date())
    await this.#db.q
      .insertInto('content_transfer_run')
      .values({
        id,
        bundle_id: id,
        bundle_label: change.name,
        direction: change.kind === 'revert' ? 'revert' : 'import',
        reverts_run_id: change.revertsId ?? null,
        schema_state_id: state.id,
        started_at: now,
        finished_at: now,
        applied_by: change.appliedBy ?? change.madeBy,
        node_count: 0,
        status: 'applied',
        change_kind: change.kind,
        name: change.name,
        change_key: id,
        made_by: change.madeBy,
        workspace_key: change.workspaceKey ?? null,
      })
      .execute()
    return id
  }

  /** Records a change brought from another site as applied here, in run `runId` (story 383). */
  async applied(change: { key: string; name: string | null }, runId: string): Promise<void> {
    await this.#db.q
      .insertInto('applied_change')
      .values({
        change_key: normaliseUuid(change.key),
        run_id: runId,
        name: change.name,
        applied_at: DbDate.toDb(new Date()),
      })
      .execute()
  }

  /** Which of these changes this site holds: applied from elsewhere, or made here. */
  async held(keys: readonly string[]): Promise<Set<string>> {
    const wanted = keys.map(normaliseUuid)
    if (wanted.length === 0) return new Set()
    const applied = await this.#db.q
      .selectFrom('applied_change')
      .select('change_key')
      .where('change_key', 'in', wanted)
      .execute()
    // Made here, even since reverted: a change that was reverted does not come back by another route.
    const made = await this.#db.q
      .selectFrom('content_transfer_run')
      .select('change_key')
      .where('change_key', 'in', wanted)
      .execute()
    return new Set([
      ...applied.map((r) => String(r.change_key)),
      ...made.map((r) => String(r.change_key)),
    ])
  }

  /** Whether the site holds any page, media item or Library item outside a workspace. */
  async holdsPages(): Promise<boolean> {
    const rows = await this.#db.q
      .selectFrom('content')
      .innerJoin('node', 'node.id', 'content.node_id')
      .select('node.id')
      .where('node.workspace_id', 'is', null)
      .limit(1)
      .execute()
    return rows.length > 0
  }

  /** Marks an applied whole site as replacing everything the site held (story 383). */
  async markReplacing(runId: string): Promise<void> {
    await this.#db.q
      .updateTable('content_transfer_run')
      .set({ change_kind: 'replace' })
      .where('id', '=', runId)
      .execute()
  }

  /** Records one item of a change. */
  async item(changeId: string, input: ChangeItemInput): Promise<void> {
    await this.#db.q
      .insertInto('change_item')
      .values({
        run_id: changeId,
        path: input.path,
        kind: input.kind,
        class: input.class,
        before_hash: await this.#put(input.before),
        after_hash: await this.#put(input.after),
      })
      .execute()
  }

  /**
   * A person's direct edit of a file (story 381): it joins their open edit, unless
   * ten minutes have passed since its last, when that one closes and another
   * opens. An item already there keeps its first "before" and takes the new "after".
   */
  async recordEdit(madeBy: string, input: ChangeItemInput, now = new Date()): Promise<string> {
    const id = await this.#openEdit(madeBy, now)
    const found = await this.#db.q
      .selectFrom('change_item')
      .select('id')
      .where('run_id', '=', id)
      .where('path', '=', input.path)
      .execute()
    if (found[0])
      await this.#db.q
        .updateTable('change_item')
        .set({ after_hash: await this.#put(input.after), kind: input.kind, class: input.class })
        .where('id', '=', Number(found[0].id))
        .execute()
    else await this.item(id, input)
    await this.#touch(id, now)
    return id
  }

  /**
   * A page a person saved straight in Shared (story 388): in their open change, as it
   * stood before their first save there and as it is now.
   */
  async pageSavedBy(madeBy: string, page: { key: string; kind: string }, now = new Date()) {
    const id = await this.#openEdit(madeBy, now)
    await this.#recordPage(id, page)
    await this.#touch(id, now)
  }

  /**
   * A page's schedule a person set or cleared straight in Shared (story 395): in their
   * open change with the page, kept as an item of its own, as the change carries it.
   */
  async scheduleOf(
    madeBy: string,
    page: { key: string; kind: string },
    entries: readonly unknown[],
    now = new Date(),
  ): Promise<void> {
    const id = await this.#openEdit(madeBy, now)
    if (!(await this.#recordPage(id, page))) return
    const path = `${SCHEDULE_PREFIX}${normaliseUuid(page.key)}`
    const after = JSON.stringify(entries)
    const found = await this.#db.q
      .selectFrom('change_item')
      .select('id')
      .where('run_id', '=', id)
      .where('path', '=', path)
      .execute()
    if (found[0])
      await this.#db.q
        .updateTable('change_item')
        .set({ after_hash: await this.#put(after) })
        .where('id', '=', Number(found[0].id))
        .execute()
    else await this.item(id, { path, kind: 'page', class: 'none', before: null, after })
    await this.#touch(id, now)
  }

  /**
   * A page a person moved, restored or unpublished straight in Shared (story 411): in
   * their open change, with where it stood before their first such change and now.
   */
  async placed(
    madeBy: string,
    page: { key: string; kind: string },
    before: PagePlace,
    after: PagePlace,
    now = new Date(),
  ): Promise<boolean> {
    const id = await this.#openEdit(madeBy, now)
    if (!(await this.#recordPage(id, page))) return false
    await this.#keepItem(id, `${PLACE_PREFIX}${normaliseUuid(page.key)}`, before, after)
    await this.#touch(id, now)
    return true
  }

  /**
   * Story 425: a page a person made or moved straight in Shared, with its parent's children
   * in order then, so it takes the same place where the change is taken.
   */
  async amongSiblings(
    madeBy: string,
    parentKey: string | null,
    keys: readonly string[],
    now = new Date(),
  ): Promise<void> {
    const id = await this.#openEdit(madeBy, now)
    await this.#keepItem(id, siblingsPath(parentKey), null, keys)
    await this.#touch(id, now)
  }

  /** A parent's children a person reordered straight in Shared (story 411), before and now. */
  async ordered(
    madeBy: string,
    parentKey: string | null,
    before: readonly string[],
    after: readonly string[],
    now = new Date(),
  ): Promise<void> {
    const id = await this.#openEdit(madeBy, now)
    await this.#keepItem(id, orderPath(parentKey), before, after)
    await this.#touch(id, now)
  }

  /**
   * A page a person deleted straight in Shared, to the recycle bin or for good (story
   * 411): in their open change as a removal, keeping the page as it stood.
   */
  async removedBy(
    madeBy: string,
    page: { key: string; kind: string },
    was: object,
    now = new Date(),
  ): Promise<void> {
    const id = await this.#openEdit(madeBy, now)
    const nodeKey = normaliseUuid(page.key)
    const recorded = await this.#db.q
      .selectFrom('content_transfer_change')
      .select('id')
      .where('run_id', '=', id)
      .where('node_key', '=', nodeKey)
      .execute()
    // Gone for good, it cannot be read back: one the change already holds keeps its row.
    if (recorded.length === 0 && !(await this.#recordPage(id, page)))
      await this.#db.q
        .insertInto('content_transfer_change')
        .values({
          run_id: id,
          node_key: nodeKey,
          kind: page.kind,
          action: 'recycle',
          before_event_id: null,
          before_published_event_id: null,
          event_id: null,
        })
        .execute()
    await this.#db.q
      .updateTable('content_transfer_change')
      .set({ action: 'recycle', event_id: null })
      .where('run_id', '=', id)
      .where('node_key', '=', nodeKey)
      .execute()
    const path = `pages/${nodeKey}`
    const found = await this.#db.q
      .selectFrom('change_item')
      .select('id')
      .where('run_id', '=', id)
      .where('path', '=', path)
      .execute()
    if (!found[0])
      await this.item(id, {
        path,
        kind: 'page',
        class: 'none',
        before: JSON.stringify(was),
        after: null,
      })
    await this.#touch(id, now)
  }

  /**
   * Story 413: a person's newest change that holds a page, made by their own edits or by
   * the merge of their own workspace, closed if it was still open.
   */
  async closeHolding(
    madeBy: string,
    pageKey: string,
    now = new Date(),
  ): Promise<{ id: string; key: string; name: string | null; merged: boolean } | undefined> {
    const row = await this.#db.q
      .selectFrom('content_transfer_change as c')
      .innerJoin('content_transfer_run as r', 'r.id', 'c.run_id')
      .select(['r.id', 'r.change_kind', 'r.closed_at'])
      .where('c.node_key', '=', normaliseUuid(pageKey))
      .where('r.made_by', '=', normaliseUuid(madeBy))
      .where('r.change_kind', 'in', ['edit', 'merge'])
      .orderBy('r.started_at', 'desc')
      .executeTakeFirst()
    if (!row) return undefined
    const id = String(row.id)
    const merged = row.change_kind === 'merge'
    if (!merged && row.closed_at === null) {
      const closed = await this.#close(id, now)
      return { id, ...closed, merged }
    }
    const run = await this.byId(id)
    return run ? { id, key: run.key, name: run.name, merged } : undefined
  }

  /** Story 413: a page's schedule set by an approval, kept in the change that holds the page. */
  async scheduleIn(changeId: string, pageKey: string, entries: readonly unknown[]): Promise<void> {
    await this.#keepItem(changeId, `${SCHEDULE_PREFIX}${normaliseUuid(pageKey)}`, null, entries)
  }

  /** Closes a person's open change (story 411): finished, to be passed on. */
  async closeOpen(
    madeBy: string,
    now = new Date(),
  ): Promise<{ key: string; name: string | null } | undefined> {
    const open = await this.#db.q
      .selectFrom('content_transfer_run')
      .select('id')
      .where('change_kind', '=', 'edit')
      .where('made_by', '=', madeBy)
      .where('closed_at', 'is', null)
      .orderBy('started_at', 'desc')
      .executeTakeFirst()
    return open ? this.#close(String(open.id), now) : undefined
  }

  /** An item that keeps its first "before" and takes the latest "after". */
  async #keepItem(id: string, path: string, before: unknown, after: unknown) {
    const found = await this.#db.q
      .selectFrom('change_item')
      .select('id')
      .where('run_id', '=', id)
      .where('path', '=', path)
      .execute()
    if (found[0])
      await this.#db.q
        .updateTable('change_item')
        .set({ after_hash: await this.#put(JSON.stringify(after)) })
        .where('id', '=', Number(found[0].id))
        .execute()
    else
      await this.item(id, {
        path,
        kind: 'page',
        class: 'none',
        before: JSON.stringify(before),
        after: JSON.stringify(after),
      })
  }

  /**
   * A page a person published straight in Shared (story 388): in their open change as
   * it is now, and the change closed, so it is finished and can be passed on. Their
   * next edit starts another.
   */
  async publishedBy(
    madeBy: string,
    page: { key: string; kind: string },
    now = new Date(),
  ): Promise<{ key: string; name: string | null } | undefined> {
    const id = await this.#openEdit(madeBy, now)
    if (!(await this.#recordPage(id, page))) return undefined
    return this.#close(id, now)
  }

  async #close(id: string, now: Date): Promise<{ key: string; name: string | null }> {
    await this.#touch(id, now)
    await this.#db.q
      .updateTable('content_transfer_run')
      .set({ closed_at: DbDate.toDb(now) })
      .where('id', '=', id)
      .execute()
    const run = await this.#db.q
      .selectFrom('content_transfer_run')
      .select(['change_key', 'name'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
    return { key: String(run.change_key ?? id), name: (run.name as string | null) ?? null }
  }

  /**
   * A page in a change: its event now, and, the first time, the event it stood at
   * before: the one before its latest write, or where the last change left it.
   */
  async #recordPage(id: string, page: { key: string; kind: string }): Promise<boolean> {
    const nodeKey = normaliseUuid(page.key)
    const node = await this.#db.q
      .selectFrom('node')
      .select('id')
      .where('unique_id', '=', nodeKey)
      .where('workspace_id', 'is', null)
      .executeTakeFirst()
    if (!node) return false
    const versions = await this.#db.q
      .selectFrom('content_version')
      .select('id')
      .where('node_id', '=', Number(node.id))
      .where('workspace_id', 'is', null)
      .orderBy('id', 'desc')
      .limit(2)
      .execute()
    const head = versions[0] ? Number(versions[0].id) : null
    const recorded = await this.#db.q
      .selectFrom('content_transfer_change')
      .select('id')
      .where('run_id', '=', id)
      .where('node_key', '=', nodeKey)
      .execute()
    if (recorded[0]) {
      await this.#db.q
        .updateTable('content_transfer_change')
        .set({ event_id: head })
        .where('id', '=', Number(recorded[0].id))
        .execute()
      return true
    }
    const left = await this.#db.q
      .selectFrom('content_transfer_change')
      .select('event_id')
      .where('node_key', '=', nodeKey)
      .where('run_id', '!=', id)
      .where('event_id', 'is not', null)
      .orderBy('event_id', 'desc')
      .limit(1)
      .execute()
    const before =
      left[0]?.event_id !== undefined && left[0]?.event_id !== null
        ? Number(left[0].event_id)
        : versions[1]
          ? Number(versions[1].id)
          : null
    await this.#db.q
      .insertInto('content_transfer_change')
      .values({
        run_id: id,
        node_key: nodeKey,
        kind: page.kind,
        action: before === null ? 'create' : 'update',
        before_event_id: before,
        before_published_event_id: null,
        event_id: head,
      })
      .execute()
    return true
  }

  async #touch(id: string, now: Date) {
    await this.#db.q
      .updateTable('content_transfer_run')
      .set({ finished_at: DbDate.toDb(now) })
      .where('id', '=', id)
      .execute()
  }

  /** A person's open direct-edit change, closing it and opening another past the window. */
  async #openEdit(madeBy: string, now: Date): Promise<string> {
    const open = await this.#db.q
      .selectFrom('content_transfer_run')
      .select(['id', 'finished_at'])
      .where('change_kind', '=', 'edit')
      .where('made_by', '=', madeBy)
      .where('closed_at', 'is', null)
      .orderBy('started_at', 'desc')
      .execute()
    let id = open[0] ? String(open[0].id) : undefined
    const last = open[0] ? DbDate.fromDb(open[0].finished_at) : null
    if (id && last && now.getTime() - last.getTime() > EDIT_WINDOW_MS) {
      await this.#db.q
        .updateTable('content_transfer_run')
        .set({ closed_at: DbDate.toDb(last) })
        .where('id', '=', id)
        .execute()
      id = undefined
    }
    return id ?? (await this.begin({ kind: 'edit', name: null, madeBy }))
  }

  #view(row: Record<string, unknown>, items: number, pages: number): Change {
    return {
      id: String(row.id),
      kind: (row.change_kind as ChangeSource | null) ?? 'bundle',
      name: (row.name as string | null) ?? (row.bundle_label as string | null) ?? null,
      key: String(row.change_key ?? row.bundle_id),
      madeBy: (row.made_by as string | null) ?? null,
      appliedBy: (row.applied_by as string | null) ?? null,
      workspaceKey: (row.workspace_key as string | null) ?? null,
      revertsId: (row.reverts_run_id as string | null) ?? null,
      status: String(row.status),
      startedAt: DbDate.fromDb(row.started_at) ?? new Date(0),
      finishedAt: DbDate.fromDb(row.finished_at) ?? null,
      closedAt: DbDate.fromDb(row.closed_at) ?? null,
      items,
      pages,
    }
  }

  async #counts(ids: readonly string[]) {
    const items = new Map<string, number>()
    const pages = new Map<string, number>()
    if (ids.length === 0) return { items, pages }
    for (const row of await this.#db.q
      .selectFrom('change_item')
      .select(['run_id', (eb) => eb.fn.countAll<number>().as('n')])
      .where('run_id', 'in', ids)
      // Story 425: where a page stood among its siblings is not something a change lists.
      .where('path', 'not like', `${SIBLINGS_PREFIX}%`)
      .groupBy('run_id')
      .execute())
      items.set(String(row.run_id), Number(row.n))
    for (const row of await this.#db.q
      .selectFrom('content_transfer_change')
      .select(['run_id', (eb) => eb.fn.countAll<number>().as('n')])
      .where('run_id', 'in', ids)
      .groupBy('run_id')
      .execute())
      pages.set(String(row.run_id), Number(row.n))
    return { items, pages }
  }

  /** The site's changes, newest first. */
  async list(skip = 0, take = 50): Promise<{ total: number; items: Change[] }> {
    const total = Number(
      (
        await this.#db.q
          .selectFrom('content_transfer_run')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .execute()
      )[0]?.n ?? 0,
    )
    const rows = await this.#db.q
      .selectFrom('content_transfer_run')
      .selectAll()
      .orderBy('started_at', 'desc')
      .orderBy('id')
      .limit(take)
      .offset(skip)
      .execute()
    const counts = await this.#counts(rows.map((r) => String(r.id)))
    return {
      total,
      items: rows.map((r) =>
        this.#view(r, counts.items.get(String(r.id)) ?? 0, counts.pages.get(String(r.id)) ?? 0),
      ),
    }
  }

  async byId(id: string): Promise<Change | undefined> {
    const rows = await this.#db.q
      .selectFrom('content_transfer_run')
      .selectAll()
      .where('id', '=', id)
      .execute()
    if (!rows[0]) return undefined
    const counts = await this.#counts([id])
    return this.#view(rows[0], counts.items.get(id) ?? 0, counts.pages.get(id) ?? 0)
  }

  /**
   * The changes added to since this one was last added to, oldest first (story 406);
   * undefined where the site holds no such change. One applied from another site is
   * known by the key it travelled with too.
   */
  async addedToSince(id: string): Promise<Change[] | undefined> {
    const wanted = normaliseUuid(id)
    const applied = await this.#db.q
      .selectFrom('applied_change')
      .select('run_id')
      .where('change_key', '=', wanted)
      .execute()
    const base = (
      await this.#db.q
        .selectFrom('content_transfer_run')
        .select(['id', 'started_at', 'finished_at'])
        .where('id', 'in', [wanted, ...applied.map((a) => String(a.run_id))])
        .execute()
    )[0]
    if (!base) return undefined
    const rows = await this.#db.q
      .selectFrom('content_transfer_run')
      .selectAll()
      .where('id', '<>', String(base.id))
      .where(
        (eb) => eb.fn.coalesce('finished_at', 'started_at'),
        '>=',
        base.finished_at ?? base.started_at,
      )
      .orderBy((eb) => eb.fn.coalesce('finished_at', 'started_at'))
      .orderBy('id')
      .execute()
    const counts = await this.#counts(rows.map((r) => String(r.id)))
    return rows.map((r) =>
      this.#view(r, counts.items.get(String(r.id)) ?? 0, counts.pages.get(String(r.id)) ?? 0),
    )
  }

  async #texts(hashes: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(hashes.filter((h): h is string => Boolean(h)))]
    if (wanted.length === 0) return new Map()
    return new Map(
      (
        await this.#db.q
          .selectFrom('file_blob')
          .select(['hash', 'text'])
          .where('hash', 'in', wanted)
          .execute()
      ).map((r) => [String(r.hash), String(r.text)]),
    )
  }

  async #items(where: { runId?: string; path?: string }): Promise<ChangeItem[]> {
    let query = this.#db.q
      .selectFrom('change_item as i')
      .innerJoin('content_transfer_run as r', 'r.id', 'i.run_id')
      .select(['i.id', 'i.run_id', 'i.path', 'i.kind', 'i.class', 'i.before_hash', 'i.after_hash'])
      .orderBy('r.started_at')
      .orderBy('i.id')
    if (where.runId) query = query.where('i.run_id', '=', where.runId)
    if (where.path) query = query.where('i.path', '=', where.path)
    const rows = await query.execute()
    const texts = await this.#texts(rows.flatMap((r) => [r.before_hash, r.after_hash]))
    return rows.map((r) => ({
      id: Number(r.id),
      changeId: String(r.run_id),
      path: String(r.path),
      kind: String(r.kind),
      class: String(r.class),
      before: r.before_hash ? (texts.get(String(r.before_hash)) ?? null) : null,
      after: r.after_hash ? (texts.get(String(r.after_hash)) ?? null) : null,
    }))
  }

  /** The files a change touched, with each text before and after. */
  /**
   * A change's files. A page it deleted is kept among its items as it stood
   * (story 383), for taking the change to another site: only with `pages`.
   */
  async itemsOf(changeId: string, options: { pages?: boolean } = {}): Promise<ChangeItem[]> {
    const items = await this.#items({ runId: changeId })
    return options.pages ? items : items.filter((i) => i.kind !== 'page')
  }

  /** A file's versions: each change that touched it, oldest first. Nobody numbers anything. */
  versions(path: string): Promise<ChangeItem[]> {
    return this.#items({ path })
  }

  /**
   * The paths a change touched that a later change, still applied, touched again.
   * A later change since reverted no longer stands in the way, and neither does
   * its revert.
   */
  async laterTouching(changeId: string): Promise<Array<{ path: string; changeId: string }>> {
    const change = await this.byId(changeId)
    if (!change) return []
    const own = (await this.itemsOf(changeId)).map((i) => i.path)
    if (own.length === 0) return []
    const rows = await this.#db.q
      .selectFrom('change_item as i')
      .innerJoin('content_transfer_run as r', 'r.id', 'i.run_id')
      .leftJoin('content_transfer_run as t', 't.id', 'r.reverts_run_id')
      .select(['i.path', 'i.run_id', 'r.change_kind', 't.started_at as reverted_started_at'])
      .where('i.path', 'in', own)
      .where('r.id', '<>', changeId)
      .where('r.status', '=', 'applied')
      .where('r.started_at', '>', DbDate.toDb(change.startedAt))
      .execute()
    return rows
      .filter((r) => {
        if (r.change_kind !== 'revert') return true
        const reverted = DbDate.fromDb(r.reverted_started_at)
        return !reverted || reverted.getTime() <= change.startedAt.getTime()
      })
      .map((r) => ({ path: String(r.path), changeId: String(r.run_id) }))
  }

  /** How many page saves a person made directly between two moments: an edit's pages, counted. */
  async pageEditsBy(userKey: string, from: Date, to: Date): Promise<number> {
    const rows = await this.#db.q
      .selectFrom('content_version as v')
      .innerJoin('user_account as u', 'u.id', 'v.user_id')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('u.key', '=', normaliseUuid(userKey))
      .where('v.workspace_id', 'is', null)
      .where('v.version_date', '>=', DbDate.toDb(from))
      .where('v.version_date', '<=', DbDate.toDb(to))
      .execute()
    return Number(rows[0]?.n ?? 0)
  }

  /** Marks a change reverted, as a run's revert does. */
  async setStatus(id: string, status: 'applied' | 'reverted'): Promise<void> {
    await this.#db.q
      .updateTable('content_transfer_run')
      .set({ status })
      .where('id', '=', id)
      .execute()
  }
}
