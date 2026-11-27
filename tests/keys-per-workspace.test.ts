/**
 * Story 436: an item's key is unique in Shared, and within each workspace, so a workspace
 * makes its own copy of a page whatever another holds. A lookup with no workspace answers
 * Shared's; a workspace's answers its own first. Every raw query by key is one someone has
 * said which row it answers for: a new one fails here until it is.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { ObjectTypes, SystemNodes } from '@crombolo/core'
import { type Db, NodeRepository, WorkspaceRepository } from '@crombolo/data'
import { dialectUnderTest, migratedDb } from './support/db.ts'

const dbs: Db[] = []
afterEach(async () => {
  while (dbs.length > 0) await dbs.pop()?.close()
})

/** Each file's raw queries by key, and why each answers the right row once keys repeat. */
const REVIEWED: Record<string, { count: number; why: string }> = {
  'packages/content/src/media-operations.ts': {
    count: 1,
    why: 'a media type, never workspace-made',
  },
  'packages/content/src/operations.ts': { count: 1, why: 'a content type, never workspace-made' },
  'packages/data/src/audit.ts': {
    count: 1,
    why: 'names an audit subject; either copy has the name',
  },
  'packages/data/src/content-query.ts': { count: 1, why: "Shared's object types only" },
  'packages/data/src/overview.ts': { count: 1, why: "Shared's document type only" },
  'packages/data/src/repositories/changes.ts': { count: 1, why: 'filters workspace_id IS NULL' },
  'packages/data/src/repositories/content-types.ts': {
    count: 16,
    why: 'types; whether a parent is a File, which its own type key says alike in every copy',
  },
  'packages/data/src/repositories/data-types.ts': { count: 3, why: 'data types' },
  'packages/data/src/repositories/document-listing.ts': {
    count: 2,
    why: "Shared's document type; people by key name either copy's creator",
  },
  'packages/data/src/repositories/documents.ts': { count: 1, why: "Shared's object type only" },
  'packages/data/src/repositories/dynamic-roots.ts': { count: 1, why: "Shared's document type" },
  'packages/data/src/repositories/media-access.ts': {
    count: 2,
    why: "Shared's first (byNodeKey); Shared's media type (itemAccess)",
  },
  'packages/data/src/repositories/media-listing.ts': { count: 1, why: "Shared's media type" },
  'packages/data/src/repositories/members.ts': {
    count: 2,
    why: 'members are never workspace-made',
  },
  'packages/data/src/repositories/nodes.ts': {
    count: 7,
    why: 'byKey and byKeys rank by scope; create reads back its own row; children hide Shared copies',
  },
  'packages/data/src/repositories/public-access.ts': { count: 1, why: "Shared's first" },
  'packages/data/src/repositories/references.ts': { count: 3, why: "Shared's first" },
  'packages/data/src/repositories/templates.ts': { count: 1, why: 'templates' },
  'packages/data/src/repositories/users.ts': {
    count: 3,
    why: "Shared's last into a map, so it is kept; one filters workspace_id IS NULL",
  },
  'packages/data/src/schema/image-alt-text.ts': {
    count: 1,
    why: 'a released migration, data types',
  },
  'packages/data/src/schema/media-tree-order.ts': { count: 1, why: 'a released migration' },
  'packages/data/src/schema/pruned-permissions.ts': { count: 2, why: 'permission keys, not nodes' },
  'packages/data/src/search.ts': { count: 1, why: 'checks a hit still exists; either row will do' },
  'packages/schema/src/check.ts': { count: 2, why: 'types' },
  'packages/schema/src/sync.ts': { count: 1, why: 'types' },
  'packages/server/src/access.ts': {
    count: 2,
    why: "Shared's object types (byKeys); Shared's first (descendants)",
  },
  'packages/server/src/adapters/blueprints.ts': { count: 1, why: 'a content type' },
  'packages/server/src/adapters/content.ts': { count: 1, why: 'a type folder' },
  'packages/server/src/adapters/elements.ts': { count: 1, why: "Shared's element type" },
  'packages/server/src/approvals.ts': { count: 1, why: 'a content type' },
  'packages/server/src/change-transfer.ts': {
    count: 2,
    why: "types read by their type row; a parent compared with Shared's siblings is Shared's",
  },
  'packages/server/src/file-items.ts': {
    count: 1,
    why: "a File's own row and its parent's: name and type, which a workspace copy shares",
  },
  'packages/server/src/member-admin.ts': { count: 1, why: 'members' },
  'packages/server/src/seed/compile.ts': { count: 2, why: 'a seed, written before any workspace' },
  'packages/server/src/seed/export.ts': { count: 1, why: 'a seed, read from Shared' },
  'packages/server/src/seed/values.ts': { count: 2, why: 'a seed, written before any workspace' },
  'packages/server/src/webhooks.ts': { count: 1, why: "Shared's first; webhooks are Shared's" },
  'packages/server/src/workspace-conflicts.ts': { count: 1, why: 'filters workspace_id IS NULL' },
  'packages/server/src/workspace-marks.ts': {
    count: 1,
    why: "the paths above marked items; both copies' ancestors are marked",
  },
  'packages/server/src/workspaces.ts': { count: 1, why: 'filters workspace_id IS NULL' },
}

