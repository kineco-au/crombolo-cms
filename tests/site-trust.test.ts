/**
 * Story 316: a site bundle is applied only when a key or a CI build this site
 * trusts signed it, this site's own key always among them, and never an older
 * version than it last applied from the same signer. Required in production,
 * flagged elsewhere.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  cromboloPlan,
  migrate,
  TransferRunRepository,
  TrustedSignerRepository,
} from '@crombolo/data'
import {
  type CromboloConfig,
  createKeyPair,
  createTrustedSignersAdmin,
  createUserKey,
  installBundleContent,
  loadConfig,
  type ProvenanceResult,
  readPublicKey,
  readUserKey,
  signPathWithKey,
  siteBundleTrust,
  siteSigningKey,
  VERSION,
  verifyProvenance,
} from '@crombolo/server'
import {
  type BundlePackageInfo,
  type ContentSet,
  exportBundle,
  writeBundle,
  writeBundlePackage,
} from '@crombolo/transfer'
import { dialectUnderTest, freshDb } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup } from './support/harness.ts'

const open: Harness[] = []
const dirs: string[] = []
const dbs: { close(): Promise<void> }[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dbs.length > 0)
    await dbs
      .pop()
      ?.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const KEY = 'a-secret-key-that-is-long-enough-to-use-0123'

const outputDir = (prefix: string) => {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const dir = mkdtempSync(join(process.cwd(), 'output', prefix))
  dirs.push(dir)
  return dir
}

const SITE_PACKAGE: BundlePackageInfo = {
  name: '@acme/site',
  version: '2.0.0',
  id: 'acme-site',
  label: 'Acme',
  peerRange: `>=${VERSION}`,
  bundleType: 'site',
  private: true,
}

/** A site package with a stylesheet, written where `dir` says. */
async function sitePackageAt(h: Harness, dir: string, version = '2.0.0'): Promise<string> {
  const { set } = await exportBundle(h.server.db, {
    roots: [],
    asGiven: [],
    descendants: false,
    snapshot: 'published',
    blueprints: false,
    withBlobs: false,
    siteName: 'Source',
    nodeId: 'source',
  })
  for (const file of writeBundlePackage(
    writeBundle(
      set as ContentSet,
      undefined,
      [{ path: 'styles/site.css', text: 'body { margin: 0 }\n' }],
      { bundleType: 'site' },
    ),
    { ...SITE_PACKAGE, version },
  )) {
    const target = join(dir, file.path)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, file.bytes ?? (file.text as string))
  }
  return dir
}

async function migrated() {
  const db = await freshDb()
  dbs.push(db)
  await migrate(db, cromboloPlan)
  return db
}

const configFor = (over: Partial<CromboloConfig> = {}) =>
  loadConfig({ secretKey: KEY, siteName: 'Production', development: false, ...over }, process.cwd())

