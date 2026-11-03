/**
 * Story 060: a bundle's signature is checked wherever it reaches a site, before
 * anything is written. These need no network: an unsigned bundle and one whose
 * signature does not match its files are both settled before Sigstore's trust
 * root is ever fetched; a signed one stands in through the marketplace's seam.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { createExtensionRegistry } from '@crombolo/backoffice-host'
import {
  buildBundleFromDirectory,
  createMarketplace,
  type PackageInstaller,
  PROVENANCE_FILE,
  type ProvenancePolicy,
  type ProvenanceResult,
  REMOTE_API_PATH,
  type TarEntry,
  VERSION,
  writeNpmTarball,
} from '@crombolo/server'
import { signatureWords } from '../packages/backoffice-host/plugin/bundles-signature-words.js'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { writeSeedPackage } from '../packages/cli/src/support/seed.ts'
import { ROOT } from '../scripts/packages.ts'
import { type Harness, ORIGIN, signedInServer } from './support/harness.ts'

const dirs: string[] = []
const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const temp = (name: string) => {
  mkdirSync(join(ROOT, 'output'), { recursive: true })
  const dir = mkdtempSync(join(ROOT, 'output', `${name}-`))
  dirs.push(dir)
  return dir
}

/** A provenance.json that names a digest the files do not have: refused before any signature check. */
const TAMPERED = JSON.stringify({ format: 1, digest: 'sha256-00', signature: {}, source: {} })

const SIGNED: ProvenanceResult = {
  state: 'signed',
  source: {
    issuer: 'https://token.actions.githubusercontent.com',
    repository: 'acme/bundles',
    ref: 'refs/tags/v1.2.3',
    commit: '0123456789abcdef0123456789abcdef01234567',
    workflow: 'https://github.com/acme/bundles/.github/workflows/release.yml@refs/tags/v1.2.3',
    run: null,
  },
  links: {
    commit: 'https://github.com/acme/bundles/commit/0123456789abcdef0123456789abcdef01234567',
    tag: 'https://github.com/acme/bundles/releases/tag/v1.2.3',
    run: null,
    log: null,
  },
}

describe('the words the Bundles screens use', () => {
  test('signed names where it was built, with its links', () => {
    const words = signatureWords(SIGNED, null, undefined)
    expect(words).toMatchObject({ tone: 'positive', label: 'Signed', refusal: '' })
    expect(words.detail).toBe('Built from github.com/acme/bundles at v1.2.3 (0123456).')
    expect(words.links.map((link) => link.label)).toEqual(['Commit', 'Release'])
  })

  test('unsigned, local and a signature that does not match, in plain words', () => {
    expect(signatureWords({ state: 'unsigned' }, null, undefined).label).toBe('Not signed')
    expect(signatureWords({ state: 'local' }, null, undefined).label).toBe('From this site')
    const changed = signatureWords(
      { state: 'invalid', reason: 'the bundle has changed since it was signed' },
      'x',
      undefined,
    )
    expect(changed).toMatchObject({ tone: 'danger', refusal: '' })
    expect(changed.detail).toContain('changed since it was signed')
    for (const words of [
      changed,
      signatureWords({ state: 'invalid', reason: 'x' }, 'x', undefined),
    ])
      expect(`${words.label} ${words.detail}`).not.toMatch(
        /sigstore|digest|provenance|certificate/i,
      )
  })

  test("says what this site's policy would do", () => {
    expect(
      signatureWords({ state: 'unsigned' }, 'refused', { signatures: 'required', sources: [] })
        .refusal,
    ).toBe('This site only installs signed bundles.')
    expect(
      signatureWords(SIGNED, 'refused', { signatures: 'optional', sources: ['kineco-au/*'] })
        .refusal,
    ).toBe('This site only installs signed bundles from kineco-au/*.')
  })
})

// ---- The marketplace: the exact tarball checked before `bun add`

const REGISTRY = 'https://registry.example'
const NAME = '@acme/seo'

const manifest = (version = '1.2.3') => ({
  name: NAME,
  version,
  peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
  crombolo: {
    id: 'acme-seo',
    extensions: [{ type: 'dashboard', alias: 'acme.d', name: NAME, element: 'd.js' }],
  },
})

/** A packed bundle, with a provenance.json when given one. */
function tarball(provenance?: string): Uint8Array {
  const entries: TarEntry[] = [
    { path: 'package.json', bytes: new TextEncoder().encode(JSON.stringify(manifest())) },
    { path: 'd.js', bytes: new TextEncoder().encode('export default class {}\n') },
  ]
  if (provenance)
    entries.push({ path: PROVENANCE_FILE, bytes: new TextEncoder().encode(provenance) })
  return writeNpmTarball(entries)
}

const sri = (bytes: Uint8Array) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

