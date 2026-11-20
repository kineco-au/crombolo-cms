/**
 * Story 352: `~/.crombolo/profiles` in place of a site's remotes.toml — the
 * file read strictly and changed a table at a time, the order a command
 * chooses its site in, and the default never moving a command that can act
 * here. Every profiles file here is the test's own, by CROMBOLO_PROFILES_FILE.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import {
  chooseSite,
  hostedOrHere,
  hostedSite,
  refuseNamed,
} from '../packages/cli/src/profiles/choose.ts'
import {
  addProfile,
  profileNamed,
  readProfiles,
  removeProfile,
} from '../packages/cli/src/profiles/profiles-file.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const temp = (name: string) => {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const dir = mkdtempSync(join(process.cwd(), 'output', `${name}-`))
  dirs.push(dir)
  return dir
}

/** A folder holding a site, as far as a profile can tell. */
function siteFolder(name: string): string {
  const dir = temp(name)
  writeFileSync(join(dir, 'crombolo.config.ts'), 'export default {}\n')
  return realpathSync(dir)
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

function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawnSync(['bun', BIN, ...args], {
    cwd,
    stdin: 'ignore',
    env: {
      ...process.env,
      ...Object.fromEntries(Object.keys(NOTHING_SET).map((name) => [name, ''])),
      NO_COLOR: '1',
      CROMBOLO_PROFILES_FILE: join(cwd, 'profiles'),
      CROMBOLO_LOG_TO_CONSOLE: 'false',
      ...env,
    },
  })
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() }
}

describe('the profiles file', () => {
  test('reads hosted sites and site folders, a leading ~ the home folder', () => {
    const file = join(temp('profiles'), 'profiles')
    writeFileSync(
      file,
      '[default]\nurl = "https://riverside.example"\nenvironment = "production"\n\n[copy]\npath = "~/dev/copy"\n',
    )
    expect(readProfiles(file)).toEqual([
      { name: 'default', url: 'https://riverside.example', environment: 'production' },
      { name: 'copy', path: '~/dev/copy' },
    ])
    expect(
      withEnv(NOTHING_SET, () => chooseSite({ profile: 'copy' }, { mayDefault: false, file })),
    ).toEqual({ kind: 'folder', name: 'copy', path: join(homedir(), 'dev', 'copy') })
  })

  test('a file written wrongly is refused, naming the profile and its line', () => {
    const file = join(temp('profiles'), 'profiles')
    const refusal = (text: string) => {
      writeFileSync(file, text)
      try {
        readProfiles(file)
      } catch (error) {
        return (error as Error).message
      }
      return 'read'
    }
    expect(
      refusal('[a]\nurl = "https://a.example"\n\n[b]\nurl = "https://b.example"\nenv = "x"\n'),
    ).toContain('line 4: profile "b" has env, which is not one of url, environment and path')
    expect(refusal('[Live]\nurl = "https://a.example"\n')).toContain('profile "Live" is not a name')
    expect(refusal('[a]\nurl = "https://a.example"\n[b]\nurl = \n')).toContain(
      'line 4: this is not TOML',
    )
    expect(refusal('[a]\nurl = "https://a.example"\npath = "/srv/a"\n')).toContain(
      'needs exactly one of url',
    )
    expect(refusal('[a]\npath = "dev/a"\n')).toContain('which is relative')
    expect(refusal('[a]\npath = "/srv/a"\nenvironment = "x"\n')).toContain('only a url takes')
  })

  test('add, replace and remove change only that profile, comments and all', () => {
    const file = join(temp('profiles'), 'nested', 'profiles')
    addProfile({ name: 'live', url: 'https://live.example' }, file)
    expect(readFileSync(file, 'utf8')).toContain('[live]\nurl = "https://live.example"\n')
    const mine = `${readFileSync(file, 'utf8')}
# the copy on my laptop
[copy]
path = "/srv/copy" # moved here in May

# staging, which Sam looks after
[staging]
url = "https://staging.example"
`
    writeFileSync(file, mine)
    addProfile({ name: 'live', url: 'https://live.example', environment: 'production' }, file)
    expect(readFileSync(file, 'utf8')).toBe(
      mine.replace(
        'url = "https://live.example"\n',
        'url = "https://live.example"\nenvironment = "production"\n',
      ),
    )
    addProfile({ name: 'other', path: '/srv/other' }, file)
    expect(readFileSync(file, 'utf8')).toEndWith(
      '# staging, which Sam looks after\n[staging]\nurl = "https://staging.example"\n\n[other]\npath = "/srv/other"\n',
    )
    expect(removeProfile('copy', file)).toBe(true)
    const left = readFileSync(file, 'utf8')
    expect(left).not.toContain('copy')
    expect(left).toContain('# staging, which Sam looks after\n[staging]')
    expect(removeProfile('copy', file)).toBe(false)
    expect(readProfiles(file).map((p) => p.name)).toEqual(['live', 'staging', 'other'])
    expect(() => addProfile({ name: 'Not OK', url: 'https://x.example' }, file)).toThrow(
      'not a profile name',
    )
  })

  test('a profile that is not there is refused, naming those that are', () => {
    const file = join(temp('profiles'), 'profiles')
    addProfile({ name: 'live', url: 'https://live.example' }, file)
    addProfile({ name: 'staging', url: 'https://staging.example' }, file)
    expect(() => profileNamed('prod', file)).toThrow('There is no profile "prod"')
    try {
      profileNamed('prod', file)
    } catch (error) {
      expect((error as { hint?: string }).hint).toBe('The profiles are: live, staging.')
    }
  })
})

