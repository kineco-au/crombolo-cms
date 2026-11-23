/**
 * Shared checked as a whole (story 406): every page the changes since a given change
 * affect, rendered as Shared serves it, and the problems in Shared's views. What a
 * workspace's check does for one workspace, for everything merged since.
 * docs/changes.md.
 */
import { normaliseUuid, ObjectTypes } from '@crombolo/core'
import { type Change, ChangeRepository, type Db, TransferRunRepository } from '@crombolo/data'
import {
  PAGES_SAMPLED,
  type PageResult,
  pagesAffectedBy,
  type WorkspaceRendered,
} from './workspace-checks.ts'

/** No more pages than this are rendered in one check; the rest are counted. */
export const SHARED_CHECK_PAGES = 500

export interface SharedCheckOptions {
  db: Db
  /** One of Shared's pages, by its address. */
  render: (path: string) => Promise<WorkspaceRendered>
  /** A published page's address and name; undefined for what is not a published page. */
  page: (key: string) => Promise<{ url: string; name: string } | undefined>
  /** Brings this node up to what was merged: a merge tells every node, and none has heard yet. */
  upToDate?: () => Promise<void>
  /** What is wrong with Shared's views as they are. */
  problems: () => Promise<string[]>
  limit?: number
}

export interface SharedCheckResult {
  ok: boolean
  /** The change checked from, and the newest one covered; null where there is none. */
  since: string | null
  upTo: string | null
  changes: number
  pages: PageResult[]
  failures: Array<{ kind: string; item: string; says: string }>
  notChecked: string[]
}

export function createSharedCheck(options: SharedCheckOptions) {
  const { db } = options
  const limit = options.limit ?? SHARED_CHECK_PAGES

  /** Every page Shared holds, for a check of all of them. */
  async function everyPage() {
    const rows = await db.q
      .selectFrom('node')
      .select('unique_id')
      .where('workspace_id', 'is', null)
      .where('node_object_type', '=', ObjectTypes.Document)
      .where('trashed', '=', db.dialect.boolValue(false) as boolean)
      .orderBy('path')
      .execute()
    return rows.map((r) => ({ key: normaliseUuid(String(r.unique_id)), name: '' }))
  }

  /** The pages and files the changes hold between them. */
  async function heldBy(changes: readonly Change[]) {
    const repository = new ChangeRepository(db)
    const runs = new TransferRunRepository(db)
    const pages = new Map<string, { key: string; name: string }>()
    const files = new Map<string, string>()
    for (const change of changes) {
      for (const page of await runs.changes(change.id))
        pages.set(page.nodeKey, { key: page.nodeKey, name: '' })
      for (const item of await repository.itemsOf(change.id))
        files.set(item.path, item.after ?? item.before ?? '')
    }
    return {
      pages: [...pages.values()],
      files: [...files].map(([path, text]) => ({ path, text })),
    }
  }

  return {
    /**
     * Checks Shared: the pages affected by every change added to since `since`, or,
     * with none named or `all`, every published page. Undefined where the site holds
     * no such change.
     */
    async check(since?: string, all = false): Promise<SharedCheckResult | undefined> {
      const repository = new ChangeRepository(db)
      const changes = since ? await repository.addedToSince(since) : []
      if (!changes) return undefined
      const whole = all || !since
      const stale: string[] = []
      await options.upToDate?.().catch((error: unknown) => {
        stale.push(`The views as they are now could not be read: ${String(error)}`)
      })
      const held = await heldBy(changes)
      const affected = whole
        ? (await everyPage()).map((page) => ({ ...page, because: 'changed' as const }))
        : await pagesAffectedBy(db, held.pages, held.files, PAGES_SAMPLED)

      const pages: PageResult[] = []
      let past = 0
      for (const one of affected) {
        const found = await options.page(one.key)
        if (!found) continue
        if (pages.length >= limit) {
          past++
          continue
        }
        const started = performance.now()
        let rendered: WorkspaceRendered
        try {
          rendered = await options.render(found.url)
        } catch (error) {
          rendered = { status: 'error', error: String(error) }
        }
        const ok = ['ok', 'redirect', 'outcome'].includes(rendered.status)
        pages.push({
          key: one.key,
          name: found.name,
          url: found.url,
          status: rendered.status,
          ok,
          ms: Math.round(performance.now() - started),
          because: one.because,
          ...(rendered.error ? { error: rendered.error } : {}),
        })
      }

      const views = whole || held.files.some((f) => f.path.startsWith('components/'))
      const problems = [...stale, ...(views ? await options.problems() : [])]
      const failures = [
        ...pages
          .filter((p) => !p.ok)
          .map((p) => ({
            kind: 'page',
            item: p.url ?? p.key,
            says: p.error ?? `It answered ${p.status}.`,
          })),
        ...problems.map((says) => ({ kind: 'file', item: '', says })),
      ]
      const newest = since ? changes.at(-1) : (await repository.list(0, 1)).items[0]
      return {
        ok: failures.length === 0,
        since: since ? normaliseUuid(since) : null,
        upTo: newest?.id ?? (since ? normaliseUuid(since) : null),
        changes: changes.length,
        pages,
        failures,
        notChecked: [
          ...(past > 0 ? [`${past} more page(s), past the ${limit} one check renders`] : []),
          ...held.files
            .filter((f) => f.path.startsWith('site/'))
            .map((f) => `${f.path.slice('site/'.length)} takes effect when the site next starts`),
        ],
      }
    },
  }
}

export type SharedCheck = ReturnType<typeof createSharedCheck>
