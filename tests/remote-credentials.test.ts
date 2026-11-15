/**
 * Story 352: where a person's sign-ins are kept — the keychain, or on a
 * machine with none `~/.crombolo/credentials`, readable only by its owner.
 * Every keychain and file here is the test's own: the real ones are never
 * touched.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  fileKeychain,
  type Keychain,
  memoryKeychain,
  type RemoteSignIn,
  readSignIn,
  saveSignIn,
  userKeychain,
} from '@crombolo/server'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const credentials = () => {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const dir = mkdtempSync(join(process.cwd(), 'output', 'credentials-'))
  dirs.push(dir)
  return join(dir, '.crombolo', 'credentials')
}

const SIGN_IN: RemoteSignIn = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 1_900_000_000_000,
  tokenUrl: 'https://live.example/token',
  clientId: 'crombolo-cli',
  user: 'sam@example.com',
}

/** A keychain that cannot be reached, as on a container or a CI runner. */
const unreachable = (): Keychain => {
  const fail = async (): Promise<never> => {
    throw new Error('no secret service')
  }
  return { get: fail, set: fail, delete: fail }
}

describe('the credentials file', () => {
  test('is JSON by origin, which only its owner can read', async () => {
    const file = credentials()
    const keychain = fileKeychain(file)
    await saveSignIn(keychain, 'https://live.example/umbraco/remote/v1', SIGN_IN)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'https://live.example': SIGN_IN })
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600)
      expect(statSync(join(file, '..')).mode & 0o777).toBe(0o700)
    }
    expect(await readSignIn(keychain, 'https://live.example')).toEqual(SIGN_IN)
    await keychain.delete('https://live.example')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({})
  })
})

describe('where a sign-in goes', () => {
  // The test preload chooses the file for every run; these are about choosing for itself.
  let chosen: string | undefined
  beforeEach(() => {
    chosen = Bun.env.CROMBOLO_CREDENTIALS
    delete Bun.env.CROMBOLO_CREDENTIALS
  })
  afterEach(() => {
    if (chosen !== undefined) Bun.env.CROMBOLO_CREDENTIALS = chosen
  })

  test('the keychain when it can be reached, the file when it cannot', async () => {
    const file = credentials()
    const os = memoryKeychain()
    const reached = userKeychain({ os, file })
    expect(await reached.keptIn()).toBe('keychain')
    await saveSignIn(reached, 'https://live.example', SIGN_IN)
    expect(await readSignIn(os, 'https://live.example')).toEqual(SIGN_IN)
    expect(existsSync(file)).toBe(false)
    expect(await reached.find('https://live.example')).toBe('keychain')

    const none = userKeychain({ os: unreachable(), file })
    expect(await none.keptIn()).toBe('file')
    await saveSignIn(none, 'https://staging.example', SIGN_IN)
    expect(await readSignIn(fileKeychain(file), 'https://staging.example')).toEqual(SIGN_IN)
    expect(await none.find('https://staging.example')).toBe('file')
    expect(await none.find('https://live.example')).toBeUndefined()
    // Kept in the file while there was no keychain, and still found once there is one.
    expect(await readSignIn(userKeychain({ os, file }), 'https://staging.example')).toEqual(SIGN_IN)
  })

  test('CROMBOLO_CREDENTIALS chooses one, and anything else is refused', async () => {
    const file = credentials()
    const os = memoryKeychain()
    const toFile = userKeychain({ os, file, choice: 'file' })
    expect(await toFile.keptIn()).toBe('file')
    await saveSignIn(toFile, 'https://live.example', SIGN_IN)
    expect(await readSignIn(os, 'https://live.example')).toBeUndefined()
    expect(await readSignIn(fileKeychain(file), 'https://live.example')).toEqual(SIGN_IN)

    const toKeychain = userKeychain({ os: unreachable(), file, choice: 'keychain' })
    expect(await toKeychain.keptIn()).toBe('keychain')
    await expect(saveSignIn(toKeychain, 'https://live.example', SIGN_IN)).rejects.toThrow(
      'no secret service',
    )
    expect(() => userKeychain({ os, file, choice: 'disk' })).toThrow('keychain or file')
  })

  test('signing out forgets it wherever it was kept', async () => {
    const file = credentials()
    const os = memoryKeychain()
    await saveSignIn(fileKeychain(file), 'https://live.example', SIGN_IN)
    await saveSignIn(os, 'https://live.example', SIGN_IN)
    const keychain = userKeychain({ os, file })
    await keychain.delete('https://live.example')
    expect(await keychain.find('https://live.example')).toBeUndefined()
  })
})
