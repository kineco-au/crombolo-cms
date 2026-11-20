/**
 * The flow every type-editing command shares (story 248): find the type, make
 * the change in memory, check it against a copy of the site's definitions as
 * `types check` would, and only then write it and apply it. A refused apply
 * puts the definition back as it was, so nothing is left half done. With --to,
 * a hosted site checks it before anything is written, and applies it after
 * (story 374).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { ObjectTypes } from '@crombolo/core'
import { connect, resolveNodeRef } from '@crombolo/data'
import {
  BUILTIN_DATA_TYPES,
  type DescribedKind,
  type EditResult,
  fileNameFor,
  type SchemaContentType,
  type SchemaDataType,
  type SchemaTypeKind,
  TYPE_KIND_FILES,
  typeFileKey,
  validateSchemaSet,
  writeContentType,
  writeDataType,
} from '@crombolo/schema'
import {
  bootstrapDatabase,
  type CromboloConfig,
  checkSchemaDirectory,
  componentAliasesIn,
  formTypesFor,
  seedKey,
} from '@crombolo/server'
import { Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import { describeSync, problemsOf } from './describe.ts'
import {
  HostedChange,
  type HostedOutcome,
  schemaWritesOf,
  type ToFlags,
  toFlags,
} from './hosted-schema.ts'
import type { Io } from './site.ts'
import { siteConfig } from './site.ts'
import { applySchema, loadTypes, needSchemaDir, refuseProblems } from './types.ts'

export const TYPE_KINDS = ['content', 'element', 'media', 'member'] as const

/** A content, element, media or member type found by its alias, with where it is kept. */
export interface FoundType {
  config: CromboloConfig
  kind: SchemaTypeKind
  described: DescribedKind
  type: SchemaContentType
  file: string
}

/** The type an alias names, among content, element, media and member types; never a guess. */
export async function findType(alias: string, kind?: string): Promise<FoundType> {
  const config = await siteConfig()
  needSchemaDir(config)
  const loaded = loadTypes(config)
  refuseProblems(loaded.problems, config.schemaDir)
  const content = loaded.set.contentTypes
  const lists: Array<[DescribedKind, SchemaTypeKind, readonly SchemaContentType[]]> = [
    ['content', 'document', content.filter((t) => !t.isElement)],
    ['element', 'document', content.filter((t) => t.isElement)],
    ['media', 'media', loaded.set.mediaTypes ?? []],
    ['member', 'member', loaded.set.memberTypes ?? []],
  ]
  const wanted = alias.toLowerCase()
  const matches = lists
    .filter(([described]) => !kind || described === kind)
    .flatMap(([described, schemaKind, types]) =>
      types
        .filter((t) => t.alias.toLowerCase() === wanted)
        .map((type) => ({ described, schemaKind, type })),
    )
  if (matches.length > 1)
    throw new CliError('usage', `"${alias}" names more than one kind of type.`, {
      hint: `Name one with --kind ${matches.map((m) => m.described).join(' or --kind ')}.`,
    })
  const match = matches[0]
  if (!match)
    throw new CliError('not_found', `The site has no type called "${alias}".`, {
      hint: '`crombolo types list` lists them.',
    })
  const { described, schemaKind, type } = match
  return {
    config,
    kind: schemaKind,
    described,
    type,
    file:
      loaded.files.get(typeFileKey(schemaKind, type.alias)) ??
      join(config.schemaDir, TYPE_KIND_FILES[schemaKind].dir, fileNameFor(type.alias)),
  }
}

/** The flags every definition edit takes, here only. */
export interface LocalEditFlags {
  'dry-run'?: boolean
  'no-apply'?: boolean
}

/** A type edit's flags: here, and with --to, a hosted site too. */
export interface EditFlags extends LocalEditFlags, ToFlags {}

/** Only what makes an edit local, for a command whose own flags share a name with --to's. */
export const localOnly = (flags: LocalEditFlags): LocalEditFlags => ({
  'dry-run': flags['dry-run'],
  'no-apply': flags['no-apply'],
})

