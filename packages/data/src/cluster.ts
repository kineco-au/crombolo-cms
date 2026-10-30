/**
 * Multi-node plumbing: node identity in `server`, and the polled
 * `cache_instruction` table that tells other nodes what changed.
 * docs/schema-as-code.md, "Cache coherence".
 */
import type { Db } from './database.ts'
import { DbDate } from './dialect.ts'
import { sql } from './query.ts'

/**
 * `views` is a code change, not a data one: a template was written, so every
 * node has to look at its views tree again. The other two invalidate the
 * published cache; this one makes a node take a new snapshot.
 */
export type CacheInstructionKind = 'schema' | 'content' | 'components'

export interface CacheInstruction {
  id: number
  kind: CacheInstructionKind
  payload: Record<string, unknown>
  createdBy: string | null
  /** The content checkpoint it moved to (story 174); null for a views instruction. */
  checkpoint: number | null
}

/**
 * What a media change touched (story 197), as a `content` instruction carries
 * it: `{ media: [keys], moved?: [paths] }`. `moved` holds the old paths
 * (`-1,1050`) of items that moved, so the items below them are dropped too.
 */
export interface MediaChangePayload {
  media: string[]
  moved?: string[]
}

/** What an instruction changes: the page snapshot, and the media cache. */
export interface InstructionEffects {
  pages: boolean
  media: 'keep' | 'clear' | { keys: string[]; moved: string[] }
}

/** Payload fields that change only what the page snapshot holds. */
const PAGE_ONLY = new Set(['key', 'redirects', 'domains', 'dictionary', 'elements', 'urls'])

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? (value as string[])
    : undefined

/**
 * What an instruction asks of a node's caches (story 197). A media change names
 * its items and leaves the pages alone; a page change leaves media alone; a
 * schema change, a bulk change such as an import, or anything not recognised
 * empties both, which is never wrong, only slower. Pure.
 */
export function instructionEffects(
  kind: CacheInstructionKind,
  payload: Record<string, unknown>,
): InstructionEffects {
  if (kind === 'components') return { pages: false, media: 'keep' }
  if (kind === 'schema') return { pages: true, media: 'clear' }
  const fields = Object.keys(payload)
  const keys = strings(payload.media)
  if (keys) {
    const pages = fields.some((field) => field !== 'media' && field !== 'moved')
    return { pages, media: { keys, moved: strings(payload.moved) ?? [] } }
  }
  if (payload.media === true)
    return { pages: fields.some((field) => field !== 'media'), media: 'clear' }
  const pagesOnly = fields.length > 0 && fields.every((field) => PAGE_ONLY.has(field))
  return { pages: true, media: pagesOnly ? 'keep' : 'clear' }
}

/** The instructions numbered after `after` up to `upTo`, in checkpoint order: what a node missed. */
export async function instructionsBetween(
  db: Db,
  after: number,
  upTo: number,
): Promise<CacheInstruction[]> {
  const rows = await db.q
    .selectFrom('cache_instruction')
    .select(INSTRUCTION_COLUMNS)
    .where('checkpoint', '>', after)
    .where('checkpoint', '<=', upTo)
    .orderBy('checkpoint')
    .execute()
  return rows.map(instructionOf)
}

/** Where Postgres says an instruction was written, so nodes poll now rather than on their timer. */
export const CACHE_INSTRUCTION_CHANNEL = 'crombolo_cache_instruction'

/** Where a node that leaves its jobs to a worker says it left work (story 223). */
export const JOBS_CHANNEL = 'crombolo_jobs'

/** What a write left for the jobs: the event outbox, the search queue, or a queued job. */
export type JobWake = 'events' | 'search' | 'jobs'

/** Tells a listening worker there is work; Postgres only, which a worker needs. */
export async function notifyJobs(db: Db, work: JobWake): Promise<void> {
  if (db.dialect.name !== 'postgres') return
  await db.q.selectNoFrom(sql`pg_notify(${JOBS_CHANNEL}, ${work})`.as('n')).execute()
}

