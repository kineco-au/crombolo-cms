/**
 * What a command line, or an agent, asks of a workspace before merging it (story
 * 386): how it differs from Shared or from where it began, by property for pages and
 * types and by line for files; each conflict with the other side's change, who made it
 * and what it is called; and the checks: each affected page rendered, every file's
 * problems, what cannot be known until the merge. docs/workspaces.md.
 */
import { normaliseUuid } from '@crombolo/core'
import {
  ChangeRepository,
  type Db,
  UserRepository,
  type Workspace,
  WorkspaceFileRepository,
  WorkspaceRepository,
} from '@crombolo/data'
import type { WorkspaceMerging } from './node-operations.ts'
import type { WorkspaceSchema } from './workspace-schema.ts'

export interface WorkspaceRendered {
  status: string
  html?: string
  error?: string
}

export interface WorkspaceCheckOptions {
  db: Db
  merge: () => WorkspaceMerging | undefined
  schema: () => WorkspaceSchema | undefined
  /** One page of the workspace's site, by its address. */
  render: (workspace: Workspace, path: string) => Promise<WorkspaceRendered>
  /** A page's address on the workspace's site. */
  urlOf: (workspace: Workspace, key: string) => Promise<string | undefined>
}

/** One affected page, as it rendered. */
export interface PageResult {
  key: string
  name: string
  url: string | null
  status: string
  ok: boolean
  ms: number
  error?: string
  /** Why it was looked at: it changed, or its type or template did. */
  because: 'changed' | 'type' | 'template'
}

/** What a workspace's process logged, newest last, per workspace on this node. */
const ERRORS_KEPT = 200

