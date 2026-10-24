/**
 * Story 163: an import remembers what it applied to each node, so the next one
 * compares three ways. A change only the bundle made is taken, one only the
 * site made is kept, and only a change both made is a person's decision. A
 * node's name, place and order follow the bundle by the same rule.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ContentAppliedRepository,
  ContentTypeRepository,
  DocumentRepository,
  type NodeRow,
} from '@crombolo/data'
import { type ContentSet, exportBundle, importBundle, revertRun } from '@crombolo/transfer'
import { dialectUnderTest } from './support/db.ts'
import { type Harness, signedInServer } from './support/harness.ts'

const TYPE = (alias: string, name: string, extra: string) => `[content-type]
alias = "${alias}"
name = "${name}"
allow-at-root = true
${extra}
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

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

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'three-way-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(
    join(root, 'schema', 'content-types', 'page.toml'),
    TYPE('page', 'Page', 'allow-children = ["page", "leaf"]'),
  )
  writeFileSync(join(root, 'schema', 'content-types', 'leaf.toml'), TYPE('leaf', 'Leaf', ''))
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  const h = await signedInServer({
    config: { schemaDir: join(root, 'schema'), componentsDir: join(root, 'components') },
  })
  open.push(h)
  const types = new ContentTypeRepository(h.server.db)
  const docs = new DocumentRepository(h.server.db, { nodeState: h.server.schema.nodeState })
  const make = async (name: string, parent: string | null, title: string, type = 'page') =>
    (
      await docs.create({
        key: crypto.randomUUID(),
        contentTypeKey: (await types.byAlias(type))?.key as string,
        componentKey: null,
        parentKey: parent,
        values: [{ alias: 'title', culture: null, segment: null, value: title }],
        variants: [{ culture: null, segment: null, name }],
      })
    ).key
  const edit = async (key: string, change: { title?: string; name?: string }) => {
    const doc = await docs.byKey(key)
    if (!doc) throw new Error(`no ${key}`)
    await docs.update({
      ...doc,
      values: doc.values.map((v) =>
        v.alias === 'title' && change.title !== undefined ? { ...v, value: change.title } : v,
      ),
      variants: doc.variants.map((v) => ({
        culture: v.culture,
        segment: v.segment,
        name: change.name ?? v.name,
      })),
    })
  }
  const title = async (key: string) =>
    (await docs.byKey(key))?.values.find((v) => v.alias === 'title')?.value
  const node = async (key: string) => (await docs.nodes.byKey(key)) as NodeRow
  const exportOf = async (roots: string[]): Promise<ContentSet> =>
    (
      await exportBundle(h.server.db, {
        roots: await Promise.all(roots.map(node)),
        asGiven: roots,
        descendants: true,
        snapshot: 'drafts',
        blueprints: false,
        withBlobs: false,
        siteName: 'Source',
        nodeId: 'source',
      })
    ).set
  return { h, docs, make, edit, title, node, exportOf }
}

/** A bundle with one node's fields changed, as a newer export of it would be. */
function changed(
  set: ContentSet,
  key: string,
  change: { title?: string; name?: string; parent?: string | null; sortOrder?: number },
): ContentSet {
  return {
    ...set,
    nodes: set.nodes.map((n) =>
      n.key !== key
        ? n
        : {
            ...n,
            parent: change.parent !== undefined ? change.parent : n.parent,
            sortOrder: change.sortOrder ?? n.sortOrder,
            variants: n.variants.map((v) => ({ ...v, name: change.name ?? v.name })),
            values: n.values.map((v) =>
              v.property === 'title' && change.title !== undefined
                ? { ...v, value: change.title }
                : v,
            ),
          },
    ),
  }
}

/** A source with Home and its children, and a target that has imported them once. */
async function imported() {
  const source = await site()
  const home = await source.make('Home', null, 'Welcome')
  const about = await source.make('About', home, 'About us')
  const news = await source.make('News', home, 'The news')
  const set = await source.exportOf([home])
  const target = await site()
  const first = await importBundle(target.h.server.db, set, { nodeId: 'target' })
  expect(first.runId).toBeDefined()
  return { target, set, home, about, news }
}

const codes = (result: Awaited<ReturnType<typeof importBundle>>) =>
  result.check.findings.map((f) => f.code)

