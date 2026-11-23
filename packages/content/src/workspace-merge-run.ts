/**
 * Running a workspace's merge into Shared (story 380): in one transaction under
 * the content tree's lock, each page the workspace changed is saved in Shared
 * with the fields it takes, published as the workspace left it, and each move,
 * reorder and delete is done; then the workspace is closed. Anything refused
 * undoes all of it. A rehearsal runs the same and undoes it on purpose.
 */
import { type DocumentValue, ObjectTypes } from '@crombolo/core'
import {
  type ChangeItemInput,
  ChangeRepository,
  type ContentKind,
  type Db,
  DocumentRepository,
  type DocumentRepositoryOptions,
  Locks,
  SystemNodes,
  TransferRunRepository,
  type Workspace,
  WorkspaceRepository,
} from '@crombolo/data'
import type { Actor } from './actor.ts'
import type { DocumentEvent, EventSink } from './events.ts'
import {
  fieldWords,
  type MergePlan,
  mergeBlockers,
  type PageMergePlan,
  planWorkspaceMerge,
} from './workspace-merge.ts'

export interface WorkspaceMergeOptions {
  db: Db
  repository?: DocumentRepositoryOptions
  events: EventSink
  actor: Actor
  /** The user's id, for the events a merge writes; the user's key, for the workspace's record. */
  userId?: number
  userKey: string
  /** The findings the person accepted, by id. */
  accepted?: readonly string[]
  /**
   * Why the merge may not publish a page itself: a workflow covers it. Such a
   * page is saved in Shared and sent for approval once the merge commits.
   */
  publishRefusal?(key: string, action: 'publish' | 'unpublish'): Promise<string | undefined>
  /** Run it all and undo it: what a merge would do, with every refusal it would meet. */
  rehearse?: boolean
  /**
   * A workspace's files (story 376): what merging them would write and what
   * conflicts, then writing them on the merge's transaction, before its pages.
   */
  files?: WorkspaceFileMerging
  /**
   * The identity the change it records takes (story 383): a change brought from
   * another site keeps its own. By default a whole workspace's own key, so one
   * exported before it merged is known as the same change.
   */
  changeKey?: string
  /** The changes from other sites this merge applies, recorded so each is applied once (story 383). */
  appliedChanges?: ReadonlyArray<{ key: string; name: string | null }>
}

/** How a merge plans and writes a workspace's files, which the server knows. */
export interface WorkspaceFileMerging {
  /**
   * `conflicts` refuse the merge outright; `findings` until each is accepted by
   * its id or its kind (story 382).
   */
  plan(
    workspaceId: number,
    tx: Db,
  ): Promise<{
    conflicts: string[]
    findings: Array<{ id: string; kind: string; says: string }>
    ready: unknown
  }>
  /** Writes them; `items` are each file's text before and after, for the change it records. */
  apply(
    tx: Db,
    ready: unknown,
  ): Promise<{ restore(): void; after(): Promise<void>; items?: ChangeItemInput[] }>
}

export type WorkspaceMergeOutcome =
  | {
      ok: true
      merged: Array<{ key: string; name: string; published: boolean; unpublished: boolean }>
      /** Pages a workflow covers: saved in Shared, to be sent for approval. */
      forApproval: Array<{
        key: string
        name: string
        action: 'publish' | 'unpublish'
        cultures: string[] | null
      }>
      done: Array<{ key: string | null; name: string; kind: string }>
      rehearsed: boolean
      /** The change it was recorded as (story 381). */
      changeId?: string
    }
  | { ok: false; blockers: string[]; plan: MergePlan }

/** Where a deleted page's state is kept among its change's items (story 383). */
export const REMOVED_PAGE_PREFIX = 'pages/'

