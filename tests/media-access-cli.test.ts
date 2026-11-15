/**
 * Story 355: `media access show` and `media access set`, with the rules story
 * 204's Permissions dialog uses. What `show` says matches the dialog's summary;
 * `set` lets anyone, only the back office, or chosen member groups see a folder,
 * and groups change it; `--inherit` and `--no-inherit` follow the folder above or
 * not; a file is then read by a member of the group and refused to a visitor; an
 * unknown group is refused; and what `set` does not name is kept.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_MEMBER_TYPE } from '@crombolo/data'
import { bootstrapDatabase } from '@crombolo/server'
import { summarise } from '../packages/backoffice-host/plugin/media-access-rules.js'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'
import { type TreeSite, treeSite, writeTreeSite } from './support/content-tree.ts'
import { BACKOFFICE, type Harness, V1 } from './support/harness.ts'
import { cli, type LocalSite, localSite, serveSite, withSiteDb } from './support/local-site.ts'
import { type MadeMedia, mediaMaker, writeArticleSchema } from './support/media-commands.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
const DIALOG = `${BACKOFFICE}/crombolo/api/media-access`

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

type Run = { code: number | null; out: string; err: string }
const json = <T>(run: Run): T => {
  expect(run.code, run.err).toBe(0)
  return JSON.parse(run.out) as T
}

interface View {
  key: string
  summary: string
  form: {
    inherit: boolean
    read: string
    write: string
    groups: Array<{ name: string; read: boolean; write: boolean }>
  }
  state: {
    own: { memberTypes: string[]; memberMaxBytes: number | null } | null
    protected: boolean
  }
}

async function member(h: Harness, username: string, groups: string[]) {
  const response = await h.post(`${V1}/member`, {
    memberType: { id: SYSTEM_MEMBER_TYPE.key },
    email: `${username}@example.test`,
    username,
    password: 'correct-horse-battery',
    isApproved: true,
    groups,
    values: [],
    variants: [{ culture: null, segment: null, name: username }],
  })
  if (response.status !== 201) throw new Error(`member ${username}: ${response.status}`)
}

/** A member's site cookie. */
async function memberCookie(h: Harness, username: string): Promise<string> {
  const response = await h.server.fetch(
    new Request('http://localhost/umbraco/members/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'correct-horse-battery' }),
    }),
  )
  expect(response.status).toBe(200)
  return (response.headers.getSetCookie()[0] ?? '').split(';')[0] ?? ''
}

const visit = (h: Harness, path: string, cookie?: string) =>
  h.server.fetch(
    new Request(`http://localhost${path}`, {
      headers: cookie ? { cookie } : {},
      redirect: 'manual',
    }),
  )

