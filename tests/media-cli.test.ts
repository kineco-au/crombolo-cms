/**
 * Story 355 from the command line: `media list`, `find`, `show`, `update` and
 * `folder new`, in a site folder and on a hosted site with --profile. A replaced
 * file keeps the item's key, so a picker, a link and an image in rich text on a
 * published page show the new file; changes are audited as the person signed
 * in; a person without Media, or outside the item's start node, is refused; CI
 * is refused on each route; and a site too old for them is told apart.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MediaPermissions, RemotePermissions } from '@crombolo/core'
import { type Db, RemoteTrustRepository, SUPER_USER_KEY } from '@crombolo/data'
import {
  bootstrapDatabase,
  JWT_TOKEN_TYPE,
  REMOTE_API_PATH,
  TOKEN_EXCHANGE_GRANT,
} from '@crombolo/server'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'
import { type TreeSite, treeSite, writeTreeSite } from './support/content-tree.ts'
import { ADMIN, BACKOFFICE, type Harness, ORIGIN, signInAsGroup, V1 } from './support/harness.ts'
import {
  cli,
  keepSignIn,
  type LocalSite,
  localSite,
  serveSite,
  sessionFor,
  withSiteDb,
} from './support/local-site.ts'
import {
  articleAddresses,
  type MadeMedia,
  mediaMaker,
  png,
  writeArticleSchema,
} from './support/media-commands.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

type Run = { code: number | null; out: string; err: string }
const json = <T>(run: Run): T => {
  expect(run.code, run.err).toBe(0)
  return JSON.parse(run.out) as T
}

interface Listed {
  total: number
  items: Array<{ key: string; name: string; path: string; type: string; folder: boolean }>
}
interface Shown {
  key: string
  path: string
  file: string | null
  alt: string | null
  focal: { left: number; top: number } | null
  access: string
  references?: { total: number; items: Array<{ kind: string; path: string | null }> }
}
interface Updated {
  key: string
  changed: string[]
  references?: { total: number }
}

const saves = (db: Db, key: string) =>
  db.query<{ action: string; source: string; user_key: string | null }>(
    `SELECT action, source, user_key FROM audit_entry WHERE category = 'media' AND entity_key = '${key}' ORDER BY id`,
  )

/** A group whose people may change media, starting at one folder. */
async function startingAt(h: Harness, alias: string, folder: string) {
  const created = await h.post(`${V1}/user-group`, {
    name: alias,
    alias,
    sections: ['Umb.Section.Media'],
    languages: [],
    hasAccessToAllLanguages: true,
    documentRootAccess: true,
    documentStartNode: null,
    mediaRootAccess: false,
    mediaStartNode: { id: folder },
    elementRootAccess: false,
    elementStartNode: null,
    fallbackPermissions: [MediaPermissions.Read, MediaPermissions.Update],
    permissions: [],
  })
  expect(created.status).toBe(201)
}

