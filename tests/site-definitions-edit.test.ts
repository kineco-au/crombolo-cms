/**
 * Story 251: languages, user groups and the URL setting changed from the command
 * line. The pure edits on their own, then the commands through the CLI on a
 * SQLite site with a page in French and a user in a group.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, UserGroupRepository, UserRepository } from '@crombolo/data'
import {
  removeLanguage,
  type SchemaLanguage,
  type SchemaUserGroup,
  updateLanguage,
  updateUrls,
  updateUserGroup,
} from '@crombolo/schema'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')

const languages = (): SchemaLanguage[] => [
  { iso: 'en-US', name: 'English', default: true, mandatory: false },
  { iso: 'fr-FR', name: 'French', default: false, mandatory: false },
  { iso: 'fr-CA', name: 'Canadian French', default: false, mandatory: false, fallback: 'fr-FR' },
]
const editors = (): SchemaUserGroup => ({
  alias: 'editors',
  name: 'Editors',
  sections: ['content'],
  permissions: ['Umb.Document.Read'],
  languages: ['en-US'],
})

describe('the pure edits', () => {
  test('a language renamed, made mandatory, and made the one default', () => {
    const changed = updateLanguage(languages(), 'fr-fr', { name: 'Français', default: true })
    expect(changed.ok && changed.languages.filter((l) => l.default).map((l) => l.iso)).toEqual([
      'fr-FR',
    ])
    expect(changed.ok && changed.languages[1]?.name).toBe('Français')
    const fallback = updateLanguage(languages(), 'fr-CA', { fallback: null, mandatory: true })
    expect(fallback.ok && fallback.languages[2]).toEqual({
      iso: 'fr-CA',
      name: 'Canadian French',
      default: false,
      mandatory: true,
    })
  })

  test('a language update that cannot be refused with the reason', () => {
    expect(updateLanguage(languages(), 'en-US', { default: false })).toMatchObject({ ok: false })
    expect(updateLanguage(languages(), 'fr-FR', { fallback: 'fr-FR' })).toMatchObject({
      ok: false,
    })
    expect(updateLanguage(languages(), 'fr-FR', { fallback: 'de-DE' })).toMatchObject({
      ok: false,
    })
    expect(updateLanguage(languages(), 'it-IT', { name: 'x' })).toMatchObject({ ok: false })
  })

  test('a language removed, never the default nor one another falls back to', () => {
    const removed = removeLanguage(languages(), 'fr-CA')
    expect(removed.ok && removed.languages.map((l) => l.iso)).toEqual(['en-US', 'fr-FR'])
    const fallenBackTo = removeLanguage(languages(), 'fr-FR')
    expect(!fallenBackTo.ok && fallenBackTo.reason).toContain('fr-CA falls back to fr-FR')
    expect(removeLanguage(languages(), 'en-US')).toMatchObject({ ok: false })
  })

  test('a group’s sections, permissions and languages added and taken away', () => {
    const changed = updateUserGroup(editors(), {
      name: 'Writers',
      addSections: ['media', 'content'],
      addPermissions: ['Umb.Document.Publish'],
      removePermissions: ['Umb.Document.Read'],
      addLanguages: ['fr-FR'],
    })
    expect(changed.ok && changed.group).toEqual({
      alias: 'editors',
      name: 'Writers',
      sections: ['content', 'media'],
      permissions: ['Umb.Document.Publish'],
      languages: ['en-US', 'fr-FR'],
    })
    expect(updateUserGroup(editors(), { removeSections: ['settings'] })).toMatchObject({
      ok: false,
    })
    const all = updateUserGroup(editors(), { allLanguages: true })
    expect(all.ok && all.group.languages).toBe('all')
    expect(
      updateUserGroup({ ...editors(), languages: 'all' }, { addLanguages: ['fr-FR'] }),
    ).toMatchObject({ ok: false })
    const named = updateUserGroup(
      { ...editors(), languages: 'all' },
      { allLanguages: false, addLanguages: ['fr-FR'] },
    )
    expect(named.ok && named.group.languages).toEqual(['fr-FR'])
  })

  test('the URL setting', () => {
    expect(updateUrls(undefined, false)).toEqual({ hideTopLevel: false })
    expect(updateUrls({ hideTopLevel: false }, true)).toEqual({ hideTopLevel: true })
  })
})

describe('the commands, on a site with a page in French and a user', () => {
  let site: string
  const sqlite = () => join(site, 'site.sqlite')
  const env = () => ({
    ...process.env,
    CROMBOLO_DB: 'sqlite',
    CROMBOLO_SQLITE_FILE: sqlite(),
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
  const json = <T>(...args: string[]) => {
    const { out } = cli(...args, '-o', 'json')
    try {
      return JSON.parse(out) as T
    } catch {
      throw new Error(out)
    }
  }
  const read = (path: string) => readFileSync(join(site, 'schema', path), 'utf8')
  const write = (path: string, body: string) => {
    mkdirSync(join(site, path, '..'), { recursive: true })
    writeFileSync(join(site, path), body)
  }
  const outputs: string[] = []
  const run = (...args: string[]) => {
    const result = cli(...args)
    outputs.push(result.out)
    return result
  }
  const withDb = async <T>(work: (db: Awaited<ReturnType<typeof connect>>) => Promise<T>) => {
    const db = await connect({ dialect: 'sqlite', file: sqlite() })
    try {
      return await work(db)
    } finally {
      await db.close()
    }
  }

  beforeAll(async () => {
    site = mkdtempSync(join(process.cwd(), 'output', 'site-definitions-edit-'))
    const files: Record<string, string> = {
      'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
      'schema/languages.toml':
        '[[language]]\niso = "en-US"\nname = "English"\ndefault = true\n\n[[language]]\niso = "fr-FR"\nname = "French"\n\n[[language]]\niso = "de-DE"\nname = "German"\n',
      'schema/content-types/page.toml':
        '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\nvaries-by-culture = true\ncomponents = ["page"]\ndefault-component = "page"\n\n[[property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\nvaries-by-culture = true\n',
      'schema/user-groups/editors.toml':
        '[user-group]\nalias = "editors"\nname = "Editors"\nsections = ["content"]\npermissions = ["Umb.Document.Read"]\nlanguages = "all"\n',
      'schema/user-groups/reviewers.toml':
        '[user-group]\nalias = "reviewers"\nname = "Reviewers"\nsections = ["content"]\npermissions = ["Umb.Document.Read"]\nlanguages = ["en-US"]\n',
      'schema/user-groups/drafters.toml':
        '[user-group]\nalias = "drafters"\nname = "Drafters"\nsections = ["content", "media"]\npermissions = ["Umb.Document.Read"]\nlanguages = ["fr-FR"]\n',
      'components/page.tsx': 'export default () => <main />\n',
      'content/pages/home.toml':
        'type = "page"\nname = { "en-US" = "Home", "fr-FR" = "Accueil" }\n\n[values.en-US]\ntitle = "Welcome"\n\n[values.fr-FR]\ntitle = "Bienvenue"\n',
    }
    for (const [path, body] of Object.entries(files)) write(path, body)
    const synced = cli('types', 'sync')
    expect(synced.code, synced.out).toBe(0)
    const applied = cli('bundle', 'apply')
    expect(applied.code, applied.out).toBe(0)
    // Drafters stays in the database alone, as a group made in the back office would.
    rmSync(join(site, 'schema/user-groups/drafters.toml'))
    await withDb(async (db) => {
      const reviewers = await new UserGroupRepository(db).byAlias('reviewers')
      await new UserRepository(db).create({
        key: crypto.randomUUID(),
        name: 'Rae Viewer',
        userName: 'rae@example.com',
        email: 'rae@example.com',
        kind: 'Default',
        groupKeys: [reviewers?.key ?? ''],
        languageIsoCode: null,
      })
    })
  }, 120_000)
  afterAll(() => rmSync(site, { recursive: true, force: true }))

  test('a language updated, and made the default; the same again is already so', () => {
    const renamed = run('languages', 'update', 'de-DE', '--name', 'Deutsch', '--mandatory')
    expect(renamed.code, renamed.out).toBe(0)
    expect(read('languages.toml')).toContain('name = "Deutsch"')
    const again = run('languages', 'update', 'de-DE', '--name', 'Deutsch', '--mandatory')
    expect(again.code).toBe(0)
    expect(again.out).toMatch(/already/i)
    const listed = json<{ languages: Array<{ iso: string; mandatory: boolean }> }>(
      'languages',
      'list',
    )
    expect(listed.languages.some((l) => l.iso === 'de-DE')).toBe(true)
    expect(run('languages', 'update', 'fr-FR', '--default').code).toBe(0)
    expect(run('languages', 'update', 'en-US', '--default').code).toBe(0)
    expect(read('languages.toml').match(/default = true/g)).toHaveLength(1)
  })

  test('a language refused: the default, and one a page has a version in', () => {
    const defaultOne = run('languages', 'remove', 'en-US')
    expect(defaultOne.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(defaultOne.out).toContain('default')
    const varied = run('languages', 'remove', 'fr-FR')
    expect(varied.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(varied.out).toContain('1 page')
    expect(read('languages.toml')).toContain('fr-FR')
  })

  test('a language nothing is in removed from the site and its database', async () => {
    const dry = run('languages', 'remove', 'de-DE', '--dry-run')
    expect(dry.code, dry.out).toBe(0)
    expect(read('languages.toml')).toContain('de-DE')
    const removed = run('languages', 'remove', 'de-DE')
    expect(removed.code, removed.out).toBe(0)
    expect(read('languages.toml')).not.toContain('de-DE')
    const left = await withDb(async (db) =>
      db.q.selectFrom('language').select('iso_code').execute(),
    )
    expect(left.map((l) => l.iso_code)).not.toContain('de-DE')
    expect(run('languages', 'remove', 'de-DE').code).toBe(ERROR_KINDS.refused.exitCode)
  })

  test('the URL setting, written canonically, and back', () => {
    const shown = run('site', 'urls', '--show-top-level')
    expect(shown.code, shown.out).toBe(0)
    expect(read('schema.toml')).toBe(
      '[schema]\nversion = "1.0.0"\n\n[urls]\nhide-top-level = false\n',
    )
    expect(run('site', 'urls', '--show-top-level').out).toMatch(/already/i)
    expect(run('site', 'urls', '--hide-top-level').code).toBe(0)
    expect(read('schema.toml')).toBe('[schema]\nversion = "1.0.0"\n')
    expect(cli('site', 'urls').code).toBe(ERROR_KINDS.usage.exitCode)
  })

  test('groups listed, the one made in the back office marked', () => {
    const listed = json<{ items: Array<{ alias: string; source: string; users: number | null }> }>(
      'users',
      'groups',
      'list',
    )
    const by = new Map(listed.items.map((g) => [g.alias, g]))
    expect(by.get('editors')?.source).toBe('site')
    expect(by.get('drafters')?.source).toBe('back office')
    expect(by.get('reviewers')?.users).toBe(1)
    expect(run('users', 'groups', 'list').out).toContain('made in the back office')
  })

  test('a group made, updated canonically, and shown', () => {
    const made = run(
      'users',
      'groups',
      'new',
      'translators',
      '--name',
      'Translators',
      '--section',
      'content',
      '--permission',
      'Umb.Document.Read',
      '--language',
      'fr-FR',
    )
    expect(made.code, made.out).toBe(0)
    expect(run('users', 'groups', 'new', 'translators', '--name', 'Again').code).toBe(
      ERROR_KINDS.conflict.exitCode,
    )
    const updated = run(
      'users',
      'groups',
      'update',
      'translators',
      '--section',
      'media',
      '--permission',
      'Umb.Document.Publish',
      '--language',
      'en-US',
    )
    expect(updated.code, updated.out).toBe(0)
    expect(read('user-groups/translators.toml')).toBe(
      '[user-group]\nalias = "translators"\nname = "Translators"\nsections = ["content", "media"]\npermissions = ["Umb.Document.Read", "Umb.Document.Publish"]\nlanguages = ["fr-FR", "en-US"]\n',
    )
    const shown = json<{ sections: string[] }>('users', 'groups', 'show', 'translators')
    expect(shown.sections).toEqual(['content', 'media'])
    expect(
      run('users', 'groups', 'update', 'translators', '--remove-section', 'settings').code,
    ).toBe(ERROR_KINDS.refused.exitCode)
    expect(run('users', 'groups', 'update', 'nobody', '--name', 'x').code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )
  })

  test('a group made in the back office refused until exported, then changed', () => {
    const refused = run('users', 'groups', 'update', 'drafters', '--name', 'Draft writers')
    expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.out).toContain('crombolo users groups export drafters')
    expect(run('users', 'groups', 'remove', 'drafters').code).toBe(ERROR_KINDS.refused.exitCode)
    const exported = run('users', 'groups', 'export', 'drafters')
    expect(exported.code, exported.out).toBe(0)
    expect(read('user-groups/drafters.toml')).toContain('sections = ["content", "media"]')
    expect(read('user-groups/drafters.toml')).toContain('languages = ["fr-FR"]')
    expect(run('users', 'groups', 'export', 'drafters').code).toBe(ERROR_KINDS.conflict.exitCode)
    expect(run('users', 'groups', 'update', 'drafters', '--name', 'Draft writers').code).toBe(0)
    for (const command of ['update', 'remove', 'export']) {
      const admin = run(
        'users',
        'groups',
        command,
        'admin',
        ...(command === 'update' ? ['--name', 'x'] : []),
      )
      expect(admin.code).toBe(ERROR_KINDS.refused.exitCode)
      expect(admin.out).not.toContain('export admin')
    }
  })

  test('a group with users refused, then removed moving them', async () => {
    const refused = run('users', 'groups', 'remove', 'reviewers')
    expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.out).toContain('1 user')
    expect(run('users', 'groups', 'remove', 'reviewers', '--move-users-to', 'nobody').code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )
    const removed = run('users', 'groups', 'remove', 'reviewers', '--move-users-to', 'editors')
    expect(removed.code, removed.out).toBe(0)
    const after = await withDb(async (db) => {
      const groups = new UserGroupRepository(db)
      const editors = await groups.byAlias('editors')
      const rae = await new UserRepository(db).byEmail('rae@example.com')
      return {
        gone: !(await groups.byAlias('reviewers')),
        inEditors: rae?.groupKeys.includes(editors?.key ?? ''),
      }
    })
    expect(after).toEqual({ gone: true, inEditors: true })
    expect(run('users', 'groups', 'remove', 'translators').code).toBe(0)
    expect(cli('users', 'groups', 'show', 'translators').code).toBe(ERROR_KINDS.not_found.exitCode)
  })

  test('no output names a file', () => {
    expect(outputs.length).toBeGreaterThan(10)
    for (const out of outputs) expect(out).not.toMatch(/\.toml|schema\//i)
  })
})
