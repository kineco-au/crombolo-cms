/**
 * Story 352: `push` and `pull` between any two sites — folder to folder,
 * folder and hosted, hosted to hosted — against two of the CMS's own servers
 * as the hosted ones, with each side left out defaulting as its command says.
 *
 * The folders are SQLite in files of their own, and the second hosted site is
 * too, so whichever dialect the first runs on, every site is its own database.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import { currentSchemaState, DocumentRepository } from '@crombolo/data'
import {
  bootstrapDatabase,
  type CromboloConfig,
  loadConfig,
  memoryKeychain,
  type RemoteSettings,
} from '@crombolo/server'
import type { HostedSite } from '../packages/cli/src/profiles/choose.ts'
import { addProfile } from '../packages/cli/src/profiles/profiles-file.ts'
import { discover, RemoteClient, signIn } from '../packages/cli/src/remote/client.ts'
import {
  type CopyDeps,
  type CopySide,
  copySides,
  copySite,
  type LocalSide,
  refuseMisfits,
} from '../packages/cli/src/support/site-copy.ts'
import {
  giveAdminsInstallCode,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
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

const temp = (name: string) => {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const dir = realpathSync(mkdtempSync(join(process.cwd(), 'output', `${name}-`)))
  dirs.push(dir)
  return dir
}

const PAGE = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"
`

function siteFolders(root: string) {
  for (const dir of ['schema/content-types', 'components', 'css', 'scripts', 'media'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  writeFileSync(join(root, 'crombolo.config.ts'), 'export default {}\n')
  return {
    siteDir: root,
    schemaDir: join(root, 'schema'),
    componentsDir: join(root, 'components'),
    stylesheetsDir: join(root, 'css'),
    scriptsDir: join(root, 'scripts'),
    mediaDir: join(root, 'media'),
  }
}

/** The variables that choose a site, set for `work` and put back after. */
function withEnv<T>(vars: Record<string, string | undefined>, work: () => T): T {
  const before = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]))
  const apply = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values))
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
  }
  apply(vars)
  try {
    return work()
  } finally {
    apply(before)
  }
}

const NOTHING_SET = {
  CROMBOLO_PROFILE: undefined,
  CROMBOLO_PROFILE_URL: undefined,
  CROMBOLO_PROFILE_ENVIRONMENT: undefined,
}

