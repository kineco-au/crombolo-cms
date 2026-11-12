/**
 * Story 167: a bundle applied to a remote, under the site's ceiling. A site
 * takes nothing from the remote protocol until CROMBOLO_REMOTE_ACCESS says so:
 * `read` pulls, `content` applies bundles of content, `all` takes whole-site
 * pushes and bundles that change structure, which also need
 * Crombolo.Remote.ApplyStructure.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import {
  buildBundleFromDirectory,
  loadConfig,
  REMOTE_API_PATH,
  type RemoteSettings,
  restartPending,
  type TarEntry,
  writeNpmTarball,
} from '@crombolo/server'
import { writeSeedPackage } from '../packages/cli/src/support/seed.ts'
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

const temp = (name: string) => {
  const dir = mkdtempSync(join(process.cwd(), 'output', `${name}-`))
  dirs.push(dir)
  return dir
}

const PAGE = `[content-type]
key = "6f1d3c2a-0167-4a1e-9b2f-1c0d167a0001"
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

/** A site directory: its schema, one view, and content files for one page. */
function siteDirectory(title = 'Hello', code?: Record<string, string>) {
  const root = temp('remote-apply-site')
  for (const dir of ['schema/content-types', 'components', 'content/pages'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  writeFileSync(
    join(root, 'content', 'pages', 'home.toml'),
    `type = "page"\nname = "Home"\n\n[values]\ntitle = "${title}"\n`,
  )
  // What a site with a lockfile always sends with its structure (story 241).
  writeFileSync(
    join(root, 'package.json'),
    '{ "name": "remote-apply-site", "private": true, "crombolo": { "code": ["src/**"] } }\n',
  )
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'site.ts'), 'export const site = true\n')
  writeFileSync(
    join(root, 'bun.lock'),
    '{\n  "lockfileVersion": 1,\n  "workspaces": { "": { "name": "remote-apply-site" } }\n}\n',
  )
  writeFileSync(join(root, 'crombolo.config.ts'), 'export default {}\n')
  for (const [path, text] of Object.entries(code ?? {})) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

function entriesOf(dir: string): TarEntry[] {
  const out: TarEntry[] = []
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else out.push({ path: relative(dir, path).split('\\').join('/'), bytes: readFileSync(path) })
    }
  }
  walk(dir)
  return out
}

/** A site directory built and packed as `bundle apply --remote` packs it: content alone, or all of it. */
async function packed(root: string, structure = false) {
  const built = await buildBundleFromDirectory(root, { media: true })
  expect(built.problems).toEqual([])
  const out = temp('remote-apply-bundle')
  const seed = built.seed as NonNullable<typeof built.seed>
  writeSeedPackage(structure ? { ...seed, files: built.files } : seed, out)
  return writeNpmTarball(entriesOf(out))
}

async function remote(remoteSettings: Partial<RemoteSettings>, runtimeInstalls = true) {
  const root = siteDirectory()
  const h = await signedInServer({
    config: {
      runtimeInstalls,
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
      remote: {
        enabled: true,
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 1024 ** 3,
        ...remoteSettings,
      },
    },
  })
  open.push(h)
  const api = (client: Harness, path: string, init: RequestInit = {}) =>
    client.server.fetch(
      new Request(`${ORIGIN}${REMOTE_API_PATH}/${path}`, {
        ...init,
        headers: { cookie: client.cookie(), ...(init.headers as Record<string, string>) },
      }),
    )
  const apply = (client: Harness, bytes: Uint8Array, options: Record<string, unknown> = {}) =>
    api(client, 'environments/production/bundles', {
      method: 'PUT',
      headers: {
        'content-type': 'application/gzip',
        'crombolo-sha256': createHash('sha256').update(bytes).digest('hex'),
        'crombolo-options': JSON.stringify(options),
      },
      body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
    })
  return { h, api, apply, root }
}

/** A group holding what a structural apply needs, and InstallCode when asked. */
async function deployers(h: Harness, installCode: boolean) {
  const created = await h.post(`${V1}/user-group`, {
    name: installCode ? 'Code installers' : 'Deployers',
    alias: installCode ? 'code-installers' : 'deployers',
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
      'Crombolo.Remote.Pull',
      'Crombolo.Remote.Push',
      'Crombolo.Remote.ApplyStructure',
      ...(installCode ? ['Crombolo.Remote.InstallCode'] : []),
    ],
    permissions: [],
  })
  expect(created.status).toBe(201)
  return signInAsGroup(h, installCode ? 'code-installers' : 'deployers')
}

