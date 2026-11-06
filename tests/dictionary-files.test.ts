/**
 * Story 168: the dictionary as a file a person can write. A table is an item, a
 * string a translation and a table inside it a child; items are matched by name,
 * nothing is deleted, and a running server hears of every change. Driven through
 * the data layer on both dialects, and through the commands on SQLite.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cacheInstructionsAfter, connect, DictionaryRepository } from '@crombolo/data'
import {
  applyDictionaryEntries,
  dictionaryKey,
  dictionaryToUdt,
  readDictionaryToml,
  writeDictionaryToml,
} from '@crombolo/server'
import { ROOT } from '../scripts/packages.ts'
import { type Harness, signedInServer } from './support/harness.ts'

const FILE = `[Nav]
en-US = "Navigation"
fr-FR = "Navigation"

[Nav."Nav.Home"]
en-US = "Home"
fr-FR = "Accueil"

[Nav."Nav.About"]
en-US = "About \\"us\\""

[Footer]
`

describe('the file', () => {
  test('a string is a translation, and a table a child', () => {
    const { entries, problems } = readDictionaryToml(FILE)
    expect(problems).toEqual([])
    expect(entries.map((e) => e.name)).toEqual(['Nav', 'Footer'])
    const nav = entries[0]
    expect(nav?.translations).toContainEqual({ isoCode: 'fr-FR', translation: 'Navigation' })
    expect(nav?.children.map((c) => c.name)).toEqual(['Nav.Home', 'Nav.About'])
    expect(nav?.children[1]?.translations).toEqual([
      { isoCode: 'en-US', translation: 'About "us"' },
    ])
  })

  test('what is written reads back as the same items', () => {
    const { entries } = readDictionaryToml(FILE)
    const written = writeDictionaryToml([
      ...entries,
      {
        name: 'with "quotes" and\nlines',
        translations: [{ isoCode: 'en-US', translation: 'Line one\nLine "two" é' }],
        children: [],
      },
    ])
    const again = readDictionaryToml(written)
    expect(again.problems).toEqual([])
    expect(writeDictionaryToml(again.entries)).toBe(written)
    expect(again.entries.find((e) => e.name.startsWith('with'))?.translations[0]?.translation).toBe(
      'Line one\nLine "two" é',
    )
  })

  test('says what is wrong with one', () => {
    const messages = (text: string) => readDictionaryToml(text).problems.map((p) => p.message)
    expect(messages('[Nav\n').join()).toContain('not valid TOML')
    expect(messages('stray = "x"\n').join()).toContain('belongs to no item')
    expect(messages('[Nav]\nen-US = 1\n').join()).toContain('neither a translation')
    expect(messages('[A.Same]\n[B.Same]\n').join()).toContain('appears twice')
  })
})

describe('applying one', () => {
  const open: Harness[] = []
  afterEach(async () => {
    while (open.length > 0)
      await open
        .pop()
        ?.db.close()
        .catch(() => {})
  })
  const site = async () => {
    const h = await signedInServer()
    open.push(h)
    const db = h.server.db
    return { db, repo: new DictionaryRepository(db) }
  }
  const entries = (text: string) => readDictionaryToml(text).entries
  const en = (name: string, translation: string, children: ReturnType<typeof entries> = []) => ({
    name,
    translations: [{ isoCode: 'en-US', translation }],
    children,
  })

  test('makes the tree, with keys that follow the name, and tells every node', async () => {
    const { db, repo } = await site()
    const before = (await cacheInstructionsAfter(db, 0)).length
    const change = await applyDictionaryEntries(
      db,
      entries('[Nav]\nen-US = "N"\n[Nav.Home]\nen-US = "H"\n'),
    )
    expect(change).toMatchObject({ ok: true, created: ['Nav', 'Home'] })
    const home = await repo.byName('Home')
    expect(home?.key).toBe(dictionaryKey('Home'))
    expect(home?.parentKey).toBe(dictionaryKey('Nav'))
    const told = (await cacheInstructionsAfter(db, 0)).slice(before)
    expect(told.map((row) => row.payload)).toContainEqual({ dictionary: true })
  })

  test('a second run changes nothing, and tells nobody', async () => {
    const { db } = await site()
    const file = entries('[Nav]\nen-US = "N"\n')
    await applyDictionaryEntries(db, file)
    const before = (await cacheInstructionsAfter(db, 0)).length
    expect(await applyDictionaryEntries(db, file)).toMatchObject({
      created: [],
      updated: [],
      moved: [],
      unchanged: 1,
    })
    expect((await cacheInstructionsAfter(db, 0)).length).toBe(before)
  })

  test('keeps what a file does not name, and deletes nothing', async () => {
    const { db, repo } = await site()
    await applyDictionaryEntries(db, [en('Nav', 'One'), en('Other', 'Kept')])
    await repo.update((await repo.byName('Nav'))?.key as string, {
      name: 'Nav',
      translations: [{ isoCode: 'en-US', translation: 'Two' }],
    })
    expect(await applyDictionaryEntries(db, [en('Nav', 'Three')])).toMatchObject({
      updated: ['Nav'],
    })
    expect((await repo.byName('Nav'))?.translations[0]?.translation).toBe('Three')
    expect(await repo.byName('Other')).toBeDefined()
  })

  test('moves an item the file places elsewhere', async () => {
    const { db, repo } = await site()
    await applyDictionaryEntries(db, [en('A', 'a'), en('B', 'b', [en('Child', 'c')])])
    const change = await applyDictionaryEntries(db, [en('A', 'a', [en('Child', 'c')])])
    expect(change.moved).toEqual(['Child'])
    expect((await repo.byName('Child'))?.parentKey).toBe((await repo.byName('A'))?.key as string)
  })

  test('a dry run reports the same and leaves nothing', async () => {
    const { db, repo } = await site()
    const change = await applyDictionaryEntries(db, [en('Nav', 'N', [en('Home', 'H')])], {
      dryRun: true,
    })
    expect(change.created).toEqual(['Nav', 'Home'])
    expect(await repo.byName('Nav')).toBeUndefined()
  })

  test('a language the site has not got is skipped, and named', async () => {
    const { db, repo } = await site()
    const change = await applyDictionaryEntries(db, [
      {
        name: 'Nav',
        translations: [
          { isoCode: 'en-us', translation: 'N' },
          { isoCode: 'zz-ZZ', translation: 'X' },
        ],
        children: [],
      },
    ])
    expect(change.skipped).toEqual(['zz-ZZ'])
    expect((await repo.byName('Nav'))?.translations.map((t) => t.isoCode)).toEqual(['en-US'])
  })

  test('a site that renamed an item gets a new one, and keeps its own', async () => {
    const { db, repo } = await site()
    await applyDictionaryEntries(db, [en('Nav', 'N')])
    await repo.update(dictionaryKey('Nav'), { name: 'Renamed', translations: [] })
    expect((await applyDictionaryEntries(db, [en('Nav', 'N')])).created).toEqual(['Nav'])
    expect((await repo.byName('Nav'))?.key).not.toBe(dictionaryKey('Nav'))
    expect((await repo.byName('Renamed'))?.key).toBe(dictionaryKey('Nav'))
  })

  test('exports as a file that applies to nothing new', async () => {
    const { db, repo } = await site()
    await applyDictionaryEntries(db, [en('Nav', 'N', [en('Home', 'H')])])
    const text = writeDictionaryToml(await dictionaryToUdt(repo))
    expect(await applyDictionaryEntries(db, entries(text))).toMatchObject({ unchanged: 2 })
  })
})

describe('the commands', () => {
  const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
  let root: string
  const env = () => ({
    ...process.env,
    CROMBOLO_DB: 'sqlite',
    CROMBOLO_SQLITE_FILE: join(root, 'site.sqlite'),
    CROMBOLO_MEDIA_DIR: join(root, 'media'),
    CROMBOLO_SECRET_KEY: 'a-test-secret-key-that-is-long-enough-to-use',
  })
  const cli = (args: string[]) => {
    const proc = Bun.spawnSync(['bun', BIN, ...args], { cwd: root, env: env(), stdin: 'ignore' })
    const out = proc.stdout.toString()
    const err = proc.stderr.toString()
    return { code: proc.exitCode, out, err, json: <T>() => JSON.parse(out) as T }
  }
  const audited = async (action: string) => {
    const db = await connect({ dialect: 'sqlite', file: join(root, 'site.sqlite') })
    try {
      const rows = await db.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM audit_entry WHERE action = ? AND entity_type = 'DictionaryItem'",
        [action],
      )
      return Number(rows[0]?.n)
    } finally {
      await db.close()
    }
  }

  beforeAll(() => {
    root = mkdtempSync(join(process.cwd(), 'output', 'dictionary-files-'))
    mkdirSync(join(root, 'schema'), { recursive: true })
    writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    writeFileSync(join(root, 'dictionary.toml'), FILE)
    expect(cli(['users', 'list', '-o', 'json']).code).toBe(0)
    const added = cli(['languages', 'add', 'fr-FR'])
    expect(added.code, added.err).toBe(0)
  }, 60_000)
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  test('import --dry-run changes nothing, and import does', () => {
    const dry = cli(['dictionary', 'import', 'dictionary.toml', '--dry-run', '-o', 'json'])
    expect(dry.code, dry.err).toBe(0)
    expect(dry.json()).toMatchObject({ imported: 4, changed: false })
    expect(cli(['dictionary', 'list', '-o', 'json']).json<unknown>()).toEqual({ items: [] })
    expect(cli(['dictionary', 'import', 'dictionary.toml', '-o', 'json']).json()).toMatchObject({
      created: ['Nav', 'Nav.Home', 'Nav.About', 'Footer'],
      changed: true,
    })
    expect(cli(['dictionary', 'import', 'dictionary.toml', '-o', 'json']).json()).toMatchObject({
      imported: 0,
      changed: false,
    })
  }, 60_000)

  test('list --missing finds what is not translated', () => {
    const list = cli(['dictionary', 'list', '--missing', 'fr-FR', '-o', 'json']).json<{
      items: { name: string; parent: string | null }[]
    }>()
    expect(list.items.map((i) => i.name).sort()).toEqual(['Footer', 'Nav.About'])
    expect(list.items.find((i) => i.name === 'Nav.About')?.parent).toBe('Nav')
    const wrong = cli(['dictionary', 'list', '--missing', 'zz-ZZ'])
    expect(wrong.code).not.toBe(0)
    expect(wrong.err).toContain('no language zz-ZZ')
  }, 60_000)

  test('set fills one in, is the same the second time, and is audited', async () => {
    const before = await audited('Save')
    const args = ['dictionary', 'set', 'Nav.About', '--culture', 'fr-FR', 'À propos', '-o', 'json']
    const dry = cli([...args, '--dry-run'])
    expect(dry.json()).toMatchObject({ action: 'updated', changed: false })
    expect(await audited('Save')).toBe(before)
    expect(cli(args).json()).toMatchObject({ action: 'updated', changed: true })
    expect(await audited('Save')).toBe(before + 1)
    expect(cli(args).json()).toMatchObject({ action: 'unchanged', changed: false })
    expect(await audited('Save')).toBe(before + 1)
  }, 60_000)

  test('set makes a new item where it is told, and refuses a language or a parent', () => {
    expect(
      cli([
        'dictionary',
        'set',
        'Footer.Top',
        '--culture',
        'en-US',
        'Top',
        '--parent',
        'Footer',
        '-o',
        'json',
      ]).json(),
    ).toMatchObject({ action: 'created' })
    const list = cli(['dictionary', 'list', '-o', 'json']).json<{
      items: { name: string; parent: string | null }[]
    }>()
    expect(list.items.find((i) => i.name === 'Footer.Top')?.parent).toBe('Footer')
    expect(cli(['dictionary', 'set', 'X', '--culture', 'zz-ZZ', 'x']).err).toContain('no language')
    expect(
      cli(['dictionary', 'set', 'X', '--culture', 'en-US', 'x', '--parent', 'None']).err,
    ).toContain('no dictionary item None')
  }, 60_000)

  test('export chooses its format by extension, and takes a name', () => {
    expect(cli(['dictionary', 'export', '--out', 'out.toml', '--key', 'Nav']).code).toBe(0)
    const written = readFileSync(join(root, 'out.toml'), 'utf8')
    expect(written).toContain('[Nav."Nav.Home"]')
    expect(written).not.toContain('Footer')
    expect(cli(['dictionary', 'export', '--out', 'out.udt']).code).toBe(0)
    expect(readFileSync(join(root, 'out.udt'), 'utf8')).toContain('<DictionaryItem')
    expect(
      cli(['dictionary', 'import', 'out.udt', '--dry-run', '-o', 'json']).json(),
    ).toMatchObject({
      changed: false,
    })
  }, 60_000)

  test('a file with a problem applies nothing', () => {
    writeFileSync(join(root, 'bad.toml'), '[Fine]\nen-US = "x"\n[Bad]\nen-US = 1\n')
    const bad = cli(['dictionary', 'import', 'bad.toml'])
    expect(bad.code).not.toBe(0)
    expect(cli(['dictionary', 'list', '-o', 'json']).out).not.toContain('Fine')
  }, 60_000)
})
