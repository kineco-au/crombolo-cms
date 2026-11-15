/**
 * Undoing a change (story 353): a page's history, one of its versions, and what
 * is in the recycle bin, read the same way for the command line on the site's
 * own database and for the remote protocol. The writes go through the content
 * and media operations, as the back office's do.
 */
import { type DocumentAggregate, normaliseUuid, ObjectTypes } from '@crombolo/core'
import { currentSchemaState, type Db, DocumentRepository, NodeRepository } from '@crombolo/data'
import { type PathKind, schemaLookup, shorthandReader } from './seed/index.ts'

const OBJECT_TYPES: Record<PathKind, string> = {
  content: ObjectTypes.Document,
  library: ObjectTypes.Element,
  media: ObjectTypes.Media,
}

/** A node's place by its names, `Home/Visit us`, as a path argument names it. */
export async function namedPath(db: Db, key: string, kind: PathKind): Promise<string | undefined> {
  const nodes = new NodeRepository(db)
  const node = await nodes.byKey(normaliseUuid(key))
  if (!node || node.objectType !== OBJECT_TYPES[kind]) return undefined
  const names: string[] = []
  for (const id of node.path
    .split(',')
    .map(Number)
    .filter((id) => id > 0)) {
    const row = await nodes.byId(id)
    if (!row) return undefined
    names.push(row.text ?? row.key)
  }
  return names.join('/')
}

/** Values as `content show` gives them: in the shorthand content files use, segments left out. */
export function pageReader(db: Db, lookup = schemaLookup(db)) {
  const typeAliases = new Map<string, string>()
  const aliasOf = async (typeKey: string) => {
    const key = normaliseUuid(typeKey)
    if (!typeAliases.has(key))
      typeAliases.set(key, (await lookup.typeByKey('document', key))?.alias ?? key)
    return typeAliases.get(key) as string
  }
  return shorthandReader(lookup, aliasOf, (key, kind) => namedPath(db, key, kind))
}

export interface ShownValue {
  property: string
  culture: string | null
  value: unknown
}

async function shownValues(db: Db, doc: DocumentAggregate): Promise<ShownValue[]> {
  const lookup = schemaLookup(db)
  const reader = pageReader(db, lookup)
  const type = await lookup.typeByKey('document', doc.contentTypeKey)
  const editors = type ? await lookup.editorsOf('document', type) : new Map()
  const out: ShownValue[] = []
  for (const v of doc.values) {
    if (v.segment !== null) continue
    out.push({
      property: v.alias,
      culture: v.culture,
      value: await reader.shorthand(editors.get(v.alias)?.editor ?? '', v.value),
    })
  }
  return out
}

/** Who made a change: a person by key and name, or null for the command line or the site. */
export type Who = { key: string; name: string } | null

export interface HistoryEntry {
  /** The version's key, which names it to `show`, `keep` and `rollback`. */
  id: string
  date: string
  /** What made it: a save, a publish, a rollback, or an upgrade's migration. */
  kind: string
  by: Who
  /** The page's draft now. */
  draft: boolean
  /** What is published now. */
  live: boolean
  /** Kept from cleanup. */
  kept: boolean
}

async function userNames(db: Db, keys: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(keys)]
  if (wanted.length === 0) return new Map()
  const rows = await db.q
    .selectFrom('user_account')
    .select(['key', 'user_name'])
    .where('key', 'in', wanted)
    .execute()
  return new Map(rows.map((row) => [normaliseUuid(String(row.key)), String(row.user_name)]))
}

/** Pages read as of the schema the site is at now, as the site's own reads are. */
async function documents(db: Db, kind: 'document' | 'media' = 'document') {
  const state = await currentSchemaState(db)
  return new DocumentRepository(db, {
    kind,
    nodeState: { version: state.version, revision: state.revision },
  })
}

const pageNode = async (db: Db, key: string) => {
  const node = await new NodeRepository(db).byKey(normaliseUuid(key))
  return node?.objectType === ObjectTypes.Document ? node : undefined
}