describe(`applying a bundle to a remote (${dialectUnderTest})`, () => {
  test('content: checked first, applied, applied again unchanged, listed and reverted', async () => {
    const { h, api, apply } = await remote({ access: 'content' })
    const bytes = await packed(siteDirectory('From the bundle'))

    const dry = await apply(h, bytes, { dryRun: true })
    expect(dry.status).toBe(200)
    const checked = (await dry.json()) as {
      dryRun: boolean
      structural: boolean
      counts: { create: number }
    }
    expect(checked).toMatchObject({ dryRun: true, structural: false })
    expect(checked.counts.create).toBe(1)

    const applied = await apply(h, bytes, { publish: true })
    expect(applied.status).toBe(200)
    const run = (await applied.json()) as { runId: string; published: number }
    expect(run.runId).toBeTruthy()
    const roots = await h.json<{ items: Array<{ variants: Array<{ name: string }> }> }>(
      `${V1}/tree/document/root?take=10`,
    )
    expect(roots.items.map((item) => item.variants[0]?.name)).toContain('Home')

    const again = (await (await apply(h, bytes)).json()) as {
      counts: { unchanged: number; create: number }
    }
    expect(again.counts.create).toBe(0)

    const runs = (await (await api(h, 'environments/production/runs')).json()) as {
      items: Array<{ id: string }>
    }
    expect(runs.items.map((r) => r.id)).toContain(run.runId)

    const reverted = await api(h, `environments/production/runs/${run.runId}/revert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force: true }),
    })
    expect(reverted.status).toBe(200)
    expect(((await reverted.json()) as { reverted: string }).reverted).toBe(run.runId)
  })

  test('a bundle that changes structure needs the all level and ApplyStructure', async () => {
    const atContent = await remote({ access: 'content' })
    const structural = await packed(siteDirectory(), true)
    const refused = await atContent.apply(atContent.h, structural, { dryRun: true })
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { code: string }).code).toBe('access-level')

    const atAll = await remote({ access: 'all' })
    const groups = await atAll.h.post(`${V1}/user-group`, {
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
      fallbackPermissions: ['Crombolo.Remote.Pull', 'Crombolo.Remote.Push'],
      permissions: [],
    })
    expect(groups.status).toBe(201)
    const deployer = await signInAsGroup(atAll.h, 'deployers')
    const forbidden = await atAll.apply(deployer, structural, { dryRun: true })
    expect(forbidden.status).toBe(403)
    expect(((await forbidden.json()) as { code: string }).code).toBe('forbidden-structure')
    // Content alone is theirs to apply.
    expect(
      (await atAll.apply(deployer, await packed(siteDirectory()), { dryRun: true })).status,
    ).toBe(200)
    // An administrator holds every permission.
    const admin = await atAll.apply(atAll.h, structural, { dryRun: true })
    expect(admin.status).toBe(200)
    expect(((await admin.json()) as { structural: boolean }).structural).toBe(true)
  })

  test('the site’s level bounds everything, and says which variable to change', async () => {
    const atRead = await remote({ access: 'read' })
    const discovery = await (
      await atRead.h.server.fetch(new Request(`${ORIGIN}/.well-known/crombolo-remote`))
    ).json()
    expect(discovery.capabilities).not.toContain('bundle-apply')
    expect(discovery.environments[0].access).toBe('read')
    const refused = await atRead.apply(atRead.h, await packed(siteDirectory()), { dryRun: true })
    expect(refused.status).toBe(403)
    const problem = (await refused.json()) as { code: string; detail: string }
    expect(problem.code).toBe('access-level')
    expect(problem.detail).toContain('CROMBOLO_REMOTE_ACCESS is read')
    const [env] = (await (await atRead.api(atRead.h, 'environments')).json()) as Array<{
      may: Record<string, boolean>
    }>
    expect(env?.may).toMatchObject({ pull: true, push: false, apply: false, applyStructure: false })

    // A whole-site push needs all.
    const atContent = await remote({ access: 'content' })
    const push = await atContent.api(atContent.h, 'environments/production/pushes', {
      method: 'PUT',
      headers: { 'crombolo-sha256': 'a'.repeat(64) },
    })
    expect(push.status).toBe(403)
    expect(((await push.json()) as { code: string }).code).toBe('access-level')
    const [contentEnv] = (await (
      await atContent.api(atContent.h, 'environments')
    ).json()) as Array<{
      may: Record<string, boolean>
    }>
    expect(contentEnv?.may).toMatchObject({ apply: true, push: false, applyStructure: false })
  })

  test('a request cannot vouch for its own bundle (story 319)', async () => {
    const { h, apply } = await remote({ access: 'content' })
    const bytes = await packed(siteDirectory())
    for (const options of [{ provenance: 'local' }, { vouchedBy: 'host' }, { vouchedBy: 'site' }]) {
      const response = await apply(h, bytes, { dryRun: true, ...options })
      expect(response.status).toBe(200)
      const { provenance } = (await response.json()) as { provenance: { state: string } }
      expect(provenance.state).toBe('unsigned')
    }
  })

  test('a bundle that is not the one described is refused', async () => {
    const { h, api } = await remote({ access: 'content' })
    const bytes = await packed(siteDirectory())
    const response = await api(h, 'environments/production/bundles', {
      method: 'PUT',
      headers: { 'crombolo-sha256': 'b'.repeat(64) },
      body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { code: string }).code).toBe('hash-mismatch')
  })
})

describe(`installing the code a bundle carries (story 241, ${dialectUnderTest})`, () => {
  const CODE = { 'src/hello.ts': 'export const hello = "from the bundle"\n' }

  test('needs InstallCode from a group: an administrator is refused until given it', async () => {
    const { h, apply, root } = await remote({ access: 'all' })
    const bytes = await packed(siteDirectory('Hello', CODE), true)

    const admin = await apply(h, bytes, { dryRun: true })
    expect(admin.status).toBe(403)
    const refusal = (await admin.json()) as { code: string; items: string[] }
    expect(refusal.code).toBe('forbidden-code')
    expect(refusal.items).toEqual(['code/src/hello.ts'])

    expect((await apply(await deployers(h, false), bytes, { dryRun: true })).status).toBe(403)

    const installer = await deployers(h, true)
    const dry = await apply(installer, bytes, { dryRun: true })
    expect(dry.status).toBe(200)
    expect(((await dry.json()) as { code: unknown[] }).code).toEqual([
      { path: 'code/src/hello.ts', action: 'create' },
    ])
    expect(existsSync(join(root, 'src', 'hello.ts'))).toBe(false)

    const applied = await apply(installer, bytes, {})
    expect(applied.status).toBe(200)
    const run = (await applied.json()) as {
      runId: string
      code: { written: number; live: boolean }
    }
    expect(run.code).toMatchObject({ written: 1, live: false })
    expect(readFileSync(join(root, 'src', 'hello.ts'), 'utf8')).toContain('from the bundle')
    expect(restartPending(root)?.reasons.join(' ')).toContain('1 code file(s) installed')
  })

  test('code the site already runs needs nothing more than its structure', async () => {
    const { h, apply } = await remote({ access: 'all' })
    // package.json, bun.lock and the config as the remote has them: nothing to install.
    const same = await apply(h, await packed(siteDirectory(), true), { dryRun: true })
    expect(same.status).toBe(200)
    expect(((await same.json()) as { code: unknown[] }).code).toEqual([])
  })

  test('a site that installs nothing while it runs refuses it, saying how to deploy', async () => {
    const { h, apply } = await remote({ access: 'all' }, false)
    const installer = await deployers(h, true)
    const refused = await apply(installer, await packed(siteDirectory('Hello', CODE), true), {
      dryRun: true,
    })
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { code: string }).code).toBe('installs-elsewhere')
  })

  test('reverting a run that installed code puts it back, and needs InstallCode too', async () => {
    const { h, api, apply, root } = await remote({ access: 'all' })
    const installer = await deployers(h, true)
    const run = (await (
      await apply(installer, await packed(siteDirectory('Hello', CODE), true), {})
    ).json()) as { runId: string }
    const revert = (client: Harness) =>
      api(client, `environments/production/runs/${run.runId}/revert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      })
    const byAdmin = await revert(h)
    expect(byAdmin.status).toBe(403)
    expect(((await byAdmin.json()) as { code: string }).code).toBe('forbidden-code')
    expect((await revert(installer)).status).toBe(200)
    expect(existsSync(join(root, 'src', 'hello.ts'))).toBe(false)
  })
})

