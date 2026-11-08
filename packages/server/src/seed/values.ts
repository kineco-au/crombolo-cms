/**
 * Values in the shorthand a person writes, both ways (stories 163, 253):
 * Markdown, paths and `{ type, alias, values }` blocks into each property
 * editor's stored shape, as `bundle apply` reads content files and the
 * `content` commands read `--set`; and stored values back into that shorthand,
 * as `bundle export --source` and `content show` write them.
 */
import { type ContentTypeAggregate, dateFromText, normaliseUuid } from '@crombolo/core'
import { ContentTypeRepository, DataTypeRepository, type Db, looksLikeKey } from '@crombolo/data'
import { blockKey, pickKey } from './keys.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)

const BLOCK_LAYOUT = {
  'Umbraco.BlockList': 'Umbraco.BlockList',
  'Umbraco.BlockGrid': 'Umbraco.BlockGrid',
} as const

/** A block's alias: a name a view or a command picks it out by (story 253). */
export const BLOCK_ALIAS = /^[A-Za-z][A-Za-z0-9_-]*$/

export type Converted = { ok: true; value: unknown } | { ok: false; message: string }
const fail = (message: string): Converted => ({ ok: false, message })

export interface PropertyEditor {
  editor: string
  variesByCulture: boolean
  /** The data type's settings, by alias: a block list's `blocks`, say. */
  config: Record<string, unknown>
}

/** The site's types and their properties' editors, looked up once each. */
export function schemaLookup(db: Db) {
  const repos = {
    document: new ContentTypeRepository(db),
    media: new ContentTypeRepository(db, { kind: 'media' }),
  }
  const dataTypes = new DataTypeRepository(db)
  const types = new Map<string, ContentTypeAggregate | undefined>()
  const editors = new Map<string, Map<string, PropertyEditor>>()
  return {
    repos,
    async typeOf(kind: 'document' | 'media', alias: string) {
      const key = `${kind}:${alias.toLowerCase()}`
      if (!types.has(key)) types.set(key, await repos[kind].byAlias(alias))
      return types.get(key)
    },
    async typeByKey(kind: 'document' | 'media', typeKey: string) {
      return repos[kind].byKey(normaliseUuid(typeKey))
    },
    async editorsOf(
      kind: 'document' | 'media',
      type: Pick<ContentTypeAggregate, 'key'>,
    ): Promise<Map<string, PropertyEditor>> {
      const cached = editors.get(type.key)
      if (cached) return cached
      const properties = await repos[kind].resolveProperties(type.key)
      const byKey = new Map(
        (await dataTypes.byKeys(properties.map((p) => p.dataTypeKey))).map((d) => [d.key, d]),
      )
      const out = new Map<string, PropertyEditor>()
      for (const property of properties) {
        const dataType = byKey.get(property.dataTypeKey)
        if (dataType)
          out.set(property.alias, {
            editor: dataType.editorAlias,
            variesByCulture: property.variesByCulture,
            config: Object.fromEntries(dataType.values.map((v) => [v.alias, v.value])),
          })
      }
      editors.set(type.key, out)
      return out
    },
  }
}

export type SchemaLookup = ReturnType<typeof schemaLookup>

/** What a value's paths name: pages, media and Library elements. */
export interface ValueRefs {
  content(ref: string, why: string): Promise<string | undefined>
  media(ref: string, why: string): Promise<{ key: string; typeAlias: string } | undefined>
  library(ref: string, why: string): Promise<string | undefined>
  /** A form picker's value: a Library form's path, or a form's alias or key (story 242). */
  form(ref: string, why: string): Promise<string | undefined>
  /** A link's path as media, before it is tried as a page. */
  linkedMedia(ref: string): Promise<string | undefined>
}

