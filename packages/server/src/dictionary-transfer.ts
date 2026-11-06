/**
 * Dictionary items as a `.udt` file, for seeding one environment from another.
 *
 * `schema-as-code.md` leaves the dictionary in the database rather than in
 * `schema/`, because translators work in production where the schema files are
 * read-only — and promises this pair of commands as the way a lower environment
 * gets the translations.
 *
 * The logic was already in the Management API adapter, tied to a temporary
 * upload. It lives here so the endpoint and the CLI share one implementation:
 * the same `.udt` format Umbraco uses, the same upsert by key, and the same rule
 * that translations for languages this site does not have are skipped.
 */
import { normaliseUuid, SEED_NAMESPACE, uuidV5 } from '@crombolo/core'
import {
  appendCacheInstruction,
  type Db,
  type DictionaryItem,
  DictionaryRepository,
  type DictionaryTranslation,
} from '@crombolo/data'
import { readUdt, type UdtItem, writeUdtAll } from './udt.ts'

export interface DictionaryImportOutcome {
  ok: boolean
  reason?: string
  /** Items written, counting nested children. */
  imported: number
  /** Translations dropped because this environment has no such language. */
  skipped: string[]
}

/**
 * One item and its children as `.udt`, or the whole dictionary when no key is
 * given. `children()` returns a lighter row than the item itself, so each one
 * is read back for its translations.
 */
export async function dictionaryToUdt(
  repo: DictionaryRepository,
  key?: string,
): Promise<UdtItem[]> {
  const toUdt = async (itemKey: string): Promise<UdtItem | undefined> => {
    const item = await repo.get(itemKey)
    if (!item) return undefined
    const children: UdtItem[] = []
    for (const child of await repo.children(item.key)) {
      const nested = await toUdt(child.key)
      if (nested) children.push(nested)
    }
    return { key: item.key, name: item.name, translations: item.translations, children }
  }
  if (key) {
    const item = await toUdt(key)
    return item ? [item] : []
  }
  const roots: UdtItem[] = []
  for (const root of await repo.children(null)) {
    const item = await toUdt(root.key)
    if (item) roots.push(item)
  }
  return roots
}

export const writeDictionaryUdt = writeUdtAll

/** An item as a person writes it: named, with no key of its own. */
export interface DictionaryEntry {
  name: string
  translations: DictionaryTranslation[]
  children: DictionaryEntry[]
}

/** What applying named items did, or would do. */
export interface DictionaryChange {
  ok: boolean
  reason?: string
  created: string[]
  updated: string[]
  moved: string[]
  unchanged: number
  /** Translations dropped because this environment has no such language. */
  skipped: string[]
}

/** A new item's key, the same on every site built from one file. */
export const dictionaryKey = (name: string) => uuidV5(`dictionary/${name}`, SEED_NAMESPACE)

/** Carries a dry run's outcome out of the transaction it rolls back. */
class Undone<T> extends Error {
  constructor(readonly outcome: T) {
    super('undone')
  }
}

/**
 * One dictionary write in a transaction, telling every node when it changed
 * something (story 174). A failure leaves nothing behind, and a dry run is the
 * real write undone, so it reports exactly what would happen.
 */
export async function writingDictionary<T extends { ok: boolean }>(
  db: Db,
  options: { dryRun?: boolean; by?: string },
  write: (tx: Db) => Promise<T>,
  changed: (outcome: T) => boolean,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      const outcome = await write(tx)
      if (options.dryRun || !outcome.ok) throw new Undone(outcome)
      if (changed(outcome))
        await appendCacheInstruction(tx, {
          kind: 'content',
          payload: { dictionary: true },
          by: options.by,
        })
      return outcome
    })
  } catch (error) {
    if (error instanceof Undone) return error.outcome as T
    throw error
  }
}

const sameKey = (a: string | null, b: string | null) =>
  (a ? normaliseUuid(a) : null) === (b ? normaliseUuid(b) : null)

/**
 * Applies items by name. It adds and changes and never deletes, and a language
 * an entry does not name is kept. `keepPlace` leaves an existing top-level item
 * under its parent: `dictionary set` names no place, where a file states one.
 */
