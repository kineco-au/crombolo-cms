/**
 * Story 174: every change to published content moves one checkpoint inside its
 * own transaction, so its order is the commit order; a snapshot is built from
 * one consistent read and labelled with the checkpoint it holds; a node knows
 * when it is behind, whatever happened to the instructions meant to tell it.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendCacheInstruction,
  connect,
  type Db,
  DictionaryRepository,
  latestCheckpoint,
  liveNodes,
  waitForCheckpoint,
} from '@crombolo/data'
import { PublishedCache, type PublishedContentSource } from '@crombolo/render'
import { freshnessResults } from '@crombolo/server'
import { createPage, type TreeSite, treeOps, treeSite } from './support/content-tree.ts'
import { dialectUnderTest } from './support/db.ts'
import { V1 } from './support/harness.ts'

const sites: TreeSite[] = []
const extra: Db[] = []
afterEach(async () => {
  while (extra.length > 0) await extra.pop()?.close()
  while (sites.length > 0) await sites.pop()?.h.db.close()
})

async function site() {
  const s = await treeSite()
  sites.push(s)
  return { s, db: s.h.server.db }
}

describe('every change to published content moves the checkpoint', () => {
  test('publishing, deleting, the dictionary and redirects each move it', async () => {
    const { s, db } = await site()
    const moved = async (change: () => Promise<unknown>) => {
      const before = await latestCheckpoint(db)
      await change()
      return (await latestCheckpoint(db)) > before
    }
    const page = await createPage(s, 'Home')
    expect(await moved(() => treeOps(s).publish(page))).toBe(true)
    expect(
      await moved(() =>
        s.h.post(`${V1}/dictionary`, {
          name: 'Greeting',
          parent: null,
          translations: [{ isoCode: 'en-US', translation: 'Hello' }],
        }),
      ),
    ).toBe(true)
    expect(await moved(() => treeOps(s).trash(page))).toBe(true)
    expect(await moved(() => treeOps(s).remove(page))).toBe(true)
    expect(new DictionaryRepository(db)).toBeDefined()
  })

  test('a change that rolls back moves nothing', async () => {
    const { db } = await site()
    const before = await latestCheckpoint(db)
    await expect(
      db.transaction(async (tx) => {
        await appendCacheInstruction(tx, { kind: 'content', payload: {} })
        throw new Error('changed my mind')
      }),
    ).rejects.toThrow('changed my mind')
    expect(await latestCheckpoint(db)).toBe(before)
  })

  test('a views change is not published content and moves nothing', async () => {
    const { db } = await site()
    const before = await latestCheckpoint(db)
    expect(await appendCacheInstruction(db, { kind: 'components', payload: {} })).toBeNull()
    expect(await latestCheckpoint(db)).toBe(before)
  })
})

describe('the checkpoint follows commit order', () => {
  test('a change that takes its number first commits first; the next waits for it', async () => {
    const { db } = await site()
    // Two connections on Postgres; one process's own queue on SQLite.
    const other = dialectUnderTest === 'postgres' ? await connect({ dialect: 'postgres' }) : db
    if (other !== db) extra.push(other)
    let releaseFirst!: () => void
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstNumbered!: () => void
    const numbered = new Promise<void>((resolve) => {
      firstNumbered = resolve
    })
    const order: string[] = []
    const first = db.transaction(async (tx) => {
      const n = await appendCacheInstruction(tx, { kind: 'content', payload: { who: 'first' } })
      firstNumbered()
      await held
      order.push('first committed')
      return n
    })
    await numbered
    const second = other.transaction(async (tx) => {
      const n = await appendCacheInstruction(tx, { kind: 'content', payload: { who: 'second' } })
      order.push('second numbered')
      return n
    })
    await Bun.sleep(100)
    // The second cannot be numbered while the first holds the checkpoint.
    expect(order).toEqual([])
    releaseFirst()
    const [a, b] = await Promise.all([first, second])
    expect(order).toEqual(['first committed', 'second numbered'])
    expect(b).toBe((a as number) + 1)
  })
})

describe('a snapshot is one consistent state', () => {
  test('a read snapshot does not see what commits after it began', async () => {
    const { db } = await site()
    const other = dialectUnderTest === 'postgres' ? await connect({ dialect: 'postgres' }) : db
    if (other !== db) extra.push(other)
    const reading = db.readSnapshot(async (reader) => {
      const start = await latestCheckpoint(reader)
      await Bun.sleep(150)
      return [start, await latestCheckpoint(reader)]
    })
    // From another request, as a write during a build comes.
    await Bun.sleep(30)
    const write = appendCacheInstruction(other, { kind: 'content', payload: {} })
    const seen = await reading
    await write
    expect(seen[1]).toBe(seen[0])
    expect(await latestCheckpoint(db)).toBe((seen[0] as number) + 1)
  })

  test('the cache labels its snapshot with the checkpoint it read', async () => {
    const { s, db } = await site()
    const page = await createPage(s, 'Home')
    await treeOps(s).publish(page)
    s.h.server.cache.invalidate()
    const snapshot = await s.h.server.cache.snapshot()
    expect(snapshot.checkpoint).toBe(await latestCheckpoint(db))
    expect(s.h.server.cache.served()?.checkpoint).toBe(snapshot.checkpoint)
  })

  test('an older snapshot finishing last never replaces a newer one', async () => {
    let next = 0
    const delays = [120, 0]
    const checkpoints = [5, 6]
    const source: PublishedContentSource = {
      loadPublished: async () => [],
      withSnapshot: async (fn) => {
        const i = next++
        await Bun.sleep(delays[i] ?? 0)
        return fn(source, checkpoints[i] as number)
      },
    }
    const cache = new PublishedCache(source)
    const older = cache.snapshot()
    cache.invalidate()
    const newer = cache.snapshot()
    await Promise.all([older, newer])
    expect(cache.served()?.checkpoint).toBe(6)
  })

  test('while it rebuilds, readers have the previous snapshot; the first build and fresh() wait', async () => {
    let next = 5
    let release = () => {}
    let held: Promise<void> | undefined
    const source: PublishedContentSource = {
      loadPublished: async () => [],
      withSnapshot: async (fn) => {
        const checkpoint = next++
        if (held) await held
        return fn(source, checkpoint)
      },
    }
    const cache = new PublishedCache(source)
    held = new Promise<void>((resolve) => (release = resolve))
    const first = cache.snapshot()
    const sharing = cache.snapshot()
    expect(cache.stale).toBe(false)
    release()
    expect((await first).checkpoint).toBe(5)
    expect(await sharing).toBe(await first)

    held = new Promise<void>((resolve) => (release = resolve))
    cache.invalidate()
    expect(cache.stale).toBe(true)
    const starter = cache.snapshot()
    expect((await cache.snapshot()).checkpoint).toBe(5)
    const fresh = cache.fresh()
    release()
    expect((await starter).checkpoint).toBe(6)
    expect((await fresh).checkpoint).toBe(6)
    expect(cache.stale).toBe(false)
    expect((await cache.snapshot()).checkpoint).toBe(6)
  })
})

describe('SQLite reads a snapshot on a connection of its own', () => {
  test.skipIf(dialectUnderTest !== 'sqlite')(
    'it never waits for a writer, and never sees what a writer has not committed',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'crombolo-snapshot-'))
      const db = await connect({ dialect: 'sqlite', file: join(dir, 'site.sqlite') })
      extra.push(db)
      await db.exec('CREATE TABLE t (n INTEGER)')
      await db.exec('INSERT INTO t (n) VALUES (1)')
      const count = async (on: Db) =>
        Number((await on.query<{ c: number }>('SELECT COUNT(*) AS c FROM t'))[0]?.c)
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let inserted!: () => void
      const written = new Promise<void>((resolve) => {
        inserted = resolve
      })
      // A writer mid-transaction: its row is not committed.
      const writer = db.transaction(async (tx) => {
        await tx.exec('INSERT INTO t (n) VALUES (2)')
        inserted()
        await held
      })
      await written
      expect(await db.readSnapshot(count)).toBe(1)
      release()
      await writer
      expect(await db.readSnapshot(count)).toBe(2)
      rmSync(dir, { recursive: true, force: true })
    },
  )
})

describe('a node knows when it is behind', () => {
  test('a change whose instruction never arrived is still caught, and the node says what it serves', async () => {
    const { s, db } = await site()
    const page = await createPage(s, 'Home')
    await treeOps(s).publish(page)
    await s.h.server.cache.snapshot()
    await s.h.server.poll()
    const served = s.h.server.cache.served()?.checkpoint as number
    // Another node's change, its instruction lost (pruned, or skipped by a window).
    await appendCacheInstruction(db, { kind: 'content', payload: {}, by: 'node-elsewhere' })
    await db.exec('DELETE FROM cache_instruction WHERE checkpoint > ?', [served])
    await s.h.server.poll()
    await s.h.server.cache.snapshot()
    expect(s.h.server.cache.served()?.checkpoint).toBe(served + 1)
    await s.h.server.poll()
    const me = (await liveNodes(db, { seenWithinMs: 60_000 })).find(
      (node) => node.nodeId === s.h.server.config.nodeId,
    )
    expect(me?.servedCheckpoint).toBe(served + 1)
  })

  test('/health reports the checkpoint served and the latest, numbers only', async () => {
    const { s } = await site()
    await s.h.server.cache.snapshot()
    await s.h.server.poll()
    const health = (await (await s.h.call('/health')).json()) as {
      content: { checkpoint: number; latest: number; behind: boolean; builtAt: string }
    }
    expect(health.content.behind).toBe(false)
    expect(health.content.checkpoint).toBe(health.content.latest)
    expect(typeof health.content.builtAt).toBe('string')
  })

  test('the Servers check warns about a node behind for more than a minute, and no sooner', () => {
    const at = new Date()
    const nodes = [
      { nodeId: 'a', servedCheckpoint: 10 },
      { nodeId: 'b', servedCheckpoint: 8 },
      { nodeId: 'c', servedCheckpoint: 9 },
      { nodeId: 'd', servedCheckpoint: null },
    ]
    const since = new Map([
      ['b', new Date(at.getTime() - 120_000)],
      ['c', new Date(at.getTime() - 5_000)],
    ])
    const results = freshnessResults(nodes, 10, since, at)
    expect(results).toHaveLength(1)
    expect(results[0]?.message).toContain('b serves published content as of change 8')
  })
})

describe('a reader that may lag', () => {
  test('waits for the checkpoint it was told of, or says it did not arrive in time', async () => {
    const { db } = await site()
    const now = await latestCheckpoint(db)
    expect(await waitForCheckpoint(db, now, 100)).toBe(true)
    expect(await waitForCheckpoint(db, now + 1, 100, 20)).toBe(false)
    const waiting = waitForCheckpoint(db, now + 1, 2_000, 20)
    await appendCacheInstruction(db, { kind: 'content', payload: {} })
    expect(await waiting).toBe(true)
  })
})
