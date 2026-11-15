/**
 * Search and sharing from the command line (story 360): the site-wide values
 * Settings → Search & sharing keeps, read and saved on this site's database
 * through the functions the screen's routes use.
 */
import { ObjectTypes } from '@crombolo/core'
import { type Db, describeRefFailure, looksLikeKey, resolveNodeRef } from '@crombolo/data'
import {
  bootstrapDatabase,
  type CromboloConfig,
  type NotFoundRule,
  namedPath,
  readSeoSettings,
  type SeoSettings,
  type SeoSettingsState,
  type SettingSource,
  saveSeoSettings,
} from '@crombolo/server'
import type { OutputField } from '../base.ts'
import { CliError } from '../errors.ts'
import { siteConfig } from './site.ts'

export type SeoField = keyof SeoSettings

export const SEO_FIELDS: readonly SeoField[] = [
  'indexable',
  'sitemap',
  'siteName',
  'titleSuffix',
  'defaultImage',
  'notFoundPage',
  'robotsTxt',
]

export const SOURCE_WORDS: Record<SettingSource, string> = {
  backoffice: 'Saved here',
  config: "From the site's configuration",
  default: 'Default',
}

/** Where a value comes from, as JSON names it. */
export type SourceName = 'saved' | 'config' | 'default'
const SOURCE_NAMES: Record<SettingSource, SourceName> = {
  backoffice: 'saved',
  config: 'config',
  default: 'default',
}

export const fieldArgDescription = `one of ${SEO_FIELDS.join(', ')}; any case, or kebab-case`

/** A field as the configuration names it, from any case or kebab-case. */
export function seoField(name: string): SeoField {
  const squashed = name.replace(/[-_\s]/g, '').toLowerCase()
  const field = SEO_FIELDS.find((f) => f.toLowerCase() === squashed)
  if (!field)
    throw new CliError('usage', `There is no search and sharing setting called "${name}".`, {
      hint: `Choose one of ${SEO_FIELDS.join(', ')}.`,
    })
  return field
}

export interface SeoSite {
  db: Db
  config: CromboloConfig
  settings: SeoSettingsState
}

/** Runs `work` on this site's database and its settings as they stand. */
export async function withSeo<T>(work: (site: SeoSite) => Promise<T>): Promise<T> {
  const config = await siteConfig()
  const { db } = await bootstrapDatabase(config)
  try {
    return await work({ db, config, settings: await readSeoSettings(db, config) })
  } finally {
    await db.close()
  }
}

/** Saves changes through the screen's own rules, refusing what it refuses. */
export async function saveSeo(site: SeoSite, changes: Record<string, unknown>) {
  const saved = await saveSeoSettings(site.db, site.config, changes)
  if (!saved.ok) throw new CliError('usage', saved.message)
  site.settings = saved.settings
  return saved.settings
}

const ON = new Set(['on', 'yes', 'true'])
const OFF = new Set(['off', 'no', 'false'])

/** What a field's value from the command line saves, as the screen would save it. */
export async function seoValue(
  site: SeoSite,
  field: SeoField,
  value: string,
  warn: (line: string) => void,
): Promise<unknown> {
  switch (field) {
    case 'indexable':
    case 'sitemap': {
      const word = value.trim().toLowerCase()
      if (ON.has(word)) return true
      if (OFF.has(word)) return false
      return value
    }
    case 'defaultImage':
      return imageValue(site.db, value, warn)
    case 'notFoundPage': {
      const resolved = await resolveNodeRef(site.db, [ObjectTypes.Document], value)
      if (!resolved.ok) throw new CliError('not_found', describeRefFailure(value, resolved))
      return [{ document: resolved.node.key }]
    }
    default:
      return value
  }
}

async function imageValue(db: Db, value: string, warn: (line: string) => void) {
  const trimmed = value.trim()
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return trimmed
  const resolved = await resolveNodeRef(db, [ObjectTypes.Media], trimmed)
  if (resolved.ok) return resolved.node.key
  if (trimmed.startsWith('/') && !looksLikeKey(trimmed)) {
    warn(`No media item is at ${trimmed}, so it is kept as an address.`)
    return trimmed
  }
  throw new CliError('not_found', describeRefFailure(trimmed, resolved), {
    hint: 'Name a media item by its path or key, or give an address beginning with / or http.',
  })
}