/** A page's versions, newest first; undefined when there is no such page. */
export async function pageHistory(
  db: Db,
  key: string,
): Promise<{ page: { key: string; name: string }; versions: HistoryEntry[] } | undefined> {
  const node = await pageNode(db, key)
  if (!node) return undefined
  const versions = await (await documents(db)).versions(node.key)
  const names = await userNames(
    db,
    versions.flatMap((v) => (v.userKey ? [v.userKey] : [])),
  )
  return {
    page: { key: node.key, name: node.text ?? node.key },
    versions: versions.map((v) => ({
      id: v.id,
      date: v.versionDate.toISOString(),
      kind: v.kind ?? 'save',
      by: v.userKey ? { key: v.userKey, name: names.get(v.userKey) ?? v.userKey } : null,
      draft: v.isCurrentDraft,
      live: v.isCurrentPublished,
      kept: v.preventCleanup,
    })),
  }
}

export interface ValueChange {
  property: string
  culture: string | null
  /** `added`: this version has it and the draft does not; `removed`, the other way round. */
  change: 'added' | 'removed' | 'changed'
  draft?: unknown
  version?: unknown
}

export interface PageVersion {
  id: string
  page: { key: string; name: string }
  /** The page's name in this version. */
  name: string
  values: ShownValue[]
  /** What differs from the current draft, when asked for. */
  diff?: ValueChange[]
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** What a version holds against what the draft does, property by property. */
export function diffValues(draft: readonly ShownValue[], version: readonly ShownValue[]) {
  const id = (v: ShownValue) => `${v.property}\u0000${v.culture ?? ''}`
  const now = new Map(draft.map((v) => [id(v), v]))
  const then = new Map(version.map((v) => [id(v), v]))
  const changes: ValueChange[] = []
  for (const [at, v] of then) {
    const current = now.get(at)
    if (!current)
      changes.push({ property: v.property, culture: v.culture, change: 'added', version: v.value })
    else if (!same(current.value, v.value))
      changes.push({
        property: v.property,
        culture: v.culture,
        change: 'changed',
        draft: current.value,
        version: v.value,
      })
  }
  for (const [at, v] of now)
    if (!then.has(at))
      changes.push({ property: v.property, culture: v.culture, change: 'removed', draft: v.value })
  return changes.sort((a, b) => a.property.localeCompare(b.property))
}

/** One version of a page: its values as `content show` gives them, and with `diff` what differs from the draft. */
export async function pageVersion(
  db: Db,
  versionId: string,
  options: { diff?: boolean } = {},
): Promise<PageVersion | undefined> {
  const repo = await documents(db)
  const found = await repo.atVersion(versionId)
  if (!found) return undefined
  const doc = found.document
  const values = await shownValues(db, doc)
  const name = doc.variants.find((v) => v.culture === null)?.name ?? doc.variants[0]?.name ?? ''
  const node = await pageNode(db, doc.key)
  const out: PageVersion = {
    id: found.versionId,
    page: { key: doc.key, name: node?.text ?? name },
    name,
    values,
  }
  if (options.diff) {
    const draft = await repo.byKey(doc.key)
    out.diff = diffValues(draft ? await shownValues(db, draft) : [], values)
  }
  return out
}

export type BinKind = 'content' | 'media'

export interface BinItem {
  key: string
  name: string
  kind: BinKind
  trashedAt: string | null
  by: Who
  /**
   * Where it came from: the place's key and path, a null key and `/` for the
   * top level. `gone` when that place has been deleted or is itself in the bin,
   * when its path is null.
   */
  from: { key: string | null; path: string | null; gone: boolean }
}

const BIN_TYPES: Record<BinKind, { objectType: string; kind: 'document' | 'media' }> = {
  content: { objectType: ObjectTypes.Document, kind: 'document' },
  media: { objectType: ObjectTypes.Media, kind: 'media' },
}

/** What is in the recycle bin, newest first: what was trashed directly, not what went with it. */
export async function binItems(
  db: Db,
  options: { kinds?: readonly BinKind[]; olderThanDays?: number; now?: number } = {},
): Promise<BinItem[]> {
  const kinds = options.kinds ?? ['content', 'media']
  const cutoff =
    options.olderThanDays === undefined
      ? undefined
      : (options.now ?? Date.now()) - options.olderThanDays * 86_400_000
  const nodes = new NodeRepository(db)
  const items: BinItem[] = []
  for (const kind of kinds) {
    const repo = await documents(db, BIN_TYPES[kind].kind)
    const roots = await repo.trashedRoots()
    if (roots.length === 0) continue
    const ids = roots.map((node) => node.id)
    const dates = await repo.trashedDates(ids)
    const parents = new Map(
      (
        await db.q
          .selectFrom('document')
          .select(['node_id', 'original_parent_id'])
          .where('node_id', 'in', ids)
          .execute()
      ).map((row) => [Number(row.node_id), row.original_parent_id]),
    )
    const trashers = await trashedBy(
      db,
      roots.map((node) => node.key),
    )
    for (const node of roots) {
      const trashedAt = dates.get(node.id)
      if (cutoff !== undefined && (!trashedAt || trashedAt.getTime() > cutoff)) continue
      const parentId = parents.get(node.id)
      let from: BinItem['from'] = { key: null, path: '/', gone: false }
      if (parentId !== null && parentId !== undefined) {
        const parent = await nodes.byId(Number(parentId))
        from = parent
          ? {
              key: parent.key,
              path: parent.trashed
                ? null
                : `/${(await namedPath(db, parent.key, kind === 'media' ? 'media' : 'content')) ?? ''}`,
              gone: parent.trashed,
            }
          : { key: null, path: null, gone: true }
      }
      items.push({
        key: node.key,
        name: node.text ?? node.key,
        kind,
        trashedAt: trashedAt?.toISOString() ?? null,
        by: trashers.get(node.key) ?? null,
        from,
      })
    }
  }
  return items.sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''))
}

