/**
 * Story 325: `user.delegate` lets an extension act for the person using it,
 * across every area, through the CMS, and replaces `actAs`. It reaches nothing
 * beyond what that person holds, never installs or grants extensions or
 * changes users and groups for anyone, acts for whoever granted it when nobody
 * is using it, and every write it makes is recorded as the extension for them.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { describePermissions, readPermissions, USER_DELEGATE } from '@crombolo/backoffice-host'
import {
  attributed,
  delegatedPermissions,
  extensionEntryProblems,
  refusedForEveryone,
  userKeyOf,
} from '@crombolo/server'
import { retireActAs } from '../packages/cli/src/support/extension-migrate.ts'
import { linkedDependencies, siteDeclaring, stubBundlePackage } from './support/bundles.ts'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

describe('the manifest', () => {
  test('asks for user.delegate with its reason, and the install says what it means', () => {
    expect(readPermissions({ 'user.delegate': 'Edits pages in bulk for you' })).toEqual({
      declared: [{ permission: 'user.delegate', reason: 'Edits pages in bulk for you' }],
    })
    const [described] = describePermissions([{ permission: USER_DELEGATE, reason: 'x' }])
    expect(described?.allows).toBe(
      'Act for the person using it in the back office: it can do anything they can do here, and everything it does is recorded against them',
    )
    expect(described?.warning).toContain('acts for whoever granted it instead')
  })

  test('actAs is refused by name, pointing at user.delegate', () => {
    const read = readPermissions({ actAs: 'Acts for you', 'content.read': 'x' })
    expect('problem' in read && read.problem).toContain(
      '"actAs" is retired: ask for "user.delegate"',
    )
  })

  test('user.delegate beside an area is refused, naming what to drop', () => {
    const read = readPermissions({
      'user.delegate': 'x',
      'content.read': 'x',
      'events.content': 'x',
    })
    expect('problem' in read && read.problem).toBe(
      '"user.delegate" already reaches every area the person using it may: drop "content.read"',
    )
  })
})

describe('what it reaches', () => {
  const person = (over: object) =>
    ({ isAdmin: false, allowedSections: [], permissions: [], ...over }) as never

  test('every area for an administrator, the areas of their sections for anyone else', () => {
    const all = delegatedPermissions([USER_DELEGATE], person({ isAdmin: true }))
    expect(all).toContain('content.write')
    expect(all).toContain('identityProviders.write')
    expect(all).not.toContain('users.write')
    const writer = delegatedPermissions(
      [USER_DELEGATE],
      person({ allowedSections: ['Umb.Section.Content'] }),
    )
    expect(writer).toContain('content.write')
    expect(writer).toContain('redirects.read')
    expect(writer).not.toContain('webhooks.read')
    expect(writer).not.toContain('members.read')
  })

  test('nobody, or a grant without it, adds nothing', () => {
    expect(delegatedPermissions([USER_DELEGATE], undefined)).toEqual([USER_DELEGATE])
    expect(delegatedPermissions(['content.read'], person({ isAdmin: true }))).toEqual([
      'content.read',
    ])
  })

  test('three things are refused for anyone: extensions, a remote, and users and groups', () => {
    for (const [method, path] of [
      ['POST', 'crombolo/api/extensions/install'],
      ['POST', 'crombolo/api/bundles/grant'],
      ['GET', 'crombolo/api/extensions/installed'],
      ['POST', 'remote/v1/bundles/x/grant'],
      ['POST', 'management/api/v1/user'],
      ['PUT', 'management/api/v1/user/1/'],
      ['DELETE', 'management/api/v1/user-group/1'],
    ] as const)
      expect([method, path, refusedForEveryone(method, path)]).toEqual([
        method,
        path,
        expect.stringMatching(/for anyone$/),
      ])
    expect(refusedForEveryone('GET', 'management/api/v1/user/current')).toBeUndefined()
    expect(refusedForEveryone('PUT', 'management/api/v1/document/1')).toBeUndefined()
  })
})

describe('granted only by someone signed in', () => {
  test('the config may not grant it, and says who may', () => {
    const problems = extensionEntryProblems({ bulk: { grant: [USER_DELEGATE] } }, [
      stubBundlePackage('bulk'),
    ])
    expect(problems).toEqual([
      expect.stringContaining(
        'The config\'s extensions grants "bulk" user.delegate, which only an administrator who is signed in may grant',
      ),
    ])
  })

  test('a script names the person by key', () => {
    expect(userKeyOf(' 1E5B8C2A-0000-4000-8000-000000000001 ')).toBe(
      '1e5b8c2a-0000-4000-8000-000000000001',
    )
    expect(userKeyOf('caller')).toBeNull()
  })
})

describe('extension migrate', () => {
  test('rewrites actAs to user.delegate, keeping its reason and dropping the areas it covers', () => {
    expect(
      retireActAs({
        actAs: 'Edits pages for you',
        'content.read': 'x',
        'content.write': 'x',
        'http.outbound': { reason: 'x', origins: ['https://api.acme.com'] },
      }),
    ).toEqual({
      permissions: {
        'http.outbound': { reason: 'x', origins: ['https://api.acme.com'] },
        'user.delegate': 'Edits pages for you',
      },
      dropped: ['content.read', 'content.write'],
    })
    expect(retireActAs({ 'content.read': 'x' })).toBeUndefined()
  })
})

describe('the audit log', () => {
  test('tells the extension acting for a person apart from the person', () => {
    expect(attributed('Bulk Editor', 'Adam', 'Saved')).toBe('Bulk Editor, for Adam: Saved')
    expect(attributed('Bulk Editor', 'Adam', null)).toBe('Bulk Editor, for Adam')
  })
})

/** An extension that acts for whoever uses it, from a route and from a job. */
const DELEGATE = `import { route } from '@crombolo/extension'

const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null) })
const attempt = async (fn) => {
  try {
    return await fn()
  } catch (error) {
    return { refused: error?.message ?? String(error) }
  }
}

export function delegate() {
  return {
    id: 'delegate',
    section: 'content',
    capabilities: ['api'],
    jobs: {
      async whoami(_payload, { bundle, job }) {
        const made = await bundle.api.post('management/api/v1/dictionary', { name: 'job-word', translations: [] })
        await job.progress(1, 1, String(made.status))
      },
    },
    routes: [
      route('webhooks', { GET: async (_r, { bundle }) => Response.json(await json(await bundle.api.get('management/api/v1/webhook?take=1'))) }, { audience: 'backoffice' }),
      route('make-user', { POST: async (_r, { bundle }) => Response.json(await attempt(() => bundle.api.post('management/api/v1/user', { email: 'x@example.com' }))) }, { audience: 'backoffice' }),
      route('install', { POST: async (_r, { bundle }) => Response.json(await attempt(() => bundle.api.post('crombolo/api/extensions/install', { name: 'x' }))) }, { audience: 'backoffice' }),
      route('word', { POST: async (_r, { bundle }) => Response.json(await json(await bundle.api.post('management/api/v1/dictionary', { name: 'delegated-word', translations: [] }))) }, { audience: 'backoffice' }),
      route('later', {
        POST: async (_r, { bundle }) => Response.json({ id: await bundle.jobs.enqueue('whoami', {}) }),
        GET: async (_r, { url, bundle }) => Response.json(await bundle.jobs.status(url.searchParams.get('id'))),
      }, { audience: 'backoffice' }),
    ],
  }
}
`

