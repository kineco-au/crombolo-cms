/**
 * What the form commands share (story 251): finding a form, what uses it on
 * this site, and committing a change through the same check every definition
 * goes through (`type-edit.ts`). A form is named by its alias.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FormCondition, FormSettingValue, SchemaForm } from '@crombolo/core'
import { connect, type Db } from '@crombolo/data'
import {
  type FormEditResult,
  type FormFieldChanges,
  fileNameFor,
  formConditionFrom,
  writeForm,
} from '@crombolo/schema'
import type { CromboloConfig } from '@crombolo/server'
import { Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import type { Io } from './site.ts'
import { siteConfig } from './site.ts'
import { commitDefinitionEdit, type EditFlags, type EditOutcome } from './type-edit.ts'
import { loadTypes, needSchemaDir, parseSet, refuseProblems } from './types.ts'

export interface FoundForm {
  config: CromboloConfig
  form: SchemaForm
  file: string
}

/** The form an alias names, with where it is kept. */
export async function findForm(alias: string): Promise<FoundForm> {
  const config = await siteConfig()
  needSchemaDir(config)
  const loaded = loadTypes(config)
  refuseProblems(loaded.problems, config.schemaDir)
  const form = (loaded.set.forms ?? []).find((f) => f.alias.toLowerCase() === alias.toLowerCase())
  if (!form)
    throw new CliError('not_found', `The site has no form called "${alias}".`, {
      hint: '`crombolo forms list` lists them.',
    })
  return {
    config,
    form,
    file:
      loaded.files.get(`form:${form.alias}`) ??
      join(config.schemaDir, 'forms', fileNameFor(form.alias)),
  }
}

/** A change to a form, checked and applied as every definition's is. */
export function commitFormEdit(
  io: Io,
  found: FoundForm,
  result: FormEditResult | { ok: true; form: null },
  change: string[],
  flags: EditFlags,
): Promise<EditOutcome> {
  if (!result.ok) throw new CliError('refused', `Nothing was changed: ${result.reason}.`)
  return commitDefinitionEdit(
    io,
    {
      config: found.config,
      alias: found.form.alias,
      file: found.file,
      current: writeForm(found.form),
      next: result.form ? writeForm(result.form) : null,
    },
    change,
    flags,
  )
}

/** What uses a form on this site: Library forms made from it, and pages whose form picker names it or one of them. */
export interface FormUsage {
  libraryForms: number
  pages: number
}

/** The id a form picker and a Library form store for a form. */
export const formIdOf = (form: SchemaForm) => (form.key ?? form.alias).toLowerCase()

async function usageIn(db: Db, form: SchemaForm): Promise<FormUsage> {
  const t = db.dialect.boolValue(true) as boolean
  const f = db.dialect.boolValue(false) as boolean
  const id = formIdOf(form)
  const libraryRows = await db.q
    .selectFrom('node as n')
    .innerJoin('content as c', 'c.node_id', 'n.id')
    .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
    .select('n.unique_id')
    .where('n.trashed', '=', f)
    .where((eb) => eb(eb.fn('lower', ['ct.form_key']), '=', id))
    .execute()
  const ids = [id, ...libraryRows.map((row) => String(row.unique_id).toLowerCase())]
  const picked = await db.q
    .selectFrom('property_value as pv')
    .innerJoin('property_type as pt', 'pt.id', 'pv.property_type_id')
    .innerJoin('data_type as dt', 'dt.node_id', 'pt.data_type_id')
    .innerJoin('node as n', 'n.id', 'pv.node_id')
    .select((eb) => eb.fn.count<number>('pv.node_id').distinct().as('n'))
    .where('dt.editor_alias', '=', 'Crombolo.FormPicker')
    .where('pv.is_current', '=', t)
    .where('n.trashed', '=', f)
    .where((eb) => {
      const quoted = ids.map((value) => JSON.stringify(value))
      return eb.or(
        (['pv.varchar_value', 'pv.text_value'] as const).flatMap((column) => [
          eb(eb.fn('lower', [column]), 'in', ids),
          eb(eb.fn('lower', [column]), 'in', quoted),
        ]),
      )
    })
    .execute()
  return { libraryForms: libraryRows.length, pages: Number(picked[0]?.n ?? 0) }
}

