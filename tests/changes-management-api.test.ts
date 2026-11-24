/**
 * Story 394: a change moved through the Management API. A recorded change or an open
 * workspace is exported as the remote gives it, and a change is checked, staged or
 * applied by `PUT changes`, for a sign-in token in `Authorization` alone, with the
 * remote's rights and limits and the remote switched off. Under
 * `applyChangesBy: 'exchange'` only a sign-in exchanged for applying one may.
 *
 * Two sites cannot share one Postgres schema in a test, so each test runs the
 * source first, takes its change as bytes, and then the target.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RemotePermissions } from '@crombolo/core'
import {
  ComponentRepository,
  ContentTypeRepository,
  ExternalLoginRepository,
  externalLoginProvider,
  UserGroupRepository,
  WorkspaceRepository,
} from '@crombolo/data'
import {
  type CromboloConfig,
  exchangeAudienceClashes,
  exchangingProviders,
  JWT_TOKEN_TYPE,
  loadConfig,
  oidc,
  REMOTE_API_PATH,
  TOKEN_EXCHANGE_GRANT,
} from '@crombolo/server'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { packChange, unpackChange } from '../packages/server/src/remote-changes.ts'
import { dialectUnderTest } from './support/db.ts'
import {
  BACKOFFICE,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
  V1,
} from './support/harness.ts'

const CHANGES = `${BACKOFFICE}/crombolo/api/changes`
const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`
const HOME = '6b2f1f0e-3c1d-4a8e-9f00-000000000394'
const AUDIENCE = 'api://crombolo-remote'
const APPLY_AUDIENCE = 'api://crombolo-apply'

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

let issuer = ''
let idp: ReturnType<typeof Bun.serve>
let privateKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
  idp = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === '/.well-known/openid-configuration')
        return Response.json({ issuer, jwks_uri: `${issuer}/jwks` })
      if (pathname === '/jwks') return Response.json({ keys: [jwk] })
      return new Response('Not Found', { status: 404 })
    },
  })
  issuer = `http://localhost:${idp.port}`
})
afterAll(() => idp.stop(true))

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

interface Bytes {
  bytes: Uint8Array
  sha: string
}

/** The signed-in session's own access token, as a tool would send it. */
const tokenOf = (h: Harness) => /umbAccessToken[^=]*=([^;]+)/.exec(h.cookie())?.[1] as string

const providerToken = async (audience: string | string[]) => {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ oid: 'oid-1', sub: 'pairwise' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .setJti(randomUUID())
    .sign(privateKey)
}

