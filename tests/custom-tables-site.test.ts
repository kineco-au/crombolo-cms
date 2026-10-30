/**
 * Custom tables on a real site: the site's own, declared in its config and
 * queried through `site().queries`, and a wired bundle's, used through
 * `context.bundle.database`. The boot that migrates them, the upgrade commands
 * that plan and apply their steps after core's, what `/status` and the Changes
 * dashboard say, and `bundle purge`. Stories 062 and 189.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  bundlePurge,
  bundlePurgePlan,
  CommandError,
  upgradeCheck,
  upgradePlan,
  upgradeRun,
} from '@crombolo/cli'
import { route } from '@crombolo/common'
import { isOk, Outcome, ok } from '@crombolo/core'
import {
  connect,
  defineSiteTables,
  ownerTablesIn,
  recordedOwner,
  type TablesDatabase,
} from '@crombolo/data'
import type { QueryCaller, SiteServices } from '@crombolo/render'
import { bootstrapDatabase, loadConfig, siteStatus, VERSION } from '@crombolo/server'
import { siteDeclaring } from './support/bundles.ts'
import { dialectUnderTest, resetPostgresSchema } from './support/db.ts'
import { TASKS_ID, tasksBundle } from './support/fixture-bundle.ts'
import { BACKOFFICE, type Harness, signedInServer } from './support/harness.ts'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

/** A site that depends on the fixture's package at 1.1.0. */
function siteDir(): string {
  const dir = siteDeclaring('bundle-tables-site', {
    '@acme/tasks': {
      json: {
        version: '1.1.0',
        crombolo: { id: TASKS_ID, name: 'Tasks', server: 'tasks', migrations: 'compatible' },
      },
    },
  })
  dirs.push(dir)
  return dir
}

const KEY = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** The site's own tables, as its config declares them. */
const siteTables = defineSiteTables([
  {
    name: 'species',
    release: '1.0.0',
    up: (s) => s.createTable('species', { id: s.integer().primaryKey(), name: s.text() }),
  },
])
type SiteDb = TablesDatabase<typeof siteTables>

/** A query module, as `import * as species from '#queries/species.ts'` gives one. */
const species = {
  async add(db: SiteDb, _caller: QueryCaller, id: number, name: string) {
    await db.insertInto('species').values({ id, name }).execute()
    return ok(id)
  },
  async named(db: SiteDb, caller: QueryCaller, id: number) {
    const row = await db
      .selectFrom('species')
      .select('name')
      .where('id', '=', id)
      .executeTakeFirst()
    if (!row) return Outcome.notFound(`no species ${id}`)
    return ok({
      name: row.name,
      locale: caller.locale,
      member: (await caller.member())?.key ?? null,
    })
  },
  async broken(db: SiteDb) {
    await db
      .selectFrom('nothing' as never)
      .selectAll()
      .execute()
    return ok(null)
  },
}

/** The site's own route, calling its queries as the visitor. */
const speciesRoute = route('/species/:id', {
  async GET(_request, { params, site }) {
    const queries = (site() as SiteServices).queries
    await queries.species?.add?.(Number(params.id), 'Wren')
    const found = await queries.species?.named?.(Number(params.id))
    return Response.json(found && isOk(found) ? found.value : null)
  },
})

describe(`the site's own tables and named queries (${dialectUnderTest})`, () => {
  test('are migrated at boot, and site().queries runs them with the handle and the caller', async () => {
    const dir = siteDir()
    const h = await signedInServer({
      config: {
        siteDir: dir,
        componentsDir: join(dir, 'components'),
        database: { tables: siteTables },
        queries: { species },
        routes: [speciesRoute],
      },
    })
    open.push(h)
    const place = await recordedOwner(h.server.db, h.server.config, 'site')
    expect(place && (await ownerTablesIn(h.server.db, place))).toEqual(['species'])

    const response = await h.call('/species/7')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ name: 'Wren', locale: null, member: null })
  })

  test('a listing that is not a module of functions refuses the boot, and a failing query is named', async () => {
    const dir = siteDir()
    const refused = await signedInServer({
      config: {
        siteDir: dir,
        componentsDir: join(dir, 'components'),
        database: { tables: siteTables },
        queries: { species: { ...species, notAQuery: 3 } as never },
      },
    }).catch((error: Error) => error)
    expect(refused).toBeInstanceOf(Error)
    expect((refused as Error).message).toContain('queries.species.notAQuery is not a function')

    const failing = route('/broken', {
      async GET(_request, { site }) {
        await (site() as SiteServices).queries.species?.broken?.()
        return new Response('unreachable')
      },
    })
    const h = await signedInServer({
      config: {
        siteDir: dir,
        componentsDir: join(dir, 'components'),
        database: { tables: siteTables },
        queries: { species },
        routes: [failing],
      },
    })
    open.push(h)
    const response = await h.call('/broken')
    expect(response.status).toBe(500)
  })
})

