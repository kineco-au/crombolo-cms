/** Dictionary items: a tree of keys, each with a translation per language. */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'

export interface DictionaryTranslation {
  isoCode: string
  translation: string
}

export interface DictionaryItem {
  key: string
  name: string
  parentKey: string | null
  translations: DictionaryTranslation[]
}

export type DictionaryWriteResult =
  | 'Success'
  | 'DuplicateItemKey'
  | 'DuplicateKey'
  | 'ParentNotFound'
  | 'NotFound'
  | 'InvalidParent'
  | 'InvalidLanguage'

interface Row {
  key: string
  item_key: string
  parent_key: string | null
}

function items(db: Db) {
  return db.q
    .selectFrom('dictionary_item')
    .select(['key', 'item_key', 'parent_key'])
    .orderBy('item_key')
}

type Items = ReturnType<typeof items>

export class DictionaryRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async #rows(narrow: (query: Items) => Items = (q) => q): Promise<Row[]> {
    return narrow(items(this.#db)).execute()
  }

  async #withTranslations(rows: Row[]): Promise<DictionaryItem[]> {
    if (rows.length === 0) return []
    const keys = rows.map((r) => normaliseUuid(String(r.key)))
    const texts = await this.#db.q
      .selectFrom('dictionary_text as t')
      .innerJoin('language as l', 'l.id', 't.language_id')
      .select(['t.dictionary_key', 'l.iso_code', 't.value'])
      .where('t.dictionary_key', 'in', keys)
      .orderBy('l.iso_code')
      .execute()
    return rows.map((row) => {
      const key = normaliseUuid(String(row.key))
      return {
        key,
        name: String(row.item_key),
        parentKey: row.parent_key ? normaliseUuid(String(row.parent_key)) : null,
        translations: texts
          .filter((t) => normaliseUuid(String(t.dictionary_key)) === key)
          .map((t) => ({ isoCode: String(t.iso_code), translation: String(t.value) })),
      }
    })
  }

  async get(key: string): Promise<DictionaryItem | undefined> {
    return (
      await this.#withTranslations(await this.#rows((q) => q.where('key', '=', normaliseUuid(key))))
    )[0]
  }

  async byName(name: string): Promise<DictionaryItem | undefined> {
    return (
      await this.#withTranslations(await this.#rows((q) => q.where('item_key', '=', name)))
    )[0]
  }

  async many(keys: readonly string[]): Promise<DictionaryItem[]> {
    const wanted = keys.filter((k) => /^[0-9a-f-]{32,36}$/i.test(k)).map(normaliseUuid)
    if (wanted.length === 0) return []
    return this.#withTranslations(await this.#rows((q) => q.where('key', 'in', wanted)))
  }

  /** Every item, or those whose key contains `filter`, in tree order by key. */
  async all(filter?: string): Promise<DictionaryItem[]> {
    const rows = filter
      ? await this.#rows((q) =>
          q.where((eb) => eb(eb.fn('lower', ['item_key']), 'like', `%${filter.toLowerCase()}%`)),
        )
      : await this.#rows()
    return this.#withTranslations(rows)
  }

  async children(
    parentKey: string | null,
  ): Promise<Array<{ key: string; name: string; parentKey: string | null; hasChildren: boolean }>> {
    const rows = parentKey
      ? await this.#rows((q) => q.where('parent_key', '=', normaliseUuid(parentKey)))
      : await this.#rows((q) => q.where('parent_key', 'is', null))
    const parents = new Set(
      (
        await this.#db.q
          .selectFrom('dictionary_item')
          .select('parent_key')
          .distinct()
          .where('parent_key', 'is not', null)
          .execute()
      ).map((r) => normaliseUuid(String(r.parent_key))),
    )
    return rows.map((row) => {
      const key = normaliseUuid(String(row.key))
      return {
        key,
        name: String(row.item_key),
        parentKey: row.parent_key ? normaliseUuid(String(row.parent_key)) : null,
        hasChildren: parents.has(key),
      }
    })
  }

  /** The item and its ancestors, root first. */
  async ancestry(key: string): Promise<DictionaryItem[]> {
    const chain: DictionaryItem[] = []
    let current = await this.get(key)
    while (current) {
      chain.unshift(current)
      current = current.parentKey ? await this.get(current.parentKey) : undefined
    }
    return chain
  }

  async #descendantKeys(key: string): Promise<string[]> {
    const out: string[] = []
    const queue = [normaliseUuid(key)]
    while (queue.length > 0) {
      const next = queue.shift() as string
      for (const child of await this.#rows((q) => q.where('parent_key', '=', next))) {
        const childKey = normaliseUuid(String(child.key))
        out.push(childKey)
        queue.push(childKey)
      }
    }
    return out
  }

  async #languageIds(
    translations: readonly DictionaryTranslation[],
  ): Promise<Map<string, number> | undefined> {
    const languages = await this.#db.q.selectFrom('language').select(['id', 'iso_code']).execute()
    const byIso = new Map(languages.map((l) => [String(l.iso_code).toLowerCase(), Number(l.id)]))
    const ids = new Map<string, number>()
    for (const t of translations) {
      const id = byIso.get(t.isoCode.toLowerCase())
      if (id === undefined) return undefined
      ids.set(t.isoCode, id)
    }
    return ids
  }

  async #writeTranslations(
    key: string,
    translations: readonly DictionaryTranslation[],
    ids: Map<string, number>,
  ): Promise<void> {
    await this.#db.q.deleteFrom('dictionary_text').where('dictionary_key', '=', key).execute()
    for (const t of translations)
      await this.#db.q
        .insertInto('dictionary_text')
        .values({
          dictionary_key: key,
          language_id: ids.get(t.isoCode) as number,
          value: t.translation,
        })
        .execute()
  }

  async create(item: DictionaryItem): Promise<DictionaryWriteResult> {
    const key = normaliseUuid(item.key)
    return this.#db.transaction(async (tx) => {
      const repo = new DictionaryRepository(tx)
      if (await repo.get(key)) return 'DuplicateKey'
      if (await repo.byName(item.name)) return 'DuplicateItemKey'
      if (item.parentKey && !(await repo.get(item.parentKey))) return 'ParentNotFound'
      const ids = await repo.#languageIds(item.translations)
      if (!ids) return 'InvalidLanguage'
      await tx.q
        .insertInto('dictionary_item')
        .values({
          key,
          parent_key: item.parentKey ? normaliseUuid(item.parentKey) : null,
          item_key: item.name,
        })
        .execute()
      await repo.#writeTranslations(key, item.translations, ids)
      return 'Success'
    })
  }

  async update(
    key: string,
    change: { name: string; translations: readonly DictionaryTranslation[] },
  ): Promise<DictionaryWriteResult> {
    const k = normaliseUuid(key)
    return this.#db.transaction(async (tx) => {
      const repo = new DictionaryRepository(tx)
      if (!(await repo.get(k))) return 'NotFound'
      const clash = await repo.byName(change.name)
      if (clash && clash.key !== k) return 'DuplicateItemKey'
      const ids = await repo.#languageIds(change.translations)
      if (!ids) return 'InvalidLanguage'
      await tx.q
        .updateTable('dictionary_item')
        .set({ item_key: change.name })
        .where('key', '=', k)
        .execute()
      await repo.#writeTranslations(k, change.translations, ids)
      return 'Success'
    })
  }

  async move(key: string, parentKey: string | null): Promise<DictionaryWriteResult> {
    const k = normaliseUuid(key)
    return this.#db.transaction(async (tx) => {
      const repo = new DictionaryRepository(tx)
      if (!(await repo.get(k))) return 'NotFound'
      if (parentKey) {
        const parent = normaliseUuid(parentKey)
        if (!(await repo.get(parent))) return 'ParentNotFound'
        if (parent === k || (await repo.#descendantKeys(k)).includes(parent)) return 'InvalidParent'
      }
      await tx.q
        .updateTable('dictionary_item')
        .set({ parent_key: parentKey ? normaliseUuid(parentKey) : null })
        .where('key', '=', k)
        .execute()
      return 'Success'
    })
  }

  /** Deletes the item and everything below it. */
  async delete(key: string): Promise<DictionaryWriteResult> {
    const k = normaliseUuid(key)
    return this.#db.transaction(async (tx) => {
      const repo = new DictionaryRepository(tx)
      if (!(await repo.get(k))) return 'NotFound'
      const doomed = [...(await repo.#descendantKeys(k)).reverse(), k]
      for (const d of doomed) {
        await tx.q.deleteFrom('dictionary_text').where('dictionary_key', '=', d).execute()
        await tx.q.deleteFrom('dictionary_item').where('key', '=', d).execute()
      }
      return 'Success'
    })
  }

  /** Every item's key, name and parent's name, for a choice list drawn from the dictionary. */
  async outline(): Promise<Array<{ key: string; name: string; parentName: string | null }>> {
    const rows = await this.#db.q
      .selectFrom('dictionary_item as d')
      .leftJoin('dictionary_item as p', 'p.key', 'd.parent_key')
      .select(['d.key', 'd.item_key', 'p.item_key as parent_name'])
      .orderBy('d.item_key')
      .execute()
    return rows.map((row) => ({
      key: normaliseUuid(String(row.key)),
      name: String(row.item_key),
      parentName: row.parent_name === null ? null : String(row.parent_name),
    }))
  }

  /** Every translation, keyed by item name then iso code, for rendering. */
  async translations(): Promise<Map<string, Map<string, string>>> {
    const rows = await this.#db.q
      .selectFrom('dictionary_item as d')
      .innerJoin('dictionary_text as t', 't.dictionary_key', 'd.key')
      .innerJoin('language as l', 'l.id', 't.language_id')
      .select(['d.item_key', 'l.iso_code', 't.value'])
      .execute()
    const out = new Map<string, Map<string, string>>()
    for (const row of rows) {
      const name = String(row.item_key)
      const entry = out.get(name) ?? new Map<string, string>()
      entry.set(String(row.iso_code), String(row.value))
      out.set(name, entry)
    }
    return out
  }
}