function market(options: {
  bytes: Uint8Array
  integrity?: string
  policy?: ProvenancePolicy
  range?: string
  verify?: (dir: string) => Promise<ProvenanceResult>
}) {
  const root = temp('signatures-site')
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'a-site', dependencies: { [NAME]: options.range ?? '^1.2.3' } }),
  )
  const calls: string[] = []
  const extensions = createExtensionRegistry(root, { cache: false })
  // What `bun add` would leave behind: the package in node_modules.
  const install: PackageInstaller = async (action, specifier) => {
    calls.push(`${action} ${specifier}`)
    if (action === 'add') {
      const dir = join(root, 'node_modules', NAME)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest()))
    }
    return { ok: true, output: '' }
  }
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url === `${REGISTRY}/tarballs/seo-1.2.3.tgz`)
      return new Response(options.bytes as Uint8Array<ArrayBuffer>)
    return Response.json({
      'dist-tags': { latest: '1.2.3' },
      versions: {
        '1.2.3': {
          ...manifest(),
          dist: {
            tarball: `${REGISTRY}/tarballs/seo-1.2.3.tgz`,
            integrity: options.integrity ?? sri(options.bytes),
          },
        },
      },
    })
  }) as unknown as typeof fetch
  return {
    root,
    calls,
    market: createMarketplace({
      registry: REGISTRY,
      keyword: 'crombolo-bundle',
      marketplaceUrl: 'https://www.npmjs.com',
      extensions,
      siteDir: root,
      fetch: fetcher,
      install,
      policy: options.policy,
      ...(options.verify ? { verify: options.verify } : {}),
    }),
  }
}

describe('installing from the registry (story 060)', () => {
  test('a tarball whose signature does not match its files is refused, and nothing is added', async () => {
    const { market: m, calls } = market({ bytes: tarball(TAMPERED) })
    const outcome = await m.install(NAME, undefined)
    expect(outcome.ok).toBe(false)
    expect(outcome.provenance?.state).toBe('invalid')
    expect(outcome.message).toContain('its signature was not accepted')
    expect(calls).toEqual([])
  })

  test('a tarball that is not the one the registry describes is refused', async () => {
    const { market: m, calls } = market({ bytes: tarball(), integrity: 'sha512-AAAA' })
    const outcome = await m.install(NAME, undefined)
    expect(outcome.ok).toBe(false)
    expect(outcome.provenance?.reason).toContain('not the package the registry describes')
    expect(calls).toEqual([])
  })

  test('unsigned installs unless the site requires signatures', async () => {
    const optional = market({ bytes: tarball() })
    const installed = await optional.market.install(NAME, undefined)
    expect(installed.ok).toBe(true)
    expect(installed.provenance?.state).toBe('unsigned')
    expect(optional.calls).toEqual([`add ${NAME}`])

    const required = market({ bytes: tarball(), policy: { signatures: 'required', sources: [] } })
    const refused = await required.market.install(NAME, undefined)
    expect(refused.ok).toBe(false)
    expect(refused.message).toContain('CROMBOLO_BUNDLE_SIGNATURES=required')
    expect(required.calls).toEqual([])
  })

  test('a signed one from somewhere the site does not take is refused, naming both', async () => {
    const { market: m, calls } = market({
      bytes: tarball(),
      policy: { signatures: 'optional', sources: ['kineco-au/*'] },
      verify: async () => SIGNED,
    })
    const outcome = await m.install(NAME, undefined)
    expect(outcome.ok).toBe(false)
    expect(outcome.message).toContain('github.com/acme/bundles at v1.2.3')
    expect(outcome.message).toContain('kineco-au/*')
    expect(calls).toEqual([])
    const allowed = market({
      bytes: tarball(),
      policy: { signatures: 'required', sources: ['acme/*@v*'] },
      verify: async () => SIGNED,
    })
    expect((await allowed.market.install(NAME, undefined)).ok).toBe(true)
  })

  test('inspect says where a version was built, for the Install panel', async () => {
    const { market: m } = market({ bytes: tarball(), verify: async () => SIGNED })
    const inspected = await m.inspect(NAME)
    expect(inspected.ok && inspected.provenance.state).toBe('signed')
    expect(inspected.ok && inspected.version).toBe('1.2.3')
  })

  test('the Installed view gives each its signature; a linked one is local', async () => {
    const signed = market({ bytes: tarball(), verify: async () => SIGNED })
    await signed.market.install(NAME, undefined)
    expect((await signed.market.installed())[0]?.provenance.state).toBe('signed')

    const linked = market({ bytes: tarball(), range: 'workspace:*' })
    await linked.market.install(NAME, undefined)
    expect((await linked.market.installed())[0]?.provenance.state).toBe('local')
  })
})

// ---- Applying a bundle, here and on a remote

