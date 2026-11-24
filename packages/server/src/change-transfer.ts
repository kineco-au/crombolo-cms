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
import { normaliseUuid, ObjectTypes } from '@crombolo/core'
import {
  ChangeRepository,
  ChangeSourceRepository,
  ComponentRepository,
  type ContentKind,
  type Db,
  DbDate,
  DictionaryRepository,
  DocumentRepository,
  type DocumentRepositoryOptions,
  ORDER_PREFIX,
  type PagePlace,
  PLACE_PREFIX,
  SCHEDULE_PREFIX,
  TransferRunRepository,
  type Workspace,
  WorkspaceFileRepository,
  WorkspaceRepository,
  type WorkspaceScope,
} from '@crombolo/data'
import {
  type BundleNode,
  type ChangeBundle,
  type ChangeBundleFile,
  type ChangeBundlePage,
  type ChangeOrder,
  type ChangePageState,
  type ChangeValue,
  loadBundle,
  type PageSchedule,
} from '@crombolo/transfer'
import { fileClass } from './adapters/change-recording.ts'
import {
  readDictionaryLines,
  WORKSPACE_DICTIONARY,
  writeDictionaryLines,
} from './adapters/workspace-dictionary.ts'
import type { MediaFileStore } from './media-files.ts'
import type { WorkspaceMerging } from './node-operations.ts'
import { readUdt, type UdtItem } from './udt.ts'

type PageKind = ChangeBundlePage['kind']
const PAGE_KINDS: readonly PageKind[] = ['document', 'media', 'element', 'blueprint']
const isPageKind = (kind: string): kind is PageKind => (PAGE_KINDS as string[]).includes(kind)

/** A page, media item, Library item or blueprint as a site bundle carries it (story 399). */
export interface SitePage {
  kind: PageKind
  parentKey: string | null
  contentTypeKey: string
  contentTypeAlias: string
  componentKey: string | null
  state: ChangePageState
}

/** A site's items, by key: each file's text, and each page as it stands. */
export interface SiteSnapshot {
  files: Record<string, string>
  pages: Record<string, SitePage>
}

/** What staging a site bundle did, or would do with `check`. */
export type SiteStageOutcome =
  | {
      ok: true
      workspace: Workspace | undefined
      skipped: string[]
      conflicts: ChangeConflict[]
      pages: Array<{ key: string; name: string; action: string }>
      files: Array<{ path: string; class: string }>
      /** What the bundle carries that this does not stage, by its path in the bundle. */
      leftOut: string[]
    }
  | { ok: false; status: number; code: string; title: string; detail?: string }

/** A bundle's section path as a workspace keeps its files; undefined for one not staged. */
export function siteFileKey(path: string): string | undefined {
  if (path.startsWith('schema/') || path.startsWith('components/') || path.startsWith('scripts/'))
    return path
  if (path.startsWith('styles/')) return `stylesheets/${path.slice('styles/'.length)}`
  return undefined
}

/** Where a whole site's bundle carries its dictionary. */
export const SITE_DICTIONARY = 'dictionary.udt'

/** A bundle's dictionary as a workspace keeps it, an item a line; undefined when it is not one. Pure. */
export function siteDictionaryLines(udt: string): string | undefined {
  const tree = readUdt(udt)
  if (!tree) return undefined
  const flat: Array<{
    key: string
    name: string
    parentKey: string | null
    translations: UdtItem['translations']
  }> = []
  const walk = (item: UdtItem, parentKey: string | null) => {
    flat.push({
      key: normaliseUuid(item.key),
      name: item.name,
      parentKey,
      translations: item.translations,
    })
    for (const child of item.children) walk(child, normaliseUuid(item.key))
  }
  for (const item of tree) walk(item, null)
  return writeDictionaryLines(flat)
}

/**
 * Story 402: a bundle's dictionary as this site would hold it. An item whose key the site
 * has not got is matched to the site's item of the same name, as `dictionary import`
 * matches a file's; a translation for a language the site lacks is dropped, and named in
 * `dropped`. Pure.
 */
