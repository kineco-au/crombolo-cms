/** Languages, keyed by ISO code. Never deletes: content may reference a language. */
import type { Db } from '../database.ts'
import { fromDbBool } from '../dialect.ts'

export interface LanguageModel {
  isoCode: string
  cultureName: string
  isDefault: boolean
  isMandatory: boolean
  fallbackIsoCode: string | null
}

export class LanguageRepository {
  #db: Db
  constructor(db: Db) {
    this.#db = db
  }

  async all(): Promise<LanguageModel[]> {
    const rows = await this.#db.q
      .selectFrom('language as l')
      .leftJoin('language as f', 'f.id', 'l.fallback_language_id')
      .select([
        'l.iso_code',
        'l.culture_name',
        'l.is_default',
        'l.is_mandatory',
        'f.iso_code as fallback',
      ])
      .orderBy('l.id')
      .execute()
    return rows.map((row) => ({
      isoCode: String(row.iso_code),
      cultureName: String(row.culture_name),
      isDefault: fromDbBool(row.is_default),
      isMandatory: fromDbBool(row.is_mandatory),
      fallbackIsoCode: (row.fallback as string | null) ?? null,
    }))
  }

  async byIso(isoCode: string): Promise<LanguageModel | undefined> {
    return (await this.all()).find((l) => l.isoCode.toLowerCase() === isoCode.toLowerCase())
  }

  /** Saves one language; making it the default unmakes the previous one. */
  async save(language: LanguageModel): Promise<LanguageModel> {
    const bool = (v: boolean) => this.#db.dialect.boolValue(v)
    if (language.isDefault)
      await this.#db.q
        .updateTable('language')
        .set({ is_default: bool(false) })
        .where('iso_code', '<>', language.isoCode)
        .execute()
    await this.upsertAll([language])
    return (await this.byIso(language.isoCode)) as LanguageModel
  }

  /** Never the default, and never one another language falls back to. */
  async delete(isoCode: string): Promise<'deleted' | 'default' | 'in-use' | 'not-found'> {
    const language = await this.byIso(isoCode)
    if (!language) return 'not-found'
    if (language.isDefault) return 'default'
    if ((await this.all()).some((l) => l.fallbackIsoCode === language.isoCode)) return 'in-use'
    await this.#db.q.deleteFrom('language').where('iso_code', '=', language.isoCode).execute()
    return 'deleted'
  }

  /** Inserts or updates by ISO code; fallbacks are resolved after every row exists. */
  async upsertAll(
    languages: readonly LanguageModel[],
  ): Promise<{ created: number; updated: number }> {
    let created = 0
    let updated = 0
    const bool = (v: boolean) => this.#db.dialect.boolValue(v)
    for (const language of languages) {
      const existing = await this.#db.q
        .selectFrom('language')
        .select('id')
        .where('iso_code', '=', language.isoCode)
        .execute()
      if (existing[0]) {
        await this.#db.q
          .updateTable('language')
          .set({
            culture_name: language.cultureName,
            is_default: bool(language.isDefault),
            is_mandatory: bool(language.isMandatory),
          })
          .where('id', '=', Number(existing[0].id))
          .execute()
        updated += 1
      } else {
        await this.#db.q
          .insertInto('language')
          .values({
            iso_code: language.isoCode,
            culture_name: language.cultureName,
            is_default: bool(language.isDefault),
            is_mandatory: bool(language.isMandatory),
          })
          .execute()
        created += 1
      }
    }
    for (const language of languages) {
      const fallback = language.fallbackIsoCode
        ? await this.#db.q
            .selectFrom('language')
            .select('id')
            .where('iso_code', '=', language.fallbackIsoCode)
            .execute()
        : []
      await this.#db.q
        .updateTable('language')
        .set({ fallback_language_id: fallback[0] ? Number(fallback[0].id) : null })
        .where('iso_code', '=', language.isoCode)
        .execute()
    }
    return { created, updated }
  }
}
