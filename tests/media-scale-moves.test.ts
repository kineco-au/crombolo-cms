/**
 * Story 246, moves and the recycle bin at scale: a generated folder (20,000 items
 * unless CROMBOLO_MEDIA_SCALE_ITEMS says otherwise) moved, trashed, restored and
 * deleted for good, each in a number of statements that does not grow with the
 * folder. Timings are printed, not asserted: `docs/testing.md`, "Media at scale".
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createMediaOperations,
  EMPTY_BIN_CHUNK,
  MEDIA_JOBS,
  mediaJobHandlers,
  systemActor,
} from '@crombolo/content'
import { ObjectTypes, SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import { type Db, queryFor } from '@crombolo/data'
import { createMediaEventSink } from '../packages/server/src/content-events.ts'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, V1 } from './support/harness.ts'
import { type GeneratedLibrary, generateMediaLibrary } from './support/media-library.ts'

const ITEMS = Number(Bun.env.CROMBOLO_MEDIA_SCALE_ITEMS ?? 20_000)
/** However large the folder: a move, a trash or an empty takes no more statements than this. */
const BOUNDED = 200

let h: Harness
let root: string
let library: GeneratedLibrary

/** `db`, counting every statement made on it and inside its transactions. */
function counted(db: Db, seen: string[]): Db {
  return {
    ...db,
    get q() {
      return queryFor(this)
    },
    query: (sql, params) => {
      seen.push(sql)
      return db.query(sql, params)
    },
    exec: (sql, params) => {
      seen.push(sql)
      return db.exec(sql, params)
    },
    transaction: (fn) => db.transaction((tx) => fn(counted(tx, seen))),
    readSnapshot: (fn) => db.readSnapshot(fn),
  }
}

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now()
  const result = await run()
  console.log(
    `  ${label} (${ITEMS.toLocaleString('en')} items, ${dialectUnderTest}): ${Math.round(performance.now() - started)} ms`,
  )
  return result
}

const removed: string[] = []
const operationsOn = (db: Db) =>
  createMediaOperations({
    db,
    repository: { nodeState: h.server.schema.nodeState },
    events: createMediaEventSink({}),
    files: { remove: async (path) => void removed.push(path) },
  })

const countWhere = async (pathLike: string, trashed?: boolean) => {
  const rows = await h.server.db.q
    .selectFrom('node')
    .select((eb) => eb.fn.countAll().as('n'))
    .where('node_object_type', '=', ObjectTypes.Media)
    .where('path', 'like', pathLike)
    .$if(trashed !== undefined, (q) =>
      q.where('trashed', '=', h.server.db.dialect.boolValue(trashed as boolean) as boolean),
    )
    .execute()
  return Number(rows[0]?.n ?? 0)
}