export function fitDictionary(
  lines: string,
  site: ReadonlyArray<{ key: string; name: string }>,
  languages: ReadonlySet<string>,
): { lines: string; dropped: string[] } {
  const keys = new Set(site.map((i) => normaliseUuid(i.key)))
  const byName = new Map(site.map((i) => [i.name, normaliseUuid(i.key)]))
  const items = readDictionaryLines(lines)
  const renamed = new Map<string, string>()
  for (const item of items) {
    const key = normaliseUuid(item.key)
    const named = byName.get(item.name)
    renamed.set(key, !keys.has(key) && named ? named : key)
  }
  const dropped: string[] = []
  const fitted = items.map((item) => ({
    key: renamed.get(normaliseUuid(item.key)) as string,
    name: item.name,
    parentKey: item.parentKey
      ? (renamed.get(normaliseUuid(item.parentKey)) ?? normaliseUuid(item.parentKey))
      : null,
    translations: item.translations.filter((t) => {
      if (languages.has(t.isoCode.toLowerCase())) return true
      dropped.push(`dictionary: ${item.name} (${t.isoCode})`)
      return false
    }),
  }))
  return { lines: writeDictionaryLines(fitted), dropped }
}

/**
 * Story 402: the dictionary staged, measured item by item: what the base has and the
 * bundle lacks keeps the base's line, unless `prune`, so nothing is deleted unasked. Pure.
 */
export function stagedDictionary(bundle: string, base: string | null, prune: boolean): string {
  if (prune || base === null) return bundle
  const items = readDictionaryLines(bundle)
  const carried = new Set(items.map((i) => normaliseUuid(i.key)))
  for (const item of readDictionaryLines(base))
    if (!carried.has(normaliseUuid(item.key))) items.push(item)
  return writeDictionaryLines(items)
}

/** A bundle's node as the state a change carries. Pure. */
export function siteStateOf(node: BundleNode): ChangePageState {
  const invariant = node.variants.find((v) => v.culture === null) ?? node.variants[0]
  const names: Record<string, string> = {}
  for (const v of node.variants) if (v.culture) names[v.culture] = v.name
  return {
    name: invariant?.name ?? '',
    values: node.values.map((v) => ({
      alias: v.property,
      culture: v.culture,
      segment: v.segment,
      ...(v.environment ? { environment: v.environment } : {}),
      value: v.value,
    })),
    ...(Object.keys(names).length > 0 ? { names } : {}),
    published: node.variants.some((v) => v.published),
  }
}

/** Whether two page states are the same, field by field, with the same place. Pure. */
const samePage = (a: SitePage, b: SitePage) =>
  a.parentKey === b.parentKey &&
  a.state.published === b.state.published &&
  JSON.stringify([...fieldsOf(a.state)].sort()) === JSON.stringify([...fieldsOf(b.state)].sort())

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
  /** Story 403: refused before anything was staged; `conflicts` names what it needs. */
  refused?: boolean
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
        /** Story 399: a file as Shared has it now, and every file it has. */
        textNow?(key: string): Promise<string | null>
        copiedNow?(): Promise<Map<string, string>>
      }
    | undefined
  merge: () => WorkspaceMerging | undefined
  /** Story 405: whether user groups are defined outside the site, so a change carrying one is refused. */
  groupsManaged?: () => boolean
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

/**
 * Story 411: a page's place as its change recorded it, over the states read back, which
 * name where the page is now: whether it was published, and where it was moved from.
 */
