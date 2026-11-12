/**
 * The key a site bundle built here is signed with (story 316): a person's own,
 * named with `--sign-with`, or this site's, which `crombolo site key` shows.
 */
import {
  bootstrapDatabase,
  type KeyPair,
  type ProvenanceResult,
  readUserKey,
  signerTrusted,
  signPathWithKey,
  siteSigningKey,
} from '@crombolo/server'
import { hasSite, siteConfig } from './site.ts'

/** The user key named, or this site's own; undefined where the site has no secret key to keep one. */
export async function signingKey(signWith: string | undefined): Promise<KeyPair | undefined> {
  if (signWith) return readUserKey(signWith)
  const config = await siteConfig()
  if (!config.secretKey) return undefined
  const { db } = await bootstrapDatabase(config)
  try {
    return await siteSigningKey(db, config)
  } finally {
    await db.close()
  }
}

/**
 * A signature with whether the site this runs in trusts its signer (story 335);
 * as it was outside a site, or for anything but a signature.
 */
export async function withSiteTrust(result: ProvenanceResult): Promise<ProvenanceResult> {
  if (result.state !== 'signed' || !hasSite()) return result
  const config = await siteConfig()
  const { db } = await bootstrapDatabase(config)
  try {
    return { ...result, trusted: await signerTrusted(db, config, result) }
  } finally {
    await db.close()
  }
}

/** Signs a package directory or `.tgz` with that key; says what it did, or that it could not. */
export async function signBuilt(path: string, signWith: string | undefined): Promise<string> {
  const key = await signingKey(signWith)
  if (!key)
    return 'not signed with a key: this site has no CROMBOLO_SECRET_KEY to keep one, and no --sign-with was given'
  await signPathWithKey(path, key)
  return `signed by ${key.publicKey.comment || 'a key'} (${key.publicKey.fingerprint})`
}
