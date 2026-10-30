/**
 * The site's and bundles' own tables in a site file (story 189): carried only
 * with `withSiteData`, always sealed, default-deny under `--anonymise`, and
 * written back, owner by owner, when the file is applied.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateBundlePackage } from '@crombolo/backoffice-host'
import { defineSiteTables, SYSTEM_MEMBER_TYPE } from '@crombolo/data'
import {
  closeTables,
  databaseFor,
  exportSite,
  extractTarball,
  installBundleContent,
  openTables,
  siteTablesProblems,
  type TablesChain,
  tablesChainsFor,
  VERSION,
  validateServerBundles,
} from '@crombolo/server'
import {
  type ContentSet,
  loadBundle,
  openBundle,
  SEAL_MAGIC,
  type SiteDataTable,
  sanitise,
} from '@crombolo/transfer'
import { siteDeclaring, stubBundlePackage } from './support/bundles.ts'
import { dialectUnderTest } from './support/db.ts'
import { TASKS_ID, tasksBundle, tasksV1 } from './support/fixture-bundle.ts'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

const PASSPHRASE = 'a passphrase long enough to use'

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

const temp = (name: string) => {
  const dir = mkdtempSync(join(process.cwd(), 'output', `${name}-`))
  dirs.push(dir)
  return dir
}

const KEY = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const SEEN = '2026-04-01T06:30:00.000Z'

const siteTables = defineSiteTables([
  {
    name: 'observations',
    release: '1.0.0',
    up: (s) => [
      s.createTable('species', { id: s.integer().primaryKey(), name: s.text() }),
      s.createTable('observation', {
        id: s.uuid().primaryKey(),
        species_id: s.integer().references('species'),
        member_key: s.uuid().nullable(),
        email: s.text().nullable(),
        notes: s.text(),
        seen_at: s.timestamp(),
        verified: s.boolean().default(false),
        detail: s.json().nullable(),
      }),
      s.createTable('secret', { id: s.integer().primaryKey(), word: s.text() }),
    ],
  },
])

const RULES = {
  species: 'keep',
  observation: { member_key: 'member', email: 'email', notes: 'scrub' },
} as const

const TASK_RULES = { task: { assignee: 'member', legacy: 'scrub' } }

/** A site with its own tables and the tasks bundle's, both with anonymise rules. */
async function site(options: { wireTasks?: boolean } = {}) {
  const root = siteDeclaring('site-data', {
    '@acme/tasks': {
      json: {
        version: '1.1.0',
        crombolo: {
          id: TASKS_ID,
          name: 'Tasks',
          server: 'tasks',
          migrations: 'compatible',
          anonymise: TASK_RULES,
        },
      },
    },
  })
  dirs.push(root)
  for (const dir of ['schema/content-types', 'css', 'scripts', 'media'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      stylesheetsDir: join(root, 'css'),
      scriptsDir: join(root, 'scripts'),
      mediaDir: join(root, 'media'),
      database: { tables: siteTables, anonymise: RULES },
      bundles: options.wireTasks === false ? [] : [tasksBundle(tasksV1)],
    },
  })
  open.push(h)
  return h
}

// biome-ignore lint/suspicious/noExplicitAny: rows of any owner's tables
type AnyDb = any

/** Runs `fn` with each owner's handle, by owner. */
async function withTables(h: Harness, fn: (db: Record<string, AnyDb>) => Promise<void>) {
  const chains: TablesChain[] = tablesChainsFor(h.server.config)
  await openTables(h.server.db, h.server.config, chains, { provision: false })
  try {
    await fn(Object.fromEntries(chains.map((chain) => [chain.id, databaseFor(chain)])))
  } finally {
    await closeTables(chains)
  }
}

async function addMember(h: Harness, email: string, username: string): Promise<string> {
  const created = await h.post(`${V1}/member`, {
    memberType: { id: SYSTEM_MEMBER_TYPE.key },
    email,
    username,
    password: 'correct-horse-battery',
    isApproved: true,
    groups: [],
    values: [],
    variants: [{ culture: null, segment: null, name: username }],
  })
  expect(created.status).toBe(201)
  return created.headers.get('umb-generated-resource') as string
}

