/**
 * A change moved from one site to another (story 383). Exported, it is a change
 * bundle: its identity, the changes it needs, each file and page it touched as
 * they stood before and after, and the media files it added or replaced.
 * Staged, it is a workspace on the target holding it, made for it and edited by
 * nobody, served at the workspace's address. Applied, it is that workspace's
 * merge (story 380): only what the change altered is written, a field the target
 * changed since is a conflict, and a refused apply changes nothing and leaves
 * the workspace for the conflict to be settled in. docs/changes.md.
 */

import type { Principal } from '@crombolo/api-management/domain'
import { REMOVED_PAGE_PREFIX } from '@crombolo/content'
import type { DocumentAggregate } from '@crombolo/core'
import { normaliseUuid } from '@crombolo/core'
import {
  ChangeRepository,
  type ContentKind,
  type Db,
  DbDate,
  DocumentRepository,
  type DocumentRepositoryOptions,
  TransferRunRepository,
  type Workspace,
  WorkspaceFileRepository,
  WorkspaceRepository,
  type WorkspaceScope,
} from '@crombolo/data'
import type {
  ChangeBundle,
  ChangeBundleFile,
  ChangeBundlePage,
  ChangePageState,
  ChangeValue,
} from '@crombolo/transfer'
import type { MediaFileStore } from './media-files.ts'
import type { WorkspaceMerging } from './node-operations.ts'

type PageKind = ChangeBundlePage['kind']
const PAGE_KINDS: readonly PageKind[] = ['document', 'media', 'element']
const isPageKind = (kind: string): kind is PageKind => (PAGE_KINDS as string[]).includes(kind)

/** One thing a change could not do on this site, in the words it is shown in. */
export interface ChangeConflict {
  change: string
  item: string
  says: string
}

export interface StageOutcome {
  workspace: Workspace | undefined
  /** Changes this site already holds, which were skipped. */
  skipped: string[]
  conflicts: ChangeConflict[]
}

export type ApplyOutcome =
  | { ok: true; skipped: string[]; changeId: string | null }
  | {
      ok: false
      skipped: string[]
      conflicts: ChangeConflict[]
      /** Where the change waits, for the conflict to be settled and merged. */
      workspace: string | null
    }

export interface ChangeTransferOptions {
  db: Db
  repository: DocumentRepositoryOptions
  /** What this site calls itself, written into what it exports. */
  siteName: () => string
  media: MediaFileStore
  schema: () =>
    | {
        snapshot(workspaceId: number): Promise<void>
        build(workspace: WorkspaceScope): Promise<void>
      }
    | undefined
  merge: () => WorkspaceMerging | undefined
}

