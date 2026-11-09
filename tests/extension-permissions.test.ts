/**
 * Story 308: each permission an extension asks for says why; the areas are
 * reached through the Management API, held to the grant; and an extension
 * acting as itself holds nothing it was not granted.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  isSchema3Field,
  permissionsProblem,
  readPermissions,
  validateBundlePackage,
} from '@crombolo/backoffice-host'
import { route } from '@crombolo/common'
import { AuditLog } from '@crombolo/data'
import {
  ApiRefusedError,
  type BundleApi,
  permissionsFor,
  type ServerBundle,
  VERSION,
} from '@crombolo/server'
import { extensionPrincipal } from '../packages/server/src/bundle-api.ts'
import { siteDeclaring } from './support/bundles.ts'
import { BACKOFFICE, type Harness, signedInServer, V1 } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

describe('the manifest, schema 4', () => {
  test('each permission with its reason, http.outbound with its origins', () => {
    const read = readPermissions({
      'content.read': 'Shows where each rule goes',
      'http.outbound': { reason: 'Checks the target', origins: ['https://api.acme.com'] },
    })
    expect(read).toEqual({
      declared: [
        { permission: 'content.read', reason: 'Shows where each rule goes' },
        {
          permission: 'http.outbound',
          reason: 'Checks the target',
          origins: ['https://api.acme.com'],
        },
      ],
    })
  })

  test('refuses a missing reason, an unknown permission, users.write and a bad origin, naming each', () => {
    const problem = permissionsProblem({
      'content.read': '',
      'pages.read': 'x',
      'users.write': 'To make editors',
      'http.outbound': { reason: 'x', origins: ['ftp://files.acme.com'] },
    })
    expect(problem).toContain('"content.read" gives no reason')
    expect(problem).toContain('"pages.read" is not a permission')
    expect(problem).toContain('"users.write" is never offered')
    expect(problem).toContain('"ftp://files.acme.com", which is not an origin')
  })

  test('schema 3 is still read, and known for what it is', () => {
    expect(permissionsProblem(['documents.read'], 3)).toBeUndefined()
    expect(isSchema3Field({ server: 'x', schemaVersion: 3, permissions: ['documents.read'] })).toBe(
      true,
    )
    expect(isSchema3Field({ server: 'x', schemaVersion: 4, permissions: {} })).toBe(false)
    const json = {
      name: '@acme/x',
      version: '1.0.0',
      peerDependencies: { '@crombolo/crombolo': `>=${VERSION}` },
      crombolo: {
        bundleType: 'extension',
        id: 'acme-x',
        server: 'x',
        schemaVersion: 4,
        permissions: ['content.read'],
      },
    }
    expect(validateBundlePackage(json).join()).toContain('is an object')
  })
})

describe('what each permission reaches', () => {
  test('reads and writes apart, and one area is not another', () => {
    expect(permissionsFor('GET', 'management/api/v1/document/abc')).toEqual(['content.read'])
    expect(permissionsFor('POST', 'management/api/v1/document')).toEqual(['content.write'])
    expect(permissionsFor('GET', 'management/api/v1/document-type/abc')).toEqual([
      'contentTypes.read',
    ])
    expect(permissionsFor('GET', 'crombolo/api/forms/entries/abc')).toEqual(['formEntries.read'])
    expect(permissionsFor('GET', 'crombolo/api/forms')).toEqual(['forms.read'])
  })

  test('users are read only, and the current user is nobody’s', () => {
    expect(permissionsFor('GET', 'management/api/v1/user')).toEqual(['users.read'])
    expect(permissionsFor('POST', 'management/api/v1/user')).toEqual([])
    expect(permissionsFor('GET', 'management/api/v1/user/current')).toEqual([])
  })
})

describe('an extension acting as itself', () => {
  test('holds only what its grant gives, and is never an administrator', () => {
    const principal = extensionPrincipal({ id: 'crm', name: 'CRM' }, ['content.read'])
    expect(principal.isAdmin).toBe(false)
    expect(principal.allowedSections).toEqual(['Umb.Section.Content'])
    expect(principal.permissions).toContain('Umb.Document.Read')
    expect(principal.permissions).not.toContain('Umb.Document.Update')
    expect(principal.name).toBe('Extension CRM')
  })
})

/** A site whose extension calls the Management API from a back-office route. */
async function extensionSite(permissions: Record<string, unknown>) {
  const dir = siteDeclaring('extension-permissions', {
    '@acme/crm': {
      json: {
        crombolo: { id: 'crm', name: 'CRM', server: 'crm', schemaVersion: 4, permissions },
      },
    },
  })
  const bundle: ServerBundle<'api'> = {
    id: 'crm',
    section: 'settings',
    capabilities: ['api'],
    routes: [
      route<unknown, unknown, { bundle: { api: BundleApi } }>(
        'call',
        {
          async POST(request, { bundle }) {
            const { method, path, body } = (await request.json()) as {
              method: string
              path: string
              body?: unknown
            }
            try {
              const response = await bundle.api.request(method, path, body)
              return new Response(await response.text(), { status: response.status })
            } catch (error) {
              if (error instanceof ApiRefusedError)
                return Response.json({ refused: error.message }, { status: 403 })
              throw error
            }
          },
        },
        { audience: 'backoffice' },
      ),
    ],
  }
  const h = await signedInServer({
    config: {
      siteDir: dir,
      componentsDir: join(dir, 'components'),
      bundles: [bundle as unknown as ServerBundle],
    },
  })
  open.push(h)
  const call = (method: string, path: string, body?: unknown) =>
    h.call(`${BACKOFFICE}/crombolo/api/bundle/crm/call`, {
      method: 'POST',
      body: JSON.stringify({ method, path, body }),
      headers: { 'content-type': 'application/json' },
    })
  return { h, call }
}