export interface EditOutcome {
  type: string
  changed: boolean
  applied: boolean
  /** What the check said the change does to the site's content. */
  findings: string[]
  schema: string | null
  /** What the --to site did with it; null without --to. */
  hosted: HostedOutcome | null
}

/** A definition's file as it is, and as a change would write it (null removes it). */
export interface DefinitionChange {
  config: CromboloConfig
  alias: string
  file: string
  /** How it is written now. */
  current: string
  /** How it would be written; null removes it. */
  next: string | null
}

/**
 * Checks a change to any definition against a copy of the site's definitions
 * and, unless it is a dry run, writes it and applies it, putting the file back
 * when the apply is refused (stories 248, 249, 251).
 */
export async function commitDefinitionEdit(
  io: Io,
  definition: DefinitionChange,
  change: string[],
  flags: EditFlags & { retire?: boolean },
): Promise<EditOutcome> {
  const { config, alias, file, next } = definition
  if (next !== null && next === definition.current) {
    io.say(`  ${alias} is already so: nothing to change.`)
    return {
      type: alias,
      changed: false,
      applied: false,
      findings: [],
      schema: null,
      hosted: null,
    }
  }
  return commitFileEdits(io, { config, alias, edits: [{ file, next }] }, change, flags)
}

/**
 * The same as `commitDefinitionEdit`, for a command that names no file (the
 * site's definitions, story 254): a refusal's problems say what and where in
 * the definition, never which file holds it.
 */
export async function commitDefinitionEditUnnamed(
  io: Io,
  definition: DefinitionChange,
  change: string[],
  flags: EditFlags & { retire?: boolean },
): Promise<EditOutcome> {
  try {
    return await commitDefinitionEdit(io, definition, change, flags)
  } catch (error) {
    if (!(error instanceof CliError) || !Array.isArray(error.details)) throw error
    throw new CliError(error.kind, error.message, {
      hint: error.hint,
      details: error.details.map((detail) => {
        if (!detail || typeof detail !== 'object') return detail
        const { file: _file, line: _line, ...rest } = detail as Record<string, unknown>
        return rest
      }),
    })
  }
}

/** A file a change writes; null removes it. */
export interface FileEdit {
  file: string
  next: string | null
}

/**
 * Several files changed as one (story 250): those among the definitions are
 * checked against a copy first, then all are written and applied, and all put
 * back as they were when the apply is refused.
 */
export async function commitFileEdits(
  io: Io,
  { config, alias, edits }: { config: CromboloConfig; alias: string; edits: FileEdit[] },
  change: string[],
  flags: EditFlags & { retire?: boolean },
): Promise<EditOutcome> {
  const before = await Promise.all(
    edits.map(async ({ file }) => (existsSync(file) ? await readFile(file, 'utf8') : null)),
  )
  const findings = await checkAgainstCopy(config, edits, flags.retire === true)
  const hosted = await HostedChange.prepare(
    io,
    config,
    flags.to ? schemaWritesOf(config, edits, flags.to) : {},
    flags,
    { retire: flags.retire === true },
  )
  for (const line of change) io.say(`  ${line}`)
  for (const finding of findings) io.say(`  note     ${finding}`)
  if (flags['dry-run']) {
    io.say('\nNothing was changed (--dry-run).')
    return {
      type: alias,
      changed: false,
      applied: false,
      findings,
      schema: null,
      hosted: hosted?.planned() ?? null,
    }
  }
  const putBack = () =>
    Promise.all(
      edits.map(({ file }, i) => {
        const was = before[i]
        return was === null || was === undefined ? rm(file, { force: true }) : writeFile(file, was)
      }),
    )
  try {
    for (const { file, next } of edits)
      if (next === null) await rm(file, { force: true })
      else {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, next)
      }
  } catch (error) {
    await putBack()
    throw error
  }
  let schema: string | null = null
  if (flags['no-apply']) io.say('\nNot applied here yet: `crombolo types sync` applies it.')
  else
    try {
      schema = describeSync(
        await applySchema(io, config, { forceRetireTypes: flags.retire === true }),
      )
    } catch (error) {
      // Put back what was there: a definition the site cannot apply is no change.
      await putBack()
      throw error
    }
  const there = hosted ? await hosted.apply(io, config) : undefined
  // The site's later version came into schema.toml: this database takes it too.
  if (there?.raised && !flags['no-apply']) schema = describeSync(await applySchema(io, config))
  return {
    type: alias,
    changed: true,
    applied: !flags['no-apply'],
    findings,
    schema,
    hosted: there ? withoutRaised(there) : null,
  }
}