const fieldOf = (v: {
  alias: string
  culture: string | null
  segment: string | null
  environment?: string | null
}) => `${v.alias}|${v.culture ?? ''}|${v.segment ?? ''}|${v.environment ?? ''}`
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const MEDIA_URL = /\/media\/[^"'\s?#\\]+/g
const UUID = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi

function stateOf(doc: DocumentAggregate): ChangePageState {
  const invariant = doc.variants.find((v) => v.culture === null) ?? doc.variants[0]
  const names: Record<string, string> = {}
  for (const v of doc.variants) if (v.culture) names[v.culture] = v.name
  return {
    name: invariant?.name ?? '',
    values: doc.values.map((v) => ({
      alias: v.alias,
      culture: v.culture,
      segment: v.segment,
      ...(v.environment ? { environment: v.environment } : {}),
      value: v.value,
    })),
    ...(Object.keys(names).length > 0 ? { names } : {}),
    published: doc.published,
  }
}

/** Every field of a page's state, values and names alike, by one key. */
function fieldsOf(state: ChangePageState | null): Map<string, unknown> {
  const out = new Map<string, unknown>()
  if (!state) return out
  out.set('@name', state.name)
  for (const [culture, name] of Object.entries(state.names ?? {})) out.set(`@name:${culture}`, name)
  for (const v of state.values) out.set(fieldOf(v), v.value)
  return out
}

const mediaIn = (state: ChangePageState | null) =>
  new Set(JSON.stringify(state?.values ?? []).match(MEDIA_URL) ?? [])

export function createChangeTransfer(options: ChangeTransferOptions) {
  const { db } = options
  const repo = (kind: PageKind, workspace?: number) =>
    new DocumentRepository(db, {
      ...options.repository,
      ...(workspace === undefined ? {} : { workspace }),
    }).ofKind(kind as ContentKind)

  async function stateAt(kind: PageKind, eventId: number | null) {
    if (eventId === null) return null
    const found = await repo(kind).atVersion(String(eventId))
    return found ? found.document : null
  }

  /** The change that left a page as this one found it: the one whose event it started from. */
  async function lastChangeOfNode(
    nodeKey: string,
    from: number | null,
    self: string,
  ): Promise<string | null> {
    if (from === null) return null
    const rows = await db.q
      .selectFrom('content_transfer_change as c')
      .innerJoin('content_transfer_run as r', 'r.id', 'c.run_id')
      .select(['r.change_key', 'c.event_id'])
      .where('c.node_key', '=', nodeKey)
      .where('r.status', '=', 'applied')
      .where('c.event_id', '<=', from)
      .orderBy('c.event_id', 'desc')
      .execute()
    const earlier = rows.find((r) => String(r.change_key) !== self)
    return earlier?.change_key ? String(earlier.change_key) : null
  }

  /** The changes that made the pages and media a state refers to. */
  async function madeBy(states: ReadonlyArray<ChangePageState | null>, self: string) {
    const keys = new Set<string>()
    for (const state of states)
      for (const m of JSON.stringify(state?.values ?? []).match(UUID) ?? [])
        keys.add(normaliseUuid(m))
    if (keys.size === 0) return []
    const rows = await db.q
      .selectFrom('content_transfer_change as c')
      .innerJoin('content_transfer_run as r', 'r.id', 'c.run_id')
      .select('r.change_key')
      .where('c.node_key', 'in', [...keys])
      .where('c.action', '=', 'create')
      .where('r.status', '=', 'applied')
      .execute()
    return rows.map((r) => String(r.change_key ?? '')).filter((k) => k && k !== self)
  }

  async function mediaBytes(urls: Iterable<string>): Promise<Map<string, Uint8Array>> {
    const out = new Map<string, Uint8Array>()
    for (const url of urls) {
      const file = await options.media.open(url)
      if (file) out.set(url, new Uint8Array(await file.bytes()))
    }
    return out
  }

  function bundleOf(input: {
    key: string
    name: string | null
    kind: string
    madeBy: string | null
    createdAt: Date
    depends: Iterable<string>
    files: ChangeBundleFile[]
    pages: ChangeBundlePage[]
  }): ChangeBundle {
    const added = new Set<string>()
    for (const page of input.pages) {
      const before = mediaIn(page.before)
      for (const url of mediaIn(page.after)) if (!before.has(url)) added.add(url)
    }
    return {
      key: normaliseUuid(input.key),
      name: input.name,
      kind: input.kind,
      madeBy: input.madeBy,
      createdAt: input.createdAt.toISOString(),
      source: options.siteName(),
      depends: [...new Set(input.depends)].filter((k) => k !== input.key).sort(),
      files: input.files,
      pages: input.pages,
      media: [...added].sort(),
    }
  }

  const pageOf = (
    key: string,
    kind: PageKind,
    action: ChangeBundlePage['action'],
    shape: DocumentAggregate,
    before: DocumentAggregate | null,
    after: DocumentAggregate | null,
    lastChange: string | null,
  ): ChangeBundlePage => ({
    key: normaliseUuid(key),
    kind,
    action,
    parentKey: shape.parentKey,
    ...(before && after && before.parentKey !== after.parentKey
      ? { beforeParentKey: before.parentKey }
      : {}),
    contentTypeKey: shape.contentTypeKey,
    contentTypeAlias: shape.contentTypeAlias,
    componentKey: shape.componentKey,
    before: before ? stateOf(before) : null,
    after: after ? stateOf(after) : null,
    lastChange,
  })

  /** A change made here, as a bundle with the media it carries. */
  async function exportChange(id: string) {
    const changes = new ChangeRepository(db)
    const change = await changes.byId(id)
    if (!change) return undefined
    const files: ChangeBundleFile[] = []
    const items = await changes.itemsOf(change.id, { pages: true })
    const removed = new Map(
      items
        .filter((i) => i.path.startsWith(REMOVED_PAGE_PREFIX) && i.before)
        .map((i) => [
          normaliseUuid(i.path.slice(REMOVED_PAGE_PREFIX.length)),
          JSON.parse(i.before as string),
        ]),
    ) as Map<string, DocumentAggregate>
    for (const item of items) {
      if (item.path.startsWith(REMOVED_PAGE_PREFIX)) continue
      const versions = await changes.versions(item.path)
      const at = versions.findIndex((v) => v.changeId === change.id)
      const earlier = at > 0 ? versions[at - 1] : undefined
      const earlierChange = earlier ? await changes.byId(earlier.changeId) : undefined
      files.push({
        path: item.path,
        kind: item.kind,
        class: item.class,
        before: item.before,
        after: item.after,
        lastChange: earlierChange?.key ?? null,
      })
    }
    const pages: ChangeBundlePage[] = []
    const depends: string[] = []
    for (const row of await new TransferRunRepository(db).changes(change.id)) {
      if (!isPageKind(row.kind)) continue
      const before =
        (await stateAt(row.kind, row.beforeEventId)) ??
        removed.get(normaliseUuid(row.nodeKey)) ??
        null
      const after = row.action === 'recycle' ? null : await stateAt(row.kind, row.eventId)
      const shape = after ?? before
      if (!shape) continue
      const action =
        row.action === 'create' ? 'create' : row.action === 'recycle' ? 'delete' : 'update'
      const page = pageOf(
        row.nodeKey,
        row.kind,
        action,
        shape,
        before,
        after,
        await lastChangeOfNode(row.nodeKey, row.beforeEventId, change.key),
      )
      pages.push(page)
      depends.push(...(await madeBy([page.after], change.key)))
      if (page.lastChange && page.action !== 'create') depends.push(page.lastChange)
    }
    for (const f of files) if (f.lastChange) depends.push(f.lastChange)
    const bundle = bundleOf({
      key: change.key,
      name: change.name,
      kind: change.kind,
      madeBy: change.madeBy,
      createdAt: change.startedAt,
      depends,
      files,
      pages,
    })
    return { change: bundle, media: await mediaBytes(bundle.media) }
  }

  /** An open workspace, as the change its merge will be: it keeps the workspace's key. */
  async function exportWorkspace(workspace: Workspace) {
    const files: ChangeBundleFile[] = (
      await new WorkspaceFileRepository(db).changes(workspace.id)
    ).map((c) => ({
      path: c.path,
      kind: c.path.startsWith('schema/') ? 'definition' : 'file',
      class: c.class ?? 'none',
      before: c.base,
      after: c.now,
      lastChange: null,
    }))
    const pages: ChangeBundlePage[] = []
    const made = (
      await Promise.all(PAGE_KINDS.map((kind) => repo(kind, workspace.id).workspaceMergePages()))
    ).flat()
    for (const page of made) {
      if (!isPageKind(page.kind)) continue
      const after = await repo(page.kind, workspace.id).byKey(page.key)
      const before = page.made ? null : await stateAt(page.kind, page.baseEvent)
      const shape = after ?? before
      if (!shape) continue
      pages.push(
        pageOf(
          page.key,
          page.kind,
          page.made ? 'create' : 'update',
          shape,
          before,
          after ?? null,
          null,
        ),
      )
    }
    for (const pending of await new WorkspaceRepository(db).pending(workspace.id)) {
      if (pending.kind !== 'delete' && pending.kind !== 'trash') continue
      if (!pending.key) continue
      const kind = (pending.objectKind ?? 'document') as PageKind
      if (!isPageKind(kind)) continue
      const before = (await repo(kind).byKey(pending.key)) ?? null
      if (before) pages.push(pageOf(pending.key, kind, 'delete', before, before, null, null))
    }
    const bundle = bundleOf({
      key: workspace.key,
      name: workspace.name,
      kind: 'workspace',
      madeBy: workspace.ownerKey,
      createdAt: new Date(),
      depends: [],
      files,
      pages,
    })
    return { change: bundle, media: await mediaBytes(bundle.media) }
  }

  /** Every page edited since a point, as one change: each as it stood then, and now. */
  async function exportSince(at: Date) {
    const rows = await db.q
      .selectFrom('content_version as v')
      .innerJoin('node as n', 'n.id', 'v.node_id')
      .select(['n.unique_id as key', 'n.node_object_type as type'])
      .where('v.workspace_id', 'is', null)
      .where('n.workspace_id', 'is', null)
      .where('v.version_date', '>', DbDate.toDb(at) as never)
      .groupBy(['n.unique_id', 'n.node_object_type'])
      .execute()
    const pages: ChangeBundlePage[] = []
    for (const row of rows) {
      const key = normaliseUuid(String(row.key))
      for (const kind of PAGE_KINDS) {
        const r = repo(kind)
        const now = await r.byKey(key)
        if (!now) continue
        const versions = await r.versions(key)
        const then = versions
          .filter((v) => new Date(v.versionDate) <= at)
          .sort((a, b) => new Date(b.versionDate).getTime() - new Date(a.versionDate).getTime())[0]
        const before = then ? await stateAt(kind, Number(then.id)) : null
        pages.push(pageOf(key, kind, before ? 'update' : 'create', now, before, now, null))
        break
      }
    }
    const bundle = bundleOf({
      key: crypto.randomUUID(),
      name: `Page edits since ${at.toISOString()}`,
      kind: 'edits',
      madeBy: null,
      createdAt: new Date(),
      depends: [],
      files: [],
      pages,
    })
    return { change: bundle, media: await mediaBytes(bundle.media) }
  }

  /**
   * Puts changes into a workspace on this site: each file with the change's
   * before as its base, so the merge goes three ways against this site's now;
   * each page with only the fields the change altered, a field this site
   * changed since being a conflict.
   */
  async function stage(
    bundles: ReadonlyArray<{ change: ChangeBundle; media: Map<string, Uint8Array> }>,
    principal: Principal,
    into?: Workspace,
  ): Promise<StageOutcome> {
    const changes = new ChangeRepository(db)
    const keys = bundles.map((b) => b.change.key)
    const held = await changes.held(keys)
    const skipped = keys.filter((k) => held.has(normaliseUuid(k)))
    const todo = bundles.filter((b) => !held.has(normaliseUuid(b.change.key)))
    const conflicts: ChangeConflict[] = []
    if (todo.length === 0) return { workspace: into, skipped, conflicts }

    const coming = new Set(todo.map((b) => normaliseUuid(b.change.key)))
    const known = await changes.held(todo.flatMap((b) => b.change.depends))
    const workspaces = new WorkspaceRepository(db)
    let workspace = into
    if (!workspace) {
      const name =
        todo.length === 1
          ? `Change: ${todo[0]?.change.name ?? todo[0]?.change.key}`
          : `${todo.length} changes`
      workspace = await workspaces.open({ name, ownerKey: principal.id })
      await options.schema()?.snapshot(workspace.id)
    }
    const store = new WorkspaceFileRepository(db)
    let schemaTouched = false
    for (const { change, media } of todo) {
      const missing = change.depends.filter(
        (d) => !known.has(normaliseUuid(d)) && !coming.has(normaliseUuid(d)),
      )
      const named = change.name ?? change.key
      const conflict = (item: string, says: string) =>
        conflicts.push({ change: change.key, item, says: `"${named}": ${says}` })
      /** Says so, and answers true, when an item is not as the change found it for want of another change. */
      const moved = (item: string): boolean => {
        if (missing.length === 0) return false
        conflict(
          item,
          `${item} is not as the change found it, and it needs ${missing.map((m) => `"${m}"`).join(', ')}, which this site does not have.`,
        )
        return true
      }

      for (const file of change.files) {
        const now = (await store.files(workspace.id, file.path)).get(file.path) ?? null
        if (now !== file.before && missing.length > 0) moved(file.path)
        await store.rebase(workspace.id, file.path, file.before, file.after)
        if (file.path.startsWith('schema/')) schemaTouched = true
      }
      for (const [url, bytes] of media) {
        const key = options.media.key(url)
        if (key) await options.media.store.put(key, bytes)
      }
      for (const page of change.pages) await stagePage(workspace, page, conflict, moved)
    }
    if (schemaTouched) await options.schema()?.build({ id: workspace.id, key: workspace.key })
    const staged = [...(workspace.stagedChanges ?? [])]
    for (const { change } of todo)
      if (!staged.some((s) => s.key === change.key))
        staged.push({ key: change.key, name: change.name })
    await workspaces.setStaged(workspace.id, staged)
    return { workspace: (await workspaces.byKey(workspace.key)) ?? workspace, skipped, conflicts }
  }

  async function stagePage(
    workspace: Workspace,
    page: ChangeBundlePage,
    conflict: (item: string, says: string) => void,
    moved: (item: string) => boolean,
  ) {
    const shared = repo(page.kind)
    const here = repo(page.kind, workspace.id)
    const target = await shared.byKey(page.key)
    const label = `"${page.after?.name ?? page.before?.name ?? page.key}"`

    if (page.action === 'delete') {
      if (!target) return
      const now = stateOf(target)
      if (!same([...fieldsOf(now)].sort(), [...fieldsOf(page.before)].sort())) {
        moved(label)
        conflict(label, `${label} was changed here since, so it is not deleted.`)
        return
      }
      if (await stillUsed(page.key)) {
        conflict(label, `${label} is still used here, so it is not deleted.`)
        return
      }
      await here.delete(page.key)
      return
    }

    const after = page.after as ChangePageState
    if (!target) {
      // Changed by the change, and never made here: the change that made it is missing.
      if (page.action === 'update' && page.before && moved(label)) return
      const clash = await sameAddress(page, after.name)
      if (clash) {
        conflict(label, `${label} was made here too, as "${clash}", at the same address.`)
        return
      }
      await here.create({
        key: page.key,
        contentTypeKey: page.contentTypeKey,
        componentKey: page.componentKey,
        parentKey: page.parentKey,
        values: after.values,
        variants: variantsOf(after),
      })
      if (after.published) await here.publish(page.key, null)
      return
    }

    const now = (await here.byKey(page.key)) ?? target
    const nowFields = fieldsOf(stateOf(now))
    const beforeFields = fieldsOf(page.before)
    const afterFields = fieldsOf(after)
    const taken = new Map<string, unknown>()
    for (const field of new Set([...beforeFields.keys(), ...afterFields.keys()])) {
      const b = beforeFields.get(field)
      const a = afterFields.get(field)
      if (same(a, b)) continue
      const n = nowFields.get(field)
      if (same(n, a)) continue
      if (same(n, b)) taken.set(field, a)
      else {
        moved(label)
        conflict(label, `${label}: ${field.split('|')[0]} was changed here since.`)
      }
    }
    if (taken.size > 0) {
      const values: ChangeValue[] = now.values.map((v) =>
        taken.has(fieldOf(v)) ? { ...v, value: taken.get(fieldOf(v)) } : v,
      )
      for (const v of after.values)
        if (taken.has(fieldOf(v)) && !values.some((x) => fieldOf(x) === fieldOf(v))) values.push(v)
      const variants = now.variants.map((v) => ({
        culture: v.culture,
        segment: v.segment,
        name: String(
          taken.get(v.culture ? `@name:${v.culture}` : '@name') ??
            (v.culture === null ? taken.get('@name') : undefined) ??
            v.name,
        ),
      }))
      await here.update({
        key: page.key,
        contentTypeKey: now.contentTypeKey,
        componentKey: now.componentKey,
        parentKey: now.parentKey,
        values: values as never,
        variants,
      })
    }
    if (page.beforeParentKey !== undefined && now.parentKey !== page.parentKey) {
      if (now.parentKey === page.beforeParentKey) await here.move(page.key, page.parentKey)
      else {
        moved(label)
        conflict(label, `${label} was moved here since.`)
      }
    }
    if (taken.size > 0 && after.published) await here.publish(page.key, null)
  }

  const variantsOf = (state: ChangePageState) =>
    state.names && Object.keys(state.names).length > 0
      ? Object.entries(state.names).map(([culture, name]) => ({ culture, segment: null, name }))
      : [{ culture: null, segment: null, name: state.name }]

  /** Whether anything else on this site names the page. */
  async function stillUsed(key: string): Promise<boolean> {
    const plain = normaliseUuid(key)
    const rows = await db.q
      .selectFrom('property_value')
      .select('id')
      .where('workspace_id', 'is', null)
      .where((eb) =>
        eb.or([
          eb('varchar_value', 'like', `%${plain}%`),
          eb('text_value', 'like', `%${plain}%`),
          eb('text_value', 'like', `%${plain.replaceAll('-', '')}%`),
        ]),
      )
      .limit(1)
      .execute()
    return rows.length > 0
  }

  /** The name of another page already at the address a new one would take. */
  async function sameAddress(page: ChangeBundlePage, name: string): Promise<string | undefined> {
    const parent = page.parentKey ? await repo(page.kind).byKey(page.parentKey) : undefined
    const siblings = await db.q
      .selectFrom('node')
      .select(['unique_id', 'text', 'parent_id'])
      .where('workspace_id', 'is', null)
      .where('text', '=', name)
      .execute()
    const parentId = parent
      ? (
          await db.q
            .selectFrom('node')
            .select('id')
            .where('unique_id', '=', page.parentKey as string)
            .executeTakeFirst()
        )?.id
      : -1
    const clash = siblings.find(
      (s) =>
        Number(s.parent_id) === Number(parentId) && normaliseUuid(String(s.unique_id)) !== page.key,
    )
    return clash ? String(clash.text) : undefined
  }

  /**
   * Applies changes: staged, then merged. Anything refused leaves the workspace
   * holding them, open to edit, and changes nothing here.
   */
  async function apply(
    bundles: ReadonlyArray<{ change: ChangeBundle; media: Map<string, Uint8Array> }>,
    principal: Principal,
    run: { userId?: number; accepted?: readonly string[] },
  ): Promise<ApplyOutcome> {
    const staged = await stage(bundles, principal)
    const workspace = staged.workspace
    if (!workspace) return { ok: true, skipped: staged.skipped, changeId: null }
    const workspaces = new WorkspaceRepository(db)
    if (staged.conflicts.length > 0) {
      // Left to be settled: someone edits it, then merges it.
      await workspaces.setStaged(workspace.id, workspace.stagedChanges, false)
      return {
        ok: false,
        skipped: staged.skipped,
        conflicts: staged.conflicts,
        workspace: workspace.key,
      }
    }
    return mergeStaged(workspace, principal, run, staged.skipped)
  }

  /** A staged workspace's merge, recording each change it applies. */
  async function mergeStaged(
    workspace: Workspace,
    principal: Principal,
    run: { userId?: number; accepted?: readonly string[] },
    skipped: string[] = [],
  ): Promise<ApplyOutcome> {
    const merging = options.merge()
    if (!merging) throw new Error('Workspaces are not turned on for this site.')
    const applied = workspace.stagedChanges ?? []
    const outcome = await merging.run(workspace, principal, {
      ...(run.userId === undefined ? {} : { userId: run.userId }),
      ...(run.accepted ? { accepted: run.accepted } : {}),
      ...(applied.length === 1 ? { changeKey: applied[0]?.key } : {}),
      appliedChanges: applied,
    })
    if (!outcome.ok)
      return {
        ok: false,
        skipped,
        conflicts: outcome.blockers.map((says) => ({ change: workspace.key, item: '', says })),
        workspace: workspace.key,
      }
    return { ok: true, skipped, changeId: outcome.changeId ?? null }
  }

  return { exportChange, exportWorkspace, exportSince, stage, apply, mergeStaged }
}

export type ChangeTransfer = ReturnType<typeof createChangeTransfer>