/** Rows in every table, one observation by a member and one by someone who is not. */
async function seed(h: Harness, member: string) {
  await withTables(h, async (db) => {
    await db.site.insertInto('species').values({ id: 1, name: 'Wren' }).execute()
    await db.site
      .insertInto('observation')
      .values({
        id: KEY(1),
        species_id: 1,
        member_key: member,
        email: 'ada@example.com',
        notes: 'by the gate',
        seen_at: new Date(SEEN),
        verified: true,
        detail: { count: 2 },
      })
      .execute()
    await db.site
      .insertInto('observation')
      .values({
        id: KEY(2),
        species_id: 1,
        member_key: KEY(99),
        email: 'bob@example.org',
        notes: 'in the hedge',
        seen_at: new Date(SEEN),
      })
      .execute()
    await db.site.insertInto('secret').values({ id: 1, word: 'swordfish' }).execute()
    await db[TASKS_ID]
      .insertInto('task')
      .values({ id: KEY(3), node_key: KEY(4), assignee: member, legacy: 'old notes' })
      .execute()
  })
}

/** Exports, unpacks and loads the file, as an import would read it. */
async function exported(h: Harness, options: Omit<Parameters<typeof exportSite>[2], 'out'>) {
  const result = await exportSite(h.server.db, h.server.config, {
    out: join(temp('out'), 'site.tgz'),
    ...options,
  })
  const dir = temp('unpacked')
  await extractTarball(result.out, dir)
  const loaded = loadBundle(dir)
  if (!loaded.set) throw new Error(loaded.problems.map((p) => p.message).join('; '))
  return { result, dir, loaded: { ...loaded, set: loaded.set } }
}

const rowsOf = (tables: SiteDataTable[] | undefined, owner: string, table: string) =>
  tables?.find((t) => t.owner === owner && t.table === table)?.rows

const byId = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  String(a.id).localeCompare(String(b.id))

