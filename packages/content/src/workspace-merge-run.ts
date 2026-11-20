/**
 * Running a workspace's merge into Shared (story 380): in one transaction under
 * the content tree's lock, each page the workspace changed is saved in Shared
 * with the fields it takes, published as the workspace left it, and each move,
 * reorder and delete is done; then the workspace is closed. Anything refused
 * undoes all of it. A rehearsal runs the same and undoes it on purpose.
 */
import type { DocumentValue } from '@crombolo/core'
import {
  type Db,
  DocumentRepository,
  type DocumentRepositoryOptions,
  Locks,
  SystemNodes,
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
  apply(tx: Db, ready: unknown): Promise<{ restore(): void; after(): Promise<void> }>
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
    }
  | { ok: false; blockers: string[]; plan: MergePlan }

class Rehearsed extends Error {}

/** The plan for a workspace's merge as things stand, without writing anything. */
export async function previewWorkspaceMerge(
  db: Db,
  repository: DocumentRepositoryOptions | undefined,
  workspace: Workspace,
): Promise<MergePlan> {
  return planFor(new DocumentRepository(db, repository), new WorkspaceRepository(db), workspace)
}

async function planFor(
  shared: DocumentRepository,
  workspaces: WorkspaceRepository,
  workspace: Workspace,
): Promise<MergePlan> {
  const pages = await shared.inWorkspace(workspace.id).workspaceMergePages()
  const pending = await workspaces.pending(workspace.id)
  const where = new Map<number, { parentId: number; head: number | null }>()
  for (const p of pending) {
    if (p.key === null) continue
    const node = await shared.nodes.byId(p.nodeId)
    if (node && !node.trashed)
      where.set(p.nodeId, { parentId: node.parentId, head: await shared.sharedHeadEvent(node.id) })
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
  const locked = <T>(fn: () => Promise<T>) =>
    files ? options.db.locks.withLock(Locks.Schema, fn) : fn()
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
        for (const [n, workspace] of list.entries()) {
          // Its files first, so its pages are written against the types they need.
          if (files) written.push(await files.apply(tx, filePlans[n]))
          // Each after the first is planned again against Shared as the ones before left it.
          const plan =
            n === 0
              ? (first[0] as { plan: MergePlan }).plan
              : narrowed(await planFor(shared, workspaces, workspace))
          await apply(shared, plan, record, options, { merged, forApproval, done })
          if (options.only === undefined)
            await workspaces.closeMerged(workspace.id, options.userKey)
          else
            for (const page of plan.pages)
              if (!page.page.made) await workspaces.dropPage(workspace.id, page.page.nodeId)
        }
        outcome = { ok: true, merged, forApproval, done, rehearsed: options.rehearse === true }
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
  shared: DocumentRepository,
  plan: MergePlan,
  record: (event: DocumentEvent) => Promise<void>,
  options: WorkspaceMergeOptions,
  out: Pick<Done, 'merged' | 'forApproval' | 'done'>,
): Promise<void> {
  for (const pagePlan of plan.pages) {
    const { page } = pagePlan
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
  }

  const keyOf = async (id: number | null) =>
    id === null || id === SystemNodes.Root ? null : ((await shared.nodes.byId(id))?.key ?? null)
  for (const { pending } of plan.pending) {
    const key = pending.key
    if (pending.kind === 'gone' || key === null) continue
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
  }
}