describe('in a site folder', () => {
  let here: LocalSite
  let made: { members: string; inner: string; photo: MadeMedia }
  const run = (args: string[]) => cli(here, args)
  const ok = (...args: string[]) => {
    const done = run(args)
    expect(done.code, `${args.join(' ')}: ${done.err}`).toBe(0)
    return done
  }
  const view = (item: string) => json<View>(run(['media', 'access', 'show', item, '-o', 'json']))

  beforeAll(async () => {
    here = localSite('media-access-cli')
    writeArticleSchema(here.config.schemaDir, here.config.componentsDir)
    await (await bootstrapDatabase(here.config)).db.close()
    const h = await serveSite(here)
    try {
      const make = mediaMaker(h)
      const members = await make.folder('Members')
      const inner = await make.folder('Inner', members)
      const photo = await make.image('photo', members)
      for (const name of ['Gold', 'Silver', 'Editors']) await make.group(name)
      await member(h, 'goldie', ['Gold'])
      await member(h, 'silvia', ['Silver'])
      made = { members, inner, photo }
    } finally {
      await h.db.close()
    }
  }, 120_000)
  afterAll(() => rmSync(here.dir, { recursive: true, force: true }))

  test('show: the dialog’s summary for the same item, then its parts', async () => {
    const text = ok('media', 'access', 'show', '/Members').out
    expect(text).toContain('Anyone with the link can see this.')
    expect(text).toContain('who can see it     anyone with the link')
    expect(text).toContain('who can change it  no members')
    const h = await serveSite(here)
    try {
      for (const [path, key] of [
        ['/Members', made.members],
        ['/Members/photo', made.photo.key],
      ] as const) {
        const dialog = await h.json<Parameters<typeof summarise>[0]>(`${DIALOG}/${key}`)
        expect(view(path).summary, path).toBe(summarise(dialog))
      }
    } finally {
      await h.db.close()
    }
  }, 60_000)

  test('set: groups that see and change it, a file then read by a member of one and refused to a visitor', async () => {
    const gold = json<View>(
      run(['media', 'access', 'set', '/Members', '--group', 'Gold', '--read', '-o', 'json']),
    )
    expect(gold.summary).toBe('Only Gold can see this. No members can change it.')
    expect(gold.state.protected).toBe(true)
    const editors = ok('media', 'access', 'set', '/Members', '--group', 'editors', '--change').out
    expect(editors).toContain('Only Editors and Gold can see this. Editors can change it.')
    expect(view('/Members/photo').summary).toBe(
      'Inherited from Members. Only Editors and Gold can see this. Editors can change it.',
    )
    const entries = await withSiteDb(here, (db) =>
      db.query<{ entity_key: string; source: string }>(
        "SELECT entity_key, source FROM audit_entry WHERE action = 'SetPermissions' AND entity_type = 'MediaAccess'",
      ),
    )
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ entity_key: made.members, source: 'cli' })

    const h = await serveSite(here)
    try {
      expect((await visit(h, made.photo.src)).status).not.toBe(200)
      expect((await visit(h, made.photo.src, await memberCookie(h, 'silvia'))).status).not.toBe(200)
      expect((await visit(h, made.photo.src, await memberCookie(h, 'goldie'))).status).toBe(200)
    } finally {
      await h.db.close()
    }

    const none = ok('media', 'access', 'set', '/Members', '--group', 'Gold', '--none').out
    expect(none).toContain('Only Editors can see this.')
  }, 120_000)

  test('set: anyone, the back office only, --no-inherit and --inherit', () => {
    expect(ok('media', 'access', 'set', '/Members', '--back-office-only').out).toContain(
      'Only back-office users can see this.',
    )
    const anyone = json<View>(run(['media', 'access', 'set', '/Members', '--anyone', '-o', 'json']))
    expect(anyone.form.read).toBe('public')
    expect(anyone.summary).toContain('Anyone with the link can see this.')

    expect(view('/Members/Inner').form.inherit).toBe(true)
    const own = json<View>(
      run(['media', 'access', 'set', '/Members/Inner', '--no-inherit', '-o', 'json']),
    )
    expect(own.form.inherit).toBe(false)
    expect(own.state.own).not.toBeNull()
    expect(own.summary).toStartWith('Set for this item.')
    const follows = json<View>(
      run(['media', 'access', 'set', made.inner, '--inherit', '-o', 'json']),
    )
    expect(follows.form.inherit).toBe(true)
    expect(follows.state.own).toBeNull()
    expect(follows.summary).toStartWith('Inherited from Members.')
  })

  test('refused: an unknown group, naming the site’s groups, and changes that do not go together', () => {
    const unknown = run(['media', 'access', 'set', '/Members', '--group', 'Bronze', '--read'])
    expect(unknown.code).toBe(ERROR_KINDS.not_found.exitCode)
    expect(unknown.err).toContain('There is no member group "Bronze".')
    expect(unknown.err).toContain('Editors, Gold and Silver')
    for (const args of [
      ['/Members', '--group', 'Gold'],
      ['/Members', '--read'],
      ['/Members', '--inherit', '--anyone'],
      ['/Members', '--anyone', '--group', 'Gold', '--read'],
      ['/Members'],
    ])
      expect(run(['media', 'access', 'set', ...args]).code, args.join(' ')).toBe(
        ERROR_KINDS.usage.exitCode,
      )
    expect(run(['media', 'access', 'show', '/Nowhere']).code).toBe(ERROR_KINDS.not_found.exitCode)
  })

  test('what set does not name is kept: member uploads and their size', async () => {
    const h = await serveSite(here)
    try {
      const saved = await h.put(`${DIALOG}/${made.members}`, {
        rule: {
          publicRead: false,
          groups: [{ name: 'Gold', read: true, write: false }],
          newRead: null,
          newWrite: null,
          memberTypes: ['png'],
          memberMaxBytes: 2048,
        },
      })
      expect(saved.status).toBe(200)
    } finally {
      await h.db.close()
    }
    const after = json<View>(
      run(['media', 'access', 'set', '/Members', '--group', 'Silver', '--change', '-o', 'json']),
    )
    expect(after.state.own).toMatchObject({ memberTypes: ['png'], memberMaxBytes: 2048 })
    expect(after.form.groups.filter((g) => g.read).map((g) => g.name)).toEqual(['Gold', 'Silver'])
    expect(ok('media', 'access', 'show', '/Members').out).toContain(
      'member uploads     png, up to 2 KB',
    )
  }, 60_000)
})

