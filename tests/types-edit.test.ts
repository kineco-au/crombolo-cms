/**
 * Story 248: content, element, media and member types changed from the command
 * line. The edits in `edit.ts`, then each command through the CLI on a SQLite
 * site that has pages: checked before anything is written, applied, refused
 * with nothing changed, and never naming a file.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  addTab,
  moveProperty,
  moveTab,
  removeProperty,
  removeTab,
  renameTab,
  type SchemaContentType,
  updateProperty,
  updateType,
} from '@crombolo/schema'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')

const prop = (alias: string, type = 'textstring') => ({
  alias,
  name: alias,
  type,
  mandatory: false,
  variesByCulture: false,
  variesBySegment: false,
  labelOnTop: false,
})

const article = (): SchemaContentType => ({
  alias: 'article',
  name: 'Article',
  icon: 'icon-document',
  allowAtRoot: false,
  isElement: false,
  allowInLibrary: false,
  variesByCulture: false,
  variesBySegment: false,
  compositions: [],
  allowChildren: [],
  components: ['article'],
  defaultComponent: 'article',
  cleanup: { prevent: false },
  properties: [],
  tabs: [
    { name: 'Content', properties: [prop('title'), prop('body', 'textarea')], groups: [] },
    { name: 'Extras', properties: [prop('note')], groups: [] },
  ],
})

const ok = <T extends { ok: boolean }>(result: T) => {
  expect(result.ok, JSON.stringify(result)).toBe(true)
  return (result as unknown as { type: SchemaContentType }).type
}

describe('the edits', () => {
  test('a type’s settings, children, compositions and views', () => {
    const next = ok(
      updateType(article(), {
        name: 'Story',
        allowAtRoot: true,
        allowChild: ['quote'],
        compose: ['seo'],
        view: ['article/amp'],
        defaultView: 'article/amp',
      }),
    )
    expect(next).toMatchObject({
      name: 'Story',
      allowAtRoot: true,
      allowChildren: ['quote'],
      compositions: ['seo'],
      components: ['article', 'article/amp'],
      defaultComponent: 'article/amp',
    })
    expect(updateType(article(), { decompose: ['seo'] })).toMatchObject({ ok: false })
    expect(updateType(article(), { compose: ['article'] })).toMatchObject({ ok: false })
    expect(updateType(article(), { defaultView: 'missing' })).toMatchObject({ ok: false })
  })

  test('tabs: added in place, renamed, moved, and removed only when empty or emptied', () => {
    expect(ok(addTab(article(), 'SEO', { after: 'Content' })).tabs.map((t) => t.name)).toEqual([
      'Content',
      'SEO',
      'Extras',
    ])
    expect(addTab(article(), 'content')).toMatchObject({ ok: false })
    expect(ok(renameTab(article(), 'Extras', 'More')).tabs[1]?.name).toBe('More')
    expect(ok(moveTab(article(), 'Extras', { before: 'Content' })).tabs.map((t) => t.name)).toEqual(
      ['Extras', 'Content'],
    )
    expect(removeTab(article(), 'Extras')).toMatchObject({ ok: false })
    const emptied = ok(removeTab(article(), 'Extras', 'Content'))
    expect(emptied.tabs.map((t) => t.name)).toEqual(['Content'])
    expect(emptied.tabs[0]?.properties.map((p) => p.alias)).toEqual(['title', 'body', 'note'])
  })

  test('properties: changed, moved within and across tabs, and removed', () => {
    const changed = ok(updateProperty(article(), 'title', { name: 'Headline', mandatory: true }))
    expect(changed.tabs[0]?.properties[0]).toMatchObject({ name: 'Headline', mandatory: true })
    const moved = ok(moveProperty(article(), 'body', { before: 'title' }))
    expect(moved.tabs[0]?.properties.map((p) => p.alias)).toEqual(['body', 'title'])
    const across = ok(moveProperty(article(), 'note', { tab: 'Content', after: 'title' }))
    expect(across.tabs[0]?.properties.map((p) => p.alias)).toEqual(['title', 'note', 'body'])
    expect(across.tabs[1]?.properties).toEqual([])
    expect(ok(removeProperty(article(), 'note')).tabs[1]?.properties).toEqual([])
    expect(updateProperty(article(), 'nothing', { name: 'x' })).toMatchObject({ ok: false })
  })
})

describe('the commands, on a site with pages', () => {
  let site: string
  const env = () => ({
    ...process.env,
    CROMBOLO_DB: 'sqlite',
    CROMBOLO_SQLITE_FILE: join(site, 'site.sqlite'),
    CROMBOLO_MEDIA_DIR: join(site, 'media'),
    CROMBOLO_COMPONENTS_DIR: join(site, 'components'),
    CROMBOLO_SCHEMA_DIR: join(site, 'schema'),
    CROMBOLO_ADMIN_LOGIN: 'admin@crombolo.local',
    CROMBOLO_SECRET_KEY: 'a-test-secret-key-that-is-long-enough-to-use',
    CROMBOLO_LOG_TO_CONSOLE: 'false',
  })
  const cli = (...args: string[]) => {
    const proc = Bun.spawnSync(['bun', BIN, ...args], { cwd: site, env: env(), stdin: 'ignore' })
    return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() }
  }
  const file = () => readFileSync(join(site, 'schema', 'content-types', 'page.toml'), 'utf8')
  const shown = (alias = 'page') =>
    JSON.parse(cli('types', 'show', alias, '-o', 'json').out) as {
      tabs: string[]
      properties: Array<{ alias: string; name: string; tab: string | null; mandatory: boolean }>
      applied: string
    }

  beforeAll(() => {
    site = mkdtempSync(join(process.cwd(), 'output', 'types-edit-'))
    const files: Record<string, string> = {
      'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
      'schema/content-types/page.toml':
        '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\nallow-children = ["page"]\ncomponents = ["page"]\ndefault-component = "page"\n\n[[tab]]\nname = "Content"\n\n[[tab.property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\n',
      'components/page.tsx': 'export default () => <main />\n',
      'content/pages/home.toml': 'type = "page"\nname = "Home"\n\n[values]\ntitle = "Welcome"\n',
    }
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(site, path, '..'), { recursive: true })
      writeFileSync(join(site, path), text)
    }
    expect(cli('types', 'sync').code).toBe(0)
    const applied = cli('site', 'apply')
    expect(applied.code, applied.out).toBe(0)
  }, 120_000)
  afterAll(() => rmSync(site, { recursive: true, force: true }))

  test('a property added, changed and moved, each applied at once', () => {
    const added = cli(
      'types',
      'property',
      'add',
      'page',
      'summary',
      '--type',
      'textarea',
      '--name',
      'Summary',
    )
    expect(added.code, added.out).toBe(0)
    expect(added.out).toContain('gains "summary" (textarea) in the tab "Content"')
    expect(shown().properties.map((p) => p.alias)).toEqual(['title', 'summary'])
    expect(shown().applied).toBe('applied')

    expect(cli('types', 'property', 'update', 'page', 'summary', '--name', 'Standfirst').code).toBe(
      0,
    )
    expect(cli('types', 'property', 'move', 'page', 'summary', '--before', 'title').code).toBe(0)
    expect(shown().properties.map((p) => `${p.alias}:${p.name}`)).toEqual([
      'summary:Standfirst',
      'title:Title',
    ])
  })

  test('asking for what is already so changes nothing, and says so', () => {
    const run = cli('types', 'property', 'update', 'page', 'title', '--name', 'Title')
    expect(run.code, run.out).toBe(0)
    expect(run.out).toContain('already so: nothing to change')
  })

  test('a dry run writes nothing; --no-apply writes and leaves it to a sync', () => {
    const before = file()
    const dry = cli('types', 'tab', 'add', 'page', 'SEO', '--dry-run')
    expect(dry.code, dry.out).toBe(0)
    expect(dry.out).toContain('Nothing was changed (--dry-run)')
    expect(file()).toBe(before)

    expect(cli('types', 'tab', 'add', 'page', 'SEO', '--no-apply').code).toBe(0)
    expect(shown().applied).toBe('changed, not applied yet')
    expect(cli('types', 'sync').code).toBe(0)
    expect(shown().applied).toBe('applied')
  })

  test('tabs renamed, moved, and removed only once emptied', () => {
    expect(cli('types', 'tab', 'rename', 'page', 'SEO', 'Search').code).toBe(0)
    expect(cli('types', 'tab', 'move', 'page', 'Search', '--before', 'Content').code).toBe(0)
    expect(shown().tabs).toEqual(['Search', 'Content'])
    expect(cli('types', 'property', 'move', 'page', 'summary', '--tab', 'Search').code).toBe(0)
    const refused = cli('types', 'tab', 'remove', 'page', 'Search')
    expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.out).toContain('holds 1 property (summary)')
    expect(cli('types', 'tab', 'remove', 'page', 'Search', '--move-to', 'Content').code).toBe(0)
    expect(shown().tabs).toEqual(['Content'])
  })

  test('a change the site would not accept is refused, and nothing is written', () => {
    const before = file()
    const unknown = cli('types', 'update', 'page', '--allow-child', 'nothingLikeIt')
    expect(unknown.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(unknown.out).toContain('Nothing was changed')
    expect(file()).toBe(before)

    const unconvertible = cli('types', 'property', 'update', 'page', 'title', '--type', 'numeric')
    expect(unconvertible.code, unconvertible.out).toBe(ERROR_KINDS.refused.exitCode)
    expect(file()).toBe(before)
  })

  test('a type its pages use is not removed, unless retired with them kept', () => {
    const refused = cli('types', 'remove', 'page')
    expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.out).toContain('--retire')
    const listed = JSON.parse(cli('types', 'list', '-o', 'json').out) as {
      items: Array<{ alias: string }>
    }
    expect(listed.items.map((i) => i.alias)).toContain('page')
  })

  test('what a command writes is what `types rewrite` writes, and no output names a file', () => {
    const before = file()
    expect(cli('types', 'rewrite').code).toBe(0)
    expect(file()).toBe(before)
    for (const run of [
      cli('types', 'update', 'page', '--icon', 'icon-home'),
      cli('types', 'property', 'update', 'page', 'title', '--mandatory'),
      cli('types', 'property', 'remove', 'page', 'nothing'),
    ])
      expect(run.out).not.toMatch(/\.toml|schema\//i)
  })

  test('last: retiring the type keeps its page', () => {
    const retired = cli('types', 'remove', 'page', '--retire')
    expect(retired.code, retired.out).toBe(0)
    const listed = JSON.parse(cli('types', 'list', '--kind', 'content', '-o', 'json').out) as {
      items: unknown[]
    }
    expect(listed.items).toEqual([])
    const found = JSON.parse(cli('content', 'find', '-o', 'json').out) as { total: number }
    expect(found.total).toBe(1)
  })
})