/** Who put each item in the bin, from the audit log's latest Trash entry for it. */
async function trashedBy(db: Db, keys: readonly string[]): Promise<Map<string, Who>> {
  const rows = await db.q
    .selectFrom('audit_entry')
    .select(['entity_key', 'user_key', 'user_name', 'occurred_at'])
    .where('action', '=', 'Trash')
    .where('entity_key', 'in', [...keys])
    .orderBy('id', 'asc')
    .execute()
  const out = new Map<string, Who>()
  for (const row of rows) {
    const key = normaliseUuid(String(row.entity_key))
    out.set(
      key,
      row.user_key
        ? { key: normaliseUuid(String(row.user_key)), name: String(row.user_name ?? '') }
        : null,
    )
  }
  return out
}

/** The bin's items a name, path or key could mean: its key, the path it came from, or its name alone. */
export function binMatches(items: readonly BinItem[], ref: string): BinItem[] {
  const wanted = ref.trim()
  const byKey = items.filter((item) => item.key === wanted.toLowerCase())
  if (byKey.length > 0) return byKey
  const fold = (text: string) => text.replace(/^\/+|\/+$/g, '').toLowerCase()
  const at = (item: BinItem) =>
    fold(item.from.path && item.from.path !== '/' ? `${item.from.path}/${item.name}` : item.name)
  const byPath = items.filter((item) => at(item) === fold(wanted))
  if (byPath.length > 0) return byPath
  return items.filter((item) => fold(item.name) === fold(wanted))
}

/** Why an item cannot go back where it was, or undefined when it can. */
export function placeGone(item: BinItem): string | undefined {
  if (!item.from.gone) return undefined
  return `"${item.name}" came from a place that is ${item.from.key ? 'in the recycle bin too' : 'no longer there'}.`
}
