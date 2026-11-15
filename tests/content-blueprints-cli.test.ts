/**
 * Story 358: blueprints from the command line. `content blueprint new|list|remove`
 * and `content new --blueprint`, in a site folder: a page in two languages saved
 * as one, its name refused twice for a type, a blueprint of one type refused for
 * another, the audit entries, and the sign-in rules the back office keeps.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

const NEWS_TOML = `[content-type]
alias = "news"
name = "News page"
allow-at-root = true
varies-by-culture = true
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
varies-by-culture = true

[[property]]
alias = "summary"
name = "Summary"
type = "textstring"
`

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

type Run = { code: number | null; out: string; err: string }
const json = <T>(run: Run): T => {
  expect(run.code, run.err).toBe(0)
  return JSON.parse(run.out) as T
}

interface Listed {
  items: Array<{ key: string; name: string; type: string; folder: string }>
}
interface Shown {
  type: string
  variants: Array<{ culture: string | null; name: string }>
  values: Array<{ property: string; culture: string | null; value: unknown }>
}

/** A site with an invariant page type and a news type in two languages. */
function blueprintSite(name: string): LocalSite {
  const site = localSite(name)
  writeTreeSchema(site.dir)
  writeFileSync(join(site.dir, 'schema', 'content-types', 'news.toml'), NEWS_TOML)
  for (const args of [
    ['languages', 'add', 'fr-FR'],
    ['types', 'sync'],
  ]) {
    const done = cli(site, args)
    expect(done.code, done.err).toBe(0)
  }
  return site
}

const audited = (site: LocalSite, action: string) =>
  withSiteDb(site, (db) =>
    db.query<{ entity_type: string; entity_key: string; category: string; user_name: string }>(
      `SELECT entity_type, entity_key, category, user_name FROM audit_entry WHERE action = '${action}' ORDER BY id`,
    ),
  )

