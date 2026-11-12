/**
 * A template edited on one machine reaching a site running on another, with
 * the real command line against a real second server: `pull`, then the view
 * changed, generated and checked, then sent with `push` or with `bundle
 * deploy`. A push replaces the remote environment, and refuses a protected one
 * without `--force`; a deploy applies the committed site and restarts the
 * remote, leaving content the laptop never had where it was.
 *
 * The command line signs in as a CI job does (story 160), from an identity
 * token a test issuer here signs, because a person's sign-in is kept in the
 * operating system's keychain, which a test machine may not have.
 *
 * Named `*.integration.ts`, so `bun test` does not collect it: it spawns
 * processes and boots servers. `bun run test:integration` runs it, and CI does.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { RemotePermissions } from '@crombolo/core'
import { connect, RemoteTrustRepository } from '@crombolo/data'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

const ROOT = resolve(import.meta.dir, '..', '..')
const CLI = join(ROOT, 'packages/cli/bin/crombolo.ts')
const REPOSITORY = 'acme/harbour'

const TEMPLATE = `import type { PageProps } from '@crombolo/crombolo'

export default function Page({ model }: PageProps) {
  return (
    <html lang="en">
      <body>
        <h1>{model.text('title')}</h1>
        <p class="edited">Changed on the laptop</p>
      </body>
    </html>
  )
}
`

interface Run {
  args: string[]
  code: number
  out: string
}

interface Serving {
  url: string
  stop(): Promise<void>
}

let dir: string
let issuer = ''
let issuerServer: ReturnType<typeof Bun.serve>
let signingKey: CryptoKey
const running: Serving[] = []

beforeAll(async () => {
  mkdirSync(join(ROOT, 'output'), { recursive: true })
  dir = mkdtempSync(join(ROOT, 'output', 'remote-deploy-'))
  const pair = await generateKeyPair('RS256')
  signingKey = pair.privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
  // A self-managed GitLab, as far as the remote can tell: discovery and its keys.
  issuerServer = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === '/.well-known/openid-configuration')
        return Response.json({ issuer, jwks_uri: `${issuer}/jwks` })
      if (pathname === '/jwks') return Response.json({ keys: [jwk] })
      return new Response('Not Found', { status: 404 })
    },
  })
  issuer = `http://localhost:${issuerServer.port}`
})

afterAll(async () => {
  for (const server of [...running]) await server.stop()
  issuerServer?.stop(true)
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const siteDir = (name: string) => join(dir, name)

function environment(site: string, extra: Record<string, string> = {}): Record<string, string> {
  const inherited = { ...(process.env as Record<string, string>) }
  for (const name of [
    'CROMBOLO_SQLITE_FILE',
    'CROMBOLO_COMPONENTS_DIR',
    'CROMBOLO_SCHEMA_DIR',
    'CROMBOLO_MEDIA_DIR',
    'CROMBOLO_CSS_DIR',
    'CROMBOLO_SCRIPTS_DIR',
    'CROMBOLO_SITE_NAME',
    'CROMBOLO_ID_TOKEN',
    'ACTIONS_ID_TOKEN_REQUEST_URL',
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  ])
    delete inherited[name]
  return {
    ...inherited,
    CROMBOLO_DB: 'sqlite',
    CROMBOLO_LOGS_DIR: join(dir, 'logs', site),
    CROMBOLO_LOG_TO_CONSOLE: 'false',
    CROMBOLO_ADMIN_PASSWORD: 'integration-password',
    ...extra,
  }
}

async function cli(site: string, args: string[], extra: Record<string, string> = {}): Promise<Run> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    cwd: siteDir(site),
    env: environment(site, extra),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => proc.kill(), 120_000)
  try {
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    return { args, code: await proc.exited, out: `${out}${err}` }
  } finally {
    clearTimeout(timer)
  }
}

async function ok(site: string, args: string[], extra: Record<string, string> = {}) {
  const run = await cli(site, args, extra)
  expect(run.code, `crombolo ${args.join(' ')}\n${run.out}`).toBe(0)
  return run
}

function git(site: string, ...args: string[]) {
  const run = Bun.spawnSync(['git', ...args], {
    cwd: siteDir(site),
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Laptop',
      GIT_AUTHOR_EMAIL: 'laptop@example.test',
      GIT_COMMITTER_NAME: 'Laptop',
      GIT_COMMITTER_EMAIL: 'laptop@example.test',
    },
  })
  expect(run.exitCode, `git ${args.join(' ')}\n${run.stderr.toString()}`).toBe(0)
}

/** A new site with a page type and a published home page, made with the command line. */
async function newSite(name: string) {
  mkdirSync(siteDir(name))
  await ok(name, ['init', '--name', 'Harbour', '--empty'])
  await ok(name, ['types', 'new', 'content-type', 'page', '--name', 'Page', '--at-root'])
  await ok(name, ['content', 'new', '/Home', '--type', 'page', '--set', 'title=Home', '--publish'])
}