/** One copy of the site, with the remote off, holding Home as both copies began. */
async function site(config: Partial<CromboloConfig> = {}) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'changes-api-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
      schemaWritable: true,
      workspaces: true,
      remote: {
        enabled: false,
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 16 * 1024 ** 2,
      },
      ...config,
    },
  })
  open.push(h)
  const db = h.server.db
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const send = (method: string, path: string, body?: unknown, headers = {}) =>
    h.call(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const at = (workspace?: string): Record<string, string> =>
    workspace ? { 'crombolo-workspace': workspace } : {}
  const read = async (key: string, workspace?: string) =>
    (await (await h.call(`${V1}/document/${key}`, { headers: at(workspace) })).json()) as Record<
      string,
      unknown
    > & { values: Array<{ alias: string; value: unknown }> }
  const title = async (key: string) =>
    (await read(key)).values.find((v) => v.alias === 'title')?.value
  const publish = async (key: string, workspace?: string) =>
    expect(
      (
        await send(
          'PUT',
          `${V1}/document/${key}/publish`,
          { publishSchedules: [{ culture: null }] },
          at(workspace),
        )
      ).status,
    ).toBe(200)
  const created = await send('POST', `${V1}/document`, {
    id: HOME,
    documentType: { id: typeKey },
    template: { id: componentKey },
    parent: null,
    values: [{ alias: 'title', culture: null, segment: null, value: 'Welcome' }],
    variants: [{ culture: null, segment: null, name: 'Home' }],
  })
  expect(created.status, await created.clone().text()).toBe(201)
  await publish(HOME)

  /** Home's title set in a new workspace, which is left open. */
  const retitled = async (value: string) => {
    const made = await send('POST', WORKSPACES, { name: 'Spring sale' })
    expect(made.status).toBe(201)
    const { key } = (await made.json()) as { key: string }
    const document = await read(HOME, key)
    const saved = await send(
      'PUT',
      `${V1}/document/${HOME}`,
      {
        ...document,
        values: document.values.map((v) => (v.alias === 'title' ? { ...v, value } : v)),
      },
      at(key),
    )
    expect(saved.status, await saved.clone().text()).toBe(200)
    await publish(HOME, key)
    return key
  }
  /** The change a workspace's merge recorded. */
  const merged = async (workspace: string) => {
    const response = await send('POST', `${WORKSPACES}/${workspace}/merge`, { accept: [] })
    expect(response.status, await response.clone().text()).toBe(200)
    const list = (await (await h.call(CHANGES)).json()) as { items: Array<{ id: string }> }
    return list.items[0]?.id as string
  }
  const bearer = (token: string, path: string, init: RequestInit = {}) =>
    h.server.fetch(
      new Request(`${ORIGIN}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
      }),
    )
  const take = async (token: string, path: string): Promise<Bytes> => {
    const response = await bearer(token, path)
    expect(response.status, await response.clone().text()).toBe(200)
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      sha: response.headers.get('crombolo-sha256') as string,
    }
  }
  const put = (token: string, change: Bytes, query = '', headers: Record<string, string> = {}) =>
    bearer(token, `${CHANGES}${query}`, {
      method: 'PUT',
      body: change.bytes as Uint8Array<ArrayBuffer>,
      headers: { 'crombolo-sha256': change.sha, 'content-type': 'application/gzip', ...headers },
    })
  const close = async () => {
    open.splice(open.indexOf(h), 1)
    await h.db.close()
  }
  return { h, send, title, retitled, merged, bearer, take, put, close }
}

/** A change made on a source site by a workspace's merge, taken through the Management API. */
async function madeThere(): Promise<Bytes> {
  const source = await site()
  const change = await source.merged(await source.retitled('Spring sale'))
  const bytes = await source.take(tokenOf(source.h), `${CHANGES}/${change}/bundle`)
  await source.close()
  return bytes
}

describe(`a change through the Management API (${dialectUnderTest})`, () => {
  test('a recorded change and an open workspace export as the remote gives them', async () => {
    const source = await site({
      remote: {
        enabled: true,
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 16 * 1024 ** 2,
        access: 'all',
      },
    })
    const token = tokenOf(source.h)
    const remote = (path: string) =>
      source.take(token, `${REMOTE_API_PATH}/environments/production/${path}`)
    const change = await source.merged(await source.retitled('Spring sale'))
    const here = await source.take(token, `${CHANGES}/${change}/bundle`)
    const there = await remote(`changes/${change}/bundle`)
    expect(here.sha).toBe(there.sha)
    expect(here.sha).toBe(new Bun.CryptoHasher('sha256').update(here.bytes).digest('hex'))

    const workspace = await source.retitled('Summer sale')
    const asChange = async (bytes: Bytes) => {
      const file = join(dirs[0] as string, `${bytes.sha}.tgz`)
      writeFileSync(file, bytes.bytes)
      const { change } = await unpackChange(file)
      return change.pages.map((p) => ({ key: p.key, action: p.action }))
    }
    expect(await asChange(await source.take(token, `${WORKSPACES}/${workspace}/change`))).toEqual(
      await asChange(await remote(`workspaces/${workspace}/change`)),
    )
  }, 30_000)

  test('with the remote off, a change is checked, staged and applied', async () => {
    const bundle = await madeThere()
    const target = await site()
    const token = tokenOf(target.h)

    const checked = await target.put(token, bundle, '?check=true')
    expect(checked.status, await checked.clone().text()).toBe(200)
    const check = (await checked.json()) as { pages: Array<{ key: string }> }
    expect(check.pages.map((p) => p.key)).toEqual([HOME])
    expect(await target.title(HOME)).toBe('Welcome')

    const staged = await target.put(token, bundle, '?stage=true&editable=true')
    expect(staged.status, await staged.clone().text()).toBe(200)
    const { workspace } = (await staged.json()) as { workspace: string }
    const held = await new WorkspaceRepository(target.h.server.db).byKey(workspace)
    expect(held?.ownerKey).toBe(((await target.h.json(`${V1}/user/current`)) as { id: string }).id)
    expect(held?.stagedReadOnly).toBe(false)
    expect(await target.title(HOME)).toBe('Welcome')
    await new WorkspaceRepository(target.h.server.db).discard(held?.id as number)

    const applied = await target.put(token, bundle)
    expect(applied.status, await applied.clone().text()).toBe(200)
    expect(await target.title(HOME)).toBe('Spring sale')
  }, 30_000)

  test('a cookie is not enough, nor the back office with its token redacted', async () => {
    const target = await site()
    const bundle = { bytes: new Uint8Array([1]), sha: '0'.repeat(64) }
    const cookieOnly = await target.h.call(CHANGES, {
      method: 'PUT',
      body: bundle.bytes,
      headers: { 'crombolo-sha256': bundle.sha },
    })
    expect(cookieOnly.status).toBe(401)
    const redacted = await target.h.call(`${CHANGES}/${randomUUID()}/bundle`, {
      headers: { authorization: 'Bearer [redacted]' },
    })
    expect(redacted.status).toBe(401)
    expect((await target.h.call(CHANGES)).status).toBe(200)
  })

  test('the hash and the size limit are checked as the remote checks them', async () => {
    const bundle = await madeThere()
    const target = await site({
      remote: {
        enabled: false,
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 64,
      },
    })
    const token = tokenOf(target.h)
    const missing = await target.bearer(token, CHANGES, {
      method: 'PUT',
      body: bundle.bytes as Uint8Array<ArrayBuffer>,
    })
    expect(missing.status).toBe(400)
    expect(((await missing.json()) as { message: string }).message).toBe(
      'Crombolo-Sha256 is required',
    )
    const tooLarge = await target.put(token, bundle)
    expect(tooLarge.status).toBe(413)
  }, 30_000)

  test('a wrong hash is refused', async () => {
    const bundle = await madeThere()
    const target = await site()
    const wrong = await target.put(tokenOf(target.h), { ...bundle, sha: 'a'.repeat(64) })
    expect(wrong.status).toBe(400)
    expect(await target.title(HOME)).toBe('Welcome')
  }, 30_000)

  test('each right is the remote own: Pull, Apply changes, and Install code for code', async () => {
    const bundle = await madeThere()
    const target = await site()
    const writer = await signInAsGroup(target.h, 'writer')
    const token = tokenOf(writer)
    expect((await target.bearer(token, `${CHANGES}/${randomUUID()}/bundle`)).status).toBe(403)
    const refused = await target.put(token, bundle)
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { message: string }).message).toBe(
      'You may not apply changes here',
    )

    const groups = new UserGroupRepository(target.h.server.db)
    const group = await groups.byAlias('writer')
    await groups.save({
      ...(group as NonNullable<typeof group>),
      permissions: [...(group?.permissions ?? []), RemotePermissions.ApplyChanges],
    })
    const file = join(dirs[0] as string, 'code.tgz')
    writeFileSync(file, bundle.bytes)
    const { change, media } = await unpackChange(file)
    const code = packChange(
      {
        ...change,
        files: [
          ...change.files,
          {
            path: 'components/banner.tsx',
            kind: 'component',
            class: 'code',
            before: null,
            after: 'export default () => <aside />\n',
            lastChange: null,
          },
        ],
      },
      media,
    )
    const withCode = {
      bytes: code,
      sha: new Bun.CryptoHasher('sha256').update(code).digest('hex'),
    }
    const noCode = await target.put(token, withCode, '?check=true')
    expect(noCode.status).toBe(403)
    expect(((await noCode.json()) as { detail: string }).detail).toContain('Install code')
    const applied = await target.put(token, bundle)
    expect(applied.status, await applied.clone().text()).toBe(200)
    expect(await target.title(HOME)).toBe('Spring sale')
  }, 30_000)

  test('under applyChangesBy exchange, only a sign-in exchanged for applying may apply', async () => {
    const bundle = await madeThere()
    const target = await site({
      applyChangesBy: 'exchange',
      backofficeIdentityProviders: [
        oidc({
          id: 'corp',
          name: 'Corp',
          issuer,
          clientId: 'back-office-app',
          claims: { identity: 'oid' },
          remoteExchange: { audience: AUDIENCE, applyAudience: APPLY_AUDIENCE },
        }),
      ],
    })
    const admin = await target.put(tokenOf(target.h), bundle, '?check=true')
    expect(admin.status).toBe(403)

    const groups = new UserGroupRepository(target.h.server.db)
    const writer = await groups.byAlias('writer')
    await groups.save({
      ...(writer as NonNullable<typeof writer>),
      permissions: [...(writer?.permissions ?? []), RemotePermissions.ApplyChanges],
    })
    const created = await target.h.post(`${V1}/user`, {
      kind: 'Default',
      email: 'pat@example.com',
      userName: 'pat@example.com',
      name: 'Pat',
      userGroupIds: [{ id: writer?.key }],
    })
    await new ExternalLoginRepository(target.h.server.db).link(
      created.headers.get('umb-generated-resource') as string,
      externalLoginProvider('user', 'corp'),
      'sign-in-sub',
      { value: 'oid-1', issuer },
    )
    const exchange = async (audience: string | string[]) =>
      target.h.server.fetch(
        new Request(`${ORIGIN}${REMOTE_API_PATH}/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: TOKEN_EXCHANGE_GRANT,
            subject_token: await providerToken(audience),
            subject_token_type: JWT_TOKEN_TYPE,
          }),
        }),
      )
    const exchanged = async (audience: string) => {
      const response = await exchange(audience)
      expect(response.status, await response.clone().text()).toBe(200)
      return ((await response.json()) as { access_token: string }).access_token
    }
    expect((await target.put(await exchanged(AUDIENCE), bundle, '?check=true')).status).toBe(403)
    expect((await exchange([AUDIENCE, APPLY_AUDIENCE])).status).toBe(400)
    const applied = await target.put(await exchanged(APPLY_AUDIENCE), bundle)
    expect(applied.status, await applied.clone().text()).toBe(200)
    expect(await target.title(HOME)).toBe('Spring sale')
  }, 30_000)
})

