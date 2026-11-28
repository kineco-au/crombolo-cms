/**
 * Files in the content tree (story 450): the checks a File's save passes, what
 * answers above one at its address, and its bytes as they are served.
 * docs/rendering.md, "Files in the content tree".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { bodyProblem, nameProblem } from '@crombolo/backoffice-host/file-kinds'
import type { ItemCheck, ItemCheckResult } from '@crombolo/content'
import {
  FILE_BODY_ALIAS,
  FILE_OBJECT_PREFIX,
  type FileKind,
  fileKindOf,
  fileSegment,
  fileTextOf,
  fileUploadOf,
  isFileType,
  markdownToHtml,
  normaliseUuid,
  ObjectTypes,
} from '@crombolo/core'
import type { Db } from '@crombolo/data'
import { type PublishedCache, type PublishedContent, urlSegmentFor } from '@crombolo/render'
import type { MediaFileStore } from './media-files.ts'
import type { MediaStore } from './media-store.ts'
import { isSitePath } from './middleware.ts'
import { isReservedPublicPath } from './site-public.ts'

/** What answers at an address before a File would, and so wins over it. */
export interface FileWinners {
  backOfficePath: string
  /** Whether the site's `public/` folder has a file at the path. */
  isPublic(path: string): boolean
}

/** What answers at `path` above a File, said plainly; undefined when the File does. Pure. */
export function fileWinner(path: string, winners: FileWinners): string | undefined {
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    // Kept as given: it matches no public file either way.
  }
  if (
    !isSitePath(path, winners.backOfficePath) ||
    isReservedPublicPath(path, winners.backOfficePath)
  )
    if (!['/robots.txt', '/sitemap.xml'].includes(path.toLowerCase()))
      return 'the CMS answers there itself'
  if (winners.isPublic(decoded))
    return `the site's public file public${decoded} answers there first`
  return undefined
}

/** The path a File's address names, without any hostname. Pure. */
export const pathOf = (url: string): string =>
  url.startsWith('//') ? url.slice(url.indexOf('/', 2)) || '/' : url

/** A published File that never answers, and what wins at its address. */
export interface UnansweredFile {
  name: string
  path: string
  winner: string
}

/** The published Files something above them always answers in place of. */
export function unansweredFiles(
  files: readonly PublishedContent[],
  winners: FileWinners,
): UnansweredFile[] {
  return files.flatMap((content) => {
    if (!fileKindOf(content.name)) return []
    const path = pathOf(content.url)
    const winner = fileWinner(path, winners)
    return winner ? [{ name: content.name, path, winner }] : []
  })
}

/** What a File's body serves: its bytes and how. */
export interface FileBody {
  kind: FileKind
  bytes: Uint8Array<ArrayBuffer>
}

/** A File's body to serve, read from its value; undefined for a folder or a missing upload. */
export async function fileBodyOf(
  name: string,
  value: unknown,
  store: MediaStore,
): Promise<FileBody | undefined> {
  const kind = fileKindOf(name)
  if (!kind) return undefined
  const upload = fileUploadOf(value)
  if (upload) {
    const stored = await store.get(upload.src)
    return stored ? { kind, bytes: new Uint8Array(await stored.bytes()) } : undefined
  }
  if (!kind.text) return undefined
  return { kind, bytes: new TextEncoder().encode(fileTextOf(value) ?? '') }
}

/** The headers every File carries: its type, `nosniff`, and the sandbox for what could run. Pure. */
export function fileHeaders(kind: FileKind): Record<string, string> {
  return {
    'content-type': kind.contentType,
    'x-content-type-options': 'nosniff',
    ...(kind.sandboxed ? { 'content-security-policy': 'sandbox' } : {}),
  }
}

/** The cookie an editor's choice of how a Markdown File previews is kept in. */
export const MARKDOWN_VIEW_COOKIE = 'crombolo-preview-markdown'

/** Says, on a Markdown File's preview, which view it is, so the preview's switch shows. */
export const MARKDOWN_VIEW_HEADER = 'x-crombolo-markdown'

