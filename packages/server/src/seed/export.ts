/**
 * Content already in a site, written out as content files (stories 163, 164,
 * 167), so an existing site can keep its content as files. Pages go to
 * `content/pages/`, Library elements to `content/library/`, and media, files and
 * all, to `content/media/`.
 *
 * Values are written in the shorthand `bundle apply` reads back — rich text as
 * `{ html }`, pickers and links as paths to what the export carries, blocks as
 * `{ type, key, values }` — and in their editor's stored shape where there is
 * none. A node keeps its key in its file wherever it is not the one its path
 * would derive, so a round trip names the same nodes.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { mediaFileOf, normaliseUuid, ObjectTypes } from '@crombolo/core'
import {
  currentSchemaState,
  type Db,
  DocumentRepository,
  NodeRepository,
  type NodeRow,
} from '@crombolo/data'
import type { MediaFileStore } from '../media-files.ts'
import { seedKey } from './keys.ts'
import {
  CONTENT_FILES_DIR,
  KIND_DIRS,
  kindDir,
  LIBRARY_FOLDER_FILE,
  nameFromSegment,
  type SeedKind,
} from './read.ts'
import { schemaLookup, shorthandReader } from './values.ts'

/** A URL segment from a name: `About us` → `about-us`. */
export const segmentOf = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item'

