/**
 * Form entries: what visitors submitted. `docs/forms.md`.
 *
 * Keyed by the form's UUID rather than a foreign key, because the definition is
 * a file. An entry outlives its definition on purpose.
 *
 * Values are stored as text whatever the field collects — a number as its
 * decimal string, a checkbox as `true`/`false`, a multiple choice as one row
 * per selection. The field type in the definition says how to read it back,
 * which keeps this table free of a type column that could disagree with the
 * file.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'
import { sql } from '../query.ts'

/** Where an entry is in its life: approval is the only transition. */
export type FormEntryState = 'submitted' | 'approved' | 'rejected'

export const FORM_ENTRY_STATES: readonly FormEntryState[] = ['submitted', 'approved', 'rejected']

export interface FormEntryValue {
  fieldAlias: string
  /** One row per selection for a multi-value field, in the order submitted. */
  values: string[]
  /**
   * What the visitor saw for each value, when the choice came from a source and
   * the value is a key; present only then.
   */
  labels?: string[]
}

export interface FormEntry {
  id: string
  formKey: string
  /** The alias the form had when this was submitted, for an orphaned entry. */
  formAlias: string
  state: FormEntryState
  culture: string | null
  /** The page the form was submitted from, when it was on one. */
  pageKey: string | null
  /** A salted hash, never an address: enough to rate-limit, not a liability. */
  ipHash: string | null
  userAgent: string | null
  spam: boolean
  createDate: Date
  updateDate: Date
  values: FormEntryValue[]
}

export type FormEntryInput = Omit<
  FormEntry,
  'id' | 'createDate' | 'updateDate' | 'state' | 'spam'
> & {
  state?: FormEntryState
  spam?: boolean
}

export interface FormEntryQuery {
  formKey: string
  state?: FormEntryState
  /** Inclusive; the entries view defaults to the last month. */
  from?: Date
  to?: Date
  /** Matched against any value, which is what the list's search box does. */
  search?: string
  includeSpam?: boolean
  skip?: number
  take?: number
}

interface EntryRow {
  id: string
  form_key: string
  form_alias: string
  state: string
  culture: string | null
  page_key: string | null
  ip_hash: string | null
  user_agent: string | null
  spam: unknown
  create_date: unknown
  update_date: unknown
}

interface ValueRow {
  entry_id: string
  field_alias: string
  sort_order: number
  value: string | null
  label: string | null
}

const COLUMNS = [
  'id',
  'form_key',
  'form_alias',
  'state',
  'culture',
  'page_key',
  'ip_hash',
  'user_agent',
  'spam',
  'create_date',
  'update_date',
] as const

const state = (value: string): FormEntryState =>
  FORM_ENTRY_STATES.includes(value as FormEntryState) ? (value as FormEntryState) : 'submitted'

const hydrate = (row: EntryRow, values: FormEntryValue[]): FormEntry => ({
  id: row.id,
  formKey: row.form_key,
  formAlias: row.form_alias,
  state: state(row.state),
  culture: row.culture,
  pageKey: row.page_key,
  ipHash: row.ip_hash,
  userAgent: row.user_agent,
  spam: fromDbBool(row.spam),
  createDate: DbDate.fromDb(row.create_date) ?? new Date(0),
  updateDate: DbDate.fromDb(row.update_date) ?? new Date(0),
  values,
})

/** Value rows into one entry per id, each field's selections in order. */
function group(rows: readonly ValueRow[]): Map<string, FormEntryValue[]> {
  const byEntry = new Map<string, Map<string, ValueRow[]>>()
  for (const row of rows) {
    const fields = byEntry.get(row.entry_id) ?? new Map<string, ValueRow[]>()
    byEntry.set(row.entry_id, fields)
    const values = fields.get(row.field_alias) ?? []
    fields.set(row.field_alias, values)
    values.push(row)
  }
  const out = new Map<string, FormEntryValue[]>()
  for (const [id, fields] of byEntry)
    out.set(
      id,
      [...fields].map(([fieldAlias, list]) => {
        const values = list.map((row) => row.value ?? '')
        return list.some((row) => row.label !== null)
          ? { fieldAlias, values, labels: list.map((row, i) => row.label ?? (values[i] as string)) }
          : { fieldAlias, values }
      }),
    )
  return out
}

export class FormEntryRepository {
  #db: Db
  constructor(db: Db) {
    this.#db = db
  }

