/**
 * Undoing a change from the command line (story 353): a page's history, its
 * versions rolled back and kept, and the recycle bin, on this site's database or,
 * with --profile, on a hosted site through the remote protocol. Both go through
 * the operations the back office uses.
 */
import type { Refusal } from '@crombolo/content'
import { DocumentRepository, looksLikeKey } from '@crombolo/data'
import {
  type BinItem,
  type BinKind,
  binItems,
  binMatches,
  bootstrapDatabase,
  type HistoryEntry,
  type PageVersion,
  pageHistory,
  pageVersion,
  placeGone,
  siteDocumentOperations,
  siteMediaOperations,
} from '@crombolo/server'
import { CliError } from '../errors.ts'
import { type HostedSite, hostedOrHere, type ProfileFlagValues } from '../profiles/choose.ts'
import { RemoteError } from '../remote/client.ts'
import { commandActor } from './acting.ts'
import { connectSite, needEnvironment } from './remote.ts'
import type { Io } from './site.ts'
import { siteConfig } from './site.ts'
import { resolveItem, resolvePlace, TOP } from './tree.ts'

export type { BinItem, HistoryEntry, PageVersion }

type History = { page: { key: string; name: string }; versions: HistoryEntry[] }

/** The place an item is restored to: null for the top level. */
export type Place = { key: string; name: string } | null

/** What restoring came to: done, or a large media branch still being restored. */
export interface Restored {
  queued?: string
}

export interface UndoSite {
  history(page: string): Promise<History>
  version(id: string, diff: boolean): Promise<PageVersion>
  rollback(
    page: History['page'],
    id: string,
    options: { publish: boolean; skipApproval: boolean },
  ): Promise<void>
  keep(id: string, keep: boolean): Promise<void>
  bin(kinds: readonly BinKind[], olderThanDays?: number): Promise<BinItem[]>
  place(kind: BinKind, ref: string): Promise<Place>
  restore(io: Io, item: BinItem, to: Place | undefined): Promise<void>
}

/** What each part needs of a hosted site, in the words its refusal uses. */
const CAPABILITIES = {
  'content-history': 'see and roll back the history of pages',
  'recycle-bin': 'restore from its recycle bin',
} as const

const NOT_PUBLISHED = 'It was rolled back to a draft, and not published:'

const approvalHint = (reason: string) =>
  `${reason} To go ahead anyway, add --skip-approval; the audit log records that you did.`

function refusal(result: Refusal & { blocked?: Array<{ key: string; reasons: string[] }> }) {
  return new CliError(
    result.kind === 'notFound' ? 'not_found' : 'refused',
    result.kind === 'needsApproval' ? approvalHint(result.reason) : result.reason,
    result.blocked ? { details: result.blocked.flatMap((b) => b.reasons) } : undefined,
  )
}

/** Runs `work` on the site chosen: this one, a folder profile's, or a hosted one. */
export async function withUndo<T>(
  flags: ProfileFlagValues,
  needs: keyof typeof CAPABILITIES,
  work: (site: UndoSite) => Promise<T>,
): Promise<T> {
  const hosted = hostedOrHere(flags)
  if (hosted) return work(await hostedUndo(hosted, needs))
  const config = await siteConfig()
  const { db } = await bootstrapDatabase(config)
  try {
    return await work({
      async history(ref) {
        const node = await resolveItem(db, 'content', ref)
        const found = await pageHistory(db, node.key)
        if (!found) throw new CliError('not_found', `"${ref}" is not a page.`)
        return found
      },
      async version(id, diff) {
        const shown = await pageVersion(db, id, { diff })
        if (!shown) throw new CliError('not_found', `There is no version ${id}.`)
        return shown
      },
      async rollback(page, id, options) {
        const actor = commandActor({ skipApproval: options.skipApproval })
        const { operations } = await siteDocumentOperations(db, config)
        const rolled = await operations.rollback(actor, id, { overwrite: true })
        if (!rolled.ok) throw refusal(rolled)
        if (!options.publish) return
        const published = await operations.publishMany(actor, [page.key], null, 'publish')
        if (!published.ok)
          throw refusal({ ...published, reason: `${NOT_PUBLISHED} ${published.reason}` })
      },
      async keep(id, keep) {
        if (!(await new DocumentRepository(db).setPreventCleanup(id, keep)))
          throw new CliError('not_found', `There is no version ${id}.`)
      },
      bin: (kinds, olderThanDays) =>
        binItems(db, { kinds, ...(olderThanDays !== undefined ? { olderThanDays } : {}) }),
      async place(kind, ref) {
        const node = await resolvePlace(db, kind, ref)
        return node ? { key: node.key, name: node.text ?? node.key } : null
      },
      async restore(_io, item, to) {
        const actor = commandActor()
        const target = to === undefined ? undefined : (to?.key ?? null)
        const done =
          item.kind === 'media'
            ? await (await siteMediaOperations(db, config)).restore(actor, item.key, target)
            : await (await siteDocumentOperations(db, config)).operations.restore(
                actor,
                item.key,
                target,
              )
        if (!done.ok) throw refusal(done)
      },
    })
  } finally {
    await db.close()
  }
}

const POLL_MS = 2_000