/** What uses the form, or undefined when the site has no database to say. Never creates one. */
export async function formUsage(
  config: CromboloConfig,
  form: SchemaForm,
): Promise<FormUsage | undefined> {
  if (
    config.dialect === 'sqlite' &&
    config.sqliteFile !== ':memory:' &&
    !existsSync(config.sqliteFile)
  )
    return undefined
  let db: Db
  try {
    db = await connect({ dialect: config.dialect, file: config.sqliteFile })
  } catch {
    return undefined
  }
  try {
    return await usageIn(db, form)
  } catch {
    return undefined
  } finally {
    await db.close()
  }
}

/** The flags every form-editing command takes. */
export const formEditFlags = {
  'dry-run': Flags.boolean({ summary: 'say what would change, and change nothing' }),
  'no-apply': Flags.boolean({
    summary: 'change it, and leave applying it to `crombolo types sync`',
  }),
}

/** Condition flags, for a field, page or fieldset. */
export const conditionFlags = {
  'show-when': Flags.string({
    summary:
      'show it only when another field has this value: <field>=<value>, or <field>!=<value>; give several for all of them',
    helpValue: '<field>=<value>',
    multiple: true,
  }),
  'show-when-any': Flags.boolean({
    summary: 'with --show-when: show it when any of them holds, not all',
  }),
  'show-always': Flags.boolean({ summary: 'take its condition away', exclusive: ['show-when'] }),
}

export const formEditSpec = {
  effects: 'idempotent',
  cardinality: 'single',
  outputFields: [
    { name: 'type', type: 'string' },
    { name: 'changed', type: 'boolean' },
    { name: 'applied', type: 'boolean' },
    { name: 'findings', type: 'array', items: { type: 'string' } },
    { name: 'schema', type: 'string', nullable: true },
  ],
  errors: ['not_found', 'usage', 'refused'],
} as const

/** The condition the condition flags describe: unchanged, taken away (null), or new. */
export function conditionOf(flags: {
  'show-when'?: string[]
  'show-when-any'?: boolean
  'show-always'?: boolean
}): FormCondition | null | undefined {
  if (flags['show-always']) return null
  if (!flags['show-when'] || flags['show-when'].length === 0) {
    if (flags['show-when-any'])
      throw new CliError('usage', '--show-when-any goes with --show-when.')
    return undefined
  }
  const condition = formConditionFrom(flags['show-when'], flags['show-when-any'] ? 'any' : 'all')
  if (typeof condition === 'string') throw new CliError('usage', `${condition}.`)
  return condition
}

/** A condition as a person reads it. */
export const describeCondition = (condition: FormCondition | null | undefined): string =>
  condition === null
    ? 'always shown'
    : condition
      ? `shown when ${condition.rules.map((r) => `${r.field} ${r.operator === 'isNot' ? 'is not' : 'is'} "${r.value ?? ''}"`).join(condition.match === 'any' ? ' or ' : ' and ')}`
      : ''

/** Where a field, page or fieldset goes, beside another. */
export const placeFlags = {
  before: Flags.string({
    summary: 'put it before this one',
    helpValue: '<name>',
    exclusive: ['after'],
  }),
  after: Flags.string({ summary: 'put it after this one', helpValue: '<name>' }),
}

/** A page or fieldset, named by its caption or its number from 1. */
export const pageFlag = Flags.string({
  summary: 'the page, by its caption or its number from 1',
  helpValue: '<page>',
})
export const groupFlag = Flags.string({
  summary: 'the fieldset, by its caption or its number from 1',
  helpValue: '<fieldset>',
})

/** What a field's flags set: `forms field add` and `forms field update` take the same. */
export const fieldFlags = {
  caption: Flags.string({ summary: 'the words beside it', helpValue: '<text>' }),
  help: Flags.string({ summary: 'help text beneath it', helpValue: '<text>' }),
  mandatory: Flags.boolean({ summary: 'it must be filled in', allowNo: true }),
  'mandatory-message': Flags.string({
    summary: 'what a visitor is told when it is left empty',
    helpValue: '<text>',
  }),
  pattern: Flags.string({ summary: 'a pattern its answer must match', helpValue: '<pattern>' }),
  'pattern-message': Flags.string({
    summary: 'what a visitor is told when it does not match',
    helpValue: '<text>',
  }),
  sensitive: Flags.boolean({
    summary: 'only people allowed to see sensitive answers see it',
    allowNo: true,
  }),
  placeholder: Flags.string({ summary: 'the hint shown in it while empty', helpValue: '<text>' }),
  default: Flags.string({ summary: 'the answer it starts with', helpValue: '<text>' }),
  option: Flags.string({
    summary: 'a choice; give each, in order',
    helpValue: '<choice>',
    multiple: true,
  }),
  set: Flags.string({
    summary: "a bundle field type's setting, stored as given; JSON when it parses",
    helpValue: '<setting>=<value>',
    multiple: true,
  }),
  ...conditionFlags,
}

