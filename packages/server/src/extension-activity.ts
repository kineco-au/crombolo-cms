/**
 * The extension activity recorder (story 327): every place that already knows
 * what an extension's call is records it here, and rows are written in
 * batches, a second apart or two hundred at a time. Reads of one kind, for one
 * person, in one minute, fold into one row. A crash loses at most a second of
 * activity; the audit log still has every write the API made.
 */
import {
  ACTIVITY_KINDS,
  type ActivityFilter,
  type ActivityInput,
  type ActivityKind,
  type ActivityOutcome,
  type Db,
  ExtensionActivityLog,
} from '@crombolo/data'
import type { BundleCaller } from './bundles.ts'
import { logger } from './logging.ts'

const log = logger('Activity')

/** Whom an extension acted for, as a row names them. */
export interface ActivityPerson {
  personKey: string | null
  personName: string | null
}

/** What one call was, as a recording point knows it. */
export interface ActivityEvent extends ActivityPerson {
  extensionId: string
  kind: ActivityKind
  area: string | null
  verb?: string | null
  entityKey?: string | null
  count?: number
  outcome: ActivityOutcome
  ms?: number | null
}

export interface ActivityRecorder {
  record(event: ActivityEvent): void
  flush(): Promise<void>
  stop(): Promise<void>
}

/** The person a caller is: a back-office user, a member by name, or nobody. */
export function personOf(caller: BundleCaller | undefined): ActivityPerson {
  if (caller?.kind === 'backoffice')
    return { personKey: caller.principal.id, personName: caller.principal.name }
  if (caller?.kind === 'member')
    return { personKey: null, personName: `member ${caller.member.username}` }
  return { personKey: null, personName: null }
}

/** Times a call and records it, whether it answers, throws, or answers a promise. */
export function timed<T>(
  recorder: ActivityRecorder | undefined,
  event: Omit<ActivityEvent, 'outcome' | 'ms'>,
  call: () => T,
  outcomeOf: (error: unknown) => ActivityOutcome = () => 'failed',
): T {
  if (!recorder) return call()
  const started = performance.now()
  const done = (outcome: ActivityOutcome) =>
    recorder.record({ ...event, outcome, ms: performance.now() - started })
  try {
    const result = call()
    if (result instanceof Promise)
      return result.then(
        (value) => {
          done('ok')
          return value
        },
        (error: unknown) => {
          done(outcomeOf(error))
          throw error
        },
      ) as T
    done('ok')
    return result
  } catch (error) {
    done(outcomeOf(error))
    throw error
  }
}

export function createActivityRecorder(
  /** The database, or how to reach it once it is open: extensions start before it is. */
  db: Db | (() => Db),
  options: { flushMs?: number; batch?: number } = {},
): ActivityRecorder {
  let opened: ExtensionActivityLog | undefined
  const store = () => (opened ??= new ExtensionActivityLog(typeof db === 'function' ? db() : db))
  const batch = options.batch ?? 200
  let queued: ActivityInput[] = []
  /** This minute's reads, by extension, person, area and verb. */
  const reads = new Map<string, ActivityInput>()
  let writing: Promise<void> = Promise.resolve()

  const minute = (at: Date) => new Date(Math.floor(at.getTime() / 60_000) * 60_000)

  const flush = async () => {
    const rows = [...queued, ...reads.values()]
    queued = []
    reads.clear()
    if (rows.length === 0) return writing
    writing = writing
      .then(() => store().record(rows))
      .catch((error: unknown) => {
        log.warning('Could not keep {count} rows of extension activity: {error}', {
          count: rows.length,
          error,
        })
      })
    return writing
  }

  const timer = setInterval(() => void flush(), options.flushMs ?? 1000)
  ;(timer as { unref?: () => void }).unref?.()

  return {
    record(event) {
      const row: ActivityInput = {
        extensionId: event.extensionId,
        personKey: event.personKey,
        personName: event.personName,
        kind: event.kind,
        area: event.area,
        verb: event.verb ?? null,
        entityKey: event.entityKey ?? null,
        count: event.count ?? 1,
        outcome: event.outcome,
        ms: event.ms ?? null,
        occurredAt: new Date(),
      }
      if (row.kind === 'read' && row.outcome === 'ok') {
        const at = minute(row.occurredAt)
        const key = [
          row.extensionId,
          row.personKey ?? '',
          row.area ?? '',
          row.verb ?? '',
          at.getTime(),
        ].join('\u0000')
        const held = reads.get(key)
        if (held) {
          held.count += row.count
          held.ms = (held.ms ?? 0) + (row.ms ?? 0)
        } else reads.set(key, { ...row, entityKey: null, occurredAt: at })
        return
      }
      queued.push(row)
      if (queued.length >= batch) void flush()
    },
    flush,
    async stop() {
      clearInterval(timer)
      await flush()
    },
  }
}

/**
 * A page of activity as the Activity view asks for it: `before` and `limit`
 * (1–500, default 100), and the filters `kind`, `person`, `since` and `until`.
 * Answers the reason when the query is not one.
 */
export function readActivityQuery(
  search: URLSearchParams,
): { filter: ActivityFilter; cursor: { before?: number; limit: number } } | string {
  const limit = Number(search.get('limit') ?? 100)
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    return 'limit must be between 1 and 500.'
  const raw = search.get('before')
  const before = raw === null ? undefined : Number(raw)
  if (before !== undefined && (!Number.isInteger(before) || before < 0))
    return 'before must be an entry id.'
  const kind = search.get('kind') ?? undefined
  if (kind && !ACTIVITY_KINDS.includes(kind as ActivityKind)) return `There is no kind "${kind}".`
  const date = (name: string) => {
    const value = search.get(name)
    if (!value) return undefined
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const since = date('since')
  const until = date('until')
  if (since === null || until === null) return 'since and until must be dates.'
  return {
    filter: {
      ...(kind ? { kind: kind as ActivityKind } : {}),
      ...(search.get('person') ? { person: search.get('person') as string } : {}),
      ...(since ? { since } : {}),
      ...(until ? { until } : {}),
    },
    cursor: { ...(before !== undefined ? { before } : {}), limit },
  }
}

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value)
  // A cell a spreadsheet would read as a formula is kept as text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** All of an extension's activity the filter matches, as a CSV file, newest first. */
export async function activityCsv(
  store: ExtensionActivityLog,
  extensionId: string,
  filter: ActivityFilter,
): Promise<string> {
  const lines = ['when,person,kind,area,verb,item,count,outcome,ms']
  let before: number | undefined
  for (;;) {
    const page = await store.page(extensionId, filter, { before, limit: 500 })
    for (const row of page.items)
      lines.push(
        [
          row.occurredAt.toISOString(),
          row.personName ?? 'itself',
          row.kind,
          row.area,
          row.verb,
          row.entityKey,
          row.count,
          row.outcome,
          row.ms,
        ]
          .map(csvCell)
          .join(','),
      )
    if (page.next === null) break
    before = page.next
  }
  return `${lines.join('\n')}\n`
}
