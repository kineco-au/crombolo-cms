/**
 * Which site bundles a site applies (story 316): those signed by a key or a CI
 * source it trusts, this site's own key always among them, and never an older
 * version than it last applied from the same signer. Required in production,
 * flagged in development. docs/bundles.md, "Signing a bundle".
 */
import {
  type Db,
  readKeyValue,
  TransferRunRepository,
  type TrustedSigner,
  TrustedSignerRepository,
  writeKeyValue,
} from '@crombolo/data'
import type { CromboloConfig } from './config.ts'
import {
  keySignatureOver,
  PROVENANCE_FILE,
  type ProvenanceResult,
  refName,
  sourceAllowed,
} from './provenance.ts'
import { openSecret, sealSecret } from './secrets.ts'
import { createKeyPair, type KeyPair, readPublicKey } from './signing-keys.ts'

const SITE_KEY = 'Crombolo.Signing.SiteKey'

/**
 * This site's own key, made the first time it is needed, its private half
 * sealed with the site's secret key; undefined where there is no secret key to
 * seal it with.
 */
export async function siteSigningKey(
  db: Db,
  config: Pick<CromboloConfig, 'secretKey' | 'siteName'>,
): Promise<KeyPair | undefined> {
  if (!config.secretKey) return undefined
  const stored = await readKeyValue(db, SITE_KEY).catch(() => undefined)
  if (stored) {
    const { publicKey, sealed } = JSON.parse(stored) as { publicKey: string; sealed: string }
    const read = readPublicKey(publicKey)
    if ('problem' in read) throw new Error(`This site's signing key is damaged: ${read.problem}`)
    return { publicKey: read, privateKey: openSecret(sealed, config.secretKey) }
  }
  const pair = createKeyPair(config.siteName || 'site')
  await writeKeyValue(
    db,
    SITE_KEY,
    JSON.stringify({
      publicKey: pair.publicKey.line,
      sealed: sealSecret(pair.privateKey, config.secretKey),
    }),
  )
  return pair
}

/** One signer this site trusts, wherever it is listed. */
export interface TrustEntry {
  /** The stored row's id; absent for one the config or this site provides. */
  id?: string
  kind: 'user' | 'site' | 'source'
  name: string
  publicKey?: string
  fingerprint?: string
  source?: string
  /** Set in the config or the environment, or this site's own: not removed in Settings. */
  locked: boolean
  /** This site's own key. */
  own?: boolean
  addedBy?: string | null
  addedAt?: string
  lastSignedAt?: string | null
}

const fromRow = (row: TrustedSigner): TrustEntry => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  ...(row.publicKey ? { publicKey: row.publicKey } : {}),
  ...(row.fingerprint ? { fingerprint: row.fingerprint } : {}),
  ...(row.source ? { source: row.source } : {}),
  locked: false,
  addedBy: row.addedBy,
  addedAt: row.addedAt.toISOString(),
  lastSignedAt: row.lastSignedAt?.toISOString() ?? null,
})

/** Everything this site trusts: its own key first, then the config's, then what was added here. */
export async function trustedSigners(db: Db, config: CromboloConfig): Promise<TrustEntry[]> {
  const own = await siteSigningKey(db, config).catch(() => undefined)
  const entries: TrustEntry[] = []
  if (own)
    entries.push({
      kind: 'site',
      name: `${config.siteName || 'This site'} (this site)`,
      publicKey: own.publicKey.line,
      fingerprint: own.publicKey.fingerprint,
      locked: true,
      own: true,
    })
  for (const key of config.trustedKeys ?? []) {
    const read = readPublicKey(key.publicKey)
    if ('problem' in read) continue
    entries.push({
      kind: key.kind ?? 'user',
      name: key.name,
      publicKey: read.line,
      fingerprint: read.fingerprint,
      locked: true,
    })
  }
  for (const source of [
    ...(config.trustedSources ?? []),
    ...config.bundlePolicy.sources.map((entry) => ({ name: entry, source: entry })),
  ])
    entries.push({ kind: 'source', name: source.name, source: source.source, locked: true })
  const rows = await new TrustedSignerRepository(db).all().catch(() => [])
  entries.push(...rows.map(fromRow))
  return entries
}

/** What a site bundle's check decided: refused, or applied, flagged or not, and who signed it. */
export interface SiteBundleTrust {
  problem?: string
  /** Applied, but a person should know: unsigned or untrusted, in development. */
  warning?: string
  /** Who signed it, as the run records it: a key's fingerprint or a CI source's repository. */
  signedBy?: string
  /** The stored entry that trusted it, to note it signed something. */
  entryId?: string
  /** An older version applied on purpose, with `allowDowngrade`: for the audit log. */
  downgraded?: { from: string; to: string }
}

/**
 * Whether a site bundle may be applied here. A signature that does not check
 * out is refused always; in production, so is one nobody this site trusts
 * signed, and an older version from the same signer without `allowDowngrade`.
 */
