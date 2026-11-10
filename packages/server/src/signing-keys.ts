/**
 * Keys that sign site bundles (story 316): a person's own, made on their
 * machine, and each site's, kept sealed in its database. Ed25519. A public key
 * is one line to copy, `crombolo-ed25519 <base64> <name>`, and is known by its
 * fingerprint, `SHA256:…`, as GitHub shows SSH keys. What a key signs is a
 * package's digest (story 060), with its name and version.
 * docs/bundles.md, "Signing a bundle".
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const KEY_TYPE = 'crombolo-ed25519'
/** The DER prefix that makes a raw Ed25519 public key an SPKI one. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/** A public key as a site reads it. */
export interface PublicKey {
  /** The 32 bytes, base64. */
  key: string
  /** What its owner called it: the line's last part. */
  comment: string
  /** `SHA256:` and the key's digest, base64 without padding. */
  fingerprint: string
  /** The line, as it is copied: `crombolo-ed25519 <key> <comment>`. */
  line: string
}

/** A key pair: the public line, and the private half as PKCS#8 PEM. */
export interface KeyPair {
  publicKey: PublicKey
  privateKey: string
}

export function fingerprintOf(raw: Uint8Array): string {
  const digest = new Bun.CryptoHasher('sha256').update(raw).digest('base64')
  return `SHA256:${digest.replace(/=+$/, '')}`
}

const lineOf = (key: string, comment: string) => `${KEY_TYPE} ${key}${comment ? ` ${comment}` : ''}`

/** A public key line read, or why it is not one. Pure. */
export function readPublicKey(text: string): PublicKey | { problem: string } {
  const [type, key, ...rest] = text.trim().split(/\s+/)
  if (type !== KEY_TYPE || !key)
    return { problem: `A key starts ${KEY_TYPE}, then the key itself: paste the whole line.` }
  const raw = Buffer.from(key, 'base64')
  if (raw.length !== 32 || raw.toString('base64') !== key)
    return { problem: 'That is not a whole key: copy the line again.' }
  const comment = rest.join(' ')
  return { key, comment, fingerprint: fingerprintOf(raw), line: lineOf(key, comment) }
}

/** A new key pair, named `comment`. */
export function createKeyPair(comment: string): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(SPKI_PREFIX.length)
  const key = raw.toString('base64')
  return {
    publicKey: {
      key,
      comment,
      fingerprint: fingerprintOf(raw),
      line: lineOf(key, comment),
    },
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  }
}

/** What a key signs: the digest, the package's name and version, as one stable string. */
export function signedStatement(input: { digest: string; name: string; version: string }): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: 'https://crombolo.dev/bundle-key-signature/v1',
      digest: input.digest,
      name: input.name,
      version: input.version,
    }),
  )
}

export function signWith(privateKey: string, statement: Buffer): string {
  return signBytes(null, statement, createPrivateKey(privateKey)).toString('base64')
}

export function verifiedBy(publicKey: PublicKey, statement: Buffer, signature: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey.key, 'base64')]),
      format: 'der',
      type: 'spki',
    })
    return verifyBytes(null, statement, key, Buffer.from(signature, 'base64'))
  } catch {
    return false
  }
}

/** Where a person's own keys are kept: their config directory, never the site's. */
export function userKeysDir(): string {
  return join(Bun.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'crombolo', 'keys')
}

const KEY_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Writes a new user key, readable by its owner alone. */
export function createUserKey(name: string, comment = name, dir = userKeysDir()): KeyPair {
  if (!KEY_NAME.test(name))
    throw new Error('A key is named with lowercase letters, digits, dots, hyphens and underscores.')
  const file = join(dir, `${name}.json`)
  if (existsSync(file)) throw new Error(`There is already a key called ${name}.`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const pair = createKeyPair(comment)
  writeFileSync(
    file,
    `${JSON.stringify({ publicKey: pair.publicKey.line, privateKey: pair.privateKey }, null, 2)}\n`,
    {
      mode: 0o600,
    },
  )
  chmodSync(file, 0o600)
  return pair
}

/** A user key by its name, or a path to its file. */
export function readUserKey(nameOrPath: string, dir = userKeysDir()): KeyPair {
  const file = existsSync(nameOrPath) ? nameOrPath : join(dir, `${nameOrPath}.json`)
  if (!existsSync(file))
    throw new Error(`There is no key called ${nameOrPath}: make one with \`crombolo keys create\`.`)
  const stored = JSON.parse(readFileSync(file, 'utf8')) as { publicKey: string; privateKey: string }
  const publicKey = readPublicKey(stored.publicKey)
  if ('problem' in publicKey) throw new Error(`${file} does not hold a key: ${publicKey.problem}`)
  return { publicKey, privateKey: stored.privateKey }
}

/** The user keys on this machine, by name. */
export function listUserKeys(dir = userKeysDir()): { name: string; publicKey: PublicKey }[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) => {
      try {
        return [{ name: file.slice(0, -5), publicKey: readUserKey(join(dir, file)).publicKey }]
      } catch {
        return []
      }
    })
}