/**
 * A Markdown File's preview in the view chosen: its source as served, or `rendered`
 * as a page of HTML, sandboxed as an HTML File is. Undefined for any other kind. Pure.
 */
export function markdownPreview(
  body: FileBody,
  view: string | undefined,
): { bytes: FileBody['bytes']; headers: Record<string, string> } | undefined {
  if (body.kind.extension !== '.md') return undefined
  if (view !== 'rendered')
    return {
      bytes: body.bytes,
      headers: { ...fileHeaders(body.kind), [MARKDOWN_VIEW_HEADER]: 'source' },
    }
  const html = markdownToHtml(new TextDecoder().decode(body.bytes)) ?? ''
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1f1d1a}pre,code{font-family:ui-monospace,monospace;background:#f4f1ec;border-radius:4px}pre{padding:.75rem;overflow:auto}code{padding:.1em .3em}pre code{padding:0}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:.3em .6em}img{max-width:100%}blockquote{margin-left:0;padding-left:1rem;border-left:3px solid #ddd;color:#555}</style></head><body>${html}</body></html>`
  const kind = fileKindOf('preview.html') as FileKind
  return {
    bytes: new TextEncoder().encode(page),
    headers: { ...fileHeaders(kind), [MARKDOWN_VIEW_HEADER]: 'rendered' },
  }
}

export interface FileItemCheckOptions {
  db: Db
  cache?: PublishedCache
  mediaFiles: MediaFileStore
  /** What answers above Files, once the server knows; nothing is warned of without it. */
  winners?: () => FileWinners | undefined
}

interface NodeFacts {
  id: number
  key: string
  name: string
  parentId: number
  typeKey: string
}

/** The save-time check of a File: its name, its body, its address (story 450). */
export function createFileItemCheck(options: FileItemCheckOptions) {
  const { db } = options
  const objectTypes = [ObjectTypes.Document, ObjectTypes.WorkspaceDocument]

  const nodeFacts = async (where: { key: string } | { id: number }) => {
    let query = db.q
      .selectFrom('node as n')
      .leftJoin('content as c', 'c.node_id', 'n.id')
      .leftJoin('node as t', 't.id', 'c.content_type_id')
      .select(['n.id', 'n.unique_id', 'n.text', 'n.parent_id', 't.unique_id as type_key'])
    query =
      'key' in where
        ? query.where('n.unique_id', '=', normaliseUuid(where.key))
        : query.where('n.id', '=', where.id)
    const row = (await query.execute())[0]
    return row
      ? ({
          id: Number(row.id),
          key: normaliseUuid(String(row.unique_id)),
          name: String(row.text ?? ''),
          parentId: Number(row.parent_id),
          typeKey: normaliseUuid(String(row.type_key ?? '')),
        } satisfies NodeFacts)
      : undefined
  }

  /** The items beside a File, with the segment each answers at. */
  const siblingsOf = async (parentId: number, self: string) => {
    const rows = await db.q
      .selectFrom('node as n')
      .leftJoin('content as c', 'c.node_id', 'n.id')
      .leftJoin('node as t', 't.id', 'c.content_type_id')
      .select(['n.unique_id', 'n.text', 't.unique_id as type_key'])
      .where('n.parent_id', '=', parentId)
      .where('n.trashed', '=', db.dialect.boolValue(false) as boolean)
      .where('n.node_object_type', 'in', objectTypes)
      .execute()
    return rows
      .filter((row) => normaliseUuid(String(row.unique_id)) !== self)
      .map((row) => {
        const name = String(row.text ?? '')
        return {
          name,
          segment: isFileType(String(row.type_key ?? ''))
            ? fileSegment(name)
            : urlSegmentFor(name, null),
        }
      })
  }

  /** Where a File would answer: below its parent's address, when that is known. */
  const addressOf = async (parent: NodeFacts | undefined, name: string) => {
    if (!parent) return `/${fileSegment(name)}`
    const url = options.cache ? (await options.cache.byKey(parent.key))?.url : undefined
    if (!url || url === '#') return undefined
    const base = pathOf(url).replace(/\/$/, '')
    return `${base}/${fileSegment(name)}`
  }

  return async (item: ItemCheck): Promise<ItemCheckResult | undefined> => {
    if (!isFileType(item.contentTypeKey)) return undefined
    const key = normaliseUuid(item.key)
    let parent: NodeFacts | undefined
    if (item.parentKey === undefined) {
      const self = await nodeFacts({ key })
      parent = self && self.parentId > 0 ? await nodeFacts({ id: self.parentId }) : undefined
    } else if (item.parentKey !== null) parent = await nodeFacts({ key: item.parentKey })

    const named = nameProblem(item.name, parent?.name)
    if (named) return { refused: named }

    const body = item.values.find((v) => v.alias === FILE_BODY_ALIAS && !v.segment)?.value
    const temporaryId = (body as { temporaryFileId?: unknown } | null)?.temporaryFileId
    const temporary =
      typeof temporaryId === 'string' ? await options.mediaFiles.temporary(temporaryId) : undefined
    const problem = bodyProblem(
      item.name,
      body ?? null,
      temporary ? { name: temporary.fileName, size: temporary.size } : undefined,
    )
    if (problem)
      return {
        errors: [
          { alias: FILE_BODY_ALIAS, culture: null, segment: null, messages: [problem.message] },
        ],
      }

    const segment = fileSegment(item.name).toLowerCase()
    const clash = (await siblingsOf(parent?.id ?? -1, key)).find(
      (sibling) => sibling.segment.toLowerCase() === segment,
    )
    const address = await addressOf(parent, item.name)
    if (clash)
      return {
        refused: `"${item.name}" and "${clash.name}" would both answer at ${address ?? `…/${fileSegment(item.name)}`}. Rename one of them.`,
      }
    if (!address) return undefined
    const there = await options.cache?.byRoute(address)
    if (there && normaliseUuid(there.key) !== key)
      return {
        refused: `"${item.name}" and "${there.name}" would both answer at ${address}. Rename one of them.`,
      }
    const winners = options.winners?.()
    const winner = fileKindOf(item.name) && winners ? fileWinner(address, winners) : undefined
    return winner
      ? {
          warnings: [
            `Saved, but this File is never served at ${address}: ${winner}. Rename the File, or move it.`,
          ],
        }
      : undefined
  }
}

