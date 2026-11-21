/**
 * The dictionary a workspace holds (story 392): a file in its copy,
 * `content/dictionary.jsonl`, one item per line with its key, parent and translations,
 * in name order, so a merge goes three ways by line and an item both sides changed is a
 * conflict. Read and written here as the dictionary port, as the back office asks of it
 * in a workspace; until it is first changed there, it is Shared's. docs/workspaces.md.
 */

import type {
  DictionaryItemModel,
  DictionaryPort,
  DictionaryWriteStatus,
} from '@crombolo/api-management/domain'
import { normaliseUuid } from '@crombolo/core'
import { type Db, DictionaryRepository, WorkspaceFileRepository } from '@crombolo/data'

/** Where a workspace keeps its dictionary among its files. */
export const WORKSPACE_DICTIONARY = 'content/dictionary.jsonl'

/** The dictionary as the file holds it: a line per item, by name. Pure. */
export function writeDictionaryLines(items: readonly DictionaryItemModel[]): string {
  return [...items]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) =>
      JSON.stringify({
        key: normaliseUuid(item.key),
        name: item.name,
        parentKey: item.parentKey ? normaliseUuid(item.parentKey) : null,
        translations: [...item.translations].sort((a, b) => a.isoCode.localeCompare(b.isoCode)),
      }),
    )
    .map((line) => `${line}\n`)
    .join('')
}

/** The items a file holds; a line that is not one is left out. Pure. */
export function readDictionaryLines(text: string): DictionaryItemModel[] {
  const out: DictionaryItemModel[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const item = JSON.parse(line) as DictionaryItemModel
      if (item.key && item.name) out.push(item)
    } catch {}
  }
  return out
}

/** Shared's dictionary, as a workspace's file holds it. */
export async function sharedDictionaryLines(db: Db): Promise<string> {
  const items = await new DictionaryRepository(db).all()
  return writeDictionaryLines(
    items.map((i) => ({
      key: i.key,
      name: i.name,
      parentKey: i.parentKey ?? null,
      translations: i.translations.map((t) => ({ isoCode: t.isoCode, translation: t.translation })),
    })),
  )
}

/** The dictionary port, in a workspace: its file, read and written. */
export function workspaceDictionaryPort(db: Db, workspaceId: number): DictionaryPort {
  const store = new WorkspaceFileRepository(db)
  const load = async () => {
    const text = (await store.files(workspaceId, WORKSPACE_DICTIONARY)).get(WORKSPACE_DICTIONARY)
    return readDictionaryLines(text ?? (await sharedDictionaryLines(db)))
  }
  const save = async (items: DictionaryItemModel[]) => {
    const known = (await store.files(workspaceId, WORKSPACE_DICTIONARY)).has(WORKSPACE_DICTIONARY)
    const text = writeDictionaryLines(items)
    if (known) await store.write(workspaceId, WORKSPACE_DICTIONARY, text)
    else
      await store.rebase(workspaceId, WORKSPACE_DICTIONARY, await sharedDictionaryLines(db), text)
  }
  const same = (a: string | null, b: string | null) =>
    (a ? normaliseUuid(a) : null) === (b ? normaliseUuid(b) : null)
  const descendants = (items: DictionaryItemModel[], key: string): Set<string> => {
    const out = new Set<string>([normaliseUuid(key)])
    let grew = true
    while (grew) {
      grew = false
      for (const i of items)
        if (i.parentKey && out.has(normaliseUuid(i.parentKey)) && !out.has(normaliseUuid(i.key))) {
          out.add(normaliseUuid(i.key))
          grew = true
        }
    }
    return out
  }
  return {
    async all(filter) {
      const items = await load()
      return filter
        ? items.filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()))
        : items
    },
    async get(key) {
      return (await load()).find((i) => same(i.key, key))
    },
    async items(keys) {
      const items = await load()
      return items.filter((i) => keys.some((k) => same(i.key, k)))
    },
    async children(parentKey) {
      const items = await load()
      return items
        .filter((i) => same(i.parentKey, parentKey))
        .map((i) => ({
          key: i.key,
          name: i.name,
          parentKey: i.parentKey,
          hasChildren: items.some((c) => same(c.parentKey, i.key)),
        }))
    },
    async ancestry(key) {
      const items = await load()
      const chain: DictionaryItemModel[] = []
      let at = items.find((i) => same(i.key, key))
      while (at) {
        chain.unshift(at)
        const parent: string | null = at.parentKey
        at = parent ? items.find((i) => same(i.key, parent)) : undefined
      }
      return chain
    },
    async create(item): Promise<DictionaryWriteStatus> {
      const items = await load()
      if (items.some((i) => same(i.key, item.key))) return 'DuplicateItemKey'
      if (items.some((i) => i.name.toLowerCase() === item.name.toLowerCase())) return 'DuplicateKey'
      if (item.parentKey && !items.some((i) => same(i.key, item.parentKey))) return 'ParentNotFound'
      await save([...items, item])
      return 'Success'
    },
    async update(key, change): Promise<DictionaryWriteStatus> {
      const items = await load()
      const at = items.findIndex((i) => same(i.key, key))
      if (at < 0) return 'NotFound'
      if (items.some((i, n) => n !== at && i.name.toLowerCase() === change.name.toLowerCase()))
        return 'DuplicateKey'
      items[at] = { ...(items[at] as DictionaryItemModel), ...change }
      await save(items)
      return 'Success'
    },
    async move(key, parentKey): Promise<DictionaryWriteStatus> {
      const items = await load()
      const at = items.findIndex((i) => same(i.key, key))
      if (at < 0) return 'NotFound'
      if (parentKey && descendants(items, key).has(normaliseUuid(parentKey))) return 'InvalidParent'
      items[at] = { ...(items[at] as DictionaryItemModel), parentKey }
      await save(items)
      return 'Success'
    },
    async delete(key): Promise<DictionaryWriteStatus> {
      const items = await load()
      if (!items.some((i) => same(i.key, key))) return 'NotFound'
      const gone = descendants(items, key)
      await save(items.filter((i) => !gone.has(normaliseUuid(i.key))))
      return 'Success'
    },
    async export() {
      return undefined
    },
    async import() {
      return {
        ok: false,
        status: 'Invalid',
        reason: 'A dictionary file is imported in Shared, for now.',
      }
    },
  }
}