describe('the setting and the audience for applying', () => {
  test('applyChangesBy is any or exchange', () => {
    expect(loadConfig({}).applyChangesBy).toBe('any')
    expect(loadConfig({ applyChangesBy: 'exchange' }).applyChangesBy).toBe('exchange')
    expect(() => loadConfig({ applyChangesBy: 'anyone' as never })).toThrow(/any or exchange/)
  })

  test('an apply audience that is a sign-in client id, or the ordinary one, stops the boot', () => {
    const provider = (applyAudience: string) =>
      oidc({
        id: 'corp',
        name: 'Corp',
        issuer: 'https://id.example.com',
        clientId: 'back-office-app',
        remoteExchange: { audience: AUDIENCE, applyAudience },
      })
    const clashes = (applyAudience: string) => {
      const providers = [provider(applyAudience)]
      return exchangeAudienceClashes(exchangingProviders(providers, []), providers)
    }
    expect(clashes(APPLY_AUDIENCE)).toEqual([])
    expect(clashes('back-office-app')[0]).toContain('applyAudience is the client id')
    expect(clashes(AUDIENCE)[0]).toContain('applyAudience is its audience')
  })

  test('under exchange, the remote refuses a sign-in not exchanged for applying', async () => {
    const target = await site({
      applyChangesBy: 'exchange',
      remote: {
        enabled: true,
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 16 * 1024 ** 2,
        access: 'all',
      },
    })
    const refused = await target.bearer(
      tokenOf(target.h),
      `${REMOTE_API_PATH}/environments/production/changes`,
      { method: 'PUT', body: new Uint8Array([1]), headers: { 'crombolo-sha256': '0'.repeat(64) } },
    )
    expect(refused.status).toBe(403)
  })
})