/** The shorthand into each editor's stored shape. */
export function valueWriter(lookup: SchemaLookup, refs: ValueRefs) {
  const trimPath = (ref: string) => ref.replace(/^\/+|\/+$/g, '')

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
      const key = await refs.content(path as string, why)
      if (key) html = html.replace(whole, `href="/{localLink:${key}}"`)
    }
    return { ok: true, value: { markup: html, blocks: null } }
  }

  const element = async (
    entry: Record<string, unknown>,
    owner: string,
    where: string,
    what: string,
  ): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string }> => {
    const type =
      typeof entry.type === 'string' ? await lookup.typeOf('document', entry.type) : undefined
    if (!type?.isElement)
      return {
        ok: false,
        message:
          typeof entry.type === 'string'
            ? `${what}: there is no element type "${entry.type}"`
            : `${what} has no type`,
      }
    const key =
      typeof entry.key === 'string' && looksLikeKey(entry.key)
        ? normaliseUuid(entry.key)
        : blockKey(owner, where)
    const values = await elementValues(type, entry.values, owner, where)
    if (!values.ok) return { ok: false, message: `${what}: ${values.message}` }
    return { ok: true, data: { key, contentTypeKey: type.key, values: values.value } }
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
    const aliases = new Set<string>()
    for (const [index, entry] of raw.entries()) {
      if (!isRecord(entry)) return fail(`block ${index + 1} has no type`)
      const content = await element(entry, owner, `${where}/${index}`, `block ${index + 1}`)
      if (!content.ok) return fail(content.message)
      contentData.push(content.data)
      const item: Record<string, unknown> = { contentKey: content.data.key }
      if (entry.alias !== undefined) {
        if (typeof entry.alias !== 'string' || !BLOCK_ALIAS.test(entry.alias))
          return fail(
            `block ${index + 1}: an alias is letters, digits, - and _, starting with a letter`,
          )
        if (aliases.has(entry.alias.toLowerCase()))
          return fail(`two blocks are called "${entry.alias}"`)
        aliases.add(entry.alias.toLowerCase())
        item.alias = entry.alias
      }
      if (isRecord(entry.settings)) {
        const settings = await element(
          entry.settings,
          owner,
          `${where}/${index}/settings`,
          `block ${index + 1} settings`,
        )
        if (!settings.ok) return fail(settings.message)
        settingsData.push(settings.data)
        item.settingsKey = settings.data.key
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
    type: ContentTypeAggregate,
    raw: unknown,
    owner: string,
    where: string,
  ): Promise<Converted> => {
    if (raw === undefined) return { ok: true, value: [] }
    if (!isRecord(raw)) return fail('values is a table')
    const editors = await lookup.editorsOf('document', type)
    const out: Array<{ alias: string; editorAlias: string; value: unknown }> = []
    for (const [alias, value] of Object.entries(raw)) {
      const property = editors.get(alias)
      if (!property) return fail(`"${type.alias}" has no property "${alias}"`)
      const converted = await convert(property.editor, value, owner, `${where}/${alias}`)
      if (!converted.ok) return fail(`${alias}: ${converted.message}`)
      out.push({ alias, editorAlias: property.editor, value: converted.value })
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
      case 'Umbraco.DateTimeWithTimeZone': {
        // Bun's TOML gives a Temporal value (a PlainDate, an Instant) for a TOML
        // date, which writes itself as ISO 8601.
        const text =
          raw instanceof Date
            ? raw.toISOString()
            : isTemporalDate(raw)
              ? String(raw)
              : typeof raw === 'string'
                ? raw
                : undefined
        const at = text === undefined ? undefined : dateFromText(text)
        if (text === undefined || !at) return fail('a date is a TOML date or an ISO 8601 string')
        // A date picker stores Umbraco's wall clock, as a save does, so a seed
        // exported and applied again is unchanged; one with a zone keeps ISO.
        return {
          ok: true,
          value:
            editor === 'Umbraco.DateTime' ? at.toISOString().slice(0, 19).replace('T', ' ') : text,
        }
      }
      case 'Umbraco.Tags':
        return list(raw).every((tag) => typeof tag === 'string')
          ? { ok: true, value: list(raw) }
          : fail('tags are a list of strings')
      case 'Umbraco.ContentPicker': {
        if (typeof raw !== 'string') return fail('a content picker takes a content path')
        const key = await refs.content(raw, why)
        return key
          ? { ok: true, value: `umb://document/${key.replaceAll('-', '')}` }
          : fail(`"${raw}" is not a page in the content files or on the site`)
      }
      case 'Umbraco.MediaPicker3': {
        if (isRecord(raw) || (Array.isArray(raw) && raw.some(isRecord)))
          return { ok: true, value: raw }
        const picks: unknown[] = []
        for (const ref of list(raw)) {
          if (typeof ref !== 'string') return fail('a media picker takes media paths')
          const media = await refs.media(ref, why)
          if (!media) return fail(`"${ref}" is not media in the content files or on the site`)
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
          const key = await refs.library(ref, why)
          if (!key)
            return fail(`"${ref}" is not a Library element in the content files or on the site`)
          keys.push(key)
        }
        return { ok: true, value: keys }
      }
      case 'Crombolo.FormPicker': {
        if (typeof raw !== 'string')
          return fail("a form picker takes a Library form's path, or a form's alias")
        const key = await refs.form(raw, why)
        if (!key)
          return fail(
            `"${raw}" is not a Library form or a form, in the content files or on the site`,
          )
        return { ok: true, value: key }
      }
      case 'Umbraco.MultiUrlPicker': {
        const links: unknown[] = []
        for (const entry of list(raw)) {
          const link = typeof entry === 'string' ? { path: entry } : entry
          if (!isRecord(link))
            return fail('a link is a path, a URL, or { path | url, name, target }')
          // A link as the editor stores it, as `bundle export --source` writes one.
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
          const media = await refs.linkedMedia(trimPath(path))
          const key = media ?? (await refs.content(path, why))
          if (!key)
            return fail(`"${path}" is not a page or media in the content files or on the site`)
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

  return { convert, elementValues }
}

const PICKER = /^umb:\/\/document\/([0-9a-f]{32})$/i
const dashed = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`

export type PathKind = 'content' | 'library' | 'media'

/**
 * Each editor's stored shape back into the shorthand, where `where` names the
 * path a key has; a value with no plain shorthand stays as it is stored.
 */
export function shorthandReader(
  lookup: SchemaLookup,
  aliasOf: (typeKey: string) => Promise<string>,
  where: (key: string, kind: PathKind) => string | undefined | Promise<string | undefined>,
) {
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
        const path = await where(key, 'content')
        return path ? `/${path}` : key
      }
      case 'Umbraco.MediaPicker3': {
        if (!Array.isArray(value)) return value
        const paths = await Promise.all(
          value.map((pick) =>
            isRecord(pick) &&
            typeof pick.mediaKey === 'string' &&
            pick.key === pickKey(pick.mediaKey) &&
            Array.isArray(pick.crops) &&
            pick.crops.length === 0 &&
            pick.focalPoint == null
              ? where(pick.mediaKey, 'media')
              : undefined,
          ),
        )
        if (paths.length === 0 || paths.some((p) => p === undefined)) return value
        const full = paths.map((p) => `/${p}`)
        return full.length === 1 ? full[0] : full
      }
      case 'Umbraco.ElementPicker': {
        if (!Array.isArray(value)) return value
        const paths = await Promise.all(
          value.map((key) => (typeof key === 'string' ? where(key, 'library') : undefined)),
        )
        if (paths.length === 0 || paths.some((p) => p === undefined)) return value
        return paths.length === 1 ? paths[0] : paths
      }
      case 'Crombolo.FormPicker': {
        if (typeof value !== 'string') return value
        return (await where(value, 'library')) ?? value
      }
      case 'Umbraco.MultiUrlPicker': {
        if (!Array.isArray(value)) return value
        const out: unknown[] = []
        for (const link of value) out.push(await linkShorthand(link))
        return out
      }
      case 'Umbraco.BlockList':
      case 'Umbraco.BlockGrid':
        return blocks(editor, value)
      default:
        return value
    }
  }

  const linkShorthand = async (link: unknown): Promise<unknown> => {
    if (!isRecord(link)) return link
    const target = link.target ?? null
    if (
      link.type === 'document' &&
      typeof link.unique === 'string' &&
      target === null &&
      !link.url &&
      !link.queryString
    ) {
      const path = await where(link.unique, 'content')
      if (path && (link.name === '' || link.name == null)) return `/${path}`
      if (path && typeof link.name === 'string') return { path: `/${path}`, name: link.name }
    }
    if (link.type === 'external' && typeof link.url === 'string' && target === null)
      return { url: link.url, name: link.name ?? link.url }
    return link
  }

  /** Blocks as `{ type, alias, key, values, settings }`, when their layout is plain enough to say so. */
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
        ...(typeof item.alias === 'string' ? { alias: item.alias } : {}),
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
    const editors = await lookup.editorsOf('document', {
      key: normaliseUuid(String(data.contentTypeKey)),
    })
    const out: Record<string, unknown> = {}
    for (const v of (data.values as unknown[] | undefined) ?? []) {
      if (!isRecord(v) || typeof v.alias !== 'string') continue
      const editor = editors.get(v.alias)?.editor
      out[v.alias] = editor ? await shorthand(editor, v.value) : v.value
    }
    return out
  }

  return { shorthand, elementValues }
}

/** A TOML date as Bun's parser gives it: a Temporal value whose ISO form is a date. */
function isTemporalDate(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || raw instanceof Date) return false
  const text = String(raw)
  return /^\d{4}-\d{2}-\d{2}/.test(text) && !Number.isNaN(new Date(text).getTime())
}
