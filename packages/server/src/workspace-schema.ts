/**
 * A workspace's files in the server (stories 376, 377). When a workspace opens,
 * it takes a copy of Shared's schema files, components, stylesheets and scripts,
 * kept by hash; its type rows are built from its schema copy at its first schema
 * save. At merge each file it changed is merged three ways (its copy at open, its
 * own, Shared's now): the schema files synced into Shared on the merge's own
 * transaction, every file then written where it lives, and put back if the merge
 * is undone. A file the site reads only as it starts (`site/`: its package, its
 * config, routes, jobs) is carried to the merge and takes effect there. "Update
 * from Shared" is the same merge the other way. docs/workspaces.md.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { costlier } from '@crombolo/core'
import {
  appendCacheInstruction,
  type ChangeItemInput,
  type Db,
  ensureFormLibraryTypes,
  type NodeSchemaState,
  WorkspaceFileRepository,
  WorkspaceRepository,
  type WorkspaceScope,
} from '@crombolo/data'
import {
  type ChangeClass,
  type ChangeItem,
  describeFileChange,
  exportSchemaSet,
  type LoadedSchema,
  loadSchemaDirectory,
  nextSchemaVersion,
  schemaSetFiles,
  syncSchema,
  writeSchemaVersion,
} from '@crombolo/schema'
import { merge as mergeLines } from 'node-diff3'
import { WORKSPACE_SCHEMA_PREFIX } from './adapters/schema-files.ts'
import {
  applyDictionaryLines,
  mergeDictionaryLines,
  sharedDictionaryLines,
  WORKSPACE_DICTIONARY,
} from './adapters/workspace-dictionary.ts'
import { WORKSPACE_FILE_LIMIT } from './adapters/workspace-file-port.ts'
import { checkComponents } from './components.ts'
import type { CromboloConfig } from './config.ts'
import { formTypesFor } from './form-types.ts'
import { componentAliasesIn, syncOptionsFor } from './schema.ts'
import { publishSchema, type SchemaStore } from './schema-store.ts'
import { schemaFilesIn } from './schema-transfer.ts'
import { withLosses } from './workspace-losses.ts'

/** A file both the workspace and Shared changed, where the lines overlap. */
export interface FileConflict {
  /** A definition by its path in the schema folder; any other file by its full path. */
  path: string
  definition: boolean
  base: string | null
  mine: string | null
  theirs: string | null
}

/** What merging a workspace's files into Shared would write, and what it cannot. */
export interface FileMergePlan {
  /** By full path in the workspace's list: the merged text, or null to remove it. */
  writes: Record<string, string | null>
  conflicts: FileConflict[]
  /** What the merged components would break (story 377), each saying where. */
  problems: string[]
  /** The greatest class of the workspace's changes to definitions, which the version moves by. */
  change: ChangeClass
  /** Each item of the change against Shared now, with how many pages a lossy one touches (story 382). */
  items: Array<ChangeItem & { pages?: number }>
  /** Shared's text of each written file before the merge, for the change it records (story 381). */
  befores: Record<string, string | null>
}

/** An area of files a workspace holds, besides its definitions (story 377). */
export interface FileArea {
  prefix: string
  dir: string
  extensions: readonly string[]
  /** Copied as the workspace opens; `site/` is only carried to the merge. */
  copied: boolean
}

/** The areas, as this site has them. */
export function fileAreasOf(config: CromboloConfig): FileArea[] {
  return [
    {
      prefix: 'components/',
      dir: config.componentsDir,
      extensions: ['.tsx', '.ts'],
      copied: true,
    },
    { prefix: 'stylesheets/', dir: config.stylesheetsDir, extensions: ['.css'], copied: true },
    { prefix: 'scripts/', dir: config.scriptsDir, extensions: ['.js'], copied: true },
    { prefix: 'site/', dir: config.siteDir, extensions: [], copied: false },
  ]
}