describe('in a site folder', () => {
  let here: LocalSite
  let made: {
    gallery: string
    brand: string
    hero: MadeMedia
    harbour: MadeMedia
    brochure: MadeMedia
  }
  const run = (args: string[], env: Record<string, string> = {}) => cli(here, args, env)
  const ok = (...args: string[]) => {
    const done = run(args)
    expect(done.code, `${args.join(' ')}: ${done.err}`).toBe(0)
    return done
  }

  beforeAll(async () => {
    here = localSite('media-cli')
    writeArticleSchema(here.config.schemaDir, here.config.componentsDir)
    await (await bootstrapDatabase(here.config)).db.close()
    const h = await serveSite(here)
    try {
      const make = mediaMaker(h)
      const gallery = await make.folder('Gallery')
      const brand = await make.folder('Brand')
      const hero = await make.image('hero', gallery, {
        alt: 'The harbour',
        focalPoint: { left: 0.4, top: 0.6 },
      })
      const harbour = await make.image('harbour', gallery)
      const brochure = await make.file('brochure', gallery)
      await make.image('logo', brand)
      await make.article('Story', hero)
      await startingAt(h, 'brandEditors', brand)
      await signInAsGroup(h, 'writer', 'writer@example.com')
      await signInAsGroup(h, 'brandEditors', 'brand@example.com')
      made = { gallery, brand, hero, harbour, brochure }
    } finally {
      await h.db.close()
    }
  }, 120_000)
  afterAll(() => rmSync(here.dir, { recursive: true, force: true }))

  test('list and find: a page at a time, by folder, type and name', () => {
    const top = ok('media', 'list').out
    expect(top).toContain('/Brand')
    expect(top).toContain('/Gallery')
    const gallery = json<Listed>(run(['media', 'list', '--under', '/Gallery', '-o', 'json']))
    expect(gallery.total).toBe(3)
    expect(gallery.items.map((i) => i.name)).toEqual(['brochure', 'harbour', 'hero'])
    const paged = ok('media', 'list', '--under', '/Gallery', '--skip', '1', '--take', '1').out
    expect(paged).toContain('/Gallery/harbour')
    expect(paged).toContain('Showing 2–2 of 3')
    const images = json<Listed>(
      run(['media', 'list', '--under', made.gallery, '--type', 'Image', '-o', 'json']),
    )
    expect(images.items.map((i) => i.name)).toEqual(['harbour', 'hero'])
    const found = json<Listed>(run(['media', 'find', '--name', 'h', '-o', 'json']))
    expect(found.items.map((i) => i.path)).toEqual([
      '/Gallery/brochure',
      '/Gallery/harbour',
      '/Gallery/hero',
    ])
    expect(ok('media', 'find', '--name', 'nothing').out).toContain('No media matches.')
    expect(run(['media', 'list', '--under', '/Nowhere']).code).toBe(ERROR_KINDS.not_found.exitCode)
  }, 60_000)

  test('show: its type, folder, file, size, alternative text and focal point, and what uses it', () => {
    const text = ok('media', 'show', '/Gallery/hero').out
    expect(text).toContain('/Gallery/hero  (Image)')
    expect(text).toContain('folder     /Gallery')
    expect(text).toContain(`file       ${made.hero.src}`)
    expect(text).toContain('dimensions 4 × 3')
    expect(text).toContain('alt text   The harbour')
    expect(text).toContain('focal      0.4,0.6')
    expect(text).toContain('Anyone with the link can see this.')
    const shown = json<Shown>(run(['media', 'show', made.hero.key, '-o', 'json']))
    expect(shown).toMatchObject({ key: made.hero.key, path: '/Gallery/hero', file: made.hero.src })
    expect(shown.references).toBeUndefined()

    const used = ok('media', 'show', '/Gallery/hero', '--references').out
    expect(used).toContain('Used by 1 page.')
    expect(used).toContain('page     /Story  (article)')
    const references = json<Shown>(
      run(['media', 'show', '/Gallery/hero', '--references', '-o', 'json']),
    ).references
    expect(references?.items).toEqual([expect.objectContaining({ kind: 'page', path: '/Story' })])
    expect(ok('media', 'show', '/Gallery/harbour', '--references').out).toContain(
      'Nothing uses it.',
    )
  }, 60_000)

  test('update: alternative text, focal point and name; refused where the type takes neither', async () => {
    const dry = ok('media', 'update', '/Gallery/harbour', '--alt', 'Boats', '--dry-run').out
    expect(dry).toContain('Would change the alternative text of /Gallery/harbour.')
    expect(json<Shown>(run(['media', 'show', '/Gallery/harbour', '-o', 'json'])).alt).toBeNull()

    const done = json<Updated>(
      run([
        'media',
        'update',
        '/Gallery/harbour',
        '--alt',
        'Boats',
        '--focal',
        '0.2,0.8',
        '-o',
        'json',
      ]),
    )
    expect(done).toMatchObject({ key: made.harbour.key, changed: ['alt', 'focal'] })
    expect(json<Shown>(run(['media', 'show', made.harbour.key, '-o', 'json']))).toMatchObject({
      alt: 'Boats',
      focal: { left: 0.2, top: 0.8 },
    })
    expect(ok('media', 'update', made.harbour.key, '--alt', 'Boats').out).toContain(
      'already has these',
    )
    const entries = await withSiteDb(here, (db) => saves(db, made.harbour.key))
    expect(entries.filter((e) => e.action === 'Save')).toHaveLength(1)
    expect(entries.at(-1)).toMatchObject({ action: 'Save', source: 'cli' })

    const noAlt = run(['media', 'update', '/Gallery/brochure', '--alt', 'x'])
    expect(noAlt.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(noAlt.err).toContain('no text field for its alternative text')
    const noFocal = run(['media', 'update', '/Gallery/brochure', '--focal', '0.5,0.5'])
    expect(noFocal.err).toContain('has no focal point')
    expect(run(['media', 'update', '/Gallery/harbour', '--focal', '2,2']).code).toBe(
      ERROR_KINDS.usage.exitCode,
    )
    expect(run(['media', 'update', '/Gallery/harbour']).code).toBe(ERROR_KINDS.usage.exitCode)
  }, 60_000)

  test('update --file: the key kept, so the picker, the link and the image in rich text show the new file', async () => {
    const pdf = join(here.dir, 'hero.pdf')
    writeFileSync(pdf, '%PDF-1.7')
    const wrong = run(['media', 'update', '/Gallery/hero', '--file', pdf])
    expect(wrong.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(wrong.err).toContain('does not take a .pdf file')

    const dawn = join(here.dir, 'dawn.png')
    writeFileSync(dawn, await png(8, 6))
    const said = ok('media', 'update', '/Gallery/hero', '--file', dawn).out
    expect(said).toContain('Changed the file of /Gallery/hero.')
    expect(said).toContain('Used by 1 page. They keep working')
    const after = json<Shown>(run(['media', 'show', '/Gallery/hero', '-o', 'json']))
    expect(after.key).toBe(made.hero.key)
    expect(after.file).not.toBe(made.hero.src)
    expect(after.file).toEndWith('dawn.png')
    expect(after.focal).toEqual({ left: 0.4, top: 0.6 })

    const h = await serveSite(here)
    try {
      const page = articleAddresses(await (await h.call('/')).text())
      expect(page.hero?.split('?')[0]).toBe(after.file as string)
      expect(page.link).toBe(after.file as string)
      expect(page.text).toBe(after.file as string)
      expect((await h.call(after.file as string)).status).toBe(200)
      expect((await h.call(made.hero.src)).status).toBe(404)
    } finally {
      await h.db.close()
    }
  }, 120_000)

  test('folder new: makes the folders missing, and nothing when they are all there', () => {
    const said = ok('media', 'folder', 'new', '/Gallery/2026/Spring').out
    expect(said).toContain('made /Gallery/2026')
    expect(said).toContain('made /Gallery/2026/Spring')
    const again = json<{ made: string[]; path: string }>(
      run(['media', 'folder', 'new', '/Gallery/2026/Spring', '-o', 'json']),
    )
    expect(again).toMatchObject({ made: [], path: '/Gallery/2026/Spring' })
    expect(ok('media', 'folder', 'new', '/Gallery/2026').out).toContain('is already there')
    expect(run(['media', 'folder', 'new', '/Gallery/hero/Inside']).code).toBe(
      ERROR_KINDS.refused.exitCode,
    )
  }, 60_000)

  test('signed in: without Media refused, outside the start node refused, and audited as the person', async () => {
    const env = { CROMBOLO_CLI_ACCESS: 'sign-in' }
    await keepSignIn(here, await sessionFor(here, 'writer@example.com'))
    for (const args of [
      ['media', 'list'],
      ['media', 'find', '--name', 'h'],
      ['media', 'show', '/Gallery/hero'],
      ['media', 'update', '/Gallery/hero', '--alt', 'x'],
      ['media', 'folder', 'new', '/Elsewhere'],
    ]) {
      const refused = run(args, env)
      expect(refused.code, args.join(' ')).toBe(ERROR_KINDS.refused.exitCode)
      expect(refused.err).toContain('needs the Media section')
    }

    await keepSignIn(here, await sessionFor(here, 'brand@example.com'))
    expect(run(['media', 'list', '--under', '/Brand', '-o', 'json'], env).code).toBe(0)
    const listed = json<Listed>(run(['media', 'find', '--name', 'o', '-o', 'json'], env))
    expect(listed.items.map((i) => i.path)).toEqual(['/Brand/logo'])
    for (const args of [
      ['media', 'show', '/Gallery/hero'],
      ['media', 'update', '/Gallery/hero', '--alt', 'x'],
      ['media', 'folder', 'new', '/Gallery/Mine'],
    ]) {
      const refused = run(args, env)
      expect(refused.code, args.join(' ')).toBe(ERROR_KINDS.refused.exitCode)
    }

    await keepSignIn(here, await sessionFor(here, ADMIN.username))
    ok('media', 'update', '/Gallery/brochure', '--name', 'Brochure 2026')
    const done = run(['media', 'update', '/Gallery/Brochure 2026', '--name', 'brochure'], env)
    expect(done.code, done.err).toBe(0)
    const entries = await withSiteDb(here, (db) => saves(db, made.brochure.key))
    expect(entries.at(-1)).toMatchObject({
      action: 'Save',
      source: 'cli',
      user_key: SUPER_USER_KEY,
    })
  }, 120_000)
})

describe('on a hosted site, with --profile', () => {
  let issuer = ''
  let oidc: ReturnType<typeof Bun.serve>
  let privateKey: CryptoKey
  beforeAll(async () => {
    const pair = await generateKeyPair('RS256')
    privateKey = pair.privateKey
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
    oidc = Bun.serve({
      port: 0,
      fetch(request) {
        const { pathname } = new URL(request.url)
        if (pathname === '/.well-known/openid-configuration')
          return Response.json({ issuer, jwks_uri: `${issuer}/jwks` })
        if (pathname === '/jwks') return Response.json({ keys: [jwk] })
        return new Response('Not Found', { status: 404 })
      },
    })
    issuer = `http://localhost:${oidc.port}`
  })
  afterAll(() => oidc.stop(true))

  async function hosted() {
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
          oidcIssuers: [issuer],
        },
      },
    })
    const listening = Bun.serve({ port: 0, fetch: (request) => site.h.server.fetch(request) })
    cleanup.push(async () => {
      await listening.stop(true)
      await site.close()
      rmSync(root, { recursive: true, force: true })
    })
    const dir = mkdtempSync(join(process.cwd(), 'output', 'media-hosted-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[prod]\nurl = "http://localhost:${listening.port}"\n`)
    const token = (await (
      await site.h.post(`${BACKOFFICE}/crombolo/api/cli-tokens`, { name: 'media' })
    ).json()) as { token: string }
    const run = async (args: string[]): Promise<Run> => {
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
    return { site, run, dir, make: mediaMaker(site.h) }
  }

  test('listed, found, shown, changed, given a new file and a folder made, as the person signed in', async () => {
    const { site, run, dir, make } = await hosted()
    const gallery = await make.folder('Gallery')
    const hero = await make.image('hero', gallery, { alt: 'The harbour' })
    await make.file('brochure', gallery)
    await make.article('Story', hero)
    const ok = async (...args: string[]) => {
      const done = await run(args)
      expect(done.code, `${args.join(' ')}: ${done.err}`).toBe(0)
      return done
    }

    const listed = json<Listed>(await run(['media', 'list', '--under', '/Gallery', '-o', 'json']))
    expect(listed.items.map((i) => i.name)).toEqual(['brochure', 'hero'])
    expect((await ok('media', 'find', '--name', 'her')).out).toContain('/Gallery/hero')
    // A path reaches a hosted site as it is: the route resolves it.
    const shown = json<Shown>(
      await run(['media', 'show', '/Gallery/hero', '--references', '-o', 'json']),
    )
    expect(shown).toMatchObject({ key: hero.key, alt: 'The harbour', file: hero.src })
    expect(shown.references?.items).toEqual([
      expect.objectContaining({ kind: 'page', path: '/Story' }),
    ])

    const changed = json<Updated>(
      await run([
        'media',
        'update',
        '/Gallery/hero',
        '--alt',
        'At dawn',
        '--focal',
        '0.3,0.3',
        '-o',
        'json',
      ]),
    )
    expect(changed.changed).toEqual(['alt', 'focal'])
    const pdf = join(dir, 'hero.pdf')
    writeFileSync(pdf, '%PDF-1.7')
    const wrong = await run(['media', 'update', '/Gallery/hero', '--file', pdf])
    expect(wrong.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(wrong.err).toContain('does not take a .pdf file')

    const dawn = join(dir, 'dawn.png')
    writeFileSync(dawn, await png(8, 6))
    const replaced = json<Updated>(
      await run(['media', 'update', hero.key, '--file', dawn, '-o', 'json']),
    )
    expect(replaced).toMatchObject({ key: hero.key, changed: ['file'], references: { total: 1 } })
    const src = await make.srcOf(hero.key)
    expect(src).toEndWith('dawn.png')
    const page = articleAddresses(await (await site.h.call('/')).text())
    expect([page.hero?.split('?')[0], page.link, page.text]).toEqual([src, src, src])
    expect((await site.h.call(hero.src)).status).toBe(404)

    const folders = json<{ made: string[] }>(
      await run(['media', 'folder', 'new', '/Gallery/2026', '-o', 'json']),
    )
    expect(folders.made).toEqual(['/Gallery/2026'])

    const saved = (await saves(site.h.server.db, hero.key)).filter(
      (e) => e.action === 'Save' && e.source === 'request',
    )
    expect(saved).toHaveLength(2)
    expect(saved[0]?.user_key).toBeTruthy()
  }, 120_000)

  test('CI is refused on each route, as these act for a person', async () => {
    const { site } = await hosted()
    await new RemoteTrustRepository(site.h.server.db).create(
      {
        name: 'Deploys',
        issuer,
        repository: 'acme/site',
        refKind: 'branch',
        refValue: 'main',
        permissions: [RemotePermissions.Pull, RemotePermissions.Push],
      },
      'test',
    )
    const now = Math.floor(Date.now() / 1000)
    const identity = await new SignJWT({
      project_path: 'acme/site',
      ref: 'main',
      ref_type: 'branch',
      pipeline_id: '42',
      job_id: '7',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(issuer)
      .setAudience(ORIGIN)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setJti(randomUUID())
      .sign(privateKey)
    const API = `${ORIGIN}${REMOTE_API_PATH}`
    const exchanged = await site.h.server.fetch(
      new Request(`${API}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: TOKEN_EXCHANGE_GRANT,
          subject_token: identity,
          subject_token_type: JWT_TOKEN_TYPE,
        }),
      }),
    )
    expect(exchanged.status).toBe(200)
    const token = ((await exchanged.json()) as { access_token: string }).access_token
    const env = `${API}/environments/production`
    const id = randomUUID()
    for (const [method, path, title] of [
      ['GET', 'media-items', 'Reading media needs a person'],
      ['GET', `media-items/${id}`, 'Reading media needs a person'],
      ['PATCH', `media-items/${id}`, 'Changing media needs a person'],
      ['PUT', `media-items/${id}/file`, 'Changing media needs a person'],
      ['POST', 'media-items/folders', 'Changing media needs a person'],
      ['GET', `media-items/${id}/access`, 'Reading media needs a person'],
      ['PUT', `media-items/${id}/access`, 'Changing media needs a person'],
      ['GET', `content-items/${id}`, 'Reading pages needs a person'],
    ] as const) {
      const answer = await site.h.server.fetch(
        new Request(`${env}/${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          ...(method === 'GET' ? {} : { body: '{}' }),
        }),
      )
      expect(answer.status, `${method} ${path}`).toBe(403)
      expect(((await answer.json()) as { title: string }).title, `${method} ${path}`).toBe(title)
    }
  }, 120_000)

  test('a site from before these routes is told apart, and the command says it needs upgrading', async () => {
    const old: ReturnType<typeof Bun.serve> = Bun.serve({
      port: 0,
      fetch: (request): Response =>
        new URL(request.url).pathname === '/.well-known/crombolo-remote'
          ? Response.json({
              protocol: 'crombolo-remote',
              versions: ['1'],
              name: 'Old site',
              api: `http://localhost:${old.port}${REMOTE_API_PATH}`,
              auth: {},
              capabilities: ['content-query', 'users'],
              environments: [{ id: 'production', name: 'production', protected: false }],
            })
          : new Response('Not Found', { status: 404 }),
    })
    cleanup.push(() => old.stop(true))
    const dir = mkdtempSync(join(process.cwd(), 'output', 'media-old-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[old]\nurl = "http://localhost:${old.port}"\n`)
    for (const [args, words] of [
      [['media', 'list'], 'list, show and change its media'],
      [['media', 'find', '--name', 'x'], 'list, show and change its media'],
      [['media', 'show', '/x'], 'list, show and change its media'],
      [['media', 'update', '/x', '--alt', 'y'], 'list, show and change its media'],
      [['media', 'folder', 'new', '/x'], 'list, show and change its media'],
      [['media', 'access', 'show', '/x'], 'show and set who may see its media'],
      [['media', 'access', 'set', '/x', '--anyone'], 'show and set who may see its media'],
      [['content', 'show', '/x'], 'show its pages'],
    ] as const) {
      const proc = Bun.spawn(['bun', BIN, ...args, '--profile', 'old'], {
        cwd: dir,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...(process.env as Record<string, string>),
          CROMBOLO_PROFILES_FILE: join(dir, 'profiles'),
          CROMBOLO_TOKEN: 'crombolo_pat_unused',
        },
      })
      const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
      expect(code, args.join(' ')).toBe(ERROR_KINDS.refused.exitCode)
      expect(err).toContain(`This site needs a newer crombolo to ${words}`)
    }
  }, 60_000)
})