beforeAll(async () => {
  root = mkdtempSync(join(process.cwd(), 'output', 'media-scale-moves-'))
  mkdirSync(join(root, 'schema'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  h = await signedInServer({
    config: { schemaDir: join(root, 'schema'), mediaDir: join(root, 'media') },
  })
  library = await generateMediaLibrary(h.server.db, ITEMS, { nodeState: h.server.schema.nodeState })
}, 600_000)

afterAll(async () => {
  await h?.db.close()
  if (root) rmSync(root, { recursive: true, force: true })
})

describe(`moving and binning a folder of ${ITEMS.toLocaleString('en')} items (${dialectUnderTest})`, () => {
  let target: string

  test('a move rewrites the branch in a bounded number of statements, paths and levels true', async () => {
    const made = await operationsOn(h.server.db).create(systemActor('setup'), {
      key: crypto.randomUUID(),
      contentTypeKey: SYSTEM_MEDIA_TYPE_KEYS.Folder,
      parentKey: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Archive' }],
    })
    if (!made.ok) throw new Error(made.reason)
    target = made.key
    const seen: string[] = []
    const moved = await timed('move', () =>
      operationsOn(counted(h.server.db, seen)).moveMany(
        systemActor('setup'),
        [library.folder.key],
        target,
      ),
    )
    expect(moved.ok).toBe(true)
    expect(seen.length).toBeLessThan(BOUNDED)
    const folder = await h.server.db.q
      .selectFrom('node')
      .select(['path', 'level'])
      .where('unique_id', '=', library.folder.key)
      .executeTakeFirstOrThrow()
    expect(String(folder.path)).toMatch(/^-1,\d+,\d+$/)
    expect(Number(folder.level)).toBe(2)
    expect(await countWhere(`${folder.path},%`)).toBeGreaterThanOrEqual(ITEMS)
    const levels = await h.server.db.q
      .selectFrom('node')
      .select('level')
      .distinct()
      .where('path', 'like', `${folder.path},%`)
      .execute()
    expect(levels.map((row) => Number(row.level))).toEqual([3])
  }, 600_000)

  test('trashing and restoring it are bounded too', async () => {
    const trashedSeen: string[] = []
    const trashed = await timed('trash', () =>
      operationsOn(counted(h.server.db, trashedSeen)).trash(
        systemActor('setup'),
        library.folder.key,
      ),
    )
    expect(trashed.ok).toBe(true)
    expect(trashedSeen.length).toBeLessThan(BOUNDED + Math.ceil(ITEMS / 500))
    const binned = await h.server.db.q
      .selectFrom('node')
      .select('path')
      .where('unique_id', '=', library.folder.key)
      .executeTakeFirstOrThrow()
    expect(await countWhere(`${binned.path},%`, true)).toBeGreaterThanOrEqual(ITEMS)

    const restoredSeen: string[] = []
    const restored = await timed('restore', () =>
      operationsOn(counted(h.server.db, restoredSeen)).restore(
        systemActor('setup'),
        library.folder.key,
        target,
      ),
    )
    expect(restored.ok).toBe(true)
    expect(restoredSeen.length).toBeLessThan(BOUNDED)
    expect(await countWhere(`%`, true)).toBe(0)
  }, 600_000)

  test('emptying the bin deletes the branch and its files a chunk at a time', async () => {
    const operations = operationsOn(h.server.db)
    expect((await operations.trash(systemActor('setup'), library.folder.key)).ok).toBe(true)
    const seen: string[] = []
    removed.length = 0
    // As the background job empties a large bin: a chunk per transaction.
    const emptied = await timed('empty bin, in chunks', () =>
      operationsOn(counted(h.server.db, seen)).emptyBin(systemActor('setup'), {
        inline: true,
        progress: async () => {},
      }),
    )
    expect(emptied.ok).toBe(true)
    expect(seen.length).toBeLessThan(BOUNDED + Math.ceil(ITEMS / EMPTY_BIN_CHUNK) * 40)
    expect(removed.length).toBeGreaterThanOrEqual(ITEMS)
    expect(await countWhere('%', true)).toBe(0)
    const left = await h.server.db.q
      .selectFrom('content_version')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('node_id', 'not in', (eb) => eb.selectFrom('node').select('id'))
      .execute()
    expect(Number(left[0]?.n)).toBe(0)
  }, 600_000)
})

describe(`a large branch is written by a background job (${dialectUnderTest})`, () => {
  test('past the threshold, trash and emptying are queued, and the job does them in chunks', async () => {
    const queued: Array<{ name: string; payload: unknown }> = []
    const operations = createMediaOperations({
      db: h.server.db,
      repository: { nodeState: h.server.schema.nodeState },
      events: createMediaEventSink({}),
      files: { remove: async (path) => void removed.push(path) },
      largeBranch: 10,
      background: () => ({
        enqueue: async (name, payload) => {
          queued.push({ name, payload })
          return `job-${queued.length}`
        },
      }),
    })
    const folder = await operations.create(systemActor('setup'), {
      key: crypto.randomUUID(),
      contentTypeKey: SYSTEM_MEDIA_TYPE_KEYS.Folder,
      parentKey: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Batch' }],
    })
    if (!folder.ok) throw new Error(folder.reason)
    for (let n = 0; n < 12; n++) {
      const made = await operations.create(systemActor('setup'), {
        key: crypto.randomUUID(),
        contentTypeKey: SYSTEM_MEDIA_TYPE_KEYS.Folder,
        parentKey: folder.key,
        values: [],
        variants: [{ culture: null, segment: null, name: `Part ${n}` }],
      })
      if (!made.ok) throw new Error(made.reason)
    }
    const handlers = mediaJobHandlers(operations)
    const run = (index: number, progress?: Array<[number, number | undefined]>) => {
      const { name, payload } = queued[index] as { name: string; payload: never }
      return (handlers.get(name) as (p: never, c: never) => Promise<void>)(payload, {
        job: { progress: async (d: number, t?: number) => void progress?.push([d, t]) },
      } as never)
    }

    const trashed = await operations.trash(systemActor('editor'), folder.key)
    expect(trashed).toEqual({ ok: true, queued: 'job-1' })
    expect(queued[0]).toMatchObject({
      name: MEDIA_JOBS.trash,
      payload: { keys: [folder.key], by: { name: 'editor' } },
    })
    const before = await h.server.db.q
      .selectFrom('node')
      .select('trashed')
      .where('unique_id', '=', folder.key)
      .executeTakeFirstOrThrow()
    expect(Boolean(before.trashed)).toBe(false)
    await run(0)
    const after = await h.server.db.q
      .selectFrom('node')
      .select('path')
      .where('unique_id', '=', folder.key)
      .executeTakeFirstOrThrow()
    expect(await countWhere(`${after.path},%`, true)).toBe(12)

    const emptied = await operations.emptyBin(systemActor('editor'))
    expect(emptied).toMatchObject({ ok: true, deleted: 0, queued: 'job-2' })
    const progress: Array<[number, number | undefined]> = []
    await run(1, progress)
    expect(progress.at(-1)).toEqual([13, 13])
    expect(await countWhere('%', true)).toBe(0)
  })

  test('through the API: the request answers at once, and the job empties the bin', async () => {
    const big = await generateMediaLibrary(h.server.db, 6_000, {
      nodeState: h.server.schema.nodeState,
      name: 'Imports',
    })
    const sent: unknown[][] = []
    const broadcast = h.server.events.broadcast
    h.server.events.broadcast = (target, args) => {
      sent.push([target, ...args])
      return broadcast.call(h.server.events, target, args)
    }
    const trash = await h.put(`${V1}/media/${big.folder.key}/move-to-recycle-bin`, {})
    expect(trash.status).toBe(200)
    const trashJob = trash.headers.get('crombolo-job')
    expect(trashJob).toBeTruthy()
    // Open back offices hear the job's id, to follow its progress.
    expect(sent).toContainEqual([
      'notify',
      { eventSource: 'Crombolo:MediaJob', eventType: 'Queued', key: trashJob },
    ])
    h.server.events.broadcast = broadcast
    while ((await h.server.backgroundJobs.runDue()) > 0) {}
    const emptied = await h.del(`${V1}/recycle-bin/media`)
    expect(emptied.status).toBe(200)
    const job = emptied.headers.get('crombolo-job') as string
    expect(job).toBeTruthy()
    while ((await h.server.backgroundJobs.runDue()) > 0) {}
    const status = await h.json<{ state: string; progress: { done: number } | null }>(
      `${BACKOFFICE}/crombolo/api/media-jobs/${job}`,
    )
    expect(status.state).toBe('succeeded')
    expect(status.progress?.done).toBeGreaterThanOrEqual(6_000)
    expect(await countWhere('%', true)).toBe(0)
  }, 600_000)
})
