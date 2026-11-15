/**
 * A developer's sign-ins to hosted sites (stories 108, 352): kept in the
 * operating system's keychain (macOS Keychain, Windows Credential Manager,
 * libsecret) through `Bun.secrets`, or on a machine with none in
 * `~/.crombolo/credentials`, readable only by its owner. Keyed by the site's
 * origin, never in a site's folder. Shared by the CLI's commands and a
 * lazily-fetching local media store.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from './atomic-write.ts'
import { setting } from './settings.ts'

export const KEYCHAIN_SERVICE = 'crombolo-remote'

const keyOf = (origin: string) => new URL(origin).origin

export interface Keychain {
  get(name: string): Promise<string | null>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
}

/** The operating system's keychain. */
export function osKeychain(): Keychain {
  return {
    get: (name) => Bun.secrets.get({ service: KEYCHAIN_SERVICE, name }),
    set: (name, value) => Bun.secrets.set({ service: KEYCHAIN_SERVICE, name, value }),
    delete: async (name) => {
      await Bun.secrets.delete({ service: KEYCHAIN_SERVICE, name })
    },
  }
}

/** Where sign-ins go on a machine with no keychain: CROMBOLO_CREDENTIALS_FILE, else ~/.crombolo/credentials. */
export const credentialsFile = (): string =>
  setting('CROMBOLO_CREDENTIALS_FILE') || join(homedir(), '.crombolo', 'credentials')

/** Sign-ins in a file only its owner can read: JSON, by origin. */
export function fileKeychain(file: string = credentialsFile()): Keychain {
  const read = (): Record<string, unknown> => {
    if (!existsSync(file)) return {}
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  const write = (values: Record<string, unknown>) => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    writeFileAtomic(file, `${JSON.stringify(values, null, 2)}\n`, 0o600)
  }
  return {
    get: async (name) => {
      const value = read()[name]
      if (value === undefined) return null
      return typeof value === 'string' ? value : JSON.stringify(value)
    },
    set: async (name, value) => {
      let parsed: unknown = value
      try {
        parsed = JSON.parse(value)
      } catch {
        // Kept as it was given.
      }
      write({ ...read(), [name]: parsed })
    },
    delete: async (name) => {
      const values = read()
      if (!(name in values)) return
      delete values[name]
      write(values)
    },
  }
}

export type KeptIn = 'keychain' | 'file'

/** The person's own sign-ins: the keychain, or the credentials file where there is none. */
export interface UserKeychain extends Keychain {
  /** Where a sign-in saved now is kept. */
  keptIn(): Promise<KeptIn>
  /** Where the sign-in for an origin is kept, when there is one. */
  find(origin: string): Promise<KeptIn | undefined>
}

const PROBE = 'crombolo-keychain-check'

/**
 * The keychain when it can be reached, else the credentials file (story 352).
 * CROMBOLO_CREDENTIALS=keychain or file chooses one. A sign-in saved to the
 * file while there was no keychain is still found once there is one.
 */
export function userKeychain(
  options: { os?: Keychain; file?: string; choice?: string } = {},
): UserKeychain {
  const os = options.os ?? osKeychain()
  const file = fileKeychain(options.file)
  const choice = options.choice ?? setting('CROMBOLO_CREDENTIALS')
  if (choice !== undefined && choice !== 'keychain' && choice !== 'file')
    throw new Error(`CROMBOLO_CREDENTIALS is "${choice}": it is keychain or file.`)
  let reachable: Promise<boolean> | undefined
  const osWorks = () =>
    (reachable ??= os.get(PROBE).then(
      () => true,
      () => false,
    ))
  const keptIn = async (): Promise<KeptIn> =>
    choice === 'file' || (choice === undefined && !(await osWorks())) ? 'file' : 'keychain'
  const fromOs = async (name: string) =>
    choice === 'file' || (choice === undefined && !(await osWorks())) ? null : os.get(name)
  return {
    keptIn,
    async find(origin) {
      const name = keyOf(origin)
      if ((await fromOs(name)) !== null) return 'keychain'
      if (choice !== 'keychain' && (await file.get(name)) !== null) return 'file'
      return undefined
    },
    async get(name) {
      const found = await fromOs(name)
      if (found !== null || choice === 'keychain') return found
      return file.get(name)
    },
    async set(name, value) {
      if ((await keptIn()) === 'keychain') await os.set(name, value)
      else await file.set(name, value)
    },
    async delete(name) {
      if (choice !== 'file' && (choice === 'keychain' || (await osWorks()))) await os.delete(name)
      if (choice !== 'keychain') await file.delete(name)
    },
  }
}

/** A keychain in memory, for tests and machines without one. */
export function memoryKeychain(): Keychain {
  const values = new Map<string, string>()
  return {
    get: async (name) => values.get(name) ?? null,
    set: async (name, value) => {
      values.set(name, value)
    },
    delete: async (name) => {
      values.delete(name)
    },
  }
}

export interface RemoteSignIn {
  accessToken: string
  refreshToken: string
  /** Milliseconds since the epoch. */
  expiresAt: number
  tokenUrl: string
  clientId: string
  /** Who approved it, for `whoami`. */
  user?: string
}

export async function readSignIn(
  keychain: Keychain,
  origin: string,
): Promise<RemoteSignIn | undefined> {
  const stored = await keychain.get(keyOf(origin))
  if (!stored) return undefined
  try {
    return JSON.parse(stored) as RemoteSignIn
  } catch {
    return undefined
  }
}

export const saveSignIn = (keychain: Keychain, origin: string, signIn: RemoteSignIn) =>
  keychain.set(keyOf(origin), JSON.stringify(signIn))

export const forgetSignIn = (keychain: Keychain, origin: string) => keychain.delete(keyOf(origin))

/**
 * A usable access token: the stored one, or a refreshed one when it is within a
 * minute of expiring. Undefined when there is no sign-in, or the remote refused
 * the refresh — the person signs in again.
 */
export async function freshAccessToken(
  keychain: Keychain,
  origin: string,
  http: typeof fetch = fetch,
  force = false,
): Promise<string | undefined> {
  const signIn = await readSignIn(keychain, origin)
  if (!signIn) return undefined
  if (!force && signIn.expiresAt - Date.now() > 60_000) return signIn.accessToken
  const response = await http(signIn.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: signIn.refreshToken,
      client_id: signIn.clientId,
    }).toString(),
  })
  if (!response.ok) return undefined
  const tokens = (await response.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  await saveSignIn(keychain, origin, {
    ...signIn,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  })
  return tokens.access_token
}
