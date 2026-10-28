/**
 * Seed files to a bundle (story 163). The items `readSeed` found are checked
 * against the site's own schema, their values written in each property
 * editor's stored shape from the shorthand a person writes, and the result is
 * the bundle format every import already reads. Applying it is `content
 * import`'s job, with its findings, its one transaction and its revert.
 */
import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import {
  type ContentTypeAggregate,
  IMAGE_CROPPER_EDITOR_ALIAS,
  normaliseUuid,
  ObjectTypes,
  SystemNodes,
} from '@crombolo/core'
import {
  ComponentRepository,
  ContentTypeRepository,
  currentSchemaState,
  DataTypeRepository,
  type Db,
  LanguageRepository,
  looksLikeKey,
  NodeRepository,
  resolveNodeRef,
} from '@crombolo/data'
import {
  BUNDLE_FORMAT_VERSION,
  type BundleBlob,
  type BundleFile,
  type BundleKind,
  type BundleNode,
  type BundleValue,
  type ContentSet,
  referenceCandidates,
  writeBundle,
  writeBundlePackage,
} from '@crombolo/transfer'
import { createMediaPort } from '../adapters/media.ts'
import { type CromboloConfig, VERSION } from '../config.ts'
import { blockKey, pickKey, SEED_NAMESPACE, seedKey, uuidV5 } from './keys.ts'
import { lineOf } from './lines.ts'
import { readSeed, type SeedFinding, type SeedItem } from './read.ts'

export interface SeedBuild {
  findings: SeedFinding[]
  /** The bundle, when nothing found stops it being built. */
  set?: ContentSet
  blobs: Map<string, Uint8Array>
  /** The bundle as the npm package `content import` reads. */
  files?: BundleFile[]
  /** How many items of each kind it holds. */
  counts: Record<'content' | 'library' | 'media', number>
}

/** A word for a file name: `about-us` → `About us`. */
const nameFromSegment = (segment: string) => {
  const words = segment.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)

const BLOCK_LAYOUT = {
  'Umbraco.BlockList': 'Umbraco.BlockList',
  'Umbraco.BlockGrid': 'Umbraco.BlockGrid',
} as const