/** Records a merge as a change (story 381): its name, who made and merged it, its files and pages. */
async function recordChange(
  tx: Db,
  list: readonly Workspace[],
  options: WorkspaceMergeOptions & { only?: string },
  items: readonly ChangeItemInput[],
  pages: readonly PageChange[],
  merged: Done['merged'],
): Promise<string> {
  const changes = new ChangeRepository(tx)
  const first = list[0] as Workspace
  const name =
    options.only !== undefined
      ? `Published "${merged[0]?.name ?? 'a page'}"`
      : list.map((w) => w.name).join(', ')
  const id = await changes.begin({
    kind: 'merge',
    name,
    madeBy: first.ownerKey,
    appliedBy: options.userKey,
    workspaceKey: first.key,
    key:
      options.changeKey ??
      (list.length === 1 && options.only === undefined ? first.key : undefined),
  })
  for (const applied of options.appliedChanges ?? []) await changes.applied(applied, id)
  for (const item of items) await changes.item(id, item)
  const runs = new TransferRunRepository(tx)
  for (const page of pages)
    await runs.record({
      runId: id,
      nodeKey: page.key,
      kind: page.kind,
      action: page.action,
      beforeEventId: page.beforeEventId,
      beforePublishedEventId: page.beforePublishedEventId,
      eventId: page.eventId,
    })
  await runs.finish(id, pages.length)
  return id
}

/** A page's events before and after a merge, which its change records (story 381). */
interface PageChange {
  key: string
  kind: ContentKind
  action: 'create' | 'update' | 'recycle'
  beforeEventId: number | null
  beforePublishedEventId: number | null
  eventId: number | null
}

class Rehearsed extends Error {}

/** The plan for a workspace's merge as things stand, without writing anything. */
export async function previewWorkspaceMerge(
  db: Db,
  repository: DocumentRepositoryOptions | undefined,
  workspace: Workspace,
): Promise<MergePlan> {
  return planFor(new DocumentRepository(db, repository), new WorkspaceRepository(db), workspace)
}

/** The kinds a workspace holds, in the order a merge writes them: what pages use, first (story 390). */
const KINDS = ['element', 'media', 'blueprint', 'document'] as const

/** What each pending change's node is, by its object type. */
const KIND_OF: Record<string, (typeof KINDS)[number]> = {
  [ObjectTypes.Document]: 'document',
  [ObjectTypes.WorkspaceDocument]: 'document',
  [ObjectTypes.Media]: 'media',
  [ObjectTypes.WorkspaceMedia]: 'media',
  [ObjectTypes.Element]: 'element',
  [ObjectTypes.WorkspaceElement]: 'element',
  [ObjectTypes.DocumentBlueprint]: 'blueprint',
  [ObjectTypes.WorkspaceDocumentBlueprint]: 'blueprint',
}

async function planFor(
  shared: DocumentRepository,
  workspaces: WorkspaceRepository,
  workspace: Workspace,
): Promise<MergePlan> {
  const pages = []
  for (const kind of KINDS)
    pages.push(...(await shared.ofKind(kind).inWorkspace(workspace.id).workspaceMergePages()))
  const pending = await workspaces.pending(workspace.id)
  const where = new Map<number, { parentId: number; head: number | null }>()
  for (const p of pending) {
    if (p.key === null) continue
    const node = await shared.nodes.byId(p.nodeId)
    if (!node) continue
    const kind = KIND_OF[node.objectType ?? ''] ?? 'document'
    p.objectKind = kind
    if (!node.trashed)
      where.set(p.nodeId, {
        parentId: node.parentId,
        head: await shared.ofKind(kind).sharedHeadEvent(node.id),
      })
  }
  return planWorkspaceMerge(pages, pending, where)
}

/** The save a page's plan makes in Shared: the fields it takes, the rest as Shared has them. */
function saveOf(plan: PageMergePlan, userId: number | undefined) {
  const { page } = plan
  const taken = new Set(plan.take.map((f) => f.field))
  const pick = (field: string) => {
    const f = page.fields.find((x) => x.field === field)
    if (!f) return undefined
    return taken.has(field) ? f.mine : f.theirs
  }
  // A save sends every value: one it leaves out is cleared.
  const values: DocumentValue[] = page.fields.flatMap((f) =>
    f.value ? [{ ...f.value, value: (taken.has(f.field) ? f.mine : f.theirs) ?? null }] : [],
  )
  const name = String(pick('@name') ?? plan.name)
  const variants =
    page.cultures.length > 0
      ? page.cultures.map((c) => ({
          culture: c.iso,
          segment: null,
          name: String(pick(`@name:${c.iso}`) ?? name),
        }))
      : [{ culture: null, segment: null, name }]
  const template = pick('@template')
  return {
    key: page.key,
    contentTypeKey: page.contentTypeKey,
    componentKey: typeof template === 'string' ? template : null,
    parentKey: page.parentKey,
    values,
    variants,
    ...(userId === undefined ? {} : { userId }),
  }
}

