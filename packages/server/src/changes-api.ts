/**
 * The site's changes over HTTP (story 381), at `<plugin>/api/changes`: every
 * merged workspace, direct edit, applied bundle and revert, newest first; one
 * change with each file's text before and after and its pages; a file's
 * versions, each a change that touched it, compared with the file now; and a
 * revert, which is a change of its own, refused where something later touched
 * the same file or page, and which can reopen the work as a workspace.
 */
import type { Principal } from '@crombolo/api-management/domain'
import { normaliseUuid } from '@crombolo/core'
import {
  ChangeRepository,
  type Db,
  DocumentRepository,
  type NodeSchemaState,
  TransferRunRepository,
  WorkspaceFileRepository,
  WorkspaceRepository,
} from '@crombolo/data'
import { revertRun } from '@crombolo/transfer'
import { recordAudit } from './adapters/audit.ts'
import type { WorkspaceSchema } from './workspace-schema.ts'

const json = (body: unknown, status = 200) => Response.json(body, { status })
const refused = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  json({ message, ...extra }, status)

type Client = { ipAddress: string | null; forwardedFor: string | null }

export function createChangesApi(
  db: Db,
  options: {
    schema: () => WorkspaceSchema | undefined
    nodeState?: NodeSchemaState
    /** Told after a revert that changed what is served. */
    onReverted?: () => void | Promise<void>
  },
) {
  const changes = new ChangeRepository(db)

  /** A change with what it holds: its files, and its pages with what each did. */
  async function detail(id: string) {
    const change = await changes.byId(id)
    if (!change) return undefined
    const items = await changes.itemsOf(id)
    const pages = await new TransferRunRepository(db).changes(id)
    return {
      ...change,
      pageEdits:
        change.kind === 'edit' && change.madeBy
          ? await changes.pageEditsBy(
              change.madeBy,
              change.startedAt,
              // An open edit gathers the person's page saves up to now.
              change.closedAt ?? new Date(),
            )
          : undefined,
      files: items.map((i) => ({
        path: i.path,
        kind: i.kind,
        class: i.class,
        before: i.before,
        after: i.after,
      })),
      pageChanges: pages.map((p) => ({ key: p.nodeKey, action: p.action })),
    }
  }

  /**
   * Puts a change back, as a change of its own: its pages through a run's revert,
   * its files as they were before it, all or nothing; then, when asked, its work
   * reopened as a workspace to carry on with.
   */
  async function revert(id: string, principal: Principal, toWorkspace: boolean, client: Client) {
    const change = await changes.byId(id)
    if (!change) return refused('There is no such change.', 404)
    if (change.kind === 'bundle')
      return refused('An applied bundle is reverted with `crombolo content revert`.', 409)
    if (change.status !== 'applied') return refused('This change was reverted already.', 409)
    const later = await changes.laterTouching(id)
    const laterPages = await new TransferRunRepository(db).laterRunsTouching(id)
    if (later.length > 0 || laterPages.length > 0)
      return refused('Something changed later touches the same things; revert that first.', 409, {
        files: [...new Set(later.map((l) => l.path))],
        changes: [...new Set([...later.map((l) => l.changeId), ...laterPages])],
      })
    const items = await changes.itemsOf(id)
    const schema = options.schema()
    const pages = await new TransferRunRepository(db).changes(id)

    // Its pages first, through the revert a run has; it refuses where one was edited since.
    let revertId: string | undefined
    if (pages.length > 0) {
      const result = await revertRun(db, id)
      if (!result.runId)
        return refused('A page it changed was edited since.', 409, {
          findings: result.check.outstanding.map((f) => f.message),
        })
      revertId = result.runId
      await db.q
        .updateTable('content_transfer_run')
        .set({
          change_kind: 'revert',
          name: `Revert of ${change.name ?? 'a change'}`,
          made_by: principal.id,
          change_key: revertId,
        })
        .where('id', '=', revertId)
        .execute()
    } else {
      revertId = await changes.begin({
        kind: 'revert',
        name: `Revert of ${change.name ?? 'a change'}`,
        madeBy: principal.id,
        revertsId: id,
      })
      await changes.setStatus(id, 'reverted')
    }

    // Then its files, each as it was before the change.
    if (items.length > 0 && schema) {
      const writes: Record<string, string | null> = {}
      const befores: Record<string, string | null> = {}
      for (const item of items) {
        writes[item.path] = item.before
        befores[item.path] = item.after
      }
      const applied = await db.transaction((tx) =>
        schema.apply(tx, {
          writes,
          befores,
          conflicts: [],
          problems: [],
          change: 'breaking',
          items: [],
        }),
      )
      await applied.after()
      const recorded = new ChangeRepository(db)
      for (const item of items)
        await recorded.item(revertId, {
          path: item.path,
          kind: item.kind,
          class: item.class,
          before: item.after,
          after: item.before,
        })
    }

    let reopened: string | undefined
    if (toWorkspace) reopened = await reopen(change.name ?? 'A change', items, pages, principal)
    await recordAudit(db, {
      category: 'content',
      action: 'Revert',
      source: 'request',
      userKey: principal.id,
      userName: principal.name,
      entityType: 'Change',
      entityKey: id,
      entityName: change.name,
      detail: `Reverted "${change.name ?? id}"${reopened ? ', its work reopened as a workspace' : ''}`,
      ipAddress: client.ipAddress,
      forwardedFor: client.forwardedFor,
    })
    await options.onReverted?.()
    return json({ revertId, ...(reopened ? { workspace: reopened } : {}) })
  }

  /** A workspace holding what a change held: its files as it left them, its pages likewise. */
  async function reopen(
    name: string,
    items: Awaited<ReturnType<ChangeRepository['itemsOf']>>,
    pages: Awaited<ReturnType<TransferRunRepository['changes']>>,
    principal: Principal,
  ): Promise<string> {
    const workspaces = new WorkspaceRepository(db)
    const opened = await workspaces.open({ name: `Reopened: ${name}`, ownerKey: principal.id })
    await options.schema()?.snapshot(opened.id)
    const store = new WorkspaceFileRepository(db)
    for (const item of items) await store.write(opened.id, item.path, item.after, item.class)
    const shared = new DocumentRepository(db, { nodeState: options.nodeState })
    const own = shared.inWorkspace(opened.id)
    for (const page of pages) {
      if (page.eventId === null) continue
      const held = await shared.atVersion(String(page.eventId))
      if (!held) continue
      const document = held.document
      await own.update({
        key: document.key,
        contentTypeKey: document.contentTypeKey,
        componentKey: document.componentKey,
        parentKey: document.parentKey,
        values: document.values,
        variants: document.variants.map((v) => ({
          culture: v.culture,
          segment: v.segment,
          name: v.name,
        })),
      })
    }
    return opened.key
  }

  return {
    async handle(
      request: Request,
      principal: Principal,
      rest: string,
      client: Client,
    ): Promise<Response> {
      const url = new URL(request.url)
      const parts = rest.split('/').filter(Boolean).map(decodeURIComponent)
      if (parts.length === 0 && request.method === 'GET') {
        const skip = Math.max(0, Number(url.searchParams.get('skip') ?? 0) || 0)
        const take = Math.min(200, Math.max(1, Number(url.searchParams.get('take') ?? 50) || 50))
        return json(await changes.list(skip, take))
      }
      if (parts[0] === 'versions' && parts.length === 1 && request.method === 'GET') {
        const path = url.searchParams.get('path') ?? ''
        if (!path) return refused('Name the file, by its path.', 400)
        const versions = await changes.versions(path)
        const out = []
        for (const v of versions) {
          const change = await changes.byId(v.changeId)
          out.push({
            changeId: v.changeId,
            name: change?.name ?? null,
            kind: change?.kind,
            madeBy: change?.madeBy ?? null,
            at: change?.startedAt,
            class: v.class,
            removed: v.after === null,
          })
        }
        return json({ path, versions: out })
      }
      const id = parts[0] ? normaliseUuid(parts[0]) : ''
      if (parts.length === 1 && request.method === 'GET') {
        const found = await detail(id)
        return found ? json(found) : refused('There is no such change.', 404)
      }
      // An earlier version of one file against the file now.
      if (parts[1] === 'compare' && parts.length === 2 && request.method === 'GET') {
        const path = url.searchParams.get('path') ?? ''
        const item = (await changes.itemsOf(id)).find((i) => i.path === path)
        if (!item) return refused('That change did not touch that file.', 404)
        const now = (await options.schema()?.textNow(path)) ?? null
        return json({ path, version: item.after, current: now, same: item.after === now })
      }
      if (parts[1] === 'revert' && parts.length === 2 && request.method === 'POST') {
        if (!principal.isAdmin) return refused('Only an administrator reverts a change.', 403)
        const asked = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
        return revert(id, principal, asked.toWorkspace === true, client)
      }
      return refused('There is nothing here.', 404)
    },
  }
}