describe(`site data in a site file (${dialectUnderTest})`, () => {
  test('travels only when asked, and then sealed', async () => {
    const h = await site()
    const ada = await addMember(h, 'ada@example.com', 'ada')
    await seed(h, ada)

    const without = await exported(h, {})
    expect(without.loaded.set.manifest.siteData).toBeUndefined()
    expect(without.result.siteData).toBeUndefined()
    expect(new Bun.Glob('data/**').scanSync({ cwd: without.dir }).next().done).toBe(true)

    await expect(
      exportSite(h.server.db, h.server.config, {
        out: join(temp('out'), 's.tgz'),
        withSiteData: true,
      }),
    ).rejects.toThrow('passphrase')

    const { loaded, dir, result } = await exported(h, {
      withSiteData: true,
      passphrase: PASSPHRASE,
    })
    expect(loaded.problems).toEqual([])
    expect(loaded.set.sealed).toBe(true)
    expect(result.siteData).toEqual({ tables: 4, rows: 5, emptied: [] })
    expect(loaded.set.manifest.siteData?.tables).toEqual([
      { owner: 'site', table: 'species', rows: 1 },
      { owner: 'site', table: 'observation', rows: 2 },
      { owner: 'site', table: 'secret', rows: 1 },
      { owner: TASKS_ID, table: 'task', rows: 1 },
    ])
    for (const path of loaded.set.manifest.siteData?.paths ?? []) {
      const bytes = readFileSync(join(dir, path))
      expect(bytes.subarray(0, SEAL_MAGIC.length).equals(SEAL_MAGIC), path).toBe(true)
      expect(bytes.toString('latin1'), path).not.toMatch(/swordfish|ada@example\.com|Wren/)
    }

    const opened = openBundle(loaded, PASSPHRASE)
    expect(rowsOf(opened.siteData, 'site', 'species')).toEqual([{ id: 1, name: 'Wren' }])
    const [first] = (rowsOf(opened.siteData, 'site', 'observation') ?? []).sort(byId)
    expect(first).toEqual({
      id: KEY(1),
      species_id: 1,
      member_key: ada,
      email: 'ada@example.com',
      notes: 'by the gate',
      seen_at: SEEN,
      verified: true,
      detail: { count: 2 },
    })
    // Left behind with the people, it needs no passphrase.
    expect(openBundle(loaded, undefined, { withoutPeople: true }).siteData).toBeUndefined()
  })

  test('anonymised, each table travels only as its rules say, and the rest travel empty', async () => {
    const h = await site()
    const ada = await addMember(h, 'ada@example.com', 'ada')
    await seed(h, ada)

    const { loaded, result } = await exported(h, {
      withSiteData: true,
      withMembers: true,
      anonymise: true,
      passphrase: PASSPHRASE,
    })
    expect(result.siteData?.emptied).toEqual(['site.secret'])
    const opened = openBundle(loaded, PASSPHRASE)
    const data = opened.siteData
    expect(rowsOf(data, 'site', 'species')).toEqual([{ id: 1, name: 'Wren' }])
    expect(rowsOf(data, 'site', 'secret')).toEqual([])
    const [mine, theirs] = (rowsOf(data, 'site', 'observation') ?? []).sort(byId)
    // A travelling member keeps their key, as their placeholder does.
    expect(opened.people?.members.map((m) => [m.key, m.email])).toEqual([
      [ada, 'member-1@example.invalid'],
    ])
    expect(mine).toMatchObject({
      member_key: ada,
      email: 'member-1@example.invalid',
      notes: '',
      seen_at: SEEN,
      verified: true,
      detail: { count: 2 },
    })
    expect(theirs?.member_key).toBeNull()
    expect(theirs?.email).toMatch(/^person-\d+@example\.invalid$/)
    // The bundle's rules, from its package.json.
    expect(rowsOf(data, TASKS_ID, 'task')).toEqual([
      expect.objectContaining({ id: KEY(3), assignee: ada, legacy: null }),
    ])
    expect(JSON.stringify(data)).not.toMatch(/ada@example\.com|bob@example\.org|by the gate/)
  })

  test("applied, replaces each owner's tables, and names what this site has no place for", async () => {
    const source = await site()
    const ada = await addMember(source, 'ada@example.com', 'ada')
    await seed(source, ada)
    const { dir } = await exported(source, { withSiteData: true, passphrase: PASSPHRASE })
    await open.pop()?.db.close()

    // Rows of its own, which reference each other: emptied children first.
    const destination = await site({ wireTasks: false })
    await withTables(destination, async (db) => {
      await db.site.insertInto('species').values({ id: 5, name: 'Robin' }).execute()
      await db.site
        .insertInto('observation')
        .values({ id: KEY(9), species_id: 5, notes: 'mine', seen_at: new Date(SEEN) })
        .execute()
    })
    const result = await installBundleContent(destination.server.db, destination.server.config, {
      bundle: dir,
      replace: 'replace',
      passphrase: PASSPHRASE,
      backupTaken: true,
    })
    expect(result.problems).toEqual([])
    expect(result.runId).toBeDefined()
    expect(result.siteData).toEqual({ tables: 3, rows: 4, skipped: [TASKS_ID], failed: [] })
    await withTables(destination, async (db) => {
      expect(await db.site.selectFrom('species').selectAll().execute()).toEqual([
        { id: 1, name: 'Wren' },
      ])
      const rows = await db.site.selectFrom('observation').selectAll().orderBy('id').execute()
      expect(rows.map((row: { id: string }) => row.id)).toEqual([KEY(1), KEY(2)])
      expect(rows[0]).toMatchObject({
        member_key: ada,
        seen_at: new Date(SEEN),
        verified: true,
        detail: { count: 2 },
      })
      expect(await db.site.selectFrom('secret').select('word').execute()).toEqual([
        { word: 'swordfish' },
      ])
    })
  })
})