describe('in a site folder', () => {
  let here: LocalSite
  const run = (...args: string[]) => cli(here, args)
  const ok = (...args: string[]) => {
    const done = run(...args)
    expect(done.code, done.err).toBe(0)
    return done
  }

  beforeAll(() => {
    here = blueprintSite('blueprints-cli')
    ok(
      'content',
      'new',
      '/Story',
      '--type',
      'news',
      '--set',
      'title=Hello',
      '--set',
      'summary=Short',
    )
    ok(
      'content',
      'update',
      '/Story',
      '--culture',
      'fr-FR',
      '--name',
      'Histoire',
      '--set',
      'title=Bonjour',
    )
    ok('content', 'new', '/About', '--type', 'page', '--set', 'title=About us')
  }, 120_000)
  afterAll(() => rmSync(here.dir, { recursive: true, force: true }))

  test('a page in two languages saved as a blueprint, and its name refused twice for its type', async () => {
    const text = ok('content', 'blueprint', 'new', 'Feature', '--from', '/Story')
    expect(text.out).toContain('Saved "/Story" as the blueprint "Feature" (news)')
    const listed = json<Listed>(run('content', 'blueprint', 'list', '-o', 'json'))
    const feature = listed.items.find((b) => b.name === 'Feature')
    expect(feature).toMatchObject({ type: 'news', folder: '' })

    const again = run('content', 'blueprint', 'new', 'Feature', '--from', '/Story')
    expect(again.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(again.err).toContain('already has a blueprint called "Feature"')
    expect(again.err).toContain('content blueprint remove')
    expect(run('content', 'blueprint', 'new', 'Other', '--from', '/Nowhere').code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )

    const made = await audited(here, 'Create')
    expect(made.filter((e) => e.entity_type === 'DocumentBlueprint')).toEqual([
      expect.objectContaining({ category: 'content', entity_key: feature?.key }),
    ])
  }, 120_000)

  test('a page started from a blueprint: its values and languages, --set changing them, no --type needed', () => {
    const made = json<{ key: string; path: string }>(
      run('content', 'new', '/Spring', '--blueprint', 'Feature', '-o', 'json'),
    )
    expect(made.path).toBe('/Spring')
    const shown = json<Shown>(run('content', 'show', '/Spring', '-o', 'json'))
    expect(shown.type).toBe('news')
    expect(shown.variants.map((v) => [v.culture, v.name]).sort()).toEqual([
      ['en-US', 'Spring'],
      ['fr-FR', 'Histoire'],
    ])
    expect(shown.values).toEqual(
      expect.arrayContaining([
        { property: 'title', culture: 'en-US', value: 'Hello' },
        { property: 'title', culture: 'fr-FR', value: 'Bonjour' },
        { property: 'summary', culture: null, value: 'Short' },
      ]),
    )

    ok(
      'content',
      'new',
      '/Summer',
      '--type',
      'news',
      '--blueprint',
      'Feature',
      '--set',
      'title=Summer sale',
    )
    const summer = json<Shown>(run('content', 'show', '/Summer', '-o', 'json'))
    expect(summer.values).toEqual(
      expect.arrayContaining([
        { property: 'title', culture: 'en-US', value: 'Summer sale' },
        { property: 'title', culture: 'fr-FR', value: 'Bonjour' },
        { property: 'summary', culture: null, value: 'Short' },
      ]),
    )

    const wrong = run('content', 'new', '/Wrong', '--type', 'page', '--blueprint', 'Feature')
    expect(wrong.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(wrong.err).toContain('“Feature” is a blueprint for News page, not Page.')
    expect(run('content', 'new', '/Wrong', '--blueprint', 'Nothing').code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )
    expect(run('content', 'new', '/Wrong').code).toBe(ERROR_KINDS.usage.exitCode)
  }, 120_000)

  test('the page made from a blueprint is created, and audited, as any page is', async () => {
    const shown = json<{ key: string }>(run('content', 'show', '/Spring', '-o', 'json'))
    const made = await audited(here, 'Create')
    expect(made.some((e) => e.entity_type === 'Document' && e.entity_key === shown.key)).toBe(true)
  })

  test('listed, all and by type; removed by name, an ambiguous name refused with its keys', async () => {
    ok('content', 'blueprint', 'new', 'Landing page', '--from', '/About')
    ok('content', 'blueprint', 'new', 'Landing page', '--from', '/Story')
    const all = json<Listed>(run('content', 'blueprint', 'list', '-o', 'json'))
    expect(all.items.map((b) => `${b.name} ${b.type}`).sort()).toEqual([
      'Feature news',
      'Landing page news',
      'Landing page page',
    ])
    const pages = json<Listed>(run('content', 'blueprint', 'list', '--type', 'page', '-o', 'json'))
    expect(pages.items.map((b) => b.name)).toEqual(['Landing page'])
    expect(ok('content', 'blueprint', 'list', '--type', 'news').out).toContain('Feature  (news)')
    expect(run('content', 'blueprint', 'list', '--type', 'nope').code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )

    const ambiguous = run('content', 'blueprint', 'remove', 'Landing page', '--yes', '-o', 'json')
    expect(ambiguous.code).toBe(ERROR_KINDS.refused.exitCode)
    for (const b of all.items.filter((i) => i.name === 'Landing page'))
      expect(ambiguous.err).toContain(b.key)

    const asked = run('content', 'blueprint', 'remove', 'Landing page', '--type', 'page')
    expect(asked.code).toBe(ERROR_KINDS.confirmation_required.exitCode)
    const removed = json<{ key: string; changed: boolean }>(
      run(
        'content',
        'blueprint',
        'remove',
        'Landing page',
        '--type',
        'page',
        '--yes',
        '-o',
        'json',
      ),
    )
    expect(removed.changed).toBe(true)
    const left = json<Listed>(run('content', 'blueprint', 'list', '-o', 'json'))
    expect(left.items.map((b) => `${b.name} ${b.type}`).sort()).toEqual([
      'Feature news',
      'Landing page news',
    ])
    ok('content', 'blueprint', 'remove', 'Landing page', '--yes')
    expect(run('content', 'blueprint', 'remove', 'Landing page', '--yes').code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )

    const deleted = (await audited(here, 'Delete')).filter(
      (e) => e.entity_type === 'DocumentBlueprint',
    )
    expect(deleted).toHaveLength(2)
    expect(deleted[0]).toMatchObject({ category: 'content', entity_key: removed.key })
  }, 120_000)
})

describe('at sign-in', () => {
  test('a person without Create on the page may not make one, and one without Settings may not remove one', async () => {
    const site = blueprintSite('blueprints-cli-sign-in')
    cleanup.push(() => rmSync(site.dir, { recursive: true, force: true }))
    const ok = (args: string[], env: Record<string, string> = {}) => {
      const done = cli(site, args, env)
      expect(done.code, `${args.join(' ')}: ${done.err}`).toBe(0)
      return done
    }
    ok(['content', 'new', '/About', '--type', 'page', '--set', 'title=About us'])
    ok(['content', 'blueprint', 'new', 'Landing page', '--from', '/About'])
    ok([
      'users',
      'groups',
      'new',
      'readers',
      '--name',
      'Readers',
      '--section',
      'content',
      '--permission',
      'content:read',
      '--language',
      'all',
    ])
    const h = await serveSite(site)
    try {
      await signInAsGroup(h, 'readers', 'reader@example.com')
      await signInAsGroup(h, 'editor', 'editor@example.com')
    } finally {
      await h.db.close()
    }
    const env = { CROMBOLO_CLI_ACCESS: 'sign-in' }

    await keepSignIn(site, await sessionFor(site, 'reader@example.com'))
    const refused = cli(site, ['content', 'blueprint', 'new', 'Mine', '--from', '/About'], env)
    expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.err).toContain('You may not make a blueprint from this page.')
    ok(['content', 'blueprint', 'list'], env)

    await keepSignIn(site, await sessionFor(site, 'editor@example.com'))
    ok(['content', 'blueprint', 'new', 'Editors page', '--from', '/About'], env)
    const removal = cli(site, ['content', 'blueprint', 'remove', 'Landing page', '--yes'], env)
    expect(removal.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(removal.err).toContain('section')
    const made = (await audited(site, 'Create')).filter(
      (e) => e.entity_type === 'DocumentBlueprint',
    )
    expect(made.at(-1)?.user_name).toBe('editor@example.com')

    await keepSignIn(site, await sessionFor(site, ADMIN.username))
    ok(['content', 'blueprint', 'remove', 'Landing page', '--yes'], env)
  }, 180_000)
})
