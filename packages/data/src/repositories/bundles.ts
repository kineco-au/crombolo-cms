/**
 * The bundle definitions: what a bundle would contain, not a built bundle.
 * `docs/bundles.md`.
 *
 * The selection lists travel as JSON text in single columns. A malformed list
 * reads back as empty rather than throwing: a definition whose row was edited
 * by hand should still list and still be deletable.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'
import { sql } from '../query.ts'

export interface Bundle {
  id: string
  name: string
  contentNodeId: string | null
  contentLoadChildNodes: boolean
  mediaIds: string[]
  mediaLoadChildNodes: boolean
  elementIds: string[] | null
  contentTypes: string[]
  mediaTypes: string[]
  dataTypes: string[]
  components: string[]
  stylesheets: string[]
  scripts: string[]
  languages: string[]
  dictionaryItems: string[]
  /**
   * The npm package the bundle is built as. Not in Umbraco's definition, so the
   * contract never writes these; null until someone sets them.
   */
  packageName: string | null
  packageVersion: string | null
  createDate: Date
  updateDate: Date
}

/** A definition to store; `id` is assigned when it is new, the dates always. */
export type BundleInput = Omit<
  Bundle,
  'id' | 'createDate' | 'updateDate' | 'packageName' | 'packageVersion'
>

interface Row {
  id: string
  name: string
  content_node_id: string | null
  content_load_child_nodes: unknown
  media_load_child_nodes: unknown
  media_ids: string
  element_ids: string | null
  content_types: string
  media_types: string
  data_types: string
  components: string
  stylesheets: string
  scripts: string
  languages: string
  dictionary_items: string
  package_name: string | null
  package_version: string | null
  create_date: unknown
  update_date: unknown
}

const COLUMNS = [
  'id',
  'name',
  'content_node_id',
  'content_load_child_nodes',
  'media_load_child_nodes',
  'media_ids',
  'element_ids',
  'content_types',
  'media_types',
  'data_types',
  'components',
  'stylesheets',
  'scripts',
  'languages',
  'dictionary_items',
  'package_name',
  'package_version',
  'create_date',
  'update_date',
] as const

/** The selection lists as stored: JSON text, one column each. */
const selections = (db: Db, input: BundleInput) => ({
  name: input.name,
  content_node_id: input.contentNodeId,
  content_load_child_nodes: db.dialect.boolValue(input.contentLoadChildNodes),
  media_load_child_nodes: db.dialect.boolValue(input.mediaLoadChildNodes),
  media_ids: JSON.stringify(input.mediaIds),
  element_ids: input.elementIds === null ? null : JSON.stringify(input.elementIds),
  content_types: JSON.stringify(input.contentTypes),
  media_types: JSON.stringify(input.mediaTypes),
  data_types: JSON.stringify(input.dataTypes),
  components: JSON.stringify(input.components),
  stylesheets: JSON.stringify(input.stylesheets),
  scripts: JSON.stringify(input.scripts),
  languages: JSON.stringify(input.languages),
  dictionary_items: JSON.stringify(input.dictionaryItems),
})

const list = (value: string | null): string[] => {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

const hydrate = (row: Row): Bundle => ({
  id: row.id,
  name: row.name,
  contentNodeId: row.content_node_id,
  contentLoadChildNodes: fromDbBool(row.content_load_child_nodes),
  mediaIds: list(row.media_ids),
  mediaLoadChildNodes: fromDbBool(row.media_load_child_nodes),
  elementIds: row.element_ids === null ? null : list(row.element_ids),
  contentTypes: list(row.content_types),
  mediaTypes: list(row.media_types),
  dataTypes: list(row.data_types),
  components: list(row.components),
  stylesheets: list(row.stylesheets),
  scripts: list(row.scripts),
  languages: list(row.languages),
  dictionaryItems: list(row.dictionary_items),
  packageName: row.package_name ?? null,
  packageVersion: row.package_version ?? null,
  createDate: DbDate.fromDb(row.create_date) ?? new Date(0),
  updateDate: DbDate.fromDb(row.update_date) ?? new Date(0),
})

export class BundleRepository {
  #db: Db
  constructor(db: Db) {
    this.#db = db
  }

  /** By name, which is the order the section lists them in. */
  async list(
    options: { skip?: number; take?: number } = {},
  ): Promise<{ total: number; items: Bundle[] }> {
    const counted = await this.#db.q
      .selectFrom('bundle')
      .select(sql<number>`count(*)`.as('total'))
      .executeTakeFirst()
    const rows = await this.#db.q
      .selectFrom('bundle')
      .select(COLUMNS)
      .orderBy('name')
      .limit(options.take ?? 100)
      .offset(options.skip ?? 0)
      .execute()
    return { total: Number(counted?.total ?? 0), items: rows.map(hydrate) }
  }

  async byId(id: string): Promise<Bundle | undefined> {
    const row = await this.#db.q
      .selectFrom('bundle')
      .select(COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? hydrate(row) : undefined
  }

  async byName(name: string): Promise<Bundle | undefined> {
    const row = await this.#db.q
      .selectFrom('bundle')
      .select(COLUMNS)
      .where((eb) => eb(eb.fn('lower', ['name']), '=', name.trim().toLowerCase()))
      .executeTakeFirst()
    return row ? hydrate(row) : undefined
  }

  async create(input: BundleInput, id: string = randomUUID()): Promise<Bundle> {
    const now = new Date()
    await this.#db.q
      .insertInto('bundle')
      .values({
        id,
        ...selections(this.#db, input),
        create_date: DbDate.toDb(now),
        update_date: DbDate.toDb(now),
      })
      .execute()
    return {
      ...input,
      id,
      packageName: null,
      packageVersion: null,
      createDate: now,
      updateDate: now,
    }
  }

  async update(id: string, input: BundleInput): Promise<void> {
    await this.#db.q
      .updateTable('bundle')
      .set({ ...selections(this.#db, input), update_date: DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .execute()
  }

  /** The npm package a definition is built as; null clears a value back to its default. */
  async setPackage(
    id: string,
    pkg: { name: string | null; version: string | null },
  ): Promise<void> {
    await this.#db.q
      .updateTable('bundle')
      .set({
        package_name: pkg.name,
        package_version: pkg.version,
        update_date: DbDate.toDb(new Date()),
      })
      .where('id', '=', id)
      .execute()
  }

  async delete(id: string): Promise<void> {
    await this.#db.q.deleteFrom('bundle').where('id', '=', id).execute()
  }
}