function placeOn(page: ChangeBundlePage, place: { before: PagePlace; after: PagePlace }) {
  if (page.before) page.before.published = place.before.published
  if (page.after) page.after.published = place.after.published
  if (place.before.parentKey !== place.after.parentKey || place.before.trashed) {
    page.parentKey = place.after.parentKey
    page.beforeParentKey = place.before.parentKey
  }
  if (place.before.trashed) page.restored = true
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
    orders?: ChangeOrder[]
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
      ...(input.orders && input.orders.length > 0 ? { orders: input.orders } : {}),
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
    // Story 395: a page's schedule, as the change set it.
    const schedules = new Map(
      items
        .filter((i) => i.path.startsWith(SCHEDULE_PREFIX) && i.after !== null)
        .map((i) => [
          normaliseUuid(i.path.slice(SCHEDULE_PREFIX.length)),
          JSON.parse(i.after as string) as PageSchedule,
        ]),
    )
    // Story 411: where each page stood before and after, and the orders it set.
    const places = new Map(
      items
        .filter((i) => i.path.startsWith(PLACE_PREFIX) && i.before && i.after)
        .map((i) => [
          normaliseUuid(i.path.slice(PLACE_PREFIX.length)),
          {
            before: JSON.parse(i.before as string) as PagePlace,
            after: JSON.parse(i.after as string) as PagePlace,
          },
        ]),
    )
    const orders: ChangeOrder[] = items
      .filter((i) => i.path.startsWith(ORDER_PREFIX) && i.before && i.after)
      .map((i) => {
        const parent = i.path.slice(ORDER_PREFIX.length)
        return {
          parentKey: parent === 'root' ? null : parent,
          keys: JSON.parse(i.after as string) as string[],
          before: JSON.parse(i.before as string) as string[],
        }
      })
    for (const item of items) {
      if (
        item.path.startsWith(REMOVED_PAGE_PREFIX) ||
        item.path.startsWith(SCHEDULE_PREFIX) ||
        item.path.startsWith(PLACE_PREFIX) ||
        item.path.startsWith(ORDER_PREFIX)
      )
        continue
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
      const schedule = schedules.get(normaliseUuid(row.nodeKey))
      const page = pageOf(
        row.nodeKey,
        row.kind,
        action,
        shape,
        before,
        after,
        await lastChangeOfNode(row.nodeKey, row.beforeEventId, change.key),
      )
      if (page.after && schedule) page.after.schedule = schedule
      const place = places.get(normaliseUuid(row.nodeKey))
      if (place) placeOn(page, place)
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
      orders,
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
    /** Story 400: staged only to see what it would do, so the workspace raises nothing. */
    quiet = false,
  ): Promise<StageOutcome> {
    const changes = new ChangeRepository(db)
    const keys = bundles.map((b) => b.change.key)
    const held = await changes.held(keys)
    const skipped = keys.filter((k) => held.has(normaliseUuid(k)))
    const todo = bundles.filter((b) => !held.has(normaliseUuid(b.change.key)))
    const conflicts: ChangeConflict[] = []
    if (todo.length === 0) return { workspace: into, skipped, conflicts }

    // Story 405: a group's definition is the directory's, never a change's.
    if (options.groupsManaged?.()) {
      const carrying = todo.filter((b) =>
        b.change.files.some((f) => f.path.startsWith('schema/user-groups/')),
      )
      if (carrying.length > 0)
        return {
          workspace: undefined,
          skipped,
          refused: true,
          conflicts: carrying.map((b) => ({
            change: b.change.key,
            item: 'user groups',
            says: `"${b.change.name ?? b.change.key}": this site's user groups are defined outside it, so the change cannot carry one.`,
          })),
        }
    }
    // Story 403: what a page needs that neither this site, the workspace nor the change has.
    const lacking = await lackingIn(todo, into)
    if (lacking.length > 0)
      return { workspace: undefined, skipped, conflicts: lacking, refused: true }

    const coming = new Set(todo.map((b) => normaliseUuid(b.change.key)))
    const known = await changes.held(todo.flatMap((b) => b.change.depends))
    const workspaces = new WorkspaceRepository(db)
    let workspace = into
    if (!workspace) {
      const name =
        todo.length === 1
          ? `Change: ${todo[0]?.change.name ?? todo[0]?.change.key}`
          : `${todo.length} changes`
      workspace = await workspaces.open({ name, ownerKey: principal.id, quiet })
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
      for (const order of change.orders ?? []) await stageOrder(workspace, order, conflict)
    }
    if (schemaTouched) await options.schema()?.build({ id: workspace.id, key: workspace.key })
    const staged = [...(workspace.stagedChanges ?? [])]
    for (const { change } of todo) {
      // Story 395: a schedule is set on Shared once the change is merged, as a merge drops a workspace's.
      const schedules = change.pages.flatMap((p) =>
        p.after?.schedule ? [{ key: p.key, kind: p.kind, entries: p.after.schedule }] : [],
      )
      if (!staged.some((s) => s.key === change.key))
        staged.push({
          key: change.key,
          name: change.name,
          ...(schedules.length > 0 ? { schedules } : {}),
        })
    }
    await workspaces.setStaged(workspace.id, staged)
    return { workspace: (await workspaces.byKey(workspace.key)) ?? workspace, skipped, conflicts }
  }

  /**
   * Story 403: each type and block element type a change's new pages use that this site does
   * not have, the workspace does not hold, and the change does not carry. A template is not
   * refused: a page whose template key is unknown here is staged as one is today.
   */
  async function lackingIn(
    todo: ReadonlyArray<{ change: ChangeBundle }>,
    into: Workspace | undefined,
  ): Promise<ChangeConflict[]> {
    const out: ChangeConflict[] = []
    const typeRows = await db.q
      .selectFrom('content_type as t')
      .innerJoin('node as n', 'n.id', 't.node_id')
      .select(['n.unique_id', 't.alias', 'n.workspace_id'])
      .execute()
    const here = typeRows.filter(
      (r) => r.workspace_id === null || (into !== undefined && Number(r.workspace_id) === into.id),
    )
    const typeKeys = new Set(here.map((r) => normaliseUuid(String(r.unique_id))))
    const typeAliases = new Set(here.map((r) => String(r.alias).toLowerCase()))
    for (const { change } of todo) {
      const named = change.name ?? change.key
      const carried = new Set(
        change.files.flatMap((f) =>
          /^schema\/(content|media|member)-types\//.test(f.path) && f.after
            ? [(/^alias\s*=\s*"([^"]+)"/m.exec(f.after)?.[1] ?? '').toLowerCase()]
            : [],
        ),
      )
      const carriesTypes = carried.size > 0
      const needs = (page: ChangeBundlePage, what: string) =>
        out.push({
          change: change.key,
          item: page.key,
          says: `"${named}": "${page.after?.name ?? page.key}" needs ${what}, which this site does not have.`,
        })
      for (const page of change.pages) {
        if (page.action === 'delete' || !page.after) continue
        if (await repo(page.kind).byKey(page.key)) continue
        const alias = page.contentTypeAlias.toLowerCase()
        if (
          !typeKeys.has(normaliseUuid(page.contentTypeKey)) &&
          !typeAliases.has(alias) &&
          !carried.has(alias)
        )
          needs(
            page,
            `the ${page.kind === 'media' ? 'media' : 'document'} type "${page.contentTypeAlias}"`,
          )
        if (carriesTypes) continue
        const blocks = new Set(
          [
            ...JSON.stringify(page.after.values).matchAll(
              /contentTypeKey\\?"\s*:\s*\\?"([0-9a-f-]{36})/gi,
            ),
          ].map((m) => normaliseUuid(m[1] as string)),
        )
        for (const key of blocks)
          if (!typeKeys.has(key)) needs(page, `a block's element type (${key})`)
      }
    }
    return out
  }

  /** Story 403: the page's type as this site keys it: by its key, or else by its alias. */
  async function typeKeyHere(page: ChangeBundlePage, workspace: Workspace): Promise<string> {
    const rows = await db.q
      .selectFrom('content_type as t')
      .innerJoin('node as n', 'n.id', 't.node_id')
      .select(['n.unique_id', 't.alias', 'n.workspace_id'])
      .where((eb) =>
        eb.or([
          eb('n.unique_id', '=', normaliseUuid(page.contentTypeKey)),
          eb('t.alias', '=', page.contentTypeAlias),
        ]),
      )
      .execute()
    const usable = rows.filter(
      (r) => r.workspace_id === null || Number(r.workspace_id) === workspace.id,
    )
    const byKey = usable.find(
      (r) => normaliseUuid(String(r.unique_id)) === normaliseUuid(page.contentTypeKey),
    )
    const found = byKey ?? usable.find((r) => String(r.alias) === page.contentTypeAlias)
    return found ? String(found.unique_id) : page.contentTypeKey
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
      // Story 411: one restored from the bin, deleted here for good, is made again.
      if (page.action === 'update' && page.before && !page.restored && moved(label)) return
      const clash = await sameAddress(page, after.name)
      if (clash) {
        conflict(label, `${label} was made here too, as "${clash}", at the same address.`)
        return
      }
      await here.create({
        key: page.key,
        contentTypeKey: await typeKeyHere(page, workspace),
        componentKey: page.componentKey,
        parentKey: page.parentKey,
        values: after.values,
        variants: variantsOf(after),
      })
      if (after.published) await here.publish(page.key, null)
      return
    }

    // Story 411: restored from the bin there, and in this site's bin, it comes out here too.
    if (page.restored && (await shared.nodes.byKey(page.key))?.trashed) {
      await here.move(page.key, page.parentKey)
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
    // Story 411: unpublished by the change, and published here, it is unpublished here too.
    if (page.before?.published && !after.published && now.published)
      await here.unpublish(page.key, null)
  }

  /**
   * Story 411: a parent's children put in the order a change set, those this site has in
   * that order and the rest after; a parent reordered here since the change began is a
   * conflict, as a moved page is.
   */
  async function stageOrder(
    workspace: Workspace,
    order: ChangeOrder,
    conflict: (item: string, says: string) => void,
  ) {
    const here = repo('document', workspace.id)
    if (order.parentKey && !(await here.byKey(order.parentKey))) return
    const now = (await here.children(order.parentKey, 0, 10_000)).items.map((n) =>
      normaliseUuid(n.key),
    )
    const wanted = order.keys.map(normaliseUuid)
    const found = new Set(order.before.map(normaliseUuid))
    const both = new Set(now.filter((k) => found.has(k)))
    const seq = (keys: readonly string[]) => keys.filter((k) => both.has(k)).join()
    if (seq(now) === seq(wanted)) return
    if (seq(now) !== seq(order.before.map(normaliseUuid))) {
      const parent = order.parentKey ? await here.byKey(order.parentKey) : undefined
      const named = parent
        ? `"${(parent.variants.find((v) => v.culture === null) ?? parent.variants[0])?.name ?? order.parentKey}"`
        : 'The top level'
      conflict(named, `${named}'s pages were put in another order here since.`)
      return
    }
    const present = new Set(now)
    const next = [
      ...wanted.filter((k) => present.has(k)),
      ...now.filter((k) => !wanted.includes(k)),
    ]
    await here.sort(
      order.parentKey,
      next.map((key, sortOrder) => ({ key, sortOrder })),
    )
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
    if (staged.refused)
      return { ok: false, skipped: staged.skipped, conflicts: staged.conflicts, workspace: null }
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
    for (const change of applied)
      for (const page of change.schedules ?? []) await scheduleHere(page, change.key)
    return { ok: true, skipped, changeId: outcome.changeId ?? null }
  }

  /** A page's schedule as a change carries it, replacing what Shared had for the page. */
  async function scheduleHere(
    page: { key: string; kind: string; entries: PageSchedule },
    changeKey: string,
  ) {
    const here = repo(page.kind as PageKind)
    if (!(await here.byKey(page.key))) return
    const had = await here.schedules(page.key)
    const cleared = [...new Set(had.map((s) => s.culture))]
      .filter((culture) => !page.entries.some((e) => e.culture === culture))
      .map((culture) => ({ culture, publishTime: null, unpublishTime: null }))
    await here.setSchedule(page.key, [
      ...cleared,
      ...page.entries.map((e) => ({
        culture: e.culture,
        publishTime: e.publishTime ? new Date(e.publishTime) : null,
        unpublishTime: e.unpublishTime ? new Date(e.unpublishTime) : null,
      })),
    ])
    // Story 414: it names the change it came with, for when it fires.
    await here.scheduleSetBy(page.key, changeKey)
  }

  /** A page as Shared has it now, as a site bundle would carry it. */
  async function pageNow(key: string): Promise<SitePage | null> {
    for (const kind of PAGE_KINDS) {
      const doc = await repo(kind).byKey(key)
      if (doc)
        return {
          kind,
          parentKey: doc.parentKey,
          contentTypeKey: doc.contentTypeKey,
          contentTypeAlias: doc.contentTypeAlias,
          componentKey: doc.componentKey,
          state: stateOf(doc),
        }
    }
    return null
  }

  /** A page as it stood at `at`: its latest version then, or none when it came later. */
  async function pageAt(key: string, at: Date): Promise<SitePage | null> {
    for (const kind of PAGE_KINDS) {
      const r = repo(kind)
      const now = await r.byKey(key)
      if (!now) continue
      const then = (await r.versions(key))
        .filter((v) => new Date(v.versionDate) <= at)
        .sort((a, b) => new Date(b.versionDate).getTime() - new Date(a.versionDate).getTime())[0]
      const doc = then ? await stateAt(kind, Number(then.id)) : null
      if (!doc) return null
      return {
        kind,
        parentKey: doc.parentKey,
        contentTypeKey: doc.contentTypeKey,
        contentTypeAlias: doc.contentTypeAlias,
        componentKey: doc.componentKey,
        state: stateOf(doc),
      }
    }
    return null
  }

  /** A file as it stood when a change finished at `at`: its text after the last change by then. */
  async function fileAt(key: string, at: Date): Promise<string | null> {
    const changes = new ChangeRepository(db)
    const versions = await changes.versions(key)
    let latest: { after: string | null } | undefined
    let later: { before: string | null } | undefined
    for (const v of versions) {
      const made = await changes.byId(v.changeId)
      const when = made?.finishedAt ?? made?.startedAt
      if (!when) continue
      const item = (await changes.itemsOf(v.changeId)).find((i) => i.path === key)
      if (!item) continue
      if (when <= at) latest = { after: item.after }
      else if (!later) later = { before: item.before }
    }
    if (latest) return latest.after
    if (later) return later.before
    return (await options.schema()?.textNow?.(key)) ?? null
  }

  /** Every page, media item, Library item and blueprint in Shared, by key. */
  async function sharedPageKeys(): Promise<string[]> {
    const rows = await db.q
      .selectFrom('node')
      .select('unique_id')
      .where('workspace_id', 'is', null)
      .where('trashed', '=', db.dialect.boolValue(false) as boolean)
      .where('node_object_type', 'in', [
        ObjectTypes.Document,
        ObjectTypes.Media,
        ObjectTypes.Element,
        ObjectTypes.DocumentBlueprint,
      ])
      .execute()
    return rows.map((r) => normaliseUuid(String(r.unique_id)))
  }

  /**
   * Story 399: a site bundle staged into a workspace as a change, measured from a base: the
   * source's last merged staging, the site as a change left it, or the site now. What the
   * base had and the bundle lacks is deleted only with `prune`.
   */
  async function stageSite(
    input: {
      dir: string
      source: string
      into: string
      base?: string
      prune?: boolean
      check?: boolean
    },
    principal: Principal,
    /** Whether the person may stage this change: one carrying code needs Install code. */
    mayStage: (change: ChangeBundle) => boolean = () => true,
  ): Promise<SiteStageOutcome> {
    const refused = (status: number, code: string, title: string, detail?: string) =>
      ({ ok: false, status, code, title, ...(detail ? { detail } : {}) }) as const
    const loaded = loadBundle(input.dir)
    if (!loaded.set || loaded.problems.length > 0)
      return refused(
        400,
        'not-a-site',
        'It is not a site bundle this site can read',
        loaded.problems.map((p) => `${p.file}: ${p.message}`).join(' '),
      )
    if (loaded.set.sealed)
      return refused(400, 'sealed', 'Its content is sealed: export it with its content open')

    // What the bundle carries, as this site would hold it.
    const leftOut: string[] = []
    const after: SiteSnapshot = { files: {}, pages: {} }
    for (const [path, onDisk] of loaded.files) {
      const key = siteFileKey(path)
      if (key) after.files[key] = await Bun.file(onDisk).text()
      else if (path === SITE_DICTIONARY) {
        const lines = siteDictionaryLines(await Bun.file(onDisk).text())
        if (lines !== undefined) after.files[WORKSPACE_DICTIONARY] = lines
        else leftOut.push(path)
      } else leftOut.push(path)
    }
    const components = new ComponentRepository(db)
    for (const node of loaded.set.nodes) {
      if (node.kind === 'element-folder') {
        leftOut.push(`nodes/${node.key}.json`)
        continue
      }
      after.pages[normaliseUuid(node.key)] = {
        kind: node.kind,
        parentKey: node.parent ? normaliseUuid(node.parent) : null,
        contentTypeKey: node.contentType.key,
        contentTypeAlias: node.contentType.alias,
        componentKey: node.template
          ? ((await components.byAlias(node.template))?.key ?? null)
          : null,
        state: siteStateOf(node),
      }
    }

    // What it is measured from.
    const sources = new ChangeSourceRepository(db)
    const fileKeys = new Set(Object.keys(after.files))
    const pageKeys = new Set(Object.keys(after.pages))
    let base: SiteSnapshot
    const stored = await sources.base(input.source)
    if (input.base === 'now' || (input.base && input.base !== 'now')) {
      const at =
        input.base === 'now'
          ? undefined
          : await (async () => {
              const found = await db.q
                .selectFrom('content_transfer_run')
                .select(['finished_at', 'started_at'])
                .where('change_key', '=', normaliseUuid(input.base as string))
                .executeTakeFirst()
              return found
                ? (DbDate.fromDb((found.finished_at ?? found.started_at) as never) as Date)
                : null
            })()
      if (at === null)
        return refused(404, 'no-base', `There is no change ${input.base} here to measure from`)
      if (input.prune) {
        for (const key of (await options.schema()?.copiedNow?.())?.keys() ?? []) fileKeys.add(key)
        for (const key of await sharedPageKeys()) pageKeys.add(key)
      }
      base = { files: {}, pages: {} }
      for (const key of fileKeys) {
        const text = at ? await fileAt(key, at) : ((await options.schema()?.textNow?.(key)) ?? null)
        if (text !== null) base.files[key] = text
      }
      for (const key of pageKeys) {
        const page = at ? await pageAt(key, at) : await pageNow(key)
        if (page) base.pages[key] = page
      }
    } else if (stored) base = JSON.parse(stored) as SiteSnapshot
    else
      return refused(
        409,
        'base-required',
        `Nothing has been merged from ${input.source} yet: name its base`,
        'Give base=now to measure from the site as it is, or base=<change key> to measure from the site as that change left it.',
      )

    // Story 402: the dictionary as this site holds one, then measured item by item. The
    // source's next base is the bundle as fitted, not what is staged.
    let remembered: SiteSnapshot = after
    if (after.files[WORKSPACE_DICTIONARY] !== undefined) {
      const fitted = fitDictionary(
        after.files[WORKSPACE_DICTIONARY],
        await new DictionaryRepository(db).all(),
        new Set(
          (await db.q.selectFrom('language').select('iso_code').execute()).map((r) =>
            String(r.iso_code).toLowerCase(),
          ),
        ),
      )
      leftOut.push(...fitted.dropped)
      remembered = { ...after, files: { ...after.files, [WORKSPACE_DICTIONARY]: fitted.lines } }
      after.files[WORKSPACE_DICTIONARY] = stagedDictionary(
        fitted.lines,
        base.files[WORKSPACE_DICTIONARY] ?? null,
        input.prune === true,
      )
    }

    // The change: what differs between the base and the bundle.
    const files: ChangeBundleFile[] = []
    for (const key of new Set([...Object.keys(after.files), ...Object.keys(base.files)])) {
      const before = base.files[key] ?? null
      const now = after.files[key] ?? null
      if (before === now) continue
      if (now === null && !input.prune) continue
      files.push({
        path: key,
        kind: key.startsWith('schema/') ? 'definition' : 'file',
        class: fileClass(key, before, now),
        before,
        after: now,
        lastChange: null,
      })
    }
    const pages: ChangeBundlePage[] = []
    for (const key of new Set([...Object.keys(after.pages), ...Object.keys(base.pages)])) {
      const before = base.pages[key] ?? null
      const now = after.pages[key] ?? null
      if (before && now && samePage(before, now)) continue
      if (!now && !input.prune) continue
      const shape = (now ?? before) as SitePage
      pages.push({
        key,
        kind: shape.kind,
        action: !before ? 'create' : !now ? 'delete' : 'update',
        parentKey: shape.parentKey,
        ...(before && now && before.parentKey !== now.parentKey
          ? { beforeParentKey: before.parentKey }
          : {}),
        contentTypeKey: shape.contentTypeKey,
        contentTypeAlias: shape.contentTypeAlias,
        componentKey: shape.componentKey,
        before: before?.state ?? null,
        after: now?.state ?? null,
        lastChange: null,
      })
    }
    const change = bundleOf({
      key: crypto.randomUUID(),
      name: input.into,
      kind: 'site',
      madeBy: principal.id,
      createdAt: new Date(),
      depends: [],
      files,
      pages,
    })
    if (!mayStage(change))
      return refused(
        403,
        'forbidden',
        'You may not stage this site here',
        'It carries templates or the site\'s own code, which needs "Install code on this site" (Crombolo.Remote.InstallCode).',
      )
    const media = new Map<string, Uint8Array>()
    for (const url of change.media) {
      const onDisk = loaded.blobs.get(url.replace(/^\/media\//, '')) ?? loaded.blobs.get(url)
      if (onDisk) media.set(url, new Uint8Array(await Bun.file(onDisk).arrayBuffer()))
    }
    const told = {
      pages: change.pages.map((p) => ({
        key: p.key,
        name: p.after?.name ?? p.before?.name ?? p.key,
        action: p.action,
      })),
      files: change.files.map((f) => ({ path: f.path, class: f.class })),
      leftOut,
    }

    const workspaces = new WorkspaceRepository(db)
    if (input.check) {
      const outcome = await stage([{ change, media }], principal, undefined, true)
      if (outcome.workspace)
        await workspaces.discard(outcome.workspace.id, principal.id, { quiet: true })
      return { ok: true, ...outcome, workspace: undefined, ...told }
    }

    // Into the workspace named, replacing what this source staged there before.
    const named = /^[0-9a-f-]{36}$/i.test(input.into)
      ? await workspaces.byKey(input.into)
      : (await workspaces.forUser(principal.id)).find(
          (w) => w.state === 'open' && w.name === input.into,
        )
    const before = await sources.stagedFrom(input.source)
    let into = named?.state === 'open' ? named : undefined
    if (before !== undefined && (!into || into.id === before)) {
      await workspaces.discard(before, principal.id)
      into = undefined
    }
    const outcome = await stage([{ change, media }], principal, into)
    if (outcome.workspace) {
      if (!into) await workspaces.rename(outcome.workspace.id, named?.name ?? input.into)
      await sources.staged(outcome.workspace.id, input.source, JSON.stringify(remembered))
    }
    return { ok: true, ...outcome, ...told }
  }

  return { exportChange, exportWorkspace, exportSince, stage, stageSite, apply, mergeStaged }
}

export type ChangeTransfer = ReturnType<typeof createChangeTransfer>