const VIEW_FILE = /\.(tsx|ts|jsx|js)$/
const FILE_CALL = /\bfile\(\s*(['"])(\/[^'"\n]*)\1\s*\)/g

/** Every path a view links a File by, `file('/llms.txt')`, with the views naming it. */
export function fileLinksIn(componentsDir: string): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const walk = (dir: string, prefix: string) => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry)
      let directory = false
      try {
        directory = statSync(path).isDirectory()
      } catch {
        continue
      }
      if (directory) {
        if (entry !== 'node_modules' && !entry.startsWith('.')) walk(path, `${prefix}${entry}/`)
        continue
      }
      if (!VIEW_FILE.test(entry)) continue
      let source: string
      try {
        source = readFileSync(path, 'utf8')
      } catch {
        continue
      }
      for (const match of source.matchAll(FILE_CALL)) {
        const linked = match[2] as string
        found.set(linked, [...(found.get(linked) ?? []), `${prefix}${entry}`])
      }
    }
  }
  walk(componentsDir, '')
  return found
}

/**
 * Removes each File upload no version names any more (story 450): one whose
 * version was cleaned up, or whose File was deleted. Answers how many went.
 */
export async function removeUnnamedFileObjects(db: Db, store: MediaStore): Promise<number> {
  let removed = 0
  for (const key of await store.list(FILE_OBJECT_PREFIX)) {
    const named = await db.q
      .selectFrom('property_value')
      .select('id')
      .where((eb) =>
        eb.or([eb('text_value', 'like', `%${key}%`), eb('varchar_value', 'like', `%${key}%`)]),
      )
      .limit(1)
      .execute()
    if (named.length > 0) continue
    await store.delete(key)
    removed += 1
  }
  return removed
}