type Done = Extract<WorkspaceMergeOutcome, { ok: true }>

/** Fields two workspaces both take for one page, with different values: named before anything merges. */
function betweenThem(plans: ReadonlyArray<{ workspace: Workspace; plan: MergePlan }>): string[] {
  const taken = new Map<string, { workspace: string; value: unknown; name: string }>()
  const out: string[] = []
  for (const { workspace, plan } of plans)
    for (const page of plan.pages)
      for (const field of page.take) {
        const id = `${page.page.key}|${field.field}`
        const before = taken.get(id)
        if (!before)
          taken.set(id, { workspace: workspace.name, value: field.mine, name: page.name })
        else if (JSON.stringify(before.value ?? null) !== JSON.stringify(field.mine ?? null))
          out.push(
            `"${page.name}": ${fieldWords(field.field)} is changed differently in "${before.workspace}" and "${workspace.name}"; settle it in one of them.`,
          )
      }
  return out
}

/**
 * Merges workspaces into Shared, all of them or none: each is planned against
 * Shared as the ones before it left it. With `only`, one page of one workspace
 * goes (a person's own, story 380), and the workspace stays open.
 */
export async function runWorkspaceMerge(
  chosen: Workspace | readonly Workspace[],
  options: WorkspaceMergeOptions & { only?: string },
): Promise<WorkspaceMergeOutcome> {
  const list = Array.isArray(chosen) ? chosen : [chosen as Workspace]
  const documents = new DocumentRepository(options.db, options.repository)
  const events: DocumentEvent[] = []
  let outcome: WorkspaceMergeOutcome | undefined
  const written: Array<{ restore(): void; after(): Promise<void> }> = []
  // Files sync Shared's schema, which takes the schema lock: taken first, as every
  // schema write takes it before the content tree's.
  const files = options.only === undefined ? options.files : undefined
  // Media is written too (story 390), under its own tree's lock.
  const locked = <T>(fn: () => Promise<T>) => {
    const media = () => options.db.locks.withLock(Locks.MediaTree, fn)
    return files ? options.db.locks.withLock(Locks.Schema, media) : media()
  }
  try {
    await locked(() =>
      documents.atomically(async (shared, tx) => {
        const workspaces = new WorkspaceRepository(tx)
        const narrowed = (plan: MergePlan): MergePlan =>
          options.only === undefined
            ? plan
            : {
                pages: plan.pages.filter((p) => p.page.key === options.only),
                pending: [],
                conflicts: plan.conflicts.filter((c) => c.key === options.only),
                findings: plan.findings.filter((f) => f.key === options.only),
              }
        const first: Array<{ workspace: Workspace; plan: MergePlan }> = []
        for (const workspace of list)
          first.push({ workspace, plan: narrowed(await planFor(shared, workspaces, workspace)) })
        const filePlans: unknown[] = []
        const fileBlockers: string[] = []
        for (const workspace of list) {
          const planned = files
            ? await files.plan(workspace.id, tx)
            : { conflicts: [], findings: [], ready: null }
          filePlans.push(planned.ready)
          const accepted = options.accepted ?? []
          for (const c of [
            ...planned.conflicts,
            ...planned.findings
              .filter((f) => !accepted.includes(f.id) && !accepted.includes(f.kind))
              .map((f) => f.says),
          ])
            fileBlockers.push(list.length > 1 ? `In "${workspace.name}": ${c}` : c)
        }
        // A page alone cannot go without the media or Library items it uses that only
        // the workspace has (story 390): they come with the whole workspace.
        if (options.only !== undefined)
          for (const workspace of list) {
            const own = await tx.q
              .selectFrom('node')
              .select(['unique_id', 'text'])
              .where('workspace_id', '=', workspace.id)
              .where('node_object_type', 'in', [
                ObjectTypes.WorkspaceMedia,
                ObjectTypes.WorkspaceElement,
              ])
              .execute()
            for (const { plan } of first)
              for (const page of plan.pages) {
                const text = JSON.stringify(page.page.fields.map((f) => f.mine)).toLowerCase()
                for (const item of own) {
                  const key = String(item.unique_id).toLowerCase()
                  if (text.includes(key) || text.includes(key.replaceAll('-', '')))
                    fileBlockers.push(
                      `"${page.name}" uses "${item.text ?? key}", which is only in the workspace: merge the workspace to bring both.`,
                    )
                }
              }
          }
        // A page alone cannot go before the type it is made of (story 376).
        if (options.only !== undefined)
          for (const { plan } of first)
            for (const page of plan.pages)
              if (page.page.made && (await shared.madeOfWorkspaceType(page.page.nodeId)))
                fileBlockers.push(
                  `"${page.name}" is of a type made in the workspace: merge the workspace to bring both.`,
                )
        const blockers = [
          ...fileBlockers,
          ...betweenThem(first),
          ...first.flatMap(({ workspace, plan }) =>
            mergeBlockers(plan, options.accepted ?? []).map((b) =>
              list.length > 1 ? `In "${workspace.name}": ${b}` : b,
            ),
          ),
        ]
        if (blockers.length > 0) {
          outcome = { ok: false, blockers, plan: first[0]?.plan as MergePlan }
          return
        }
        const record = async (event: DocumentEvent) => {
          events.push(event)
          await options.events.record(tx, event, options.actor)
        }
        const merged: Done['merged'] = []
        const forApproval: Done['forApproval'] = []
        const done: Done['done'] = []
        const pages: PageChange[] = []
        const items: ChangeItemInput[] = []
        for (const [n, workspace] of list.entries()) {
          // Its files first, so its pages are written against the types they need.
          if (files) {
            const applied = await files.apply(tx, filePlans[n])
            written.push(applied)
            items.push(...(applied.items ?? []))
          }
          // Each after the first is planned again against Shared as the ones before left it.
          const plan =
            n === 0
              ? (first[0] as { plan: MergePlan }).plan
              : narrowed(await planFor(shared, workspaces, workspace))
          await apply(shared, plan, record, options, {
            merged,
            forApproval,
            done,
            pages,
            removed: items,
          })
          if (options.only === undefined)
            await workspaces.closeMerged(workspace.id, options.userKey)
          else
            for (const page of plan.pages)
              if (!page.page.made) await workspaces.dropPage(workspace.id, page.page.nodeId)
        }
        // Story 381: the merge is a change, its files and pages each with before and after.
        const changeId = await recordChange(tx, list, options, items, pages, merged)
        const alone = options.only === undefined ? undefined : merged[0]
        if (alone?.published)
          await options.events.ownPublished?.(tx, { changeId, key: alone.key }, options.actor)
        outcome = {
          ok: true,
          merged,
          forApproval,
          done,
          rehearsed: options.rehearse === true,
          changeId,
        }
        if (options.rehearse) throw new Rehearsed()
      }),
    )
  } catch (error) {
    // The database is as it was: so are the files.
    for (const w of written.reverse()) w.restore()
    if (!(error instanceof Rehearsed)) throw error
    return outcome as WorkspaceMergeOutcome
  }
  for (const w of written) await w.after()
  if (outcome?.ok) for (const event of events) options.events.afterCommit?.(event, options.actor)
  return outcome as WorkspaceMergeOutcome
}