describe(`templates are code (story 336, ${dialectUnderTest})`, () => {
  const PROMO = { 'components/promo.tsx': 'export default () => <aside />\n' }

  test('a bundle that adds a template needs InstallCode, and so does reverting it', async () => {
    const { h, api, apply, root } = await remote({ access: 'all' })
    const bytes = await packed(siteDirectory('Hello', PROMO), true)
    const deployer = await deployers(h, false)
    const refused = await apply(deployer, bytes, { dryRun: true })
    expect(refused.status).toBe(403)
    const refusal = (await refused.json()) as { code: string; items: string[] }
    expect(refusal.code).toBe('forbidden-code')
    expect(refusal.items).toEqual(['components/promo.tsx'])

    const installer = await deployers(h, true)
    const applied = await apply(installer, bytes, {})
    expect(applied.status).toBe(200)
    expect(existsSync(join(root, 'components', 'promo.tsx'))).toBe(true)

    const { runId } = (await applied.json()) as { runId: string }
    const revert = (client: Harness) =>
      api(client, `environments/production/runs/${runId}/revert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: true }),
      })
    const byDeployer = await revert(deployer)
    expect(byDeployer.status).toBe(403)
    expect(((await byDeployer.json()) as { code: string }).code).toBe('forbidden-code')
    expect((await revert(installer)).status).toBe(200)
  })

  test('a site that installs nothing while it runs refuses one, in plain words', async () => {
    const { h, apply } = await remote({ access: 'all' }, false)
    const refused = await apply(
      await deployers(h, true),
      await packed(siteDirectory('Hello', PROMO), true),
      {
        dryRun: true,
      },
    )
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { detail: string }).detail).toBe(
      'Installing code while the site runs is turned off on this site.',
    )
  })

  test('a whole-site push needs InstallCode', async () => {
    const { h, api } = await remote({ access: 'all' })
    const deployer = await deployers(h, false)
    const push = await api(deployer, 'environments/production/pushes', {
      method: 'PUT',
      headers: { 'crombolo-sha256': 'a'.repeat(64) },
    })
    expect(push.status).toBe(403)
    expect(((await push.json()) as { code: string }).code).toBe('forbidden-code')
    const [env] = (await (await api(deployer, 'environments')).json()) as Array<{
      may: Record<string, boolean>
    }>
    expect(env?.may.push).toBe(false)
    const [installerEnv] = (await (
      await api(await deployers(h, true), 'environments')
    ).json()) as Array<{ may: Record<string, boolean> }>
    expect(installerEnv?.may.push).toBe(true)
  })
})

describe('CROMBOLO_REMOTE_ACCESS', () => {
  const withEnv = (vars: Record<string, string | undefined>, run: () => void) => {
    const before = Object.fromEntries(Object.keys(vars).map((k) => [k, Bun.env[k]]))
    try {
      for (const [k, v] of Object.entries(vars))
        if (v === undefined) delete Bun.env[k]
        else Bun.env[k] = v
      run()
    } finally {
      for (const [k, v] of Object.entries(before))
        if (v === undefined) delete Bun.env[k]
        else Bun.env[k] = v
    }
  }

  test('is off unless set, and takes the four levels', () => {
    withEnv({ CROMBOLO_REMOTE_ACCESS: undefined, CROMBOLO_REMOTE_ENABLED: undefined }, () => {
      expect(loadConfig({}).remote).toMatchObject({ access: 'off', enabled: false })
    })
    for (const access of ['read', 'content', 'all'])
      withEnv({ CROMBOLO_REMOTE_ACCESS: access, CROMBOLO_REMOTE_ENABLED: undefined }, () => {
        expect(loadConfig({}).remote).toMatchObject({ access, enabled: true })
      })
    withEnv({ CROMBOLO_REMOTE_ACCESS: 'everything', CROMBOLO_REMOTE_ENABLED: undefined }, () => {
      expect(() => loadConfig({})).toThrow('off, read, content or all')
    })
  })

  test('refuses the switch it replaced, naming the new one', () => {
    withEnv({ CROMBOLO_REMOTE_ENABLED: 'true', CROMBOLO_REMOTE_ACCESS: undefined }, () => {
      expect(() => loadConfig({})).toThrow('CROMBOLO_REMOTE_ACCESS')
    })
  })
})