export async function compileSeed(db: Db, config: CromboloConfig): Promise<SeedBuild> {
  const tree = readSeed(config.siteDir)
  const findings: SeedFinding[] = [...tree.findings]
  const counts = { content: 0, library: 0, media: 0 }
  for (const item of tree.items) counts[item.kind] += 1

  const state = await currentSchemaState(db)
  const documentTypes = new ContentTypeRepository(db)
  const mediaTypes = new ContentTypeRepository(db, { kind: 'media' })
  const dataTypes = new DataTypeRepository(db)
  const components = new ComponentRepository(db)
  const nodes = new NodeRepository(db)
  const port = createMediaPort(db, {
    nodeState: { version: state.version, revision: state.revision },
  })
  const languages = new Map(
    (await new LanguageRepository(db).all()).map((l) => [l.isoCode.toLowerCase(), l.isoCode]),
  )

  const find = (item: SeedItem, path: readonly string[], code: string, message: string) =>
    findings.push({
      file: item.file ?? `seed/${item.kind}/${item.path}`,
      line: item.text ? lineOf(item.text, path) : 1,
      code,
      message,
    })

  // ---------------------------------------------------------------- keys
  const keyOf = new Map<SeedItem, string>()
  const byKey = new Map<string, SeedItem>()
  for (const item of tree.items) {
    const given = item.data.key
    let key = seedKey(`${item.kind}/${item.path}`)
    if (given !== undefined) {
      if (typeof given === 'string' && looksLikeKey(given)) key = normaliseUuid(given)
      else find(item, ['key'], 'bad-key', `key "${String(given)}" is not a uuid`)
    }
    const clash = byKey.get(key)
    if (clash)
      find(item, ['key'], 'duplicate-key', `the key ${key} is also ${clash.file ?? clash.path}'s`)
    byKey.set(key, item)
    keyOf.set(item, key)
  }
  const byPath = (kind: SeedItem['kind']) =>
    new Map(tree.items.filter((i) => i.kind === kind).map((i) => [i.path.toLowerCase(), i]))
  const contentByPath = byPath('content')
  const libraryByPath = byPath('library')
  const mediaByPath = byPath('media')

  // ------------------------------------------------------ the site's schema
  const typeCache = new Map<string, ContentTypeAggregate | undefined>()
  const typeOf = async (repo: ContentTypeRepository, alias: string) => {
    const cacheKey = `${repo.objectType}:${alias.toLowerCase()}`
    if (!typeCache.has(cacheKey)) typeCache.set(cacheKey, await repo.byAlias(alias))
    return typeCache.get(cacheKey)
  }
  const editorCache = new Map<string, Map<string, { editor: string; variesByCulture: boolean }>>()
  const editorsOf = async (repo: ContentTypeRepository, type: ContentTypeAggregate) => {
    const cached = editorCache.get(type.key)
    if (cached) return cached
    const properties = await repo.resolveProperties(type.key)
    const editorByType = new Map(
      (await dataTypes.byKeys(properties.map((p) => p.dataTypeKey))).map((d) => [
        d.key,
        d.editorAlias,
      ]),
    )
    const out = new Map<string, { editor: string; variesByCulture: boolean }>()
    for (const property of properties) {
      const editor = editorByType.get(property.dataTypeKey)
      if (editor) out.set(property.alias, { editor, variesByCulture: property.variesByCulture })
    }
    editorCache.set(type.key, out)
    return out
  }

  /** Content on the site the seed does not declare, by path or key, for a reference to point at. */
  const expected = new Map<string, { key: string; objectType: string; name: string; why: string }>()
  const siteNode = async (ref: string, objectType: string, why: string) => {
    const resolved = await resolveNodeRef(db, [objectType], ref)
    if (!resolved.ok || resolved.node.objectType !== objectType) return undefined
    expected.set(resolved.node.key, {
      key: resolved.node.key,
      objectType,
      name: resolved.node.text ?? '',
      why,
    })
    return resolved.node.key
  }
  const trimPath = (ref: string) => ref.replace(/^\/+|\/+$/g, '').toLowerCase()
  const contentKey = async (ref: string, why: string) => {
    const seeded = contentByPath.get(trimPath(ref))
    if (seeded) return keyOf.get(seeded)
    if (looksLikeKey(ref)) return normaliseUuid(ref)
    return siteNode(ref, ObjectTypes.Document, why)
  }
  const mediaRef = async (ref: string, why: string) => {
    const seeded = mediaByPath.get(trimPath(ref))
    if (seeded)
      return { key: keyOf.get(seeded) as string, typeAlias: mediaTypeAlias.get(seeded) ?? 'Image' }
    const key = looksLikeKey(ref) ? normaliseUuid(ref) : await siteNode(ref, ObjectTypes.Media, why)
    if (!key) return undefined
    const rows = await db.query<{ alias: string }>(
      `SELECT ct.alias FROM node n JOIN content c ON c.node_id = n.id
       JOIN content_type ct ON ct.node_id = c.content_type_id WHERE n.unique_id = ?`,
      [key],
    )
    return { key, typeAlias: rows[0] ? String(rows[0].alias) : 'Image' }
  }
  const libraryKey = async (ref: string, why: string) => {
    const seeded = libraryByPath.get(trimPath(ref))
    if (seeded) return keyOf.get(seeded)
    if (looksLikeKey(ref)) return normaliseUuid(ref)
    return siteNode(ref, ObjectTypes.Element, why)
  }

  // ---------------------------------------------------------------- values
  type Converted = { ok: true; value: unknown } | { ok: false; message: string }
  const fail = (message: string): Converted => ({ ok: false, message })

  /** Rich text: Markdown by default, `{ html = … }` as written; links to content paths become local links. */
  const richText = async (raw: unknown, why: string): Promise<Converted> => {
    let html: string
    // HTML is taken exactly as written; only Markdown's links are made local.
    if (isRecord(raw) && typeof raw.html === 'string')
      return { ok: true, value: { markup: raw.html, blocks: null } }
    if (typeof raw === 'string') html = Bun.markdown.html(raw)
    else if (isRecord(raw) && typeof raw.markdown === 'string')
      html = Bun.markdown.html(raw.markdown)
    else if (isRecord(raw) && 'markup' in raw) return { ok: true, value: raw }
    else return fail('rich text is Markdown, or { html = "…" }')
    const links = [...html.matchAll(/href="(\/[^"#?]*)"/g)]
    for (const [whole, path] of links) {
      const key = await contentKey(path as string, why)
      if (key) html = html.replace(whole, `href="/{localLink:${key}}"`)
    }
    return { ok: true, value: { markup: html, blocks: null } }
  }

  const blocks = async (
    editor: keyof typeof BLOCK_LAYOUT,
    raw: unknown,
    owner: string,
    where: string,
  ): Promise<Converted> => {
    if (!Array.isArray(raw)) {
      if (isRecord(raw) && 'layout' in raw) return { ok: true, value: raw }
      return fail('blocks are a list of { type = "<element alias>", values = { … } }')
    }
    const layout: Record<string, unknown>[] = []
    const contentData: unknown[] = []
    const settingsData: unknown[] = []
    for (const [index, entry] of raw.entries()) {
      if (!isRecord(entry) || typeof entry.type !== 'string')
        return fail(`block ${index + 1} has no type`)
      const element = await typeOf(documentTypes, entry.type)
      if (!element?.isElement)
        return fail(`block ${index + 1}: there is no element type "${entry.type}"`)
      const contentKey =
        typeof entry.key === 'string' && looksLikeKey(entry.key)
          ? normaliseUuid(entry.key)
          : blockKey(owner, `${where}/${index}`)
      const values = await elementValues(element, entry.values, owner, `${where}/${index}`)
      if (!values.ok) return fail(`block ${index + 1}: ${values.message}`)
      contentData.push({ key: contentKey, contentTypeKey: element.key, values: values.value })
      const item: Record<string, unknown> = { contentKey }
      if (isRecord(entry.settings)) {
        const settingsType =
          typeof entry.settings.type === 'string'
            ? await typeOf(documentTypes, entry.settings.type)
            : undefined
        if (!settingsType?.isElement)
          return fail(`block ${index + 1}: settings need a type, an element type`)
        const settingsKey =
          typeof entry.settings.key === 'string' && looksLikeKey(entry.settings.key)
            ? normaliseUuid(entry.settings.key)
            : blockKey(owner, `${where}/${index}/settings`)
        const settings = await elementValues(
          settingsType,
          entry.settings.values,
          owner,
          `${where}/${index}/settings`,
        )
        if (!settings.ok) return fail(`block ${index + 1} settings: ${settings.message}`)
        settingsData.push({
          key: settingsKey,
          contentTypeKey: settingsType.key,
          values: settings.value,
        })
        item.settingsKey = settingsKey
      }
      if (editor === 'Umbraco.BlockGrid') {
        item.columnSpan = typeof entry.columns === 'number' ? entry.columns : 12
        item.rowSpan = typeof entry.rows === 'number' ? entry.rows : 1
        item.areas = Array.isArray(entry.areas) ? entry.areas : []
      }
      layout.push(item)
    }
    return {
      ok: true,
      value: { layout: { [BLOCK_LAYOUT[editor]]: layout }, contentData, settingsData },
    }
  }

  const elementValues = async (
    element: ContentTypeAggregate,
    raw: unknown,
    owner: string,
    where: string,
  ): Promise<Converted> => {
    if (raw === undefined) return { ok: true, value: [] }
    if (!isRecord(raw)) return fail('values is a table')
    const editors = await editorsOf(documentTypes, element)
    const out: Array<{ alias: string; value: unknown }> = []
    for (const [alias, value] of Object.entries(raw)) {
      const property = editors.get(alias)
      if (!property) return fail(`"${element.alias}" has no property "${alias}"`)
      const converted = await convert(property.editor, value, owner, `${where}/${alias}`)
      if (!converted.ok) return fail(`${alias}: ${converted.message}`)
      out.push({ alias, value: converted.value })
    }
    return { ok: true, value: out }
  }

  const list = (raw: unknown) => (Array.isArray(raw) ? raw : [raw])

  const convert = async (
    editor: string,
    raw: unknown,
    owner: string,
    where: string,
  ): Promise<Converted> => {
    const why = `named by a value in ${where}`
    switch (editor) {
      case 'Umbraco.TextBox':
      case 'Umbraco.TextArea':
        return typeof raw === 'string' || typeof raw === 'number'
          ? { ok: true, value: String(raw) }
          : fail('a text value is a string')
      case 'Umbraco.RichText':
      case 'Umbraco.TinyMCE':
        return richText(raw, why)
      case 'Umbraco.TrueFalse':
        return typeof raw === 'boolean'
          ? { ok: true, value: raw }
          : fail('a toggle is true or false')
      case 'Umbraco.Integer':
      case 'Umbraco.Decimal':
      case 'Umbraco.Slider':
        return typeof raw === 'number' ? { ok: true, value: raw } : fail('a number is a number')
      case 'Umbraco.DateTime':
      case 'Umbraco.DateTimeWithTimeZone':
        if (raw instanceof Date) return { ok: true, value: raw.toISOString() }
        return typeof raw === 'string' && !Number.isNaN(new Date(raw).getTime())
          ? { ok: true, value: raw }
          : fail('a date is a TOML date or an ISO 8601 string')
      case 'Umbraco.Tags':
        return list(raw).every((tag) => typeof tag === 'string')
          ? { ok: true, value: list(raw) }
          : fail('tags are a list of strings')
      case 'Umbraco.ContentPicker': {
        if (typeof raw !== 'string') return fail('a content picker takes a content path')
        const key = await contentKey(raw, why)
        return key
          ? { ok: true, value: `umb://document/${key.replaceAll('-', '')}` }
          : fail(`"${raw}" is not a page in the seed or on the site`)
      }
      case 'Umbraco.MediaPicker3': {
        if (isRecord(raw) || (Array.isArray(raw) && raw.some(isRecord)))
          return { ok: true, value: raw }
        const picks: unknown[] = []
        for (const ref of list(raw)) {
          if (typeof ref !== 'string') return fail('a media picker takes media paths')
          const media = await mediaRef(ref, why)
          if (!media) return fail(`"${ref}" is not media in the seed or on the site`)
          picks.push({
            key: pickKey(media.key),
            mediaKey: media.key,
            mediaTypeAlias: media.typeAlias,
            crops: [],
            focalPoint: null,
          })
        }
        return { ok: true, value: picks }
      }
      case 'Umbraco.ElementPicker': {
        const keys: string[] = []
        for (const ref of list(raw)) {
          if (typeof ref !== 'string') return fail('an element picker takes Library paths')
          const key = await libraryKey(ref, why)
          if (!key) return fail(`"${ref}" is not a Library element in the seed or on the site`)
          keys.push(key)
        }
        return { ok: true, value: keys }
      }
      case 'Umbraco.MultiUrlPicker': {
        const links: unknown[] = []
        for (const entry of list(raw)) {
          const link = typeof entry === 'string' ? { path: entry } : entry
          if (!isRecord(link))
            return fail('a link is a path, a URL, or { path | url, name, target }')
          // A link as the editor stores it, as `seed export` writes one.
          if ('unique' in link || 'type' in link) {
            links.push(link)
            continue
          }
          const target = typeof link.target === 'string' ? link.target : null
          const url = typeof link.url === 'string' ? link.url : undefined
          const path = typeof link.path === 'string' ? link.path : undefined
          if (path && /^[a-z]+:\/\//i.test(path)) {
            links.push({
              unique: null,
              type: 'external',
              name: link.name ?? path,
              target,
              url: path,
            })
            continue
          }
          if (url) {
            links.push({ unique: null, type: 'external', name: link.name ?? url, target, url })
            continue
          }
          if (!path) return fail('a link needs a path or a url')
          const media = mediaByPath.get(trimPath(path))
          const key = media ? keyOf.get(media) : await contentKey(path, why)
          if (!key) return fail(`"${path}" is not a page or media in the seed or on the site`)
          links.push({
            unique: key,
            type: media ? 'media' : 'document',
            name: typeof link.name === 'string' ? link.name : '',
            target,
          })
        }
        return { ok: true, value: links }
      }
      case 'Umbraco.BlockList':
      case 'Umbraco.BlockGrid':
        return blocks(editor, raw, owner, where)
      default:
        return { ok: true, value: raw }
    }
  }

  // ------------------------------------------------------------- the nodes
  const mediaTypeAlias = new Map<SeedItem, string>()
  const bundleNodes: BundleNode[] = []
  const blobs = new Map<string, Uint8Array>()
  const blobList: BundleBlob[] = []
  const usedTypes = new Map<string, string>()
  const usedComponents = new Set<string>()
  const usedLanguages = new Set<string>()
  const typeOfItem = new Map<SeedItem, ContentTypeAggregate>()

  // Media types first: a content value may pick an item, and names its type.
  const folderType = (await port.folderTypes()).find((t) => t.name === 'Folder')
  for (const item of tree.items.filter((i) => i.kind === 'media')) {
    const alias =
      typeof item.data.type === 'string' ? item.data.type : item.folder ? 'Folder' : undefined
    let type = alias ? await typeOf(mediaTypes, alias) : undefined
    if (!type && !item.folder && !alias) {
      const choices = await port.typesForExtension(extname(item.path))
      const choice = choices.find((c) => c.matched) ?? choices[0]
      type = choice ? await mediaTypes.byKey(choice.key) : undefined
    }
    if (!type && item.folder && folderType) type = await mediaTypes.byKey(folderType.key)
    if (!type) {
      find(
        item,
        ['type'],
        'unknown-type',
        alias
          ? `there is no media type "${alias}"`
          : `no media type takes a ${extname(item.path) || 'file without an extension'}`,
      )
      continue
    }
    typeOfItem.set(item, type)
    mediaTypeAlias.set(item, type.alias)
  }

  const nameOf = (item: SeedItem): Array<{ culture: string | null; name: string }> => {
    const segment = item.path.split('/').at(-1) as string
    const given = item.data.name
    if (typeof given === 'string') return [{ culture: null, name: given }]
    if (isRecord(given))
      return Object.entries(given).flatMap(([culture, name]) => {
        const iso = languages.get(culture.toLowerCase())
        if (!iso) {
          find(
            item,
            ['name', culture],
            'language-missing',
            `there is no language "${culture}" here`,
          )
          return []
        }
        usedLanguages.add(iso)
        return [{ culture: iso, name: String(name) }]
      })
    return [{ culture: null, name: item.kind === 'media' ? segment : nameFromSegment(segment) }]
  }

  for (const item of tree.items) {
    const key = keyOf.get(item) as string
    let type = typeOfItem.get(item)
    if (item.kind !== 'media') {
      if (typeof item.data.type !== 'string') {
        find(item, [], 'no-type', 'an item names its content type: type = "<alias>"')
        continue
      }
      type = await typeOf(documentTypes, item.data.type)
      if (!type) {
        find(item, ['type'], 'unknown-type', `there is no content type "${item.data.type}"`)
        continue
      }
      if (item.kind === 'library' && !type.isElement) {
        find(
          item,
          ['type'],
          'not-an-element',
          `"${type.alias}" is not an element type, so it cannot sit in the Library`,
        )
        continue
      }
      if (item.kind === 'content' && type.isElement) {
        find(
          item,
          ['type'],
          'element-as-page',
          `"${type.alias}" is an element type: put it in seed/library`,
        )
        continue
      }
      typeOfItem.set(item, type)
    }
    if (!type) continue
    usedTypes.set(type.alias, type.key)

    // Where it sits: its parent's type has to allow it, as an editor's would.
    if (item.kind !== 'library') {
      const parentItem = item.parent
        ? (item.kind === 'media' ? mediaByPath : contentByPath).get(item.parent.toLowerCase())
        : undefined
      const parentType = parentItem ? typeOfItem.get(parentItem) : undefined
      const allowed = parentItem
        ? (parentType?.allowedContentTypes.some(
            (a) => normaliseUuid(a.contentTypeKey) === normaliseUuid(type.key),
          ) ?? true)
        : type.allowedAsRoot
      if (!allowed)
        find(
          item,
          ['type'],
          'not-allowed-here',
          parentItem
            ? `"${type.name}" isn't allowed under "${parentType?.name ?? item.parent}"`
            : `"${type.name}" isn't allowed at the top level`,
        )
    }

    const editors = await editorsOf(item.kind === 'media' ? mediaTypes : documentTypes, type)
    const values: BundleValue[] = []
    const addValues = async (
      table: Record<string, unknown>,
      culture: string | null,
      path: string[],
    ) => {
      for (const [alias, raw] of Object.entries(table)) {
        const property = editors.get(alias)
        if (!property) {
          const iso =
            culture === null && isRecord(raw) ? languages.get(alias.toLowerCase()) : undefined
          if (iso) {
            usedLanguages.add(iso)
            await addValues(raw as Record<string, unknown>, iso, [...path, alias])
            continue
          }
          if (culture === null && isRecord(raw) && /^[a-z]{2}(-[a-z]{2,4})?$/i.test(alias)) {
            find(item, [...path, alias], 'language-missing', `there is no language "${alias}" here`)
            continue
          }
          find(
            item,
            [...path, alias],
            'unknown-property',
            `"${type.alias}" has no property "${alias}"`,
          )
          continue
        }
        const converted = await convert(property.editor, raw, key, alias)
        if (!converted.ok) {
          find(item, [...path, alias], 'bad-value', `${alias}: ${converted.message}`)
          continue
        }
        const references = referenceCandidates(converted.value)
        values.push({
          property: alias,
          culture,
          segment: null,
          editor: property.editor,
          value: converted.value,
          ...(references.length > 0 ? { references } : {}),
        })
      }
    }
    if (item.data.values !== undefined) {
      if (isRecord(item.data.values)) await addValues(item.data.values, null, ['values'])
      else find(item, ['values'], 'bad-values', 'values is a table: [values]')
    }

    if (item.kind === 'media' && item.bytes) {
      const file = item.path.split('/').at(-1) as string
      const blobKey = `${key.replaceAll('-', '').slice(0, 8)}/${file}`
      const src = `/media/${blobKey}`
      const fileEditor = editors.get('umbracoFile')?.editor
      const focalPoint = isRecord(item.data.focalPoint) ? item.data.focalPoint : null
      const media: Record<string, unknown> = {
        umbracoFile:
          fileEditor === IMAGE_CROPPER_EDITOR_ALIAS ? { src, crops: [], focalPoint } : src,
        // A label stores text, so the size is a string, as an upload stores it.
        umbracoBytes: String(item.bytes.length),
        umbracoExtension: extname(file).slice(1).toLowerCase(),
      }
      if (fileEditor === IMAGE_CROPPER_EDITOR_ALIAS)
        try {
          const { width, height } = await new Bun.Image(item.bytes).metadata()
          media.umbracoWidth = width
          media.umbracoHeight = height
        } catch {
          find(item, [], 'bad-image', `${file} is not an image this site can read`)
        }
      for (const [alias, value] of Object.entries(media)) {
        const editor = editors.get(alias)?.editor
        if (editor && !values.some((v) => v.property === alias))
          values.push({ property: alias, culture: null, segment: null, editor, value })
      }
      blobs.set(blobKey, item.bytes)
      blobList.push({
        key: blobKey,
        node: key,
        etag: createHash('sha256').update(item.bytes).digest('hex'),
        size: item.bytes.length,
        included: true,
      })
    }

    const template =
      item.kind !== 'content'
        ? null
        : typeof item.data.template === 'string'
          ? item.data.template
          : type.defaultComponentKey
            ? ((await components.byKey(type.defaultComponentKey))?.alias ?? null)
            : null
    if (template) usedComponents.add(template)
    // Media has no published state: it is live as soon as it lands.
    const published = item.kind !== 'media' && item.data.published !== false
    const parent =
      item.kind === 'library' || !item.parent
        ? null
        : (keyOf.get(
            (item.kind === 'media' ? mediaByPath : contentByPath).get(
              item.parent.toLowerCase(),
            ) as SeedItem,
          ) ?? null)
    const names = nameOf(item)
    // A renamed file is a new key: say so where a page of that name is already here.
    if (item.kind === 'content') {
      const parentId = parent ? (await nodes.byKey(parent))?.id : SystemNodes.Root
      const name = names[0]?.name ?? ''
      const here =
        parentId === undefined
          ? []
          : await nodes.childrenNamed(parentId, [ObjectTypes.Document], name)
      const other = here.find((node) => node.key !== key)
      if (other)
        find(
          item,
          ['name'],
          'name-taken',
          `"${name}" is already here as another page (${other.key}). A renamed file is a new page: give it key = "${other.key}" to keep the one that is here`,
        )
    }
    const kind: BundleKind =
      item.kind === 'content' ? 'document' : item.kind === 'library' ? 'element' : 'media'
    bundleNodes.push({
      key,
      kind,
      contentType: { key: type.key, alias: type.alias },
      parent,
      sortOrder: 0,
      template,
      variants: names.map((v) => ({ ...v, segment: null, published })),
      values,
    })
  }

  // Order among siblings: `order`, then the name.
  const orderOf = (node: BundleNode) => {
    const item = byKey.get(node.key)
    return typeof item?.data.order === 'number' ? item.data.order : Number.MAX_SAFE_INTEGER
  }
  const groups = new Map<string, BundleNode[]>()
  for (const node of bundleNodes) {
    const group = `${node.kind}:${node.parent ?? ''}`
    groups.set(group, [...(groups.get(group) ?? []), node])
  }
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        orderOf(a) - orderOf(b) ||
        (a.variants[0]?.name ?? '').localeCompare(b.variants[0]?.name ?? ''),
    )
    for (const [index, node] of group.entries()) node.sortOrder = index
  }

  if (findings.length > 0) return { findings, blobs, counts }

  // The seed's identity is its content: a changed seed is a new bundle, which
  // `start --seed` applies and the three-way import takes as a newer one.
  const identity = createHash('sha256')
  for (const item of tree.items) {
    identity.update(`${item.kind}\0${item.path}\0${item.text}\0`)
    if (item.bytes) identity.update(item.bytes)
  }
  const id = uuidV5(`seed:${identity.digest('hex')}`, SEED_NAMESPACE)
  const tally: Partial<Record<BundleKind, number>> = {}
  for (const node of bundleNodes) tally[node.kind] = (tally[node.kind] ?? 0) + 1
  const set: ContentSet = {
    manifest: {
      formatVersion: BUNDLE_FORMAT_VERSION,
      id,
      label: 'Seed',
      createdAt: new Date(0).toISOString(),
      createdBy: 'crombolo seed',
      integrity: '',
      snapshot: 'drafts',
      provenance: {
        siteName: config.siteName,
        schemaVersion: state.version,
        schemaRevision: state.revision,
        schemaHash: state.hash,
        cmsVersion: VERSION,
      },
      selector: {
        roots: bundleNodes.filter((n) => n.parent === null).map((n) => n.key),
        descendants: true,
        asGiven: ['seed/'],
      },
      counts: tally,
      dependencies: {
        carried: bundleNodes.map((n) => n.key),
        expected: [...expected.values()].filter((e) => !byKey.has(e.key)),
        schema: {
          contentTypes: [...usedTypes].map(([alias, key]) => ({ key, alias })),
          components: [...usedComponents],
          languages: [...usedLanguages],
        },
      },
      blobs: blobList,
    },
    nodes: bundleNodes,
  }
  const payload = writeBundle(set, blobs)
  const files = writeBundlePackage(payload, {
    name: 'crombolo-site-seed',
    version: '0.0.0',
    id: 'site-seed',
    label: 'Seed',
    description: `The seed of ${config.siteName}, built by crombolo seed build`,
    private: true,
    peerRange: `>=${VERSION}`,
  })
  return { findings, set, blobs, files, counts }
}
