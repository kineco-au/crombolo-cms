/**
 * Story 350: what each command needs to run, and the gate that checks it
 * before the command opens anything — at `open` and at `sign-in`, for one
 * command of each group, as an administrator and as someone without the
 * section a command's screen is in.
 */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Principal } from '@crombolo/api-management/domain'
import { SECTION_ALIASES } from '@crombolo/core'
import { readWritesPaused } from '@crombolo/data'
import { bootstrapDatabase } from '@crombolo/server'
import { BaseCommand } from '../packages/cli/src/base.ts'
import { CliError, ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { loadCli } from '../packages/cli/src/load.ts'
import { actAs, commandActor } from '../packages/cli/src/support/acting.ts'
import { gate } from '../packages/cli/src/support/gate.ts'
import { ROOT } from '../scripts/packages.ts'
import { ADMIN, bootServer, signInAsGroup } from './support/harness.ts'
import {
  cli,
  keepSignIn,
  type LocalSite,
  localSite,
  serveSite,
  sessionFor,
  withSiteDb,
} from './support/local-site.ts'

/** Every command that needs no sign-in, whatever the site says: widening it is a decision. */
const NONE = [
  'admin:reset-password',
  'assets:list',
  'assets:new',
  'bundle:digest',
  'bundle:sign',
  'bundle:verify',
  'components:check',
  'components:gaps',
  'components:list',
  'components:new',
  'extension:build',
  'extension:check',
  'extension:migrate',
  'generate',
  'init',
  'keys:create',
  'keys:list',
  'login',
  'logout',
  'profile:add',
  'profile:import',
  'profile:list',
  'profile:remove',
  'restart',
  'schema',
  'site:build',
  'site:check',
  'site:check-code',
  'start',
  'types:rewrite',
  'upgrade',
  'upgrade:check',
  'upgrade:ledger',
  'whoami',
]

const sites: LocalSite[] = []
afterEach(() => {
  while (sites.length > 0) rmSync(sites.pop()?.dir as string, { recursive: true, force: true })
})
const site = (name = 'cli-access') => {
  const made = localSite(name)
  sites.push(made)
  return made
}

describe('what each command declares', () => {
  let commands: Array<{ id: string; hidden: boolean; declared: typeof BaseCommand }>
  beforeAll(async () => {
    const { config } = await loadCli()
    const aliases = new Set(config.commands.flatMap((c) => c.aliases))
    commands = await Promise.all(
      config.commands
        .filter((c) => !aliases.has(c.id))
        .map(async (c) => ({
          id: c.id,
          hidden: c.hidden,
          declared: (await c.load()) as unknown as typeof BaseCommand,
        })),
    )
  })

  test('every command, and a plugin built from @crombolo/cli/plugin, says what it needs', async () => {
    const fixture = (
      await import(join(ROOT, 'tests/fixtures/cloud-plugin/src/commands/cloud/hello.ts'))
    ).default as typeof BaseCommand
    const undeclared = [...commands, { id: 'cloud:hello', hidden: false, declared: fixture }]
      .filter((c) => !['none', 'site', 'person'].includes(c.declared.access as string))
      .map((c) => c.id)
    expect(undeclared).toEqual([])
  })

  test('the commands that need no sign-in are these, and only these', () => {
    const none = commands.filter((c) => c.declared.access === 'none' && !c.hidden)
    expect(none.map((c) => c.id).sort()).toEqual(NONE)
  })

  test('a section is one the back office has, and only a command that needs a sign-in names one', () => {
    for (const { id, declared } of commands) {
      const sections = declared.section === undefined ? [] : [declared.section].flat()
      for (const section of sections) expect(Object.keys(SECTION_ALIASES), id).toContain(section)
      if (declared.access === 'none') {
        expect(sections, id).toEqual([])
        expect(declared.adminOnly ?? false, id).toBe(false)
      }
    }
  })

  test("story 356: the users commands' access, and the group changes for administrators", () => {
    const declared = (id: string) => {
      const found = commands.find((c) => c.id === id)?.declared
      if (!found) throw new Error(`no command ${id}`)
      return {
        access: found.access,
        section: found.section ?? null,
        adminOnly: found.adminOnly ?? false,
      }
    }
    for (const id of ['users:update', 'users:remove'])
      expect(declared(id), id).toEqual({ access: 'site', section: 'users', adminOnly: false })
    // Your own sign-ins are in your profile, so these need no section.
    for (const id of ['users:sessions', 'users:sessions:end'])
      expect(declared(id), id).toEqual({ access: 'site', section: null, adminOnly: false })
    for (const id of ['users:groups:new', 'users:groups:update', 'users:groups:remove'])
      expect(declared(id), id).toEqual({ access: 'site', section: 'users', adminOnly: true })
    // Story 359: background jobs are the Settings section's, as their dashboard is.
    for (const id of ['jobs:list', 'jobs:show', 'jobs:retry'])
      expect(declared(id), id).toEqual({ access: 'site', section: 'settings', adminOnly: false })
    // Story 360: search and sharing settings, as Settings → Search & sharing has them.
    for (const id of ['seo:show', 'seo:set', 'seo:unset'])
      expect(declared(id), id).toEqual({ access: 'site', section: 'settings', adminOnly: false })
  })
})

describe('the gate', () => {
  test('at open, a command runs as the command line with nobody signed in', () => {
    const here = site()
    const run = cli(here, ['users', 'list', '-o', 'json'])
    expect(run.code, run.err).toBe(0)
  })

  test('at sign-in, a site command with nobody signed in is refused, and nothing is opened', () => {
    const here = site()
    const run = cli(here, ['maintenance', 'pause', '--reason', 'no'], {
      CROMBOLO_CLI_ACCESS: 'sign-in',
    })
    expect(run.code).toBe(ERROR_KINDS.auth.exitCode)
    expect(run.err).toContain('needs you signed in')
    expect(run.err).toContain('crombolo login')
    expect(existsSync(here.config.sqliteFile)).toBe(false)
  })

  test('at sign-in, a command that needs none runs', () => {
    const here = site()
    const run = cli(here, ['components', 'list', '-o', 'json'], {
      CROMBOLO_CLI_ACCESS: 'sign-in',
    })
    expect(run.code, run.err).toBe(0)
  })

  test('at sign-in, an administrator signed in runs a command, which changes the site', async () => {
    const here = site()
    await (await bootstrapDatabase(here.config)).db.close()
    await keepSignIn(here, await sessionFor(here, ADMIN.username))
    const run = cli(here, ['maintenance', 'pause', '--reason', 'moving'], {
      CROMBOLO_CLI_ACCESS: 'sign-in',
    })
    expect(run.code, run.err).toBe(0)
    expect((await withSiteDb(here, readWritesPaused))?.reason).toBe('moving')
  })

  test('a person is held to the section and the administrators a command is for', async () => {
    const here = site()
    const h = await serveSite(here)
    try {
      await signInAsGroup(h, 'writer', 'writer@example.com')
    } finally {
      await h.db.close()
    }
    await keepSignIn(here, await sessionFor(here, 'writer@example.com'))

    const settings = cli(here, ['maintenance', 'status'])
    expect(settings.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(settings.err).toContain('needs the Settings section')
    const admins = cli(here, ['site', 'import', 'nothing.tgz'])
    expect(admins.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(admins.err).toContain('is for administrators')
    const pages = cli(here, ['content', 'find', '-o', 'json'])
    expect(pages.code, pages.err).toBe(0)
  }, 60_000)

  test('an ended session is refused at open too, and never runs as the command line', async () => {
    const here = site()
    await (await bootstrapDatabase(here.config)).db.close()
    const session = await sessionFor(here, ADMIN.username)
    await keepSignIn(here, session)
    expect(cli(here, ['logout']).code).toBe(0)
    await keepSignIn(here, session)
    const run = cli(here, ['maintenance', 'pause'])
    expect(run.code).toBe(ERROR_KINDS.auth.exitCode)
    expect(run.err).toContain('has ended')
    expect(await withSiteDb(here, readWritesPaused)).toBeUndefined()
  })

  test('a person command needs a sign-in even at open', async () => {
    const here = site()
    class Decide extends BaseCommand {
      static override id = 'approvals:decide'
      static override access = 'person' as const
      static override spec = { effects: 'idempotent' } as const
      async run() {}
    }
    const command = Object.create(Decide.prototype) as BaseCommand
    const previous = process.env.CROMBOLO_CREDENTIALS_FILE
    process.env.CROMBOLO_CREDENTIALS_FILE = here.credentials
    try {
      const refused = await gate(command, [here.dir]).catch((error: unknown) => error)
      expect(refused).toBeInstanceOf(CliError)
      expect((refused as CliError).kind).toBe('auth')
      expect((refused as CliError).message).toContain('acts as a person')
    } finally {
      process.env.CROMBOLO_CREDENTIALS_FILE = previous
    }
  })
})

describe('acting as the person', () => {
  const person = (isAdmin: boolean) =>
    ({ id: crypto.randomUUID(), name: 'Ada', isAdmin }) as unknown as Principal
  afterEach(() => actAs(undefined))

  test('with nobody signed in, the command line; signed in, the person, from the command line', () => {
    expect(commandActor().kind).toBe('operator')
    actAs(person(false))
    const actor = commandActor()
    expect(actor).toMatchObject({ kind: 'user', origin: { source: 'cli' } })
  })

  test('--skip-approval is an administrator’s once someone is signed in', () => {
    expect(commandActor({ skipApproval: true })).toMatchObject({ skipApproval: true })
    actAs(person(false))
    expect(() => commandActor({ skipApproval: true })).toThrow('Only an administrator')
    actAs(person(true))
    expect(commandActor({ skipApproval: true })).toMatchObject({ kind: 'user', skipApproval: true })
  })
})

describe('a production site left open', () => {
  test('says so once when it starts, naming the setting', async () => {
    const logsDir = mkdtempSync(join(process.cwd(), 'output', 'cli-access-logs-'))
    const server = await bootServer({
      config: { development: false, cliAccess: 'open', logsDir, logToConsole: false },
    })
    try {
      const text = readdirSync(logsDir)
        .map((file) => readFileSync(join(logsDir, file), 'utf8'))
        .join('')
      expect(text.split('CROMBOLO_CLI_ACCESS is open')).toHaveLength(2)
    } finally {
      await server.db.close()
      rmSync(logsDir, { recursive: true, force: true })
    }
  }, 60_000)
})