/**
 * Tells the other nodes what changed. A `content` or `schema` instruction moves
 * the content checkpoint (story 174): called on the change's own transaction,
 * the checkpoint row stays locked until that commits, so no change can commit
 * later with a smaller number. Called outside one, it takes its own, after the
 * change it announces — never before it. Answers the checkpoint, or null for a
 * views instruction, which is not published content.
 */
export async function appendCacheInstruction(
  db: Db,
  instruction: { kind: CacheInstructionKind; payload?: Record<string, unknown>; by?: string },
): Promise<number | null> {
  return db.transaction(async (tx) => {
    const checkpoint = instruction.kind === 'components' ? null : await advanceCheckpoint(tx)
    await tx.q
      .insertInto('cache_instruction')
      .values({
        kind: instruction.kind,
        payload: JSON.stringify(instruction.payload ?? {}),
        created_at: DbDate.toDb(new Date()),
        created_by: instruction.by ?? null,
        checkpoint,
      })
      .execute()
    // Delivered at commit, so a write that rolls back wakes nobody.
    if (tx.dialect.name === 'postgres')
      await tx.q
        .selectNoFrom(sql`pg_notify(${CACHE_INSTRUCTION_CHANNEL}, ${instruction.kind})`.as('n'))
        .execute()
    return checkpoint
  })
}

/**
 * Moves the checkpoint on by one, holding its row until `tx` commits. An upsert,
 * so a row lost to a truncate is started again rather than silently not counted.
 */
async function advanceCheckpoint(tx: Db): Promise<number> {
  const row = await tx.q
    .insertInto('content_checkpoint')
    .values({ id: 1, n: 1 })
    .onConflict((oc) =>
      oc.column('id').doUpdateSet((eb) => ({ n: eb('content_checkpoint.n', '+', 1) })),
    )
    .returning('n')
    .executeTakeFirst()
  return Number(row?.n ?? 0)
}

/**
 * Waits until `db` has committed at least `checkpoint`, looking every
 * `everyMs`, and answers whether it got there before `timeoutMs` ran out. For a
 * reader that may lag — a replica (story 121) — to catch up to the change it
 * was told of, or for its caller to fall back to the primary.
 */
export async function waitForCheckpoint(
  db: Db,
  checkpoint: number,
  timeoutMs: number,
  everyMs = 100,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if ((await latestCheckpoint(db)) >= checkpoint) return true
    if (Date.now() >= deadline) return false
    await Bun.sleep(Math.min(everyMs, Math.max(0, deadline - Date.now())))
  }
}

/** When the first change after `checkpoint` was recorded: how long a node serving it has been behind. */
export async function changedSince(db: Db, checkpoint: number): Promise<Date | undefined> {
  const row = await db.q
    .selectFrom('cache_instruction')
    .select((eb) => eb.fn.min('created_at').as('at'))
    .where('checkpoint', '>', checkpoint)
    .executeTakeFirst()
  return DbDate.fromDb(row?.at) ?? undefined
}

/** The latest committed checkpoint: every change numbered at or below it has committed. */
export async function latestCheckpoint(db: Db): Promise<number> {
  const row = await db.q
    .selectFrom('content_checkpoint')
    .select('n')
    .where('id', '=', 1)
    .executeTakeFirst()
  return Number(row?.n ?? 0)
}

/**
 * Deletes instructions older than `before`, keeping the newest, whose id a
 * starting node reads its position from. Every node starts from there, so
 * nothing older is ever read again.
 */
export async function pruneCacheInstructions(db: Db, before: Date): Promise<number> {
  const rows = await db.q
    .deleteFrom('cache_instruction')
    .where('created_at', '<', DbDate.toDb(before))
    .where('id', '<', (eb) => eb.selectFrom('cache_instruction').select(eb.fn.max('id').as('max')))
    .returning('id')
    .execute()
  return rows.length
}

/** The highest instruction id, so a fresh node ignores history. */
export async function latestCacheInstructionId(db: Db): Promise<number> {
  const row = await db.q
    .selectFrom('cache_instruction')
    .select((eb) => eb.fn.max('id').as('n'))
    .executeTakeFirst()
  return Number(row?.n ?? 0)
}