export function createWorkspaceChecks(options: WorkspaceCheckOptions) {
  const { db } = options
  const errors = new Map<string, Array<{ at: string; page: string; says: string }>>()

  const note = (workspace: Workspace, page: string, says: string) => {
    const list = errors.get(workspace.key) ?? []
    list.push({ at: new Date().toISOString(), page, says })
    if (list.length > ERRORS_KEPT) list.splice(0, list.length - ERRORS_KEPT)
    errors.set(workspace.key, list)
  }

  async function renderOne(workspace: Workspace, path: string) {
    const started = performance.now()
    let result: WorkspaceRendered
    try {
      result = await options.render(workspace, path)
    } catch (error) {
      result = { status: 'error', error: String(error) }
    }
    const ms = Math.round(performance.now() - started)
    const ok = result.status === 'ok' || result.status === 'redirect' || result.status === 'outcome'
    if (!ok) note(workspace, path, result.error ?? `answered ${result.status}`)
    return { ...result, ok, ms }
  }

  /** The pages a workspace affects: those it changed, and a sample of each changed type's and template's. */
  async function affected(workspace: Workspace, all: boolean) {
    const out = new Map<string, { key: string; name: string; because: PageResult['because'] }>()
    for (const change of await new WorkspaceRepository(db).changes(workspace.id))
      if (change.kind === 'changed' || change.kind === 'made')
        out.set(change.key, { key: change.key, name: change.name, because: 'changed' })
    const files = await new WorkspaceFileRepository(db).changes(workspace.id)
    // A type by the alias its file says; a template by its file's name, as the site names it.
    const types = files
      .filter((f) => f.path.startsWith('schema/content-types/'))
      .map((f) => /^alias\s*=\s*"([^"]+)"/m.exec(f.now ?? f.base ?? '')?.[1])
      .filter((a): a is string => Boolean(a))
    const templates = files
      .map((f) => /^components\/([^/]+)\.tsx?$/.exec(f.path)?.[1])
      .filter((a): a is string => Boolean(a))
    const sample = all ? 100_000 : 3
    const add = (
      rows: Array<{ unique_id: string; text: string | null }>,
      because: 'type' | 'template',
    ) => {
      for (const row of rows) {
        const key = normaliseUuid(String(row.unique_id))
        if (!out.has(key)) out.set(key, { key, name: String(row.text ?? key), because })
      }
    }
    for (const alias of types)
      add(
        await db.q
          .selectFrom('node as n')
          .innerJoin('content as c', 'c.node_id', 'n.id')
          .innerJoin('content_type as t', 't.node_id', 'c.content_type_id')
          .select(['n.unique_id', 'n.text'])
          .where('n.workspace_id', 'is', null)
          .where('t.alias', '=', alias)
          .limit(sample)
          .execute(),
        'type',
      )
    for (const alias of templates)
      add(
        await db.q
          .selectFrom('node as n')
          .innerJoin('content_version as cv', 'cv.node_id', 'n.id')
          .innerJoin('document_version as dv', 'dv.id', 'cv.id')
          .innerJoin('template as tp', 'tp.node_id', 'dv.template_id')
          .select(['n.unique_id', 'n.text'])
          .where('n.workspace_id', 'is', null)
          .where('cv.current', '=', db.dialect.boolValue(true) as boolean)
          .where('tp.alias', '=', alias)
          .limit(sample)
          .execute(),
        'template',
      )
    return [...out.values()]
  }

  /** Each affected page rendered on the workspace's site. */
  async function pages(workspace: Workspace, all = false): Promise<PageResult[]> {
    const results: PageResult[] = []
    for (const page of await affected(workspace, all)) {
      const url = (await options.urlOf(workspace, page.key)) ?? null
      if (!url) {
        results.push({ ...page, url: null, status: 'unpublished', ok: true, ms: 0 })
        continue
      }
      const rendered = await renderOne(workspace, url)
      results.push({
        ...page,
        url,
        status: rendered.status,
        ok: rendered.ok,
        ms: rendered.ms,
        ...(rendered.error ? { error: rendered.error } : {}),
      })
    }
    return results
  }

  /** The person and name of the change that last touched an item in Shared. */
  async function lastChangeOf(item: { node?: string; path?: string }) {
    const changes = new ChangeRepository(db)
    let changeId: string | undefined
    if (item.path) changeId = (await changes.versions(item.path)).at(-1)?.changeId
    if (!changeId && item.node) {
      const rows = await db.q
        .selectFrom('content_transfer_change as c')
        .innerJoin('content_transfer_run as r', 'r.id', 'c.run_id')
        .select('r.id')
        .where('c.node_key', '=', normaliseUuid(item.node))
        .where('r.status', '=', 'applied')
        .orderBy('c.event_id', 'desc')
        .limit(1)
        .execute()
      changeId = rows[0] ? String(rows[0].id) : undefined
    }
    const change = changeId ? await changes.byId(changeId) : undefined
    if (!change) return null
    const by = change.madeBy ? await new UserRepository(db).byKey(change.madeBy) : undefined
    return {
      id: change.id,
      name: change.name,
      kind: change.kind,
      by: by?.name ?? null,
      at: change.startedAt.toISOString(),
    }
  }

  return {
    pages,

    /** Every check: the pages rendered, the files' problems, and what waits for the merge. */
    async check(workspace: Workspace, all = false) {
      const rendered = await pages(workspace, all)
      const plan = await options.schema()?.plan(workspace.id)
      const problems = (plan?.problems ?? []).map((says) => ({ kind: 'file', says }))
      const failures = [
        ...rendered
          .filter((p) => !p.ok)
          .map((p) => ({
            kind: 'page',
            item: p.url ?? p.key,
            says: p.error ?? `It answered ${p.status}.`,
          })),
        ...problems.map((p) => ({ kind: p.kind, item: '', says: String(p.says) })),
      ]
      const siteFiles = Object.keys(plan?.writes ?? {}).filter((path) => path.startsWith('site/'))
      return {
        ok: failures.length === 0,
        pages: rendered,
        failures,
        // Not known until it is merged: so a clean result is not read as more than it is.
        notChecked: [
          ...siteFiles.map((path) => `${path.slice('site/'.length)} takes effect at the merge`),
          'dependencies and routes the site reads as it starts',
        ],
      }
    },

    /** What the workspace's renders on this node said went wrong. */
    errors(workspace: Workspace, since?: Date) {
      return (errors.get(workspace.key) ?? []).filter((e) => !since || new Date(e.at) >= since)
    },

    /**
     * How the workspace differs: `shared`, what a merge would change; `base`, what it
     * changed since it opened. Pages by property, files by their texts.
     */
    async diff(workspace: Workspace, against: 'shared' | 'base') {
      const merging = options.merge()
      const plan = merging ? await merging.preview(workspace) : undefined
      const files = await new WorkspaceFileRepository(db).changes(workspace.id)
      const filePlan = await options.schema()?.plan(workspace.id)
      const pagesOut = (plan?.pages ?? []).map((p) => ({
        key: p.page.key,
        name: p.name,
        fields: p.page.fields
          .filter((f) =>
            against === 'shared'
              ? JSON.stringify(f.mine ?? null) !== JSON.stringify(f.theirs ?? null)
              : JSON.stringify(f.mine ?? null) !== JSON.stringify(f.base ?? null),
          )
          .map((f) => ({
            field: f.field,
            base: f.base ?? null,
            mine: f.mine ?? null,
            theirs: f.theirs ?? null,
          })),
      }))
      const shared = (filePlan?.writes ?? {}) as Record<string, string | null>
      const filesOut = files.map((f) => ({
        path: f.path,
        base: f.base,
        mine: f.now,
        ...(against === 'shared' ? { merged: shared[f.path] ?? null } : {}),
      }))
      return {
        against,
        pages: pagesOut.filter((p) => p.fields.length > 0),
        pending: (plan?.pending ?? []).map((p) => ({
          key: p.pending.key,
          name: p.pending.name,
          kind: p.pending.kind,
        })),
        files: filesOut,
      }
    },

    /** Each conflict, by part, with base, mine and theirs, and the other side's change. */
    async conflicts(workspace: Workspace) {
      const merging = options.merge()
      const plan = merging ? await merging.preview(workspace) : undefined
      const filePlan = await options.schema()?.plan(workspace.id)
      const out = []
      for (const c of plan?.conflicts ?? []) {
        const page = plan?.pages.find((p) => p.page.key === c.key)
        const field = page?.page.fields.find((f) => f.field === c.field)
        out.push({
          kind: 'page',
          item: `${c.key}#${c.field}`,
          name: page?.name ?? c.key,
          base: field?.base ?? null,
          mine: field?.mine ?? null,
          theirs: field?.theirs ?? null,
          other: await lastChangeOf({ node: c.key }),
        })
      }
      for (const f of filePlan?.conflicts ?? []) {
        out.push({
          kind: 'file',
          item: f.path,
          name: f.path,
          base: f.base,
          mine: f.mine,
          theirs: f.theirs,
          other: await lastChangeOf({ path: f.path }),
        })
      }
      return out
    },
  }
}

export type WorkspaceChecks = ReturnType<typeof createWorkspaceChecks>
