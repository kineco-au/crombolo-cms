/**
 * Story 254: permissions, sections and webhook events by plain names, listed
 * and taken; form field and workflow types in the style `--editor` takes.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eventName, PERMISSION_NAMES, permissionVerb } from '@crombolo/core'
import { presetDataType } from '@crombolo/schema'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { typeNamed } from '../packages/cli/src/support/form-edit.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')

describe('the names', () => {
  test('a permission by area:action or by its verb; a bare action needs its area', () => {
    expect(permissionVerb('content:read')).toEqual({ ok: true, verb: 'Umb.Document.Read' })
    expect(permissionVerb('Library:Publish')).toEqual({ ok: true, verb: 'Umb.Element.Publish' })
    expect(permissionVerb('Umb.Document.Publish')).toEqual({
      ok: true,
      verb: 'Umb.Document.Publish',
    })
    expect(permissionVerb('form-entries:sensitive')).toEqual({
      ok: true,
      verb: 'Crombolo.FormEntry.Sensitive',
    })
    const bare = permissionVerb('read')
    expect(bare.ok).toBe(false)
    if (!bare.ok)
      expect(bare.candidates).toEqual([
        'content:read',
        'library:read',
        'library-folders:read',
        'media:read',
      ])
  })

  test('every permission has one name, and says what it allows', () => {
    const names = PERMISSION_NAMES.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
    for (const p of PERMISSION_NAMES) expect(p.says).not.toBe(p.name)
  })

  test('an event by its display name; types in either style', () => {
    expect(eventName('Content Published')).toBe('content-published')
    expect(eventName('Content Moved to Recycle Bin')).toBe('content-moved-to-recycle-bin')
    expect(typeNamed('long-answer', ['shortAnswer', 'longAnswer'])).toBe('longAnswer')
    expect(typeNamed('longAnswer', ['shortAnswer', 'longAnswer'])).toBe('longAnswer')
    expect(typeNamed('nothing', ['longAnswer'])).toBe('nothing')
    expect(presetDataType('a', 'richText').ok).toBe(true)
    expect(presetDataType('a', 'rich-text').ok).toBe(true)
  })
})

describe('the commands', () => {
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
  const ok = (...args: string[]) => {
    const run = cli(...args)
    expect(run.code, run.out).toBe(0)
    return run
  }
  const read = (path: string) => readFileSync(join(site, path), 'utf8')

  beforeAll(() => {
    site = mkdtempSync(join(process.cwd(), 'output', 'plain-names-'))
    const files: Record<string, string> = {
      'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
      'schema/content-types/page.toml':
        '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\n',
    }
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(site, path, '..'), { recursive: true })
      writeFileSync(join(site, path), body)
    }
    ok('types', 'sync')
  }, 120_000)
  afterAll(() => rmSync(site, { recursive: true, force: true }))

  test('the listings, in words and as JSON', () => {
    const permissions = ok('users', 'groups', 'permissions').out
    expect(permissions).toContain('content:publish')
    expect(permissions).toContain('Publish pages')
    expect(permissions).not.toContain('Umb.Document')
    expect(ok('users', 'groups', 'permissions', '--verbs').out).toContain('(Umb.Document.Publish)')
    const json = JSON.parse(ok('users', 'groups', 'permissions', '-o', 'json').out)
    expect(json.items).toContainEqual({
      name: 'media:update',
      area: 'media',
      verb: 'Crombolo.Media.Update',
      says: 'Change media',
    })
    expect(ok('users', 'groups', 'sections').out).toContain('Images, documents and other files')
    const events = ok('webhooks', 'events').out
    expect(events).toContain('content-published')
    expect(JSON.parse(ok('webhooks', 'events', '-o', 'json').out).items).toContainEqual({
      name: 'media-deleted',
      alias: 'Umbraco.MediaDelete',
      says: 'Media Deleted',
      kind: 'Media',
    })
  }, 60_000)

  test('a group by plain names, kept as the verbs, shown by plain names', () => {
    ok(
      'users',
      'groups',
      'new',
      'writers',
      '--name',
      'Writers',
      '--section',
      'content',
      '--section',
      'Umb.Section.Media',
      '--permission',
      'content:read',
      '--permission',
      'Umb.Document.Update',
    )
    const file = read('schema/user-groups/writers.toml')
    expect(file).toContain('"Umb.Document.Read"')
    expect(file).toContain('"Umb.Document.Update"')
    expect(file).toContain('"media"')
    ok(
      'users',
      'groups',
      'update',
      'writers',
      '--permission',
      'content:publish',
      '--remove-permission',
      'content:read',
    )
    expect(read('schema/user-groups/writers.toml')).not.toContain('"Umb.Document.Read"')
    const shown = ok('users', 'groups', 'show', 'writers').out
    expect(shown).toContain('content:update, content:publish')

    const bare = cli('users', 'groups', 'update', 'writers', '--permission', 'publish')
    expect(bare.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(bare.out).toContain('"publish" needs its area: content:publish, library:publish')
    const unknown = cli('users', 'groups', 'update', 'writers', '--section', 'kitchen')
    expect(unknown.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(unknown.out).toContain('one of content, media')
  }, 60_000)

  test('a webhook by plain event names', () => {
    ok(
      'webhooks',
      'new',
      'search',
      '--url',
      'https://example.test/hook',
      '--event',
      'content-published',
    )
    expect(read('schema/webhooks/search.toml')).toContain('"Umbraco.ContentPublish"')
    ok('webhooks', 'update', 'search', '--event', 'Umbraco.MediaDelete')
    expect(ok('webhooks', 'show', 'search').out).toContain('content-published, media-deleted')
    const unknown = cli('webhooks', 'update', 'search', '--event', 'page-eaten')
    expect(unknown.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(unknown.out).toContain('one of content-saved, content-published')
  }, 60_000)

  test('form field and workflow types in kebab case, and camel case still', () => {
    ok('forms', 'new', 'contact', '--name', 'Contact')
    ok(
      'forms',
      'field',
      'add',
      'contact',
      'message',
      '--type',
      'long-answer',
      '--caption',
      'Message',
    )
    ok(
      'forms',
      'field',
      'add',
      'contact',
      'company',
      '--type',
      'shortAnswer',
      '--caption',
      'Company',
    )
    ok(
      'forms',
      'workflow',
      'add',
      'contact',
      '--type',
      'send-email',
      '--name',
      'Tell us',
      '--to',
      'a@example.test',
      '--subject',
      'Hello',
    )
    const form = read('schema/forms/contact.toml')
    expect(form).toContain('type = "longAnswer"')
    expect(form).toContain('type = "shortAnswer"')
    expect(form).toContain('type = "sendEmail"')
  }, 60_000)
})
