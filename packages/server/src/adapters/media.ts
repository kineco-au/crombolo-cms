/**
 * The Media section: items stored as documents of the media object type (the
 * repository takes a kind), never published. An item's file is the path its
 * `umbracoFile` holds, served from the media root.
 */
import type { MediaPort } from '@crombolo/api-management/domain'
import {
  type ContentTypeAggregate,
  DEFAULT_UPLOAD_SETTINGS,
  type DocumentAggregate,
  IMAGE_CROPPER_EDITOR_ALIAS,
  mediaFileOf,
  normaliseUuid,
  ObjectTypes,
} from '@crombolo/core'
import {
  ContentTypeRepository,
  DataTypeRepository,
  type Db,
  DocumentRepository,
  type NodeRow,
  type NodeSchemaState,
  type ValueIntake,
} from '@crombolo/data'

/** The Media section's reads; its writes go through the media operations (story 165). */
export function createMediaPort(
  db: Db,
  options: { nodeState?: NodeSchemaState; nodeId?: string; valueIntake?: ValueIntake } = {},
): MediaPort {
  const repo = new DocumentRepository(db, { ...options, kind: 'media' })
  const tree = async (rows: readonly NodeRow[]) => repo.treeItems(rows)
  const mediaTypes = new ContentTypeRepository(db, { kind: 'media' })
  const dataTypes = new DataTypeRepository(db)

  /** Every media type with the data type of its `umbracoFile`, compositions included. */
  const mediaTypesWithFile = async () => {
    const all = await mediaTypes.all()
    const byKey = new Map(all.map((t) => [t.key, t]))
    const fileOf = (type: ContentTypeAggregate, seen = new Set<string>()): string | undefined => {
      if (seen.has(type.key)) return undefined
      seen.add(type.key)
      const own = type.properties.find((p) => p.alias === 'umbracoFile')?.dataTypeKey
      if (own) return own
      for (const c of type.compositions) {
        const composed = byKey.get(c.contentTypeKey)
        const found = composed ? fileOf(composed, seen) : undefined
        if (found) return found
      }
      return undefined
    }
    const result = []
    for (const type of all) {
      const dataTypeKey = fileOf(type)
      result.push({ type, file: dataTypeKey ? await dataTypes.byKey(dataTypeKey) : undefined })
    }
    return result
  }
  const allowedExtensions = (values: ReadonlyArray<{ alias: string; value: unknown }>) => {
    const raw = values.find((v) => v.alias === 'fileExtensions')?.value
    if (!Array.isArray(raw)) return []
    return raw
      .map((e) => (typeof e === 'string' ? e : (e as { value?: unknown })?.value))
      .filter((e): e is string => typeof e === 'string')
      .map((e) => e.replace(/^\./, '').toLowerCase())
  }

  return {
    byKey: (key) => repo.byKey(key),
    validate: (input) => repo.validate(input, null),

    originalParent: (key) => repo.originalParent(key),
    versions: (key) => repo.versions(key),
    async systemUserKey() {
      const rows = await db.q
        .selectFrom('user_account')
        .select('key')
        .orderBy('id')
        .limit(1)
        .execute()
      return rows[0] ? normaliseUuid(String(rows[0].key)) : null
    },

    async treeRoot(paging) {
      const page = await repo.children(null, paging.skip, paging.take)
      return { total: page.total, items: await tree(page.items) }
    },
    async treeChildren(parentKey, paging) {
      const page = await repo.children(parentKey, paging.skip, paging.take)
      return { total: page.total, items: await tree(page.items) }
    },
    treeAncestors: async (key) =>
      tree((await repo.nodes.ancestors(key)).filter((row) => row.objectType === ObjectTypes.Media)),
    async treeSiblings(target, before, after) {
      const window = await repo.siblings(target, before, after)
      if (!window) return undefined
      return { ...window, items: await tree(window.items) }
    },
    async recycleBin(parentKey, paging) {
      const page = await repo.trashed(parentKey, paging.skip, paging.take)
      return { total: page.total, items: await tree(page.items) }
    },
    async items(keys) {
      const rows = await Promise.all(keys.map((key) => repo.nodes.byKey(key)))
      return tree(rows.filter((row): row is NodeRow => row?.objectType === ObjectTypes.Media))
    },
    async search(query, options) {
      const page = await repo.search(query, options)
      return { total: page.total, items: await tree(page.items) }
    },

    async collection(parentKey, options) {
      const children = await repo.children(parentKey, 0, Number.MAX_SAFE_INTEGER)
      const filter = options.filter?.trim().toLowerCase()
      const loaded: Array<DocumentAggregate & { sortOrder: number; creator: string | null }> = []
      for (const node of children.items) {
        const media = await repo.load(node)
        if (!media) continue
        const name = media.variants[0]?.name ?? node.text ?? ''
        if (filter && !name.toLowerCase().includes(filter)) continue
        const latest = (await repo.versions(node.key))[0]
        const creator = latest?.userKey
          ? ((
              await db.q
                .selectFrom('user_account')
                .select('user_name')
                .where('key', '=', latest.userKey)
                .execute()
            )[0]?.user_name ?? null)
          : null
        loaded.push({ ...media, sortOrder: node.sortOrder, creator })
      }
      const keyOf = (m: (typeof loaded)[number]): string | number => {
        const variant = m.variants[0]
        switch (options.orderBy) {
          case 'name':
            return (variant?.name ?? '').toLowerCase()
          case 'createDate':
            return variant?.createDate.getTime() ?? 0
          case 'updateDate':
            return variant?.updateDate.getTime() ?? 0
          default:
            return m.sortOrder
        }
      }
      loaded.sort((a, b) => {
        const x = keyOf(a)
        const y = keyOf(b)
        const order = x < y ? -1 : x > y ? 1 : 0
        return options.orderDirection === 'Descending' ? -order : order
      })
      return {
        total: loaded.length,
        items: loaded.slice(options.skip, options.skip + options.take),
      }
    },

    async typesForExtension(raw) {
      const extension = raw.replace(/^\./, '').toLowerCase()
      const results: Array<{ key: string; name: string; icon: string; matched: boolean }> = []
      const catchAll: typeof results = []
      for (const { type, file } of await mediaTypesWithFile()) {
        if (!file) continue
        const allowed = allowedExtensions(file.values)
        const entry = { key: type.key, name: type.name, icon: type.icon }
        if (file.editorAlias === IMAGE_CROPPER_EDITOR_ALIAS) {
          if (DEFAULT_UPLOAD_SETTINGS.imageFileTypes.includes(extension))
            results.push({ ...entry, matched: true })
        } else if (allowed.includes(extension)) results.push({ ...entry, matched: true })
        else if (allowed.length === 0) catchAll.push({ ...entry, matched: false })
      }
      const seen = new Set(results.map((r) => r.key))
      return [...results, ...catchAll.filter((c) => !seen.has(c.key))]
    },

    async folderTypes() {
      const all = await mediaTypesWithFile()
      const folders = all
        .filter(({ type, file }) => !file && type.allowedContentTypes.length > 0)
        .map(({ type }) => type)
      if (!folders.some((t) => t.alias === 'Folder')) {
        const folder = all.find(({ type }) => type.alias === 'Folder')?.type
        if (folder) folders.push(folder)
      }
      return folders.map((t) => ({ key: t.key, name: t.name, icon: t.icon }))
    },

    async urls(keys) {
      const result = []
      for (const key of keys) {
        const media = await repo.byKey(key)
        if (media) result.push({ key: media.key, url: mediaFileOf(media) })
      }
      return result
    },
  }
}