/** Whether any rule chooses a page for one hostname or language only. */
export const hasScopedRules = (rules: readonly NotFoundRule[]): boolean =>
  rules.some((rule) => rule.host || rule.culture)

/** The configuration's `pages.notFound`, which wins over the page chosen here. */
export const NOT_FOUND_CONFIGURED =
  "The site's configuration chooses the page for addresses that don't exist, so this one is not used."

async function named(db: Db, key: string, kind: 'content' | 'media', what: string) {
  const path = await namedPath(db, key, kind)
  return path === undefined ? `a ${what} that no longer exists (${key})` : `/${path} (${key})`
}

const text = (value: string) => (value === '' ? '(none)' : JSON.stringify(value))

/** One field's lines: its name, value and where it comes from. */
export async function fieldLines(site: SeoSite, field: SeoField): Promise<string[]> {
  const { effective, sources } = site.settings
  const source = `(${SOURCE_WORDS[sources[field]]})`
  const line = (value: string) => `${field.padEnd(14)}${value}  ${source}`
  switch (field) {
    case 'indexable':
    case 'sitemap':
      return [line(effective[field] ? 'on' : 'off')]
    case 'defaultImage': {
      const value = effective.defaultImage
      return [
        line(
          looksLikeKey(value) ? await named(site.db, value, 'media', 'media item') : text(value),
        ),
      ]
    }
    case 'notFoundPage': {
      const rules = effective.notFoundPage
      const lines =
        rules.length === 0
          ? [line('(none)')]
          : rules.length === 1 && !hasScopedRules(rules)
            ? [line(await named(site.db, (rules[0] as NotFoundRule).document, 'content', 'page'))]
            : [
                line('a page per hostname or language:'),
                ...(await Promise.all(
                  rules.map(async (rule) => {
                    const where = [rule.host, rule.culture].filter(Boolean).join(', ') || 'anywhere'
                    return `  ${where}: ${await named(site.db, rule.document, 'content', 'page')}`
                  }),
                )),
              ]
      if (site.config.pages?.notFound !== undefined) lines.push(`  ${NOT_FOUND_CONFIGURED}`)
      return lines
    }
    case 'robotsTxt':
      return [`Robots file  ${source}`, ...effective.robotsTxt.split('\n').map((l) => `  ${l}`)]
    default:
      return [line(text(effective[field]))]
  }
}

/** The settings as JSON gives them. */
export function seoJson(settings: SeoSettingsState) {
  const saved: Partial<SeoSettings> = {}
  for (const field of SEO_FIELDS) {
    const value = settings.overrides[field]
    if (value !== undefined && value !== null) (saved as Record<string, unknown>)[field] = value
  }
  const sources = {} as Record<SeoField, SourceName>
  for (const field of SEO_FIELDS) sources[field] = SOURCE_NAMES[settings.sources[field]]
  return { effective: settings.effective, saved, sources }
}

/** One field as JSON gives it after a change. */
export const fieldJson = (settings: SeoSettingsState, field: SeoField) => ({
  field,
  value: settings.effective[field],
  source: SOURCE_NAMES[settings.sources[field]],
})

const settingFields: OutputField[] = [
  { name: 'indexable', type: 'boolean' },
  { name: 'sitemap', type: 'boolean' },
  { name: 'siteName', type: 'string' },
  { name: 'titleSuffix', type: 'string' },
  { name: 'defaultImage', type: 'string', description: "a media item's key, or an address" },
  {
    name: 'notFoundPage',
    type: 'array',
    items: {
      type: 'object',
      fields: [
        { name: 'document', type: 'string' },
        { name: 'host', type: 'string' },
        { name: 'culture', type: 'string' },
      ],
    },
  },
  { name: 'robotsTxt', type: 'string' },
]

export const seoOutputFields: readonly OutputField[] = [
  { name: 'effective', type: 'object', description: 'the values in force', fields: settingFields },
  { name: 'saved', type: 'object', description: 'the values saved on this site, by field' },
  {
    name: 'sources',
    type: 'object',
    description: 'where each value comes from: saved, config or default',
  },
]
