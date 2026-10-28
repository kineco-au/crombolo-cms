/**
 * Story 197: media cached apart from the pages. The cache holds the items used
 * most recently within a budget, filled by indexed lookups that callers asking
 * together share; a media change drops only what it touched and leaves the page
 * snapshot alone; a server that missed changes empties the cache.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mediaChangePayload } from '@crombolo/content'
import {
  appendCacheInstruction,
  currentSchemaState,
  type Db,
  instructionEffects,
  latestCheckpoint,
} from '@crombolo/data'
import {
  estimateMediaBytes,
  MediaCache,
  type MediaSource,
  type PublishedMediaNode,
} from '@crombolo/render'
import { CacheInstructionPoller, MEDIA_REPLAY_LIMIT } from '@crombolo/server'
import { dialectUnderTest, migratedDb } from './support/db.ts'

const node = (n: number, extra: Partial<PublishedMediaNode> = {}): PublishedMediaNode => ({
  key: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  id: 1000 + n,
  name: `Photo ${n}`,
  mediaTypeAlias: 'Image',
  path: `-1,${1000 + n}`,
  parentId: -1,
  properties: [
    {
      alias: 'umbracoFile',
      editorAlias: 'Umbraco.ImageCropper',
      culture: null,
      segment: null,
      value: { src: `/media/${n}/photo.jpg` },
    },
  ],
  ...extra,
})

/** A library of `size` items, counting the queries made of it. */
function library(size: number, overrides: (n: number) => Partial<PublishedMediaNode> = () => ({})) {
  const items = new Map<string, PublishedMediaNode>()
  for (let n = 0; n < size; n++) {
    const item = node(n, overrides(n))
    items.set(item.key, item)
  }
  const queries: string[][] = []
  const source: MediaSource = {
    loadMediaByKeys: async (keys) => {
      queries.push([...keys])
      // Read as the query starts, answered a moment later
      const found = keys.flatMap((key) => {
        const item = items.get(key.toLowerCase())
        return item ? [item] : []
      })
      await Bun.sleep(1)
      return found
    },
    loadMediaByUrls: async (urls) => {
      queries.push(urls.map((url) => `url:${url}`))
      return [...items.values()].filter((item) =>
        urls.includes((item.properties[0]?.value as { src?: string } | undefined)?.src ?? ''),
      )
    },
  }
  return { items, queries, source }
}

