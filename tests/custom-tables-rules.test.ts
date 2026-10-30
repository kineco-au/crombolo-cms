/**
 * The rules custom tables are held to before anything runs: names, the
 * builder's own limits, SQL steps, expand and contract, and checksums. Stories
 * 062 and 189, docs/data-model.md "Custom tables". No database: these are
 * properties of the declaration.
 */
import { describe, expect, test } from 'bun:test'
import {
  assertBundleTables,
  type BundleStep,
  bundleTablesCompatibility,
  type Column,
  compileTables,
  databaseHash,
  defineBundleTables,
  defineSiteTables,
  indexName,
  ownerFile,
  postgresDialect,
  renderStep,
  roleName,
  schemaBuilder,
  schemaName,
  siteSlug,
  sqliteDialect,
} from '@crombolo/data'
import { VERSION, validateServerBundles } from '@crombolo/server'
import { TASKS_ID, tasksBundle, tasksPackage, tasksV1, tasksV2 } from './support/fixture-bundle.ts'

const problemsOf = (steps: BundleStep[], version?: string, id = 'acme') =>
  compileTables(defineBundleTables(id, steps), version).problems.join('\n')

const table: BundleStep = {
  name: 'things',
  release: '1.0.0',
  up: (s) => s.createTable('thing', { id: s.uuid().primaryKey(), label: s.text().nullable() }),
}

describe('names', () => {
  test('the site’s schema is `site`, a bundle’s `bundle_<id>` with hyphens as underscores', () => {
    expect(schemaName('site')).toBe('site')
    expect(schemaName('acme-tasks')).toBe('bundle_acme_tasks')
  })

  test('a role is {site}_{hash} or {site}_{bundle}_{hash}, the hash from the database’s name', () => {
    const hash = databaseHash('crombolo_prod')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
    expect(roleName('Crombolo', 'site', 'crombolo_prod')).toBe(`crombolo_${hash}`)
    expect(roleName('Crombolo', 'acme-tasks', 'crombolo_prod')).toBe(`crombolo_acme_tasks_${hash}`)
    // Two databases on one server never share a role.
    expect(roleName('Crombolo', 'site', 'crombolo_staging')).not.toBe(
      roleName('Crombolo', 'site', 'crombolo_prod'),
    )
  })

  test('the site part is lowercased letters and digits, at most 13, and a role fits in 63', () => {
    expect(siteSlug('Harbourstone Distillery')).toBe('harbourstone')
    expect(siteSlug('Café — Ünïcode!')).toBe('caf_n_code')
    expect(siteSlug('  ')).toBe('site')
    const longest = roleName('A very long site name indeed', 'a'.repeat(39), 'db')
    expect(longest.length).toBeLessThanOrEqual(63)
  })

  test('an owner’s SQLite file sits beside crombolo’s, and in memory stays in memory', () => {
    expect(ownerFile('/data/crombolo.sqlite', 'site')).toBe('/data/crombolo.site.sqlite')
    expect(ownerFile('/data/crombolo.sqlite', 'acme-tasks')).toBe(
      '/data/crombolo.bundle.acme-tasks.sqlite',
    )
    expect(ownerFile(':memory:', 'site')).toBe(':memory:')
  })

  test('an index name is generated, never chosen', () => {
    expect(indexName('task', ['status'])).toMatch(/^ix_[0-9a-f]{12}$/)
    expect(indexName('task', ['status'])).not.toBe(indexName('task', ['due']))
  })

  test('a table or column name is [a-z][a-z0-9_]*, and a table may not start ix_', () => {
    for (const name of ['Thing', '1thing', 'thing-a', 'ix_thing', '"x"', 'thing;'])
      expect(
        problemsOf([{ ...table, up: (s) => s.createTable(name, { id: s.uuid().primaryKey() }) }]),
        name,
      ).not.toBe('')
    for (const name of ['Or', 'a-b'])
      expect(
        problemsOf([
          {
            ...table,
            up: (s) => s.createTable('thing', { id: s.uuid().primaryKey(), [name]: s.text() }),
          },
        ]),
        name,
      ).not.toBe('')
    expect(
      problemsOf([
        {
          ...table,
          up: (s) => s.createTable('a__b', { id: s.uuid().primaryKey(), and: s.text() }),
        },
      ]),
    ).toBe('')
  })

  test('a name past Postgres’s 63 characters is refused', () => {
    expect(
      problemsOf([
        { ...table, up: (s) => s.createTable(`t${'x'.repeat(63)}`, { id: s.uuid().primaryKey() }) },
      ]),
    ).toContain('past the 63 Postgres keeps')
  })
})

