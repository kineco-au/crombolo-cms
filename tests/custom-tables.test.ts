/**
 * Custom tables against a real database (stories 062, 189): an owner's chain
 * and ledger, the Kysely handle on its tables and the values it reads and
 * writes, the confinement that keeps it inside them, purge, and on Postgres the
 * roles each owner is given. docs/data-model.md, "Custom tables". Run under
 * both dialects.
 */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyStepsUnledgered,
  type BundleStep,
  BundleStepEditedError,
  type CompiledTables,
  compileTables,
  connect,
  cromboloPlan,
  type Db,
  defineBundleTables,
  defineSiteTables,
  forgetOwner,
  MigrationPlan,
  migrate,
  OwnerRoleTakenError,
  OwnerSetupNeededError,
  type OwnerSlot,
  openOwner,
  ownerTablesIn,
  pendingMigrations,
  planUpgrade,
  provisionOwner,
  purgeOwnerTables,
  readLedger,
  readState,
  roleComment,
  roleName,
  sql,
  type TablesDatabase,
  tablesDatabase,
  tablesPlan,
  UpgradeStateError,
} from '@crombolo/data'
import {
  attachDatabase,
  backupBefore,
  bootstrapDatabase,
  closeTables,
  databaseFor,
  loadConfig,
  openTables,
  tablesChains,
  UpgradePendingError,
} from '@crombolo/server'
import { canConnect, dialectUnderTest, dropOwners, freshDb } from './support/db.ts'
import { TASKS_ID, tasksBundle, tasksPackage, tasksV1, tasksV2 } from './support/fixture-bundle.ts'

