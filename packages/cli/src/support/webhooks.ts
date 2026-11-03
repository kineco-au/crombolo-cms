/**
 * What the webhook commands share (story 251): the webhooks kept with the site,
 * read as the server reads them, and those kept only in this environment's
 * database, which are changed in the back office.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WebhookRepository } from '@crombolo/data'
import {
  type CromboloConfig,
  parseWebhookFile,
  type WebhookDefinition,
  webhookAliasFor,
} from '@crombolo/server'
import { CliError } from '../errors.ts'
import { siteConfig } from './site.ts'
import { needSchemaDir } from './types.ts'
import { withSiteDb } from './workflows.ts'

export interface SiteWebhook {
  alias: string
  webhook: WebhookDefinition
  file: string
}

export interface StoredWebhook {
  alias: string
  key: string
  name: string | null
  url: string
  enabled: boolean
  events: string[]
}

export const webhooksDir = (config: CromboloConfig) => join(config.schemaDir, 'webhooks')

/** The webhooks kept with the site; one the server would skip is refused with why. */
export function fileWebhooks(config: CromboloConfig): SiteWebhook[] {
  const dir = webhooksDir(config)
  if (!existsSync(dir)) return []
  const out: SiteWebhook[] = []
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith('.toml'))
    .sort()) {
    const parsed = parseWebhookFile(
      name.replace(/\.toml$/, ''),
      readFileSync(join(dir, name), 'utf8'),
    )
    if (!parsed.webhook)
      throw new CliError('refused', 'A webhook kept with the site cannot be read.', {
        details: parsed.problems,
      })
    const webhook = parsed.webhook
    out.push({
      alias: webhook.alias ?? webhookAliasFor(webhook.name, webhook.key),
      webhook,
      file: join(dir, name),
    })
  }
  return out
}

/** The webhooks kept only in this environment's database, by the alias the back office gives them. */
export async function storedWebhooks(config: CromboloConfig): Promise<StoredWebhook[]> {
  const inFiles = new Set(fileWebhooks(config).map((w) => w.webhook.key))
  const rows = (await withSiteDb(config, (db) => new WebhookRepository(db).all())) ?? []
  return rows
    .filter((row) => !inFiles.has(row.key))
    .map((row) => ({
      alias: webhookAliasFor(row.name, row.key),
      key: row.key,
      name: row.name,
      url: row.url,
      enabled: row.enabled,
      events: row.events,
    }))
}

/** The site's webhook an alias names; one kept only in the database is refused, saying where it is changed. */
export async function findWebhook(alias: string) {
  const config = await siteConfig()
  needSchemaDir(config)
  const wanted = alias.toLowerCase()
  const found = fileWebhooks(config).find(
    (w) => w.alias.toLowerCase() === wanted || w.webhook.key === wanted,
  )
  if (found) return { config, ...found }
  const stored = (await storedWebhooks(config)).find(
    (w) => w.alias.toLowerCase() === wanted || w.key === wanted,
  )
  if (stored)
    throw new CliError(
      'refused',
      `The webhook "${stored.name ?? stored.alias}" is kept in this environment only, so it is changed in the back office, under Settings.`,
    )
  throw new CliError('not_found', `The site has no webhook called "${alias}".`, {
    hint: '`crombolo webhooks list` lists them.',
  })
}

/** Headers typed as Name=env:VARIABLE. */
export function headersOf(given: readonly string[] = []): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const header of given) {
    const at = header.indexOf('=')
    if (at <= 0) throw new CliError('usage', `"${header}" is not Name=env:VARIABLE.`)
    headers[header.slice(0, at).trim()] = header.slice(at + 1).trim()
  }
  return headers
}