describe('the builder', () => {
  test('a table has exactly one primary key', () => {
    expect(
      problemsOf([{ ...table, up: (s) => s.createTable('thing', { a: s.text(), b: s.text() }) }]),
    ).toContain('0 primary keys')
  })

  test('a column added under live rows must be nullable or defaulted', () => {
    const add = (column: Column<'text', boolean, boolean>): BundleStep => ({
      name: 'add',
      release: '1.1.0',
      up: (s) => s.addColumn('thing', 'extra', column),
    })
    const s = schemaBuilder
    expect(problemsOf([table, add(s.text())])).toContain('neither nullable nor with a default')
    expect(problemsOf([table, add(s.text().nullable())])).toBe('')
    expect(problemsOf([table, add(s.text().default('x'))])).toBe('')
  })

  test('widening only widens', () => {
    const base: BundleStep = {
      name: 'base',
      release: '1.0.0',
      up: (s) =>
        s.createTable('thing', { id: s.uuid().primaryKey(), code: s.varchar(10), n: s.integer() }),
    }
    const widen = (up: BundleStep['up']): BundleStep[] => [
      base,
      { name: 'widen', release: '1.1.0', up },
    ]
    expect(problemsOf(widen((s) => s.widenColumn('thing', 'code', s.varchar(40))))).toBe('')
    expect(problemsOf(widen((s) => s.widenColumn('thing', 'code', s.text())))).toBe('')
    expect(problemsOf(widen((s) => s.widenColumn('thing', 'n', s.bigint())))).toBe('')
    expect(problemsOf(widen((s) => s.widenColumn('thing', 'code', s.varchar(5))))).toContain(
      'not wider',
    )
    expect(problemsOf(widen((s) => s.widenColumn('thing', 'n', s.text())))).toContain('not wider')
  })

  test('a string default may only hold characters DDL can carry as a literal', () => {
    expect(
      problemsOf([
        {
          ...table,
          up: (s) =>
            s.createTable('thing', {
              id: s.uuid().primaryKey(),
              a: s.text().default("x'; DROP TABLE node; --"),
            }),
        },
      ]),
    ).toContain('characters a default may not hold')
  })

  test('a column an index covers is not dropped until the index is', () => {
    const steps: BundleStep[] = [
      {
        ...table,
        up: (s) =>
          s.createTable('thing', { id: s.uuid().primaryKey(), k: s.text().nullable().indexed() }),
      },
      { name: 'drop', release: '2.0.0', up: (s) => s.dropColumn('thing', 'k') },
    ]
    expect(problemsOf(steps)).toContain('drop the index first')
  })
})