  /** The values for a page of entries, in one query rather than one each. */
  async #valuesFor(ids: readonly string[]): Promise<Map<string, FormEntryValue[]>> {
    if (ids.length === 0) return new Map()
    const rows = await this.#db.q
      .selectFrom('form_entry_value')
      .select(['entry_id', 'field_alias', 'sort_order', 'value', 'label'])
      .where('entry_id', 'in', [...ids])
      .orderBy('field_alias')
      .orderBy('sort_order')
      .execute()
    return group(rows)
  }

  async byId(id: string): Promise<FormEntry | undefined> {
    const row = await this.#db.q
      .selectFrom('form_entry')
      .select(COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst()
    if (!row) return undefined
    return hydrate(row, (await this.#valuesFor([id])).get(id) ?? [])
  }

  async list(query: FormEntryQuery): Promise<{ total: number; items: FormEntry[] }> {
    const search = query.search ? `%${query.search.toLowerCase()}%` : undefined
    const matching = this.#db.q
      .selectFrom('form_entry')
      .where('form_key', '=', query.formKey)
      .$if(Boolean(query.state), (q) => q.where('state', '=', query.state as FormEntryState))
      .$if(Boolean(query.from), (q) =>
        q.where('create_date', '>=', DbDate.toDb(query.from as Date)),
      )
      .$if(Boolean(query.to), (q) => q.where('create_date', '<=', DbDate.toDb(query.to as Date)))
      // Spam is stored and flagged rather than dropped — a false positive that
      // silently discarded an enquiry is worse than one to review — so it is
      // hidden from the list by default rather than absent from the table.
      .$if(!query.includeSpam, (q) => q.where('spam', '=', this.#db.dialect.boolValue(false)))
      .$if(search !== undefined, (q) =>
        q.where('id', 'in', (eb) =>
          eb
            .selectFrom('form_entry_value')
            .select('entry_id')
            .where((v) =>
              v.or([
                v(v.fn('lower', ['value']), 'like', search as string),
                v(v.fn('lower', ['label']), 'like', search as string),
              ]),
            ),
        ),
      )

    const counted = await matching.select(sql<number>`count(*)`.as('total')).executeTakeFirst()
    const rows = await matching
      .select(COLUMNS)
      .orderBy('create_date', 'desc')
      .orderBy('id')
      .limit(query.take ?? 100)
      .offset(query.skip ?? 0)
      .execute()
    const values = await this.#valuesFor(rows.map((row) => row.id))
    return {
      total: Number(counted?.total ?? 0),
      items: rows.map((row) => hydrate(row, values.get(row.id) ?? [])),
    }
  }

  /** How many entries a form has, for a form with a hard cap. */
  async count(formKey: string, options: { includeSpam?: boolean } = {}): Promise<number> {
    const row = await this.#db.q
      .selectFrom('form_entry')
      .select(sql<number>`count(*)`.as('total'))
      .where('form_key', '=', formKey)
      .$if(!options.includeSpam, (q) => q.where('spam', '=', this.#db.dialect.boolValue(false)))
      .executeTakeFirst()
    return Number(row?.total ?? 0)
  }

  async create(input: FormEntryInput, id: string = randomUUID()): Promise<FormEntry> {
    const now = new Date()
    await this.#db.q
      .insertInto('form_entry')
      .values({
        id,
        form_key: input.formKey,
        form_alias: input.formAlias,
        state: input.state ?? 'submitted',
        culture: input.culture,
        page_key: input.pageKey,
        ip_hash: input.ipHash,
        user_agent: input.userAgent,
        spam: this.#db.dialect.boolValue(input.spam ?? false),
        create_date: DbDate.toDb(now),
        update_date: DbDate.toDb(now),
      })
      .execute()
    await this.#writeValues(id, input.values)
    return (await this.byId(id)) as FormEntry
  }

  async #writeValues(id: string, values: readonly FormEntryValue[]): Promise<void> {
    for (const value of values) {
      // An empty list still means "this field was answered with nothing", which
      // is different from the field being absent; one empty row records it.
      const list = value.values.length === 0 ? [''] : value.values
      for (const [sort, text] of list.entries())
        await this.#db.q
          .insertInto('form_entry_value')
          .values({
            entry_id: id,
            field_alias: value.fieldAlias,
            sort_order: sort,
            value: text,
            label: value.labels?.[sort] ?? null,
          })
          .execute()
    }
  }

  /**
   * Approve or reject. Returns undefined when there is no such entry, so a
   * caller can tell "gone" from "done".
   */
  async setState(id: string, next: FormEntryState): Promise<FormEntry | undefined> {
    const existing = await this.byId(id)
    if (!existing) return undefined
    await this.#db.q
      .updateTable('form_entry')
      .set({ state: next, update_date: DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .execute()
    return this.byId(id)
  }

  /** Marks an entry as spam, or clears the mark after a person looked. */
  async setSpam(id: string, spam: boolean): Promise<FormEntry | undefined> {
    const existing = await this.byId(id)
    if (!existing) return undefined
    await this.#db.q
      .updateTable('form_entry')
      .set({ spam: this.#db.dialect.boolValue(spam), update_date: DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .execute()
    return this.byId(id)
  }

  /** Replaces an entry's values, for the backoffice's edit of one. */
  async setValues(id: string, values: readonly FormEntryValue[]): Promise<FormEntry | undefined> {
    const existing = await this.byId(id)
    if (!existing) return undefined
    // An edit sends values only; a label still describes a value left as it was.
    const before = new Map(existing.values.map((value) => [value.fieldAlias, value]))
    const kept = values.map((value) => {
      const old = before.get(value.fieldAlias)
      if (value.labels || !old?.labels) return value
      const labels = value.values.map((v) => old.labels?.[old.values.indexOf(v)] ?? v)
      return { ...value, labels }
    })
    await this.#db.q.deleteFrom('form_entry_value').where('entry_id', '=', id).execute()
    await this.#writeValues(id, kept)
    await this.#db.q
      .updateTable('form_entry')
      .set({ update_date: DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .execute()
    return this.byId(id)
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.byId(id)
    if (!existing) return false
    // Explicit rather than relying on the cascade: SQLite enforces foreign keys
    // only when the pragma is on, and this must not depend on that.
    await this.#db.q.deleteFrom('form_entry_value').where('entry_id', '=', id).execute()
    await this.#db.q.deleteFrom('form_entry').where('id', '=', id).execute()
    return true
  }

  /** Every form that has entries, with how many — including orphaned ones. */
  async forms(): Promise<{ formKey: string; formAlias: string; total: number }[]> {
    const rows = await this.#db.q
      .selectFrom('form_entry')
      .select((eb) => [
        'form_key',
        eb.fn.max('form_alias').as('form_alias'),
        sql<number>`count(*)`.as('total'),
      ])
      .groupBy('form_key')
      .orderBy((eb) => eb.fn.max('form_alias'))
      .execute()
    return rows.map((row) => ({
      formKey: row.form_key,
      formAlias: row.form_alias,
      total: Number(row.total),
    }))
  }
}
