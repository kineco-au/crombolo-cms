/**
 * A workspace's components, stylesheets or scripts (story 377), as the Management
 * API sees them with the `Crombolo-Workspace` header: the workspace's own copy,
 * taken from Shared's files as it opened, read and written in its file list.
 * Folders are the paths' own; making or removing one is done in Shared.
 */
import type { FileEntry, FileResult, FileSystemPort } from '@crombolo/api-management/domain'
import { type Db, WorkspaceFileRepository } from '@crombolo/data'

/** The most a workspace keeps of one file. */
export const WORKSPACE_FILE_LIMIT = 1024 * 1024

export interface WorkspaceFileAreaOptions {
  /** Where the area's files sit in the workspace's list: `components/`, `stylesheets/`, `scripts/`. */
  prefix: string
  extension: string
  also?: readonly string[]
  rewrites?: readonly string[]
  /** A component must compile before it is kept. */
  compiles?: boolean
  /** The site keeps these files read-only (story 337): a workspace may not change them either. */
  readOnly?: boolean
}

const INVALID = /[<>:"|?*\\/]/

/** Why a component's source does not compile, or undefined when it does. */
export function compileProblem(source: string): string | undefined {
  try {
    new Bun.Transpiler({ loader: 'tsx' }).transformSync(source)
    return undefined
  } catch (error) {
    const at = (error as { position?: { line?: number; lineText?: string } }).position
    const where = at?.line ? ` on line ${at.line}` : ''
    const text = at?.lineText?.trim()
    return `${(error as Error).message.trim()}${where}${text ? `: ${text}` : ''}`
  }
}

export function createWorkspaceFilePort(
  db: Db,
  workspaceId: number,
  options: WorkspaceFileAreaOptions,
): FileSystemPort {
  const store = new WorkspaceFileRepository(db)
  const accepted = [options.extension, ...(options.also ?? [])].map((e) => e.toLowerCase())
  const keyOf = (path: string) => `${options.prefix}${path.replace(/^\/+/, '')}`
  const toPath = (key: string) => `/${key.slice(options.prefix.length)}`
  const files = async () => {
    const all = await store.files(workspaceId, options.prefix)
    return new Map([...all].filter(([key]) => accepted.some((e) => key.toLowerCase().endsWith(e))))
  }
  const folderOf = (path: string) => {
    const parts = path.split('/').filter(Boolean)
    return parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : null
  }
  const nameOf = (name: string): string | 'InvalidName' | 'InvalidFileExtension' => {
    const trimmed = name.trim()
    if (!trimmed || trimmed.startsWith('.') || INVALID.test(trimmed)) return 'InvalidName'
    const lower = trimmed.toLowerCase()
    if (accepted.some((e) => lower.endsWith(e))) return trimmed
    const rewrite = options.rewrites?.find((r) => lower.endsWith(r.toLowerCase()))
    if (rewrite) return `${trimmed.slice(0, -rewrite.length)}${options.extension}`
    return 'InvalidFileExtension'
  }
  const refusedRead: FileResult = { ok: false, status: 'ReadOnly' }
  const checked = (content: string): FileResult | undefined => {
    if (Buffer.byteLength(content) > WORKSPACE_FILE_LIMIT)
      return { ok: false, status: 'TooLarge', detail: 'A file of up to a megabyte is kept.' }
    const problem = options.compiles ? compileProblem(content) : undefined
    return problem ? { ok: false, status: 'DoesNotCompile', detail: problem } : undefined
  }
  const entriesUnder = async (parentPath: string | null): Promise<FileEntry[]> => {
    const parent = parentPath ? parentPath.replace(/\/+$/, '') : ''
    const out = new Map<string, FileEntry>()
    for (const key of (await files()).keys()) {
      const path = toPath(key)
      if (parent && !path.startsWith(`${parent}/`)) continue
      const rest = path.slice(parent.length + 1).split('/')
      const name = rest[0] as string
      const own = `${parent}/${name}`
      const isFolder = rest.length > 1
      if (!out.has(own))
        out.set(own, {
          path: own,
          name,
          parentPath: parent || null,
          isFolder,
          hasChildren: isFolder,
        })
    }
    return [...out.values()].sort(
      (a, b) =>
        Number(b.isFolder) - Number(a.isFolder) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    )
  }
  return {
    async children(parentPath) {
      return entriesUnder(parentPath)
    },
    async entry(path) {
      const parent = folderOf(path)
      return (await entriesUnder(parent)).find((e) => e.path === `/${path.replace(/^\/+/, '')}`)
    },
    async read(path) {
      const content = (await files()).get(keyOf(path))
      if (content === undefined) return undefined
      const at = `/${path.replace(/^\/+/, '')}`
      return { path: at, name: at.split('/').pop() as string, parentPath: folderOf(at), content }
    },
    async create(parentPath, name, content) {
      if (options.readOnly) return refusedRead
      const stored = nameOf(name)
      if (stored === 'InvalidName' || stored === 'InvalidFileExtension')
        return { ok: false, status: stored }
      const path = `${parentPath ? parentPath.replace(/\/+$/, '') : ''}/${stored}`
      if ((await files()).has(keyOf(path))) return { ok: false, status: 'AlreadyExists' }
      const refused = checked(content)
      if (refused) return refused
      await store.write(workspaceId, keyOf(path), content, 'additive')
      return { ok: true, path }
    },
    async update(path, content) {
      if (options.readOnly) return refusedRead
      if (!(await files()).has(keyOf(path))) return { ok: false, status: 'NotFound' }
      const refused = checked(content)
      if (refused) return refused
      await store.write(workspaceId, keyOf(path), content, 'none')
      return { ok: true, path: `/${path.replace(/^\/+/, '')}` }
    },
    async rename(path, name) {
      if (options.readOnly) return refusedRead
      const all = await files()
      const content = all.get(keyOf(path))
      if (content === undefined) return { ok: false, status: 'NotFound' }
      const stored = nameOf(name)
      if (stored === 'InvalidName' || stored === 'InvalidFileExtension')
        return { ok: false, status: stored }
      const target = `${folderOf(`/${path.replace(/^\/+/, '')}`) ?? ''}/${stored}`
      if (target !== `/${path.replace(/^\/+/, '')}` && all.has(keyOf(target)))
        return { ok: false, status: 'AlreadyExists' }
      await store.write(workspaceId, keyOf(target), content, 'breaking')
      await store.write(workspaceId, keyOf(path), null, 'breaking')
      return { ok: true, path: target }
    },
    async delete(path) {
      if (options.readOnly) return refusedRead
      if (!(await files()).has(keyOf(path))) return { ok: false, status: 'NotFound' }
      await store.write(workspaceId, keyOf(path), null, 'breaking')
      return { ok: true, path: `/${path.replace(/^\/+/, '')}` }
    },
    async createFolder() {
      return { ok: false, status: 'ReadOnly' }
    },
    async deleteFolder() {
      return { ok: false, status: 'ReadOnly' }
    },
  }
}