describe(`an import compares three ways (${dialectUnderTest})`, () => {
  test('what only the bundle changed is taken, with no one asked', async () => {
    const { target, set, about } = await imported()
    const result = await importBundle(
      target.h.server.db,
      changed(set, about, { title: 'About the company' }),
      { nodeId: 'target' },
    )
    expect(result.check.outstanding).toEqual([])
    expect(codes(result)).toContain('bundle-changed')
    expect(await target.title(about)).toBe('About the company')
  })

  test('what only the site changed is kept, and said', async () => {
    const { target, set, about } = await imported()
    await target.edit(about, { title: 'Edited here' })
    const result = await importBundle(target.h.server.db, set, { nodeId: 'target' })
    expect(result.check.outstanding).toEqual([])
    expect(codes(result)).toContain('local-kept')
    expect(await target.title(about)).toBe('Edited here')
  })

  test('what both changed is a decision, and nothing is written until it is made', async () => {
    const { target, set, about } = await imported()
    await target.edit(about, { title: 'Edited here' })
    const newer = changed(set, about, { title: 'Edited there' })
    const refused = await importBundle(target.h.server.db, newer, { nodeId: 'target' })
    expect(refused.runId).toBeUndefined()
    expect(refused.check.outstanding.map((f) => f.code)).toEqual(['local-edit'])
    expect(await target.title(about)).toBe('Edited here')
    const answered = await importBundle(target.h.server.db, newer, {
      nodeId: 'target',
      resolutions: { [about]: { title: 'take-bundle' } },
    })
    expect(answered.runId).toBeDefined()
    expect(await target.title(about)).toBe('Edited there')
  })

  test('a name follows the bundle, and a name changed here stays', async () => {
    const { target, set, about, news } = await imported()
    await target.edit(news, { name: 'Latest' })
    const result = await importBundle(
      target.h.server.db,
      changed(set, about, { name: 'About us' }),
      { nodeId: 'target' },
    )
    expect(result.check.outstanding).toEqual([])
    expect((await target.node(about)).text).toBe('About us')
    expect((await target.node(news)).text).toBe('Latest')
  })

  test('a node the bundle moved and reordered follows it', async () => {
    const { target, set, home, about, news } = await imported()
    const moved = changed(changed(set, news, { parent: about }), about, { sortOrder: 99 })
    const result = await importBundle(target.h.server.db, moved, { nodeId: 'target' })
    expect(result.check.outstanding).toEqual([])
    expect((await target.node(news)).parentId).toBe((await target.node(about)).id)
    const reordered = changed(changed(set, about, { sortOrder: 5 }), news, {
      sortOrder: 1,
      parent: home,
    })
    await importBundle(target.h.server.db, reordered, { nodeId: 'target' })
    const children = await target.docs.children(home, 0, 10)
    expect(children.items.map((n) => n.text)).toEqual(['News', 'About'])
  })

  test('a move its new parent does not allow is refused', async () => {
    const source = await site()
    const home = await source.make('Home', null, 'Welcome')
    const leaf = await source.make('Leaf', home, 'A leaf', 'leaf')
    const about = await source.make('About', home, 'About us')
    const set = await source.exportOf([home])
    const target = await site()
    await importBundle(target.h.server.db, set, { nodeId: 'target' })
    const result = await importBundle(target.h.server.db, changed(set, about, { parent: leaf }), {
      nodeId: 'target',
    })
    expect(result.runId).toBeUndefined()
    expect(result.check.outstanding.map((f) => f.code)).toEqual(['move-refused'])
  })

  test('a node no import recorded is compared as before', async () => {
    const { target, set, about } = await imported()
    await target.h.server.db.exec('DELETE FROM content_applied')
    const result = await importBundle(
      target.h.server.db,
      changed(set, about, { title: 'About the company' }),
      { nodeId: 'target' },
    )
    expect(result.check.outstanding.map((f) => f.code)).toEqual(['local-edit'])
  })

  test('the same bundle again writes nothing and keeps the record', async () => {
    const { target, set, about } = await imported()
    const versions = (await target.docs.versions(about)).length
    const before = (await new ContentAppliedRepository(target.h.server.db).byKeys([about])).get(
      about,
    )
    const again = await importBundle(target.h.server.db, set, { nodeId: 'target' })
    expect(again.check.outstanding).toEqual([])
    expect((await target.docs.versions(about)).length).toBe(versions)
    expect(
      (await new ContentAppliedRepository(target.h.server.db).byKeys([about])).get(about),
    ).toEqual(before)
  })

  test('a revert puts the record back with the content', async () => {
    const { target, set, about } = await imported()
    const newer = changed(set, about, { title: 'About the company' })
    const second = await importBundle(target.h.server.db, newer, { nodeId: 'target' })
    const reverted = await revertRun(target.h.server.db, second.runId as string, {
      nodeId: 'target',
    })
    expect(reverted.runId).toBeDefined()
    expect(await target.title(about)).toBe('About us')
    // The newer bundle is newer again, so it is taken again without a question.
    const third = await importBundle(target.h.server.db, newer, { nodeId: 'target' })
    expect(third.check.outstanding).toEqual([])
    expect(await target.title(about)).toBe('About the company')
  })
})