const open: Db[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

beforeAll(async () => {
  if (!(await canConnect())) throw new Error(`cannot connect to ${dialectUnderTest}`)
})

async function db(): Promise<Db> {
  const d = await freshDb()
  open.push(d)
  return d
}

const SETTINGS = { siteName: 'Test Site', sqliteFile: ':memory:' }
const compiledV1 = compileTables(tasksV1, '1.1.0')
const compiledV2 = compileTables(tasksV2, '2.0.0')

/** An owner's chain over its provisioned place, as boot makes one. */
async function chainOn(d: Db, compiled: CompiledTables) {
  const slot: OwnerSlot = {}
  slot.place = await provisionOwner(d, SETTINGS, compiled.id)
  slot.db = await openOwner(d, slot.place)
  return {
    plan: tablesPlan(compiled, slot),
    slot,
    database: () => tablesDatabase(slot.db as Db, compiled.schema),
  }
}

type V1 = TablesDatabase<typeof tasksV1>
type V2 = TablesDatabase<typeof tasksV2>

/** A database with core installed and the fixture at 1.x. */
async function installed() {
  const d = await db()
  await migrate(d, cromboloPlan)
  const chain = await chainOn(d, compiledV1)
  await migrate(d, chain.plan)
  return { d, chain, tasks: chain.database() as V1 }
}

const KEY = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe(`the chain (${dialectUnderTest})`, () => {
  test('applies after core, ledgered against the owner, into its own place and not crombolo’s', async () => {
    const { d, chain } = await installed()
    const ledger = await readLedger(d)
    const core = ledger.filter((row) => row.bundle === null)
    const bundle = ledger.filter((row) => row.bundle === TASKS_ID)
    expect(core).toHaveLength(cromboloPlan.migrations.length)
    expect(bundle.map((row) => [row.name, row.kind, row.checksum])).toEqual(
      compiledV1.steps.map((step) => [step.name, 'expand', step.checksum]),
    )
    expect(core.every((row) => row.checksum === row.name)).toBe(true)
    expect(await readState(d, chain.plan)).toBe(chain.plan.finalState)
    expect(await ownerTablesIn(d, chain.slot.place as never)).toEqual(['task'])
    const coreTables = (await d.query<{ name: string }>(d.dialect.tableNames)).map((r) => r.name)
    expect(coreTables).not.toContain('task')
  })

  test('the plan shows each step’s statements, and a backfill as unplannable', async () => {
    const d = await db()
    await migrate(d, cromboloPlan)
    const steps = await planUpgrade(d, tablesPlan(compiledV1))
    expect(steps[0]?.statements?.[0]).toMatch(/^create table "task"/i)
    expect(steps[0]?.unplannable).toBeUndefined()
    expect(steps[1]?.statements?.some((s) => /add column "priority"/i.test(s))).toBe(true)
    expect(steps[1]?.unplannable).toContain('backfills data')
  })

  test('a backfill runs in its step, through the handle, over the tables as that step leaves them', async () => {
    const d = await db()
    await migrate(d, cromboloPlan)
    const chain = await chainOn(d, compiledV1)
    const first = new MigrationPlan(chain.plan.migrations.slice(0, 1), {
      stateKey: compiledV1.stateKey,
      initialState: compiledV1.initialState,
      bundle: TASKS_ID,
      runStep: chain.plan.runStep,
    })
    await migrate(d, first)
    const early = tablesDatabase(chain.slot.db as Db, compiledV1.steps[0]?.after as never) as V1
    // One row at a time: in a many-row insert SQLite cannot leave a column to its default.
    await early
      .insertInto('task')
      .values({ id: KEY(1), node_key: KEY(10), status: 'urgent' })
      .execute()
    await early
      .insertInto('task')
      .values({ id: KEY(2), node_key: KEY(10) })
      .execute()
    await migrate(d, chain.plan)
    const rows = await chain.database().selectFrom('task').selectAll().orderBy('id').execute()
    expect(rows.map((row) => row.priority)).toEqual([9, 0])
  })

  test('upgrades across the bundle’s major, ledgering the contract', async () => {
    const { d, chain } = await installed()
    const v2 = { ...chain, plan: tablesPlan(compiledV2, chain.slot) }
    await migrate(d, v2.plan)
    const kinds = (await readLedger(d))
      .filter((row) => row.bundle === TASKS_ID)
      .map((row) => row.kind)
    expect(kinds).toEqual(['expand', 'expand', 'contract'])
    const tasks = tablesDatabase(chain.slot.db as Db, compiledV2.schema) as V2
    await tasks
      .insertInto('task')
      .values({ id: KEY(3), node_key: KEY(10) })
      .execute()
    expect(
      Object.keys((await tasks.selectFrom('task').selectAll().executeTakeFirst()) ?? {}),
    ).not.toContain('legacy')
  })

  test('a step edited after it shipped is refused, by name', async () => {
    const { d, chain } = await installed()
    const shipped = tasksV1.steps[0] as BundleStep
    const edited = defineBundleTables(TASKS_ID, [
      {
        ...shipped,
        up: (s) => {
          const op = shipped.up(s) as { columns: Record<string, unknown> }
          return { ...op, columns: { ...op.columns, extra: s.text().nullable().spec } } as never
        },
      },
      ...tasksV1.steps.slice(1),
      {
        name: 'later',
        release: '1.2.0',
        up: (s) => s.addColumn('task', 'note', s.text().nullable()),
      },
    ])
    const error = await migrate(d, tablesPlan(compileTables(edited), chain.slot)).catch((e) => e)
    expect(error).toBeInstanceOf(BundleStepEditedError)
    expect((error as Error).message).toContain('"tasks"')
  })

  test('a database ahead of the owner’s code is refused, naming it and both states', async () => {
    const { d, chain } = await installed()
    const v2 = tablesPlan(compiledV2, chain.slot)
    await migrate(d, v2)
    const error = await pendingMigrations(d, chain.plan).catch((e) => e)
    expect(error).toBeInstanceOf(UpgradeStateError)
    expect((error as Error).message).toContain(`"${TASKS_ID}"`)
    expect((error as Error).message).toContain(v2.finalState)
    expect((error as Error).message).toContain(chain.plan.finalState)
  })
})

/** The site's own tables as a recording site might start them: what 189 adds. */
const observations = defineSiteTables([
  {
    name: 'observations',
    release: '1.0.0',
    up: (s) => [
      s.createTable('species', {
        id: s.integer().primaryKey(),
        code: s.varchar(8).unique(),
        name: s.text(),
      }),
      s.createTable('observation', {
        id: s.uuid().primaryKey(),
        species_id: s.integer().references('species', { onDelete: 'cascade' }),
        counted: s.decimal(10, 2).default(0),
        verified: s.boolean().default(false),
        seen_at: s.timestamp(),
        detail: s.json().nullable(),
      }),
    ],
  },
])
type Observations = TablesDatabase<typeof observations>

async function siteTables() {
  const d = await db()
  await migrate(d, cromboloPlan)
  const compiled = compileTables(observations)
  const chain = await chainOn(d, compiled)
  await migrate(d, chain.plan)
  const site = chain.database() as Observations
  await site
    .insertInto('species')
    .values([
      { id: 1, code: 'WREN', name: 'Wren' },
      { id: 2, code: 'ROBIN', name: 'Robin' },
    ])
    .execute()
  return { d, chain, site }
}

describe(`the handle (${dialectUnderTest})`, () => {
  test('reads back what it wrote, the same on both engines', async () => {
    const { site } = await siteTables()
    const seen = new Date('2026-10-20T08:30:00.000Z')
    await site
      .insertInto('observation')
      .values({
        id: KEY(1).toUpperCase(),
        species_id: 1,
        counted: '2.5',
        verified: true,
        seen_at: seen,
        detail: { notes: ['by the creek'], n: 1 },
      })
      .execute()
    const row = await site.selectFrom('observation').selectAll().executeTakeFirstOrThrow()
    expect(row).toEqual({
      id: KEY(1),
      species_id: 1,
      counted: '2.50',
      verified: true,
      seen_at: seen,
      detail: { notes: ['by the creek'], n: 1 },
    })
    // A uuid compares without case, as Postgres's does.
    expect(
      await site.selectFrom('observation').select('id').where('id', '=', KEY(1)).execute(),
    ).toHaveLength(1)
    // A boolean and a date filter the same on both.
    const filtered = await site
      .selectFrom('observation')
      .select(['verified as checked', 'seen_at'])
      .where('verified', '=', true)
      .where('seen_at', '>=', new Date('2026-10-01T00:00:00.000Z'))
      .execute()
    expect(filtered).toEqual([{ checked: true, seen_at: seen }])
  })

  test('joins, groups and aggregates across the owner’s own tables', async () => {
    const { site } = await siteTables()
    const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`)
    await site
      .insertInto('observation')
      .values([
        { id: KEY(1), species_id: 1, counted: 2, seen_at: at(1), verified: false },
        { id: KEY(2), species_id: 1, counted: 3, seen_at: at(2), verified: false },
        { id: KEY(3), species_id: 2, counted: 1, seen_at: at(3), verified: true },
      ])
      .execute()
    const report = await site
      .selectFrom('observation as o')
      .innerJoin('species as s', 's.id', 'o.species_id')
      .select(['s.name', (eb) => eb.fn.countAll<number>().as('sightings')])
      .groupBy('s.name')
      .orderBy('s.name')
      .execute()
    expect(report.map((row) => [row.name, Number(row.sightings)])).toEqual([
      ['Robin', 1],
      ['Wren', 2],
    ])
    // A foreign key with a delete rule holds on both engines.
    await site.deleteFrom('species').where('id', '=', 1).execute()
    expect(await site.selectFrom('observation').select('id').execute()).toEqual([{ id: KEY(3) }])
  })

  test('a transaction commits together, or not at all', async () => {
    const { site } = await siteTables()
    await site.transaction().execute(async (trx) => {
      await trx.insertInto('species').values({ id: 3, code: 'OWL', name: 'Owl' }).execute()
      await trx.updateTable('species').set({ name: 'Barn owl' }).where('id', '=', 3).execute()
    })
    const failed = await site
      .transaction()
      .execute(async (trx) => {
        await trx.insertInto('species').values({ id: 4, code: 'KITE', name: 'Kite' }).execute()
        throw new Error('changed my mind')
      })
      .catch((error: Error) => error.message)
    expect(failed).toBe('changed my mind')
    const names = await site.selectFrom('species').select('name').orderBy('id').execute()
    expect(names.map((row) => row.name)).toEqual(['Wren', 'Robin', 'Barn owl'])
  })

  test('raw SQL fragments take values only', async () => {
    const { site } = await siteTables()
    const hostile = "Wren'; DROP TABLE species; --"
    const rows = await site
      .selectFrom('species')
      .select('id')
      .where(sql<boolean>`name = ${hostile}`)
      .execute()
    expect(rows).toEqual([])
    expect(await site.selectFrom('species').select('id').execute()).toHaveLength(2)
  })
})

describe(`confinement (${dialectUnderTest})`, () => {
  test('a handle reaches its owner’s tables and nothing else: not crombolo’s, not another owner’s', async () => {
    const { d, site } = await siteTables()
    const bundle = await chainOn(d, compiledV1)
    await migrate(d, bundle.plan)
    const tasks = bundle.database() as V1
    await tasks
      .insertInto('task')
      .values({ id: KEY(1), node_key: KEY(2) })
      .execute()

    const refused = async (query: Promise<unknown>) => {
      const error = await query.then(
        () => undefined,
        (e: Error) => e,
      )
      expect(error, 'the query ran').toBeInstanceOf(Error)
      return (error as Error).message
    }
    // crombolo's own tables, by name and qualified.
    for (const statement of [
      sql`select * from key_value`,
      sql`select * from migration_history`,
      sql`delete from key_value`,
    ])
      await refused(statement.execute(site))
    if (dialectUnderTest === 'postgres') {
      expect(await refused(sql`select * from public.key_value`.execute(site))).toContain(
        'permission denied',
      )
      // Another owner's schema, and a schema of its own making.
      expect(await refused(sql`select * from bundle_acme_tasks.task`.execute(site))).toContain(
        'permission denied',
      )
      await refused(sql`create schema elsewhere`.execute(site))
      // The role drops back at commit: the pool's next user is crombolo again.
      const who = await d.q.selectNoFrom(sql<string>`current_user`.as('who')).executeTakeFirst()
      expect(who?.who).not.toContain('test_site')
    } else {
      await refused(sql`select * from task`.execute(site))
      // A file of its own: crombolo's database is not attached to it.
      expect(await refused(sql`select * from main.key_value`.execute(site))).toContain(
        'no such table',
      )
    }
    // The bundle's handle is as confined.
    await refused(sql`select * from species`.execute(tasks))
    await refused(sql`select * from key_value`.execute(tasks))
  })
})

describe(`the core-upgrade guarantee (${dialectUnderTest})`, () => {
  test('installed at core’s first state, an owner’s tables and data survive the whole core plan', async () => {
    const d = await db()
    await migrate(d, new MigrationPlan(cromboloPlan.migrations.slice(0, 1)))
    const place = await provisionOwner(d, SETTINGS, TASKS_ID)
    const owned = await openOwner(d, place)
    if (dialectUnderTest === 'sqlite') open.push(owned)
    await applyStepsUnledgered(owned, compiledV2)
    const tasks = tablesDatabase(owned, compiledV2.schema) as V2
    await tasks
      .insertInto('task')
      .values({ id: KEY(1), node_key: KEY(10), priority: 3 })
      .execute()
    const before = await tasks.selectFrom('task').selectAll().execute()
    await migrate(d, cromboloPlan)
    expect(await readState(d)).toBe(cromboloPlan.finalState)
    expect(await tasks.selectFrom('task').selectAll().execute()).toEqual(before)
  })
})

describe(`purge (${dialectUnderTest})`, () => {
  test('drops exactly the owner’s tables, clears its state, and a re-add starts afresh', async () => {
    const { d, chain } = await installed()
    const other = await chainOn(
      d,
      compileTables(
        defineBundleTables('acme', [
          {
            name: 'one',
            release: '1.0.0',
            up: (s) => s.createTable('task', { id: s.uuid().primaryKey() }),
          },
        ]),
      ),
    )
    await migrate(d, other.plan)
    const purged = await purgeOwnerTables(d, chain.slot.place as never, {
      stateKey: compiledV1.stateKey,
    })
    expect(purged.tables).toEqual(['task'])
    expect(purged.roleLeft).toBeUndefined()
    expect(await ownerTablesIn(d, other.slot.place as never)).toEqual(['task'])
    expect(await readState(d, chain.plan)).toBe(compiledV1.initialState)
    expect((await readLedger(d)).filter((row) => row.bundle === TASKS_ID).at(-1)?.kind).toBe(
      'purge',
    )

    // A purge starts the chain again, in a place made afresh.
    const again = await chainOn(d, compiledV2)
    await migrate(d, again.plan)
    expect(await ownerTablesIn(d, again.slot.place as never)).toEqual(['task'])
  })

  test('taking a bundle out of the wiring leaves its tables, and putting it back resumes', async () => {
    const { d, chain } = await installed()
    expect(await ownerTablesIn(d, chain.slot.place as never)).toEqual(['task'])
    const result = await migrate(d, tablesPlan(compiledV2, chain.slot))
    expect(result.applied).toEqual(['drop-legacy'])
  })
})

describe('roles (postgres)', () => {
  const postgres = dialectUnderTest === 'postgres'

  test('each owner gets a role named for the database, commented with it, owning its schema', async () => {
    if (!postgres) return
    const d = await db()
    await migrate(d, cromboloPlan)
    const place = await provisionOwner(d, SETTINGS, 'site')
    const database = (
      await d.q.selectNoFrom(sql<string>`current_database()`.as('db')).executeTakeFirstOrThrow()
    ).db
    expect(place.role).toBe(roleName('Test Site', 'site', database))
    const [role] = await d.query<{ comment: string; login: boolean }>(
      `SELECT shobj_description(oid, 'pg_authid') AS comment, rolcanlogin AS login FROM pg_roles WHERE rolname = ?`,
      [place.role],
    )
    expect(role).toEqual({ comment: roleComment(database), login: false })
    const [schema] = await d.query<{ owner: string }>(
      `SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = 'site'`,
    )
    expect(schema?.owner.replaceAll('"', '')).toBe(place.role as string)
    // Renaming the site moves nothing: the name was recorded.
    expect((await provisionOwner(d, { ...SETTINGS, siteName: 'Renamed' }, 'site')).role).toBe(
      place.role,
    )
  })

  test('two databases on one server get roles of their own, and a role made for another is refused', async () => {
    if (!postgres) return
    const d = await db()
    await migrate(d, cromboloPlan)
    const url = new URL(Bun.env.CROMBOLO_POSTGRES_URL ?? Bun.env.DATABASE_URL ?? '')
    const second = `${url.pathname.slice(1)}_second`
    await d.exec(`DROP DATABASE IF EXISTS "${second}" WITH (FORCE)`)
    await d.exec(`CREATE DATABASE "${second}"`)
    const other = await connect({
      dialect: 'postgres',
      url: Object.assign(new URL(url), { pathname: `/${second}` }).toString(),
    })
    try {
      await migrate(other, cromboloPlan)
      const here = await provisionOwner(d, SETTINGS, 'site')
      const there = await provisionOwner(other, SETTINGS, 'site')
      expect(there.role).not.toBe(here.role)

      // A role with this database's name but made for another: taking it would share it.
      await dropOwners(other)
      await forgetOwner(other, 'site')
      const theirs = roleName('Taken', 'site', second)
      await d.exec(`CREATE ROLE "${theirs}" NOLOGIN`)
      await d.exec(`COMMENT ON ROLE "${theirs}" IS 'crombolo custom tables for somewhere_else'`)
      const error = await provisionOwner(other, { ...SETTINGS, siteName: 'Taken' }, 'site').catch(
        (e) => e,
      )
      expect(error).toBeInstanceOf(OwnerRoleTakenError)
      expect((error as Error).message).toContain(theirs)
      await d.exec(`DROP ROLE "${theirs}"`)
    } finally {
      await dropOwners(other)
      await other.close()
      await d.exec(`DROP DATABASE IF EXISTS "${second}" WITH (FORCE)`)
    }
  })

  test('a user that may not create roles is given the SQL to run, and then the CMS checks it', async () => {
    if (!postgres) return
    const d = await db()
    await migrate(d, cromboloPlan)
    const database = (
      await d.q.selectNoFrom(sql<string>`current_database()`.as('db')).executeTakeFirstOrThrow()
    ).db
    const user = `limited_${database}`.slice(0, 60)
    await d.exec(`DROP ROLE IF EXISTS "${user}"`)
    await d.exec(`CREATE ROLE "${user}" LOGIN PASSWORD 'limited'`)
    await d.exec(`GRANT ALL ON SCHEMA public TO "${user}"`)
    await d.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO "${user}"`)
    await d.exec(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "${user}"`)
    await d.exec(`GRANT CREATE ON DATABASE "${database}" TO "${user}"`)
    const url = new URL(Bun.env.CROMBOLO_POSTGRES_URL ?? Bun.env.DATABASE_URL ?? '')
    url.username = user
    url.password = 'limited'
    const limited = await connect({ dialect: 'postgres', url: url.toString(), readOnly: false })
    try {
      const error = await provisionOwner(limited, SETTINGS, 'site').catch((e) => e)
      expect(error).toBeInstanceOf(OwnerSetupNeededError)
      const statements = (error as OwnerSetupNeededError).statements
      expect(statements.join('\n')).toContain('CREATE ROLE')
      expect(statements.join('\n')).toContain(
        `GRANT "${roleName('Test Site', 'site', database)}" TO "${user}"`,
      )
      // The operator runs it once; the CMS then finds what it needs and uses it.
      for (const statement of statements) await d.exec(statement)
      const place = await provisionOwner(limited, SETTINGS, 'site')
      const owned = await openOwner(limited, place)
      await owned.exec('CREATE TABLE note (id integer)')
      expect(await ownerTablesIn(limited, place)).toEqual(['note'])
    } finally {
      await limited.close()
      await dropOwners(d)
      await d.exec(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${user}"`)
      await d.exec(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "${user}"`)
      await d.exec(`REVOKE ALL ON SCHEMA public FROM "${user}"`)
      await d.exec(`REVOKE ALL ON DATABASE "${database}" FROM "${user}"`)
      await d.exec(`DROP ROLE IF EXISTS "${user}"`)
    }
  })
})

describe('boot and backup (sqlite)', () => {
  const site = () => {
    const dir = mkdtempSync(join(process.cwd(), 'output', 'tables-boot-'))
    dirs.push(dir)
    return loadConfig({
      sqliteFile: join(dir, 'crombolo.sqlite'),
      development: false,
      componentsDir: dir,
      schemaDir: join(dir, 'schema'),
      siteDir: dir,
      dialect: 'sqlite',
      database: { tables: observations },
    })
  }
  const chains = (config: ReturnType<typeof site>, version: '1.1.0' | '2.0.0') =>
    tablesChains(
      config,
      [tasksBundle(version === '2.0.0' ? tasksV2 : tasksV1)],
      [tasksPackage(version)],
    )

  test('production refuses while a step is pending; development applies it', async () => {
    if (dialectUnderTest !== 'sqlite') return
    const config = site()
    const v1 = chains(config, '1.1.0')
    const first = await bootstrapDatabase(config, v1)
    await closeTables(v1)
    await first.db.close()

    const v2 = chains(config, '2.0.0')
    const failure = await bootstrapDatabase(config, v2).catch((error) => error)
    expect(failure).toBeInstanceOf(UpgradePendingError)
    expect((failure as Error).message).toContain(`"${TASKS_ID}"`)
    expect((failure as Error).message).toContain('drop-legacy')

    // A web node checks the site's own tables, and nothing of a bundle's.
    const web = await attachDatabase(
      config,
      v2.filter((chain) => chain.id === 'site'),
    )
    await web.db.close()

    const dev = await bootstrapDatabase({ ...config, development: true }, v2)
    expect((await readLedger(dev.db)).at(-1)?.name).toBe('drop-legacy')
    await closeTables(v2)
    await dev.db.close()

    const behind = chains(config, '1.1.0')
    const error = await bootstrapDatabase({ ...config, development: true }, behind).catch((e) => e)
    expect(error).toBeInstanceOf(UpgradeStateError)
    expect((error as Error).message).toContain(TASKS_ID)
  })

  test('the files sit beside crombolo’s, and the pre-upgrade backup copies them', async () => {
    if (dialectUnderTest !== 'sqlite') return
    const config = site()
    const v1 = chains(config, '1.1.0')
    const boot = await bootstrapDatabase(config, v1)
    const site1 = databaseFor(v1[0] as never) as Observations
    await site1.insertInto('species').values({ id: 1, code: 'WREN', name: 'Wren' }).execute()
    await closeTables(v1)
    await boot.db.close()
    expect(existsSync(config.sqliteFile.replace(/\.sqlite$/, '.site.sqlite'))).toBe(true)
    expect(existsSync(config.sqliteFile.replace(/\.sqlite$/, `.bundle.${TASKS_ID}.sqlite`))).toBe(
      true,
    )

    const backup = await backupBefore(config, { reason: 'upgrade' })
    expect(backup.owners).toHaveLength(2)
    const copy = await connect({
      dialect: 'sqlite',
      file: (backup.owners ?? []).find((file) => file.includes('.site.sqlite')) as string,
    })
    open.push(copy)
    expect(await copy.query('SELECT name FROM species')).toEqual([{ name: 'Wren' }])

    // A node that does not own the database opens the site's tables, never provisioning.
    const reopened = chains(config, '1.1.0')
    const reader = await connect({ dialect: 'sqlite', file: config.sqliteFile })
    open.push(reader)
    await openTables(reader, config, reopened, { provision: false })
    const again = databaseFor(reopened[0] as never) as Observations
    expect(await again.selectFrom('species').select('name').execute()).toEqual([{ name: 'Wren' }])
    await closeTables(reopened)
  })
})
