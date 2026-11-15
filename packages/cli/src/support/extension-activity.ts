/**
 * What an extension did, from the command line (story 362), as Installed's
 * Activity view shows it: on this site's database through the core the view's
 * endpoint uses, or, with --profile, on a hosted site through the remote
 * protocol's `extension-activity` routes. Rows are worded as the view words them.
 */
import { activitySentence, personWords } from '@crombolo/backoffice-host/activity-words'
import {
  type ActivityAnswer,
  type ActivityPart,
  ActivityQueryError,
  bootstrapDatabase,
  type InstalledBundles,
  localBundleAdmin,
  readActivity,
  useSchemaStore,
} from '@crombolo/server'
import { Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import { hostedOrHere, type ProfileFlagValues } from '../profiles/choose.ts'
import { readTime } from './audit.ts'
import { remoteActivity } from './bundles.ts'
import { siteConfig } from './site.ts'

/** The kinds as the command line names them, the Activity view's words, and what is stored. */
export const KIND_FLAGS = {
  changes: 'write',
  reads: 'read',
  requests: 'request',
  data: 'rows',
  calls: 'call',
  screens: 'screen',
  refused: 'refused',
} as const

export const activityFlags = {
  kind: Flags.string({
    summary: 'only one kind of thing it did',
    options: Object.keys(KIND_FLAGS),
  }),
  user: Flags.string({
    summary:
      'only what it did for one person, by e-mail, login or key; itself for what it did on its own',
    helpValue: '<who>',
  }),
  since: Flags.string({ summary: 'what it did at or after this time', helpValue: '<time>' }),
  until: Flags.string({ summary: 'what it did before this time', helpValue: '<time>' }),
}

export interface ActivitySite {
  /** What is installed, to name an extension by its package; empty when it cannot be listed. */
  installed(): Promise<Pick<InstalledBundles['items'][number], 'id' | 'packageName'>[]>
  read(id: string, part: ActivityPart, search: URLSearchParams): Promise<ActivityAnswer>
}

/** The query the Activity view sends, from the flags. */
export function activitySearch(flags: {
  kind?: string
  user?: string
  since?: string
  until?: string
  limit?: number
  before?: number
}): URLSearchParams {
  const search = new URLSearchParams()
  if (flags.kind) search.set('kind', KIND_FLAGS[flags.kind as keyof typeof KIND_FLAGS])
  if (flags.user) search.set('person', flags.user)
  const since = readTime(flags.since, '--since')
  const until = readTime(flags.until, '--until')
  if (since) search.set('since', since.toISOString())
  if (until) search.set('until', until.toISOString())
  if (flags.limit !== undefined) search.set('limit', String(flags.limit))
  if (flags.before !== undefined) search.set('before', String(flags.before))
  return search
}

/** Runs `work` on the site chosen: this one, a folder profile's, or a hosted one. */
export async function withActivity<T>(
  flags: ProfileFlagValues,
  work: (site: ActivitySite) => Promise<T>,
): Promise<T> {
  const hosted = hostedOrHere(flags)
  if (hosted) return work(await remoteActivity(hosted))
  const config = await siteConfig()
  await useSchemaStore(config)
  const { db } = await bootstrapDatabase(config)
  try {
    return await work({
      installed: async () => (await (await localBundleAdmin(db, config)).installed()).items,
      read: async (id, part, search) => {
        try {
          // A running server writes what it holds within a second; it cannot be asked to here.
          return await readActivity(db, { days: config.extensionActivityDays }, id, part, search)
        } catch (error) {
          if (error instanceof ActivityQueryError)
            throw new CliError(error.status === 404 ? 'not_found' : 'usage', error.message)
          throw error
        }
      },
    })
  } finally {
    await db.close()
  }
}

/** The extension's id, from its id or its package name; an id not installed still finds what it left. */
export async function extensionId(site: ActivitySite, named: string): Promise<string> {
  const found = (await site.installed()).find(
    (item) => item.id === named || item.packageName === named,
  )
  if (found) return found.id
  if (/^[a-z0-9][a-z0-9-]*$/.test(named)) return named
  throw new CliError('not_found', `No extension "${named}" is installed here.`, {
    hint: 'crombolo extension list names each one; one removed is named by its id.',
  })
}

interface Row {
  kind: string
  area: string | null
  verb: string | null
  entityKey: string | null
  count: number
  outcome: string
  personName: string | null
  occurredAt: string | Date
}

/** "2026-11-15 09:12  Ada Lovelace  changed pages (…)", a refused call said so. */
export function activityLine(row: Row): string {
  const when = new Date(row.occurredAt).toISOString().slice(0, 16).replace('T', ' ')
  const refused = row.outcome === 'refused' && row.kind !== 'refused' ? ' (refused)' : ''
  return `  ${when}  ${String(personWords(row)).padEnd(20)}  ${activitySentence(row)}${refused}`
}
