/**
 * Story 374: a site's schema files through the remote protocol, read by path
 * and changed by the definition, applied at once as a type saved in the back
 * office is, and refused, changing nothing, where the site has moved on.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContentTypeRepository } from '@crombolo/data'
import {
  REMOTE_API_PATH,
  REMOTE_DISCOVERY_PATH,
  type RemoteSettings,
  schemaFileHash,
} from '@crombolo/server'
import { dialectUnderTest } from './support/db.ts'
import { type Harness, ORIGIN, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const type = (alias: string, name: string) =>
  `[content-type]\nalias = "${alias}"\nname = "${name}"\nallow-at-root = true\n`
const HOME = 'content-types/home-page.toml'
const ARTICLE = 'content-types/article.toml'

async function site(
  options: { writable?: boolean; remote?: Partial<RemoteSettings> } = {},
): Promise<{ h: Harness; schemaDir: string }> {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const schemaDir = mkdtempSync(join(process.cwd(), 'output', 'remote-schema-'))
  dirs.push(schemaDir)
  mkdirSync(join(schemaDir, 'content-types'), { recursive: true })
  writeFileSync(join(schemaDir, 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(schemaDir, HOME), type('homePage', 'Home Page'))
  const h = await signedInServer({
    config: {
      schemaDir,
      schemaWritable: options.writable ?? true,
      remote: {
        enabled: true,
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 1024 ** 2,
        ...options.remote,
      },
    },
  })
  open.push(h)
  return { h, schemaDir }
}

const api = (client: Harness, path: string, init: RequestInit = {}) =>
  client.server.fetch(
    new Request(`${ORIGIN}${REMOTE_API_PATH}/${path}`, {
      ...init,
      headers: { cookie: client.cookie(), ...(init.headers as Record<string, string>) },
    }),
  )
const read = (client: Harness) => api(client, 'environments/production/schema')
const edit = (client: Harness, body: unknown) =>
  api(client, 'environments/production/schema/edits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const hasType = async (h: Harness, alias: string) =>
  (await new ContentTypeRepository(h.server.db).byAlias(alias)) !== undefined

describe(`a site's schema through the remote protocol (${dialectUnderTest})`, () => {
  test('reads as its files by path, with its version, and discovery offers both', async () => {
    const { h } = await site()
    const discovery = (await (
      await h.server.fetch(new Request(`${ORIGIN}${REMOTE_DISCOVERY_PATH}`))
    ).json()) as { capabilities: string[] }
    expect(discovery.capabilities).toContain('schema-files')
    expect(discovery.capabilities).toContain('schema-edit')
    const response = await read(h)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { version: string; files: Record<string, string> }
    expect(body.version).toBe('1.0.0')
    expect(body.files[HOME]).toBe(type('homePage', 'Home Page'))
    expect(Object.keys(body.files)).toContain('schema.toml')
  }, 30_000)

  test('an edit adds and removes a definition at once, raising the version and audited', async () => {
    const { h, schemaDir } = await site()
    const dry = await edit(h, {
      edits: { [ARTICLE]: type('article', 'Article') },
      base: { [ARTICLE]: null },
      dryRun: true,
    })
    expect(dry.status).toBe(200)
    expect(await dry.json()).toMatchObject({ changed: false, version: '1.1.0' })
    expect(existsSync(join(schemaDir, ARTICLE))).toBe(false)

    const added = await edit(h, {
      edits: { [ARTICLE]: type('article', 'Article') },
      base: { [ARTICLE]: null },
    })
    expect(added.status).toBe(200)
    expect(await added.json()).toMatchObject({ changed: true, action: 'applied', version: '1.1.0' })
    expect(readFileSync(join(schemaDir, ARTICLE), 'utf8')).toBe(type('article', 'Article'))
    expect(readFileSync(join(schemaDir, 'schema.toml'), 'utf8')).toContain('1.1.0')
    expect(await hasType(h, 'article')).toBe(true)

    const removed = await edit(h, {
      edits: { [ARTICLE]: null },
      base: { [ARTICLE]: schemaFileHash(type('article', 'Article')) },
    })
    expect(removed.status).toBe(200)
    expect(existsSync(join(schemaDir, ARTICLE))).toBe(false)
    expect(await hasType(h, 'article')).toBe(false)

    const again = await edit(h, { edits: { [ARTICLE]: null } })
    expect(await again.json()).toMatchObject({ changed: false })

    const audit = await h.server.db.q
      .selectFrom('audit_entry')
      .select(['action', 'detail'])
      .where('entity_type', '=', 'Schema')
      .execute()
    expect(audit.map((row) => row.detail)).toEqual([
      `from the command line: wrote ${ARTICLE}`,
      `from the command line: removed ${ARTICLE}`,
    ])
  }, 30_000)

  test('refused, changing nothing, where a file has moved on from its base', async () => {
    const { h, schemaDir } = await site()
    const response = await edit(h, {
      edits: { [HOME]: type('homePage', 'Front Page') },
      base: { [HOME]: schemaFileHash(type('homePage', 'Something else')) },
    })
    expect(response.status).toBe(409)
    const problem = (await response.json()) as { code: string; items: string[] }
    expect(problem.code).toBe('changed-here')
    expect(problem.items).toEqual([`${HOME}: changed here`])
    expect(readFileSync(join(schemaDir, HOME), 'utf8')).toBe(type('homePage', 'Home Page'))
  }, 30_000)

  test('refused where the files have problems or are not schema files', async () => {
    const { h } = await site()
    const broken = await edit(h, { edits: { [ARTICLE]: '[content-type]\nalias = \n' } })
    expect(broken.status).toBe(400)
    expect(((await broken.json()) as { code: string }).code).toBe('problems')
    const outside = await edit(h, { edits: { 'migrations/001.ts': 'export {}' } })
    expect(outside.status).toBe(400)
    const malformed = await edit(h, { edits: { [ARTICLE]: 42 } })
    expect(malformed.status).toBe(400)
    const keep = await edit(h, { edits: { 'schema.toml': null } })
    expect(keep.status).toBe(400)
  }, 30_000)

  test('a type with pages is not removed unless retired', async () => {
    const { h, schemaDir } = await site()
    const home = await new ContentTypeRepository(h.server.db).byAlias('homePage')
    const created = await h.post(`${V1}/document`, {
      documentType: { id: home?.key },
      template: null,
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Home' }],
    })
    expect(created.status).toBe(201)
    const base = { [HOME]: schemaFileHash(type('homePage', 'Home Page')) }
    const refused = await edit(h, { edits: { [HOME]: null }, base })
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { code: string }).code).toBe('removed-with-content')
    expect(existsSync(join(schemaDir, HOME))).toBe(true)
    const retired = await edit(h, { edits: { [HOME]: null }, base, retire: true })
    expect(retired.status).toBe(200)
    expect(existsSync(join(schemaDir, HOME))).toBe(false)
  }, 30_000)

  test('refused where the schema changes only with a deploy', async () => {
    const { h } = await site({ writable: false })
    expect((await read(h)).status).toBe(200)
    const response = await edit(h, { edits: { [ARTICLE]: type('article', 'Article') } })
    expect(response.status).toBe(409)
    expect(((await response.json()) as { code: string }).code).toBe('not-writable')
  }, 30_000)

  test('reading needs the read level, and changing the content level and ApplyStructure', async () => {
    const atRead = await site({ remote: { access: 'read' } })
    expect((await read(atRead.h)).status).toBe(200)
    const refused = await edit(atRead.h, { edits: {} })
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { code: string }).code).toBe('access-level')

    const { h } = await site({ remote: { access: 'content' } })
    const created = await h.post(`${V1}/user-group`, {
      name: 'Pushers',
      alias: 'pushers',
      sections: ['Umb.Section.Content'],
      languages: [],
      hasAccessToAllLanguages: true,
      documentRootAccess: true,
      documentStartNode: null,
      mediaRootAccess: true,
      mediaStartNode: null,
      elementRootAccess: false,
      elementStartNode: null,
      fallbackPermissions: ['Crombolo.Remote.Pull', 'Crombolo.Remote.Push'],
      permissions: [],
    })
    expect(created.status).toBe(201)
    const pusher = await signInAsGroup(h, 'pushers')
    expect((await read(pusher)).status).toBe(200)
    const forbidden = await edit(pusher, { edits: {} })
    expect(forbidden.status).toBe(403)
    expect(((await forbidden.json()) as { code: string }).code).toBe('forbidden-structure')
    const writer = await signInAsGroup(h, 'writer')
    expect((await read(writer)).status).toBe(403)
    expect((await edit(h, { edits: {} })).status).toBe(200)
  }, 30_000)
})
