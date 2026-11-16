/**
 * Story 107: the CMS's own server passes the remote protocol's conformance
 * suite (`@crombolo/remote-conformance`), read-only and with a push.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEVICE_CODE_GRANT, REMOTE_CLIENT_ID } from '@crombolo/auth'
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import {
  ExtensionActivityLog,
  ExternalLoginRepository,
  externalLoginProvider,
  JobRepository,
} from '@crombolo/data'
import { runConformance } from '@crombolo/remote-conformance'
import { oidc } from '@crombolo/server'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { dialectUnderTest } from './support/db.ts'
import {
  giveAdminsInstallCode,
  type Harness,
  ORIGIN,
  signedInServer,
  V1,
} from './support/harness.ts'

const SECURITY = `${V1}/security/back-office`

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

async function remote(protectedEnvironment = false, config: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'conformance-'))
  dirs.push(root)
  for (const dir of ['schema', 'components', 'css', 'scripts', 'media'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      stylesheetsDir: join(root, 'css'),
      scriptsDir: join(root, 'scripts'),
      mediaDir: join(root, 'media'),
      remote: {
        enabled: true,
        environment: 'staging',
        protected: protectedEnvironment,
        approvals: false,
        maxUploadBytes: 1024 ** 3,
      },
      ...config,
    },
  })
  open.push(h)
  // A whole-site push needs "Install code on this site" (story 336).
  await giveAdminsInstallCode(h)
  return h
}

/** A device sign-in approved by the harness's administrator. */
async function token(h: Harness): Promise<string> {
  const form = (path: string, fields: Record<string, string>) =>
    h.server.fetch(
      new Request(`${ORIGIN}${SECURITY}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      }),
    )
  const codes = (await (await form('device', { client_id: REMOTE_CLIENT_ID })).json()) as {
    device_code: string
    user_code: string
  }
  await h.post(`${SECURITY}/device/decide`, { userCode: codes.user_code, approve: true })
  const tokens = (await (
    await form('token', {
      grant_type: DEVICE_CODE_GRANT,
      device_code: codes.device_code,
      client_id: REMOTE_CLIENT_ID,
    })
  ).json()) as { access_token: string }
  return tokens.access_token
}

/** The suite's `fetch`, answered by the server in-process. */
const fetchFrom = (h: Harness) =>
  ((input: RequestInfo | URL, init?: RequestInit) =>
    h.server.fetch(new Request(input, init))) as unknown as typeof fetch

describe(`the remote conformance suite (${dialectUnderTest})`, () => {
  test('passes read-only, and with a push', async () => {
    const h = await remote()
    // A waiting job, an hour off so nothing runs it, for background-jobs to refuse to run again.
    await new JobRepository(h.server.db).enqueue({
      owner: 'site',
      name: 'conformance.wait',
      payload: '{}',
      maxAttempts: 1,
      queuedBy: null,
      runAt: new Date(Date.now() + 60 * 60_000),
    })
    // A row of what an extension did, for extension-activity to page, count and export.
    await new ExtensionActivityLog(h.server.db).record([
      {
        extensionId: 'conformance-check',
        personKey: null,
        personName: null,
        kind: 'write',
        area: 'redirects',
        verb: 'save',
        entityKey: null,
        count: 1,
        outcome: 'ok',
        ms: 2,
        occurredAt: new Date(),
      },
    ])
    // A media folder, for media-library to show and rename and back, and media-access to read.
    const folder = await h.post(`${V1}/media`, {
      mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Folder },
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Conformance' }],
    })
    expect(folder.status).toBe(201)
    const report = await runConformance({
      url: ORIGIN,
      token: await token(h),
      push: true,
      timeoutMs: 60_000,
      fetch: fetchFrom(h),
    })
    const failed = report.checks.filter((c) => !c.ok)
    expect(failed).toEqual([])
    expect(report.checks.filter((c) => c.skipped).map((c) => c.name)).toEqual([])
    expect(report.passed).toBe(true)
  }, 60_000)

  test('checks the exchange for a person signed in through a provider', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k', alg: 'RS256', use: 'sig' }
    let issuer = ''
    const provider = Bun.serve({
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === '/jwks'
          ? Response.json({ keys: [jwk] })
          : Response.json({ issuer, jwks_uri: `${issuer}/jwks` }),
    })
    issuer = `http://localhost:${provider.port}`
    try {
      const h = await remote(false, {
        backofficeIdentityProviders: [
          oidc({
            id: 'corp',
            name: 'Corp',
            issuer,
            clientId: 'back-office-app',
            remoteExchange: { audience: 'api://remote' },
          }),
        ],
      })
      const me = await h.json<{ id: string }>(`${V1}/user/current`)
      await new ExternalLoginRepository(h.server.db).link(
        me.id,
        externalLoginProvider('user', 'corp'),
        'admin-sub',
        { value: 'admin-sub', issuer },
      )
      const report = await runConformance({
        url: ORIGIN,
        token: await token(h),
        timeoutMs: 60_000,
        fetch: fetchFrom(h),
        personToken: async (p) =>
          new SignJWT({ sub: 'admin-sub' })
            .setProtectedHeader({ alg: 'RS256', kid: 'k' })
            .setIssuer(p.issuer)
            .setAudience(p.audience)
            .setIssuedAt()
            .setExpirationTime('10m')
            .setJti(crypto.randomUUID())
            .sign(privateKey),
      })
      const people = report.checks.filter((c) => c.name.startsWith('people:'))
      expect(people.map((c) => [c.name, c.ok, c.skipped ?? false, c.detail])).toEqual([
        [
          'people: discovery names the exchange and each provider, issuer and audience',
          true,
          false,
          undefined,
        ],
        ["people: an unsigned token naming a provider's issuer is refused", true, false, undefined],
        ['people: a minted token signs the person in, once', true, false, undefined],
      ])
    } finally {
      provider.stop(true)
    }
  }, 60_000)

  test('fails a server that is not a remote', async () => {
    const h = await signedInServer()
    open.push(h)
    const report = await runConformance({ url: ORIGIN, token: 'nothing', fetch: fetchFrom(h) })
    expect(report.passed).toBe(false)
    expect(report.checks[0]?.ok).toBe(false)
  })
})
