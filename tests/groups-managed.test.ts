/**
 * Story 405: user groups defined outside the site. Only the API clients `groups.managedBy`
 * names create, change or delete a group; a start node naming an item not here waits,
 * giving no start in that tree until the item arrives; the back office shows groups
 * read-only; and a bundle carrying a group's definition is refused.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContentTypeRepository, UserGroupRepository, UserRepository } from '@crombolo/data'
import {
  type CromboloConfig,
  checkBundleContent,
  exportSite,
  extractTarball,
  loadConfig,
} from '@crombolo/server'
import {
  applyGroupsManaged,
  GROUPS_HIDDEN,
  OPEN_GROUP_IN_DIRECTORY,
} from '../packages/backoffice-host/plugin/users-managed.js'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const DIRECTORY = { id: 'crombolo-back-office-directory', secret: 'a-directory-secret-1' }
const AT = 'https://people.example.test/groups/{alias}'
const PLUGIN = `${BACKOFFICE}/crombolo/api/users-managed`

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

async function site(config: Partial<CromboloConfig> = {}) {
  const h = await signedInServer({
    config: {
      apiClient: DIRECTORY,
      groups: { managedBy: [DIRECTORY.id], managedAt: AT },
      ...config,
    },
  })
  open.push(h)
  const granted = await h.server.fetch(
    new Request(`${ORIGIN}${V1}/security/back-office/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: DIRECTORY.id,
        client_secret: DIRECTORY.secret,
      }).toString(),
    }),
  )
  const { access_token } = (await granted.json()) as { access_token: string }
  const directory = (method: string, path: string, body?: unknown) =>
    h.server.fetch(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${access_token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
  return { h, directory }
}

const group = (alias: string, start: string | null, permissions: unknown[] = []) => ({
  name: alias,
  alias,
  sections: ['Umb.Section.Content'],
  languages: [],
  hasAccessToAllLanguages: true,
  documentRootAccess: start === null,
  documentStartNode: start ? { id: start } : null,
  mediaRootAccess: false,
  mediaStartNode: null,
  elementRootAccess: false,
  elementStartNode: null,
  fallbackPermissions: ['Umb.Document.Read'],
  permissions,
})

describe('the setting', () => {
  test('is read from the environment, and a bad one in the config file is refused', () => {
    const before = {
      by: process.env.CROMBOLO_GROUPS_MANAGED_BY,
      at: process.env.CROMBOLO_GROUPS_MANAGED_AT,
    }
    try {
      process.env.CROMBOLO_GROUPS_MANAGED_BY = ' a-client , b-client ,'
      process.env.CROMBOLO_GROUPS_MANAGED_AT = 'https://dir.example/{alias}'
      expect(loadConfig({}).groups).toEqual({
        managedBy: ['a-client', 'b-client'],
        managedAt: 'https://dir.example/{alias}',
      })
    } finally {
      process.env.CROMBOLO_GROUPS_MANAGED_BY = before.by ?? ''
      process.env.CROMBOLO_GROUPS_MANAGED_AT = before.at ?? ''
    }
    expect(() => loadConfig({ groups: { managedBy: [''] } })).toThrow('groups.managedBy')
    expect(() => loadConfig({ groups: { managedBy: [], managedAt: 'ftp://x' } })).toThrow(
      'groups.managedAt',
    )
  })
})

describe(`user groups defined outside the site (${dialectUnderTest})`, () => {
  test('only the directory creates, changes and deletes a group', async () => {
    const { h, directory } = await site()
    expect((await h.post(`${V1}/user-group`, group('locals', null))).status).toBe(403)
    const made = await directory('POST', `${V1}/user-group`, group('shared-one', null))
    expect(made.status, await made.clone().text()).toBe(201)
    const key = made.headers.get('umb-generated-resource') as string
    expect((await h.put(`${V1}/user-group/${key}`, group('shared-one', null))).status).toBe(403)
    expect(
      (
        await directory('PUT', `${V1}/user-group/${key}`, {
          ...group('shared-one', null),
          name: 'One',
        })
      ).status,
    ).toBe(200)
    expect((await h.call(`${V1}/user-group/${key}`, { method: 'DELETE' })).status).toBe(403)
    expect((await directory('DELETE', `${V1}/user-group/${key}`)).status).toBe(200)
  }, 30_000)

  test('a start node not here yet waits, giving no start, and applies when its item arrives', async () => {
    const root = mkdtempSync(join(process.cwd(), 'output', 'groups-managed-site-'))
    for (const dir of ['schema/content-types', 'components'])
      mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    writeFileSync(
      join(root, 'schema', 'content-types', 'page.toml'),
      '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\n',
    )
    const { h, directory } = await site({
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
    })
    const page = crypto.randomUUID()
    const made = await directory(
      'POST',
      `${V1}/user-group`,
      group('arriving', page, [
        {
          $type: 'DocumentPermissionPresentationModel',
          document: { id: page },
          verbs: ['Umb.Document.Read'],
        },
      ]),
    )
    expect(made.status, await made.clone().text()).toBe(201)
    const key = made.headers.get('umb-generated-resource') as string
    expect(
      await h.json<{ href: string | null; waiting: string[] }>(`${PLUGIN}?group=${key}`),
    ).toEqual({
      href: 'https://people.example.test/groups/arriving',
      waiting: ['document'],
    })
    const users = new UserRepository(h.server.db)
    const access = async () => (await users.access(0, [key])).groupStartNodes.document.flat()
    expect(await access()).toEqual([])

    const types = new ContentTypeRepository(h.server.db)
    const typeKey = (await types.all()).find((t) => t.allowedAsRoot && !t.isElement)?.key as string
    expect(typeKey).toBeDefined()
    const created = await h.post(`${V1}/document`, {
      id: page,
      documentType: { id: typeKey },
      template: null,
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Arrived' }],
    })
    expect(created.status, await created.clone().text()).toBe(201)
    expect(await h.json<{ waiting: string[] }>(`${PLUGIN}?group=${key}`)).toMatchObject({
      waiting: [],
    })
    expect(await access()).toContain(page)
    const stored = await new UserGroupRepository(h.server.db).byKey(key)
    expect(stored?.granular.some((g) => g.key === page)).toBe(true)
    rmSync(root, { recursive: true, force: true })
  }, 30_000)

  test('the back office is told, and a bundle carrying a group is refused', async () => {
    const { h } = await site()
    expect(await h.json<unknown>(PLUGIN)).toMatchObject({
      groupsManaged: true,
      groupsLinked: true,
    })
    const root = mkdtempSync(join(process.cwd(), 'output', 'groups-managed-bundle-'))
    try {
      const out = join(root, 'site.tgz')
      await exportSite(h.server.db, h.server.config, {
        out,
        media: false,
        withUsers: true,
        passphrase: 'a long enough passphrase',
      })
      const dir = join(root, 'site')
      await extractTarball(out, dir)
      const input = { bundle: dir, passphrase: 'a long enough passphrase' }
      const refused = await checkBundleContent(h.server.db, h.server.config, input)
      expect(refused.check.outstanding.map((f) => f.code)).toContain('groups-managed')
      const without = await checkBundleContent(h.server.db, h.server.config, {
        ...input,
        excludePeople: true,
      })
      expect(without.check.findings.map((f) => f.code)).not.toContain('groups-managed')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)

  test('without the setting, groups are the site’s as before', async () => {
    const { h } = await site({ groups: { managedBy: [] } })
    expect((await h.post(`${V1}/user-group`, group('locals', null))).status).toBe(201)
    expect(await h.json<unknown>(PLUGIN)).toMatchObject({ groupsManaged: false })
    const missing = await h.post(`${V1}/user-group`, group('nowhere', crypto.randomUUID()))
    expect(missing.status).toBe(404)
  }, 30_000)
})

describe('User Groups where groups are defined outside', () => {
  test('hides what changes a group, and links each to where it is defined', () => {
    const excluded: string[] = []
    const registered: string[] = []
    const r = {
      exclude: (alias: string) => excluded.push(alias),
      register: (manifest: { alias: string }) => registered.push(manifest.alias),
    }
    expect(applyGroupsManaged(r, { groupsManaged: true, groupsLinked: true })).toBe(true)
    expect(excluded).toEqual(GROUPS_HIDDEN)
    expect(registered).toEqual([OPEN_GROUP_IN_DIRECTORY.alias])
    expect(applyGroupsManaged(r, { groupsManaged: false, groupsLinked: false })).toBe(false)
  })
})