/** Where the hosted sites and the folders are, for `copySite` to reach them. */
function world() {
  const hosted = new Map<string, { h: Harness; approver?: Harness }>()
  const configs = new Map<string, CromboloConfig>()
  const deps: CopyDeps = {
    async connect(site) {
      const found = hosted.get(site.url)
      if (!found) throw new Error(`no test server at ${site.url}`)
      const http = ((input: RequestInfo | URL, init?: RequestInit) =>
        found.h.server.fetch(new Request(input, init))) as unknown as typeof fetch
      const keychain = memoryKeychain()
      const discovery = await discover(ORIGIN, http)
      await signIn(discovery, keychain, {
        clientName: 'crombolo in a test',
        http,
        sleep: () => Bun.sleep(5),
        onCode: async (code) => {
          await (found.approver ?? found.h).post(`${SECURITY}/device/decide`, {
            userCode: code,
            approve: true,
          })
        },
      })
      return {
        client: new RemoteClient(discovery, keychain, http),
        discovery,
        environment: discovery.environments[0]?.id,
      }
    },
    async configOf(dir) {
      const config = configs.get(dir)
      if (!config) throw new Error(`no test site in ${dir}`)
      return config
    },
    // Polls quickly, but through a real timer, so the job runs.
    sleep: () => Bun.sleep(5),
  }

  /** A hosted site at `url`: with a published Home page and a photo, or empty. */
  async function hostedAt(
    url: string,
    environment: string,
    options: { home?: boolean; remote?: Partial<RemoteSettings>; second?: boolean } = {},
  ): Promise<{ side: HostedSite; h: Harness; home?: string }> {
    const root = temp(environment)
    const h = await signedInServer({
      // The second has a database of its own whichever dialect the first is on.
      ...(options.second ? { keepDatabase: true } : {}),
      config: {
        ...siteFolders(root),
        ...(options.second ? { dialect: 'sqlite', sqliteFile: join(root, 'site.sqlite') } : {}),
        remote: {
          enabled: true,
          environment,
          protected: false,
          approvals: false,
          maxUploadBytes: 1024 ** 3,
          ...options.remote,
        },
      },
    })
    open.push(h)
    await giveAdminsInstallCode(h)
    hosted.set(url, { h })
    const side: HostedSite = { kind: 'hosted', name: environment, url, profile: true }
    if (!options.home) return { side, h }
    const types = await h.json<{ items: { id: string; name: string }[] }>(
      `${V1}/tree/document-type/root?take=100`,
    )
    const created = await h.post(`${V1}/document`, {
      documentType: { id: types.items.find((t) => t.name === 'Page')?.id },
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Home' }],
    })
    const home = created.headers.get('umb-generated-resource') as string
    await h.put(`${V1}/document/${home}/publish`, { publishSchedules: [] })
    const upload = crypto.randomUUID()
    const form = new FormData()
    form.set('Id', upload)
    form.set('File', new File([new Uint8Array([4, 2])], 'photo.png'))
    await h.call(`${V1}/temporary-file`, { method: 'POST', body: form })
    await h.post(`${V1}/media`, {
      mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Image },
      parent: null,
      values: [
        {
          alias: 'umbracoFile',
          culture: null,
          segment: null,
          value: { src: '', temporaryFileId: upload, crops: [], focalPoint: null },
        },
      ],
      variants: [{ culture: null, segment: null, name: 'Photo' }],
    })
    return { side, h, home }
  }

  /** A site folder: SQLite in a file of its own. */
  function folder(name: string): LocalSide {
    const root = temp(name)
    configs.set(
      root,
      loadConfig({
        ...siteFolders(root),
        dialect: 'sqlite',
        sqliteFile: join(root, 'site.sqlite'),
        development: true,
      }),
    )
    return { kind: 'local', name, dir: root, here: false }
  }

  return { deps, hosted, hostedAt, folder, configs }
}

/** What a copy says, captured. */
function io() {
  const lines: string[] = []
  const add = (line = '') => {
    lines.push(line)
  }
  return { lines, say: add, progress: add, warning: add }
}

/** The name a folder's site gives the page, or undefined when it has none. */
async function nameIn(config: CromboloConfig, key: string): Promise<string | undefined> {
  const { db } = await bootstrapDatabase(config)
  try {
    const state = await currentSchemaState(db)
    const docs = new DocumentRepository(db, {
      nodeState: { version: state.version, revision: state.revision },
      nodeId: 'test',
    })
    return (await docs.byKey(key))?.variants[0]?.name
  } finally {
    await db.close()
  }
}

async function nameOn(h: Harness, key: string): Promise<string | undefined> {
  const response = await h.call(`${V1}/document/${key}`)
  if (!response.ok) return undefined
  return ((await response.json()) as { variants: { name: string }[] }).variants[0]?.name
}