describe('anonymising site data', () => {
  const emptySet = {
    manifest: {},
    nodes: [
      {
        key: KEY(10),
        kind: 'document',
        values: [{ property: 'contact', value: 'Write to bob@example.org' }],
        variants: [],
      },
    ],
  } as unknown as ContentSet

  test('an email column takes the stand-in its address has everywhere else', () => {
    const result = sanitise({
      set: emptySet,
      siteData: {
        tables: [
          {
            owner: 'site',
            table: 'contact',
            rows: [{ id: 1, email: 'Bob@Example.org', note: 'not an address' }],
          },
          { owner: 'site', table: 'other', rows: [{ id: 1, email: 'carol@example.net' }] },
        ],
        rules: { site: { contact: { email: 'email', note: 'email' }, other: 'keep' } },
        empty: () => null,
      },
    })
    const content = result.set.nodes[0]?.values[0]?.value
    const [row] = rowsOf(result.siteData, 'site', 'contact') ?? []
    expect(content).toBe(`Write to ${row?.email}`)
    expect(row?.note).toMatch(/^person-\d+@example\.invalid$/)
    expect(rowsOf(result.siteData, 'site', 'other')).toEqual([
      { id: 1, email: 'carol@example.net' },
    ])
    expect(result.emptied).toEqual([])
  })

  test('scrub empties as its column allows, and a member who does not travel is nobody', () => {
    const result = sanitise({
      set: emptySet,
      people: { memberGroups: [], members: [], userGroups: [], users: [] },
      siteData: {
        tables: [{ owner: 'b', table: 't', rows: [{ who: KEY(1), a: 'x', b: 'y' }] }],
        rules: { b: { t: { who: 'member', a: 'scrub', b: 'scrub' } } },
        empty: (_owner, _table, column) => (column === 'a' ? '' : null),
      },
    })
    expect(rowsOf(result.siteData, 'b', 't')).toEqual([{ who: null, a: '', b: null }])
  })
})

describe('anonymise rules', () => {
  test("the site's rules must name its tables and columns, and be writable back", () => {
    const problems = (anonymise: unknown) =>
      siteTablesProblems({
        database: { tables: siteTables, anonymise: anonymise as never },
        siteDir: undefined as never,
      })
    expect(problems(RULES)).toEqual([])
    expect(problems({ sightings: 'keep' }).join(' ')).toContain('"sightings"')
    expect(problems({ observation: { place: 'scrub' } }).join(' ')).toContain('"place"')
    expect(problems({ observation: { notes: 'hide' } }).join(' ')).toContain('observation.notes')
    expect(problems({ observation: { id: 'member' } }).join(' ')).toContain('nullable')
    expect(problems({ observation: { seen_at: 'scrub' } }).join(' ')).toContain('no empty value')
    expect(problems({ species: { id: 'email' } }).join(' ')).toContain('rather than text')
    expect(
      siteTablesProblems({ database: { anonymise: RULES }, siteDir: undefined as never }),
    ).toHaveLength(1)
  })

  test('the site refuses to boot on a rule that names nothing', async () => {
    const root = siteDeclaring('site-data-bad', {})
    dirs.push(root)
    const refused = await signedInServer({
      config: {
        siteDir: root,
        componentsDir: join(root, 'components'),
        database: { tables: siteTables, anonymise: { sightings: 'keep' } },
      },
    }).catch((error: Error) => error)
    expect(refused).toBeInstanceOf(Error)
    expect((refused as Error).message).toContain('"sightings"')
  })

  test("a bundle's rules are checked in its package.json and against its tables", () => {
    const json = (anonymise: unknown) => ({
      name: '@acme/tasks',
      version: '1.1.0',
      peerDependencies: { '@crombolo/crombolo': `>=${VERSION}` },
      crombolo: { id: TASKS_ID, server: 'tasks', schemaVersion: 3, permissions: [], anonymise },
    })
    expect(validateBundlePackage(json(TASK_RULES))).toEqual([])
    expect(validateBundlePackage(json({ task: 'drop' })).join(' ')).toContain('crombolo.anonymise')

    const validate = (anonymise: Record<string, unknown>) =>
      validateServerBundles(
        [tasksBundle(tasksV1)],
        [
          stubBundlePackage(TASKS_ID, {
            version: '1.1.0',
            field: {
              id: TASKS_ID,
              server: 'tasks',
              schemaVersion: 3,
              permissions: [],
              migrations: 'compatible',
              anonymise: anonymise as never,
            },
          }),
        ],
        VERSION,
      )
    expect(validate(TASK_RULES)).toEqual([])
    expect(validate({ tasks: 'keep' }).join(' ')).toContain('"tasks"')
    expect(validate({ task: { owner: 'member' } }).join(' ')).toContain('"owner"')
  })
})
