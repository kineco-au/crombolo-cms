/**
 * Story 283: Library folders travel with their elements. A folder is a node of a
 * bundle with a name and a place, so an element keeps its folder and a picker
 * that starts at one still works. An import makes what is missing and leaves
 * what is here alone; a revert removes only what is left empty.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ObjectTypes } from '@crombolo/core'
import { ContentTypeRepository, type Db, NodeRepository, type NodeRow } from '@crombolo/data'
import { exportSite } from '@crombolo/server'
import {
  BUNDLE_FORMAT_VERSION,
  type BundleFile,
  checkBundle,
  checkRevert,
  ELEMENT_FOLDER_TYPE,
  exportBundle,
  importBundle,
  loadBundle,
  newSeal,
  openBundle,
  revertRun,
  writeBundle,
} from '@crombolo/transfer'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

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

const QUOTE_TOML = `[content-type]
key = "7a1c2e9e-4a3b-4c1d-9f10-0d6f1b2c3d4e"
alias = "quote"
name = "Quote"
is-element = true
allow-in-library = true

[[property]]
alias = "body"
name = "Body"
type = "textstring"
`

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'library-folders-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'quote.toml'), QUOTE_TOML)
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
    },
  })
  open.push(h)
  const db = h.server.db as Db
  const typeKey = (await new ContentTypeRepository(db).byAlias('quote'))?.key as string
  const element = async (name: string, parent: string | null = null) => {
    const response = await h.post(`${V1}/element`, {
      documentType: { id: typeKey },
      parent: parent ? { id: parent } : null,
      values: [{ alias: 'body', culture: null, segment: null, value: name }],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(response.status).toBe(201)
    return response.headers.get('umb-generated-resource') as string
  }
  const folder = async (name: string, parent: string | null = null) => {
    const response = await h.post(`${V1}/element/folder`, {
      name,
      parent: parent ? { id: parent } : null,
    })
    expect(response.status).toBe(201)
    return response.headers.get('umb-generated-resource') as string
  }
  const nodes = new NodeRepository(db)
  const row = (key: string) => nodes.byKey(key)
  const parentOf = async (key: string) => {
    const found = await row(key)
    return found && found.parentId > 0 ? (await nodes.byId(found.parentId))?.key : null
  }
  return { root, h, db, typeKey, element, folder, row, parentOf }
}

type Site = Awaited<ReturnType<typeof site>>

function place(files: readonly BundleFile[], dir: string) {
  for (const file of files) {
    const path = join(dir, file.path)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, file.bytes ?? (file.text as string))
  }
}

async function exported(from: Site, keys: string[], descendants = true) {
  const roots: NodeRow[] = []
  for (const key of keys) roots.push((await from.row(key)) as NodeRow)
  const { set } = await exportBundle(from.db, {
    roots,
    asGiven: keys,
    descendants,
    snapshot: 'drafts',
    blueprints: false,
    withBlobs: false,
    siteName: 'source',
    nodeId: 'test',
  })
  return set
}

describe('exporting', () => {
  test('an element brings the folders above it, and no others', async () => {
    const source = await site()
    const outer = await source.folder('Outer')
    const inner = await source.folder('Inner', outer)
    await source.folder('Elsewhere')
    const quote = await source.element('A quote', inner)

    const set = await exported(source, [quote])
    expect(set.nodes.map((n) => [n.kind, n.key, n.parent])).toEqual([
      ['element-folder', outer, null],
      ['element-folder', inner, outer],
      ['element', quote, inner],
    ])
    expect(set.nodes[0]).toMatchObject({
      contentType: ELEMENT_FOLDER_TYPE,
      values: [],
      variants: [{ name: 'Outer' }],
    })
    expect(set.manifest.counts).toEqual({ 'element-folder': 2, element: 1 })
    expect(set.manifest.dependencies.expected).toEqual([])
  })

  test('a folder as a root brings what is inside it, or itself alone', async () => {
    const source = await site()
    const outer = await source.folder('Outer')
    const inner = await source.folder('Inner', outer)
    const quote = await source.element('A quote', inner)

    const all = await exported(source, [outer])
    expect(all.nodes.map((n) => n.key)).toEqual([outer, inner, quote])
    const alone = await exported(source, [outer], false)
    expect(alone.nodes.map((n) => n.key)).toEqual([outer])
  })

  test('a whole-site export carries an element in a folder', async () => {
    const source = await site()
    await source.element('A quote', await source.folder('Outer'))
    const result = await exportSite(source.db, source.h.server.config, {
      media: false,
      out: join(source.root, 'site.tgz'),
    })
    expect(result.counts).toMatchObject({ 'element-folder': 1, element: 1 })
  })
})

describe('the format', () => {
  async function written() {
    const source = await site()
    const folder = await source.folder('Outer')
    const quote = await source.element('A quote', folder)
    const dir = join(source.root, 'bundle')
    place(writeBundle(await exported(source, [quote])), dir)
    return { source, dir, folder, quote }
  }

  test('a folder comes back as it went', async () => {
    const { dir, folder } = await written()
    const loaded = loadBundle(dir)
    expect(loaded.problems).toEqual([])
    expect(loaded.set?.manifest.formatVersion).toBe(BUNDLE_FORMAT_VERSION)
    expect(loaded.set?.nodes.find((n) => n.key === folder)).toMatchObject({
      kind: 'element-folder',
      contentType: ELEMENT_FOLDER_TYPE,
      variants: [{ name: 'Outer' }],
    })
  })

  test('a folder keeps its place when the content is sealed or left out', async () => {
    const source = await site()
    const folder = await source.folder('Outer')
    const set = await exported(source, [await source.element('A quote', folder)])

    const omitted = join(source.root, 'omitted')
    place(writeBundle(set, undefined, undefined, { content: 'omitted' }), omitted)
    expect(loadBundle(omitted).set?.nodes.find((n) => n.key === folder)?.parent).toBeNull()

    const sealed = join(source.root, 'sealed')
    const seal = newSeal('a long passphrase', { n: 2 ** 12, r: 8, p: 1 })
    place(writeBundle(set, undefined, undefined, { content: 'sealed', seal }), sealed)
    const opened = openBundle(loadBundle(sealed), 'a long passphrase')
    expect(opened.set.nodes.find((n) => n.key === folder)?.kind).toBe('element-folder')
  })

  test('a folder that carries values is refused', async () => {
    const { dir, folder } = await written()
    const file = join(dir, 'nodes', `${folder}.json`)
    const node = JSON.parse(readFileSync(file, 'utf8'))
    node.values = [{ property: 'x', culture: null, segment: null, editor: '', value: 1 }]
    writeFileSync(file, JSON.stringify(node))
    const loaded = loadBundle(dir)
    expect(loaded.problems.map((p) => p.message).join(' ')).toContain('holds no values')
  })

  test('a format 5 bundle still loads and imports as it did', async () => {
    const source = await site()
    const folder = await source.folder('Outer')
    const quote = await source.element('A quote', folder)
    const dir = join(source.root, 'bundle')
    const set = await exported(source, [quote])
    place(
      writeBundle({
        ...set,
        nodes: set.nodes.filter((n) => n.kind !== 'element-folder'),
        manifest: {
          ...set.manifest,
          formatVersion: 5,
          counts: { element: 1 },
          dependencies: {
            ...set.manifest.dependencies,
            carried: [quote],
            expected: [
              {
                key: folder,
                objectType: ObjectTypes.ElementContainer,
                name: 'Outer',
                why: 'parent of A quote',
              },
            ],
          },
        },
      }),
      dir,
    )
    const manifest = JSON.parse(readFileSync(join(dir, 'bundle.json'), 'utf8'))
    writeFileSync(join(dir, 'bundle.json'), JSON.stringify({ ...manifest, formatVersion: 5 }))
    const loaded = loadBundle(dir)
    expect(loaded.problems).toEqual([])

    const elsewhere = await site()
    const check = await checkBundle(elsewhere.db, loaded.set as NonNullable<typeof loaded.set>)
    expect(check.findings.find((f) => f.code === 'missing-parent')?.kind).toBe('blocking')
  })
})

describe('importing', () => {
  async function moved() {
    const source = await site()
    const outer = await source.folder('Outer')
    const inner = await source.folder('Inner', outer)
    const quote = await source.element('A quote', inner)
    return { source, outer, inner, quote, set: await exported(source, [quote]) }
  }

  test('folders arrive first with their keys, and the element lands inside', async () => {
    const { set, outer, inner, quote } = await moved()
    const here = await site()
    const result = await importBundle(here.db, set)
    expect(result.check.outstanding).toEqual([])
    expect(result.runId).toBeDefined()
    expect((await here.row(outer))?.objectType).toBe(ObjectTypes.ElementContainer)
    expect(await here.parentOf(inner)).toBe(outer)
    expect(await here.parentOf(quote)).toBe(inner)
    // What an element picker's `startNodeId` opens on.
    const tree = await here.h.json<{ items: Array<{ id: string }> }>(
      `${V1}/tree/element/children?parentId=${inner}&skip=0&take=100`,
    )
    expect(tree.items.map((i) => i.id)).toEqual([quote])
  })

  test('a second import creates nothing', async () => {
    const { set, outer, inner } = await moved()
    const here = await site()
    await importBundle(here.db, set)
    const again = await importBundle(here.db, set)
    expect(again.check.outstanding).toEqual([])
    for (const key of [outer, inner])
      expect(again.check.plan.find((p) => p.key === key)?.action).toBe('unchanged')
  })

  test('a folder renamed or moved here stays, and the element still lands in it', async () => {
    const { set, outer, inner, quote } = await moved()
    const here = await site()
    await importBundle(here.db, { ...set, nodes: set.nodes.filter((n) => n.key !== quote) })
    const nodes = new NodeRepository(here.db)
    await nodes.rename(((await here.row(inner)) as NodeRow).id, 'Renamed here')
    const top = await here.folder('Top here')
    await nodes.move(((await here.row(outer)) as NodeRow).id, ((await here.row(top)) as NodeRow).id)

    const result = await importBundle(here.db, set)
    expect(result.check.outstanding).toEqual([])
    expect((await here.row(inner))?.text).toBe('Renamed here')
    expect(await here.parentOf(outer)).toBe(top)
    expect(await here.parentOf(quote)).toBe(inner)
  })

  test('a folder of the same name sits beside it, keeping its own key', async () => {
    const { set, outer } = await moved()
    const here = await site()
    const namesake = await here.folder('Outer')
    const result = await importBundle(here.db, set)
    expect(result.check.outstanding).toEqual([])
    expect(result.check.findings.find((f) => f.code === 'folder-beside-namesake')?.kind).toBe(
      'auto',
    )
    expect(await here.row(outer)).toBeDefined()
    expect(await here.row(namesake)).toBeDefined()
  })

  test('what cannot be honoured is refused, and nothing is written', async () => {
    const { set, outer, inner } = await moved()
    const here = await site()

    const taken = await here.element('Holds the key')
    const clash = {
      ...set,
      nodes: set.nodes.map((n) => (n.key === inner ? { ...n, key: taken } : n)),
    }
    const blocked = await checkBundle(here.db, clash)
    expect(blocked.outstanding.map((f) => f.code)).toContain('folder-key-taken')

    const underElement = {
      ...set,
      nodes: set.nodes.map((n) =>
        n.key === inner ? { ...n, parent: set.nodes.at(-1)?.key as string } : n,
      ),
    }
    const invalid = await checkBundle(here.db, underElement)
    expect(invalid.outstanding.map((f) => f.code)).toContain('folder-parent-invalid')

    const under = await checkBundle(here.db, set, {
      under: (await here.row(taken)) as NodeRow,
    })
    expect(under.outstanding.map((f) => f.code)).toContain('folder-under-invalid')
    expect(await here.row(outer)).toBeUndefined()
  })

  test('a folder goes under the Library folder asked for', async () => {
    const { set, outer, inner, quote } = await moved()
    const here = await site()
    const target = await here.folder('Target')
    const under = (await here.row(target)) as NodeRow
    expect((await importBundle(here.db, set, { under })).runId).toBeDefined()
    expect(await here.parentOf(outer)).toBe(target)
    expect(await here.parentOf(quote)).toBe(inner)
  })
})

describe('reverting', () => {
  async function imported() {
    const source = await site()
    const outer = await source.folder('Outer')
    const inner = await source.folder('Inner', outer)
    const quote = await source.element('A quote', inner)
    const set = await exported(source, [quote])
    // Exported first: on Postgres the next site starts by clearing the database.
    const here = await site()
    const { runId } = await importBundle(here.db, set)
    return { here, set, outer, inner, quote, runId: runId as string }
  }
  const inBin = async (at: Site, key: string) => (await at.row(key))?.trashed

  test('removes the folders the import made, and can itself be reverted', async () => {
    const { here, outer, inner, quote, runId } = await imported()
    const reverted = await revertRun(here.db, runId, {})
    expect(reverted.check.outstanding).toEqual([])
    for (const key of [outer, inner, quote]) expect(await inBin(here, key)).toBe(true)

    const again = await revertRun(here.db, reverted.runId as string, {})
    expect(again.check.outstanding).toEqual([])
    for (const key of [outer, inner, quote]) expect(await inBin(here, key)).toBe(false)
    expect(await here.parentOf(inner)).toBe(outer)
    expect(await here.parentOf(quote)).toBe(inner)
  })

  test('keeps a folder something else now sits in, and the folders above it', async () => {
    const { here, outer, inner, quote, runId } = await imported()
    const mine = await here.element('Mine', inner)
    const check = await checkRevert(here.db, runId, {})
    expect(check.outstanding).toEqual([])
    expect(check.findings.filter((f) => f.code === 'folder-kept').map((f) => f.subjectKey)).toEqual(
      [outer, inner].sort((a, b) => [outer, inner].indexOf(a) - [outer, inner].indexOf(b)),
    )

    await revertRun(here.db, runId, {})
    expect(await inBin(here, quote)).toBe(true)
    for (const key of [outer, inner, mine]) expect(await inBin(here, key)).toBe(false)
  })

  test('leaves a folder that was here before the run', async () => {
    const source = await site()
    const folder = await source.folder('Outer')
    const quote = await source.element('A quote', folder)
    const set = await exported(source, [quote])
    const here = await site()
    await importBundle(here.db, { ...set, nodes: set.nodes.filter((n) => n.key !== quote) })
    const { runId } = await importBundle(here.db, set)

    await revertRun(here.db, runId as string, {})
    expect(await inBin(here, quote)).toBe(true)
    expect(await inBin(here, folder)).toBe(false)
  })

  test('a folder in the recycle bin comes back with the next import', async () => {
    const { here, set, outer, inner, runId } = await imported()
    await revertRun(here.db, runId, {})
    const result = await checkBundle(here.db, set)
    expect(
      result.findings.filter((f) => f.code === 'folder-restored').map((f) => f.subjectKey),
    ).toEqual([outer, inner])
  })
})