describe('choosing the site', () => {
  const setUp = () => {
    const file = join(temp('profiles'), 'profiles')
    addProfile({ name: 'default', url: 'https://live.example', environment: 'production' }, file)
    addProfile({ name: 'staging', url: 'https://staging.example' }, file)
    addProfile({ name: 'other', url: 'https://other.example' }, file)
    return file
  }

  test('--profile, then CROMBOLO_PROFILE, then CROMBOLO_PROFILE_URL, then the default', () => {
    const file = setUp()
    const chosen = (flags: { profile?: string; env?: string }, vars: Record<string, string>) =>
      withEnv({ ...NOTHING_SET, ...vars }, () => chooseSite(flags, { mayDefault: true, file }))
    const all = {
      CROMBOLO_PROFILE: 'other',
      CROMBOLO_PROFILE_URL: 'https://ci.example',
      CROMBOLO_PROFILE_ENVIRONMENT: 'qa',
    }
    expect(chosen({ profile: 'staging' }, all)).toMatchObject({ name: 'staging', profile: true })
    expect(chosen({}, all)).toMatchObject({ name: 'other' })
    expect(
      chosen(
        {},
        { CROMBOLO_PROFILE_URL: all.CROMBOLO_PROFILE_URL, CROMBOLO_PROFILE_ENVIRONMENT: 'qa' },
      ),
    ).toEqual({
      kind: 'hosted',
      name: 'ci.example',
      url: 'https://ci.example',
      environment: 'qa',
      profile: false,
    })
    expect(chosen({}, {})).toMatchObject({ name: 'default', environment: 'production' })
    // --env goes in place of a profile's own environment.
    expect(chosen({ env: 'staging' }, {})).toMatchObject({
      name: 'default',
      environment: 'staging',
    })
  })

  test('the default never moves a command that can act here', () => {
    const file = setUp()
    withEnv(NOTHING_SET, () => {
      expect(chooseSite({}, { mayDefault: false, file })).toBeUndefined()
      const before = process.cwd()
      expect(withEnv({ CROMBOLO_PROFILES_FILE: file }, () => hostedOrHere({}))).toBeUndefined()
      expect(process.cwd()).toBe(before)
    })
    // What does move it is named.
    expect(
      withEnv({ ...NOTHING_SET, CROMBOLO_PROFILE: 'staging' }, () =>
        chooseSite({}, { mayDefault: false, file }),
      ),
    ).toMatchObject({ name: 'staging' })
  })

  test('with nothing chosen and no default, a hosted-only command is refused, naming the profiles', () => {
    const file = join(temp('profiles'), 'profiles')
    addProfile({ name: 'staging', url: 'https://staging.example' }, file)
    const site = withEnv(NOTHING_SET, () => chooseSite({}, { mayDefault: true, file }))
    expect(site).toBeUndefined()
    try {
      hostedSite(site, { file })
      throw new Error('not refused')
    } catch (error) {
      expect((error as Error).message).toBe('Which site?')
      expect((error as { hint?: string }).hint).toContain('--profile: staging')
      expect((error as { hint?: string }).hint).toContain('profile add default')
    }
  })

  test('a folder profile moves a command into its site; a hosted-only command refuses one', () => {
    const file = join(temp('profiles'), 'profiles')
    const folder = siteFolder('copy')
    addProfile({ name: 'copy', path: folder }, file)
    addProfile({ name: 'empty', path: temp('empty') }, file)
    const before = process.cwd()
    try {
      withEnv({ ...NOTHING_SET, CROMBOLO_PROFILES_FILE: file }, () => {
        expect(hostedOrHere({ profile: 'copy' })).toBeUndefined()
        expect(realpathSync(process.cwd())).toBe(folder)
        expect(() => hostedOrHere({ profile: 'empty' })).toThrow('holds no site')
        expect(() => hostedOrHere({ profile: 'copy', env: 'live' })).toThrow(
          '--env is for a hosted site',
        )
      })
    } finally {
      process.chdir(before)
    }
    expect(() =>
      hostedSite(
        withEnv(NOTHING_SET, () => chooseSite({ profile: 'copy' }, { mayDefault: true, file })),
      ),
    ).toThrow('copy is a site folder, and this needs a hosted site.')
  })

  test('--remote, and a name where --profile is asked for, are refused with the flag to use', () => {
    expect(() => chooseSite({ remote: 'live' }, { mayDefault: true })).toThrow('`--profile live`')
    expect(() => refuseNamed('live', '--to')).toThrow('`--to live`')
  })
})