/** A change to a content, element, media or member type (story 248). */
export function commitTypeEdit(
  io: Io,
  found: FoundType,
  result: EditResult | { ok: true; type: null },
  change: string[],
  flags: EditFlags & { retire?: boolean },
): Promise<EditOutcome> {
  if (!result.ok) throw new CliError('refused', `Nothing was changed: ${result.reason}.`)
  const { config, kind, type, file } = found
  return commitDefinitionEdit(
    io,
    {
      config,
      alias: type.alias,
      file,
      current: writeContentType(type, kind),
      next: result.type ? writeContentType(result.type, kind) : null,
    },
    change,
    flags,
  )
}

/** A data type the site defines, found by its alias, with where it is kept (story 249). */
export interface FoundDataType {
  config: CromboloConfig
  dataType: SchemaDataType
  file: string
}

/** The site's own data type an alias names; a built-in one is refused, since every site shares it. */
export async function findDataType(alias: string): Promise<FoundDataType> {
  const config = await siteConfig()
  needSchemaDir(config)
  const loaded = loadTypes(config)
  refuseProblems(loaded.problems, config.schemaDir)
  const wanted = alias.toLowerCase()
  const dataType = loaded.set.dataTypes.find((d) => d.alias.toLowerCase() === wanted)
  if (!dataType) {
    if (BUILTIN_DATA_TYPES.some((d) => d.alias.toLowerCase() === wanted))
      throw new CliError(
        'refused',
        `"${alias}" is built in: every site has it the same, so it is not changed here.`,
        {
          hint: `Make the site's own with \`crombolo types new data-type <alias> --editor <editor>\`, and use that.`,
        },
      )
    throw new CliError('not_found', `The site has no data type called "${alias}".`, {
      hint: '`crombolo types list --kind data` lists them.',
    })
  }
  return {
    config,
    dataType,
    file:
      loaded.files.get(`data-type:${dataType.alias}`) ??
      join(config.schemaDir, 'data-types', fileNameFor(dataType.alias)),
  }
}

/** A change to one of the site's data types (story 249). */
export function commitDataTypeEdit(
  io: Io,
  found: FoundDataType,
  next: SchemaDataType | null,
  change: string[],
  flags: EditFlags,
): Promise<EditOutcome> {
  return commitDefinitionEdit(
    io,
    {
      config: found.config,
      alias: found.dataType.alias,
      file: found.file,
      current: writeDataType(found.dataType),
      next: next ? writeDataType(next) : null,
    },
    change,
    flags,
  )
}