/** Files the site reads only as it starts, which a workspace carries to its merge (story 377). */
export const SITE_FILES =
  /^(package\.json|bun\.lockb?|crombolo\.config\.ts|(routes|jobs|middleware)\/.+\.(ts|tsx|js))$/

const RANK: Record<ChangeClass, number> = {
  none: 0,
  additive: 1,
  'data-requiring': 2,
  breaking: 3,
}

/** Three ways, by line: the merged text, or undefined where the two overlap. */
export function mergeText(base: string, mine: string, theirs: string): string | undefined {
  const merged = mergeLines(mine.split('\n'), base.split('\n'), theirs.split('\n'), {
    excludeFalseConflicts: true,
  })
  return merged.conflict ? undefined : merged.result.join('\n')
}

/** Three ways for one file, any side possibly absent (null). */
function mergeFile(
  base: string | null,
  mine: string | null,
  theirs: string | null,
): { text: string | null } | undefined {
  if (mine === theirs) return { text: mine }
  if (theirs === base) return { text: mine }
  if (mine === base) return { text: theirs }
  if (base === null || mine === null || theirs === null) return undefined
  const text = mergeText(base, mine, theirs)
  return text === undefined ? undefined : { text }
}

/** Every file of an area on disk, by its `/`-separated path in it; dot folders and packages left out. */
function filesOfArea(area: FileArea): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (at: string) => {
    if (!existsSync(at)) return
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (
        area.extensions.some((e) => entry.name.toLowerCase().endsWith(e)) &&
        statSync(path).size <= WORKSPACE_FILE_LIMIT
      )
        out.set(relative(area.dir, path).split(sep).join('/'), readFileSync(path, 'utf8'))
    }
  }
  walk(area.dir)
  return out
}

