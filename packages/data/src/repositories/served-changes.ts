/**
 * What the served copy of a site holds (story 395): each change a host reports
 * applying there, kept as a set, since pages go out at once and a release later.
 * And the history of the site's schema and code files, change by change, that
 * says what of it the served copy has.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

/** One version of a file, as a change left it. */
export interface FileVersion {
  path: string
  changeKey: string
  changeName: string | null
  startedAt: Date
  /** Whether the change made the file, rather than changed or removed it. */
  made: boolean
  removed: boolean
  afterHash: string | null
}

export class ServedChangeRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /** Records that the served copy holds a change; reporting it again changes nothing. */
  async report(key: string, by: string | null, now = new Date()): Promise<void> {
    const changeKey = normaliseUuid(key)
    const found = await this.#db.q
      .selectFrom('served_change')
      .select('change_key')
      .where('change_key', '=', changeKey)
      .execute()
    if (found.length > 0) return
    await this.#db.q
      .insertInto('served_change')
      .values({ change_key: changeKey, reported_by: by, reported_at: DbDate.toDb(now) })
      .execute()
  }

  async keys(): Promise<Set<string>> {
    const rows = await this.#db.q.selectFrom('served_change').select('change_key').execute()
    return new Set(rows.map((r) => String(r.change_key)))
  }

  /** The newest change reported, by when it was made here. */
  async newest(): Promise<{ key: string; name: string | null; reportedAt: Date } | undefined> {
    const row = await this.#db.q
      .selectFrom('served_change as s')
      .innerJoin('content_transfer_run as r', 'r.change_key', 's.change_key')
      .select(['s.change_key', 'r.name', 'r.bundle_label', 's.reported_at'])
      .orderBy('r.started_at', 'desc')
      .limit(1)
      .executeTakeFirst()
    if (!row) return undefined
    return {
      key: String(row.change_key),
      name: (row.name as string | null) ?? (row.bundle_label as string | null) ?? null,
      reportedAt: DbDate.fromDb(row.reported_at) ?? new Date(0),
    }
  }

  /** When the oldest reported change was made here: what came before it, the served copy had. */
  async since(): Promise<Date | undefined> {
    const row = await this.#db.q
      .selectFrom('served_change as s')
      .innerJoin('content_transfer_run as r', 'r.change_key', 's.change_key')
      .select('r.started_at')
      .orderBy('r.started_at')
      .limit(1)
      .executeTakeFirst()
    return row ? (DbDate.fromDb(row.started_at) ?? undefined) : undefined
  }

  /** A fingerprint that moves whenever a report or a file's change is recorded. */
  async revision(): Promise<string> {
    const [reports] = await this.#db.q
      .selectFrom('served_change')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .execute()
    const [items] = await this.#db.q
      .selectFrom('change_item')
      .select((eb) => [eb.fn.max('id').as('top'), eb.fn.countAll<number>().as('n')])
      .execute()
    return `${reports?.n ?? 0}:${items?.top ?? 0}:${items?.n ?? 0}`
  }

  /** Every version of the files under these prefixes, oldest first. */
  async fileVersions(prefixes: readonly string[]): Promise<FileVersion[]> {
    if (prefixes.length === 0) return []
    const rows = await this.#db.q
      .selectFrom('change_item as i')
      .innerJoin('content_transfer_run as r', 'r.id', 'i.run_id')
      .select([
        'i.path',
        'i.before_hash',
        'i.after_hash',
        'r.change_key',
        'r.bundle_id',
        'r.name',
        'r.bundle_label',
        'r.started_at',
      ])
      .where((eb) => eb.or(prefixes.map((p) => eb('i.path', 'like', `${p}%`))))
      .where('r.status', '=', 'applied')
      .orderBy('r.started_at')
      .orderBy('i.id')
      .execute()
    return rows.map((r) => ({
      path: String(r.path),
      changeKey: String(r.change_key ?? r.bundle_id),
      changeName: (r.name as string | null) ?? (r.bundle_label as string | null) ?? null,
      startedAt: DbDate.fromDb(r.started_at) ?? new Date(0),
      made: r.before_hash === null,
      removed: r.after_hash === null,
      afterHash: (r.after_hash as string | null) ?? null,
    }))
  }

  /** The texts of files by their hashes. */
  async texts(hashes: readonly string[]): Promise<Map<string, string>> {
    const wanted = [...new Set(hashes)]
    if (wanted.length === 0) return new Map()
    const rows = await this.#db.q
      .selectFrom('file_blob')
      .select(['hash', 'text'])
      .where('hash', 'in', wanted)
      .execute()
    return new Map(rows.map((r) => [String(r.hash), String(r.text)]))
  }
}

/** A notice a host left for someone in the back office (story 395). */
export interface BackofficeNotice {
  id: number
  kind: 'success' | 'failure'
  message: string
  link: string | null
  createdAt: Date
}

/** How long a notice waits to be seen. */
export const NOTICE_KEPT_MS = 30 * 24 * 3600_000

export class BackofficeNoticeRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async add(notice: {
    userKey: string
    kind: 'success' | 'failure'
    message: string
    link: string | null
    now?: Date
  }): Promise<number> {
    const row = await this.#db.q
      .insertInto('backoffice_notice')
      .values({
        user_key: normaliseUuid(notice.userKey),
        kind: notice.kind,
        message: notice.message,
        link: notice.link,
        created_at: DbDate.toDb(notice.now ?? new Date()),
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return Number(row.id)
  }

  /** The person's notices not yet seen, oldest first, marked seen as they are taken. */
  async take(userKey: string, now = new Date()): Promise<BackofficeNotice[]> {
    const user = normaliseUuid(userKey)
    const cutoff = DbDate.toDb(new Date(now.getTime() - NOTICE_KEPT_MS))
    await this.#db.q
      .deleteFrom('backoffice_notice')
      .where('seen_at', 'is', null)
      .where('created_at', '<', cutoff)
      .execute()
    const rows = await this.#db.q
      .selectFrom('backoffice_notice')
      .select(['id', 'kind', 'message', 'link', 'created_at'])
      .where('user_key', '=', user)
      .where('seen_at', 'is', null)
      .orderBy('id')
      .execute()
    if (rows.length === 0) return []
    await this.#db.q
      .updateTable('backoffice_notice')
      .set({ seen_at: DbDate.toDb(now) })
      .where(
        'id',
        'in',
        rows.map((r) => Number(r.id)),
      )
      .execute()
    return rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind === 'failure' ? 'failure' : 'success',
      message: String(r.message),
      link: (r.link as string | null) ?? null,
      createdAt: DbDate.fromDb(r.created_at) ?? now,
    }))
  }
}