/** What applying the change would do, from a copy of the definitions; refused when it cannot be applied. */
async function checkAgainstCopy(
  config: CromboloConfig,
  edits: readonly FileEdit[],
  retire: boolean,
): Promise<string[]> {
  const copy = mkdtempSync(join(tmpdir(), 'crombolo-type-edit-'))
  try {
    cpSync(config.schemaDir, copy, { recursive: true })
    for (const { file, next } of edits) {
      const within = relative(config.schemaDir, file)
      // Content files and views are not definitions: the check is of the definitions alone.
      if (within.startsWith('..') || isAbsolute(within)) continue
      const inCopy = join(copy, within)
      if (next === null) rmSync(inCopy, { force: true })
      else {
        mkdirSync(dirname(inCopy), { recursive: true })
        writeFileSync(inCopy, next)
      }
    }
    const overlay = { ...config, schemaDir: copy }
    const loaded = loadTypes(overlay)
    const problems = [
      ...loaded.problems,
      ...validateSchemaSet(loaded.set, {
        componentAliases: componentAliasesIn(config.componentsDir),
        types: formTypesFor(config),
      }),
    ]
    if (problems.length > 0)
      throw new CliError('refused', 'Nothing was changed: the site would not accept it.', {
        details: problemsOf(problems, overlay.schemaDir),
      })
    const { db } = await bootstrapDatabase(config)
    try {
      const report = await checkSchemaDirectory(db, overlay, {
        nodeId: config.nodeId,
        revision: config.schemaRevision,
      })
      const outstanding = report.outstanding.filter(
        (f) => !(retire && f.code === 'type-removed-with-content'),
      )
      if (outstanding.length > 0 || report.classification === 'breaking')
        throw new CliError('refused', "Nothing was changed: it would change the site's content.", {
          hint: outstanding.some((f) => f.code === 'type-removed-with-content')
            ? '--retire retires the type and keeps its items.'
            : undefined,
          details: outstanding.map((f) => f.message),
        })
      return report.findings
        .filter((f) => f.kind === 'auto' || f.kind === 'person')
        .map((f) => f.message)
    } finally {
      await db.close()
    }
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
}

const withoutRaised = ({ raised: _, ...outcome }: HostedOutcome & { raised: boolean }) => outcome

/** The flags every type-editing command takes. */
export const editFlags = {
  kind: Flags.string({
    summary: 'the kind, when two types share the alias',
    options: [...TYPE_KINDS],
  }),
  'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
  'no-apply': Flags.boolean({
    summary: 'change it, and leave applying it here to `crombolo types sync`',
  }),
  ...toFlags,
}

/** What every type-editing command answers with. */
export const editSpec = {
  effects: 'idempotent',
  cardinality: 'single',
  outputFields: [
    { name: 'type', type: 'string' },
    { name: 'changed', type: 'boolean' },
    { name: 'applied', type: 'boolean' },
    { name: 'findings', type: 'array', items: { type: 'string' } },
    { name: 'schema', type: 'string', nullable: true },
    {
      name: 'hosted',
      type: 'object',
      nullable: true,
      description: 'with --to: what that site did',
    },
  ],
  errors: ['not_found', 'usage', 'refused', 'conflict', 'confirmation_required', 'unavailable'],
} as const

/** "Content type", "Element type"… for a message. */
export const KIND_NOUNS: Record<DescribedKind, string> = {
  content: 'content type',
  element: 'element type',
  media: 'media type',
  member: 'member type',
  data: 'data type',
}

/**
 * A picker's start node from a path (story 249): a page from the site's content
 * files by the key its path gives, the same in every environment; otherwise this
 * site's page, said so; or why there is none.
 */
export async function startNodeAt(io: Io, config: CromboloConfig, path: string): Promise<string> {
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.trim().toLowerCase().replace(/\s+/g, '-'))
  if (segments.length === 0)
    throw new CliError('usage', '--start-at wants a page’s path, such as /Home/News.')
  if (existsSync(join(config.siteDir, 'content', 'pages', `${segments.join('/')}.toml`)))
    return seedKey(`content/${segments.join('/')}`)
  if (config.dialect === 'sqlite' && !existsSync(config.sqliteFile))
    throw new CliError(
      'not_found',
      `There is no page at ${path} in the site's content files, and no database to look in.`,
    )
  const db = await connect({ dialect: config.dialect, file: config.sqliteFile })
  try {
    const found = await resolveNodeRef(db, [ObjectTypes.Document], path)
    if (!found.ok) throw new CliError('not_found', `There is no page at ${path}.`)
    io.say(
      `  note     ${path} is a page of this site, not one of its content files: the start node names it here only.`,
    )
    return found.node.key
  } finally {
    await db.close()
  }
}
