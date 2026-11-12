/**
 * Story 060: a bundle's signature. The Sigstore chain is checked against a real
 * signature and Sigstore's trusted root, both recorded, so nothing here needs
 * the network. A signature in this format is made in GitHub Actions only, so the
 * checks after the chain run behind the verifier's seam, over that recorded
 * signature's own certificate.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  describeProvenance,
  PROVENANCE_FILE,
  PROVENANCE_PREDICATE,
  type ProvenanceResult,
  packageDigest,
  provenanceProblem,
  sourceAllowed,
  sourceOf,
  verifyProvenance,
  verifyProvenanceWith,
} from '@crombolo/server'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const FIXTURES = join(import.meta.dir, 'fixtures', 'sigstore')
const recorded = JSON.parse(readFileSync(join(FIXTURES, 'npm-provenance.sigstore.json'), 'utf8'))
const trustedRoot = JSON.parse(readFileSync(join(FIXTURES, 'trusted-root.json'), 'utf8'))
const recordedSource = sourceOf(recorded)

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function bundleDir(files: Record<string, string> = {}) {
  const dir = mkdtempSync(join(process.cwd(), 'output', 'provenance-'))
  dirs.push(dir)
  for (const [path, text] of Object.entries({
    'package.json': '{ "name": "@acme/crm", "version": "1.2.0" }\n',
    'plugin/index.js': 'export const crm = true\n',
    ...files,
  })) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

const statementFor = (digest: string, predicateType = PROVENANCE_PREDICATE) =>
  Buffer.from(
    JSON.stringify({
      _type: 'https://in-toto.io/Statement/v1',
      subject: [{ name: '@acme/crm', digest: { sha256: digest.replace(/^sha256-/, '') } }],
      predicateType,
      predicate: { format: 1 },
    }),
  ).toString('base64')

/** provenance.json as `bundle sign` writes it, over the recorded signature's certificate. */
function sign(dir: string, change: { payload?: string; source?: object } = {}) {
  const digest = packageDigest(dir)
  const signature = structuredClone(recorded)
  signature.dsseEnvelope.payload = change.payload ?? statementFor(digest)
  writeFileSync(
    join(dir, PROVENANCE_FILE),
    JSON.stringify({
      format: 1,
      digest,
      signature,
      source: { ...recordedSource, ...change.source },
      links: {},
    }),
  )
  return digest
}

/** The chain is the recorded one; what follows it is what this story checks. */
const trusted = (dir: string) => verifyProvenanceWith(dir, {}, { verifySignature: () => {} })

describe('the package digest', () => {
  test('covers every file but provenance.json, installs and history', () => {
    const dir = bundleDir()
    const before = packageDigest(dir)
    writeFileSync(join(dir, PROVENANCE_FILE), '{}')
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), '1')
    expect(packageDigest(dir)).toBe(before)
    writeFileSync(join(dir, 'plugin', 'index.js'), 'export const crm = false\n')
    expect(packageDigest(dir)).not.toBe(before)
  })

  test('is the same whatever order the files were written in', () => {
    const a = bundleDir({ 'b.txt': 'b', 'a.txt': 'a', 'Z.txt': 'Z', 'dir/c.txt': 'c' })
    const b = bundleDir({ 'dir/c.txt': 'c', 'Z.txt': 'Z', 'a.txt': 'a', 'b.txt': 'b' })
    expect(packageDigest(a)).toBe(packageDigest(b))
  })
})