describe(`the api capability`, () => {
  test('reads what its grant covers, and refuses the rest before calling', async () => {
    const { call } = await extensionSite({ 'contentTypes.read': 'Lists the types' })
    const types = await call('GET', 'management/api/v1/tree/document-type/root?skip=0&take=10')
    expect(types.status, await types.clone().text()).toBe(200)
    const refused = await call('POST', 'management/api/v1/document-type', { name: 'X' })
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { refused: string }).refused).toContain(
      'it needs contentTypes.write',
    )
    const elsewhere = await call('GET', 'management/api/v1/user')
    expect(((await elsewhere.json()) as { refused: string }).refused).toContain('users.read')
  })

  test('acting as itself, what it writes is audited as the extension', async () => {
    const { h, call } = await extensionSite({ 'dictionary.write': 'Adds its words' })
    const made = await call('POST', 'management/api/v1/dictionary', {
      name: 'Crm.Greeting',
      parent: null,
      translations: [],
    })
    expect(made.status, await made.clone().text()).toBeLessThan(300)
    const entries = (await new AuditLog(h.server.db).query({}, { skip: 0, take: 50 })).items
    expect(entries.some((entry) => entry.userName === 'Extension CRM')).toBe(true)
  })

  test('the Management API refuses what its principal does not hold, even under a grant', async () => {
    // Reads of content need content.read; its principal has no Settings section for types.
    const { call } = await extensionSite({ 'content.read': 'Shows pages' })
    const pages = await call('GET', 'management/api/v1/tree/document/root?skip=0&take=10')
    expect(pages.status, await pages.clone().text()).toBe(200)
    expect(
      (await call('GET', `${V1.replace(/^.*?management/, 'management')}/document-type/x`)).status,
    ).toBe(403)
  })
})

describe('the boot', () => {
  test('refuses event handlers without events.content, and site routes without routes.public', async () => {
    const dir = siteDeclaring('extension-permissions-boot', {
      '@acme/hooks': {
        json: {
          crombolo: {
            id: 'hooks',
            name: 'Hooks',
            server: 'hooks',
            schemaVersion: 4,
            permissions: {},
          },
        },
      },
    })
    const bundle = {
      id: 'hooks',
      section: 'settings',
      capabilities: [],
      events: { 'Umbraco.ContentPublish': () => ({ ok: true }) },
      routes: [route('/hello', { GET: () => new Response('hi') })],
    } as unknown as ServerBundle
    await expect(
      signedInServer({
        config: { siteDir: dir, componentsDir: join(dir, 'components'), bundles: [bundle] },
      }),
    ).rejects.toThrow(/needs "events\.content"[\s\S]*needs "routes\.public"/)
  })
})