/**
 * Makes Shared's dictionary the merged one (story 392), on the merge's transaction:
 * new items under their parents first, then each changed, moved, and those gone,
 * children before their parents.
 */
export async function applyDictionaryLines(tx: Db, text: string): Promise<void> {
  const repo = new DictionaryRepository(tx)
  const wanted = readDictionaryLines(text)
  const now = await repo.all()
  const byKey = new Map(now.map((i) => [normaliseUuid(i.key), i]))
  const depth = (item: DictionaryItemModel): number => {
    let n = 0
    let at = item.parentKey
    while (at && n < 64) {
      n++
      at =
        wanted.find((w) => normaliseUuid(w.key) === normaliseUuid(at as string))?.parentKey ?? null
    }
    return n
  }
  for (const item of [...wanted].sort((a, b) => depth(a) - depth(b))) {
    const here = byKey.get(normaliseUuid(item.key))
    if (!here) {
      await repo.create({ ...item, translations: [...item.translations] })
      continue
    }
    if (
      here.name !== item.name ||
      JSON.stringify([...here.translations].sort((a, b) => a.isoCode.localeCompare(b.isoCode))) !==
        JSON.stringify(item.translations)
    )
      await repo.update(here.key, { name: item.name, translations: item.translations })
    if ((here.parentKey ?? null) !== (item.parentKey ?? null))
      await repo.move(here.key, item.parentKey)
  }
  const keep = new Set(wanted.map((w) => normaliseUuid(w.key)))
  const gone = now.filter((i) => !keep.has(normaliseUuid(i.key)))
  for (const item of gone.reverse()) await repo.delete(item.key).catch(() => 'NotFound')
}

/** The dictionary a workspace's site renders with (story 392): its own, else Shared's. */
export async function workspaceDictionary(db: Db, workspaceId: number) {
  const text = (await new WorkspaceFileRepository(db).files(workspaceId, WORKSPACE_DICTIONARY)).get(
    WORKSPACE_DICTIONARY,
  )
  if (text === undefined) return undefined
  const items = readDictionaryLines(text)
  const byKey = new Map(items.map((i) => [normaliseUuid(i.key), i]))
  const translations = new Map<string, Map<string, string>>()
  for (const item of items)
    translations.set(item.name, new Map(item.translations.map((t) => [t.isoCode, t.translation])))
  const outline = items.map((i) => ({
    key: normaliseUuid(i.key),
    name: i.name,
    parentName: i.parentKey ? (byKey.get(normaliseUuid(i.parentKey))?.name ?? null) : null,
  }))
  return { translations, outline }
}

/**
 * Shared's dictionary port, each write by someone recorded as their change (story 392):
 * the dictionary as the file holds it, before and after.
 */
export function recordingDictionaryPort(
  db: Db,
  port: DictionaryPort,
  record: (by: string, before: string, after: string) => Promise<void>,
): DictionaryPort {
  const recorded = async (by: string | undefined, write: () => Promise<DictionaryWriteStatus>) => {
    const before = by ? await sharedDictionaryLines(db) : ''
    const status = await write()
    if (status === 'Success' && by) {
      const after = await sharedDictionaryLines(db)
      if (after !== before) await record(by, before, after)
    }
    return status
  }
  return {
    ...port,
    create: (item, by) => recorded(by, () => port.create(item)),
    update: (key, change, by) => recorded(by, () => port.update(key, change)),
    move: (key, parentKey, by) => recorded(by, () => port.move(key, parentKey)),
    delete: (key, by) => recorded(by, () => port.delete(key)),
  }
}

/**
 * Three ways by item key (story 392): each item as one side changed it, and null where
 * both changed the same item differently. Pure.
 */
export function mergeDictionaryLines(
  base: string | null,
  mine: string | null,
  theirs: string | null,
): { text: string } | null {
  const byKey = (text: string | null) =>
    new Map(readDictionaryLines(text ?? '').map((i) => [normaliseUuid(i.key), JSON.stringify(i)]))
  const b = byKey(base)
  const m = byKey(mine)
  const t = byKey(theirs)
  const out: DictionaryItemModel[] = []
  for (const key of new Set([...b.keys(), ...m.keys(), ...t.keys()])) {
    const was = b.get(key)
    const ours = m.get(key)
    const other = t.get(key)
    let kept: string | undefined
    if (ours === other) kept = ours
    else if (ours === was) kept = other
    else if (other === was) kept = ours
    else return null
    if (kept) out.push(JSON.parse(kept) as DictionaryItemModel)
  }
  return { text: writeDictionaryLines(out) }
}