describe(`a wired bundle with tables (${dialectUnderTest})`, () => {
  test('is migrated at a development boot, and its routes use context.bundle.database', async () => {
    const dir = siteDir()
    const h = await signedInServer({
      config: { siteDir: dir, componentsDir: join(dir, 'components'), bundles: [tasksBundle()] },
    })
    open.push(h)
    const place = await recordedOwner(h.server.db, h.server.config, TASKS_ID)
    expect(place && (await ownerTablesIn(h.server.db, place))).toEqual(['task'])

    const route = `${BACKOFFICE}/crombolo/api/bundle/${TASKS_ID}/tasks`
    const response = await h.call(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: KEY(1), node: KEY(10) }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ count: 1 })

    // The Changes dashboard lists what ran, under the bundle's own name.
    const report = await h.json<{
      bundles: { id: string; name: string; applied: { name: string }[] }[]
    }>(`${BACKOFFICE}/crombolo/api/change-report`)
    expect(report.bundles).toEqual([
      expect.objectContaining({
        id: TASKS_ID,
        name: 'Tasks',
        pending: [],
        applied: [
          expect.objectContaining({ name: 'tasks' }),
          expect.objectContaining({ name: 'task-priority' }),
        ],
      }),
    ])
  })
})

describe(`the upgrade commands (${dialectUnderTest})`, () => {
  /** A database with core installed and the bundle not yet, as before a deploy that wires it. */
  async function behind() {
    await resetPostgresSchema()
    const dir = siteDir()
    const config = loadConfig({
      siteDir: dir,
      componentsDir: join(dir, 'components'),
      schemaDir: join(dir, 'schema'),
      sqliteFile: join(dir, 'site.sqlite'),
      development: false,
    })
    const boot = await bootstrapDatabase(config)
    await boot.db.close()
    return { ...config, bundles: [tasksBundle()], database: { tables: siteTables } }
  }

  test('plan, check and status list the site’s and the bundle’s steps; upgrade applies them after core', async () => {
    const config = await behind()
    const plan = await upgradePlan(config)
    expect(plan.steps).toEqual([])
    expect(
      plan.bundles.map((bundle) => [bundle.id, bundle.steps.map((step) => step.name)]),
    ).toEqual([
      ['site', ['species']],
      [TASKS_ID, ['tasks', 'task-priority']],
    ])
    expect(plan.bundles[1]?.steps[0]?.statements[0]).toMatch(/^create table "task"/i)
    expect(plan.bundles[1]?.steps[1]?.unplannable).toContain('backfills data')

    const check = await upgradeCheck(config)
    expect(check.bundles).toEqual([
      expect.objectContaining({ id: 'site', pending: [{ name: 'species', kind: 'expand' }] }),
      {
        id: TASKS_ID,
        name: 'Tasks',
        pending: [
          { name: 'tasks', kind: 'expand' },
          { name: 'task-priority', kind: 'expand' },
        ],
      },
    ])
    const status = await siteStatus(config)
    expect(status.bundles[TASKS_ID]?.pending).toEqual(['tasks', 'task-priority'])
    expect(status.problems.join('\n')).toContain(`the bundle "${TASKS_ID}" has 2 step(s) pending`)
    expect(status.problems.join('\n')).toContain("the site's own tables have 1 step(s) pending")

    const result = await upgradeRun(config, { backupTaken: true })
    expect(result.action).toBe('upgraded')
    if (result.action !== 'upgraded') return
    expect(result.bundlesApplied).toEqual([
      { id: 'site', applied: ['species'] },
      { id: TASKS_ID, applied: ['tasks', 'task-priority'] },
    ])
    expect((await siteStatus(config)).bundles[TASKS_ID]?.pending).toEqual([])
  })

  test('purge is refused while the bundle is wired, and drops its tables once it is not', async () => {
    const config = await behind()
    await upgradeRun(config, { backupTaken: true })
    await expect(bundlePurgePlan(config, TASKS_ID)).rejects.toBeInstanceOf(CommandError)
    await expect(bundlePurge(config, TASKS_ID, { backupTaken: true })).rejects.toThrow(
      /still wired in crombolo.config.ts/,
    )

    const unwired = { ...config, bundles: [] }
    expect((await bundlePurgePlan(unwired, TASKS_ID)).tables).toEqual(['task'])
    const purged = await bundlePurge(unwired, TASKS_ID, { backupTaken: true })
    expect(purged.dropped).toEqual(['task'])
    const db = await connect({ file: config.sqliteFile })
    try {
      const place = await recordedOwner(db, config, TASKS_ID)
      expect(place ? await ownerTablesIn(db, place) : []).toEqual([])
      // The site's own are untouched.
      const site = await recordedOwner(db, config, 'site')
      expect(site && (await ownerTablesIn(db, site))).toEqual(['species'])
    } finally {
      await db.close()
    }
  })

  test('a bundle whose peer range excludes the running version is refused, by name', async () => {
    const dir = siteDeclaring('bundle-tables-peer', {
      '@acme/tasks': {
        json: {
          version: '1.1.0',
          peerDependencies: { '@crombolo/crombolo': '^0.1.0' },
          crombolo: { id: TASKS_ID, server: 'tasks', migrations: 'compatible' },
        },
      },
    })
    dirs.push(dir)
    const config = loadConfig({ siteDir: dir, sqliteFile: join(dir, 'site.sqlite') })
    const error = await upgradePlan({ ...config, bundles: [tasksBundle()] }).catch((e) => e)
    expect(error).toBeInstanceOf(CommandError)
    expect((error as CommandError).problems.join('\n')).toContain(VERSION)
  })
})
