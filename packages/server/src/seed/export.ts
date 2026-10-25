/**
 * Content already in a site, written out as seed files (stories 163, 164), so
 * an existing site can move to seeds. Pages go to `seed/content/`, Library
 * elements to `seed/library/`, and media, files and all, to `seed/media/`.
 *
 * Values are written in the shorthand `seed apply` reads back — rich text as
 * `{ html }`, pickers and links as paths to what the export carries, blocks as
 * `{ type, key, values }` — and in their editor's stored shape where there is
 * none. A node keeps its key in its file wherever it is not the one its path
 * would derive, so a round trip names the same nodes.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaFileOf, normaliseUuid, ObjectTypes } from '@crombolo/core'
import {
  ContentTypeRepository,
  currentSchemaState,
  DataTypeRepository,
  type Db,
  DocumentRepository,
  NodeRepository,
  type NodeRow,
} from '@crombolo/data'
import type { MediaFileStore } from '../media-files.ts'
import { pickKey, seedKey } from './keys.ts'

/** A URL segment from a name: `About us` → `about-us`. */
export const segmentOf = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item'

/** A media file or folder name as it can sit on disk. */
const fileName = (name: string) => name.replace(/[/\\:*?"<>|]+/g, '-').trim() || 'item'

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

const PICKER = /^umb:\/\/document\/([0-9a-f]{32})$/i
const dashed = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`

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
  const documentTypes = new ContentTypeRepository(db)
  const mediaTypes = new ContentTypeRepository(db, { kind: 'media' })
  const dataTypes = new DataTypeRepository(db)

  const typeAliases = new Map<string, string>()
  const aliasOf = async (typeKey: string) => {
    const key = normaliseUuid(typeKey)
    if (!typeAliases.has(key)) {
      const rows = await db.query<{ alias: string }>(
        'SELECT ct.alias FROM node n JOIN content_type ct ON ct.node_id = n.id WHERE n.unique_id = ?',
        [key],
      )
      typeAliases.set(key, rows[0] ? String(rows[0].alias) : typeKey)
    }
    return typeAliases.get(key) as string
  }
  const editorCache = new Map<string, Map<string, string>>()
  const editorsOf = async (typeKey: string, media = false) => {
    const key = normaliseUuid(typeKey)
    const cached = editorCache.get(key)
    if (cached) return cached
    const properties = await (media ? mediaTypes : documentTypes).resolveProperties(key)
    const byType = new Map(
      (await dataTypes.byKeys(properties.map((p) => p.dataTypeKey))).map((d) => [
        d.key,
        d.editorAlias,
      ]),
    )
    const out = new Map<string, string>()
    for (const property of properties) {
      const editor = byType.get(property.dataTypeKey)
      if (editor) out.set(property.alias, editor)
    }
    editorCache.set(key, out)
    return out
  }

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

  if (options.library) {
    const roots = await nodes.children(-1, ObjectTypes.Element, 0, Number.MAX_SAFE_INTEGER)
    for (const [index, element] of roots.items.entries())
      place('library', element, null, index, segmentOf(element.text ?? element.key))
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
  const shorthand = async (editor: string, value: unknown): Promise<unknown> => {
    switch (editor) {
      case 'Umbraco.RichText':
      case 'Umbraco.TinyMCE':
        return isRecord(value) && typeof value.markup === 'string' && value.blocks == null
          ? { html: value.markup }
          : value
      case 'Umbraco.ContentPicker': {
        const picked = typeof value === 'string' ? PICKER.exec(value) : null
        if (!picked) return value
        const key = dashed((picked[1] as string).toLowerCase())
        const path = where(key, 'content')
        return path ? `/${path}` : key
      }
      case 'Umbraco.MediaPicker3': {
        if (!Array.isArray(value)) return value
        const paths = value.map((pick) =>
          isRecord(pick) &&
          typeof pick.mediaKey === 'string' &&
          pick.key === pickKey(pick.mediaKey) &&
          Array.isArray(pick.crops) &&
          pick.crops.length === 0 &&
          pick.focalPoint == null
            ? where(pick.mediaKey, 'media')
            : undefined,
        )
        if (paths.length === 0 || paths.some((p) => p === undefined)) return value
        const full = paths.map((p) => `/${p}`)
        return full.length === 1 ? full[0] : full
      }
      case 'Umbraco.ElementPicker': {
        if (!Array.isArray(value)) return value
        const paths = value.map((key) =>
          typeof key === 'string' ? where(key, 'library') : undefined,
        )
        if (paths.length === 0 || paths.some((p) => p === undefined)) return value
        return paths.length === 1 ? paths[0] : paths
      }
      case 'Umbraco.MultiUrlPicker': {
        if (!Array.isArray(value)) return value
        return value.map((link) => {
          if (!isRecord(link)) return link
          const target = link.target ?? null
          if (
            link.type === 'document' &&
            typeof link.unique === 'string' &&
            target === null &&
            !link.url &&
            !link.queryString
          ) {
            const path = where(link.unique, 'content')
            if (path && (link.name === '' || link.name == null)) return `/${path}`
            if (path && typeof link.name === 'string') return { path: `/${path}`, name: link.name }
          }
          if (link.type === 'external' && typeof link.url === 'string' && target === null)
            return { url: link.url, name: link.name ?? link.url }
          return link
        })
      }
      case 'Umbraco.BlockList':
      case 'Umbraco.BlockGrid':
        return blocks(editor, value)
      default:
        return value
    }
  }

  /** Blocks as `{ type, key, values, settings }`, when their layout is plain enough to say so. */
  const blocks = async (editor: string, value: unknown): Promise<unknown> => {
    if (!isRecord(value) || !isRecord(value.layout) || !Array.isArray(value.contentData))
      return value
    const layout = value.layout[editor]
    if (!Array.isArray(layout)) return value
    const content = new Map(
      (value.contentData as unknown[]).filter(isRecord).map((d) => [String(d.key), d]),
    )
    const settings = new Map(
      ((value.settingsData as unknown[] | undefined) ?? [])
        .filter(isRecord)
        .map((d) => [String(d.key), d]),
    )
    const out: unknown[] = []
    for (const item of layout) {
      if (!isRecord(item)) return value
      const data = content.get(String(item.contentKey))
      if (!data || typeof data.contentTypeKey !== 'string') return value
      if (editor === 'Umbraco.BlockGrid' && Array.isArray(item.areas) && item.areas.length > 0)
        return value
      const entry: Record<string, unknown> = {
        type: await aliasOf(data.contentTypeKey),
        key: item.contentKey,
        values: await elementValues(data),
      }
      if (typeof item.settingsKey === 'string') {
        const setting = settings.get(item.settingsKey)
        if (!setting || typeof setting.contentTypeKey !== 'string') return value
        entry.settings = {
          type: await aliasOf(setting.contentTypeKey),
          key: item.settingsKey,
          values: await elementValues(setting),
        }
      }
      if (editor === 'Umbraco.BlockGrid') {
        entry.columns = item.columnSpan
        entry.rows = item.rowSpan
      }
      out.push(entry)
    }
    return out
  }

  const elementValues = async (data: Record<string, unknown>) => {
    const editors = await editorsOf(String(data.contentTypeKey))
    const out: Record<string, unknown> = {}
    for (const v of (data.values as unknown[] | undefined) ?? []) {
      if (!isRecord(v) || typeof v.alias !== 'string') continue
      const editor = editors.get(v.alias)
      out[v.alias] = editor ? await shorthand(editor, v.value) : v.value
    }
    return out
  }

  // --------------------------------------------------------- the files
  const written: string[] = []
  const write = (relative: string, text: string) => {
    const file = join(siteDir, 'seed', relative)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, text)
    written.push(`seed/${relative}`)
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
    const doc = await repos[kind].byKey(node.key)
    const derived = seedKey(`${kind}/${path}`)
    const lines: string[] = []
    if (kind === 'media') {
      const src = mediaFile.get(node.key)
      if (!src) {
        // A folder: its directory says it, unless it has a name or key of its own.
        mkdirSync(join(siteDir, 'seed', 'media', path), { recursive: true })
        continue
      }
      const stored = options.files ? await options.files.open(src) : undefined
      if (stored) {
        const file = join(siteDir, 'seed', 'media', path)
        mkdirSync(join(file, '..'), { recursive: true })
        writeFileSync(file, await stored.bytes())
        written.push(`seed/media/${path}`)
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
