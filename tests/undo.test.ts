/**
 * Story 353, the shared core: a page's history newest first with who made each
 * version, a version against the draft, and the recycle bin with where each item
 * came from, a place that is gone included.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  binItems,
  binMatches,
  diffValues,
  pageHistory,
  pageVersion,
  placeGone,
} from '@crombolo/server'
import { createPage, type TreeSite, treeOps, treeSite } from './support/content-tree.ts'
import { dialectUnderTest } from './support/db.ts'

const open: TreeSite[] = []
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close()
})

async function site() {
  const made = await treeSite()
  open.push(made)
  return made
}

describe(`undoing a change (${dialectUnderTest})`, () => {
  test('history is newest first, by whom, with the draft, what is live and what is kept', async () => {
    const s = await site()
    const ops = treeOps(s)
    const key = await createPage(s, 'Home')
    expect((await ops.save(key, 'Home', 'Second')).status).toBe(200)
    expect((await ops.publish(key)).status).toBe(200)
    expect((await ops.save(key, 'Home', 'Third')).status).toBe(200)

    const history = await pageHistory(s.h.server.db, key)
    expect(history?.page).toEqual({ key, name: 'Home' })
    const versions = history?.versions ?? []
    expect(versions.length).toBeGreaterThanOrEqual(3)
    const ids = versions.map((v) => Number(v.id))
    expect([...ids].sort((a, b) => b - a)).toEqual(ids)
    expect(versions[0]?.draft).toBe(true)
    expect(versions.filter((v) => v.live)).toHaveLength(1)
    expect(versions.some((v) => v.kind === 'publish')).toBe(true)
    expect(versions.every((v) => v.by?.name === 'Administrator')).toBe(true)
    expect(versions.every((v) => v.kept === false)).toBe(true)
    expect(await pageHistory(s.h.server.db, crypto.randomUUID())).toBeUndefined()
  }, 60_000)

  test("a version's values, and what differs from the draft", async () => {
    const s = await site()
    const ops = treeOps(s)
    const key = await createPage(s, 'Home')
    await ops.save(key, 'Home', 'Second')
    const history = await pageHistory(s.h.server.db, key)
    const first = history?.versions.at(-1)?.id as string
    const shown = await pageVersion(s.h.server.db, first, { diff: true })
    expect(shown?.page.key).toBe(key)
    expect(shown?.values).toEqual([{ property: 'title', culture: null, value: 'Home' }])
    expect(shown?.diff).toEqual([
      { property: 'title', culture: null, change: 'changed', draft: 'Second', version: 'Home' },
    ])
    expect(
      (await pageVersion(s.h.server.db, history?.versions[0]?.id as string, { diff: true }))?.diff,
    ).toEqual([])
    expect(await pageVersion(s.h.server.db, '999999')).toBeUndefined()
  }, 60_000)

  test('diffs name what was added and removed too', () => {
    const v = (property: string, value: unknown) => ({ property, culture: null, value })
    expect(diffValues([v('a', 1), v('b', 2)], [v('b', 2), v('c', 3)])).toEqual([
      { property: 'a', culture: null, change: 'removed', draft: 1 },
      { property: 'c', culture: null, change: 'added', version: 3 },
    ])
  })

  test('the bin lists each item, who put it there and where it came from, or that the place is gone', async () => {
    const s = await site()
    const ops = treeOps(s)
    const home = await createPage(s, 'Home')
    const visit = await createPage(s, 'Visit us', home)
    const about = await createPage(s, 'About')
    const team = await createPage(s, 'Team', about)
    expect((await ops.trash(visit)).status).toBe(200)
    expect((await ops.trash(team)).status).toBe(200)
    expect((await ops.trash(about)).status).toBe(200)

    const items = await binItems(s.h.server.db, { kinds: ['content'] })
    const byName = Object.fromEntries(items.map((item) => [item.name, item]))
    expect(Object.keys(byName).sort()).toEqual(['About', 'Team', 'Visit us'])
    expect(byName['Visit us']?.from).toEqual({ key: home, path: '/Home', gone: false })
    expect(byName['Visit us']?.by?.name).toBe('Administrator')
    expect(byName['Visit us']?.trashedAt).not.toBeNull()
    expect(byName.About?.from).toEqual({ key: null, path: '/', gone: false })
    expect(byName.Team?.from).toEqual({ key: about, path: null, gone: true })
    expect(placeGone(byName.Team as never)).toContain('in the recycle bin too')
    expect(placeGone(byName['Visit us'] as never)).toBeUndefined()

    expect((await ops.remove(about)).status).toBe(200)
    const after = await binItems(s.h.server.db, { kinds: ['content'] })
    expect(after.find((item) => item.name === 'Team')?.from).toEqual({
      key: null,
      path: null,
      gone: true,
    })
    expect(placeGone(after.find((item) => item.name === 'Team') as never)).toContain(
      'no longer there',
    )
    expect(await binItems(s.h.server.db, { kinds: ['content'], olderThanDays: 1 })).toEqual([])
    expect(binMatches(after, '/Home/Visit us').map((i) => i.key)).toEqual([visit])
    expect(binMatches(after, 'visit us').map((i) => i.key)).toEqual([visit])
    expect(binMatches(after, team.toUpperCase()).map((i) => i.key)).toEqual([team])
  }, 60_000)
})