export async function siteBundleTrust(
  db: Db,
  config: CromboloConfig,
  result: ProvenanceResult,
  options: { allowDowngrade?: boolean } = {},
): Promise<SiteBundleTrust> {
  if (result.state === 'local') return {}
  if (result.state === 'invalid')
    return {
      problem: `its signature was not accepted: ${result.reason ?? 'it does not check out'}`,
    }
  if (result.state === 'unchecked')
    return {
      problem: `its signature could not be checked right now (${result.reason ?? 'try again'}); try again`,
    }
  // Required in production, and wherever the site asks for signatures (story 060).
  const production = !config.development || config.bundlePolicy.signatures === 'required'
  const refuse = (problem: string): SiteBundleTrust =>
    production ? { problem } : { warning: `${problem}. It is applied, as this is not production` }
  if (result.state === 'unsigned')
    return refuse(
      'it is not signed, and this site applies only site bundles signed by a key or a build it trusts (Settings → Trusted signers)',
    )
  const entries = await trustedSigners(db, config)
  const byKey = result.key
    ? entries.find((entry) => entry.fingerprint === result.key?.fingerprint)
    : undefined
  const bySource = result.source
    ? entries.find(
        (entry) =>
          entry.kind === 'source' &&
          entry.source &&
          sourceAllowed(result.source as NonNullable<ProvenanceResult['source']>, entry.source),
      )
    : undefined
  const trusted = byKey ?? bySource
  const signedBy = byKey
    ? (result.key?.fingerprint as string)
    : bySource
      ? (result.source?.repository as string)
      : (result.key?.fingerprint ?? result.source?.repository)
  if (!trusted) {
    const who = result.key
      ? `the key ${result.key.comment || ''} (${result.key.fingerprint})`.replace('  ', ' ')
      : `a build of github.com/${result.source?.repository} at ${refName(result.source?.ref ?? '')}`
    return {
      ...refuse(`it is signed by ${who}, which this site does not trust`),
      ...(signedBy ? { signedBy } : {}),
    }
  }
  const pkg = result.package
  const downgrade = pkg && signedBy ? await downgradeCheck(db, signedBy, pkg, options) : {}
  if (downgrade.problem) return { problem: downgrade.problem, signedBy }
  return {
    signedBy,
    ...(trusted.id ? { entryId: trusted.id } : {}),
    ...(downgrade.downgraded ? { downgraded: downgrade.downgraded } : {}),
  }
}

/** An older version from the same signer is an old bundle put back. */
async function downgradeCheck(
  db: Db,
  signedBy: string,
  pkg: { name: string; version: string },
  options: { allowDowngrade?: boolean },
): Promise<Pick<SiteBundleTrust, 'problem' | 'downgraded'>> {
  const applied = await new TransferRunRepository(db)
    .versionsSignedBy(signedBy, pkg.name)
    .catch(() => [] as string[])
  const newer = applied
    .filter((version) => Bun.semver.order(version, pkg.version) > 0)
    .sort(Bun.semver.order)
    .at(-1)
  if (!newer) return {}
  if (!options.allowDowngrade)
    return {
      problem: `it is version ${pkg.version}, older than ${newer}, which this site already applied from the same ${signedBy === HOST_SIGNER ? 'host' : 'signer'}. To roll back on purpose, apply it with --allow-downgrade`,
    }
  return { downgraded: { from: newer, to: pkg.version } }
}

/** What a run vouched for by the host records as its signer (story 319). */
export const HOST_SIGNER = 'host'

/**
 * A bundle the host vouched for (story 319): no signer is asked for, but an
 * older version than one the host already vouched for, by package name, is
 * still refused without `allowDowngrade`.
 */
export async function vouchedTrust(
  db: Db,
  pkg: { name: string; version: string },
  options: { allowDowngrade?: boolean } = {},
): Promise<SiteBundleTrust> {
  const downgrade = await downgradeCheck(db, HOST_SIGNER, pkg, options)
  return downgrade.problem
    ? { problem: downgrade.problem, signedBy: HOST_SIGNER }
    : {
        signedBy: HOST_SIGNER,
        ...(downgrade.downgraded ? { downgraded: downgrade.downgraded } : {}),
      }
}

/**
 * A package's files with this site's key signature added as `provenance.json`
 * (story 316); as they were where the site has no key.
 */
export async function signedWithSiteKey(
  db: Db,
  config: Pick<CromboloConfig, 'secretKey' | 'siteName'>,
  files: readonly { path: string; bytes?: Uint8Array; text?: string }[],
): Promise<{ path: string; bytes?: Uint8Array; text?: string }[]> {
  const key = await siteSigningKey(db, config)
  if (!key) return [...files]
  const encoder = new TextEncoder()
  const signed = keySignatureOver(
    files.map((file) => ({
      path: file.path,
      bytes: file.bytes ?? encoder.encode(file.text ?? ''),
    })),
    key,
  )
  return [
    ...files.filter((file) => file.path !== PROVENANCE_FILE),
    { path: PROVENANCE_FILE, text: `${JSON.stringify(signed, null, 2)}\n` },
  ]
}
