/**
 * Story 367: an exchanged sign-in never skips a workflow. A token exchanged
 * through a provider (364) is gated as the command line is, even for an
 * administrator whose workflow lets publishers skip: it may send a page for
 * approval but never publish over one, edit past `on-edit`, skip approval on a
 * rollback or push the whole site while any workflow exists.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ContentTypeRepository,
  ExternalLoginRepository,
  externalLoginProvider,
  UserGroupRepository,
} from '@crombolo/data'
import { JWT_TOKEN_TYPE, oidc, REMOTE_API_PATH, TOKEN_EXCHANGE_GRANT } from '@crombolo/server'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const API = `${ORIGIN}${REMOTE_API_PATH}`
const APPROVALS = `${BACKOFFICE}/crombolo/api/approvals`
const AUDIENCE = 'api://crombolo-remote'

const TYPE = (alias: string) => `[content-type]
alias = "${alias}"
name = "${alias}"
allow-at-root = true
components = ["${alias}"]
default-component = "${alias}"

[[property]]
alias = "body"
name = "Body"
type = "textarea"
`

const WORKFLOW = (onEdit: string) => `[workflow]
alias = "policy-sign-off"
name = "Policy sign-off"
applies-to = { branches = [], content-types = ["policy"] }
publishers-may-skip = true
on-edit = "${onEdit}"
unpublish = true

[[stage]]
alias = "legal"
approvers = ["admin"]
`

let issuer = ''
let server: ReturnType<typeof Bun.serve>
let privateKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === '/.well-known/openid-configuration')
        return Response.json({ issuer, jwks_uri: `${issuer}/jwks` })
      if (pathname === '/jwks') return Response.json({ keys: [jwk] })
      return new Response('Not Found', { status: 404 })
    },
  })
  issuer = `http://localhost:${server.port}`
})
afterAll(() => server.stop(true))

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

/** A site with a Policy type under a workflow publishers may skip, a Note under none, and the admin signed in by exchange. */
async function site(onEdit = 'withdraw') {
  const root = mkdtempSync(join(process.cwd(), 'output', 'exchange-workflows-'))
  dirs.push(root)
  for (const dir of ['content-types', 'workflows'])
    mkdirSync(join(root, 'schema', dir), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  for (const alias of ['policy', 'note']) {
    writeFileSync(join(root, 'schema', 'content-types', `${alias}.toml`), TYPE(alias))
    writeFileSync(join(root, 'components', `${alias}.tsx`), 'export default () => <main />\n')
  }
  writeFileSync(join(root, 'schema', 'workflows', 'policy-sign-off.toml'), WORKFLOW(onEdit))
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      remote: {
        enabled: true,
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 1024 ** 3,
      },
      backofficeIdentityProviders: [
        oidc({
          id: 'corp',
          name: 'Corp',
          issuer,
          clientId: 'back-office-app',
          claims: { identity: 'oid' },
          remoteExchange: { audience: AUDIENCE },
        }),
      ],
    },
  })
  open.push(h)
  // An administrator who may push a whole site, code and all, when nothing else stops it.
  const groups = new UserGroupRepository(h.server.db)
  const admins = await groups.byAlias('admin')
  if (!admins) throw new Error('no admin group')
  expect(
    await groups.save({
      ...admins,
      permissions: [...admins.permissions, 'Crombolo.Remote.InstallCode'],
    }),
  ).toBe('saved')
  const me = await h.json<{ id: string }>(`${V1}/user/current`)
  await new ExternalLoginRepository(h.server.db).link(
    me.id,
    externalLoginProvider('user', 'corp'),
    'sign-in-sub',
    { value: 'oid-admin', issuer },
  )
  const now = Math.floor(Date.now() / 1000)
  const providerToken = await new SignJWT({ oid: 'oid-admin', sub: 'pairwise' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .setJti(randomUUID())
    .sign(privateKey)
  const exchanged = await h.server.fetch(
    new Request(`${API}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: TOKEN_EXCHANGE_GRANT,
        subject_token: providerToken,
        subject_token_type: JWT_TOKEN_TYPE,
      }),
    }),
  )
  expect(exchanged.status).toBe(200)
  const token = ((await exchanged.json()) as { access_token: string }).access_token
  const tool = (
    url: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    h.server.fetch(
      new Request(url.startsWith('/') ? `${ORIGIN}${url}` : url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...headers,
          authorization: `Bearer ${token}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  const types = new ContentTypeRepository(h.server.db)
  const page = async (type: 'policy' | 'note', name: string) => {
    const created = await h.post(`${V1}/document`, {
      documentType: { id: (await types.byAlias(type))?.key },
      template: null,
      parent: null,
      values: [{ alias: 'body', culture: null, segment: null, value: `${name} text` }],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(created.status).toBe(201)
    return created.headers.get('umb-generated-resource') as string
  }
  return { h, tool, page }
}

const PUBLISH = { publishSchedules: [] }

describe(`an exchanged sign-in and workflows (${dialectUnderTest})`, () => {
  test('never publishes a covered page, though the person may skip, and sends it instead', async () => {
    const { h, tool, page } = await site()
    const key = await page('policy', 'Privacy')

    const refused = await tool(`${V1}/document/${key}/publish`, 'PUT', PUBLISH)
    expect(refused.status).toBe(400)
    expect((await refused.json()).detail).toContain('needs approval through "Policy sign-off"')
    const branch = await tool(`${V1}/document/${key}/publish-with-descendants`, 'PUT', {
      cultures: [],
      includeUnpublishedDescendants: true,
    })
    expect(branch.status).toBe(400)
    expect(
      (await tool(`${APPROVALS}/page/${key}/send`, 'POST', { action: 'publish' })).status,
    ).toBe(200)

    // The same person, signed in themselves, may still skip.
    const other = await page('policy', 'Terms')
    expect((await h.put(`${V1}/document/${other}/publish`, PUBLISH)).status).toBe(200)
    const down = await tool(`${V1}/document/${other}/unpublish`, 'PUT', { cultures: null })
    expect(down.status).toBe(400)
    expect((await down.json()).detail).toContain('needs approval through "Policy sign-off"')
  })

  test('a page no workflow covers publishes as before', async () => {
    const { tool, page } = await site()
    const key = await page('note', 'Opening hours')
    expect((await tool(`${V1}/document/${key}/publish`, 'PUT', PUBLISH)).status).toBe(200)
  })

  test('on-edit holds it, though the person is an administrator', async () => {
    const { h, tool, page } = await site('lock')
    const key = await page('policy', 'Privacy')
    expect((await h.post(`${APPROVALS}/page/${key}/send`, { action: 'publish' })).status).toBe(200)
    const etag = (await tool(`${V1}/document/${key}`)).headers.get('etag') as string
    const save = {
      template: null,
      values: [{ alias: 'body', culture: null, segment: null, value: 'changed' }],
      variants: [{ culture: null, segment: null, name: 'Privacy' }],
    }
    const refused = await tool(`${V1}/document/${key}`, 'PUT', save, { 'if-match': etag })
    expect(refused.status).toBe(400)
    expect(JSON.stringify(await refused.json())).toContain('waiting for approval')
    const own = await h.call(`${V1}/document/${key}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'if-match': etag },
      body: JSON.stringify(save),
    })
    expect(own.status).toBe(200)
  })

  test('skips no approval on a rollback, and pushes no site while a workflow exists', async () => {
    const { tool } = await site()
    const rollback = await tool(
      `${API}/environments/production/content/versions/1/rollback`,
      'POST',
      { skipApproval: true },
    )
    expect(rollback.status).toBe(403)
    expect((await rollback.json()).title).toContain('cannot skip approval')

    const push = await tool(`${API}/environments/production/pushes`, 'PUT', undefined, {
      'crombolo-sha256': 'a'.repeat(64),
    })
    expect(push.status).toBe(403)
    const problem = (await push.json()) as { code: string; detail: string }
    expect(problem.code).toBe('workflow-covers-pages')
    expect(problem.detail).toContain('Policy sign-off')
  })
})
