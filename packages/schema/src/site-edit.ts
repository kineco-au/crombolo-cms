/**
 * Changes to a site's languages, user groups and URL setting (story 251), each a
 * pure function to the changed definition, or the reason it cannot change.
 */
import type { SchemaLanguage, SchemaUrls } from './model.ts'
import type { SchemaUserGroup } from './user-groups.ts'

export type LanguagesResult =
  | { ok: true; languages: SchemaLanguage[] }
  | { ok: false; reason: string }

export interface LanguageChanges {
  name?: string
  /** The language shown when this one is empty; null for none. */
  fallback?: string | null
  mandatory?: boolean
  /** True makes it the default and every other not; false is refused, since one has to be. */
  default?: boolean
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function updateLanguage(
  languages: readonly SchemaLanguage[],
  iso: string,
  changes: LanguageChanges,
): LanguagesResult {
  const language = languages.find((l) => same(l.iso, iso))
  if (!language) return { ok: false, reason: `the site has no language ${iso}` }
  if (changes.default === false && language.default)
    return {
      ok: false,
      reason: `${language.iso} is the default language; make another the default instead`,
    }
  if (changes.fallback && same(changes.fallback, language.iso))
    return { ok: false, reason: 'a language cannot fall back to itself' }
  if (changes.fallback && !languages.some((l) => same(l.iso, changes.fallback as string)))
    return { ok: false, reason: `the site has no language ${changes.fallback} to fall back to` }
  const next = languages.map((l) => {
    if (l !== language) return changes.default ? { ...l, default: false } : l
    const changed: SchemaLanguage = {
      ...l,
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.mandatory !== undefined ? { mandatory: changes.mandatory } : {}),
      ...(changes.default ? { default: true } : {}),
    }
    if (changes.fallback === null) delete changed.fallback
    else if (changes.fallback !== undefined) changed.fallback = changes.fallback
    return changed
  })
  return { ok: true, languages: next }
}

/** A language taken out: never the default, nor one another falls back to. */
export function removeLanguage(languages: readonly SchemaLanguage[], iso: string): LanguagesResult {
  const language = languages.find((l) => same(l.iso, iso))
  if (!language) return { ok: false, reason: `the site has no language ${iso}` }
  if (language.default)
    return {
      ok: false,
      reason: `${language.iso} is the default language; make another the default first`,
    }
  const falling = languages.filter((l) => l.fallback && same(l.fallback, language.iso))
  if (falling.length > 0)
    return {
      ok: false,
      reason: `${falling.map((l) => l.iso).join(', ')} fall${falling.length === 1 ? 's' : ''} back to ${language.iso}; change that first`,
    }
  return { ok: true, languages: languages.filter((l) => l !== language) }
}

export type UserGroupResult = { ok: true; group: SchemaUserGroup } | { ok: false; reason: string }

export interface UserGroupChanges {
  name?: string
  description?: string
  icon?: string
  addSections?: readonly string[]
  removeSections?: readonly string[]
  addPermissions?: readonly string[]
  removePermissions?: readonly string[]
  /** Every language, or the languages added and removed. */
  allLanguages?: boolean
  addLanguages?: readonly string[]
  removeLanguages?: readonly string[]
}

const plus = (list: readonly string[], more: readonly string[] = []) => [
  ...list,
  ...more.filter((item) => !list.includes(item)),
]

function minus(
  list: readonly string[],
  less: readonly string[] = [],
  what: string,
): string[] | string {
  const missing = less.filter((item) => !list.includes(item))
  if (missing.length > 0) return `the group has no ${what} ${missing.join(', ')}`
  return list.filter((item) => !less.includes(item))
}

/** A group's name, description, icon, sections, permissions or languages. */
export function updateUserGroup(
  group: SchemaUserGroup,
  changes: UserGroupChanges,
): UserGroupResult {
  const sections = minus(
    plus(group.sections, changes.addSections),
    changes.removeSections,
    'section',
  )
  if (typeof sections === 'string') return { ok: false, reason: sections }
  const permissions = minus(
    plus(group.permissions, changes.addPermissions),
    changes.removePermissions,
    'permission',
  )
  if (typeof permissions === 'string') return { ok: false, reason: permissions }
  let languages: string[] | 'all' = group.languages
  if (changes.allLanguages === true) languages = 'all'
  else if (changes.allLanguages === false && group.languages === 'all') languages = []
  if (changes.addLanguages?.length || changes.removeLanguages?.length) {
    if (languages === 'all')
      return {
        ok: false,
        reason: 'the group has every language; give --no-all-languages to name them instead',
      }
    const named = minus(plus(languages, changes.addLanguages), changes.removeLanguages, 'language')
    if (typeof named === 'string') return { ok: false, reason: named }
    languages = named
  }
  return {
    ok: true,
    group: {
      ...group,
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.description !== undefined
        ? { description: changes.description || undefined }
        : {}),
      ...(changes.icon !== undefined ? { icon: changes.icon || undefined } : {}),
      sections,
      permissions,
      languages,
    },
  }
}

/** The URL setting: whether the top-level page is left out of every path. */
export const updateUrls = (urls: SchemaUrls | undefined, hideTopLevel: boolean): SchemaUrls => ({
  ...(urls ?? { hideTopLevel: true }),
  hideTopLevel,
})