describe('checking a signature', () => {
  test('a bundle with no provenance.json is unsigned', async () => {
    expect((await trusted(bundleDir())).state).toBe('unsigned')
  })

  test('a signed bundle names where it was built, from its certificate', async () => {
    const dir = bundleDir()
    sign(dir)
    const result = await trusted(dir)
    expect(result.state).toBe('signed')
    expect(result.source).toMatchObject({
      repository: 'sigstore/sigstore-js',
      ref: 'refs/heads/main',
      commit: '06cd267cbdc2eeaa04294995622db9f6ad2fa7cf',
    })
    expect(result.links?.commit).toBe(
      'https://github.com/sigstore/sigstore-js/commit/06cd267cbdc2eeaa04294995622db9f6ad2fa7cf',
    )
    expect(describeProvenance(result)).toBe(
      'Signed: built from github.com/sigstore/sigstore-js at main (06cd267)',
    )
  })

  test('a file changed after signing is refused', async () => {
    const dir = bundleDir()
    sign(dir)
    writeFileSync(join(dir, 'plugin', 'index.js'), 'export const crm = "changed"\n')
    const result = await trusted(dir)
    expect(result).toMatchObject({ state: 'invalid' })
    expect(result.reason).toContain('changed since it was signed')
  })

  test('a signature for another bundle is refused', async () => {
    const dir = bundleDir()
    sign(dir, { payload: statementFor(`sha256-${'0'.repeat(64)}`) })
    expect((await trusted(dir)).reason).toContain('different bundle')
  })

  test('a signature that is not a bundle signature is refused', async () => {
    const dir = bundleDir()
    sign(dir, { payload: statementFor(packageDigest(dir), 'https://slsa.dev/provenance/v1') })
    expect((await trusted(dir)).reason).toContain('not a Crombolo bundle signature')
  })

  test('provenance.json that claims another source than its certificate is refused', async () => {
    const dir = bundleDir()
    sign(dir, { source: { repository: 'acme/crm' } })
    const result = await trusted(dir)
    expect(result.state).toBe('invalid')
    expect(result.reason).toContain('says repository acme/crm')
  })

  test('the real chain: a recorded signature checks out against the recorded trust root', async () => {
    // It is npm's provenance, not a bundle signature, so getting this far means
    // Sigstore accepted the certificate, the log entry and the signature.
    const dir = bundleDir()
    sign(dir, { payload: recorded.dsseEnvelope.payload })
    const result = await verifyProvenance(dir, { trustedRoot })
    expect(result.reason).toContain('not a Crombolo bundle signature')
  })

  test('the real chain: a statement swapped under the signature is refused', async () => {
    const dir = bundleDir()
    sign(dir)
    const result = await verifyProvenance(dir, { trustedRoot })
    expect(result.state).toBe('invalid')
    expect(result.reason).toContain('does not check out')
  })

  test('the real chain: a certificate from an authority the root does not trust is refused', async () => {
    const dir = bundleDir()
    sign(dir, { payload: recorded.dsseEnvelope.payload })
    const result = await verifyProvenance(dir, {
      trustedRoot: { ...trustedRoot, certificateAuthorities: [] },
    })
    expect(result.reason).toContain('does not check out')
  })
})

describe('a trust root that cannot be had (story 244)', () => {
  test('is unchecked, not invalid or unsigned, and refused under every policy', async () => {
    const dir = bundleDir()
    sign(dir)
    const result = await verifyProvenanceWith(
      dir,
      {},
      { publicRoot: () => Promise.reject(new Error('tuf-repo-cdn.sigstore.dev is unreachable')) },
    )
    expect(result.state).toBe('unchecked')
    expect(result.reason).toContain('unreachable')
    expect(describeProvenance(result)).toStartWith("Couldn't be checked right now")
    expect(provenanceProblem(result, { signatures: 'optional', sources: [] })).toContain(
      'could not be checked right now',
    )
  })

  test('an unsigned bundle needs no trust root, so stays unsigned', async () => {
    const result = await verifyProvenanceWith(
      bundleDir(),
      {},
      { publicRoot: () => Promise.reject(new Error('unreachable')) },
    )
    expect(result.state).toBe('unsigned')
  })
})

describe('what a site takes', () => {
  const signed: ProvenanceResult = {
    state: 'signed',
    source: {
      issuer: '',
      repository: 'kineco-au/crombolo-cms',
      ref: 'refs/tags/v0.45.0',
      commit: 'abc',
      workflow: '',
      run: null,
    },
  }
  const optional = { signatures: 'optional' as const, sources: [] }

  test('an unsigned bundle unless the site requires a signature', () => {
    expect(provenanceProblem({ state: 'unsigned' }, optional)).toBeUndefined()
    expect(
      provenanceProblem({ state: 'unsigned' }, { signatures: 'required', sources: [] }),
    ).toContain('CROMBOLO_BUNDLE_SIGNATURES=required')
  })

  test('never an invalid signature; always its own local bundle', () => {
    expect(provenanceProblem({ state: 'invalid', reason: 'x' }, optional)).toContain(
      'not accepted: x',
    )
    expect(
      provenanceProblem({ state: 'local' }, { signatures: 'required', sources: ['a/b'] }),
    ).toBe(undefined)
  })

  test('a signed bundle only from the sources it lists', () => {
    expect(sourceAllowed(signed.source as never, 'kineco-au/*')).toBe(true)
    expect(sourceAllowed(signed.source as never, 'Kineco-AU/crombolo-cms')).toBe(true)
    expect(sourceAllowed(signed.source as never, 'kineco-au/crombolo-cms@v*')).toBe(true)
    expect(sourceAllowed(signed.source as never, 'kineco-au/crombolo-cms@release-*')).toBe(false)
    expect(sourceAllowed(signed.source as never, 'acme/*')).toBe(false)
    expect(provenanceProblem(signed, { signatures: 'required', sources: ['acme/*'] })).toContain(
      'only from acme/*',
    )
  })
})