describe('the two sides', () => {
  const profiles = () => {
    const dir = temp('profiles')
    const file = join(dir, 'profiles')
    const copy = join(dir, 'copy')
    mkdirSync(copy)
    writeFileSync(join(copy, 'crombolo.config.ts'), 'export default {}\n')
    addProfile({ name: 'default', url: 'https://live.example', environment: 'production' }, file)
    addProfile({ name: 'staging', url: 'https://live.example', environment: 'staging' }, file)
    addProfile({ name: 'again', url: 'https://live.example', environment: 'production' }, file)
    addProfile({ name: 'copy', path: copy }, file)
    addProfile({ name: 'same-copy', path: copy }, file)
    return { file, copy }
  }
  const sides = (
    command: 'push' | 'pull',
    flags: Parameters<typeof copySides>[1],
    file: string,
    vars: Record<string, string> = {},
  ) => withEnv({ ...NOTHING_SET, ...vars }, () => copySides(command, flags, file))

  test('push goes from this site to the default; pull from the default to this site', () => {
    const { file } = profiles()
    const pushed = sides('push', {}, file)
    expect(pushed.from).toMatchObject({ kind: 'local', here: true, dir: process.cwd() })
    expect(pushed.to).toMatchObject({ name: 'default', environment: 'production' })
    const pulled = sides('pull', {}, file)
    expect(pulled.from).toMatchObject({ name: 'default' })
    expect(pulled.to).toMatchObject({ kind: 'local', here: true })
    // Either side named, from any folder.
    expect(sides('push', { from: 'copy', to: 'staging' }, file).from).toMatchObject({
      kind: 'local',
      name: 'copy',
      here: false,
    })
  })

  test('CROMBOLO_PROFILE and CROMBOLO_PROFILE_URL stand for the side that defaults', () => {
    const { file } = profiles()
    expect(sides('push', {}, file, { CROMBOLO_PROFILE: 'staging' }).to).toMatchObject({
      name: 'staging',
    })
    expect(
      sides('pull', {}, file, {
        CROMBOLO_PROFILE_URL: 'https://ci.example',
        CROMBOLO_PROFILE_ENVIRONMENT: 'qa',
      }).from,
    ).toMatchObject({ url: 'https://ci.example', environment: 'qa', profile: false })
    // --to names its side itself.
    expect(sides('push', { to: 'copy' }, file, { CROMBOLO_PROFILE: 'staging' }).to).toMatchObject({
      name: 'copy',
    })
  })

  test('with no default and nothing chosen, the side is refused, naming the profiles', () => {
    const dir = temp('no-default')
    const file = join(dir, 'profiles')
    addProfile({ name: 'staging', url: 'https://staging.example' }, file)
    expect(() => sides('push', {}, file)).toThrow('Which site?')
  })

  test('the same site on both sides is refused', () => {
    const { file } = profiles()
    expect(() => sides('push', { from: 'copy', to: 'copy' }, file)).toThrow('both copy')
    expect(() => sides('push', { from: 'copy', to: 'same-copy' }, file)).toThrow(
      'the same site folder',
    )
    expect(() => sides('push', { from: 'again', to: 'default' }, file)).toThrow('the same site')
    // One site's two environments are two sites.
    expect(sides('push', { from: 'staging', to: 'default' }, file).to).toMatchObject({
      environment: 'production',
    })
  })

  test('environments: each side its own, and --env only when one side is hosted', () => {
    const { file } = profiles()
    expect(sides('push', { env: 'qa' }, file).to).toMatchObject({ environment: 'qa' })
    expect(
      sides('push', { from: 'staging', to: 'default', 'to-env': 'qa' }, file).to,
    ).toMatchObject({ environment: 'qa' })
    expect(() => sides('push', { from: 'staging', to: 'default', env: 'qa' }, file)).toThrow(
      'Both sites are hosted',
    )
    expect(() => sides('push', { to: 'copy', env: 'qa' }, file)).toThrow('neither is')
    expect(() => sides('pull', { from: 'default', 'to-env': 'qa' }, file)).toThrow(
      '--to-env is for a hosted site',
    )
  })

  test('an option for a hosted side only is refused for a folder, naming it', () => {
    const here: CopySide = { kind: 'local', name: 'this site', dir: '.', here: true }
    const copy: CopySide = { kind: 'local', name: 'copy', dir: '/srv/copy', here: false }
    const live: CopySide = {
      kind: 'hosted',
      name: 'live',
      url: 'https://live.example',
      profile: true,
    }
    expect(() => refuseMisfits(here, copy, { force: true })).toThrow(
      '--force is for a hosted site, and copy is a site folder.',
    )
    expect(() => refuseMisfits(copy, live, { full: true })).toThrow('--full is for a hosted site')
    expect(() => refuseMisfits(live, here, { 'auto-approve': true })).toThrow(
      "--auto-approve is for a hosted site, and this site is this folder's site.",
    )
    expect(() => refuseMisfits(live, live, { 'lazy-media': true })).toThrow('--lazy-media')
    expect(() => refuseMisfits(here, copy, { 'media-info-only': true })).toThrow(
      '--media-info-only',
    )
    expect(() => refuseMisfits(here, live, { yes: true })).toThrow('--yes is for a site folder')
    expect(() =>
      refuseMisfits(live, copy, { full: true, 'lazy-media': true, yes: true }),
    ).not.toThrow()
  })
})