function sqliteFileOf(site: string): string {
  const walk = (at: string): string | undefined => {
    for (const entry of readdirSync(at)) {
      if (entry === 'node_modules') continue
      const path = join(at, entry)
      if (statSync(path).isDirectory()) {
        const found = walk(path)
        if (found) return found
      } else if (entry.endsWith('.sqlite')) return path
    }
    return undefined
  }
  const file = walk(siteDir(site))
  if (!file) throw new Error(`${site} has no SQLite file`)
  return file
}

/** Trusts the test issuer's jobs on `main` of the repository, for `permissions`, before the site starts. */
async function trustCi(site: string, permissions: string[]) {
  const db = await connect({ dialect: 'sqlite', file: sqliteFileOf(site) })
  try {
    await new RemoteTrustRepository(db).create(
      {
        name: 'The laptop, as CI',
        issuer,
        repository: REPOSITORY,
        refKind: 'branch',
        refValue: 'main',
        permissions,
      },
      'integration test',
    )
  } finally {
    await db.close()
  }
}

/** Starts `site` with `crombolo start`, which supervises it, so a remote restart works. */
async function serve(site: string, extra: Record<string, string> = {}): Promise<Serving> {
  const proc = Bun.spawn(['bun', CLI, 'start'], {
    cwd: siteDir(site),
    env: { ...environment(site, extra), NODE_ENV: 'production', PORT: '0' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => proc.kill(), 60_000)
  const decoder = new TextDecoder()
  let banner = ''
  for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
    banner += decoder.decode(chunk)
    if (banner.includes('└─')) break
  }
  clearTimeout(timer)
  const url = /site\s+(http:\/\/\S+)/.exec(banner)?.[1] ?? ''
  if (!url) {
    const error = await new Response(proc.stderr).text()
    await proc.exited
    throw new Error(`${site} did not start:\n${banner}${error}`)
  }
  // Keep reading, so a full pipe never stalls the server.
  void (async () => {
    for await (const _ of proc.stdout as ReadableStream<Uint8Array>);
  })().catch(() => {})
  const server: Serving = {
    url,
    async stop() {
      proc.kill()
      await proc.exited
      running.splice(running.indexOf(server), 1)
    },
  }
  running.push(server)
  return server
}

/** A remote that takes the test issuer's jobs, `protected` or not. */
const remoteSettings = (isProtected: boolean) => ({
  CROMBOLO_REMOTE_ACCESS: 'all',
  CROMBOLO_REMOTE_ENVIRONMENT: 'production',
  CROMBOLO_REMOTE_PROTECTED: isProtected ? 'true' : 'false',
  CROMBOLO_REMOTE_APPROVALS: 'false',
  CROMBOLO_REMOTE_OIDC_ISSUERS: issuer,
})

/**
 * What the laptop's CI job carries for one command: an identity token for the
 * remote's origin. Each is exchanged once, as a job's are, so every command
 * gets a fresh one.
 */
const identityFor = (server: Serving) => () => tokenFor(server)

async function tokenFor(server: Serving): Promise<Record<string, string>> {
  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({
    project_path: REPOSITORY,
    ref: 'main',
    ref_type: 'branch',
    pipeline_id: '42',
    job_id: '7',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(issuer)
    .setAudience(new URL(server.url).origin)
    .setIssuedAt(now)
    .setExpirationTime(now + 1800)
    .setJti(randomUUID())
    .sign(signingKey)
  return { CROMBOLO_ID_TOKEN: token }
}

async function page(server: Serving, path: string): Promise<{ status: number; html: string }> {
  const response = await fetch(new URL(path, server.url))
  return { status: response.status, html: await response.text() }
}

/** The laptop: a site of its own, pointed at `live`, then replaced by a pull from it. */
async function laptopFrom(
  name: string,
  live: Serving,
  identity: () => Promise<Record<string, string>>,
) {
  await newSite(name)
  await ok(name, ['remote', 'add', 'live', live.url, '--env', 'production'], await identity())
  await ok(name, ['pull', 'live', '--yes', '--backup-taken'], await identity())
}

/**
 * The live site trusts the laptop's key, as its operator would: it is in
 * production, so it applies a site bundle only from a key it trusts (story 316).
 */
async function trustLaptop(live: string, laptop: string) {
  const key = JSON.parse((await ok(laptop, ['site', 'key', '-o', 'json'])).out) as {
    publicKey: string
  }
  await ok(live, ['keys', 'trust', 'Laptop', key.publicKey, '--site'])
}

/** The template changed, its model types generated, and the views checked. */
async function editTemplate(name: string) {
  writeFileSync(join(siteDir(name), 'components', 'page.tsx'), TEMPLATE)
  await ok(name, ['generate'])
  await ok(name, ['components', 'check'])
}

describe('a template edited locally and pushed to a remote', () => {
  test('push replaces the remote, and a protected one needs --force', async () => {
    await newSite('live-push')
    // A whole-site push changes structure, so it needs that right as well as pushing,
    // and it replaces templates, which are code (story 336).
    await trustCi('live-push', [
      RemotePermissions.Pull,
      RemotePermissions.Push,
      RemotePermissions.PushProtected,
      RemotePermissions.ApplyStructure,
      RemotePermissions.InstallCode,
    ])
    const live = await serve('live-push', remoteSettings(true))
    const identity = identityFor(live)
    expect((await page(live, '/')).html).toContain('<h1>Home</h1>')

    await laptopFrom('laptop-push', live, identity)
    await trustLaptop('live-push', 'laptop-push')
    await editTemplate('laptop-push')

    // A dry run says what it would replace, and sends nothing.
    const dry = await ok('laptop-push', ['push', 'live', '--dry-run'], await identity())
    expect(dry.out).toContain('Nothing was sent')
    expect((await page(live, '/')).html).not.toContain('Changed on the laptop')

    // The environment is protected: refused without --force, and nothing changes.
    const refused = await cli('laptop-push', ['push', 'live'], await identity())
    expect(refused.code, refused.out).not.toBe(0)
    expect((await page(live, '/')).html).not.toContain('Changed on the laptop')

    await ok('laptop-push', ['push', 'live', '--force', '--auto-approve'], await identity())
    const after = await page(live, '/')
    expect(after.status).toBe(200)
    expect(after.html).toContain('<h1>Home</h1>')
    expect(after.html).toContain('<p class="edited">Changed on the laptop</p>')
  }, 600_000)
})

describe('a template edited locally and deployed to a remote', () => {
  test('bundle deploy applies the committed site, restarts the remote, and keeps its content', async () => {
    await newSite('live-deploy')
    await trustCi('live-deploy', [
      RemotePermissions.Pull,
      RemotePermissions.Push,
      RemotePermissions.ApplyStructure,
      RemotePermissions.InstallCode,
    ])
    const live = await serve('live-deploy', remoteSettings(false))
    const identity = identityFor(live)

    await laptopFrom('laptop-deploy', live, identity)
    await trustLaptop('live-deploy', 'laptop-deploy')
    git('laptop-deploy', 'init', '--quiet', '--initial-branch', 'main')
    git('laptop-deploy', 'add', '-A')
    git('laptop-deploy', 'commit', '--quiet', '-m', 'pulled from live')

    // Written on the remote after the laptop pulled: the laptop never has it.
    await ok('live-deploy', [
      'content',
      'new',
      '/News',
      '--type',
      'page',
      '--set',
      'title=News',
      '--publish',
    ])

    await editTemplate('laptop-deploy')
    // A deploy sends only what is committed.
    const dirty = await cli(
      'laptop-deploy',
      ['site', 'deploy', '--remote', 'live', '--yes'],
      await identity(),
    )
    expect(dirty.code, dirty.out).not.toBe(0)
    expect(dirty.out).toContain('not committed')
    git('laptop-deploy', 'add', '-A')
    git('laptop-deploy', 'commit', '--quiet', '-m', 'the page template says where it was changed')

    let deployed = await cli(
      'laptop-deploy',
      ['site', 'deploy', '--remote', 'live', '--yes'],
      await identity(),
    )
    // A change to the definitions raises the site's version first, which is committed in turn.
    if (deployed.code !== 0 && deployed.out.includes('not yet committed')) {
      git('laptop-deploy', 'add', '-A')
      git('laptop-deploy', 'commit', '--quiet', '-m', 'the raised version')
      deployed = await cli(
        'laptop-deploy',
        ['site', 'deploy', '--remote', 'live', '--yes'],
        await identity(),
      )
    }
    expect(deployed.code, deployed.out).toBe(0)
    expect(deployed.out).toContain('is live on live')

    const home = await page(live, '/')
    expect(home.status).toBe(200)
    expect(home.html).toContain('<p class="edited">Changed on the laptop</p>')
    // What the remote had and the laptop did not is still there, in the new template.
    const news = await page(live, '/news')
    expect(news.status).toBe(200)
    expect(news.html).toContain('<h1>News</h1>')
    expect(news.html).toContain('Changed on the laptop')
  }, 600_000)
})
