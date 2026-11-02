/**
 * Where a bundle was built (story 060): a Sigstore signature over the package,
 * made in GitHub Actions from the commit or tag it was built at, kept in the
 * package as `provenance.json` with links to the commit, the tag, the run and
 * the transparency log. Optional: an unsigned bundle is still a bundle. One
 * whose signature does not check out is always refused. `docs/bundles.md`,
 * "Signing a bundle".
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { bundleFromJSON, type SerializedBundle } from '@sigstore/bundle'
import { X509Certificate } from '@sigstore/core'
import { TrustedRoot } from '@sigstore/protobuf-specs'
import { toSignedEntity, toTrustMaterial, Verifier } from '@sigstore/verify'

/** The file in a package that holds its signature, and the one file the digest leaves out. */
export const PROVENANCE_FILE = 'provenance.json'

/** What the signed statement says it is about. */
export const PROVENANCE_PREDICATE = 'https://crombolo.dev/bundle-provenance/v1'

const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com'

/**
 * Loaded by name: their type declarations need packages a site does not
 * install, so a site that type-checks its own components would fail on them.
 */
const SIGSTORE = 'sigstore'
const SIGSTORE_TUF = '@sigstore/tuf'
interface SigstoreModule {
  attest(payload: Buffer, payloadType: string): Promise<SerializedBundle>
}
interface TufModule {
  getTrustedRoot(options: { cachePath: string; forceCache?: boolean }): Promise<TrustedRoot>
}
const IN_TOTO = 'application/vnd.in-toto+json'

/** Fulcio's certificate extensions: what GitHub said about the job that signed. */
const OID = {
  issuer: '1.3.6.1.4.1.57264.1.8',
  workflow: '1.3.6.1.4.1.57264.1.9',
  repository: '1.3.6.1.4.1.57264.1.12',
  commit: '1.3.6.1.4.1.57264.1.13',
  ref: '1.3.6.1.4.1.57264.1.14',
  run: '1.3.6.1.4.1.57264.1.21',
} as const

/** Where a signed bundle was built, as its certificate says. */
export interface ProvenanceSource {
  issuer: string
  /** `owner/repo`. */
  repository: string
  /** `refs/tags/v1.2.0` or `refs/heads/main`, as it was when the bundle was signed. */
  ref: string
  commit: string
  /** The workflow file and ref that signed it. */
  workflow: string
  run: string | null
}

export interface ProvenanceLinks {
  commit: string
  /** The tag's page, when the bundle was signed from a tag. */
  tag: string | null
  run: string | null
  log: string | null
}

/** `provenance.json`. */
export interface ProvenanceFile {
  format: 1
  digest: string
  signature: SerializedBundle
  source: ProvenanceSource
  links: ProvenanceLinks
}

export type ProvenanceState = 'signed' | 'unsigned' | 'invalid' | 'local'

export interface ProvenanceResult {
  state: ProvenanceState
  digest?: string
  source?: ProvenanceSource
  links?: ProvenanceLinks
  /** Why a signature was not accepted, in words a person can act on. */
  reason?: string
}

/** Every file a package's digest covers: all of it but its signature, installs and history. */
function packageFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      if (name === 'node_modules' || name === '.git') continue
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else out.push(relative(dir, path).split(sep).join('/'))
    }
  }
  walk(dir)
  // By code unit, not locale: the digest has to be the same on every machine.
  return out.filter((path) => path !== PROVENANCE_FILE).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * The package digest: SHA-256 over every file but `provenance.json`, in path
 * order, as `bundleIntegrity` hashes a payload. It covers what a bundle's own
 * integrity does not: `package.json` and an extension bundle's code.
 */
export function packageDigest(dir: string): string {
  const hasher = new Bun.CryptoHasher('sha256')
  for (const path of packageFiles(dir)) {
    hasher.update(path)
    hasher.update('\0')
    hasher.update(readFileSync(join(dir, path)))
    hasher.update('\n')
  }
  return `sha256-${hasher.digest('hex')}`
}

const hexOf = (digest: string) => digest.replace(/^sha256-/, '')

/** The statement signed: the digest alone, so the public log learns nothing of the bundle but it. */
function statement(digest: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      _type: 'https://in-toto.io/Statement/v1',
      subject: [{ name: 'crombolo-bundle', digest: { sha256: hexOf(digest) } }],
      predicateType: PROVENANCE_PREDICATE,
      predicate: { format: 1 },
    }),
  )
}

