/**
 * Pages written from the command line (story 253): made and changed in the
 * site's database through the same operations as the back office, with values
 * read in the shorthand content files use, by the converter `site apply`
 * uses. `content new`, `content update`, `content show` and `content block`
 * share it.
 */
import { readFileSync } from 'node:fs'
import { operatorActor } from '@crombolo/content'
import {
  type ContentTypeAggregate,
  type DocumentAggregate,
  type DocumentValidationError,
  type DocumentValue,
  normaliseUuid,
  ObjectTypes,
} from '@crombolo/core'
import {
  ComponentRepository,
  type Db,
  describeRefFailure,
  LanguageRepository,
  looksLikeKey,
  NodeRepository,
  resolveNodeRef,
} from '@crombolo/data'
import {
  bootstrapDatabase,
  type CromboloConfig,
  type PathKind,
  type PropertyEditor,
  type SchemaLookup,
  schemaLookup,
  shorthandReader,
  siteDocumentOperations,
  type ValueRefs,
  valueWriter,
} from '@crombolo/server'
import { Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import { commandActorName } from '../operations/commands.ts'
import { type Io, siteConfig } from './site.ts'

const OBJECT_TYPES: Record<PathKind, string> = {
  content: ObjectTypes.Document,
  library: ObjectTypes.Element,
  media: ObjectTypes.Media,
}

/** What a value's paths name, on this site. */
function siteRefs(db: Db): ValueRefs {
  const keyOf = async (ref: string, kind: PathKind) => {
    const resolved = await resolveNodeRef(db, [OBJECT_TYPES[kind]], ref)
    return resolved.ok && resolved.node.objectType === OBJECT_TYPES[kind]
      ? resolved.node.key
      : undefined
  }
  return {
    content: (ref) => keyOf(ref, 'content'),
    library: (ref) => keyOf(ref, 'library'),
    // A Library form by its path or key; anything else is a form's own alias, as before.
    async form(ref) {
      if (looksLikeKey(ref)) return normaliseUuid(ref)
      const key = await keyOf(ref, 'library')
      if (!key) return ref
      const rows = await db.q
        .selectFrom('node as n')
        .innerJoin('content as c', 'c.node_id', 'n.id')
        .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
        .select('ct.form_key')
        .where('n.unique_id', '=', key)
        .execute()
      return rows[0]?.form_key ? key : undefined
    },
    linkedMedia: (ref) => keyOf(ref, 'media'),
    async media(ref) {
      const key = await keyOf(ref, 'media')
      if (!key) return undefined
      const rows = await db.q
        .selectFrom('node as n')
        .innerJoin('content as c', 'c.node_id', 'n.id')
        .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
        .select('ct.alias')
        .where('n.unique_id', '=', key)
        .execute()
      return { key, typeAlias: rows[0] ? String(rows[0].alias) : 'Image' }
    },
  }
}

/** A node's place by its names, `Home/Visit us`, as a path argument names it. */
async function pathOf(db: Db, key: string, kind: PathKind): Promise<string | undefined> {
  const nodes = new NodeRepository(db)
  const node = await nodes.byKey(normaliseUuid(key))
  if (!node || node.objectType !== OBJECT_TYPES[kind]) return undefined
  const ids = node.path
    .split(',')
    .map(Number)
    .filter((id) => id > 0)
  const names: string[] = []
  for (const id of ids) {
    const row = await nodes.byId(id)
    if (!row) return undefined
    names.push(row.text ?? row.key)
  }
  return names.join('/')
}

export interface PageSite {
  db: Db
  config: CromboloConfig
  lookup: SchemaLookup
  operations: Awaited<ReturnType<typeof siteDocumentOperations>>['operations']
  writer: ReturnType<typeof valueWriter>
  reader: ReturnType<typeof shorthandReader>
  /** The site's languages: the default first. */
  languages: string[]
}

/** The site's database and the page operations, for one command. */
export async function withPages<T>(work: (site: PageSite) => Promise<T>): Promise<T> {
  const config = await siteConfig()
  const { db } = await bootstrapDatabase(config)
  try {
    const lookup = schemaLookup(db)
    const typeAliases = new Map<string, string>()
    const aliasOf = async (typeKey: string) => {
      const key = normaliseUuid(typeKey)
      if (!typeAliases.has(key))
        typeAliases.set(key, (await lookup.typeByKey('document', key))?.alias ?? key)
      return typeAliases.get(key) as string
    }
    const languages = (await new LanguageRepository(db).all())
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
      .map((l) => l.isoCode)
    return await work({
      db,
      config,
      lookup,
      operations: (await siteDocumentOperations(db, config)).operations,
      writer: valueWriter(lookup, siteRefs(db)),
      reader: shorthandReader(lookup, aliasOf, (key, kind) => pathOf(db, key, kind)),
      languages,
    })
  } finally {
    await db.close()
  }
}

/** The person at this command line, under the rules a back office save follows. */
export const pageActor = (skipApproval = false) =>
  operatorActor(commandActorName(), { skipApproval })

export interface FoundPage {
  doc: DocumentAggregate
  type: ContentTypeAggregate
  editors: Map<string, PropertyEditor>
  /** Its place by name, `/Home/Visit us`. */
  path: string
}

/** The page a path or key names, with its type and its properties' editors. */
export async function findPage(site: PageSite, ref: string): Promise<FoundPage> {
  const resolved = await resolveNodeRef(site.db, [ObjectTypes.Document], ref)
  if (!resolved.ok) throw new CliError('not_found', describeRefFailure(ref, resolved))
  if (resolved.node.objectType !== ObjectTypes.Document)
    throw new CliError('not_found', `"${ref}" is not a page.`)
  const doc = await site.operations.repository.byKey(resolved.node.key)
  if (!doc) throw new CliError('not_found', `"${ref}" is not a page.`)
  const type = await site.lookup.typeByKey('document', doc.contentTypeKey)
  if (!type) throw new CliError('not_found', `The type of "${ref}" is not on this site.`)
  return {
    doc,
    type,
    editors: await site.lookup.editorsOf('document', type),
    path: `/${(await pathOf(site.db, doc.key, 'content')) ?? ''}`,
  }
}

const TEXTUAL = new Set([
  'Umbraco.TextBox',
  'Umbraco.TextArea',
  'Umbraco.RichText',
  'Umbraco.TinyMCE',
])

/**
 * A value as typed after `--set alias=`: text as it is for a text or rich text
 * property, JSON where it reads as JSON for the rest (`true`, `3`,
 * `["/a", "/b"]`), and the text itself otherwise, such as a path.
 */
export function typedValue(editor: string, text: string): unknown {
  if (TEXTUAL.has(editor)) return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** `alias=value` pairs, and `alias=file` pairs read from the file. */
export function setsOf(
  sets: readonly string[] = [],
  files: readonly string[] = [],
): Array<[string, string]> {
  const split = (pair: string, flag: string): [string, string] => {
    const at = pair.indexOf('=')
    if (at <= 0)
      throw new CliError('usage', `${flag} takes <property>=<value>: "${pair}" has no "=".`)
    return [pair.slice(0, at).trim(), pair.slice(at + 1)]
  }
  return [
    ...sets.map((pair) => split(pair, '--set')),
    ...files.map((pair) => {
      const [alias, file] = split(pair, '--set-file')
      try {
        return [alias, readFileSync(file, 'utf8')] as [string, string]
      } catch {
        throw new CliError('not_found', `--set-file: there is no file "${file}".`)
      }
    }),
  ]
}

/**
 * Values set on a page's own values: each converted by its property's editor,
 * in the culture given or none; refused, naming it, when one cannot be.
 */
export async function withValuesSet(
  site: PageSite,
  page: { key: string; type: ContentTypeAggregate; editors: Map<string, PropertyEditor> },
  values: readonly DocumentValue[],
  sets: ReadonlyArray<[string, string]>,
  unset: readonly string[],
  culture: string | null,
): Promise<DocumentValue[]> {
  const out = values.map(({ alias, culture, segment, value }) => ({
    alias,
    culture,
    segment,
    value,
  }))
  const propertyOf = (alias: string) => {
    const property = page.editors.get(alias)
    if (!property)
      throw new CliError(
        'refused',
        `Nothing was changed: "${page.type.alias}" has no property "${alias}".`,
        {
          hint: `\`crombolo types show ${page.type.alias}\` lists its properties.`,
        },
      )
    if (culture && !property.variesByCulture)
      throw new CliError(
        'refused',
        `Nothing was changed: "${alias}" is the same in every language, so it takes no --culture.`,
      )
    return property
  }
  // A value in a language with none named is in the site's default one, as a new page's is.
  const cultureOf = (property: PropertyEditor) =>
    property.variesByCulture ? (culture ?? site.languages[0] ?? null) : null
  for (const [alias, text] of sets) {
    const property = propertyOf(alias)
    const converted = await site.writer.convert(
      property.editor,
      typedValue(property.editor, text),
      page.key,
      alias,
    )
    if (!converted.ok)
      throw new CliError('refused', `Nothing was changed: ${alias}: ${converted.message}.`)
    const at = cultureOf(property)
    const existing = out.findIndex(
      (v) => v.alias === alias && v.culture === at && v.segment === null,
    )
    const value = { alias, culture: at, segment: null, value: converted.value }
    if (existing >= 0) out[existing] = value
    else out.push(value)
  }
  for (const alias of unset) {
    const at = cultureOf(propertyOf(alias))
    const index = out.findIndex((v) => v.alias === alias && v.culture === at && v.segment === null)
    if (index >= 0) out.splice(index, 1)
  }
  return out
}

/** The view a page is shown with, by alias, or the type's own when none is named. */
export async function viewKeyOf(
  site: PageSite,
  type: ContentTypeAggregate,
  view: string | undefined,
): Promise<string | null> {
  if (view === undefined) return type.defaultComponentKey
  const component = await new ComponentRepository(site.db).byAlias(view)
  if (!component || !type.allowedComponentKeys.some((k) => normaliseUuid(k) === component.key))
    throw new CliError(
      'refused',
      `Nothing was changed: "${type.alias}" is not shown with a view "${view}".`,
      {
        hint: `\`crombolo types show ${type.alias}\` lists its views.`,
      },
    )
  return component.key
}

type Written = Awaited<ReturnType<PageSite['operations']['save']>>

/** An operation's refusal as the command's failure, with each property's reasons. */
export function refusedPage(result: Extract<Written, { ok: false }>): CliError {
  const errors = (result as { errors?: DocumentValidationError[] }).errors ?? []
  return new CliError(
    result.kind === 'notFound' ? 'not_found' : 'refused',
    result.kind === 'needsApproval'
      ? `${result.reason} To go ahead anyway, add --skip-approval; the audit log records that you did.`
      : `Nothing was changed: ${result.reason}`,
    errors.length > 0
      ? {
          details: errors.map(
            (e) => `${e.alias}${e.culture ? ` (${e.culture})` : ''}: ${e.messages.join('; ')}`,
          ),
        }
      : undefined,
  )
}

/**
 * A page saved, as the back office's Save does; with --publish, saved and
 * published in one step, so a page that cannot be published is not changed.
 */
export async function savePage(
  io: Io,
  site: PageSite,
  key: string,
  input: Parameters<PageSite['operations']['save']>[2],
  flags: { publish?: boolean; 'skip-approval'?: boolean },
) {
  const actor = pageActor(flags['skip-approval'])
  const saved = flags.publish
    ? await site.operations.saveAndPublish(actor, key, input, null)
    : await site.operations.save(actor, key, input)
  if (!saved.ok) throw refusedPage(saved)
  io.say(flags.publish ? '  published' : '\nA draft: `crombolo content publish` takes it live.')
}

/** The flags every command that writes a page takes. */
export const pageFlags = {
  set: Flags.string({
    summary: 'a value, in the shorthand content files use; JSON for a toggle, number or list',
    helpValue: '<property>=<value>',
    multiple: true,
  }),
  'set-file': Flags.string({
    summary: 'a value read from a file: Markdown for rich text, say',
    helpValue: '<property>=<file>',
    multiple: true,
  }),
  culture: Flags.string({
    summary: 'the language the values and name are in, for a page that varies by language',
    helpValue: '<iso>',
  }),
  view: Flags.string({ summary: 'the view it is shown with', helpValue: '<view>' }),
  publish: Flags.boolean({ summary: 'publish it too, as `content publish` would' }),
  'skip-approval': Flags.boolean({
    summary: 'with --publish: publish without the approval its workflow asks for; audited',
  }),
  'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
}

/** A key that looks like one, or undefined. */
export const keyIn = (ref: string) => (looksLikeKey(ref) ? normaliseUuid(ref) : undefined)