const QUERY_BY_KEY = /'([a-z]+\.)?unique_id', '(=|in|not in)'/g

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.ts$/.test(name) && !name.endsWith('.d.ts') && !name.endsWith('.gen.ts'))
      out.push(path)
  }
  return out
}

test('every raw query by key says which row it answers', () => {
  const found: Record<string, number> = {}
  for (const pkg of readdirSync('packages')) {
    const src = join('packages', pkg, 'src')
    if (!statSync(join('packages', pkg)).isDirectory()) continue
    try {
      statSync(src)
    } catch {
      continue
    }
    for (const file of sources(src)) {
      const count = [...readFileSync(file, 'utf8').matchAll(QUERY_BY_KEY)].length
      if (count > 0) found[file] = count
    }
  }
  const unreviewed = Object.entries(found).filter(([file, n]) => REVIEWED[file]?.count !== n)
  expect(
    unreviewed.map(([file, n]) => `${file}: ${n}, reviewed ${REVIEWED[file]?.count ?? 0}`),
    'a new query by key: say in REVIEWED which row it answers once keys repeat (story 436)',
  ).toEqual([])
})

describe(`a key in Shared and in workspaces (${dialectUnderTest})`, () => {
  async function twoCopies() {
    const db = await migratedDb()
    dbs.push(db)
    const workspaces = new WorkspaceRepository(db)
    const one = await workspaces.open({ name: 'One', ownerKey: crypto.randomUUID() })
    const two = await workspaces.open({ name: 'Two', ownerKey: crypto.randomUUID() })
    const key = crypto.randomUUID()
    const nodes = new NodeRepository(db)
    const shared = await nodes.create({
      key,
      parentId: SystemNodes.Root,
      objectType: ObjectTypes.Document,
      text: 'Shared',
    })
    const mine = await nodes.create({
      key,
      parentId: SystemNodes.Root,
      objectType: ObjectTypes.WorkspaceDocument,
      text: 'One',
      workspaceId: one.id,
    })
    const theirs = await nodes.create({
      key,
      parentId: SystemNodes.Root,
      objectType: ObjectTypes.WorkspaceDocument,
      text: 'Two',
      workspaceId: two.id,
    })
    return { db, one, two, key, shared, mine, theirs }
  }

  test('each workspace makes its own, and a lookup answers its scope’s', async () => {
    const { db, one, two, key, shared, mine, theirs } = await twoCopies()
    expect(new Set([shared.id, mine.id, theirs.id]).size).toBe(3)
    expect((await new NodeRepository(db).byKey(key))?.id).toBe(shared.id)
    expect((await new NodeRepository(db, { workspace: one.id }).byKey(key))?.id).toBe(mine.id)
    expect((await new NodeRepository(db, { workspace: two.id }).byKey(key))?.id).toBe(theirs.id)
    expect((await new NodeRepository(db).byKeys([key])).map((n) => n.id)).toEqual([shared.id])
    expect(
      (await new NodeRepository(db, { workspace: one.id }).byKeys([key])).map((n) => n.id),
    ).toEqual([mine.id])
    // A workspace's children show its own copy, never Shared's beside it.
    const children = await new NodeRepository(db).children(
      SystemNodes.Root,
      ObjectTypes.Document,
      0,
      100,
      false,
      [],
      one.id,
    )
    expect(children.items.filter((n) => n.key === key).map((n) => n.id)).toEqual([mine.id])
  })

  test('Shared never holds two under one key, nor a workspace two of its own', async () => {
    const { db, one, key } = await twoCopies()
    const nodes = new NodeRepository(db)
    await expect(
      nodes.create({
        key,
        parentId: SystemNodes.Root,
        objectType: ObjectTypes.Document,
        text: 'X',
      }),
    ).rejects.toThrow()
    await expect(
      nodes.create({
        key,
        parentId: SystemNodes.Root,
        objectType: ObjectTypes.WorkspaceDocument,
        text: 'Y',
        workspaceId: one.id,
      }),
    ).rejects.toThrow()
  })
})