export async function applyDictionaryEntries(
  db: Db,
  entries: readonly DictionaryEntry[],
  options: { parentKey?: string | null; keepPlace?: boolean; dryRun?: boolean; by?: string } = {},
): Promise<DictionaryChange> {
  return writingDictionary(
    db,
    options,
    async (tx) => {
      const repo = new DictionaryRepository(tx)
      const languages = new Map(
        (await tx.q.selectFrom('language').select('iso_code').execute()).map((row) => [
          String(row.iso_code).toLowerCase(),
          String(row.iso_code),
        ]),
      )
      const skipped = new Set<string>()
      const known = (entry: DictionaryEntry) =>
        entry.translations.flatMap((t) => {
          const isoCode = languages.get(t.isoCode.toLowerCase())
          if (!isoCode) skipped.add(t.isoCode)
          return isoCode ? [{ isoCode, translation: t.translation }] : []
        })

      const change: DictionaryChange = {
        ok: true,
        created: [],
        updated: [],
        moved: [],
        unchanged: 0,
        skipped: [],
      }
      const failed = (name: string, result: string) => {
        change.ok = false
        change.reason = `"${name}" could not be written: ${result}`
      }
      const update = async (entry: DictionaryEntry, item: DictionaryItem) => {
        const mine = known(entry)
        const differs = mine.some(
          (t) =>
            item.translations.find((o) => o.isoCode.toLowerCase() === t.isoCode.toLowerCase())
              ?.translation !== t.translation,
        )
        if (!differs) return false
        const result = await repo.update(item.key, {
          name: item.name,
          translations: [
            ...item.translations.filter(
              (t) => !mine.some((n) => n.isoCode.toLowerCase() === t.isoCode.toLowerCase()),
            ),
            ...mine,
          ],
        })
        if (result === 'Success') return true
        failed(entry.name, result)
        return false
      }
      const apply = async (
        entry: DictionaryEntry,
        parent: string | null,
        place: boolean,
      ): Promise<void> => {
        const existing = await repo.byName(entry.name)
        let key = existing?.key
        if (existing) {
          const updated = await update(entry, existing)
          const moves = place && !sameKey(existing.parentKey, parent)
          if (moves) {
            const result = await repo.move(existing.key, parent)
            if (result === 'Success') change.moved.push(entry.name)
            else failed(entry.name, result)
          }
          if (updated) change.updated.push(entry.name)
          else if (!moves) change.unchanged += 1
        } else {
          // A site that renamed an item keeps its key; the name now is a new item.
          const wanted = dictionaryKey(entry.name)
          key = (await repo.get(wanted)) ? crypto.randomUUID() : wanted
          const result = await repo.create({
            key,
            name: entry.name,
            parentKey: parent,
            translations: known(entry),
          })
          if (result === 'Success') change.created.push(entry.name)
          else failed(entry.name, result)
        }
        if (!change.ok) return
        for (const child of entry.children) await apply(child, key as string, true)
      }
      for (const entry of entries) {
        await apply(entry, options.parentKey ?? null, !options.keepPlace)
        if (!change.ok) break
      }
      change.skipped = [...skipped]
      return change
    },
    (change) => change.created.length + change.updated.length + change.moved.length > 0,
  )
}

/** Named items as `.udt` items, keyed as `applyDictionaryEntries` would key them. */
export const keyedEntries = (entries: readonly DictionaryEntry[]): UdtItem[] =>
  entries.map((entry) => ({
    key: dictionaryKey(entry.name),
    name: entry.name,
    translations: entry.translations,
    children: keyedEntries(entry.children),
  }))

/**
 * Applies a `.udt` file. Items are upserted by key, so running it twice is a
 * no-op and an item translated here keeps any language the file does not carry.
 */
export async function importDictionaryUdt(
  db: Db,
  text: string,
  parentKey: string | null = null,
): Promise<DictionaryImportOutcome> {
  const repo = new DictionaryRepository(db)
  const items = readUdt(text)
  if (!items) return { ok: false, reason: 'not a dictionary export', imported: 0, skipped: [] }
  if (parentKey && !(await repo.get(parentKey)))
    return { ok: false, reason: 'the parent item does not exist', imported: 0, skipped: [] }

  const languages = new Set(
    (await db.q.selectFrom('language').select('iso_code').execute()).map((row) =>
      String(row.iso_code).toLowerCase(),
    ),
  )
  const skipped = new Set<string>()
  // As Umbraco does: a translation for a language this site has not got is
  // dropped rather than refused, so a partial language set still imports.
  const known = (item: UdtItem) =>
    item.translations.filter((t) => {
      if (languages.has(t.isoCode.toLowerCase())) return true
      skipped.add(t.isoCode)
      return false
    })

  let imported = 0
  const save = async (item: UdtItem, parent: string | null): Promise<void> => {
    const existing = await repo.get(item.key)
    const mine = known(item)
    const result = existing
      ? await repo.update(item.key, {
          name: existing.name,
          translations: [
            ...existing.translations.filter(
              (t) => !mine.some((n) => n.isoCode.toLowerCase() === t.isoCode.toLowerCase()),
            ),
            ...mine,
          ],
        })
      : await repo.create({
          key: item.key,
          name: item.name,
          parentKey: parent,
          translations: mine,
        })
    if (result !== 'Success') return
    imported += 1
    for (const child of item.children) await save(child, item.key)
  }

  for (const item of items) await save(item, parentKey)
  return imported > 0
    ? { ok: true, imported, skipped: [...skipped] }
    : {
        ok: false,
        reason: 'nothing in the file could be imported: a name is already in use',
        imported: 0,
        skipped: [...skipped],
      }
}