describe('the commands', () => {
  test('profile import copies remotes.toml, refusing a clash unless --replace', () => {
    const dir = temp('import')
    writeFileSync(
      join(dir, 'remotes.toml'),
      '[remotes.production]\nurl = "https://live.example"\nenvironment = "production"\n\n[remotes.staging]\nurl = "https://staging.example"\n',
    )
    writeFileSync(join(dir, 'profiles'), '# mine\n[staging]\nurl = "https://elsewhere.example"\n')
    const refused = run(dir, ['profile', 'import', '-o', 'json'])
    expect(refused.code).toBe(ERROR_KINDS.conflict.exitCode)
    expect(refused.err).toContain('already have staging')
    expect(readProfiles(join(dir, 'profiles')).map((p) => p.name)).toEqual(['staging'])

    const replaced = run(dir, ['profile', 'import', '--replace', '-o', 'json'])
    expect(replaced.code).toBe(0)
    expect(JSON.parse(replaced.out).items.map((i: { action: string }) => i.action)).toEqual([
      'added',
      'replaced',
    ])
    expect(readProfiles(join(dir, 'profiles'))).toEqual([
      { name: 'staging', url: 'https://staging.example' },
      { name: 'production', url: 'https://live.example', environment: 'production' },
    ])
    expect(readFileSync(join(dir, 'profiles'), 'utf8')).toStartWith('# mine\n')
    const again = run(dir, ['profile', 'import', '-o', 'json'])
    expect(JSON.parse(again.out).items.map((i: { action: string }) => i.action)).toEqual([
      'exists',
      'exists',
    ])
  })

  test('a folder with a remotes.toml says once how to move it', () => {
    const dir = temp('warned')
    writeFileSync(join(dir, 'remotes.toml'), '[remotes.live]\nurl = "https://live.example"\n')
    const result = run(dir, ['remote', 'trust', 'list'])
    expect(result.err.match(/crombolo profile import/g)).toHaveLength(1)
    expect(result.code).toBe(ERROR_KINDS.usage.exitCode)
  })

  test('--remote and a site named as an argument are refused, saying what to use', () => {
    const dir = temp('gone')
    for (const [args, hint] of [
      [['site', 'runs', '--remote', 'live'], '--profile live'],
      [['whoami', 'live'], '--profile live'],
      [['push', 'live'], '--to live'],
      [['pull', 'live'], '--from live'],
      [['remote', 'add', 'live', 'https://live.example'], 'crombolo profile add'],
    ] as const) {
      const result = run(dir, [...args])
      expect(result.code, args.join(' ')).toBe(ERROR_KINDS.usage.exitCode)
      expect(result.err).toContain(hint)
    }
  }, 10_000)

  test('a hosted-only command refuses a folder profile; login with none means this folder', () => {
    const dir = temp('hosted-only')
    addProfile({ name: 'copy', path: siteFolder('copy-site') }, join(dir, 'profiles'))
    const refused = run(dir, ['remote', 'trust', 'list', '--profile', 'copy'])
    expect(refused.code).toBe(ERROR_KINDS.usage.exitCode)
    expect(refused.err).toContain('copy is a site folder, and this needs a hosted site.')
    const login = run(dir, ['login'])
    expect(login.code).toBe(ERROR_KINDS.usage.exitCode)
    expect(login.err).toContain('There is no site in this folder to sign in to.')
    expect(login.err).toContain('crombolo login --profile <name>')
  })

  test('profile add checks a folder holds a site, and profile list shows it', () => {
    const dir = temp('add')
    expect(run(dir, ['profile', 'add', 'nothing', '--path', temp('nothing')]).code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )
    const folder = siteFolder('a-site')
    expect(run(dir, ['profile', 'add', 'copy', '--path', folder]).code).toBe(0)
    expect(run(dir, ['profile', 'add', 'copy', 'https://x.example', '--path', folder]).code).toBe(
      ERROR_KINDS.usage.exitCode,
    )
    const listed = JSON.parse(run(dir, ['profile', 'list', '-o', 'json']).out)
    expect(listed.items).toEqual([
      { name: 'copy', url: null, path: folder, environment: null, signedIn: null, keptIn: null },
    ])
  }, 10_000)
})
