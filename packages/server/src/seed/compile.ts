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
  bareFormWords,
  bracedFormWordNames,
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
  type Db,
  LanguageRepository,
  looksLikeKey,
  NodeRepository,
  resolveNodeRef,
} from '@crombolo/data'
import { loadSchemaDirectory } from '@crombolo/schema'
import {
  BUNDLE_FORMAT_VERSION,
  BUNDLE_SECTIONS,
  type BundleBlob,
  type BundleFile,
  type BundleKind,
  type BundleNode,
  type BundleValue,
  type ContentSet,
  ELEMENT_FOLDER_TYPE,
  referenceCandidates,
  writeBundle,
  writeBundlePackage,
} from '@crombolo/transfer'
import { createMediaPort } from '../adapters/media.ts'
import { type CromboloConfig, VERSION } from '../config.ts'
import { type DictionaryEntry, keyedEntries, writeDictionaryUdt } from '../dictionary-transfer.ts'
import { SEED_NAMESPACE, seedKey, uuidV5 } from './keys.ts'
import { lineOf } from './lines.ts'
import {
  DICTIONARY_FILE,
  kindDir,
  nameFromSegment,
  readSeed,
  readSeedDictionary,
  type SeedFinding,
  type SeedItem,
} from './read.ts'
import { schemaLookup, valueWriter } from './values.ts'

