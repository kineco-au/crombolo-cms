/**
 * Story 361: the `content` commands on a Library path. `library:/<folder>/<name>`
 * names an element or a folder, `library:/` the top of the Library, and a path
 * with no scheme is always a page: new, update, show, find, move, copy, delete,
 * publish and unpublish, sort refused, the audit entries the Library operations
 * write, and the sections and verbs a person signed in needs.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { ObjectTypes } from '@crombolo/core'
import { FolderRepository } from '@crombolo/data'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { writeTreeSchema } from './support/content-tree.ts'
import { ADMIN, signInAsGroup } from './support/harness.ts'
import {
  cli,
  keepSignIn,
  type LocalSite,
  localSite,
  serveSite,
  sessionFor,
  withSiteDb,
} from './support/local-site.ts'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

type Run = { code: number | null; out: string; err: string }
const json = <T>(run: Run): T => {
  expect(run.code, run.err).toBe(0)
  return JSON.parse(run.out) as T
}

interface Shown {
  key: string
  path: string
  type?: string
  folder: boolean
  variants?: Array<{ culture: string | null; name: string; state: string }>
  values?: Array<{ property: string; culture: string | null; value: unknown }>
  items?: Array<{ key: string; name: string; folder: boolean }>
}

/** A site with a page type, a top-level page and a Library folder both named "Library". */
async function librarySite(name: string): Promise<LocalSite> {
  const site = localSite(name)
  writeTreeSchema(site.dir)
  for (const args of [
    ['types', 'sync'],
    ['content', 'new', '/Library', '--type', 'page', '--set', 'title=Our library'],
    ['content', 'new', '/About', '--type', 'page', '--set', 'title=About'],
  ]) {
    const done = cli(site, args)
    expect(done.code, done.err).toBe(0)
  }
  await withSiteDb(site, async (db) => {
    const folders = new FolderRepository(db, ObjectTypes.ElementContainer, ObjectTypes.Element)
    for (const folder of ['Menus', 'Archive', 'Library'])
      await folders.create({ name: folder, parentKey: null })
  })
  return site
}

const audited = (site: LocalSite, key: string) =>
  withSiteDb(site, (db) =>
    db.query<{ action: string; entity_type: string; category: string; user_name: string }>(
      `SELECT action, entity_type, category, user_name FROM audit_entry WHERE entity_key = '${key}' ORDER BY id`,
    ),
  )