/** One workspace's plan, written into Shared through its own save, publish, move and delete. */
async function apply(
  sharedAll: DocumentRepository,
  plan: MergePlan,
  record: (event: DocumentEvent) => Promise<void>,
  options: WorkspaceMergeOptions,
  out: Pick<Done, 'merged' | 'forApproval' | 'done'> & {
    pages: PageChange[]
    removed: ChangeItemInput[]
  },
): Promise<void> {
  for (const pagePlan of plan.pages) {
    const { page } = pagePlan
    // Each kind through its own repository: pages, media, Library items (story 390).
    const shared = sharedAll.ofKind(page.kind)
    const before = page.made ? undefined : await shared.eventMarkers(page.key)
    if (page.made) await shared.adoptWorkspacePage(page.nodeId)
    if (page.made || pagePlan.take.length > 0) {
      await shared.update(saveOf(pagePlan, options.userId))
      await record({ type: page.made ? 'created' : 'saved', key: page.key })
    }
    let published = false
    let unpublished = false
    if (pagePlan.publish) {
      const cultures = pagePlan.publish.cultures
      if (await options.publishRefusal?.(page.key, 'publish'))
        out.forApproval.push({ key: page.key, name: pagePlan.name, action: 'publish', cultures })
      else {
        await shared.publish(page.key, cultures)
        await record({ type: 'published', key: page.key, cultures })
        published = true
      }
    }
    if (pagePlan.unpublish) {
      const cultures = pagePlan.unpublish.cultures
      if (await options.publishRefusal?.(page.key, 'unpublish'))
        out.forApproval.push({ key: page.key, name: pagePlan.name, action: 'unpublish', cultures })
      else {
        await shared.unpublish(page.key, cultures)
        await record({ type: 'unpublished', key: page.key, cultures })
        unpublished = true
      }
    }
    out.merged.push({ key: page.key, name: pagePlan.name, published, unpublished })
    const after = await shared.eventMarkers(page.key)
    out.pages.push({
      key: page.key,
      kind: page.kind,
      action: page.made ? 'create' : 'update',
      beforeEventId: before?.head ?? null,
      beforePublishedEventId: before?.published ?? null,
      eventId: after?.head ?? null,
    })
  }

  const keyOf = async (id: number | null) =>
    id === null || id === SystemNodes.Root ? null : ((await sharedAll.nodes.byId(id))?.key ?? null)
  for (const { pending } of plan.pending) {
    const key = pending.key
    if (pending.kind === 'gone' || key === null) continue
    const shared = sharedAll.ofKind(pending.objectKind ?? 'document')
    const before = await shared.eventMarkers(key)
    // A delete takes the page's history with it: its change keeps the page as it stood (story 383).
    if (pending.kind === 'delete') {
      const doc = await shared.byKey(key)
      if (doc)
        out.removed.push({
          path: `${REMOVED_PAGE_PREFIX}${key}`,
          kind: 'page',
          class: 'none',
          before: JSON.stringify(doc),
          after: null,
        })
    }
    if (pending.kind === 'move') {
      await shared.move(key, await keyOf(pending.targetParentId))
      await record({ type: 'moved', key })
    } else if (pending.kind === 'sort' && pending.sortOrder !== null) {
      const node = await shared.nodes.byId(pending.nodeId)
      const parentKey = await keyOf(node?.parentId ?? null)
      await shared.sort(parentKey, [{ key, sortOrder: pending.sortOrder }])
      await record({ type: 'sorted', parentKey })
    } else if (pending.kind === 'trash') {
      await shared.moveToRecycleBin(key)
      await record({ type: 'trashed', key })
    } else if (pending.kind === 'delete') {
      await shared.delete(key)
      await record({ type: 'deleted', key, name: pending.name })
    }
    out.done.push({ key, name: pending.name, kind: pending.kind })
    // Story 383: what it moved or deleted is in its change too, once per page.
    const gone = pending.kind === 'trash' || pending.kind === 'delete'
    const after = gone ? undefined : await shared.eventMarkers(key)
    const recorded = out.pages.find((p) => p.key === key)
    if (recorded) {
      if (gone) Object.assign(recorded, { action: 'recycle', eventId: null })
      else recorded.eventId = after?.head ?? recorded.eventId
    } else
      out.pages.push({
        key,
        kind: pending.objectKind ?? 'document',
        action: gone ? 'recycle' : 'update',
        beforeEventId: before?.head ?? null,
        beforePublishedEventId: before?.published ?? null,
        eventId: after?.head ?? null,
      })
  }
}
