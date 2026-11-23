/**
 * A direct edit of the site's definitions or files, recorded as a change by its
 * author (story 381). A type or data type is recorded as its file, exported as
 * the schema writes it, before and after the save; a component, stylesheet or
 * script as its text. A person's edits gather in one change until ten minutes
 * pass with none.
 */
import type { FileResult, FileSystemPort } from '@crombolo/api-management/domain'
import { type ChangeClass, costlier } from '@crombolo/core'
import { ChangeRepository, type Db } from '@crombolo/data'
import {
  describeFileChange,
  exportSchemaSet,
  fileNameFor,
  type SchemaTypeKind,
  TYPE_KIND_FILES,
  writeContentType,
  writeDataType,
} from '@crombolo/schema'
import { noteFileWritten } from '../workspace-conflicts.ts'

/** The class a file's change costs, by its items. */
const classOf = (path: string, before: string | null, after: string | null, definition: boolean) =>
  describeFileChange(path, before, after, { definition }).reduce<ChangeClass>(
    (worst, i) => costlier(worst, i.class),
    'none',
  )

/** The class one file's change costs, by its key: a definition under `schema/`, or any file. */
export const fileClass = (path: string, before: string | null, after: string | null) => {
  const definition = path.startsWith('schema/')
  return classOf(definition ? path.slice('schema/'.length) : path, before, after, definition)
}

/** Records one file's direct edit, when someone made it and it changed. */
export async function recordEdit(
  db: Db,
  by: string | undefined,
  path: string,
  before: string | null,
  after: string | null,
): Promise<void> {
  if (!by || before === after) return
  noteFileWritten(path, by)
  const definition = path.startsWith('schema/')
  await new ChangeRepository(db).recordEdit(by, {
    path,
    kind: before === null ? 'file-added' : after === null ? 'file-removed' : 'file-changed',
    class: classOf(definition ? path.slice('schema/'.length) : path, before, after, definition),
    before,
    after,
  })
}

/** A type's file as the schema writes it, from the database: its text, or null when there is none. */
export async function typeFile(
  db: Db,
  kind: SchemaTypeKind,
  key: string,
): Promise<{ path: string; text: string } | undefined> {
  const set = await exportSchemaSet(db, '1.0.0')
  const list =
    kind === 'document'
      ? set.contentTypes
      : kind === 'media'
        ? (set.mediaTypes ?? [])
        : (set.memberTypes ?? [])
  const type = list.find((t) => t.key?.toLowerCase() === key.toLowerCase())
  return type
    ? {
        path: `schema/${TYPE_KIND_FILES[kind].dir}/${fileNameFor(type.alias)}`,
        text: writeContentType(type, kind),
      }
    : undefined
}

/** A data type's file, likewise. */
export async function dataTypeFile(
  db: Db,
  key: string,
): Promise<{ path: string; text: string } | undefined> {
  const found = (await exportSchemaSet(db, '1.0.0')).dataTypes.find(
    (d) => d.key?.toLowerCase() === key.toLowerCase(),
  )
  return found
    ? { path: `schema/data-types/${fileNameFor(found.alias)}`, text: writeDataType(found) }
    : undefined
}

/** A file area's port, each direct write recorded as its author's change. */
export function recordingFilePort(db: Db, prefix: string, port: FileSystemPort): FileSystemPort {
  const textOf = async (path: string) => (await port.read(path))?.content ?? null
  const keyOf = (path: string) => `${prefix}${path.replace(/^\/+/, '')}`
  const recorded = async (
    by: string | undefined,
    path: string,
    before: string | null,
    run: () => Promise<FileResult>,
    after: (result: FileResult & { ok: true }) => Promise<[string, string | null][]>,
  ) => {
    const result = await run()
    if (!result.ok || !by) return result
    for (const [at, text] of await after(result))
      await recordEdit(db, by, keyOf(at), at === path ? before : null, text)
    return result
  }
  return {
    ...port,
    async create(parentPath, name, content, by) {
      return recorded(
        by,
        '',
        null,
        () => port.create(parentPath, name, content, by),
        async (r) => [[r.path, await textOf(r.path)]],
      )
    },
    async update(path, content, by) {
      const before = by ? await textOf(path) : null
      return recorded(
        by,
        path,
        before,
        () => port.update(path, content, by),
        async (r) => [[r.path, await textOf(r.path)]],
      )
    },
    async rename(path, name, by) {
      const before = by ? await textOf(path) : null
      const result = await port.rename(path, name, by)
      if (result.ok && by && result.path !== path) {
        await recordEdit(db, by, keyOf(path), before, null)
        await recordEdit(db, by, keyOf(result.path), null, await textOf(result.path))
      }
      return result
    },
    async delete(path, by) {
      const before = by ? await textOf(path) : null
      return recorded(
        by,
        path,
        before,
        () => port.delete(path, by),
        async () => [[path, null]],
      )
    },
  }
}