describe('on a hosted site, with --profile', () => {
  test('shown and set as the person signed in, audited by the site', async () => {
    const root = writeTreeSite()
    writeArticleSchema(join(root, 'schema'), join(root, 'components'))
    const site: TreeSite = await treeSite({
      root,
      config: {
        mediaDir: join(root, 'media'),
        cliTokens: true,
        remote: {
          enabled: true,
          environment: 'production',
          protected: false,
          approvals: false,
          maxUploadBytes: 1024 ** 2,
          oidcIssuers: [],
        },
      },
    })
    const listening = Bun.serve({ port: 0, fetch: (request) => site.h.server.fetch(request) })
    cleanup.push(async () => {
      await listening.stop(true)
      await site.close()
      rmSync(root, { recursive: true, force: true })
    })
    const dir = mkdtempSync(join(process.cwd(), 'output', 'media-access-hosted-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[prod]\nurl = "http://localhost:${listening.port}"\n`)
    const token = (await (
      await site.h.post(`${BACKOFFICE}/crombolo/api/cli-tokens`, { name: 'access' })
    ).json()) as { token: string }
    const make = mediaMaker(site.h)
    const members = await make.folder('Members')
    await make.group('Gold')
    const hosted = async (args: string[]): Promise<Run> => {
      const proc = Bun.spawn(['bun', BIN, ...args, '--profile', 'prod'], {
        cwd: dir,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...(process.env as Record<string, string>),
          CROMBOLO_PROFILES_FILE: join(dir, 'profiles'),
          CROMBOLO_TOKEN: token.token,
        },
      })
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      return { code, out, err }
    }

    const shown = json<View>(await hosted(['media', 'access', 'show', '/Members', '-o', 'json']))
    expect(shown.summary).toBe(
      summarise(await site.h.json<Parameters<typeof summarise>[0]>(`${DIALOG}/${members}`)),
    )
    const set = json<View>(
      await hosted([
        'media',
        'access',
        'set',
        '/Members',
        '--group',
        'Gold',
        '--read',
        '-o',
        'json',
      ]),
    )
    expect(set.summary).toBe('Only Gold can see this. No members can change it.')
    const unknown = await hosted([
      'media',
      'access',
      'set',
      '/Members',
      '--group',
      'Bronze',
      '--read',
    ])
    expect(unknown.code).toBe(ERROR_KINDS.not_found.exitCode)
    expect(unknown.err).toContain('There is no member group "Bronze"')

    const entries = await site.h.server.db.query<{
      entity_key: string
      source: string
      user_key: string | null
    }>(
      "SELECT entity_key, source, user_key FROM audit_entry WHERE action = 'SetPermissions' AND entity_type = 'MediaAccess'",
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ entity_key: members, source: 'request' })
    expect(entries[0]?.user_key).toBeTruthy()
  }, 120_000)
})