describe('the media cache', () => {
  test('lookups made together go to the source as one query, and the same key is asked once', async () => {
    const { queries, source } = library(10)
    const cache = new MediaCache(source)
    const [a, b, again] = await Promise.all([
      cache.byKey(node(1).key),
      cache.byKey(node(2).key.toUpperCase()),
      cache.byKey(node(1).key),
    ])
    expect(queries).toEqual([[node(1).key, node(2).key]])
    expect(a?.name).toBe('Photo 1')
    expect(b?.name).toBe('Photo 2')
    expect(again).toBe(a)
    // Held now: no query
    expect((await cache.byKey(node(1).key))?.name).toBe('Photo 1')
    expect(queries).toHaveLength(1)
    const many = await cache.byKeys([node(1).key, node(3).key, node(4).key, 'missing'])
    expect([...many.keys()]).toEqual([node(1).key, node(3).key, node(4).key])
    expect(queries).toHaveLength(2)
    expect(queries[1]).toEqual([node(3).key, node(4).key, 'missing'])
  })

  test('stays within its budget under load, evicting the least recently used', async () => {
    const { source } = library(2_000)
    const one = estimateMediaBytes(node(0))
    const cache = new MediaCache(source, { budgetBytes: one * 50 })
    for (let round = 0; round < 4; round++)
      for (let start = 0; start < 2_000; start += 100)
        await cache.byKeys(Array.from({ length: 100 }, (_, i) => node(start + i).key))
    const stats = cache.stats()
    expect(stats.bytes).toBeLessThanOrEqual(stats.budgetBytes)
    expect(stats.items).toBeLessThanOrEqual(50)
    expect(stats.evictions).toBeGreaterThan(7_000)

    // The one used last stays; reading it again keeps it over a newer one.
    const kept = new MediaCache(source, { budgetBytes: one * 3 })
    await kept.byKey(node(1).key)
    await kept.byKey(node(2).key)
    await kept.byKey(node(3).key)
    await kept.byKey(node(1).key)
    await kept.byKey(node(4).key)
    const before = kept.stats().misses
    await kept.byKey(node(1).key)
    expect(kept.stats().misses).toBe(before)
    await kept.byKey(node(2).key)
    expect(kept.stats().misses).toBe(before + 1)
  })

  test('an item larger than the budget is answered and never held', async () => {
    const { source } = library(1, () => ({ name: 'x'.repeat(10_000) }))
    const cache = new MediaCache(source, { budgetBytes: 1_000 })
    expect((await cache.byKey(node(0).key))?.name).toHaveLength(10_000)
    expect(cache.stats().items).toBe(0)
  })

  test('finds an item by its file address, and a miss is looked up again next time', async () => {
    const { items, queries, source } = library(3)
    const cache = new MediaCache(source)
    expect((await cache.byUrl('/media/2/photo.jpg'))?.key).toBe(node(2).key)
    expect(await cache.byUrl('/media/9/photo.jpg')).toBeUndefined()
    // Held by its address and by its key
    await cache.byUrl('/media/2/photo.jpg')
    await cache.byKey(node(2).key)
    expect(queries).toHaveLength(2)
    // An item added later is found: misses are not remembered
    items.set(node(9).key, node(9))
    expect((await cache.byUrl('/media/9/photo.jpg'))?.key).toBe(node(9).key)
  })

  test('drop, dropUnder and clear', async () => {
    const { items, source } = library(6, (n) =>
      n >= 3 ? { path: `-1,1000,${1000 + n}`, parentId: 1000 } : {},
    )
    const cache = new MediaCache(source)
    await cache.byKeys([...items.keys()])
    expect(cache.stats().items).toBe(6)
    cache.drop([node(1).key.toUpperCase()])
    expect(cache.stats().items).toBe(5)
    // The folder at 1000 moved: everything below it goes
    cache.dropUnder('-1,1000')
    expect(cache.stats().items).toBe(2)
    cache.apply({ keys: [node(2).key], moved: [] })
    expect(cache.stats().items).toBe(1)
    cache.clear()
    expect(cache.stats()).toMatchObject({ items: 0, bytes: 0 })
  })

  test('an item dropped while it was being looked up is not kept as it was', async () => {
    const { items, source } = library(2)
    const cache = new MediaCache(source)
    const loading = cache.byKey(node(1).key)
    await Promise.resolve()
    cache.drop([node(1).key])
    items.set(node(1).key, node(1, { name: 'Renamed' }))
    expect((await loading)?.name).toBe('Photo 1')
    expect((await cache.byKey(node(1).key))?.name).toBe('Renamed')

    const cleared = cache.byKey(node(0).key)
    await Promise.resolve()
    cache.clear()
    await cleared
    expect(cache.stats().items).toBe(0)
  })
})

describe('what a cache instruction asks', () => {
  test('a media change names its items and leaves the pages; a page change leaves media', () => {
    expect(instructionEffects('content', { media: ['a', 'b'] })).toEqual({
      pages: false,
      media: { keys: ['a', 'b'], moved: [] },
    })
    expect(instructionEffects('content', { media: ['a'], moved: ['-1,5'] })).toEqual({
      pages: false,
      media: { keys: ['a'], moved: ['-1,5'] },
    })
    expect(instructionEffects('content', { key: 'x' })).toEqual({ pages: true, media: 'keep' })
    expect(instructionEffects('content', { redirects: true })).toEqual({
      pages: true,
      media: 'keep',
    })
    expect(instructionEffects('components', { hash: 'h' })).toEqual({
      pages: false,
      media: 'keep',
    })
  })

  test('a schema change, a bulk change or anything unknown empties both', () => {
    expect(instructionEffects('schema', { stateId: 3 })).toEqual({ pages: true, media: 'clear' })
    expect(instructionEffects('content', { bundle: 'b' })).toEqual({ pages: true, media: 'clear' })
    expect(instructionEffects('content', { all: true })).toEqual({ pages: true, media: 'clear' })
    expect(instructionEffects('content', {})).toEqual({ pages: true, media: 'clear' })
    expect(instructionEffects('content', { media: true })).toEqual({
      pages: false,
      media: 'clear',
    })
  })

  test('a media operation writes its keys, and the old paths of what moved', () => {
    expect(
      mediaChangePayload({ keys: ['A0000000-0000-4000-8000-000000000001'], moved: [] }),
    ).toEqual({ media: ['a0000000-0000-4000-8000-000000000001'] })
    expect(mediaChangePayload({ keys: [], moved: ['-1,7', '-1,7'] })).toEqual({
      media: [],
      moved: ['-1,7'],
    })
  })
})