describe('what the builder gained for 189', () => {
  const owners: BundleStep = {
    name: 'owners',
    release: '1.0.0',
    up: (s) => [
      s.createTable('species', { id: s.integer().primaryKey(), code: s.varchar(8).unique() }),
      s.createTable('observation', {
        id: s.uuid().primaryKey(),
        species_id: s.integer().references('species', { onDelete: 'cascade' }),
        species_code: s
          .varchar(8)
          .nullable()
          .references('species', { column: 'code', onDelete: 'set null' }),
        parent: s.uuid().nullable().references('observation'),
        count: s.decimal(10, 2).default(0),
        seen_at: s.timestamp(),
      }),
    ],
  }

  test('foreign keys between an owner’s own tables, decimals and unique columns compile', () => {
    expect(problemsOf([owners])).toBe('')
  })

  test('a foreign key points at a table of the owner’s, at a key, of a type that joins', () => {
    const bad = (up: BundleStep['up']) => problemsOf([{ name: 'x', release: '1.0.0', up }])
    expect(
      bad((s) => s.createTable('a', { id: s.uuid().primaryKey(), n: s.uuid().references('node') })),
    ).toContain('not one of this owner’s tables'.replace('’', "'"))
    expect(
      bad((s) => [
        s.createTable('a', { id: s.uuid().primaryKey(), label: s.text() }),
        s.createTable('b', {
          id: s.uuid().primaryKey(),
          a: s.text().references('a', { column: 'label' }),
        }),
      ]),
    ).toContain('neither a primary key nor unique')
    expect(
      bad((s) => [
        s.createTable('a', { id: s.uuid().primaryKey() }),
        s.createTable('b', { id: s.uuid().primaryKey(), a: s.integer().references('a') }),
      ]),
    ).toContain('which is uuid')
    expect(
      bad((s) => [
        s.createTable('a', { id: s.uuid().primaryKey() }),
        s.createTable('b', {
          id: s.uuid().primaryKey(),
          a: s.uuid().references('a', { onDelete: 'set null' }),
        }),
      ]),
    ).toContain('must be nullable')
  })

  test('a foreign key added later starts out null, and a table something points at is not dropped', () => {
    const add = (column: Column<'integer', boolean, boolean>): BundleStep => ({
      name: 'link',
      release: '1.1.0',
      up: (s) => s.addColumn('observation', 'other', column),
    })
    const s = schemaBuilder
    expect(problemsOf([owners, add(s.integer().default(1).references('species'))])).toContain(
      'nullable without a default',
    )
    expect(problemsOf([owners, add(s.integer().nullable().references('species'))])).toBe('')
    expect(
      problemsOf([owners, { name: 'drop', release: '2.0.0', up: (b) => b.dropTable('species') }]),
    ).toContain('points at it')
  })

  test('a decimal has a precision and a scale, and widens only to hold more', () => {
    const base: BundleStep = {
      name: 'base',
      release: '1.0.0',
      up: (s) => s.createTable('t', { id: s.uuid().primaryKey(), d: s.decimal(6, 2) }),
    }
    const widen = (up: BundleStep['up']) => problemsOf([base, { name: 'w', release: '1.1.0', up }])
    expect(widen((s) => s.widenColumn('t', 'd', s.decimal(10, 2)))).toBe('')
    expect(widen((s) => s.widenColumn('t', 'd', s.decimal(10, 4)))).toBe('')
    expect(widen((s) => s.widenColumn('t', 'd', s.decimal(5, 2)))).toContain('not wider')
    expect(widen((s) => s.widenColumn('t', 'd', s.decimal(7, 4)))).toContain('not wider')
    expect(
      problemsOf([
        {
          ...base,
          up: (s) => s.createTable('t', { id: s.uuid().primaryKey(), d: s.decimal(4, 6) }),
        },
      ]),
    ).toContain('scale')
  })

  test('an index may be unique, sort columns descending, and cover only rows by a null test', () => {
    const steps: BundleStep[] = [
      owners,
      {
        name: 'indexes',
        release: '1.1.0',
        up: (s) =>
          s.addIndex('observation', ['species_id', 'seen_at'], {
            descending: ['seen_at'],
            where: { column: 'parent', is: 'null' },
          }),
      },
    ]
    expect(problemsOf(steps)).toBe('')
    const compiled = compileTables(defineBundleTables('acme', steps))
    const sql = renderStep(postgresDialect, compiled.steps[1] as never).join('\n')
    expect(sql).toMatch(/"seen_at" desc/i)
    expect(sql).toMatch(/where "parent" is null/i)
    expect(
      problemsOf([
        owners,
        {
          name: 'i',
          release: '1.1.0',
          up: (s) => s.addIndex('observation', ['count'], { descending: ['seen_at'] }),
        },
      ]),
    ).toContain('does not cover')
  })

  test('statements are unqualified: they run in the owner’s own schema or file', () => {
    const compiled = compileTables(defineBundleTables('acme', [owners]))
    for (const dialect of [sqliteDialect, postgresDialect]) {
      const sql = renderStep(dialect, compiled.steps[0] as never).join('\n')
      expect(sql).toContain('create table "species"')
      expect(sql).toContain('references "species" ("id") on delete cascade')
      expect(sql).not.toContain('bundle_')
    }
  })
})