// Story 422: wherever workspaces are on, a change is taken past the usual body limit, at
// its two routes alone, and no one without Apply changes gets a byte of it read.
describe(`a large change, remote access off (${dialectUnderTest})`, () => {
  const ON_THE_WIRE = { requestIP: () => null }
  const SMALL = 1024
  const serve = (h: Harness) =>
    h.server.serveOptions.fetch as unknown as (
      request: Request,
      server: typeof ON_THE_WIRE,
    ) => Promise<Response>
  const hashOf = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  const sent = (h: Harness, token: string, path: string, body: BodyInit, headers = {}) =>
    serve(h)(
      new Request(`${ORIGIN}${path}`, {
        method: 'PUT',
        body,
        headers: {
          'content-type': 'application/gzip',
          authorization: `Bearer ${token}`,
          ...headers,
        },
      }),
      ON_THE_WIRE,
    )

  test('the site listens with the larger limit, and with the usual one when workspaces are off', async () => {
    const on = await site({ maxRequestBodyBytes: SMALL })
    expect(on.h.server.serveOptions.maxRequestBodySize).toBe(16 * 1024 ** 2)
    const off = await site({ maxRequestBodyBytes: SMALL, workspaces: false })
    expect(off.h.server.serveOptions.maxRequestBodySize).toBe(SMALL)
  }, 30_000)

  test('a change larger than the usual limit is staged, its media with it', async () => {
    const made = await madeThere()
    const file = join(dirs[0] as string, `${made.sha}.tgz`)
    writeFileSync(file, made.bytes)
    const { change, media } = await unpackChange(file)
    const url = '/media/large-change/photo.bin'
    media.set(url, crypto.getRandomValues(new Uint8Array(8 * SMALL)))
    const bytes = packChange({ ...change, media: [url] }, media)
    expect(bytes.length).toBeGreaterThan(SMALL)

    const target = await site({ maxRequestBodyBytes: SMALL })
    const staged = await sent(
      target.h,
      tokenOf(target.h),
      `${CHANGES}?stage=true`,
      bytes as BodyInit,
      {
        'crombolo-sha256': hashOf(bytes),
      },
    )
    expect(staged.status, await staged.clone().text()).toBe(200)
    expect(((await staged.json()) as { workspace: string | null }).workspace).toBeString()
    const root = target.h.server.config.mediaDir
    expect(readFileSync(join(root, 'large-change', 'photo.bin')).length).toBe(8 * SMALL)
  }, 60_000)

  test('a site staged as a change is let past the usual limit too, remote access on or off', async () => {
    const body = new Uint8Array(4 * SMALL).fill(1)
    const headers = { 'crombolo-sha256': hashOf(body) }
    for (const enabled of [false, true]) {
      const target = await site({
        maxRequestBodyBytes: SMALL,
        remote: {
          enabled,
          environment: 'production',
          protected: false,
          approvals: false,
          maxUploadBytes: 16 * 1024 ** 2,
          access: 'all',
        },
      })
      const token = tokenOf(target.h)
      const paths = [`${CHANGES}/from-site?source=elsewhere&into=Promoted`]
      if (enabled)
        paths.push(
          `${REMOTE_API_PATH}/environments/production/changes/from-site?source=elsewhere&into=Promoted`,
        )
      for (const path of paths) {
        // Read whole and found not to be a site: past the limit, and to the route.
        const answered = await sent(target.h, token, path, body, headers)
        expect(answered.status, `${path} ${await answered.clone().text()}`).toBe(400)
      }
    }
  }, 60_000)

  test('every other route keeps the usual limit: 413 over it, 411 with no length', async () => {
    const target = await site({ maxRequestBodyBytes: SMALL })
    const big = new Uint8Array(4 * SMALL)
    const elsewhere = await serve(target.h)(
      new Request(`${ORIGIN}${V1}/document`, {
        method: 'POST',
        headers: { 'content-length': String(big.length) },
        body: big,
      }),
      ON_THE_WIRE,
    )
    expect(elsewhere.status).toBe(413)
    const chunked = await serve(target.h)(
      new Request(`${ORIGIN}${WORKSPACES}`, {
        method: 'POST',
        headers: { 'transfer-encoding': 'chunked' },
        body: big,
      }),
      ON_THE_WIRE,
    )
    expect(chunked.status).toBe(411)
  }, 30_000)

  test('without Apply changes, both routes refuse before reading the body', async () => {
    const target = await site({ maxRequestBodyBytes: SMALL })
    const writer = await signInAsGroup(target.h, 'writer')
    for (const path of [`${CHANGES}?stage=true`, `${CHANGES}/from-site?source=s&into=w`]) {
      let read = false
      // A high-water mark of none: nothing is pulled until someone reads.
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            read = true
            controller.enqueue(new Uint8Array(SMALL))
            controller.close()
          },
        },
        { highWaterMark: 0 },
      )
      const refused = await sent(target.h, tokenOf(writer), path, body, {
        'crombolo-sha256': 'a'.repeat(64),
      })
      expect(refused.status, path).toBe(403)
      expect(read, path).toBe(false)
    }
  }, 30_000)
})
