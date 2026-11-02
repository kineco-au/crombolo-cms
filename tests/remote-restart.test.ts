/**
 * Story 241: a remote restarted through the remote protocol, by the
 * `crombolo start` that supervises it. The process side is
 * tests/integration/restart.integration.ts.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { AuditLog } from '@crombolo/data'
import {
  REMOTE_API_PATH,
  type RemoteSettings,
  type RestartOutcome,
  type ServerOptions,
} from '@crombolo/server'
import { dialectUnderTest } from './support/db.ts'
import { type Harness, ORIGIN, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

async function remote(settings: Partial<RemoteSettings>, server: ServerOptions = {}) {
  const h = await signedInServer({
    config: {
      remote: {
        enabled: true,
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 1024 ** 3,
        ...settings,
      },
    },
    server,
  })
  open.push(h)
  const restart = (client: Harness = h) =>
    client.server.fetch(
      new Request(`${ORIGIN}${REMOTE_API_PATH}/environments/production/restart`, {
        method: 'POST',
        headers: { cookie: client.cookie() },
      }),
    )
  const capabilities = async () =>
    (
      (await (
        await h.server.fetch(new Request(`${ORIGIN}/.well-known/crombolo-remote`))
      ).json()) as { capabilities: string[] }
    ).capabilities
  return { h, restart, capabilities }
}

const code = async (response: Response) => ((await response.json()) as { code: string }).code

describe(`restarting a remote (${dialectUnderTest})`, () => {
  test('needs the all level', async () => {
    const asked: number[] = []
    const { restart, capabilities } = await remote(
      { access: 'content' },
      {
        restart: async () => {
          asked.push(1)
          return { ok: true }
        },
      },
    )
    const refused = await restart()
    expect(refused.status).toBe(403)
    expect(await code(refused)).toBe('access-level')
    expect(await capabilities()).not.toContain('restart')
    expect(asked).toEqual([])
  })

  test('a server nothing supervises says so', async () => {
    const { restart, capabilities } = await remote({ access: 'all' })
    const refused = await restart()
    expect(refused.status).toBe(409)
    expect(await code(refused)).toBe('not-supervised')
    expect(await capabilities()).not.toContain('restart')
  })

  test('an administrator restarts it, and hears when the new server failed', async () => {
    let next: RestartOutcome = { ok: true }
    const { h, restart, capabilities } = await remote(
      { access: 'all' },
      { restart: async () => next },
    )
    expect(await capabilities()).toContain('restart')
    const ok = await restart()
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ restarted: true })

    next = { ok: false, reason: 'crombolo.config.ts: broken on purpose' }
    const failed = await restart()
    expect(failed.status).toBe(502)
    const problem = (await failed.json()) as { code: string; detail: string }
    expect(problem.code).toBe('restart-failed')
    expect(problem.detail).toContain('broken on purpose')

    const { items } = await new AuditLog(h.server.db).page({}, { limit: 50 })
    expect(items.map((row) => row.action)).toEqual(
      expect.arrayContaining(['RemoteRestart', 'RemoteRestartFailed']),
    )
  })

  test('is refused to anyone but an administrator', async () => {
    const asked: number[] = []
    const { h, restart } = await remote(
      { access: 'all' },
      {
        restart: async () => {
          asked.push(1)
          return { ok: true }
        },
      },
    )
    const created = await h.post(`${V1}/user-group`, {
      name: 'Deployers',
      alias: 'deployers',
      sections: ['Umb.Section.Content'],
      languages: [],
      hasAccessToAllLanguages: true,
      documentRootAccess: true,
      documentStartNode: null,
      mediaRootAccess: true,
      mediaStartNode: null,
      elementRootAccess: false,
      elementStartNode: null,
      fallbackPermissions: [
        'Crombolo.Remote.Push',
        'Crombolo.Remote.ApplyStructure',
        'Crombolo.Remote.InstallCode',
      ],
      permissions: [],
    })
    expect(created.status).toBe(201)
    const deployer = await signInAsGroup(h, 'deployers')
    const refused = await restart(deployer)
    expect(refused.status).toBe(403)
    expect(asked).toEqual([])
  })
})