describe('SQL steps', () => {
  const sqlStep = {
    name: 'legacy-view',
    release: '1.1.0',
    sql: {
      sqlite: ['CREATE VIEW recent AS SELECT * FROM thing'],
      postgres: ['CREATE VIEW recent AS SELECT * FROM thing'],
    },
  }

  test('the site may write a step in SQL, run as written on each engine', () => {
    const compiled = compileTables(defineSiteTables([table, sqlStep]))
    expect(compiled.problems).toEqual([])
    expect(renderStep(sqliteDialect, compiled.steps[1] as never)).toEqual(sqlStep.sql.sqlite)
    expect(compiled.steps[1]?.kind).toBe('expand')
  })

  test('a bundle may not', () => {
    const tables = { id: 'acme', steps: [table, sqlStep] }
    expect(compileTables(tables).problems.join('\n')).toContain(
      'only the site’s own tables'.replace('’', "'"),
    )
  })

  test('a SQL step needs statements for both engines, and a contract only in a major', () => {
    const problems = (step: object) =>
      compileTables(defineSiteTables([table, step as typeof sqlStep])).problems.join('\n')
    expect(problems({ ...sqlStep, sql: { sqlite: ['x'], postgres: [] } })).toContain('both engines')
    expect(problems({ ...sqlStep, kind: 'contract' })).toContain('major release')
    expect(problems({ ...sqlStep, release: '2.0.0', kind: 'contract' })).toBe('')
  })

  test('a SQL step’s checksum hashes its statements', () => {
    const once = compileTables(defineSiteTables([table, sqlStep])).steps[1]?.checksum
    const edited = compileTables(
      defineSiteTables([
        table,
        { ...sqlStep, sql: ['CREATE VIEW recent AS SELECT id FROM thing'] },
      ]),
    ).steps[1]?.checksum
    expect(once).toMatch(/^[0-9a-f]{64}$/)
    expect(edited).not.toBe(once)
  })
})

