/**
 * Story 392: the form and workflow designers in a workspace. Their routes read and
 * write `schema/` as files, so in a workspace they are given a folder holding the
 * workspace's copy; what a request changes there becomes the workspace's files, for
 * its merge. In Shared, what it changes is recorded as the person's. docs/workspaces.md.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { type Db, WorkspaceFileRepository } from '@crombolo/data'
import { recordEdit } from './adapters/change-recording.ts'
import { WORKSPACE_SCHEMA_PREFIX } from './adapters/schema-files.ts'
import { currentWorkspace } from './workspaces.ts'

/** Where a route reads and writes `schema/`, and whether that is a workspace's. */
export interface SchemaPlace {
  schemaDir: string
  writable: boolean
  /** The workspace's copy, not Shared's: nothing is synced or published from it. */
  inWorkspace: boolean
}

const filesUnder = (dir: string): Map<string, string> => {
  const out = new Map<string, string>()
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.set(relative(dir, path).split(sep).join('/'), readFileSync(path, 'utf8'))
    }
  }
  walk(dir)
  return out
}

/**
 * Runs `run` against the workspace the request is held in (story 375's scope has
 * already been entered), or against Shared's `schema/` where there is none.
 */
export async function inSchemaPlace(
  db: Db,
  shared: Omit<SchemaPlace, 'inWorkspace'>,
  request: Request,
  run: (place: SchemaPlace) => Promise<Response>,
  /** Who asks: a change to Shared's files is recorded as theirs (story 392). */
  by?: string,
): Promise<Response> {
  const workspace = currentWorkspace()
  if (!workspace) {
    const place = { ...shared, inWorkspace: false }
    if (request.method === 'GET' || !by || !existsSync(shared.schemaDir)) return run(place)
    const before = filesUnder(shared.schemaDir)
    const response = await run(place)
    if (!response.ok) return response
    const after = filesUnder(shared.schemaDir)
    for (const path of new Set([...before.keys(), ...after.keys()]))
      await recordEdit(
        db,
        by,
        `${WORKSPACE_SCHEMA_PREFIX}${path}`,
        before.get(path) ?? null,
        after.get(path) ?? null,
      )
    return response
  }
  const store = new WorkspaceFileRepository(db)
  const before = new Map(
    [...(await store.files(workspace.id, WORKSPACE_SCHEMA_PREFIX))].map(([key, text]) => [
      key.slice(WORKSPACE_SCHEMA_PREFIX.length),
      text,
    ]),
  )
  const dir = mkdtempSync(join(tmpdir(), 'crombolo-workspace-designer-'))
  try {
    for (const [path, text] of before) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
    const response = await run({ schemaDir: dir, writable: true, inWorkspace: true })
    if (request.method === 'GET' || !response.ok) return response
    const after = filesUnder(dir)
    for (const [path, text] of after)
      if (before.get(path) !== text)
        await store.write(workspace.id, `${WORKSPACE_SCHEMA_PREFIX}${path}`, text, 'additive')
    for (const path of before.keys())
      if (!after.has(path))
        await store.write(workspace.id, `${WORKSPACE_SCHEMA_PREFIX}${path}`, null, 'breaking')
    return response
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
