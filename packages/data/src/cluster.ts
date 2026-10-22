/**
 * Multi-node plumbing: node identity in `server`, and the polled
 * `cache_instruction` table that tells other nodes what changed.
 * docs/schema-as-code.md, "Cache coherence".
 */
import type { Db } from './database.ts'
import { DbDate } from './dialect.ts'

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

/** Where Postgres says an instruction was written, so nodes poll now rather than on their timer. */
export const CACHE_INSTRUCTION_CHANNEL = 'crombolo_cache_instruction'

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
    await tx.exec(
      'INSERT INTO cache_instruction (kind, payload, created_at, created_by, checkpoint) VALUES (?, ?, ?, ?, ?)',
      [
        instruction.kind,
        JSON.stringify(instruction.payload ?? {}),
        DbDate.toDb(new Date()),
        instruction.by ?? null,
        checkpoint,
      ],
    )
    // Delivered at commit, so a write that rolls back wakes nobody.
    if (tx.dialect.name === 'postgres')
      await tx.exec('SELECT pg_notify(?, ?)', [CACHE_INSTRUCTION_CHANNEL, instruction.kind])
    return checkpoint
  })
}

/**
 * Moves the checkpoint on by one, holding its row until `tx` commits. An upsert,
 * so a row lost to a truncate is started again rather than silently not counted.
 */
async function advanceCheckpoint(tx: Db): Promise<number> {
  const rows = await tx.query<{ n: unknown }>(
    `INSERT INTO content_checkpoint (id, n) VALUES (1, 1)
       ON CONFLICT (id) DO UPDATE SET n = content_checkpoint.n + 1 RETURNING n`,
  )
  return Number(rows[0]?.n ?? 0)
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
  const rows = await db.query<{ at: unknown }>(
    'SELECT MIN(created_at) AS at FROM cache_instruction WHERE checkpoint > ?',
    [checkpoint],
  )
  return DbDate.fromDb(rows[0]?.at) ?? undefined
}

/** The latest committed checkpoint: every change numbered at or below it has committed. */
export async function latestCheckpoint(db: Db): Promise<number> {
  const rows = await db.query<{ n: unknown }>('SELECT n FROM content_checkpoint WHERE id = 1')
  return Number(rows[0]?.n ?? 0)
}

/**
 * Deletes instructions older than `before`, keeping the newest, whose id a
 * starting node reads its position from. Every node starts from there, so
 * nothing older is ever read again.
 */
export async function pruneCacheInstructions(db: Db, before: Date): Promise<number> {
  const rows = await db.query(
    `DELETE FROM cache_instruction WHERE created_at < ?
       AND id < (SELECT MAX(id) FROM cache_instruction) RETURNING id`,
    [DbDate.toDb(before)],
  )
  return rows.length
}

/** The highest instruction id, so a fresh node ignores history. */
export async function latestCacheInstructionId(db: Db): Promise<number> {
  const rows = await db.query<{ n: number | null }>('SELECT MAX(id) AS n FROM cache_instruction')
  return Number(rows[0]?.n ?? 0)
}

export async function cacheInstructionsAfter(db: Db, afterId: number): Promise<CacheInstruction[]> {
  const rows = await db.query(
    'SELECT id, kind, payload, created_by, checkpoint FROM cache_instruction WHERE id > ? ORDER BY id',
    [afterId],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    kind: String(row.kind) as CacheInstructionKind,
    payload: row.payload ? (JSON.parse(String(row.payload)) as Record<string, unknown>) : {},
    createdBy: (row.created_by as string | null) ?? null,
    checkpoint:
      row.checkpoint === null || row.checkpoint === undefined ? null : Number(row.checkpoint),
  }))
}

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
  const existing = await db.query<{ node_id: string }>(
    'SELECT node_id FROM server WHERE node_id = ?',
    [identity.nodeId],
  )
  const served = identity.served?.checkpoint ?? null
  const servedAt = identity.served ? DbDate.toDb(identity.served.at) : null
  if (existing[0]) {
    await db.exec(
      `UPDATE server SET version = ?, revision = ?, role = ?, crombolo_version = ?, last_seen = ?,
         served_checkpoint = COALESCE(?, served_checkpoint), served_at = COALESCE(?, served_at)
       WHERE node_id = ?`,
      [identity.version, identity.revision, role, crombolo, now, served, servedAt, identity.nodeId],
    )
  } else {
    await db.exec(
      `INSERT INTO server (node_id, version, revision, role, crombolo_version, last_seen,
         served_checkpoint, served_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [identity.nodeId, identity.version, identity.revision, role, crombolo, now, served, servedAt],
    )
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
  const rows = await db.query(
    `SELECT node_id, role, version, revision, crombolo_version, last_seen, served_checkpoint, served_at
       FROM server WHERE last_seen >= ? ORDER BY node_id`,
    [DbDate.toDb(new Date(Date.now() - options.seenWithinMs))],
  )
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