describe('copying', () => {
  test('hosted to a folder, then folder to folder both ways, each target backed up', async () => {
    const w = world()
    const { side: live, home } = await w.hostedAt('https://live.test', 'production', { home: true })
    const one = w.folder('one')
    const two = w.folder('two')

    const pulled = await copySite(io(), live, one, { yes: true, 'backup-taken': true }, w.deps)
    expect(pulled).toMatchObject({ from: { name: 'production', environment: 'production' } })
    expect(pulled.runId).toBeTruthy()
    expect(await nameIn(w.configs.get(one.dir) as CromboloConfig, home as string)).toBe('Home')

    // Off a terminal, replacing a folder is asked about, so it needs --yes.
    await expect(copySite(io(), one, two, {}, w.deps)).rejects.toMatchObject({
      kind: 'confirmation_required',
    })
    const said = io()
    const copied = await copySite(said, one, two, { yes: true }, w.deps)
    expect(copied.runId).toBeTruthy()
    expect(said.lines.join('\n')).toContain('replaced two with one')
    expect(await nameIn(w.configs.get(two.dir) as CromboloConfig, home as string)).toBe('Home')
    expect(readdirSync(two.dir).some((name) => /^site\.sqlite\..+\.bak$/.test(name))).toBe(true)

    const back = await copySite(io(), two, one, { yes: true }, w.deps)
    expect(back.runId).toBeTruthy()
    expect(readdirSync(one.dir).some((name) => /^site\.sqlite\..+\.bak$/.test(name))).toBe(true)
  }, 120_000)

  test('a folder to a hosted site, and hosted to hosted, under the receiving side’s protection', async () => {
    const w = world()
    const { side: live, home } = await w.hostedAt('https://live.test', 'production', { home: true })
    const { side: staging, h: stagingServer } = await w.hostedAt(
      'https://staging.test',
      'staging',
      { second: true, remote: { protected: true } },
    )
    // Protected: refused without --force, and nothing is sent.
    await expect(copySite(io(), live, staging, {}, w.deps)).rejects.toMatchObject({
      kind: 'confirmation_required',
    })
    expect(await nameOn(stagingServer, home as string)).toBeUndefined()

    const said = io()
    const copied = await copySite(
      said,
      live,
      staging,
      { force: true, 'auto-approve': true },
      w.deps,
    )
    expect(copied.job?.state).toBe('done')
    expect(copied).toMatchObject({
      from: { environment: 'production' },
      to: { environment: 'staging' },
      anonymised: true,
    })
    expect(said.lines.join('\n')).toContain('production (production) over staging (staging)')
    expect(await nameOn(stagingServer, home as string)).toBe('Home')

    const copy = w.folder('copy')
    await copySite(io(), live, copy, { yes: true }, w.deps)
    const pushed = await copySite(
      io(),
      copy,
      staging,
      { force: true, 'auto-approve': true },
      w.deps,
    )
    expect(pushed.job?.state).toBe('done')
    expect(pushed.from).toEqual({ name: 'copy', environment: null })
  }, 180_000)

  test('a dry run to a hosted site sends nothing', async () => {
    const w = world()
    const { side: live, home } = await w.hostedAt('https://live.test', 'production', { home: true })
    const { side: staging, h: stagingServer } = await w.hostedAt(
      'https://staging.test',
      'staging',
      { second: true },
    )
    const dry = await copySite(io(), live, staging, { 'dry-run': true }, w.deps)
    expect(dry.job).toBeNull()
    expect(dry.check?.sending.counts).toBeDefined()
    expect(await nameOn(stagingServer, home as string)).toBeUndefined()
  }, 120_000)

  test('between two hosted sites, the temporary folder goes even when the copy fails', async () => {
    const w = world()
    const { side: live, h } = await w.hostedAt('https://live.test', 'production', { home: true })
    const { side: staging } = await w.hostedAt('https://staging.test', 'staging', { second: true })
    // Signed in to the first as someone who may not pull from it.
    const writer = await signInAsGroup(h, 'writer', 'writer@example.test')
    open.push(writer)
    w.hosted.set(live.url, { h, approver: writer })
    const scratch = temp('tmp')
    const before = process.env.TMPDIR
    process.env.TMPDIR = scratch
    try {
      await expect(copySite(io(), live, staging, {}, w.deps)).rejects.toThrow('may not pull')
    } finally {
      if (before === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = before
    }
    expect(readdirSync(scratch)).toEqual([])
  }, 120_000)
})