/** The field changes those flags describe, and how to say them. */
export function fieldChangesOf(
  flags: {
    type?: string
    caption?: string
    help?: string
    mandatory?: boolean
    'mandatory-message'?: string
    pattern?: string
    'pattern-message'?: string
    sensitive?: boolean
    placeholder?: string
    default?: string
    option?: string[]
    set?: string[]
    'show-when'?: string[]
    'show-when-any'?: boolean
    'show-always'?: boolean
  },
  set: Record<string, FormSettingValue> | undefined,
): { changes: FormFieldChanges; said: string[] } {
  const condition = conditionOf(flags)
  const changes: FormFieldChanges = {
    type: flags.type,
    caption: flags.caption,
    helpText: flags.help,
    mandatory: flags.mandatory,
    mandatoryMessage: flags['mandatory-message'],
    pattern: flags.pattern,
    patternMessage: flags['pattern-message'],
    sensitive: flags.sensitive,
    placeholder: flags.placeholder,
    defaultValue: flags.default,
    values: flags.option,
    settings: set,
    condition,
  }
  const yes = (flag: boolean | undefined, on: string, off: string) =>
    flag === undefined ? [] : [`  ${flag ? on : off}`]
  const said = [
    ...(flags.type ? [`  a ${flags.type} field`] : []),
    ...(flags.caption ? [`  captioned "${flags.caption}"`] : []),
    ...(flags.help !== undefined ? [flags.help ? '  with help text' : '  no help text'] : []),
    ...yes(flags.mandatory, 'must be filled in', 'may be left empty'),
    ...(flags.pattern !== undefined
      ? [flags.pattern ? `  must match ${flags.pattern}` : '  no pattern']
      : []),
    ...yes(flags.sensitive, 'sensitive', 'not sensitive'),
    ...(flags.option ? [`  choices: ${flags.option.join(', ')}`] : []),
    ...Object.entries(set ?? {}).map(([key, value]) => `  ${key} = ${JSON.stringify(value)}`),
    ...(condition !== undefined ? [`  ${describeCondition(condition)}`] : []),
  ]
  return { changes, said }
}

/** `--set` pairs, stored as given: JSON when the value parses, text otherwise. */
export function settingsOf(
  pairs: readonly string[] | undefined,
): Record<string, FormSettingValue> | undefined {
  if (!pairs || pairs.length === 0) return undefined
  for (const pair of pairs)
    if (!pair.includes('='))
      throw new CliError('usage', `--set wants <setting>=<value>, not "${pair}".`)
  return parseSet(pairs) as Record<string, FormSettingValue>
}

/** A form workflow's settings: the common ones by name, any by --set. */
export const workflowFlags = {
  on: Flags.string({
    summary: 'when it runs: when an entry is sent, or when one is approved',
    options: ['submit', 'approve'],
  }),
  to: Flags.string({
    summary: 'e-mail: who it is sent to; give each',
    helpValue: '<address>',
    multiple: true,
  }),
  subject: Flags.string({ summary: 'e-mail: its subject', helpValue: '<text>' }),
  url: Flags.string({
    summary: 'send to a URL: the address entries are sent to',
    helpValue: '<url>',
  }),
  set: Flags.string({
    summary: 'any setting, stored as given; JSON when it parses',
    helpValue: '<setting>=<value>',
    multiple: true,
  }),
}

/** The settings the workflow flags give. */
export function workflowSettingsOf(flags: {
  to?: string[]
  subject?: string
  url?: string
  set?: string[]
}): {
  settings: Record<string, unknown>
  said: string[]
} {
  const settings: Record<string, unknown> = {
    ...(flags.to ? { to: flags.to.join(', ') } : {}),
    ...(flags.subject !== undefined ? { subject: flags.subject } : {}),
    ...(flags.url !== undefined ? { url: flags.url } : {}),
    ...settingsOf(flags.set),
  }
  return {
    settings,
    said: Object.entries(settings).map(([key, value]) => `  ${key} = ${JSON.stringify(value)}`),
  }
}

const letters = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** A type name as the form keeps it, given in either style: `long-answer` or `longAnswer` (story 254). */
export function typeNamed(given: string | undefined, known: Iterable<string>): string | undefined {
  if (given === undefined) return undefined
  return [...known].find((name) => letters(name) === letters(given)) ?? given
}
