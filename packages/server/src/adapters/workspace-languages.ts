/**
 * The languages a workspace holds (story 392): its copy of `schema/languages.toml`,
 * read and written as the localization port in that workspace. The merge brings the
 * file into Shared with the other definitions. docs/workspaces.md.
 */
import type { LanguageInput, LocalizationPort } from '@crombolo/api-management/domain'
import { type Db, WorkspaceFileRepository } from '@crombolo/data'
import { parseLanguages, type SchemaLanguage, writeLanguages } from '@crombolo/schema'
import { WORKSPACE_SCHEMA_PREFIX } from './schema-files.ts'

/** Where a workspace keeps its languages among its files. */
export const WORKSPACE_LANGUAGES = `${WORKSPACE_SCHEMA_PREFIX}languages.toml`

const toInput = (l: SchemaLanguage): LanguageInput => ({
  isoCode: l.iso,
  name: l.name,
  isDefault: l.default,
  isMandatory: l.mandatory,
  fallbackIsoCode: l.fallback ?? null,
})

const toSchema = (l: LanguageInput): SchemaLanguage => ({
  iso: l.isoCode,
  name: l.name,
  default: l.isDefault,
  mandatory: l.isMandatory,
  ...(l.fallbackIsoCode ? { fallback: l.fallbackIsoCode } : {}),
})

/** The languages as `schema/languages.toml` holds them. */
export const writeLanguagesFile = (languages: readonly LanguageInput[]): string =>
  writeLanguages(languages.map(toSchema))

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The localization port, in a workspace: its languages file, else Shared's languages. */
export function workspaceLocalizationPort(
  db: Db,
  shared: LocalizationPort,
  workspaceId: number,
): LocalizationPort {
  const store = new WorkspaceFileRepository(db)
  const own = async () =>
    (await store.files(workspaceId, WORKSPACE_LANGUAGES)).get(WORKSPACE_LANGUAGES)
  const load = async (): Promise<LanguageInput[]> => {
    const text = await own()
    const parsed = text === undefined ? undefined : parseLanguages('languages.toml', text).value
    return parsed ? parsed.map(toInput) : shared.allLanguages()
  }
  const save = async (languages: LanguageInput[]) => {
    const text = writeLanguages(languages.map(toSchema))
    // The workspace took every file Shared had as it opened: without one, Shared had none.
    if ((await own()) !== undefined) await store.write(workspaceId, WORKSPACE_LANGUAGES, text)
    else await store.rebase(workspaceId, WORKSPACE_LANGUAGES, null, text)
  }
  return {
    cultures: () => shared.cultures(),
    allLanguages: load,
    async language(isoCode) {
      return (await load()).find((l) => same(l.isoCode, isoCode))
    },
    async saveLanguage(language) {
      const languages = await load()
      const rest = languages
        .filter((l) => !same(l.isoCode, language.isoCode))
        .map((l) => (language.isDefault ? { ...l, isDefault: false } : l))
      const at = languages.findIndex((l) => same(l.isoCode, language.isoCode))
      const next = [...rest]
      next.splice(at < 0 ? next.length : at, 0, language)
      await save(next)
    },
    async deleteLanguage(isoCode) {
      const languages = await load()
      const found = languages.find((l) => same(l.isoCode, isoCode))
      if (!found) return 'not-found'
      if (found.isDefault) return 'default'
      if (languages.some((l) => l.fallbackIsoCode && same(l.fallbackIsoCode, isoCode)))
        return 'in-use'
      await save(languages.filter((l) => l !== found))
      return 'deleted'
    },
  }
}

/** The languages a workspace holds, where its file reads; undefined where it has none. */
export async function workspaceLanguages(
  db: Db,
  workspaceId: number,
): Promise<LanguageInput[] | undefined> {
  const text = (await new WorkspaceFileRepository(db).files(workspaceId, WORKSPACE_LANGUAGES)).get(
    WORKSPACE_LANGUAGES,
  )
  return text === undefined ? undefined : parseLanguages('languages.toml', text).value?.map(toInput)
}