const open: Db[] = []
const pollers: CacheInstructionPoller[] = []
afterEach(async () => {
  while (pollers.length > 0) pollers.pop()?.stop()
  while (open.length > 0)
    await open
      .pop()
      ?.close()
      .catch(() => {})
})

/** A poller over a fresh database, with a page snapshot that says what it serves. */
async function follower() {
  const db = await migratedDb()
  open.push(db)
  const state = await currentSchemaState(db)
  const told = { apply: [] as Array<{ keys: string[]; moved: string[] }>, clear: 0, behind: 0 }
  let served = await latestCheckpoint(db)
  const poller = new CacheInstructionPoller({
    db,
    nodeId: 'this-node',
    nodeState: { version: state.version, revision: state.revision },
    onInstruction: () => {},
    content: {
      served: () => ({ checkpoint: served, builtAt: new Date() }),
      behind: () => {
        told.behind += 1
      },
      covered: (checkpoint) => {
        served = checkpoint
      },
    },
    media: {
      apply: (change) => told.apply.push(change),
      clear: () => {
        told.clear += 1
      },
    },
  })
  pollers.push(poller)
  await poller.start(0)
  return { db, poller, told, served: () => served, rebuilt: (to: number) => (served = to) }
}

describe(`a server following media changes (${dialectUnderTest})`, () => {
  test('drops only the items a media change names, and keeps its page snapshot', async () => {
    const { db, poller, told, served } = await follower()
    await appendCacheInstruction(db, {
      kind: 'content',
      payload: { media: ['k1', 'k2'], moved: ['-1,9'] },
      by: 'other-node',
    })
    // Its own changes too: the cache is the same whoever made them
    await appendCacheInstruction(db, { kind: 'content', payload: { media: ['k3'] } })
    await poller.poll()
    expect(told.apply).toEqual([
      { keys: ['k1', 'k2'], moved: ['-1,9'] },
      { keys: ['k3'], moved: [] },
    ])
    expect(told.clear).toBe(0)
    expect(told.behind).toBe(0)
    // Its snapshot is current with them, so nothing is rebuilt
    expect(served()).toBe(await latestCheckpoint(db))
  })

  test('a page change rebuilds the pages and leaves media; media after it waits for the rebuild', async () => {
    const { db, poller, told, served, rebuilt } = await follower()
    const start = served()
    await appendCacheInstruction(db, { kind: 'content', payload: { key: 'page' } })
    await appendCacheInstruction(db, { kind: 'content', payload: { media: ['k1'] } })
    await poller.poll()
    expect(told.behind).toBe(1)
    expect(told.apply).toEqual([{ keys: ['k1'], moved: [] }])
    expect(served()).toBe(start)
    // Rebuilt at the page change: the media change after it is covered at once
    rebuilt(start + 1)
    await poller.poll()
    expect(served()).toBe(start + 2)
    expect(told.behind).toBe(1)
  })

  test('a gap in the changes, or a reset count, empties the media cache', async () => {
    const { db, poller, told } = await follower()
    await appendCacheInstruction(db, { kind: 'content', payload: { media: ['k1'] } })
    await appendCacheInstruction(db, { kind: 'content', payload: { media: ['k2'] } })
    // Pruned before this server read it
    const latest = await latestCheckpoint(db)
    await db.exec('DELETE FROM cache_instruction WHERE checkpoint = ?', [latest - 1])
    await poller.poll()
    expect(told.clear).toBe(1)
    expect(told.apply).toEqual([])

    await db.exec('UPDATE content_checkpoint SET n = 1 WHERE id = 1')
    await poller.poll()
    expect(told.clear).toBe(2)
  })

  test('far behind, it empties the media cache rather than replay', async () => {
    const { db, poller, told } = await follower()
    const latest = await latestCheckpoint(db)
    await db.exec('UPDATE content_checkpoint SET n = ? WHERE id = 1', [
      latest + MEDIA_REPLAY_LIMIT + 1,
    ])
    await poller.poll()
    expect(told.clear).toBe(1)
    expect(told.apply).toEqual([])
  })

  test('a bulk change or a schema change empties it', async () => {
    const { db, poller, told } = await follower()
    await appendCacheInstruction(db, { kind: 'content', payload: { bundle: 'b' } })
    await appendCacheInstruction(db, { kind: 'schema', payload: { stateId: 1 } })
    await poller.poll()
    expect(told.clear).toBe(2)
  })
})