describe('in a site folder', () => {
  let here: LocalSite
  const run = (...args: string[]) => cli(here, args)
  const ok = (...args: string[]) => {
    const done = run(...args)
    expect(done.code, `${args.join(' ')}: ${done.err}`).toBe(0)
    return done
  }

  beforeAll(async () => {
    here = await librarySite('cli-library')
  }, 120_000)
  afterAll(() => rmSync(here.dir, { recursive: true, force: true }))

  test('new makes an element in a folder, and refuses a page type, a missing folder and a view', async () => {
    const made = json<{ key: string; path: string; changed: boolean }>(
      run(
        'content',
        'new',
        'library:/Menus/Footer',
        '--type',
        'menu',
        '--set',
        'alias=footer',
        '-o',
        'json',
      ),
    )
    expect(made).toMatchObject({ path: 'library:/Menus/Footer', changed: true })
    const text = ok('content', 'new', 'library:/Header', '--type', 'menu')
    expect(text.out).toContain('made  library:/Header  (Menu)')
    expect(text.out).toContain('crombolo content publish library:/Header')

    const page = run('content', 'new', 'library:/Menus/Wrong', '--type', 'page')
    expect(page.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(page.err).toContain('is a page type')
    const missing = run('content', 'new', 'library:/Nowhere/Footer', '--type', 'menu')
    expect(missing.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(missing.err).toContain('no folder library:/Nowhere')
    const view = run('content', 'new', 'library:/Menus/Other', '--type', 'menu', '--view', 'page')
    expect(view.code).toBe(ERROR_KINDS.usage.exitCode)
    expect(view.err).toContain('no view')

    const entries = await audited(here, made.key)
    expect(entries).toEqual([
      {
        action: 'Create',
        entity_type: 'Element',
        category: 'content',
        user_name: expect.any(String),
      },
    ])
  }, 120_000)

  test('update and show: values and a new name, through the same reader as a page', () => {
    ok(
      'content',
      'update',
      'library:/Menus/Footer',
      '--name',
      'Footer links',
      '--set',
      'alias=bottom',
    )
    const shown = json<Shown>(run('content', 'show', 'library:/Menus/Footer links', '-o', 'json'))
    expect(shown).toMatchObject({
      path: 'library:/Menus/Footer links',
      type: 'menu',
      folder: false,
    })
    expect(shown.variants?.[0]).toMatchObject({ name: 'Footer links', state: 'Draft' })
    expect(shown.values).toEqual(
      expect.arrayContaining([{ property: 'alias', culture: null, value: 'bottom' }]),
    )
    // By its key too.
    expect(json<Shown>(run('content', 'show', shown.key, '-o', 'json')).path).toBe(
      'library:/Menus/Footer links',
    )
    const folder = json<Shown>(run('content', 'show', 'library:/Menus', '-o', 'json'))
    expect(folder).toMatchObject({ folder: true })
    expect(folder.items?.map((i) => i.name)).toEqual(['Footer links'])
  }, 120_000)

  test('find --under library:/ searches the Library, and a folder in it', () => {
    const all = json<{ items: Array<{ name: string }> }>(
      run('content', 'find', '--under', 'library:/', '--type', 'menu', '-o', 'json'),
    )
    expect(all.items.map((i) => i.name).sort()).toEqual(['Footer links', 'Header'])
    const menus = json<{ items: Array<{ name: string }> }>(
      run('content', 'find', '--under', 'library:/Menus', '-o', 'json'),
    )
    expect(menus.items.map((i) => i.name)).toEqual(['Footer links'])
    expect(run('content', 'find', '--under', 'library:/', '--text', 'menu').code).toBe(
      ERROR_KINDS.usage.exitCode,
    )
  }, 120_000)

  test('publish and unpublish an element, now', () => {
    ok('content', 'publish', 'library:/Menus/Footer links')
    expect(
      json<Shown>(run('content', 'show', 'library:/Menus/Footer links', '-o', 'json')).variants?.[0]
        ?.state,
    ).toBe('Published')
    ok('content', 'unpublish', 'library:/Menus/Footer links')
    expect(run('content', 'publish', 'library:/Menus', '-o', 'json').code).toBe(
      ERROR_KINDS.refused.exitCode,
    )
    expect(run('content', 'publish', 'library:/Header', '--at', '2030-01-01T09:00').code).toBe(
      ERROR_KINDS.usage.exitCode,
    )
  }, 120_000)

  test('move an element and a folder, copy one, and delete one; sort refused', async () => {
    const moved = json<{ items: Array<{ changed: boolean }>; target: { name: string } }>(
      run('content', 'move', 'library:/Header', '--to', 'library:/Archive', '-o', 'json'),
    )
    expect(moved.items[0]?.changed).toBe(true)
    expect(moved.target.name).toBe('Archive')
    ok('content', 'move', 'library:/Archive', '--to', 'library:/Menus')
    expect(
      json<Shown>(run('content', 'show', 'library:/Menus/Archive/Header', '-o', 'json')).folder,
    ).toBe(false)
    const inside = run('content', 'move', 'library:/Menus', '--to', 'library:/Menus/Archive')
    expect(inside.code).toBe(ERROR_KINDS.refused.exitCode)
    ok('content', 'move', 'library:/Menus/Archive', '--to', 'library:/')

    const copied = json<{ key: string; changed: boolean }>(
      run('content', 'copy', 'library:/Archive/Header', '--to', 'library:/Menus', '-o', 'json'),
    )
    expect(copied.changed).toBe(true)
    expect((await audited(here, copied.key)).length).toBe(0)

    const header = json<Shown>(run('content', 'show', 'library:/Archive/Header', '-o', 'json'))
    ok('content', 'delete', 'library:/Archive/Header')
    expect(run('content', 'show', 'library:/Archive/Header').code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )
    expect((await audited(here, header.key)).map((e) => e.action)).toEqual([
      'Create',
      'Move',
      'Copy',
      'Trash',
    ])

    const sort = run('content', 'sort', 'library:/Menus', 'Footer links')
    expect(sort.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(sort.err).toContain('The Library keeps no order of its own.')
  }, 120_000)

  test('a page named Library is /Library, and a Library folder of that name library:/Library', () => {
    expect(json<Shown>(run('content', 'show', '/Library', '-o', 'json')).type).toBe('page')
    expect(json<Shown>(run('content', 'show', 'library:/Library', '-o', 'json')).folder).toBe(true)
  }, 120_000)

  test('a page path where a Library item is needed, and the reverse, are refused naming the other', () => {
    const toPage = run('content', 'move', 'library:/Menus/Footer links', '--to', '/About')
    expect(toPage.code).toBe(ERROR_KINDS.usage.exitCode)
    expect(toPage.err).toContain('library:/')
    const toLibrary = run('content', 'move', '/About', '--to', 'library:/Menus')
    expect(toLibrary.code).toBe(ERROR_KINDS.usage.exitCode)
    expect(toLibrary.err).toContain('A page is named by its path alone: /Menus')
    const unprefixed = run('content', 'show', '/Menus/Footer links')
    expect(unprefixed.code).toBe(ERROR_KINDS.not_found.exitCode)
    expect(unprefixed.err).toContain('library:/Menus/Footer links')
    const mixed = run('content', 'delete', '/About', 'library:/Menus/Footer links')
    expect(mixed.code).toBe(ERROR_KINDS.usage.exitCode)
  }, 120_000)
})

describe('at sign-in', () => {
  test('Content without the Library section is refused, and so is the Library without Update', async () => {
    const site = await librarySite('cli-library-sign-in')
    cleanup.push(() => rmSync(site.dir, { recursive: true, force: true }))
    const ok = (args: string[], env: Record<string, string> = {}) => {
      const done = cli(site, args, env)
      expect(done.code, `${args.join(' ')}: ${done.err}`).toBe(0)
      return done
    }
    ok(['content', 'new', 'library:/Menus/Footer', '--type', 'menu'])
    ok([
      'users',
      'groups',
      'new',
      'writers',
      '--name',
      'Writers',
      '--section',
      'content',
      '--permission',
      'Umb.Document.Read',
      '--language',
      'all',
    ])
    ok([
      'users',
      'groups',
      'new',
      'readers',
      '--name',
      'Library readers',
      '--section',
      'library',
      '--permission',
      'Umb.Element.Read',
      '--language',
      'all',
    ])
    const h = await serveSite(site)
    try {
      await signInAsGroup(h, 'writers', 'writer@example.com')
      await signInAsGroup(h, 'readers', 'reader@example.com')
    } finally {
      await h.db.close()
    }
    const env = { CROMBOLO_CLI_ACCESS: 'sign-in' }

    await keepSignIn(site, await sessionFor(site, 'writer@example.com'))
    const noSection = cli(site, ['content', 'show', 'library:/Menus/Footer'], env)
    expect(noSection.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(noSection.err).toContain('Library section')
    ok(['content', 'show', '/About'], env)

    await keepSignIn(site, await sessionFor(site, 'reader@example.com'))
    ok(['content', 'show', 'library:/Menus/Footer'], env)
    const noUpdate = cli(
      site,
      ['content', 'update', 'library:/Menus/Footer', '--name', 'Bottom'],
      env,
    )
    expect(noUpdate.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(noUpdate.err).toContain('You may not do that in the Library.')
    expect(cli(site, ['content', 'show', '/About'], env).code).toBe(ERROR_KINDS.refused.exitCode)

    await keepSignIn(site, await sessionFor(site, ADMIN.username))
    ok(['content', 'update', 'library:/Menus/Footer', '--name', 'Bottom'], env)
  }, 180_000)
})
