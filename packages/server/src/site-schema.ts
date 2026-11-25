/**
 * The schema a whole-site file carries where the site has no schema files (story 427):
 * written out of its database, and given to the site too, so its files and its database
 * agree from then on. docs/content-transfer.md.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  currentSchemaState,
  type Db,
  Locks,
  readWorkflows,
  updateSchemaStateHash,
} from '@crombolo/data'
import {
  exportSchemaSet,
  fileNameFor,
  hashSchemaSet,
  loadSchemaDirectory,
  type SchemaSet,
  schemaSetFiles,
  writeWorkflow,
} from '@crombolo/schema'
import { BUNDLE_SECTIONS, type BundleFile } from '@crombolo/transfer'
import type { CromboloConfig } from './config.ts'
import { formTypesFor } from './form-types.ts'
import { publishSchema } from './schema-store.ts'

export interface SchemaGiven {
  /** Whether the site now has these files too. */
  given: boolean
  /** Why it has not. */
  why?: string
}

/** Whether a site's files hold any definition: a `schema.toml` alone names a version of nothing. */
export const holdsDefinitions = (files: readonly BundleFile[]): boolean =>
  files.some(
    (file) =>
      file.path.startsWith(`${BUNDLE_SECTIONS.schema}/`) &&
      file.path !== `${BUNDLE_SECTIONS.schema}/schema.toml`,
  )

const holdsTypes = (set: SchemaSet) =>
  set.contentTypes.length +
    (set.mediaTypes ?? []).length +
    set.dataTypes.length +
    (set.memberTypes ?? []).filter((t) => t.alias !== 'Member').length +
    (set.workflows ?? []).length >
  0

/** The database's schema as files, by path within the schema folder; undefined when it has none. */
export async function schemaOfDatabase(db: Db): Promise<Map<string, string> | undefined> {
  const { version } = await currentSchemaState(db)
  const workflows = (await readWorkflows(db)).map((stored) => stored.workflow)
  const set: SchemaSet = {
    ...(await exportSchemaSet(db, version)),
    ...(workflows.length > 0 ? { workflows } : {}),
  }
  if (!holdsTypes(set)) return undefined
  const files = schemaSetFiles(set)
  for (const workflow of workflows)
    files.set(`workflows/${fileNameFor(workflow.alias)}`, writeWorkflow(workflow))
  return files
}

export const schemaBundleFiles = (files: ReadonlyMap<string, string>): BundleFile[] =>
  [...files].map(([path, text]) => ({ path: `${BUNDLE_SECTIONS.schema}/${path}`, text }))

/**
 * Writes the files into the site's schema folder and its store, and marks the database
 * as synced from them, so a node that starts from them applies nothing. Not where they
 * would not last, nor where the site's own files look to be kept somewhere this node
 * does not see: marking the database then would stop the nodes that have them.
 */
export async function giveSchemaFiles(
  db: Db,
  config: Pick<
    CromboloConfig,
    'schemaDir' | 'schemaStore' | 'schemaCacheDir' | 'schemaWritable' | 'componentsDir' | 'siteDir'
  > &
    Parameters<typeof formTypesFor>[0],
  files: ReadonlyMap<string, string>,
): Promise<SchemaGiven> {
  if (!config.schemaWritable) return { given: false, why: 'its schema cannot be written from here' }
  try {
    if (config.schemaStore && (await config.schemaStore.list()).length > 0)
      return { given: false, why: 'its schema store holds files this export did not read' }
  } catch (error) {
    return { given: false, why: `its schema store could not be read: ${reason(error)}` }
  }
  const dir = config.schemaStore ? config.schemaCacheDir : config.schemaDir
  const wrote: string[] = []
  try {
    return await db.locks.withLock(Locks.Schema, () =>
      db.transaction(async (tx) => {
        const current = await currentSchemaState(tx)
        for (const [path, text] of files) {
          const file = join(dir, ...path.split('/'))
          if (!existsSync(file)) wrote.push(file)
          mkdirSync(dirname(file), { recursive: true })
          writeFileSync(file, text)
        }
        const loaded = loadSchemaDirectory(dir, { formTypes: formTypesFor(config) })
        if (loaded.problems.length > 0)
          throw new Error(loaded.problems.map((p) => p.message).join('; '))
        const hash = hashSchemaSet(loaded.set)
        const empty = hashSchemaSet({
          version: current.version,
          contentTypes: [],
          dataTypes: [],
          languages: [],
        })
        const unsynced = current.hash === null || current.hash === empty
        if (!config.schemaStore && !unsynced && current.hash !== hash)
          throw new Error('its database was last synced from schema files this node does not have')
        if (current.hash !== hash) await updateSchemaStateHash(tx, current.id, hash)
        if (config.schemaStore) await publishSchema(config.schemaStore, dir)
        return { given: true }
      }),
    )
  } catch (error) {
    for (const file of wrote) rmSync(file, { force: true })
    // A store left part-written holds nothing it did before: it was empty.
    if (config.schemaStore) await publishSchema(config.schemaStore, dir).catch(() => {})
    return { given: false, why: reason(error) }
  }
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