export interface SeedBuild {
  findings: SeedFinding[]
  /** The bundle, when nothing found stops it being built. */
  set?: ContentSet
  blobs: Map<string, Uint8Array>
  /** The bundle as the npm package `content import` reads. */
  files?: BundleFile[]
  /** How many items of each kind it holds. */
  counts: Record<'content' | 'library' | 'media', number>
  /** `content/dictionary.toml`, as the items it holds (story 168). */
  dictionary?: DictionaryEntry[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)

export async function compileSeed(db: Db, config: CromboloConfig): Promise<SeedBuild> {
  const tree = readSeed(config.siteDir)
  const findings: SeedFinding[] = [...tree.findings]
  const counts = { content: 0, library: 0, media: 0 }
  for (const item of tree.items) counts[item.kind] += 1

  const dictionary = readSeedDictionary(config.siteDir)
  for (const problem of dictionary?.problems ?? [])
    findings.push({
      file: DICTIONARY_FILE,
      line: problem.path.length > 0 ? lineOf(dictionary?.text ?? '', problem.path) : 1,
      code: 'bad-dictionary',
      message: problem.message,
    })

  // The file is the dictionary when a site has one; without it, its items may
  // all be in a database this build can't see.
  if (dictionary) {
    const names = new Set<string>()
    const collect = (entries: readonly DictionaryEntry[]) => {
      for (const entry of entries) {
        names.add(entry.name.toLowerCase())
        collect(entry.children)
      }
    }
    collect(dictionary.entries)
    for (const form of loadSchemaDirectory(config.schemaDir).set.forms ?? []) {
      const file = `schema/forms/${form.alias}.toml`
      for (const name of bracedFormWordNames(form))
        if (!names.has(name.toLowerCase()))
          findings.push({
            file,
            line: 1,
            code: 'unknown-dictionary-item',
            message: `the form "${form.alias}" names {#${name}}, which is not in ${DICTIONARY_FILE}`,
          })
      // Forms wrote `#key` before story 297; the server rewrites it when it starts.
      for (const name of bareFormWords(form))
        if (names.has(name.toLowerCase()))
          findings.push({
            file,
            line: 1,
            code: 'bare-dictionary-word',
            message: `the form "${form.alias}" writes #${name}; write it as {#${name}}`,
          })
    }
  }

  const state = await currentSchemaState(db)
  const documentTypes = new ContentTypeRepository(db)
  const mediaTypes = new ContentTypeRepository(db, { kind: 'media' })
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
      file: item.file ?? `${kindDir(item.kind)}/${item.path}`,
      line: item.text ? lineOf(item.text, path) : 1,
      code,
      message,
    })

  const checkLanguages = (entries: readonly DictionaryEntry[], path: readonly string[]) => {
    for (const entry of entries) {
      for (const { isoCode } of entry.translations)
        if (!languages.has(isoCode.toLowerCase()))
          findings.push({
            file: DICTIONARY_FILE,
            line: lineOf(dictionary?.text ?? '', [...path, entry.name, isoCode]),
            code: 'unknown-language',
            message: `"${entry.name}" has a translation for ${isoCode}, a language this site has not got`,
          })
      checkLanguages(entry.children, [...path, entry.name])
    }
  }
  checkLanguages(dictionary?.entries ?? [], [])

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
  const lookup = schemaLookup(db)
  const typeOf = (repo: ContentTypeRepository, alias: string) =>
    lookup.typeOf(repo === mediaTypes ? 'media' : 'document', alias)
  const editorsOf = (repo: ContentTypeRepository, type: ContentTypeAggregate) =>
    lookup.editorsOf(repo === mediaTypes ? 'media' : 'document', type)

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
    const rows = await db.q
      .selectFrom('node as n')
      .innerJoin('content as c', 'c.node_id', 'n.id')
      .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
      .select('ct.alias')
      .where('n.unique_id', '=', key)
      .execute()
    return { key, typeAlias: rows[0] ? String(rows[0].alias) : 'Image' }
  }
  const libraryKey = async (ref: string, why: string) => {
    const seeded = libraryByPath.get(trimPath(ref))
    if (seeded) return seeded.folder ? undefined : keyOf.get(seeded)
    if (looksLikeKey(ref)) return normaliseUuid(ref)
    return siteNode(ref, ObjectTypes.Element, why)
  }
  const forms = loadSchemaDirectory(config.schemaDir).set.forms ?? []
  /** A Library form by its path, else a form by its alias: what a form picker stores. */
  const formKey = async (ref: string, why: string) => {
    if (looksLikeKey(ref)) return normaliseUuid(ref)
    const seeded = libraryByPath.get(trimPath(ref))
    if (seeded && !seeded.folder) {
      const type =
        typeof seeded.data.type === 'string'
          ? await typeOf(documentTypes, seeded.data.type)
          : undefined
      return type?.formKey ? keyOf.get(seeded) : undefined
    }
    const form = forms.find((f) => f.alias.toLowerCase() === trimPath(ref))
    if (form) return form.key ?? form.alias
    const key = await siteNode(ref, ObjectTypes.Element, why)
    if (!key) return undefined
    const rows = await db.q
      .selectFrom('node as n')
      .innerJoin('content as c', 'c.node_id', 'n.id')
      .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
      .select('ct.form_key')
      .where('n.unique_id', '=', key)
      .execute()
    return rows[0]?.form_key ? key : undefined
  }

  // ---------------------------------------------------------------- values
  const { convert } = valueWriter(lookup, {
    content: contentKey,
    media: mediaRef,
    library: libraryKey,
    form: formKey,
    linkedMedia: async (path) => {
      const media = mediaByPath.get(path.toLowerCase())
      return media ? keyOf.get(media) : undefined
    },
  })

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
    if (item.kind === 'library' && item.folder) {
      // A Library folder: a name and a place, as story 283 carries it.
      bundleNodes.push({
        key,
        kind: 'element-folder',
        contentType: { ...ELEMENT_FOLDER_TYPE },
        parent: item.parent
          ? (keyOf.get(libraryByPath.get(item.parent.toLowerCase()) as SeedItem) ?? null)
          : null,
        sortOrder: 0,
        template: null,
        variants: [
          {
            culture: null,
            segment: null,
            name: nameOf(item)[0]?.name ?? item.path,
            published: false,
          },
        ],
        values: [],
      })
      continue
    }
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
          `"${type.alias}" is an element type: put it in content/library`,
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
    const parent = !item.parent
      ? null
      : (keyOf.get(
          (item.kind === 'media'
            ? mediaByPath
            : item.kind === 'library'
              ? libraryByPath
              : contentByPath
          ).get(item.parent.toLowerCase()) as SeedItem,
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

  // Its identity is its content: changed files are a new bundle, which
  // `start --bundle .` applies and the three-way import takes as a newer one.
  const identity = createHash('sha256')
  for (const item of tree.items) {
    identity.update(`${item.kind}\0${item.path}\0${item.text}\0`)
    if (item.bytes) identity.update(item.bytes)
  }
  if (dictionary) identity.update(`dictionary\0${dictionary.text}\0`)
  const id = uuidV5(`seed:${identity.digest('hex')}`, SEED_NAMESPACE)
  const tally: Partial<Record<BundleKind, number>> = {}
  for (const node of bundleNodes) tally[node.kind] = (tally[node.kind] ?? 0) + 1
  const set: ContentSet = {
    manifest: {
      formatVersion: BUNDLE_FORMAT_VERSION,
      id,
      label: 'Content files',
      createdAt: new Date(0).toISOString(),
      createdBy: 'crombolo bundle apply',
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
        asGiven: ['content/'],
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
  const entries = dictionary?.entries ?? []
  const payload = writeBundle(
    set,
    blobs,
    entries.length > 0
      ? [
          {
            path: `${BUNDLE_SECTIONS.dictionary}.udt`,
            text: writeDictionaryUdt(keyedEntries(entries)),
          },
        ]
      : [],
  )
  const files = writeBundlePackage(payload, {
    name: 'crombolo-site-seed',
    version: '0.0.0',
    id: 'site-seed',
    label: 'Content files',
    description: `The content files of ${config.siteName}, built by crombolo bundle build`,
    private: true,
    peerRange: `>=${VERSION}`,
  })
  return { findings, set, blobs, files, counts, ...(dictionary ? { dictionary: entries } : {}) }
}
