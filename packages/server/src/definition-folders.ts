/**
 * Folders for forms and workflows (story 289): real subfolders of `schema/forms/`
 * and `schema/workflows/`, so a folder travels with the code and shows in a diff.
 * Nothing finds a definition by its path, so moving one changes only where its
 * file sits. `docs/forms.md`, "Folders".
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

export type DefinitionKind = 'forms' | 'workflows'

export interface FolderOptions {
  schemaDir: string
  writable: boolean
  /** Publishes the directory to a shared store, when there is one. */
  onChanged?: () => Promise<void>
}

export type FolderResult =
  | { ok: true; path?: string }
  | { ok: false; status: 'readOnly' | 'invalid' | 'notFound' | 'conflict'; message: string }

const READ_ONLY: FolderResult = {
  ok: false,
  status: 'readOnly',
  message: 'Folders cannot be changed on this site.',
}

/** A folder as `a/b`, or undefined when it is no safe path. `''` is the top. Pure. */
export function folderPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const parts = raw.split('/').map((part) => part.trim())
  if (raw.trim() === '') return ''
  const safe = parts.every((part) => /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(part))
  return safe ? parts.join('/') : undefined
}

const rootOf = (schemaDir: string, kind: DefinitionKind) => join(schemaDir, kind)

/** Every folder under the kind's directory, parents first, empty ones included. */
export function foldersIn(schemaDir: string, kind: DefinitionKind): string[] {
  const root = rootOf(schemaDir, kind)
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      out.push(relative(root, path).split(sep).join('/'))
      walk(path)
    }
  }
  walk(root)
  return out.sort((a, b) => a.localeCompare(b))
}

/** The folder a definition's file sits in, `''` at the top. */
export const folderOf = (schemaDir: string, kind: DefinitionKind, file: string): string => {
  const folder = relative(rootOf(schemaDir, kind), dirname(file))
  return folder === '' ? '' : folder.split(sep).join('/')
}

async function changed(options: FolderOptions, path?: string): Promise<FolderResult> {
  await options.onChanged?.()
  return path === undefined ? { ok: true } : { ok: true, path }
}

export async function createFolder(
  kind: DefinitionKind,
  raw: unknown,
  options: FolderOptions,
): Promise<FolderResult> {
  if (!options.writable) return READ_ONLY
  const path = folderPath(raw)
  if (!path) return { ok: false, status: 'invalid', message: 'That is not a name for a folder.' }
  const target = join(rootOf(options.schemaDir, kind), path)
  if (existsSync(target))
    return { ok: false, status: 'conflict', message: `There is already a folder ${path}.` }
  mkdirSync(target, { recursive: true })
  return changed(options, path)
}

export async function renameFolder(
  kind: DefinitionKind,
  rawFrom: unknown,
  rawTo: unknown,
  options: FolderOptions,
): Promise<FolderResult> {
  if (!options.writable) return READ_ONLY
  const from = folderPath(rawFrom)
  const to = folderPath(rawTo)
  if (!from || !to)
    return { ok: false, status: 'invalid', message: 'That is not a name for a folder.' }
  const root = rootOf(options.schemaDir, kind)
  if (!existsSync(join(root, from)))
    return { ok: false, status: 'notFound', message: `There is no folder ${from}.` }
  if (to === from || to.startsWith(`${from}/`))
    return { ok: false, status: 'invalid', message: 'A folder cannot go inside itself.' }
  if (existsSync(join(root, to)))
    return { ok: false, status: 'conflict', message: `There is already a folder ${to}.` }
  mkdirSync(dirname(join(root, to)), { recursive: true })
  renameSync(join(root, from), join(root, to))
  return changed(options, to)
}

/** Only an empty folder goes: what is in one is someone's work. */
export async function deleteFolder(
  kind: DefinitionKind,
  raw: unknown,
  options: FolderOptions,
): Promise<FolderResult> {
  if (!options.writable) return READ_ONLY
  const path = folderPath(raw)
  if (!path) return { ok: false, status: 'invalid', message: 'That is not a name for a folder.' }
  const target = join(rootOf(options.schemaDir, kind), path)
  if (!existsSync(target))
    return { ok: false, status: 'notFound', message: `There is no folder ${path}.` }
  if (readdirSync(target).some((name) => !name.startsWith('.')))
    return { ok: false, status: 'conflict', message: `${path} is not empty.` }
  rmdirSync(target)
  return changed(options)
}

/** Moves a definition's file to a folder, which is made if it is not there. */
export async function moveDefinition(
  kind: DefinitionKind,
  file: string | undefined,
  rawFolder: unknown,
  options: FolderOptions,
): Promise<FolderResult> {
  if (!options.writable) return READ_ONLY
  if (!file || !existsSync(file))
    return { ok: false, status: 'notFound', message: 'There is nothing to move.' }
  const folder = folderPath(rawFolder)
  if (folder === undefined)
    return { ok: false, status: 'invalid', message: 'That is not a name for a folder.' }
  const dir = join(rootOf(options.schemaDir, kind), folder)
  const target = join(dir, file.slice(dirname(file).length + 1))
  if (target === file) return { ok: true, path: folder }
  if (existsSync(target))
    return {
      ok: false,
      status: 'conflict',
      message: `${folder} already holds a file of that name.`,
    }
  mkdirSync(dir, { recursive: true })
  renameSync(file, target)
  return changed(options, folder)
}

const STATUS = { readOnly: 403, invalid: 400, notFound: 404, conflict: 409 } as const

/** A folder change as an answer. */
export const folderResponse = (result: FolderResult): Response =>
  result.ok
    ? Response.json(result)
    : Response.json({ ok: false, message: result.message }, { status: STATUS[result.status] })

/**
 * The tree's folder routes, `tree-folders` and `tree-move`, shared by forms and
 * workflows: hyphenated, so no alias can be mistaken for them. Undefined when the
 * request is neither. `file` finds a definition by alias.
 */
export async function folderAction(
  kind: DefinitionKind,
  path: string,
  request: Request,
  options: FolderOptions & { file: (alias: string) => string | undefined },
): Promise<Response | undefined> {
  if (path !== 'tree-folders' && path !== 'tree-move') return undefined
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  if (path === 'tree-move' && request.method === 'POST')
    return folderResponse(
      await moveDefinition(kind, options.file(String(body.alias)), body.folder, options),
    )
  if (path !== 'tree-folders') return undefined
  if (request.method === 'POST') return folderResponse(await createFolder(kind, body.path, options))
  if (request.method === 'PUT')
    return folderResponse(await renameFolder(kind, body.from, body.to, options))
  if (request.method === 'DELETE')
    return folderResponse(await deleteFolder(kind, body.path, options))
  return undefined
}