/** The site, booted, granted user.delegate by the administrator, and booted again so it runs. */
async function delegateSite() {
  const dir = siteDeclaring('extension-delegate', {
    '@acme/delegate': {
      json: {
        exports: './index.js',
        crombolo: {
          id: 'delegate',
          name: 'Delegate',
          server: 'delegate',
          permissions: { 'user.delegate': 'Works for the person using it' },
        },
      },
      files: { 'index.js': DELEGATE },
    },
  })
  linkedDependencies(dir)
  const config = {
    siteDir: dir,
    componentsDir: join(dir, 'components'),
    sqliteFile: join(dir, 'site.sqlite'),
  }
  const first = await signedInServer({ config })
  const granted = await first.post(`${BACKOFFICE}/crombolo/api/bundles/grant`, {
    id: 'delegate',
    grant: [USER_DELEGATE],
  })
  expect(granted.status, await granted.clone().text()).toBe(200)
  await first.db.close()
  const h = await signedInServer({ config, keepDatabase: true })
  open.push(h)
  return h
}

/** Who the audit log says made the dictionary word with this name, and how. */
async function attributedTo(h: Harness, name: string) {
  const log = await h.json<{
    items: { item: { name: string | null }; user: { name: string } | null; detail: string | null }[]
  }>(`${BACKOFFICE}/crombolo/api/audit?take=100`)
  const entry = log.items.find((candidate) => candidate.item.name === name)
  if (!entry) throw new Error(`No entry names ${name}.`)
  return { userName: entry.user?.name, detail: entry.detail }
}

const route = (path: string) => `${BACKOFFICE}/crombolo/api/bundle/delegate/${path}`

describe(`acting for the person, through its own process (${dialectUnderTest})`, () => {
  test('a route acts as whoever calls it, and nothing beyond what they hold', async () => {
    const h = await delegateSite()
    expect((await h.json<{ status: number }>(route('webhooks'))).status).toBe(200)
    const writer = await signInAsGroup(h, 'writer')
    // A writer holds no Settings, so the API refuses it the webhooks, as it would them.
    expect((await writer.json<{ status: number }>(route('webhooks'))).status).toBe(403)
  }, 90_000)

  test('installing, granting and changing users are refused for an administrator too', async () => {
    const h = await delegateSite()
    const made = await (await h.post(route('make-user'), {})).json()
    expect(made.refused).toMatch(/may not change users or groups, for anyone/)
    const installed = await (await h.post(route('install'), {})).json()
    expect(installed.refused).toMatch(/may not install or grant extensions/)
  }, 90_000)

  test('what it writes is recorded as the extension, for the person', async () => {
    const h = await delegateSite()
    const word = await (await h.post(route('word'), {})).json()
    expect(word.status, JSON.stringify(word)).toBe(201)
    expect(await attributedTo(h, 'delegated-word')).toEqual({
      userName: 'Administrator',
      detail: expect.stringMatching(/^Delegate, for Administrator/),
    })
  }, 90_000)

  test('a job, with nobody using it, acts for whoever granted it', async () => {
    const h = await delegateSite()
    const { id } = await (await h.post(route('later'), {})).json()
    await h.server.backgroundJobs.runDue()
    const status = await h.json<{ state: string; progress: { note: string } }>(
      route(`later?id=${id}`),
    )
    expect(status).toMatchObject({ state: 'succeeded', progress: { note: '201' } })
    expect(await attributedTo(h, 'job-word')).toEqual({
      userName: 'Administrator',
      detail: expect.stringMatching(/^Delegate, for Administrator/),
    })
  }, 90_000)
})
