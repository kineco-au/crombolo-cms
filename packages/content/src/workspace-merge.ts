/**
 * Planning a workspace's merge into Shared (story 380). Pure: from each page as
 * it began, as the workspace has it and as Shared has it now, and from what
 * waits for the merge, it says what the merge takes, publishes and does, what
 * conflicts, and what must be accepted by name before it goes ahead.
 */
import { threeWay } from '@crombolo/core'
import type { MergeField, WorkspacePageMerge, WorkspacePending } from '@crombolo/data'

/** A field both the workspace and Shared changed, differently. */
export interface MergeConflict {
  key: string
  name: string
  field: string
  base: unknown
  mine: unknown
  theirs: unknown
}

/** Something the merge will do that Shared did not expect, named so it can be accepted. */
export interface MergeFinding {
  id: string
  key: string | null
  name: string
  says: string
}

/** One page's part of the merge. */
export interface PageMergePlan {
  page: WorkspacePageMerge
  name: string
  /** The fields the workspace's version is taken for. */
  take: MergeField[]
  /** Publish or unpublish in Shared, with the languages; null for an invariant page. */
  publish: { cultures: string[] | null } | null
  unpublish: { cultures: string[] | null } | null
}

/** What waits for the merge, and whether it can go. */
export interface PendingMergePlan {
  pending: WorkspacePending
  /** Why it cannot go as it is; it is answered by moving it again or dropping it. */
  conflict?: string
}

export interface MergePlan {
  pages: PageMergePlan[]
  pending: PendingMergePlan[]
  conflicts: MergeConflict[]
  findings: MergeFinding[]
}

const nameOf = (page: WorkspacePageMerge): string => {
  const name = page.fields.find((f) => f.field === '@name')
  return String(name?.mine ?? name?.theirs ?? page.key)
}

/** A page made in the workspace takes every field; a changed one, field by field, three ways. */
function planPage(page: WorkspacePageMerge, conflicts: MergeConflict[]): PageMergePlan {
  const name = nameOf(page)
  const take: MergeField[] = []
  for (const field of page.fields) {
    if (page.made) {
      take.push(field)
      continue
    }
    // Shared is the site the change comes into; the workspace is what comes in.
    const outcome = threeWay(field.theirs, field.mine, { value: field.base })
    if (outcome === 'take') take.push(field)
    else if (outcome === 'ask')
      conflicts.push({
        key: page.key,
        name,
        field: field.field,
        base: field.base,
        mine: field.mine,
        theirs: field.theirs,
      })
  }

  // Published state: what the workspace did to it is what the merge does.
  const varies = page.cultures.length > 0
  let publish: PageMergePlan['publish'] = null
  let unpublish: PageMergePlan['unpublish'] = null
  if (varies) {
    const on = page.published.here ? page.cultures.filter((c) => c.mine).map((c) => c.iso) : []
    const off = page.cultures.filter((c) => !c.mine && c.base === true).map((c) => c.iso)
    if (on.length > 0) publish = { cultures: on }
    if (off.length > 0) unpublish = { cultures: off }
  } else if (page.published.here) publish = { cultures: null }
  else if (!page.published.mine && page.published.base === true && page.published.theirs)
    unpublish = { cultures: null }
  return { page, name, take, publish, unpublish }
}

/** A pending move, reorder or delete, against where Shared has the page now. */
function planPending(
  pending: WorkspacePending,
  shared: ReadonlyMap<number, { parentId: number; head: number | null }>,
): PendingMergePlan {
  if (pending.kind === 'gone') return { pending }
  if (pending.kind === 'orphaned')
    return {
      pending,
      conflict: `Its parent was deleted in Shared: move "${pending.name}" somewhere in the workspace first.`,
    }
  const now = shared.get(pending.nodeId)
  if (!now) return { pending, conflict: `"${pending.name}" is no longer in Shared.` }
  if (
    pending.kind === 'move' &&
    pending.baseParentId !== null &&
    now.parentId !== pending.baseParentId
  )
    return { pending, conflict: `"${pending.name}" was moved in Shared since.` }
  if (
    (pending.kind === 'trash' || pending.kind === 'delete') &&
    pending.baseEventId !== null &&
    now.head !== pending.baseEventId
  )
    return { pending, conflict: `"${pending.name}" was changed in Shared since.` }
  return { pending }
}

/**
 * The merge's plan. `shared` is where each pending page is in Shared now: its
 * parent and its latest event.
 */
export function planWorkspaceMerge(
  pages: readonly WorkspacePageMerge[],
  pending: readonly WorkspacePending[],
  shared: ReadonlyMap<number, { parentId: number; head: number | null }>,
): MergePlan {
  const conflicts: MergeConflict[] = []
  const findings: MergeFinding[] = []
  // Pages a workspace made go in before the pages beneath them.
  const ordered = [...pages].sort((a, b) => a.level - b.level)
  const planned = ordered.map((page) => planPage(page, conflicts))
  for (const plan of planned) {
    const { page } = plan
    if (plan.publish && page.published.sharedEdited)
      findings.push({
        id: `publishes-shared-draft:${page.key}`,
        key: page.key,
        name: plan.name,
        says: `Publishing "${plan.name}" also publishes changes made to it in Shared that were not published.`,
      })
    if (plan.publish && page.published.base === true && !page.published.theirs)
      findings.push({
        id: `unpublished-since:${page.key}`,
        key: page.key,
        name: plan.name,
        says: `"${plan.name}" was unpublished in Shared since; the merge publishes it again.`,
      })
  }
  const pendingPlans = pending.map((p) => planPending(p, shared))
  // Story 382: a page deleted is accepted by name, or every one at once by kind.
  for (const p of pendingPlans)
    if ((p.pending.kind === 'delete' || p.pending.kind === 'trash') && !p.conflict)
      findings.push({
        id: `page-deleted:${p.pending.key ?? p.pending.nodeId}`,
        key: p.pending.key,
        name: p.pending.name,
        says: `"${p.pending.name}" is ${p.pending.kind === 'trash' ? 'moved to the recycle bin' : 'deleted'}. Accept "page-deleted" to go ahead.`,
      })
  for (const p of pendingPlans)
    if (p.pending.kind === 'gone')
      findings.push({
        id: `gone:${p.pending.nodeId}`,
        key: null,
        name: p.pending.name,
        says: `"${p.pending.name}" was deleted in Shared; the workspace's changes to it are not merged.`,
      })
  return { pages: planned, pending: pendingPlans, conflicts, findings }
}

/** A field as a person reads it: `its name`, `its template`, or the property, with its language. */
export function fieldWords(field: string): string {
  if (field === '@name') return 'its name'
  if (field === '@template') return 'its template'
  if (field.startsWith('@name:')) return `its name in ${field.slice(6)}`
  const [alias, culture, segment] = field.split('|')
  const where = [culture, segment].filter(Boolean).join(', ')
  return where ? `${alias} (${where})` : String(alias)
}

/** Whether a plan can go: no conflict, nothing pending that cannot, and every finding accepted. */
export function mergeBlockers(plan: MergePlan, accepted: readonly string[]): string[] {
  const reasons = [
    ...plan.conflicts.map(
      (c) => `"${c.name}": ${fieldWords(c.field)} was changed in both the workspace and Shared.`,
    ),
    ...plan.pending.flatMap((p) => (p.conflict ? [p.conflict] : [])),
    ...plan.findings
      .filter((f) => !accepted.includes(f.id) && !accepted.includes(f.id.split(':')[0] as string))
      .map((f) => f.says),
  ]
  return reasons
}