export function createWorkspaceSchema(
  db: Db,
  config: CromboloConfig,
  boot: { nodeId: string; nodeState: NodeSchemaState },
) {
  const formTypes = formTypesFor(config)
  const areas = fileAreasOf(config)
  const unprefixed = (files: ReadonlyMap<string, string>) =>
    new Map([...files].map(([path, text]) => [path.slice(WORKSPACE_SCHEMA_PREFIX.length), text]))
  const areaOf = (key: string) => areas.find((a) => key.startsWith(a.prefix))
  /** A path as people read it: a definition by its place in the schema folder. */
  const shown = (key: string) =>
    key.startsWith(WORKSPACE_SCHEMA_PREFIX) ? key.slice(WORKSPACE_SCHEMA_PREFIX.length) : key
  /** A path as a person names it, back to its key in the workspace's list. */
  const keyFor = (path: string) =>
    areaOf(path) || path.startsWith(WORKSPACE_SCHEMA_PREFIX) || path === WORKSPACE_DICTIONARY
      ? path
      : `${WORKSPACE_SCHEMA_PREFIX}${path}`

  /** Shared's schema files now: the folder's, or, where there is none, the database's. */
  async function sharedFiles(handle: Db = db): Promise<Map<string, string>> {
    if (existsSync(config.schemaDir)) return schemaFilesIn(config.schemaDir)
    return schemaSetFiles(await exportSchemaSet(handle, boot.nodeState.version))
  }

  /** The dictionary merges by item (story 392); every other file by line. */
  const mergeOf = (key: string, base: string | null, mine: string | null, now: string | null) =>
    key === WORKSPACE_DICTIONARY
      ? mergeDictionaryLines(base, mine, now)
      : mergeFile(base, mine, now)

  /** Every file a workspace copies, as Shared has it now, by its key. */
  async function sharedCopied(handle: Db = db): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    for (const [path, text] of await sharedFiles(handle))
      out.set(`${WORKSPACE_SCHEMA_PREFIX}${path}`, text)
    for (const area of areas.filter((a) => a.copied))
      for (const [path, text] of filesOfArea(area)) out.set(`${area.prefix}${path}`, text)
    return out
  }

  /** One file as Shared has it now, by its key; null where there is none. */
  const sharedText = (key: string, schema: ReadonlyMap<string, string>): string | null => {
    if (key.startsWith(WORKSPACE_SCHEMA_PREFIX))
      return schema.get(key.slice(WORKSPACE_SCHEMA_PREFIX.length)) ?? null
    const area = areaOf(key)
    if (!area) return null
    const file = join(area.dir, ...key.slice(area.prefix.length).split('/'))
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  }

  /** Files loaded as a sync reads them, from a folder made for them and then removed. */
  function loaded(files: ReadonlyMap<string, string>): LoadedSchema {
    const dir = mkdtempSync(join(tmpdir(), 'crombolo-workspace-schema-'))
    try {
      for (const [path, text] of files) {
        mkdirSync(dirname(join(dir, path)), { recursive: true })
        writeFileSync(join(dir, path), text)
      }
      return loadSchemaDirectory(dir, { formTypes })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /**
   * What Shared's components would be with the merge's laid over them: compiled
   * and imported, as a render does, so a component that no longer works with
   * Shared's is found before anything is written (story 377).
   */
  async function componentProblems(writes: Record<string, string | null>): Promise<string[]> {
    const area = areas.find((a) => a.prefix === 'components/') as FileArea
    const own = Object.entries(writes).filter(([key]) => key.startsWith(area.prefix))
    if (own.length === 0) return []
    mkdirSync(join(process.cwd(), 'output'), { recursive: true })
    const dir = mkdtempSync(join(process.cwd(), 'output', 'workspace-merge-views-'))
    try {
      const components = join(dir, 'components')
      if (existsSync(area.dir)) cpSync(area.dir, components, { recursive: true })
      else mkdirSync(components, { recursive: true })
      for (const [key, text] of own) {
        const target = join(components, ...key.slice(area.prefix.length).split('/'))
        if (text === null) rmSync(target, { force: true })
        else {
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, text)
        }
      }
      const report = await checkComponents({ componentsDir: components, siteDir: dir })
      return report.problems.map((p) => `${p.file}: ${p.message}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /** How many of Shared's pages hold a value for a type's property: what a lossy change costs. */
  async function pagesHolding(handle: Db, type: string, property: string): Promise<number> {
    const rows = await handle.q
      .selectFrom('property_value as pv')
      .innerJoin('property_type as p', 'p.id', 'pv.property_type_id')
      .innerJoin('content_type as ct', 'ct.node_id', 'p.content_type_id')
      .select((eb) => eb.fn.count<number>('pv.node_id').distinct().as('n'))
      .where('ct.alias', '=', type)
      .where('ct.workspace_id', 'is', null)
      .where('p.alias', '=', property)
      .where('pv.workspace_id', 'is', null)
      .where('pv.is_current', '=', handle.dialect.boolValue(true) as boolean)
      .execute()
    return Number(rows[0]?.n ?? 0)
  }

  /** Writes the workspace's rows from its files, as a sync of its own. */
  async function build(workspace: WorkspaceScope, handle: Db = db): Promise<void> {
    const files = unprefixed(
      await new WorkspaceFileRepository(handle).files(workspace.id, WORKSPACE_SCHEMA_PREFIX),
    )
    const report = await syncSchema(
      handle,
      loaded(files),
      { nodeId: boot.nodeId, version: boot.nodeState.version, revision: boot.nodeState.revision },
      {
        ...syncOptionsFor(config),
        componentAliases: componentAliasesIn(config.componentsDir),
        workspace,
      },
    )
    if (report.action === 'refused')
      throw new Error(`The workspace's definitions cannot be used: ${report.reason ?? ''}`)
    await new WorkspaceRepository(handle).setSchemaBuilt(workspace.id, true)
  }

  /** Writes files where they live, returning how to put them back. */
  function writeOut(entries: ReadonlyArray<[string, string | null]>): () => void {
    const before = new Map<string, string | undefined>()
    for (const [target, text] of entries) {
      before.set(target, existsSync(target) ? readFileSync(target, 'utf8') : undefined)
      if (text === null) rmSync(target, { force: true })
      else {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, text)
      }
    }
    return () => {
      for (const [target, text] of before)
        if (text === undefined) rmSync(target, { force: true })
        else writeFileSync(target, text)
    }
  }

  return {
    sharedFiles,
    shown,

    /** Story 399: every file a workspace copies, as Shared has it now, by its key. */
    copiedNow: (handle: Db = db) => sharedCopied(handle),

    /** A file as Shared has it now, by its full path: a definition's, or any other's. */
    async textNow(key: string): Promise<string | null> {
      // Story 392: Shared's dictionary is rows, read as the workspace's file holds it.
      if (key === WORKSPACE_DICTIONARY) return sharedDictionaryLines(db)
      return sharedText(key, await sharedFiles())
    },

    /** Takes Shared's files as the workspace's copy, as it opens. */
    async snapshot(workspaceId: number): Promise<void> {
      await new WorkspaceFileRepository(db).snapshot(workspaceId, await sharedCopied())
    },

    /** Builds the workspace's rows the first time it changes its schema. */
    async ensureBuilt(workspace: WorkspaceScope): Promise<void> {
      if (await new WorkspaceRepository(db).schemaBuilt(workspace.id)) return
      await build(workspace)
    },

    build,

    /** Carries a file the site reads only as it starts to the merge (story 377). */
    async carry(workspaceId: number, path: string, text: string | null): Promise<boolean> {
      if (!SITE_FILES.test(path)) return false
      const store = new WorkspaceFileRepository(db)
      const key = `site/${path}`
      const known = (await store.changes(workspaceId, key)).find((c) => c.path === key)
      const base = known ? known.base : sharedText(key, new Map())
      await store.rebase(workspaceId, key, base, text)
      return true
    },

    /** Each changed file merged with Shared's now: what would be written, and what conflicts. */
    async plan(workspaceId: number, handle: Db = db): Promise<FileMergePlan> {
      const changes = await new WorkspaceFileRepository(handle).changes(workspaceId)
      const schema = await sharedFiles(handle)
      // Story 392: Shared's dictionary is rows, read as the workspace's file holds it.
      const dictionary = changes.some((c) => c.path === WORKSPACE_DICTIONARY)
        ? await sharedDictionaryLines(handle)
        : null
      const nowOf = (key: string) =>
        key === WORKSPACE_DICTIONARY ? dictionary : sharedText(key, schema)
      const writes: Record<string, string | null> = {}
      const conflicts: FileConflict[] = []
      let change: ChangeClass = 'none'
      for (const c of changes) {
        const now = nowOf(c.path)
        const merged = mergeOf(c.path, c.base, c.now, now)
        const definition = c.path.startsWith(WORKSPACE_SCHEMA_PREFIX)
        if (!merged) {
          conflicts.push({
            path: shown(c.path),
            definition,
            base: c.base,
            mine: c.now,
            theirs: now,
          })
          continue
        }
        if (merged.text !== now) writes[c.path] = merged.text
        if (!definition) continue
        const own = (c.class ?? 'additive') as ChangeClass
        if (RANK[own] > RANK[change]) change = own
      }
      // What each written file's change is, against Shared now, and what a lossy one costs.
      const items: FileMergePlan['items'] = []
      for (const [key, text] of Object.entries(writes))
        for (const found of describeFileChange(shown(key), nowOf(key), text, {
          definition: key.startsWith(WORKSPACE_SCHEMA_PREFIX),
        }))
          items.push(
            found.class === 'breaking' && found.type && found.property
              ? { ...found, pages: await pagesHolding(handle, found.type, found.property) }
              : found,
          )
      const befores: Record<string, string | null> = {}
      for (const key of Object.keys(writes)) befores[key] = nowOf(key)
      const costed = await withLosses(handle, items)
      for (const found of costed)
        if (RANK[found.class as ChangeClass] > RANK[change]) change = found.class as ChangeClass
      return {
        writes,
        conflicts,
        problems: await componentProblems(writes),
        change,
        items: costed,
        befores,
      }
    },

    /**
     * Syncs the merged definitions into Shared on `tx`, the merge's transaction,
     * then writes every merged file where it lives; what it returns puts them back,
     * for when the merge is undone after.
     */
    async apply(
      tx: Db,
      plan: FileMergePlan,
    ): Promise<{ restore(): void; after(): Promise<void>; items: ChangeItemInput[] }> {
      const restores: Array<() => void> = []
      // Each file as the change records it (story 381): its text before and after.
      const items: ChangeItemInput[] = Object.entries(plan.writes).map(([key, text]) => {
        const before = plan.befores[key] ?? null
        const own = describeFileChange(shown(key), before, text, {
          definition: key.startsWith(WORKSPACE_SCHEMA_PREFIX),
        })
        return {
          path: key,
          kind: before === null ? 'file-added' : text === null ? 'file-removed' : 'file-changed',
          class: own.reduce<ChangeClass>((worst, i) => costlier(worst, i.class), 'none'),
          before,
          after: text,
        }
      })
      const definitions = Object.entries(plan.writes).filter(([key]) =>
        key.startsWith(WORKSPACE_SCHEMA_PREFIX),
      )
      let publish = false
      if (definitions.length > 0) {
        const files = await sharedFiles(tx)
        for (const [key, text] of definitions) {
          const path = key.slice(WORKSPACE_SCHEMA_PREFIX.length)
          if (text === null) files.delete(path)
          else files.set(path, text)
        }
        const version = loaded(files).set.version
        const next = nextSchemaVersion(version, plan.change === 'none' ? 'additive' : plan.change)
        files.set(
          'schema.toml',
          writeSchemaVersion(next, loaded(files).set.urls, loaded(files).set.environments),
        )
        // Story 392: the Library's types made from forms follow them, as a sync's do.
        if (definitions.some(([key]) => key.startsWith(`${WORKSPACE_SCHEMA_PREFIX}forms/`)))
          await ensureFormLibraryTypes(tx, loaded(files).set.forms ?? [])
        const report = await syncSchema(
          tx,
          loaded(files),
          { nodeId: boot.nodeId, version: next, revision: config.schemaRevision },
          { ...syncOptionsFor(config), componentAliases: componentAliasesIn(config.componentsDir) },
        )
        if (report.action !== 'applied')
          throw new FileMergeRefused(
            `Shared's definitions would not take the workspace's: ${report.reason ?? report.action}`,
          )
        // This node runs the new state from here, or its own page writes are refused;
        // an undone merge puts it back.
        const was = { version: boot.nodeState.version, revision: boot.nodeState.revision }
        boot.nodeState.version = next
        boot.nodeState.revision = config.schemaRevision
        restores.push(() => {
          boot.nodeState.version = was.version
          boot.nodeState.revision = was.revision
        })
        if (existsSync(config.schemaDir) && config.schemaWritable) {
          restores.push(
            writeOut([
              ...definitions.map(
                ([key, text]) =>
                  [join(config.schemaDir, ...shown(key).split('/')), text] as [
                    string,
                    string | null,
                  ],
              ),
              [join(config.schemaDir, 'schema.toml'), files.get('schema.toml') ?? null],
            ]),
          )
          publish = true
        }
      }
      const others = Object.entries(plan.writes).flatMap(([key, text]) => {
        const area = areaOf(key)
        return area
          ? [
              [join(area.dir, ...key.slice(area.prefix.length).split('/')), text] as [
                string,
                string | null,
              ],
            ]
          : []
      })
      if (others.length > 0) restores.push(writeOut(others))
      // Story 392: the dictionary goes into Shared's rows, with the merge.
      const dictionary = plan.writes[WORKSPACE_DICTIONARY]
      if (typeof dictionary === 'string') await applyDictionaryLines(tx, dictionary)
      const views = Object.keys(plan.writes).some((key) => key.startsWith('components/'))
      return {
        items,
        restore() {
          for (const undo of restores.reverse()) undo()
        },
        async after() {
          if (publish && config.schemaStore)
            await publishSchema(config.schemaStore as SchemaStore, config.schemaDir)
          // Every node, this one included, takes a new generation of the views.
          if (views)
            await appendCacheInstruction(db, {
              kind: 'components',
              payload: { from: 'workspace-merge' },
              by: `${boot.nodeId}:merge`,
            })
        },
      }
    },

    /**
     * Shared's changes since the copy brought into the workspace (story 380's
     * "update from Shared"): each file Shared changed is merged with the
     * workspace's; where the two overlap the workspace keeps its own and the file
     * stays a conflict for its merge to answer. Its rows are built again.
     */
    async updateFromShared(workspace: WorkspaceScope): Promise<{
      updated: string[]
      conflicts: FileConflict[]
    }> {
      const store = new WorkspaceFileRepository(db)
      const theirs = await sharedCopied()
      const all = await store.files(workspace.id)
      if (all.has(WORKSPACE_DICTIONARY))
        theirs.set(WORKSPACE_DICTIONARY, await sharedDictionaryLines(db))
      const own = new Map([...all].filter(([key]) => !key.startsWith('site/')))
      const bases = new Map<string, string | null>()
      for (const c of await store.changes(workspace.id)) bases.set(c.path, c.base)
      const updated: string[] = []
      const conflicts: FileConflict[] = []
      for (const key of new Set([...theirs.keys(), ...own.keys(), ...bases.keys()])) {
        if (key.startsWith('site/')) continue
        const mine = own.get(key) ?? null
        const base = bases.has(key) ? (bases.get(key) ?? null) : mine
        const now = theirs.get(key) ?? null
        if (now === base) continue
        const merged = mergeOf(key, base, mine, now)
        if (!merged) {
          conflicts.push({
            path: shown(key),
            definition: key.startsWith(WORKSPACE_SCHEMA_PREFIX),
            base,
            mine,
            theirs: now,
          })
          continue
        }
        await store.rebase(workspace.id, key, now, merged.text)
        updated.push(shown(key))
      }
      if (
        updated.some((path) => keyFor(path).startsWith(WORKSPACE_SCHEMA_PREFIX)) &&
        (await new WorkspaceRepository(db).schemaBuilt(workspace.id))
      )
        await build(workspace)
      return { updated, conflicts }
    },

    /** Answers a file's conflict: the workspace's, Shared's, or a text written for it. */
    async resolve(
      workspace: WorkspaceScope,
      path: string,
      answer: { side: 'mine' | 'theirs' } | { text: string },
    ): Promise<boolean> {
      const key = keyFor(path)
      const store = new WorkspaceFileRepository(db)
      const theirs =
        key === WORKSPACE_DICTIONARY
          ? await sharedDictionaryLines(db)
          : sharedText(key, await sharedFiles())
      const mine = (await store.files(workspace.id)).get(key) ?? null
      const text = 'text' in answer ? answer.text : answer.side === 'mine' ? mine : theirs
      if ('text' in answer && /^(<{7}|={7}|>{7})/m.test(answer.text)) return false
      await store.rebase(workspace.id, key, theirs, text)
      if (
        key.startsWith(WORKSPACE_SCHEMA_PREFIX) &&
        (await new WorkspaceRepository(db).schemaBuilt(workspace.id))
      )
        await build(workspace)
      return true
    },
  }
}

export type WorkspaceSchema = ReturnType<typeof createWorkspaceSchema>

/** Shared's definitions refused the workspace's: the merge is undone. */
export class FileMergeRefused extends Error {}
