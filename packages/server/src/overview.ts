/**
 * The back office's Overview (story 236), under `<backoffice>/crombolo/api/overview`:
 * pages by last change, how many are drafts or published, and what people did
 * lately, each as the signed-in user may see it. docs/backoffice-hosting.md.
 */
import { hasSection, type Principal } from '@crombolo/api-management/domain'
import { hasPathAccess } from '@crombolo/core'
import {
  AuditLog,
  type Db,
  overviewPageFacts,
  type QueryState,
  queryDocuments,
} from '@crombolo/data'
import { contentQueryScope } from './content-query.ts'

/** Which pages the list shows. */
export const OVERVIEW_LISTS = {
  recent: undefined,
  drafts: ['draft'],
  published: ['published', 'changed'],
} satisfies Record<string, QueryState[] | undefined>

export type OverviewList = keyof typeof OVERVIEW_LISTS

/** Audit actions that say something to an editor; a sort or a domain change does not. */
const ACTIVITY = new Set([
  'Create',
  'Save',
  'CreateAndPublish',
  'SaveAndPublish',
  'Publish',
  'PublishWithDescendants',
  'Unpublish',
  'Trash',
  'Restore',
  'Move',
  'Copy',
  'Revert',
])
const ACTIVITY_SHOWN = 6
/** How far back the feed looks for entries the user may see. */
const ACTIVITY_SCAN = 200

export interface OverviewQuery {
  list: OverviewList
  skip: number
  take: number
}

export async function overview(db: Db, principal: Principal, query: OverviewQuery) {
  const scope = contentQueryScope(principal)
  const states = OVERVIEW_LISTS[query.list]
  const sort = { by: 'updateDate' as const, dir: 'desc' as const }
  const [pages, drafts, published] = await Promise.all([
    queryDocuments(
      db,
      { entity: 'document', state: states, sort, skip: query.skip, take: query.take },
      scope,
    ),
    queryDocuments(
      db,
      { entity: 'document', state: OVERVIEW_LISTS.drafts, skip: 0, take: 0 },
      scope,
    ),
    queryDocuments(
      db,
      { entity: 'document', state: OVERVIEW_LISTS.published, skip: 0, take: 0 },
      scope,
    ),
  ])

  const entries = (
    await new AuditLog(db).page({ category: 'content' }, { limit: ACTIVITY_SCAN })
  ).items.filter((e) => e.entityType === 'Document' && e.entityKey && ACTIVITY.has(e.action))
  const facts = await overviewPageFacts(db, [
    ...pages.items.map((p) => p.id),
    ...entries.map((e) => e.entityKey as string),
  ])
  const mayRead = (key: string) => {
    const page = facts.get(key.toLowerCase())
    if (!page || !hasPathAccess(scope.start, page.chain, page.trashed)) return false
    return scope.browses?.(page.chain) ?? true
  }

  const activity = []
  for (const entry of entries) {
    if (activity.length === ACTIVITY_SHOWN) break
    const key = (entry.entityKey as string).toLowerCase()
    if (!mayRead(key)) continue
    activity.push({
      key,
      name: facts.get(key)?.name ?? entry.entityName ?? '',
      action: entry.action,
      who: entry.userName,
      mine: entry.userKey !== null && entry.userKey === principal.id,
      when: entry.occurredAt.toISOString(),
    })
  }

  return {
    pages: {
      total: pages.total,
      items: pages.items.map((p) => ({
        key: p.id,
        name: p.name,
        type: facts.get(p.id.toLowerCase())?.contentTypeName || p.contentType.alias,
        state: p.state,
        updated: p.updateDate,
        author: facts.get(p.id.toLowerCase())?.author ?? null,
      })),
    },
    counts: { drafts: drafts.total, published: published.total },
    activity,
    // Where New content creates a page: the root, or the user's first start node.
    newPageUnder: scope.start.root ? null : (scope.start.keys[0] ?? null),
    mayReadAudit: hasSection(principal, 'settings'),
  }
}

/** `?list=recent|drafts|published&skip=&take=`, with anything else as the defaults. */
export function readOverviewQuery(url: URL): OverviewQuery {
  const list = url.searchParams.get('list')
  const whole = (name: string, fallback: number, max: number) => {
    const value = Number(url.searchParams.get(name))
    return Number.isInteger(value) && value >= 0 ? Math.min(value, max) : fallback
  }
  return {
    list: list && list in OVERVIEW_LISTS ? (list as OverviewList) : 'recent',
    skip: whole('skip', 0, Number.MAX_SAFE_INTEGER),
    take: whole('take', 5, 50) || 5,
  }
}
