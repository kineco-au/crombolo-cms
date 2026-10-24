/**
 * The audit log from the command line (story 156): read from the site's own
 * database through a connection that cannot write, or from a hosted site
 * through the remote protocol's `audit` capability. The commands do not know
 * which. Reading is never itself audited.
 */

import {
  AUDIT_CATEGORIES,
  type AuditCategory,
  type AuditCursor,
  type AuditFilter,
  AuditLog,
  type AuditRecord,
  auditRecord,
  connect,
} from '@crombolo/data'
import { Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import { connectRemote, needEnvironment } from './remote.ts'
import { siteConfig } from './site.ts'

export interface AuditPageResult {
  items: AuditRecord[]
  next: number | null
  truncated: boolean
}

export interface AuditSource {
  page(filter: AuditFilter, cursor: AuditCursor): Promise<AuditPageResult>
  close(): Promise<void>
}

const when = (value: string | undefined, flag: string): Date | undefined => {
  if (value === undefined) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    throw new CliError('usage', `${flag} "${value}" is not a date I can read.`, {
      hint: 'Try 2026-10-01 or 2026-10-01T09:00Z.',
    })
  return date
}

export const auditFlags = {
  since: Flags.string({ summary: 'entries at or after this time', helpValue: '<time>' }),
  until: Flags.string({ summary: 'entries before this time', helpValue: '<time>' }),
  user: Flags.string({
    summary:
      'one person, by e-mail, login or key; a login with no account finds its failed sign-ins',
    helpValue: '<who>',
  }),
  category: Flags.string({ summary: 'one kind of change', options: [...AUDIT_CATEGORIES] }),
  action: Flags.string({ summary: 'one action, such as Publish or SignIn', helpValue: '<action>' }),
  entity: Flags.string({ summary: 'what one item had done to it', helpValue: '<uuid>' }),
  remote: Flags.string({
    summary: 'read a hosted site through this remote, signed in as you',
    helpValue: '<name>',
  }),
  env: Flags.string({ summary: "the remote's environment", helpValue: '<id>' }),
}

/** What the filter flags ask for. */
export function auditFilterOf(flags: {
  since?: string
  until?: string
  user?: string
  category?: string
  action?: string
  entity?: string
}): AuditFilter {
  return {
    since: when(flags.since, '--since'),
    until: when(flags.until, '--until'),
    user: flags.user,
    category: flags.category as AuditCategory | undefined,
    action: flags.action,
    entityKey: flags.entity,
  }
}

/** The site's own log, read through a connection that cannot write to it. */
async function localSource(): Promise<AuditSource> {
  const config = await siteConfig()
  let db: Awaited<ReturnType<typeof connect>>
  try {
    db = await connect({ file: config.sqliteFile, readOnly: true })
  } catch (error) {
    throw new CliError('not_found', (error as Error).message, {
      hint: 'Run this in the site, or name a hosted one with --remote.',
    })
  }
  const log = new AuditLog(db)
  return {
    async page(filter, cursor) {
      try {
        const page = await log.page(filter, cursor)
        return { ...page, items: page.items.map(auditRecord) }
      } catch (error) {
        if (/audit_entry/.test(String((error as Error).message)))
          throw new CliError('not_found', 'This database has no audit log yet.', {
            hint: 'Start the site, or run `crombolo upgrade`, so it has one.',
          })
        throw error
      }
    },
    close: () => db.close(),
  }
}

/** A hosted site's log, through the remote protocol. */
async function remoteSource(name: string, env: string | undefined): Promise<AuditSource> {
  const { discovery, client, environment } = await connectRemote(name, env)
  if (!discovery.capabilities?.includes('audit'))
    throw new CliError(
      'refused',
      `${discovery.name} does not offer its audit log to the command line.`,
    )
  const id = needEnvironment(environment, discovery)
  return {
    async page(filter, cursor) {
      const query = new URLSearchParams({ limit: String(cursor.limit) })
      if (cursor.before !== undefined) query.set('before', String(cursor.before))
      if (cursor.after !== undefined) query.set('after', String(cursor.after))
      if (filter.since) query.set('since', filter.since.toISOString())
      if (filter.until) query.set('until', filter.until.toISOString())
      if (filter.user) query.set('user', filter.user)
      if (filter.category) query.set('category', filter.category)
      if (filter.action) query.set('action', filter.action)
      if (filter.entityKey) query.set('entity', filter.entityKey)
      return client.json<AuditPageResult>(`environments/${id}/audit?${query}`)
    },
    close: async () => {},
  }
}

export const openAuditSource = (flags: { remote?: string; env?: string }) =>
  flags.remote ? remoteSource(flags.remote, flags.env) : localSource()

/** One entry as a line for people: when, what, who, to what, from where. */
export function auditLine(entry: AuditRecord): string {
  const who = entry.user?.name ?? entry.user?.key ?? '—'
  const item = entry.item ? ` ${entry.item.type} "${entry.item.name ?? entry.item.key ?? ''}"` : ''
  const from = entry.ipAddress ? ` (${entry.source} ${entry.ipAddress})` : ` (${entry.source})`
  const detail = entry.detail ? `  ${entry.detail}` : ''
  return `${entry.occurredAt}  ${entry.category.padEnd(10)} ${entry.action.padEnd(16)} ${who}${item}${from}${detail}`
}

export const recordFields = [
  { name: 'id', type: 'integer' },
  { name: 'occurredAt', type: 'string' },
  { name: 'category', type: 'string', enum: [...AUDIT_CATEGORIES] },
  { name: 'action', type: 'string' },
  { name: 'source', type: 'string', enum: ['request', 'cli', 'job'] },
  {
    name: 'user',
    type: 'object',
    nullable: true,
    fields: [
      { name: 'key', type: 'string', nullable: true },
      { name: 'name', type: 'string', nullable: true },
    ],
  },
  {
    name: 'item',
    type: 'object',
    nullable: true,
    fields: [
      { name: 'type', type: 'string' },
      { name: 'key', type: 'string', nullable: true },
      { name: 'name', type: 'string', nullable: true },
    ],
  },
  { name: 'ipAddress', type: 'string', nullable: true },
  { name: 'forwardedFor', type: 'string', nullable: true },
  { name: 'detail', type: 'string', nullable: true },
] as const