describe('keys', () => {
  test('a public key is one line, read back with its fingerprint; anything else is refused', () => {
    const pair = createKeyPair('laptop')
    expect(pair.publicKey.line).toMatch(/^crombolo-ed25519 [A-Za-z0-9+/]{43}= laptop$/)
    expect(pair.publicKey.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
    expect(readPublicKey(pair.publicKey.line)).toEqual(pair.publicKey)
    expect(readPublicKey('ssh-ed25519 AAAA')).toHaveProperty('problem')
    expect(readPublicKey('crombolo-ed25519 AAAA')).toHaveProperty('problem')
  })

  test('a user key is made on this machine, readable by its owner alone, and read back by name', () => {
    const dir = outputDir('keys-')
    const made = createUserKey('laptop', 'Adam', dir)
    const mode = Bun.file(join(dir, 'laptop.json')).size > 0
    expect(mode).toBe(true)
    expect(readUserKey('laptop', dir).publicKey).toEqual(made.publicKey)
    expect(() => createUserKey('laptop', 'Adam', dir)).toThrow('already a key called laptop')
  })

  test(`a site's key is made once, sealed, and the same after (${dialectUnderTest})`, async () => {
    const db = await migrated()
    const config = configFor()
    const first = await siteSigningKey(db, config)
    const again = await siteSigningKey(db, config)
    expect(first?.publicKey.fingerprint).toBe(again?.publicKey.fingerprint as string)
    expect(await siteSigningKey(db, { ...config, secretKey: undefined })).toBeUndefined()
  })
})

describe('a key signature over a site package', () => {
  test('checks out, names its key and version, and fails once a file changes', async () => {
    const h = await signedInServer()
    open.push(h)
    const dir = await sitePackageAt(h, outputDir('signed-'))
    const pair = createKeyPair('Staging')
    await signPathWithKey(dir, pair)
    const result = await verifyProvenance(dir)
    expect(result).toMatchObject({
      state: 'signed',
      key: { fingerprint: pair.publicKey.fingerprint, comment: 'Staging' },
      package: { name: '@acme/site', version: '2.0.0' },
    })
    writeFileSync(join(dir, 'styles', 'site.css'), 'body { background: red }\n')
    expect((await verifyProvenance(dir)).state).toBe('invalid')
  })
})

describe(`which site bundles a site applies (${dialectUnderTest})`, () => {
  const signedBy = (fingerprint: string, version = '2.0.0'): ProvenanceResult => ({
    state: 'signed',
    key: { key: '', comment: 'k', fingerprint, line: '' },
    package: { name: '@acme/site', version },
  })

  test('in production: none unsigned, none by a key it does not trust; its own key and a trusted one are', async () => {
    const db = await migrated()
    const config = configFor()
    const own = (await siteSigningKey(db, config))?.publicKey.fingerprint as string
    const other = createKeyPair('Staging').publicKey

    expect((await siteBundleTrust(db, config, { state: 'unsigned' })).problem).toContain(
      'not signed',
    )
    expect((await siteBundleTrust(db, config, signedBy(other.fingerprint))).problem).toContain(
      'does not trust',
    )
    expect(await siteBundleTrust(db, config, signedBy(own))).toEqual({ signedBy: own })

    await createTrustedSignersAdmin(db, config).add(
      { id: null, name: 'cli', email: null, source: 'cli' },
      { kind: 'site', name: 'Staging', publicKey: other.line },
    )
    expect(await siteBundleTrust(db, config, signedBy(other.fingerprint))).toMatchObject({
      signedBy: other.fingerprint,
      entryId: expect.any(String),
    })
    expect(
      (await siteBundleTrust(db, config, { state: 'invalid', reason: 'x' })).problem,
    ).toContain('not accepted')
  })

  test('outside production, unsigned and untrusted bundles apply, flagged', async () => {
    const db = await migrated()
    const config = configFor({ development: true })
    const unsigned = await siteBundleTrust(db, config, { state: 'unsigned' })
    expect(unsigned.problem).toBeUndefined()
    expect(unsigned.warning).toContain('not production')
  })

  test('a CI build the site trusts signs as a key does, and the config locks what it lists', async () => {
    const db = await migrated()
    const pair = createKeyPair('laptop')
    const config = configFor({
      trustedSources: [{ name: 'Releases', source: 'acme/site@v*' }],
      trustedKeys: [{ name: 'Adam', publicKey: pair.publicKey.line }],
    })
    const built: ProvenanceResult = {
      state: 'signed',
      source: {
        issuer: '',
        repository: 'acme/site',
        ref: 'refs/tags/v2.0.0',
        commit: 'abc1234',
        workflow: '',
        run: null,
      },
      package: { name: '@acme/site', version: '2.0.0' },
    }
    expect(await siteBundleTrust(db, config, built)).toEqual({ signedBy: 'acme/site' })
    expect(
      (
        await siteBundleTrust(db, config, {
          ...built,
          source: { ...(built.source as NonNullable<typeof built.source>), ref: 'refs/heads/main' },
        })
      ).problem,
    ).toContain('does not trust')
    expect(await siteBundleTrust(db, config, signedBy(pair.publicKey.fingerprint))).toEqual({
      signedBy: pair.publicKey.fingerprint,
    })
    const listed = await createTrustedSignersAdmin(db, config).list()
    expect(listed.filter((entry) => entry.locked).map((entry) => entry.name)).toEqual([
      'Production (this site)',
      'Adam',
      'Releases',
    ])
  })

  test('an older version from the same signer is refused, unless asked for, and then says so', async () => {
    const db = await migrated()
    const config = configFor()
    const own = (await siteSigningKey(db, config))?.publicKey.fingerprint as string
    await new TransferRunRepository(db).start({
      id: crypto.randomUUID(),
      bundleId: 'acme-site',
      bundleLabel: null,
      packageName: '@acme/site',
      packageVersion: '2.0.0',
      bundleType: 'site',
      signedBy: own,
      direction: 'import',
      revertsRunId: null,
      schemaStateId: 0,
      startedAt: new Date(),
      appliedBy: null,
      nodeCount: 0,
    })
    const older = await siteBundleTrust(db, config, signedBy(own, '1.0.0'))
    expect(older.problem).toContain('older than 2.0.0')
    expect(older.problem).toContain('--allow-downgrade')
    expect(
      await siteBundleTrust(db, config, signedBy(own, '1.0.0'), { allowDowngrade: true }),
    ).toMatchObject({ downgraded: { from: '2.0.0', to: '1.0.0' } })
    expect((await siteBundleTrust(db, config, signedBy(own, '2.1.0'))).problem).toBeUndefined()
  })
})

describe('applying a site package in production', () => {
  test('refuses one unsigned, and one whose files changed; applies one this site signed', async () => {
    // A site of its own, so the stylesheet it applies lands nowhere another test reads.
    const root = outputDir('site-trust-site-')
    for (const dir of ['schema', 'components', 'css', 'scripts'])
      mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    const h = await signedInServer({
      config: {
        secretKey: KEY,
        siteDir: root,
        schemaDir: join(root, 'schema'),
        componentsDir: join(root, 'components'),
        stylesheetsDir: join(root, 'css'),
        scriptsDir: join(root, 'scripts'),
      },
    })
    open.push(h)
    const config = { ...h.server.config, development: false }
    const db = h.server.db

    const unsigned = await sitePackageAt(h, outputDir('unsigned-'))
    const refused = await installBundleContent(db, config, { bundle: unsigned, backupTaken: true })
    expect(refused.runId).toBeUndefined()
    expect(refused.problems.join()).toContain('not signed')

    const own = (await siteSigningKey(db, config)) as NonNullable<
      Awaited<ReturnType<typeof siteSigningKey>>
    >
    const signed = await sitePackageAt(h, outputDir('signed-'))
    await signPathWithKey(signed, own)
    const tampered = await sitePackageAt(h, outputDir('tampered-'))
    await signPathWithKey(tampered, own)
    writeFileSync(join(tampered, 'styles', 'site.css'), 'body { background: red }\n')
    // The payload's own integrity fails first; either way, nothing is applied.
    await expect(
      installBundleContent(db, config, { bundle: tampered, backupTaken: true }),
    ).rejects.toThrow('damaged')

    const applied = await installBundleContent(db, config, { bundle: signed, backupTaken: true })
    expect(applied.problems).toEqual([])
    expect(applied.runId).toBeDefined()
    const run = await new TransferRunRepository(db).byId(applied.runId as string)
    expect(run?.signedBy).toBe(own.publicKey.fingerprint)
    expect(JSON.parse(readFileSync(join(signed, 'provenance.json'), 'utf8')).key.version).toBe(
      '2.0.0',
    )
  })
})

describe('trusted signers in Settings', () => {
  const API = `${BACKOFFICE}/crombolo/api/bundles/signers`

  test('an administrator adds, renames and removes them; duplicates are refused; each is audited', async () => {
    const h = await signedInServer({ config: { secretKey: KEY } })
    open.push(h)
    const key = createKeyPair('laptop').publicKey
    const listed = async () =>
      (await h.json<{ items: { id?: string; name: string; own?: boolean }[] }>(API)).items
    expect((await listed())[0]?.own).toBe(true)

    const added = await h.post(API, { kind: 'user', name: 'Adam’s laptop', publicKey: key.line })
    expect(added.status).toBe(200)
    expect((await h.post(API, { kind: 'user', name: 'Again', publicKey: key.line })).status).toBe(
      409,
    )
    expect((await h.post(API, { kind: 'user', name: 'Bad', publicKey: 'nope' })).status).toBe(400)
    expect(
      (await h.post(API, { kind: 'source', name: 'Releases', source: 'acme/site@v*' })).status,
    ).toBe(200)

    const id = (await listed()).find((entry) => entry.name === 'Adam’s laptop')?.id as string
    expect((await h.put(`${API}/${id}`, { name: 'Adam' })).status).toBe(200)
    expect((await listed()).map((entry) => entry.name)).toContain('Adam')
    expect((await h.del(`${API}/${id}`)).status).toBe(200)
    expect((await listed()).map((entry) => entry.name)).not.toContain('Adam')
    const rows = await new TrustedSignerRepository(h.server.db).all()
    expect(rows.map((row) => row.name)).toEqual(['Releases'])
  })

  test('nobody but an administrator sees or changes them', async () => {
    const h = await signedInServer({ config: { secretKey: KEY } })
    open.push(h)
    const editor = await signInAsGroup(h, 'editor')
    expect((await editor.call(API)).status).toBe(403)
  })
})