/** A media file or folder name as it can sit on disk: never `.` or `..`. */
const fileName = (name: string) => {
  const safe = name.replace(/[/\\:*?"<>|]+/g, '-').trim()
  return !safe || /^\.+$/.test(safe) ? 'item' : safe
}

const bareKey = (key: string) => (/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key))

/** A value as TOML, inline. Nulls are left out: TOML has none. */
export function tomlValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value))
    return `[${value
      .map(tomlValue)
      .filter((v) => v !== undefined)
      .join(', ')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
      const written = tomlValue(v)
      return written === undefined ? [] : [`${bareKey(k)} = ${written}`]
    })
    return `{ ${entries.join(', ')} }`
  }
  return JSON.stringify(String(value))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** What a media item's own properties are, which its file stands for in a seed. */
const FILE_PROPERTIES = new Set([
  'umbracoFile',
  'umbracoWidth',
  'umbracoHeight',
  'umbracoBytes',
  'umbracoExtension',
])

export interface SeedExportOptions {
  /** The pages to export, each with every page below it. */
  pages: readonly NodeRow[]
  /** Every Library element too. */
  library?: boolean
  /** Every media item too, with its file. */
  media?: boolean
  /** Where media files are read from; media is exported without files when absent. */
  files?: MediaFileStore
}

export interface SeedExportResult {
  written: string[]
}

export async function exportSeed(
  db: Db,
  siteDir: string,
  options: SeedExportOptions,
): Promise<SeedExportResult> {
  const state = await currentSchemaState(db)
  const nodeState = { version: state.version, revision: state.revision }
  const repos = {
    content: new DocumentRepository(db, { nodeState }),
    library: new DocumentRepository(db, { nodeState, kind: 'element' }),
    media: new DocumentRepository(db, { nodeState, kind: 'media' }),
  }
  const nodes = new NodeRepository(db)

  const typeAliases = new Map<string, string>()
  const aliasOf = async (typeKey: string) => {
    const key = normaliseUuid(typeKey)
    if (!typeAliases.has(key)) {
      const rows = await db.q
        .selectFrom('node as n')
        .innerJoin('content_type as ct', 'ct.node_id', 'n.id')
        .select('ct.alias')
        .where('n.unique_id', '=', key)
        .execute()
      typeAliases.set(key, rows[0] ? String(rows[0].alias) : typeKey)
    }
    return typeAliases.get(key) as string
  }
  const lookup = schemaLookup(db)
  const editorsOf = async (typeKey: string, media = false) =>
    new Map(
      [
        ...(await lookup.editorsOf(media ? 'media' : 'document', { key: normaliseUuid(typeKey) })),
      ].map(([alias, p]) => [alias, p.editor]),
    )

  // --------------------------------------------------- every node's place
  type Kind = 'content' | 'library' | 'media'
  type Entry = { kind: Kind; node: NodeRow; path: string; order: number }
  const entries: Entry[] = []
  const pathOf = new Map<string, { kind: Kind; path: string }>()
  const taken = new Set<string>()
  const place = (kind: Kind, node: NodeRow, parent: string | null, order: number, base: string) => {
    const dot = kind === 'media' ? base.lastIndexOf('.') : -1
    let name = base
    for (let n = 2; taken.has(`${kind}/${parent ? `${parent}/` : ''}${name}`); n++)
      name = dot > 0 ? `${base.slice(0, dot)}-${n}${base.slice(dot)}` : `${base}-${n}`
    const path = parent ? `${parent}/${name}` : name
    taken.add(`${kind}/${path}`)
    pathOf.set(normaliseUuid(node.key), { kind, path })
    entries.push({ kind, node, path, order })
    return path
  }
  const walkPages = async (node: NodeRow, parent: string | null, order: number) => {
    const path = place('content', node, parent, order, segmentOf(node.text ?? node.key))
    const children = await nodes.children(node.id, ObjectTypes.Document, 0, Number.MAX_SAFE_INTEGER)
    for (const [index, child] of children.items.entries()) await walkPages(child, path, index)
  }
  for (const [index, root] of options.pages.entries()) await walkPages(root, null, index)

  /** Library folders, which are directories rather than files (story 242). */
  const libraryFolders = new Set<string>()
  if (options.library) {
    const walkLibrary = async (parentId: number, parent: string | null) => {
      const folders = await nodes.children(
        parentId,
        ObjectTypes.ElementContainer,
        0,
        Number.MAX_SAFE_INTEGER,
      )
      for (const [index, folder] of folders.items.entries()) {
        libraryFolders.add(folder.key)
        const path = place('library', folder, parent, index, segmentOf(folder.text ?? folder.key))
        await walkLibrary(folder.id, path)
      }
      const elements = await nodes.children(
        parentId,
        ObjectTypes.Element,
        0,
        Number.MAX_SAFE_INTEGER,
      )
      for (const [index, element] of elements.items.entries())
        place('library', element, parent, index, segmentOf(element.text ?? element.key))
    }
    await walkLibrary(-1, null)
  }

  const mediaFile = new Map<string, string>()
  if (options.media) {
    const walkMedia = async (parentId: number, parent: string | null) => {
      const children = await nodes.children(parentId, ObjectTypes.Media, 0, Number.MAX_SAFE_INTEGER)
      for (const [index, child] of children.items.entries()) {
        const item = await repos.media.byKey(child.key)
        const src = item ? mediaFileOf(item) : null
        if (src) mediaFile.set(child.key, src)
        const base = src
          ? fileName(src.split('/').at(-1) as string)
          : fileName(child.text ?? child.key)
        const path = place('media', child, parent, index, base)
        if (!src) await walkMedia(child.id, path)
      }
    }
    await walkMedia(-1, null)
  }

  const where = (key: string, kind: Kind) => {
    const found = pathOf.get(normaliseUuid(key))
    return found && found.kind === kind ? found.path : undefined
  }

  // -------------------------------------------------- values, as shorthand
  const { shorthand } = shorthandReader(lookup, aliasOf, where)

  // --------------------------------------------------------- the files
  const written: string[] = []
  const seedRoot = resolve(siteDir, CONTENT_FILES_DIR)
  // `<kind>/<path>` to its file: pages under `content/pages`, and so on.
  const placed = (relative: string) => {
    const [kind, ...rest] = relative.split('/')
    return `${KIND_DIRS[kind as SeedKind] ?? kind}/${rest.join('/')}`
  }
  const under = (relative: string) => {
    const file = resolve(seedRoot, placed(relative))
    if (!file.startsWith(seedRoot + sep))
      throw new Error(`Refusing to write ${relative} outside the content files.`)
    return file
  }
  const write = (relative: string, text: string) => {
    const file = under(relative)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, text)
    written.push(`${CONTENT_FILES_DIR}/${placed(relative)}`)
  }
  const valueLines = async (
    values: ReadonlyArray<{
      alias: string
      culture: string | null
      segment: string | null
      value: unknown
    }>,
    editors: ReadonlyMap<string, string>,
  ) => {
    const byCulture = new Map<string | null, string[]>()
    for (const v of values) {
      if (v.segment !== null) continue
      const value = await shorthand(editors.get(v.alias) ?? '', v.value)
      const text = tomlValue(value)
      if (text === undefined) continue
      const list = byCulture.get(v.culture) ?? []
      // A long list reads better an item to a line; TOML allows that for arrays.
      list.push(
        Array.isArray(value) && text.length > 100
          ? `${bareKey(v.alias)} = [\n${value
              .map(tomlValue)
              .filter((item) => item !== undefined)
              .map((item) => `  ${item},`)
              .join('\n')}\n]`
          : `${bareKey(v.alias)} = ${text}`,
      )
      byCulture.set(v.culture, list)
    }
    const lines: string[] = []
    for (const [culture, list] of byCulture)
      lines.push('', culture ? `[values.${bareKey(culture)}]` : '[values]', ...list)
    return lines
  }

  for (const { kind, node, path, order } of entries) {
    const derived = seedKey(`${kind}/${path}`)
    if (kind === 'library' && libraryFolders.has(node.key)) {
      // A folder is its directory; `.folder.toml` only for what the directory can't say.
      mkdirSync(under(`library/${path}`), { recursive: true })
      const own: string[] = []
      if (normaliseUuid(node.key) !== derived) own.push(`key = ${JSON.stringify(node.key)}`)
      const segment = path.split('/').at(-1) as string
      if ((node.text ?? '') !== nameFromSegment(segment))
        own.push(`name = ${JSON.stringify(node.text ?? '')}`)
      if (own.length > 0) write(`library/${path}/${LIBRARY_FOLDER_FILE}`, `${own.join('\n')}\n`)
      continue
    }
    const doc = await repos[kind].byKey(node.key)
    const lines: string[] = []
    if (kind === 'media') {
      const src = mediaFile.get(node.key)
      if (!src) {
        // A folder: its directory says it, unless it has a name or key of its own.
        mkdirSync(under(`media/${path}`), { recursive: true })
        continue
      }
      const stored = options.files ? await options.files.open(src) : undefined
      if (stored) {
        const file = under(`media/${path}`)
        mkdirSync(join(file, '..'), { recursive: true })
        writeFileSync(file, await stored.bytes())
        written.push(`${kindDir('media')}/${path}`)
      }
      // A sidecar only for what the file cannot say.
      if (normaliseUuid(node.key) !== derived) lines.push(`key = ${JSON.stringify(node.key)}`)
      lines.push(`order = ${order}`)
      const name = doc?.variants[0]?.name
      if (name && name !== path.split('/').at(-1)) lines.push(`name = ${JSON.stringify(name)}`)
      const file = doc?.values.find((v) => v.alias === 'umbracoFile')?.value
      if (isRecord(file) && isRecord(file.focalPoint))
        lines.push(`focalPoint = ${tomlValue(file.focalPoint)}`)
      if (doc) {
        const editors = await editorsOf(doc.contentTypeKey, true)
        lines.push(
          ...(await valueLines(
            doc.values.filter((v) => !FILE_PROPERTIES.has(v.alias)),
            editors,
          )),
        )
      }
      if (lines.length > 0) write(`media/${path}.toml`, `${lines.join('\n')}\n`)
      continue
    }

    if (!doc) continue
    lines.push(`type = ${JSON.stringify(await aliasOf(doc.contentTypeKey))}`)
    if (normaliseUuid(node.key) !== derived) lines.push(`key = ${JSON.stringify(node.key)}`)
    const invariant = doc.variants.find((v) => v.culture === null)
    if (invariant) lines.push(`name = ${JSON.stringify(invariant.name)}`)
    else
      lines.push(
        `name = ${tomlValue(Object.fromEntries(doc.variants.map((v) => [v.culture as string, v.name])))}`,
      )
    lines.push(`order = ${order}`)
    if (!doc.variants.some((v) => v.state === 'Published' || v.state === 'PublishedPendingChanges'))
      lines.push('published = false')
    lines.push(...(await valueLines(doc.values, await editorsOf(doc.contentTypeKey))))
    write(`${kind}/${path}.toml`, `${lines.join('\n')}\n`)
  }
  return { written }
}