const PAGE = `[content-type]
key = "6f1d3c2a-0060-4a1e-9b2f-1c0d167a0001"
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

function siteDirectory() {
  const root = temp('signatures-apply')
  for (const dir of ['schema/content-types', 'components', 'content/pages'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  writeFileSync(
    join(root, 'content', 'pages', 'home.toml'),
    'type = "page"\nname = "Home"\n\n[values]\ntitle = "Hello"\n',
  )
  return root
}

/** The site's content, packed as a bundle: optionally with a provenance.json beside it. */
async function contentBundle(root: string, provenance?: string) {
  const built = await buildBundleFromDirectory(root, { media: true })
  expect(built.problems).toEqual([])
  const out = temp('signatures-bundle')
  writeSeedPackage(built.seed as NonNullable<typeof built.seed>, out)
  if (provenance) writeFileSync(join(out, PROVENANCE_FILE), provenance)
  return out
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

describe('applying a bundle to a remote (story 060)', () => {
  async function remote(policy: ProvenancePolicy) {
    const root = siteDirectory()
    const h = await signedInServer({
      config: {
        siteDir: root,
        schemaDir: join(root, 'schema'),
        componentsDir: join(root, 'components'),
        mediaDir: join(root, 'media'),
        bundlePolicy: policy,
        remote: {
          enabled: true,
          access: 'content',
          environment: 'production',
          protected: false,
          approvals: false,
          maxUploadBytes: 1024 ** 3,
        },
      },
    })
    open.push(h)
    const apply = (bytes: Uint8Array) =>
      h.server.fetch(
        new Request(`${ORIGIN}${REMOTE_API_PATH}/environments/production/bundles`, {
          method: 'PUT',
          headers: {
            cookie: h.cookie(),
            'content-type': 'application/gzip',
            'crombolo-sha256': createHash('sha256').update(bytes).digest('hex'),
            'crombolo-options': JSON.stringify({ dryRun: true }),
          },
          body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
        }),
      )
    return { root, apply }
  }

  test('an unsigned bundle is refused where signatures are required, and taken where not', async () => {
    const strict = await remote({ signatures: 'required', sources: [] })
    const bytes = writeNpmTarball(entriesOf(await contentBundle(strict.root)))
    const refused = await strict.apply(bytes)
    expect(refused.status).toBe(403)
    const body = (await refused.json()) as { code: string; detail: string }
    expect(body.code).toBe('signature-refused')
    expect(body.detail).toContain('CROMBOLO_BUNDLE_SIGNATURES=required')

    const lax = await remote({ signatures: 'optional', sources: [] })
    const taken = await lax.apply(bytes)
    expect(taken.status).toBe(200)
    expect(((await taken.json()) as { provenance: ProvenanceResult }).provenance.state).toBe(
      'unsigned',
    )
  })

  test('a bundle changed after it was signed is refused even where signatures are optional', async () => {
    const lax = await remote({ signatures: 'optional', sources: [] })
    const bytes = writeNpmTarball(entriesOf(await contentBundle(lax.root, TAMPERED)))
    const refused = await lax.apply(bytes)
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { detail: string }).detail).toContain(
      'has changed since it was signed',
    )
  })
})

describe('bundle apply on this machine (story 060)', () => {
  const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
  const cli = (site: string, args: string[]) => {
    const proc = Bun.spawnSync(['bun', BIN, ...args], {
      cwd: site,
      stdin: 'ignore',
      env: {
        ...process.env,
        CROMBOLO_DB: 'sqlite',
        CROMBOLO_SQLITE_FILE: join(site, 'site.sqlite'),
        CROMBOLO_MEDIA_DIR: join(site, 'media'),
        CROMBOLO_COMPONENTS_DIR: join(site, 'components'),
        CROMBOLO_SCHEMA_DIR: join(site, 'schema'),
        CROMBOLO_ADMIN_LOGIN: 'admin@crombolo.local',
        CROMBOLO_SECRET_KEY: 'a-test-secret-key-that-is-long-enough-to-use',
        CROMBOLO_LOG_TO_CONSOLE: 'false',
        CROMBOLO_BUNDLE_SIGNATURES: 'required',
      },
    })
    return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() }
  }

  test("the site's own content files are its own; another unsigned bundle is refused", async () => {
    const site = siteDirectory()
    expect(cli(site, ['types', 'sync']).code).toBe(0)
    const own = cli(site, ['bundle', 'apply', '--dry-run'])
    expect(own.code, own.out).toBe(0)
    expect(own.out).toContain('Local: from this machine')

    const other = cli(site, ['bundle', 'apply', await contentBundle(site), '--dry-run'])
    expect(other.code, other.out).toBe(ERROR_KINDS.refused.exitCode)
    expect(other.out).toContain('only signed bundles')
  }, 60_000)
})

describe('a signature that could not be checked (story 244)', () => {
  test('says so, as a warning, and that it will not be installed', () => {
    const words = signatureWords(
      { state: 'unchecked', reason: "Sigstore's trusted root could not be fetched" },
      'refused',
      { signatures: 'optional', sources: [] },
    )
    expect(words.label).toBe("Couldn't be checked right now")
    expect(words.tone).toBe('warning')
    expect(words.detail).toContain('will not be installed')
    expect(words.refusal).toBe('')
  })
})
