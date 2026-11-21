/**
 * Pages written from the command line (story 253): made and changed in the
 * site's database through the same operations as the back office, with values
 * read in the shorthand content files use, by the converter `site apply`
 * uses. `content new`, `content update`, `content show` and `content block`
 * share it.
 */
import { readFileSync } from 'node:fs'
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
  resolveNodeRef,
} from '@crombolo/data'
import {
  bootstrapDatabase,
  type CromboloConfig,
  namedPath,
  type PropertyEditor,
  pageReader,
  type SchemaLookup,
  schemaLookup,
  type shorthandReader,
  siteDocumentOperations,
  siteValueRefs,
  tomlValue,
  typedValue,
  valueWriter,
} from '@crombolo/server'
import { Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import { commandActor, signedInPerson } from './acting.ts'
import { libraryHint, notALibraryPath } from './library.ts'
import { type Io, siteConfig } from './site.ts'

export { typedValue }

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
/** Whose own workspace a change made here goes into: the person signed in, or the site's administrator. */
async function ownerHere(db: Db): Promise<{ key: string; name: string } | undefined> {
  const person = signedInPerson()
  if (person) return { key: person.id, name: person.name }
  const admin = await db.q
    .selectFrom('user_account as u')
    .innerJoin('user_group_member as m', 'm.user_id', 'u.id')
    .innerJoin('user_group as g', 'g.id', 'm.user_group_id')
    .select(['u.key', 'u.user_name'])
    .where('g.alias', '=', 'admin')
    .orderBy('u.id')
    .limit(1)
    .executeTakeFirst()
  return admin ? { key: String(admin.key), name: String(admin.user_name) } : undefined
}

export async function withPages<T>(work: (site: PageSite) => Promise<T>): Promise<T> {
  const config = await siteConfig()
  const { db } = await bootstrapDatabase(config)
  try {
    const lookup = schemaLookup(db)
    const languages = (await new LanguageRepository(db).all())
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
      .map((l) => l.isoCode)
    return await work({
      db,
      config,
      lookup,
      // Story 386: with workspaces on, a change here goes into the person's own workspace.
      operations: (
        await siteDocumentOperations(db, config, {
          ...(config.workspaces ? { ownWorkspaceOf: await ownerHere(db) } : {}),
        })
      ).operations,
      writer: valueWriter(lookup, siteValueRefs(db)),
      reader: pageReader(db, lookup),
      languages,
    })
  } finally {
    await db.close()
  }
}

/** The person at this command line, under the rules a back office save follows. */
export const pageActor = (skipApproval = false) => commandActor({ skipApproval })

export interface FoundPage {
  doc: DocumentAggregate
  type: ContentTypeAggregate
  editors: Map<string, PropertyEditor>
  /** Its place by name, `/Home/Visit us`. */
  path: string
}

/** The page a path or key names, with its type and its properties' editors. */
export async function findPage(site: PageSite, ref: string): Promise<FoundPage> {
  notALibraryPath(ref)
  const resolved = await resolveNodeRef(site.db, [ObjectTypes.Document], ref)
  if (!resolved.ok)
    throw new CliError(
      'not_found',
      describeRefFailure(ref, resolved),
      await libraryHint(site.db, ref),
    )
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
    path: `/${(await namedPath(site.db, doc.key, 'content')) ?? ''}`,
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
  const out: DocumentValue[] = values.map(({ alias, culture, segment, environment, value }) => ({
    alias,
    culture,
    segment,
    ...(environment ? { environment } : {}),
    value,
  }))
  /** `title@production`: a property, and the environment it is set for (story 387). */
  const target = (named: string) => {
    const [alias, environment] = named.split('@') as [string, string | undefined]
    const property = propertyOf(alias)
    if (environment !== undefined && !property.variesByEnvironment)
      throw new CliError(
        'refused',
        `Nothing was changed: "${alias}" is the same in every environment, so it takes no @${environment}.`,
      )
    return { alias, property, environment: environment ?? null }
  }
  const same = (v: DocumentValue, alias: string, at: string | null, environment: string | null) =>
    v.alias === alias &&
    v.culture === at &&
    v.segment === null &&
    (v.environment ?? null) === environment
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
  for (const [named, text] of sets) {
    const { alias, property, environment } = target(named)
    const converted = await site.writer.convert(
      property.editor,
      typedValue(property.editor, text),
      page.key,
      alias,
    )
    if (!converted.ok)
      throw new CliError('refused', `Nothing was changed: ${alias}: ${converted.message}.`)
    const at = cultureOf(property)
    const existing = out.findIndex((v) => same(v, alias, at, environment))
    const value = {
      alias,
      culture: at,
      segment: null,
      ...(environment ? { environment } : {}),
      value: converted.value,
    }
    if (existing >= 0) out[existing] = value
    else out.push(value)
  }
  for (const named of unset) {
    const { alias, property, environment } = target(named)
    const at = cultureOf(property)
    const index = out.findIndex((v) => same(v, alias, at, environment))
    // An environment's value is cleared by sending it empty: one left out is kept (story 387).
    if (index >= 0 && environment) out[index] = { ...(out[index] as DocumentValue), value: null }
    else if (index >= 0) out.splice(index, 1)
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
  // Read and written in one go, so there is no older copy to check a revision against.
  const saved = flags.publish
    ? await site.operations.saveAndPublish(actor, key, input, null, { overwrite: true })
    : await site.operations.save(actor, key, input, { overwrite: true })
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

interface ShownBlock {
  type: string
  alias?: string
  key: string
  values: Record<string, unknown>
}

const isBlocks = (value: unknown): value is ShownBlock[] =>
  Array.isArray(value) &&
  value.every((b) => typeof b === 'object' && b !== null && 'type' in b && 'key' in b)

/** A page's values as `content show` prints them, each block with its alias, type and key. */
export function sayValues(
  io: Io,
  values: ReadonlyArray<{ property: string; culture: string | null; value: unknown }>,
): void {
  for (const v of values) {
    const label = `${v.property}${v.culture ? ` (${v.culture})` : ''}`
    if (isBlocks(v.value)) {
      io.say(`\n  ${label}`)
      for (const block of v.value) {
        io.say(`    ${block.alias ?? '(no alias)'}  ${block.type}  ${block.key}`)
        for (const [alias, value] of Object.entries(block.values))
          io.say(`      ${alias.padEnd(20)} ${tomlValue(value) ?? ''}`)
      }
    } else io.say(`  ${label.padEnd(22)} ${tomlValue(v.value) ?? ''}`)
  }
}

/** A key that looks like one, or undefined. */
export const keyIn = (ref: string) => (looksLikeKey(ref) ? normaliseUuid(ref) : undefined)
