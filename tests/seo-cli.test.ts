/**
 * Story 360: search and sharing from the command line. `seo show`, `seo set` and
 * `seo unset` in a site folder: where each value comes from, each field saved as
 * the screen saves it, a saved value removed, the audit entry, the Settings
 * section at sign-in, and a server started afterwards following what was saved.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SUPER_USER_KEY } from '@crombolo/data'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
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

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
compositions = ["seoFields"]
components = ["page"]
default-component = "page"
`

const VIEW = `import { SeoHead } from '@crombolo/crombolo'
export default function Page(props) {
  return <html><head><SeoHead {...props} /></head><body><h1>{props.model.name}</h1></body></html>
}
`

/** A one-pixel PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

type Run = { code: number | null; out: string; err: string }
const json = <T>(run: Run): T => {
  expect(run.code, run.err).toBe(0)
  return JSON.parse(run.out) as T
}

interface Shown {
  effective: Record<string, unknown>
  saved: Record<string, unknown>
  sources: Record<string, string>
}
interface Field {
  field: string
  value: unknown
  source: string
}

const saves = (site: LocalSite) =>
  withSiteDb(site, (db) =>
    db.query<{ entity_key: string; category: string; user_key: string | null; source: string }>(
      "SELECT entity_key, category, user_key, source FROM audit_entry WHERE action = 'Save' AND entity_type = 'SeoSettings' ORDER BY id",
    ),
  )

describe('in a site folder', () => {
  let here: LocalSite
  let home = ''
  let missing = ''
  let image = ''
  const run = (args: string[], env: Record<string, string> = {}) => cli(here, args, env)
  const ok = (...args: string[]) => {
    const done = run(args)
    expect(done.code, `${args.join(' ')}: ${done.err}`).toBe(0)
    return done
  }
  const configure = (body: string) =>
    writeFileSync(join(here.dir, 'crombolo.config.ts'), `export default ${body}\n`)

  beforeAll(() => {
    here = localSite('seo-cli')
    mkdirSync(join(here.dir, 'schema', 'content-types'))
    writeFileSync(join(here.dir, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
    writeFileSync(join(here.dir, 'components', 'page.tsx'), VIEW)
    writeFileSync(join(here.dir, 'share.png'), PNG)
    configure("{ seo: { titleSuffix: ' | Configured' } }")
    ok('types', 'sync')
    home = json<{ key: string }>(
      run(['content', 'new', '/Home', '--type', 'page', '--publish', '-o', 'json']),
    ).key
    missing = json<{ key: string }>(
      run(['content', 'new', '/Home/Missing', '--type', 'page', '--publish', '-o', 'json']),
    ).key
    ok('media', 'import', join(here.dir, 'share.png'))
    image = json<Field>(run(['seo', 'set', 'defaultImage', '/share.png', '-o', 'json']))
      .value as string
  }, 120_000)
  afterAll(() => rmSync(here.dir, { recursive: true, force: true }))

  test('show: a configured, a saved and a default value, each saying which', () => {
    ok('seo', 'set', 'siteName', 'Saved name')
    const text = ok('seo', 'show').out
    expect(text).toContain(`titleSuffix   " | Configured"  (From the site's configuration)`)
    expect(text).toContain('siteName      "Saved name"  (Saved here)')
    expect(text).toContain('indexable     on  (Default)')
    expect(text).toContain('Robots file  (Default)')
    expect(text).toContain('  User-agent: *')
    expect(text).not.toMatch(/override|key_value|backoffice/i)

    const shown = json<Shown>(run(['seo', 'show', '-o', 'json']))
    expect(shown.effective).toMatchObject({ titleSuffix: ' | Configured', siteName: 'Saved name' })
    expect(shown.saved).toMatchObject({ siteName: 'Saved name' })
    expect(shown.saved).not.toHaveProperty('titleSuffix')
    expect(shown.sources).toMatchObject({
      titleSuffix: 'config',
      siteName: 'saved',
      indexable: 'default',
    })
  }, 60_000)

  test('set: each field, by its name in any case or kebab-case', () => {
    expect(json<Field>(run(['seo', 'set', 'indexable', 'off', '-o', 'json']))).toEqual({
      field: 'indexable',
      value: false,
      source: 'saved',
    })
    expect(json<Field>(run(['seo', 'set', 'SITEMAP', 'yes', '-o', 'json'])).value).toBe(true)
    expect(json<Field>(run(['seo', 'set', 'sitemap', 'False', '-o', 'json'])).value).toBe(false)
    expect(ok('seo', 'set', 'title-suffix', ' | Saved').out).toContain(
      'titleSuffix   " | Saved"  (Saved here)',
    )
    expect(json<Field>(run(['seo', 'set', 'site-name', 'Acme', '-o', 'json'])).value).toBe('Acme')

    expect(image).toMatch(/^[0-9a-f-]{36}$/)
    expect(ok('seo', 'show').out).toContain(`defaultImage  /share.png (${image})  (Saved here)`)
    expect(json<Field>(run(['seo', 'set', 'defaultImage', image, '-o', 'json'])).value).toBe(image)
    const address = 'https://cdn.example.com/share.png'
    expect(json<Field>(run(['seo', 'set', 'default-image', address, '-o', 'json'])).value).toBe(
      address,
    )
    const kept = run(['seo', 'set', 'defaultImage', '/images/elsewhere.png'])
    expect(kept.code, kept.err).toBe(0)
    expect(kept.err).toContain('kept as an address')

    expect(json<Field>(run(['seo', 'set', 'notFoundPage', '/Home/Missing', '-o', 'json']))).toEqual(
      { field: 'notFoundPage', value: [{ document: missing }], source: 'saved' },
    )
    expect(ok('seo', 'show').out).toContain(
      `notFoundPage  /Home/Missing (${missing})  (Saved here)`,
    )
    expect(ok('seo', 'set', 'notFoundPage', home).out).toContain(`/Home (${home})`)
    ok('seo', 'set', 'notFoundPage', missing)

    ok('seo', 'set', 'robotsTxt', 'User-agent: *\nDisallow: /private')
    expect(ok('seo', 'show').out).toContain('  Disallow: /private')
  }, 60_000)

  test('set: --file for the robots file only, and a bad value refused', () => {
    const file = join(here.dir, 'robots.txt')
    writeFileSync(file, 'User-agent: *\nDisallow: /drafts\n')
    expect(json<Field>(run(['seo', 'set', 'robots-txt', '--file', file, '-o', 'json'])).value).toBe(
      'User-agent: *\nDisallow: /drafts\n',
    )
    const notRobots = run(['seo', 'set', 'siteName', '--file', file])
    expect(notRobots.code).toBe(ERROR_KINDS.usage.exitCode)
    expect(notRobots.err).toContain('--file is only for robotsTxt.')
    expect(run(['seo', 'set', 'robotsTxt', 'x', '--file', file]).code).toBe(
      ERROR_KINDS.usage.exitCode,
    )

    const word = run(['seo', 'set', 'indexable', 'maybe'])
    expect(word.code).toBe(ERROR_KINDS.usage.exitCode)
    expect(word.err).toContain('indexable must be true or false.')
    const field = run(['seo', 'set', 'favicon', 'x.ico'])
    expect(field.code).toBe(ERROR_KINDS.usage.exitCode)
    expect(field.err).toContain('There is no search and sharing setting called "favicon".')
    expect(run(['seo', 'set', 'siteName']).code).toBe(ERROR_KINDS.usage.exitCode)
    expect(run(['seo', 'set', 'notFoundPage', '/Nowhere']).code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )
    expect(run(['seo', 'set', 'defaultImage', 'Nowhere.png']).code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )
  }, 60_000)

  test('notFoundPage over rules per hostname or language, and pages.notFound reported', () => {
    ok('seo', 'unset', 'notFoundPage')
    configure(
      `{ seo: { titleSuffix: ' | Configured', notFoundPage: [{ document: '${missing}', host: 'acme.test' }, { document: '${home}', culture: 'fr-FR' }] } }`,
    )
    const listed = ok('seo', 'show').out
    expect(listed).toContain("a page per hostname or language:  (From the site's configuration)")
    expect(listed).toContain(`  acme.test: /Home/Missing (${missing})`)
    expect(listed).toContain(`  fr-FR: /Home (${home})`)

    const replaced = run(['seo', 'set', 'notFoundPage', '/Home/Missing'])
    expect(replaced.code, replaced.err).toBe(0)
    expect(replaced.err).toContain('replaced: this page is now used everywhere')
    expect(replaced.out).toContain(`notFoundPage  /Home/Missing (${missing})  (Saved here)`)

    configure("{ seo: { titleSuffix: ' | Configured' }, pages: { notFound: '/Home' } }")
    expect(ok('seo', 'show').out).toContain(
      "The site's configuration chooses the page for addresses that don't exist, so this one is not used.",
    )
    configure("{ seo: { titleSuffix: ' | Configured' } }")
  }, 60_000)

  test('unset: back to the configuration, and nothing changed when nothing is saved', async () => {
    ok('seo', 'set', 'titleSuffix', ' | Saved')
    const before = (await saves(here)).length
    const removed = ok('seo', 'unset', 'titleSuffix').out
    expect(removed).toContain('Removed the value saved for titleSuffix.')
    expect(removed).toContain(`titleSuffix   " | Configured"  (From the site's configuration)`)
    expect(json<Shown>(run(['seo', 'show', '-o', 'json'])).saved).not.toHaveProperty('titleSuffix')
    expect((await saves(here)).length).toBe(before + 1)

    const again = ok('seo', 'unset', 'title-suffix').out
    expect(again).toContain('Nothing is saved here for titleSuffix.')
    expect(json<Field>(run(['seo', 'unset', 'indexable', '-o', 'json'])).source).toBe('default')
    expect(json<Field>(run(['seo', 'unset', 'indexable', '-o', 'json'])).source).toBe('default')
    const entries = await saves(here)
    expect(entries.length).toBe(before + 2)
    expect(entries.at(-1)).toMatchObject({
      entity_key: 'indexable',
      category: 'settings',
      source: 'cli',
    })
  }, 60_000)

  test('signed in: a person without Settings is refused; a save names the person', async () => {
    const env = { CROMBOLO_CLI_ACCESS: 'sign-in' }
    const h = await serveSite(here)
    try {
      await signInAsGroup(h, 'writer', 'writer@example.com')
    } finally {
      await h.db.close()
    }
    await keepSignIn(here, await sessionFor(here, 'writer@example.com'))
    for (const args of [
      ['seo', 'show'],
      ['seo', 'set', 'siteName', 'Writer'],
      ['seo', 'unset', 'siteName'],
    ]) {
      const refused = run(args, env)
      expect(refused.code, args.join(' ')).toBe(ERROR_KINDS.refused.exitCode)
      expect(refused.err).toContain('needs the Settings section')
    }

    await keepSignIn(here, await sessionFor(here, ADMIN.username))
    const saved = run(['seo', 'set', 'siteName', 'Signed in'], env)
    expect(saved.code, saved.err).toBe(0)
    expect((await saves(here)).at(-1)).toMatchObject({
      entity_key: 'siteName',
      user_key: SUPER_USER_KEY,
    })
  }, 120_000)

  test("a server started afterwards: the head, /robots.txt and the not-found page follow what's saved", async () => {
    ok('seo', 'set', 'titleSuffix', ' | Saved')
    ok('seo', 'set', 'siteName', 'Saved site')
    ok('seo', 'set', 'robotsTxt', 'User-agent: *\nDisallow: /secret')
    ok('seo', 'set', 'notFoundPage', '/Home/Missing')
    ok('seo', 'set', 'indexable', 'on')
    const h = await serveSite(here)
    try {
      const visit = (url: string) => h.server.fetch(new Request(url, { redirect: 'manual' }))
      const page = await (await visit('http://acme.test/')).text()
      expect(page).toContain('<title>Home | Saved</title>')
      expect(page).toContain('<meta property="og:site_name" content="Saved site" />')
      expect(await (await visit('http://acme.test/robots.txt')).text()).toContain(
        'Disallow: /secret',
      )
      const unknown = await visit('http://acme.test/nowhere')
      expect(unknown.status).toBe(404)
      expect(await unknown.text()).toContain('<h1>Missing</h1>')
    } finally {
      await h.db.close()
    }
  }, 120_000)
})