function extensionText(cert: X509Certificate, oid: string): string | undefined {
  const extension = cert.extension(oid)
  return extension?.valueObj.subs?.[0]?.value.toString('utf8')
}

const leafOf = (bundle: SerializedBundle): X509Certificate | undefined => {
  const material = bundle.verificationMaterial as Record<string, unknown>
  const raw =
    (material.certificate as { rawBytes?: string } | undefined)?.rawBytes ??
    (material.x509CertificateChain as { certificates?: Array<{ rawBytes: string }> } | undefined)
      ?.certificates?.[0]?.rawBytes
  return raw ? X509Certificate.parse(Buffer.from(raw, 'base64')) : undefined
}

/** What the certificate says about the job that signed; undefined when it is not one. */
export function sourceOf(bundle: SerializedBundle): ProvenanceSource | undefined {
  const cert = leafOf(bundle)
  if (!cert) return undefined
  const repositoryUri = extensionText(cert, OID.repository)
  const commit = extensionText(cert, OID.commit)
  const ref = extensionText(cert, OID.ref)
  if (!repositoryUri || !commit || !ref) return undefined
  return {
    issuer: extensionText(cert, OID.issuer) ?? '',
    repository: repositoryUri.replace(/^https:\/\/github\.com\//, ''),
    ref,
    commit,
    workflow: extensionText(cert, OID.workflow) ?? '',
    run: extensionText(cert, OID.run) ?? null,
  }
}

function linksFor(source: ProvenanceSource, bundle: SerializedBundle): ProvenanceLinks {
  const repo = `https://github.com/${source.repository}`
  const tag = source.ref.startsWith('refs/tags/') ? source.ref.slice('refs/tags/'.length) : null
  const logIndex = (bundle.verificationMaterial as { tlogEntries?: Array<{ logIndex?: string }> })
    .tlogEntries?.[0]?.logIndex
  return {
    commit: `${repo}/commit/${source.commit}`,
    tag: tag ? `${repo}/releases/tag/${encodeURIComponent(tag)}` : null,
    run: source.run,
    log: logIndex ? `https://search.sigstore.dev/?logIndex=${logIndex}` : null,
  }
}

/** The ref as a person names it: `v1.2.0`, or the branch. */
export const refName = (ref: string): string => ref.replace(/^refs\/(tags|heads)\//, '')

/** One line for a person: where it was built, or that it was not signed. */
export function describeProvenance(result: ProvenanceResult): string {
  switch (result.state) {
    case 'signed': {
      const source = result.source as ProvenanceSource
      return `Signed: built from github.com/${source.repository} at ${refName(source.ref)} (${source.commit.slice(0, 7)})`
    }
    case 'unsigned':
      return 'Not signed'
    case 'local':
      return 'Local: from this machine, not a registry'
    case 'invalid':
      return `Signature not accepted: ${result.reason ?? 'it does not check out'}`
  }
}

export interface SignOptions {
  /**
   * Sign from a private or internal repository anyway. Sigstore's public log
   * then records the repository's name, workflow, ref and commit for good.
   */
  publicLog?: boolean
}

/** The job's repository visibility, from the event GitHub Actions gives it; undefined when it does not say. */
export function repositoryVisibility(): 'public' | 'private' | 'internal' | undefined {
  const path = Bun.env.GITHUB_EVENT_PATH
  if (!path || !existsSync(path)) return undefined
  try {
    const repo = (
      JSON.parse(readFileSync(path, 'utf8')) as {
        repository?: { visibility?: unknown; private?: unknown }
      }
    ).repository
    if (
      repo?.visibility === 'public' ||
      repo?.visibility === 'private' ||
      repo?.visibility === 'internal'
    )
      return repo.visibility
    if (typeof repo?.private === 'boolean') return repo.private ? 'private' : 'public'
  } catch {}
  return undefined
}

/**
 * Signs a package directory in GitHub Actions, writing `provenance.json`. The
 * job needs `id-token: write`; Sigstore turns its identity token into a
 * short-lived certificate naming the repository, ref, commit and workflow.
 */
export async function signPackage(dir: string, options: SignOptions = {}): Promise<ProvenanceFile> {
  if (Bun.env.GITHUB_ACTIONS !== 'true' || !Bun.env.ACTIONS_ID_TOKEN_REQUEST_URL)
    throw new Error(
      'A bundle is signed in GitHub Actions, by a job with `permissions: id-token: write`: run `crombolo bundle sign` there.',
    )
  const visibility = repositoryVisibility()
  if (visibility !== 'public' && !options.publicLog)
    throw new Error(
      `${visibility === undefined ? 'GitHub Actions did not say whether this repository is public' : `This repository is ${visibility}`}: signing records its name, the workflow, the tag or branch and the commit in Sigstore's public log, for good. Pass --public-log to sign anyway.`,
    )
  const { attest } = (await import(SIGSTORE)) as SigstoreModule
  const digest = packageDigest(dir)
  const signature = await attest(statement(digest), IN_TOTO)
  const source = sourceOf(signature)
  if (!source) throw new Error('The signature Sigstore returned names no GitHub repository.')
  const file: ProvenanceFile = {
    format: 1,
    digest,
    signature,
    source,
    links: linksFor(source, signature),
  }
  writeFileSync(join(dir, PROVENANCE_FILE), `${JSON.stringify(file, null, 2)}\n`)
  return file
}

export interface VerifyProvenanceOptions {
  /** Sigstore's trusted root as JSON; the public one, refreshed through TUF, by default. */
  trustedRoot?: unknown
  /**
   * Checks the Sigstore bundle itself, throwing when it does not verify; the
   * Sigstore verifier by default. Only a test passes one: a signature in this
   * format is made in GitHub Actions, not offline.
   */
  verifySignature?: (signature: SerializedBundle) => void | Promise<void>
}

let publicRoot: { at: number; root: Promise<TrustedRoot> } | undefined
const ROOT_FOR_MS = 60 * 60_000

/** Sigstore's public trusted root, fetched through TUF at most hourly, falling back to its cache. */
function publicTrustedRoot(): Promise<TrustedRoot> {
  if (!publicRoot || Date.now() - publicRoot.at > ROOT_FOR_MS) {
    const cachePath = join(
      Bun.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
      'crombolo',
      'sigstore',
    )
    const root = (import(SIGSTORE_TUF) as Promise<TufModule>).then(({ getTrustedRoot }) =>
      getTrustedRoot({ cachePath }).catch(() => getTrustedRoot({ cachePath, forceCache: true })),
    )
    publicRoot = { at: Date.now(), root }
    root.catch(() => {
      publicRoot = undefined
    })
  }
  return publicRoot.root
}

const invalid = (reason: string, digest?: string): ProvenanceResult => ({
  state: 'invalid',
  reason,
  ...(digest ? { digest } : {}),
})

/**
 * Checks a package directory's signature: its digest, Sigstore's signature and
 * certificate against the trusted root, that GitHub Actions signed it, and that
 * `provenance.json` claims what the certificate says. Unsigned when there is no
 * `provenance.json`; invalid, with the reason, when anything disagrees.
 */
export async function verifyProvenance(
  dir: string,
  options: VerifyProvenanceOptions = {},
): Promise<ProvenanceResult> {
  const file = join(dir, PROVENANCE_FILE)
  if (!existsSync(file)) return { state: 'unsigned' }
  let provenance: ProvenanceFile
  try {
    provenance = JSON.parse(readFileSync(file, 'utf8')) as ProvenanceFile
  } catch {
    return invalid(`${PROVENANCE_FILE} is not JSON`)
  }
  if (provenance.format !== 1 || !provenance.signature)
    return invalid(`${PROVENANCE_FILE} is not a format this release reads`)
  const digest = packageDigest(dir)
  if (provenance.digest !== digest)
    return invalid('the bundle has changed since it was signed', digest)

  let check = options.verifySignature
  if (!check) {
    let root: TrustedRoot
    try {
      root =
        options.trustedRoot !== undefined
          ? TrustedRoot.fromJSON(options.trustedRoot)
          : await publicTrustedRoot()
    } catch (error) {
      return invalid(
        `Sigstore's trusted root could not be fetched, so the signature cannot be checked: ${error instanceof Error ? error.message : String(error)}`,
        digest,
      )
    }
    check = (signature) => {
      new Verifier(toTrustMaterial(root)).verify(toSignedEntity(bundleFromJSON(signature)), {
        extensions: { issuer: GITHUB_ISSUER },
      })
    }
  }
  let signed: Buffer
  try {
    await check(provenance.signature)
    const envelope = (provenance.signature as { dsseEnvelope?: { payload: string } }).dsseEnvelope
    if (!envelope) return invalid('the signature is not over a statement', digest)
    signed = Buffer.from(envelope.payload, 'base64')
  } catch (error) {
    return invalid(
      `the signature does not check out: ${error instanceof Error ? error.message : String(error)}`,
      digest,
    )
  }
  let subject: { digest?: { sha256?: string } } | undefined
  let predicateType: unknown
  try {
    const parsed = JSON.parse(signed.toString('utf8')) as {
      subject?: Array<{ digest?: { sha256?: string } }>
      predicateType?: unknown
    }
    subject = parsed.subject?.[0]
    predicateType = parsed.predicateType
  } catch {
    return invalid('the signed statement is not JSON', digest)
  }
  if (predicateType !== PROVENANCE_PREDICATE)
    return invalid('the signature is not a Crombolo bundle signature', digest)
  if (subject?.digest?.sha256 !== hexOf(digest))
    return invalid('the signature is for a different bundle', digest)

  const source = sourceOf(provenance.signature)
  if (!source) return invalid('the certificate names no GitHub repository', digest)
  const claimed = provenance.source
  for (const key of ['repository', 'ref', 'commit'] as const)
    if (claimed?.[key] !== source[key])
      return invalid(
        `${PROVENANCE_FILE} says ${key} ${claimed?.[key] ?? '(none)'}, and the certificate says ${source[key]}`,
        digest,
      )
  return { state: 'signed', digest, source, links: linksFor(source, provenance.signature) }
}

export type SignaturePolicy = 'optional' | 'required'

export interface ProvenancePolicy {
  signatures: SignaturePolicy
  /** `org/*`, `org/repo` or `org/repo@<ref pattern>`; empty takes any source. */
  sources: readonly string[]
}

/** Whether a signed bundle's source matches one entry of `CROMBOLO_BUNDLE_SOURCES`. */
export function sourceAllowed(source: ProvenanceSource, entry: string): boolean {
  const [repoPattern, refPattern] = entry.split('@') as [string, string | undefined]
  if (!new Bun.Glob(repoPattern.toLowerCase()).match(source.repository.toLowerCase())) return false
  return refPattern === undefined || new Bun.Glob(refPattern).match(refName(source.ref))
}

/**
 * Why the site will not take this bundle, or undefined when it will. An
 * invalid signature is refused whatever the policy; `local` is the site's own.
 */
export function provenanceProblem(
  result: ProvenanceResult,
  policy: ProvenancePolicy,
): string | undefined {
  if (result.state === 'invalid')
    return `its signature was not accepted: ${result.reason ?? 'it does not check out'}`
  if (result.state === 'local') return undefined
  if (result.state === 'unsigned')
    return policy.signatures === 'required'
      ? 'this site takes only signed bundles (CROMBOLO_BUNDLE_SIGNATURES=required); the producer signs it with `crombolo bundle sign` in GitHub Actions'
      : undefined
  const source = result.source as ProvenanceSource
  if (policy.sources.length > 0 && !policy.sources.some((entry) => sourceAllowed(source, entry)))
    return `it was built from github.com/${source.repository} at ${refName(source.ref)}, and this site takes signed bundles only from ${policy.sources.join(', ')} (CROMBOLO_BUNDLE_SOURCES)`
  return undefined
}

/** A `.tgz` unpacked into a temporary directory for `work`, which is removed afterwards. */
async function withUnpacked<T>(file: string, work: (dir: string) => Promise<T>): Promise<T> {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { extractTarball } = await import('./tar.ts')
  const dir = await mkdtemp(join(tmpdir(), 'crombolo-provenance-'))
  try {
    await extractTarball(file, dir)
    return await work(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export const isTarball = (path: string): boolean => /\.(tgz|tar\.gz)$/i.test(path)

/** The digest of a package directory or `.tgz`. */
export async function digestOf(path: string): Promise<string> {
  return isTarball(path)
    ? withUnpacked(path, async (dir) => packageDigest(dir))
    : packageDigest(path)
}

/** Checks a package directory or `.tgz`. */
export async function verifyPackage(
  path: string,
  options: VerifyProvenanceOptions = {},
): Promise<ProvenanceResult> {
  return isTarball(path)
    ? withUnpacked(path, (dir) => verifyProvenance(dir, options))
    : verifyProvenance(path, options)
}

/** Signs a package directory, or a `.tgz` in place with `provenance.json` added to it. */
export async function signPath(path: string, options: SignOptions = {}): Promise<ProvenanceFile> {
  if (!isTarball(path)) return signPackage(path, options)
  const { writeNpmTarball } = await import('./tar.ts')
  return withUnpacked(path, async (dir) => {
    const signed = await signPackage(dir, options)
    const entries = [...packageFiles(dir), PROVENANCE_FILE].map((file) => ({
      path: file,
      bytes: new Uint8Array(readFileSync(join(dir, file))),
    }))
    writeFileSync(path, writeNpmTarball(entries))
    return signed
  })
}
