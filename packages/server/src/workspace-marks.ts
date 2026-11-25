/**
 * What a workspace holds, item by item, for the back office's trees to mark: each page,
 * media item, Library item, type, template, file and dictionary item it made, changed,
 * moved or deleted, by the name a tree knows it by, and the items above them. Everything
 * else is as Shared has it. docs/workspaces.md.
 */
import { normaliseUuid } from '@crombolo/core'
import {
  ComponentRepository,
  type Db,
  WorkspaceFileRepository,
  WorkspaceRepository,
} from '@crombolo/data'
import { readDictionaryLines, WORKSPACE_DICTIONARY } from './adapters/workspace-dictionary.ts'

export type WorkspaceMark = 'changed' | 'new' | 'moved' | 'deleted'

export interface WorkspaceMarks {
  /** By an item's key, or a file's path as its tree names it (`/site.css`) and as the workspace keeps it. */
  items: Record<string, WorkspaceMark>
  /** The keys of items that hold a marked one below them, and are not marked themselves. */
  below: string[]
}

/** What says most of an item that is marked twice: gone, then new, then moved. */
const WEIGHT: Record<WorkspaceMark, number> = { changed: 0, moved: 1, new: 2, deleted: 3 }

const OF_CHANGE: Record<string, WorkspaceMark | undefined> = {
  changed: 'changed',
  made: 'new',
  move: 'moved',
  sort: 'moved',
  trash: 'deleted',
  delete: 'deleted',
}

const KEY_IN_FILE = /^key\s*=\s*"([0-9a-fA-F-]{36})"/m
const ALIAS_IN_FILE = /^alias\s*=\s*"([^"]+)"/m

/** Forms and workflows are also known by their alias, where their file holds no key. */
const BY_ALIAS: Record<string, string> = {
  'schema/forms/': 'form',
  'schema/workflows/': 'workflow',
}

/** The areas of files a tree lists by path: each file is named from its area's folder. */
const FILE_TREES = ['components/', 'stylesheets/', 'scripts/']

export async function workspaceMarks(db: Db, workspaceId: number): Promise<WorkspaceMarks> {
  const items = new Map<string, WorkspaceMark>()
  const mark = (id: string, as: WorkspaceMark) => {
    const had = items.get(id)
    if (!had || WEIGHT[as] > WEIGHT[had]) items.set(id, as)
  }

  // Pages, media and Library items: what it saved of them, and what waits for its merge.
  for (const change of await new WorkspaceRepository(db).changes(workspaceId)) {
    const as = OF_CHANGE[change.kind]
    if (as && !change.key.startsWith('gone:')) mark(change.key, as)
  }
  const made = await db.q
    .selectFrom('node')
    .select('unique_id')
    .where('workspace_id', '=', workspaceId)
    .execute()
  for (const row of made) mark(normaliseUuid(String(row.unique_id)), 'new')

  // The items above them, so a change is found without opening every branch.
  const nodes = [...items.keys()]
  const below = new Set<string>()
  if (nodes.length > 0) {
    const paths = await db.q
      .selectFrom('node')
      .select('path')
      .where('unique_id', 'in', nodes)
      .execute()
    const above = [
      ...new Set(
        paths.flatMap((row) =>
          String(row.path)
            .split(',')
            .slice(0, -1)
            .map(Number)
            .filter((id) => id > 0),
        ),
      ),
    ]
    if (above.length > 0)
      for (const row of await db.q
        .selectFrom('node')
        .select('unique_id')
        .where('id', 'in', above)
        .execute()) {
        const key = normaliseUuid(String(row.unique_id))
        if (!items.has(key)) below.add(key)
      }
  }

  // Types, templates and files: its copy of each against the one it began from.
  const components = new ComponentRepository(db)
  for (const file of await new WorkspaceFileRepository(db).changes(workspaceId)) {
    if (file.path === WORKSPACE_DICTIONARY) {
      const before = new Map(readDictionaryLines(file.base ?? '').map((i) => [i.key, i]))
      const after = new Map(readDictionaryLines(file.now ?? '').map((i) => [i.key, i]))
      for (const [key, item] of after)
        if (!before.has(key)) mark(normaliseUuid(key), 'new')
        else if (JSON.stringify(before.get(key)) !== JSON.stringify(item))
          mark(normaliseUuid(key), 'changed')
      for (const key of before.keys()) if (!after.has(key)) mark(normaliseUuid(key), 'deleted')
      continue
    }
    const as: WorkspaceMark = file.base === null ? 'new' : file.now === null ? 'deleted' : 'changed'
    mark(file.path, as)
    const key = KEY_IN_FILE.exec(file.now ?? file.base ?? '')?.[1]
    if (key) mark(normaliseUuid(key), as)
    const named = Object.entries(BY_ALIAS).find(([prefix]) => file.path.startsWith(prefix))
    const alias = named ? ALIAS_IN_FILE.exec(file.now ?? file.base ?? '')?.[1] : undefined
    if (named && alias) mark(`${named[1]}:${alias}`, as)
    const area = FILE_TREES.find((prefix) => file.path.startsWith(prefix))
    if (!area) continue
    const within = file.path.slice(area.length)
    mark(`/${within}`, as)
    if (area === 'components/') {
      const template = await components.byAlias(within.replace(/\.[^./]+$/, ''))
      if (template) mark(normaliseUuid(template.key), as)
    }
  }

  return { items: Object.fromEntries(items), below: [...below] }
}