describe('expand and contract, per bundle', () => {
  test('the fixture’s two releases pass, read against their own versions', () => {
    expect(() => assertBundleTables(tasksV1, '1.1.0')).not.toThrow()
    expect(() => assertBundleTables(tasksV2, '2.0.0')).not.toThrow()
  })

  test('a contract is refused in a bundle minor', () => {
    const steps: BundleStep[] = [
      table,
      { name: 'drop', release: '1.2.0', up: (s) => s.dropColumn('thing', 'label') },
    ]
    expect(problemsOf(steps)).toContain('a contract may only ship in a major release')
  })

  test('before its 1.0, a bundle may contract in any release', () => {
    const steps: BundleStep[] = [
      { ...table, release: '0.2.0' },
      { name: 'drop', release: '0.3.0', up: (s) => s.dropColumn('thing', 'label') },
    ]
    expect(problemsOf(steps, '0.3.0')).not.toContain('major release')
  })

  test('a contract may only remove what an earlier release added', () => {
    const steps: BundleStep[] = [
      { ...table, release: '2.0.0' },
      { name: 'drop', release: '2.0.0', up: (s) => s.dropColumn('thing', 'label') },
    ]
    expect(problemsOf(steps)).toContain('may only remove what an earlier release added')
  })

  test('a step is an expand or a contract, never both', () => {
    const steps: BundleStep[] = [
      table,
      {
        name: 'both',
        release: '2.0.0',
        up: (s) => [
          s.dropColumn('thing', 'label'),
          s.addColumn('thing', 'other', s.text().nullable()),
        ],
      },
    ]
    expect(problemsOf(steps)).toContain('both adds and removes')
  })

  test('no step claims a release later than the bundle’s own version', () => {
    expect(problemsOf([{ ...table, release: '1.4.0' }], '1.3.0')).toContain(
      'later than this release (1.3.0)',
    )
  })

  test('the compatibility a bundle declares is derived from its plan', () => {
    expect(bundleTablesCompatibility(tasksV2, '2.0.0')).toBe('breaking')
    expect(bundleTablesCompatibility(tasksV2, '1.1.0')).toBe('compatible')
    expect(bundleTablesCompatibility(tasksV1, '1.1.0')).toBe('compatible')
  })

  test('boot reads the lint against the package’s version, not core’s', () => {
    // 2.0.0's contract wired under a 1.1.0 package claims a release that does not exist.
    const problems = validateServerBundles([tasksBundle(tasksV2)], [tasksPackage('1.1.0')], VERSION)
    expect(problems.join('\n')).toContain('later than this release (1.1.0)')
    expect(validateServerBundles([tasksBundle(tasksV2)], [tasksPackage('2.0.0')], VERSION)).toEqual(
      [],
    )
  })

  test('the package must declare the compatibility its tables give it', () => {
    const wrong = {
      ...tasksPackage('2.0.0'),
      field: { ...tasksPackage('2.0.0').field, migrations: 'compatible' as const },
    }
    expect(validateServerBundles([tasksBundle(tasksV2)], [wrong], VERSION).join('\n')).toContain(
      'its tables make 2.0.0 "breaking"',
    )
    const missing = { ...tasksPackage('1.1.0'), field: { id: TASKS_ID, server: 'tasks' } }
    expect(validateServerBundles([tasksBundle()], [missing], VERSION).join('\n')).toContain(
      '"crombolo.migrations": null',
    )
  })

  test('asking for the old tables capability is refused, the id site is the site’s, and tables live under the bundle’s own id', () => {
    const asking = { ...tasksBundle(), capabilities: ['tables'] } as never
    expect(validateServerBundles([asking], [tasksPackage('1.1.0')], VERSION).join('\n')).toContain(
      'context.bundle.database',
    )
    const site = { ...tasksBundle(), id: 'site', tables: defineBundleTables('site', [table]) }
    expect(
      validateServerBundles([site], [{ ...tasksPackage('1.1.0'), id: 'site' }], VERSION).join('\n'),
    ).toContain("names the site's own tables")
    const elsewhere = { ...tasksBundle(), tables: defineBundleTables('other', [table]) }
    expect(
      validateServerBundles([elsewhere], [tasksPackage('1.1.0')], VERSION).join('\n'),
    ).toContain('under its own id')
  })
})

describe('checksums and states', () => {
  test('a step’s state is derived from its position and name', () => {
    const compiled = compileTables(tasksV2)
    expect(compiled.steps.map((step) => step.to)).toEqual([
      `tables:${TASKS_ID}:1:tasks`,
      `tables:${TASKS_ID}:2:task-priority`,
      `tables:${TASKS_ID}:3:drop-legacy`,
    ])
    // A key 062's prefixed tables never used, so every chain starts again in its own place.
    expect(compiled.stateKey).toBe(`Crombolo.Tables.${TASKS_ID}.State`)
  })

  test('a checksum hashes the operations, so an edit changes it and a re-declaration does not', () => {
    const once = compileTables(tasksV1).steps[0]?.checksum
    const again = compileTables(defineBundleTables(TASKS_ID, [...tasksV1.steps])).steps[0]?.checksum
    const edited = compileTables(
      defineBundleTables(TASKS_ID, [
        {
          ...(tasksV1.steps[0] as BundleStep),
          up: (s) => s.createTable('task', { id: s.uuid().primaryKey() }),
        },
      ]),
    ).steps[0]?.checksum
    expect(once).toMatch(/^[0-9a-f]{64}$/)
    expect(again).toBe(once)
    expect(edited).not.toBe(once)
  })
})