export async function cacheInstructionsAfter(db: Db, afterId: number): Promise<CacheInstruction[]> {
  const rows = await db.q
    .selectFrom('cache_instruction')
    .select(INSTRUCTION_COLUMNS)
    .where('id', '>', afterId)
    .orderBy('id')
    .execute()
  return rows.map(instructionOf)
}

const INSTRUCTION_COLUMNS = ['id', 'kind', 'payload', 'created_by', 'checkpoint'] as const

const instructionOf = (row: Record<string, unknown>): CacheInstruction => ({
  id: Number(row.id),
  kind: String(row.kind) as CacheInstructionKind,
  payload: row.payload ? (JSON.parse(String(row.payload)) as Record<string, unknown>) : {},
  createdBy: (row.created_by as string | null) ?? null,
  checkpoint:
    row.checkpoint === null || row.checkpoint === undefined ? null : Number(row.checkpoint),
})

export interface ServerIdentity {
  nodeId: string
  version: string
  revision: string
  /** `all`, `api` or `web`: what this node serves, so the cluster can be read back by role. */
  role?: string
  /** The Crombolo release this node runs; `version` is the schema set's. */
  cromboloVersion?: string
  /** The content checkpoint its published cache serves, and when it was built (story 174). */
  served?: { checkpoint: number; at: Date }
}

/** Records this node in `server`; called at boot and on each poll. */
export async function touchServer(db: Db, identity: ServerIdentity): Promise<void> {
  const now = DbDate.toDb(new Date())
  const role = identity.role ?? null
  const crombolo = identity.cromboloVersion ?? null
  const existing = await db.q
    .selectFrom('server')
    .select('node_id')
    .where('node_id', '=', identity.nodeId)
    .executeTakeFirst()
  const served = identity.served?.checkpoint ?? null
  const servedAt = identity.served ? DbDate.toDb(identity.served.at) : null
  if (existing) {
    await db.q
      .updateTable('server')
      .set({
        version: identity.version,
        revision: identity.revision,
        role,
        crombolo_version: crombolo,
        last_seen: now,
        served_checkpoint: sql<number>`coalesce(${served}, ${sql.ref('served_checkpoint')})`,
        served_at: sql<string>`coalesce(${servedAt}, ${sql.ref('served_at')})`,
      })
      .where('node_id', '=', identity.nodeId)
      .execute()
  } else {
    await db.q
      .insertInto('server')
      .values({
        node_id: identity.nodeId,
        version: identity.version,
        revision: identity.revision,
        role,
        crombolo_version: crombolo,
        last_seen: now,
        served_checkpoint: served,
        served_at: servedAt,
      })
      .execute()
  }
}

export interface LiveNode {
  nodeId: string
  /** Null for a row written before roles were recorded. */
  role: string | null
  version: string | null
  revision: string | null
  /** Null for a row written before node releases were recorded. */
  cromboloVersion: string | null
  lastSeen: Date
  /** The checkpoint it last reported serving, and when that snapshot was built; null before. */
  servedCheckpoint: number | null
  servedAt: Date | null
}

/** The nodes that have polled within `seenWithinMs`: the cluster as it stands. */
export async function liveNodes(db: Db, options: { seenWithinMs: number }): Promise<LiveNode[]> {
  const rows = await db.q
    .selectFrom('server')
    .select([
      'node_id',
      'role',
      'version',
      'revision',
      'crombolo_version',
      'last_seen',
      'served_checkpoint',
      'served_at',
    ])
    .where('last_seen', '>=', DbDate.toDb(new Date(Date.now() - options.seenWithinMs)))
    .orderBy('node_id')
    .execute()
  return rows.map((row) => ({
    nodeId: String(row.node_id),
    role: (row.role as string | null) ?? null,
    version: (row.version as string | null) ?? null,
    revision: (row.revision as string | null) ?? null,
    cromboloVersion: (row.crombolo_version as string | null) ?? null,
    lastSeen: DbDate.fromDb(row.last_seen) as Date,
    servedCheckpoint:
      row.served_checkpoint === null || row.served_checkpoint === undefined
        ? null
        : Number(row.served_checkpoint),
    servedAt: DbDate.fromDb(row.served_at) ?? null,
  }))
}
