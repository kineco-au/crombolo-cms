/**
 * Pulls and pushes through the remote protocol (story 107): one row per job,
 * read by whichever node a client polls, written by the node running it.
 */
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'
import type { Updateable } from '../query.ts'
import type { CoreTables } from '../tables.gen.ts'

export type RemoteJobKind = 'pull' | 'push'
export type RemoteJobState =
  | 'queued'
  | 'running'
  | 'approval-required'
  | 'done'
  | 'failed'
  | 'refused'

export interface RemoteJob {
  id: string
  kind: RemoteJobKind
  environment: string
  requestedBy: string
  requestedByName: string
  options: Record<string, unknown>
  state: RemoteJobState
  stage: string | null
  progress: number | null
  fileKey: string | null
  fileSize: number | null
  sha256: string | null
  problem: { code: string; title: string; detail?: string; items?: string[] } | null
  secret: string | null
  runId: string | null
  decidedBy: string | null
  decidedAt: Date | undefined
  heartbeatAt: Date
  expiresAt: Date
  createdAt: Date
}

const parse = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || value === '') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function mapJob(row: Record<string, unknown>): RemoteJob {
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v))
  return {
    id: String(row.id),
    kind: String(row.kind) as RemoteJobKind,
    environment: String(row.environment),
    requestedBy: String(row.requested_by),
    requestedByName: String(row.requested_by_name),
    options: parse(row.options, {}),
    state: String(row.state) as RemoteJobState,
    stage: str(row.stage),
    progress: row.progress === null || row.progress === undefined ? null : Number(row.progress),
    fileKey: str(row.file_key),
    fileSize: row.file_size === null || row.file_size === undefined ? null : Number(row.file_size),
    sha256: str(row.sha256),
    problem: parse(row.problem, null),
    secret: str(row.secret),
    runId: str(row.run_id),
    decidedBy: str(row.decided_by),
    decidedAt: DbDate.fromDb(row.decided_at),
    heartbeatAt: DbDate.fromDb(row.heartbeat_at) ?? new Date(0),
    expiresAt: DbDate.fromDb(row.expires_at) ?? new Date(0),
    createdAt: DbDate.fromDb(row.create_date) ?? new Date(0),
  }
}

export type RemoteJobUpdate = Partial<
  Pick<
    RemoteJob,
    | 'state'
    | 'stage'
    | 'progress'
    | 'fileKey'
    | 'fileSize'
    | 'sha256'
    | 'problem'
    | 'secret'
    | 'runId'
    | 'decidedBy'
    | 'decidedAt'
    | 'expiresAt'
  >
>

const COLUMNS: Record<keyof RemoteJobUpdate, keyof CoreTables['remote_job']> = {
  state: 'state',
  stage: 'stage',
  progress: 'progress',
  fileKey: 'file_key',
  fileSize: 'file_size',
  sha256: 'sha256',
  problem: 'problem',
  secret: 'secret',
  runId: 'run_id',
  decidedBy: 'decided_by',
  decidedAt: 'decided_at',
  expiresAt: 'expires_at',
}

export class RemoteJobRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async create(job: {
    id: string
    kind: RemoteJobKind
    environment: string
    requestedBy: string
    requestedByName: string
    options: Record<string, unknown>
    state: RemoteJobState
    expiresAt: Date
  }): Promise<void> {
    const now = DbDate.toDb(new Date())
    await this.#db.q
      .insertInto('remote_job')
      .values({
        id: job.id,
        kind: job.kind,
        environment: job.environment,
        requested_by: job.requestedBy,
        requested_by_name: job.requestedByName,
        options: JSON.stringify(job.options),
        state: job.state,
        heartbeat_at: now,
        expires_at: DbDate.toDb(job.expiresAt),
        create_date: now,
      })
      .execute()
  }

  async get(id: string): Promise<RemoteJob | undefined> {
    const row = await this.#db.q
      .selectFrom('remote_job')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? mapJob(row) : undefined
  }

  /** Records progress, and that the node running it is still alive. */
  async update(id: string, change: RemoteJobUpdate): Promise<void> {
    const sets: Record<string, unknown> = { heartbeat_at: DbDate.toDb(new Date()) }
    for (const [field, value] of Object.entries(change) as [keyof RemoteJobUpdate, unknown][]) {
      sets[COLUMNS[field]] =
        field === 'problem'
          ? value === null
            ? null
            : JSON.stringify(value)
          : value instanceof Date
            ? DbDate.toDb(value)
            : (value ?? null)
    }
    await this.#db.q
      .updateTable('remote_job')
      .set(sets as Updateable<CoreTables['remote_job']>)
      .where('id', '=', id)
      .execute()
  }

  /** Moves a job from one state to another only if it is still in the first; true when it moved. */
  async transition(id: string, from: RemoteJobState, change: RemoteJobUpdate): Promise<boolean> {
    const rows = await this.#db.q
      .updateTable('remote_job')
      .set({ state: change.state ?? from, heartbeat_at: DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .where('state', '=', from)
      .returning('id')
      .execute()
    if (rows.length === 0) return false
    await this.update(id, change)
    return true
  }

  /** Jobs past their expiry, whose files are to be swept. */
  async expired(now = new Date()): Promise<RemoteJob[]> {
    const rows = await this.#db.q
      .selectFrom('remote_job')
      .selectAll()
      .where('expires_at', '<', DbDate.toDb(now))
      .execute()
    return rows.map(mapJob)
  }

  async delete(id: string): Promise<void> {
    await this.#db.q.deleteFrom('remote_job').where('id', '=', id).execute()
  }
}
