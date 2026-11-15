/**
 * Story 361: a menu's items from the command line. `content menu show|add|move|remove`
 * name the menu by its alias and an item by its labels from the top, or its key:
 * a page, a media item, an address and a heading added, items moved with the
 * items below them, removed the same way, each item's key and what was not
 * touched kept. A draft changes neither a template's `menu()` nor the Delivery
 * API's `menus/{alias}`; once published, both follow the new order and nesting.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import { currentSchemaState, DocumentRepository } from '@crombolo/data'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { writeTreeSchema } from './support/content-tree.ts'
import { ORIGIN } from './support/harness.ts'
import { cli, type LocalSite, localSite, serveSite, withSiteDb } from './support/local-site.ts'

/** Draws the main menu as `label=url`, items below in brackets. */
const VIEW = `const draw = (items) => items.map((i) => i.label + '=' + (i.url ?? '-') + (i.children.length ? '[' + draw(i.children) + ']' : '')).join('|')
export default function Page(props) {
  return <main>{draw(props.menu('main'))}</main>
}
`

type Run = { code: number | null; out: string; err: string }
const json = <T>(run: Run): T => {
  expect(run.code, run.err).toBe(0)
  return JSON.parse(run.out) as T
}

interface Item {
  key: string
  label: string
  link: { kind: string; key: string | null; to: string } | null
  target: string | null
  items: Item[]
}
interface Shown {
  alias: string
  state: string
  changes: boolean
  items: Item[]
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const labels = (items: Item[]): string =>
  items.map((i) => i.label + (i.items.length > 0 ? `[${labels(i.items)}]` : '')).join('|')

describe('content menu', () => {
  let here: LocalSite
  const run = (...args: string[]) => cli(here, args)
  const ok = (...args: string[]) => {
    const done = run(...args)
    expect(done.code, `${args.join(' ')}: ${done.err}`).toBe(0)
    return done
  }
  const show = () => json<Shown>(run('content', 'menu', 'show', 'main', '-o', 'json'))

  /** What the site's template and the Delivery API answer, from a server booted now. */
  async function served() {
    const h = await serveSite(here, { deliveryApi: { enabled: true } })
    try {
      const page = (await (await h.server.fetch(new Request(`${ORIGIN}/`))).text()).replace(
        /^<!DOCTYPE html>/,
        '',
      )
      const api = (await (
        await h.server.fetch(new Request(`${ORIGIN}/umbraco/delivery/api/v2/menus/main`))
      ).json()) as {
        items: Array<{
          label: string
          children: Array<{ label: string; children: Array<{ label: string }> }>
        }>
      }
      return { page, api }
    } finally {
      await h.db.close()
    }
  }

  beforeAll(async () => {
    here = localSite('menu-cli')
    writeTreeSchema(here.dir)
    writeFileSync(join(here.dir, 'components', 'page.tsx'), VIEW)
    for (const args of [
      ['types', 'sync'],
      ['content', 'new', '/Home', '--type', 'page'],
      ['content', 'new', '/Home/About', '--type', 'page'],
      ['content', 'new', '/Home/About/Team', '--type', 'page'],
      ['content', 'new', '/Home/Contact', '--type', 'page'],
      ['content', 'publish', '/Home', '--descendants'],
      ['content', 'new', 'library:/Main', '--type', 'menu', '--set', 'alias=main', '--publish'],
    ])
      ok(...args)
    await withSiteDb(here, async (db) => {
      const state = await currentSchemaState(db)
      await new DocumentRepository(db, {
        kind: 'media',
        nodeState: { version: state.version, revision: state.revision },
      }).create({
        key: crypto.randomUUID(),
        contentTypeKey: SYSTEM_MEDIA_TYPE_KEYS.Folder,
        componentKey: null,
        parentKey: null,
        values: [],
        variants: [{ culture: null, segment: null, name: 'Guide' }],
      })
    })
  }, 180_000)
  afterAll(() => rmSync(here.dir, { recursive: true, force: true }))

  test('adds a page, an address, a media item and a heading, under and before others', () => {
    const first = ok('content', 'menu', 'add', 'main', '/Home', '--label', 'Start')
    expect(first.out).toContain('added "Start"')
    expect(first.out).toContain('crombolo content publish library:/Main')
    expect(first.out).not.toMatch(UUID)
    ok('content', 'menu', 'add', 'main', '/Home/About')
    ok('content', 'menu', 'add', 'main', '/Home/About/Team', '--under', 'About')
    ok(
      'content',
      'menu',
      'add',
      'main',
      'https://example.org/shop',
      '--label',
      'Shop',
      '--target',
      '_blank',
    )
    const media = json<{ item: string; changed: boolean }>(
      run('content', 'menu', 'add', 'main', '/Guide', '-o', 'json'),
    )
    expect(media.changed).toBe(true)
    expect(media.item).toMatch(UUID)
    ok('content', 'menu', 'add', 'main', '--label', 'More', '--before', 'Shop')
    ok('content', 'menu', 'add', 'main', '/Home/Contact', '--under', 'More')
    expect(run('content', 'menu', 'add', 'main').code).toBe(ERROR_KINDS.usage.exitCode)
    expect(run('content', 'menu', 'add', 'nope', '/Home').code).toBe(ERROR_KINDS.not_found.exitCode)

    const shown = show()
    expect(labels(shown.items)).toBe('Start|About[Team]|More[Contact]|Shop|Guide')
    expect(shown.items.map((i) => i.link?.kind ?? null)).toEqual([
      'page',
      'page',
      null,
      'address',
      'media',
    ])
    expect(shown.items[0]?.link?.to).toBe('/Home')
    expect(shown.items[3]).toMatchObject({
      target: '_blank',
      link: { to: 'https://example.org/shop' },
    })
    expect(shown.items.find((i) => i.label === 'Guide')?.key).toBe(media.item)
    expect(shown.changes).toBe(true)

    const text = ok('content', 'menu', 'show', 'main').out
    expect(text).toContain('Start  → /Home')
    expect(text).toContain('    Team  → /Home/About/Team')
    expect(text).toContain('More  (a heading)')
    expect(text).not.toMatch(UUID)
  }, 120_000)

  test('a draft changes neither the template nor the Delivery API', async () => {
    const { page, api } = await served()
    expect(page).toBe('<main></main>')
    expect(api.items).toEqual([])
  }, 120_000)

  test('moves an item with the items below it, keeping keys, and never under itself', () => {
    const before = show()
    const keyOf = (items: Item[], label: string): string | undefined => {
      for (const item of items) {
        if (item.label === label) return item.key
        const below = keyOf(item.items, label)
        if (below) return below
      }
      return undefined
    }
    ok('content', 'menu', 'move', 'main', 'About/Team', '--top', '--after', 'Start')
    const moved = ok('content', 'menu', 'move', 'main', 'More', '--under', 'About')
    expect(moved.out).toContain('and the 1 item(s) below it')
    const under = run('content', 'menu', 'move', 'main', 'About', '--under', 'About/More')
    expect(under.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(under.err).toContain('cannot go under itself')
    expect(run('content', 'menu', 'move', 'main', 'Nothing', '--first').code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )

    const after = show()
    expect(labels(after.items)).toBe('Start|Team|About[More[Contact]]|Shop|Guide')
    for (const label of ['Start', 'Team', 'About', 'More', 'Contact', 'Shop', 'Guide'])
      expect(keyOf(after.items, label), label).toBe(keyOf(before.items, label) as string)
    expect(after.items.find((i) => i.label === 'Shop')).toEqual(
      before.items.find((i) => i.label === 'Shop') as Item,
    )
  }, 120_000)

  test('removes an item with the items below it, saying how many', () => {
    ok('content', 'menu', 'add', 'main', '--label', 'Old')
    ok('content', 'menu', 'add', 'main', '/Home/Contact', '--under', 'Old', '--label', 'Older')
    const removed = json<{ removed: number }>(
      run('content', 'menu', 'remove', 'main', 'Old', '-o', 'json'),
    )
    expect(removed.removed).toBe(2)
    expect(labels(show().items)).toBe('Start|Team|About[More[Contact]]|Shop|Guide')
  }, 120_000)

  test('once published, the template and the Delivery API follow the new order and nesting', async () => {
    ok('content', 'menu', 'remove', 'main', 'Guide', '--publish')
    expect(show().changes).toBe(false)
    const { page, api } = await served()
    expect(page).toBe(
      '<main>Start=/|Team=/about/team|About=/about[More=-[Contact=/contact]]|Shop=https://example.org/shop</main>',
    )
    expect(api.items.map((i) => i.label)).toEqual(['Start', 'Team', 'About', 'Shop'])
    expect(api.items[2]?.children[0]?.label).toBe('More')
    expect(api.items[2]?.children[0]?.children[0]?.label).toBe('Contact')
  }, 120_000)
})