describe('the commands', () => {
  const cli = (...args: string[]) => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      CROMBOLO_LOG_TO_CONSOLE: 'false',
    }
    delete env.GITHUB_ACTIONS
    delete env.ACTIONS_ID_TOKEN_REQUEST_URL
    const proc = Bun.spawnSync(['bun', join(ROOT, 'packages/cli/bin/crombolo.ts'), ...args], {
      stdin: 'ignore',
      env,
    })
    return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() }
  }

  test('bundle sign is refused outside GitHub Actions, naming what it needs', () => {
    const run = cli('bundle', 'sign', bundleDir())
    expect(run.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(run.out).toContain('id-token: write')
  })

  test('bundle sign in a private repository is refused unless the public log is accepted', () => {
    const event = join(bundleDir(), 'event.json')
    writeFileSync(event, JSON.stringify({ repository: { private: true, visibility: 'private' } }))
    const proc = Bun.spawnSync(
      ['bun', join(ROOT, 'packages/cli/bin/crombolo.ts'), 'bundle', 'sign', bundleDir()],
      {
        stdin: 'ignore',
        env: {
          ...process.env,
          GITHUB_ACTIONS: 'true',
          ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/token',
          GITHUB_EVENT_PATH: event,
          CROMBOLO_LOG_TO_CONSOLE: 'false',
        },
      },
    )
    const out = proc.stdout.toString() + proc.stderr.toString()
    expect(proc.exitCode).toBe(ERROR_KINDS.refused.exitCode)
    expect(out).toContain('This repository is private')
    expect(out).toContain('--public-log')
  })

  test('bundle digest prints the digest; bundle verify says unsigned, and --require refuses it', () => {
    const dir = bundleDir()
    expect(cli('bundle', 'digest', dir).out.trim()).toBe(packageDigest(dir))
    const verified = cli('bundle', 'verify', dir)
    expect(verified.code).toBe(0)
    expect(verified.out).toContain('Not signed')
    expect(cli('bundle', 'verify', dir, '--require').code).toBe(ERROR_KINDS.refused.exitCode)
  })

  test('bundle sign --key signs with a key of yours, and bundle verify names it (story 335)', () => {
    const home = mkdtempSync(join(tmpdir(), 'crombolo-keys-'))
    const run = (...args: string[]) => {
      const proc = Bun.spawnSync(['bun', join(ROOT, 'packages/cli/bin/crombolo.ts'), ...args], {
        stdin: 'ignore',
        env: { ...process.env, XDG_CONFIG_HOME: home, CROMBOLO_LOG_TO_CONSOLE: 'false' },
      })
      return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() }
    }
    try {
      expect(run('keys', 'create', 'release').code).toBe(0)
      const dir = bundleDir()
      const signed = run('bundle', 'sign', dir, '--key', 'release')
      expect(signed.code, signed.out).toBe(0)
      expect(signed.out).toContain('signed by release')
      const verified = run('bundle', 'verify', dir)
      expect(verified.code, verified.out).toBe(0)
      expect(verified.out).toContain('Signed: signed by release')
      expect(run('bundle', 'sign', dir, '--key', 'nobody').code).toBe(ERROR_KINDS.refused.exitCode)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('bundle verify refuses a bundle changed after signing', () => {
    const dir = bundleDir()
    sign(dir)
    writeFileSync(join(dir, 'package.json'), '{ "name": "@acme/crm", "version": "9.9.9" }\n')
    const run = cli('bundle', 'verify', dir)
    expect(run.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(run.out).toContain('changed since it was signed')
  })
})