async function hostedUndo(site: HostedSite, needs: keyof typeof CAPABILITIES): Promise<UndoSite> {
  const { discovery, client, environment } = await connectSite(site)
  if (!discovery.capabilities?.includes(needs))
    throw new CliError(
      'refused',
      `This site needs a newer crombolo to ${CAPABILITIES[needs]} from the command line.`,
      { hint: `${discovery.name} has to be upgraded first.` },
    )
  const env = `environments/${needEnvironment(environment, discovery)}`
  const send = async <T>(path: string, method: string, body: unknown): Promise<T> => {
    try {
      return await client.json<T>(`${env}/${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (error) {
      if (error instanceof RemoteError && error.problem.code === 'needs-approval')
        throw new CliError('refused', approvalHint(error.problem.title))
      throw error
    }
  }
  const byKey = (ref: string, what: string) => {
    if (!looksLikeKey(ref.trim()))
      throw new CliError('usage', `On a hosted site, name ${what} by its uuid.`, {
        hint: '`crombolo content find --profile <name>` gives each page’s.',
      })
    return ref.trim().toLowerCase()
  }
  return {
    history: (ref) => client.json<History>(`${env}/content/${byKey(ref, 'the page')}/history`),
    version: (id, diff) =>
      client.json<PageVersion>(`${env}/content/versions/${id}${diff ? '?diff=true' : ''}`),
    async rollback(_page, id, options) {
      await send(`content/versions/${id}/rollback`, 'POST', options)
    },
    async keep(id, keep) {
      await send(`content/versions/${id}/keep`, 'PUT', { keep })
    },
    async bin(kinds, olderThanDays) {
      const query = new URLSearchParams()
      if (kinds.length === 1) query.set('kind', kinds[0] as string)
      if (olderThanDays !== undefined) query.set('olderThan', String(olderThanDays))
      const asked = query.size > 0 ? `?${query}` : ''
      return (await client.json<{ items: BinItem[] }>(`${env}/recycle-bin${asked}`)).items
    },
    async place(_kind, ref) {
      if (ref.trim() === TOP) return null
      const key = byKey(ref, 'the place')
      return { key, name: key }
    },
    async restore(io, item, to) {
      const answer = await send<{ queued?: string }>(`recycle-bin/${item.key}/restore`, 'POST', {
        ...(to !== undefined ? { target: to?.key ?? null } : {}),
      })
      if (!answer.queued) return
      io.say(`  restoring ${item.name}: a large branch, restored in the background`)
      for (;;) {
        await Bun.sleep(POLL_MS)
        const job = await client.json<{ state: string; error: string | null }>(
          `${env}/recycle-bin/jobs/${answer.queued}`,
        )
        if (job.state === 'succeeded') return
        if (job.state === 'failed')
          throw new CliError('refused', `${item.name} could not be restored: ${job.error ?? ''}`)
      }
    },
  }
}

const VERSION_NAMES = ['latest-published', 'previous'] as const

/** The version a key, `latest-published` or `previous` names, among a page's. */
export function pickVersion(history: History, ref: string): HistoryEntry {
  const { versions } = history
  const wanted = ref.trim().toLowerCase()
  let found: HistoryEntry | undefined
  if (wanted === 'latest-published')
    found = versions.find((v) => v.live) ?? versions.find((v) => v.kind === 'publish')
  else if (wanted === 'previous') {
    const draft = versions.findIndex((v) => v.draft)
    found = versions[(draft < 0 ? 0 : draft) + 1]
  } else found = versions.find((v) => v.id === wanted)
  if (found) return found
  throw new CliError(
    'not_found',
    VERSION_NAMES.includes(wanted as never)
      ? `"${history.page.name}" has no ${wanted === 'previous' ? 'version before its draft' : 'published version'}.`
      : `"${history.page.name}" has no version ${ref}.`,
    { hint: '`crombolo content history <page>` lists its versions.' },
  )
}

/** The one item in the bin a name, path or key means. */
export function pickBinItem(items: readonly BinItem[], ref: string): BinItem {
  const matches = binMatches(items, ref)
  if (matches.length === 1) return matches[0] as BinItem
  if (matches.length === 0)
    throw new CliError('not_found', `"${ref}" is not in the recycle bin.`, {
      hint: '`crombolo recycle-bin list` lists what is.',
    })
  throw new CliError('usage', `More than one item in the recycle bin is "${ref}".`, {
    hint: 'Name one by its key.',
    details: matches.map((m) => `${m.key}  ${m.kind}  ${m.name}, from ${m.from.path ?? '?'}`),
  })
}

/** An item that cannot go back where it was, refused, naming --to. */
export function refuseGonePlace(item: BinItem): void {
  const gone = placeGone(item)
  if (gone)
    throw new CliError('refused', `${gone} Nothing was restored.`, {
      hint: `Give it another place with --to: a ${item.kind === 'media' ? 'folder' : 'page'}, or ${TOP} for the top level.`,
    })
}

/** "3 hours ago", for people; `-o json` gives the date itself. */
export function ago(date: string | null, now = Date.now()): string {
  if (!date) return 'at a time not recorded'
  const seconds = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000))
  const steps: Array<[number, string]> = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [30, 'day'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ]
  let value = seconds
  for (const [size, unit] of steps) {
    if (value < size)
      return value <= 1 && unit === 'second'
        ? 'just now'
        : `${value} ${unit}${value === 1 ? '' : 's'} ago`
    value = Math.floor(value / size)
  }
  return 'long ago'
}

const DONE: Record<string, string> = {
  save: 'Saved',
  publish: 'Published',
  rollback: 'Rolled back',
  migrate: 'Upgraded',
}

/** "Saved by Ana, 3 hours ago". */
export function describeVersion(version: HistoryEntry, now = Date.now()): string {
  const who = version.by ? version.by.name : 'the command line or the site'
  return `${DONE[version.kind] ?? 'Saved'} by ${who}, ${ago(version.date, now)}`
}
