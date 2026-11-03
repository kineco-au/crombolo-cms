import {
  type DataTypeDetail,
  DESCRIBED_KINDS,
  type DescribedKind,
  describeType,
  type TypeDetail,
  type Use,
} from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { typeUses } from '../../support/rename-references.ts'
import { appliedSchema, appliedStateOf, itemsOf } from '../../support/schema-view.ts'
import { siteConfig } from '../../support/site.ts'
import { loadTypes, needSchemaDir } from '../../support/types.ts'

const KIND_NAMES: Record<DescribedKind, string> = {
  content: 'Content type',
  element: 'Element type',
  media: 'Media type',
  member: 'Member type',
  data: 'Data type',
}

const SCHEMA_KINDS = {
  content: 'document',
  element: 'document',
  media: 'media',
  member: 'member',
} as const

const listed = (values: readonly string[]) => (values.length > 0 ? values.join(', ') : 'none')

const used = (use: Use) =>
  `${use.by}${use.property ? `.${use.property}` : ''} (${KIND_NAMES[use.byKind].toLowerCase()}): ${use.how}`

const shown = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value))

/** One content, element, media, member or data type, in full (story 247). */
export default class TypesShow extends BaseCommand {
  static override summary = 'one content, element, media, member or data type, and what uses it'
  static override description = [
    "A type's settings, its tabs and properties in order, and what uses it: other types' allowed children and compositions, block lists and pickers. A data type's editor, its settings and the properties that use it.",
    'An alias two kinds share is refused: name one with --kind.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> types show article',
    '<%= config.bin %> types show image --kind media',
  ]
  static override args = {
    alias: Args.string({ required: true, description: "the type's or data type's alias" }),
  }
  static override flags = {
    kind: Flags.string({
      summary: 'the kind, when two share the alias',
      options: [...DESCRIBED_KINDS],
    }),
    'from-database': Flags.boolean({
      summary: 'what the database has applied, not what the site defines',
    }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    stdoutSchema: {},
    errors: ['not_found', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(TypesShow)
    const config = await siteConfig()
    needSchemaDir(config)
    const files = loadTypes(config).set
    const applied = await appliedSchema(config, files.version)
    const live = 'unavailable' in applied ? undefined : applied
    const unavailable = 'unavailable' in applied ? applied.unavailable : null
    if (flags['from-database'] && !live)
      throw new CliError('unavailable', `There is nothing applied to show: ${unavailable}.`)
    const set = flags['from-database'] && live ? live.set : files
    const result = describeType(set, args.alias, flags.kind as DescribedKind | undefined)
    if (!result.ok && result.reason === 'ambiguous')
      throw new CliError(
        'usage',
        `"${args.alias}" is a ${result.kinds.map((k) => KIND_NAMES[k].toLowerCase()).join(' and a ')}.`,
        {
          hint: `Name one with --kind ${result.kinds.join(' or --kind ')}.`,
        },
      )
    if (!result.ok)
      throw new CliError('not_found', `The site has no type or data type called "${args.alias}".`, {
        hint: '`crombolo types list` lists them.',
      })
    const found = result.found
    const items = live ? itemsOf(live, found.kind, found.alias) : null
    const state =
      live && !flags['from-database'] ? appliedStateOf(files, live, found.kind, found.alias) : null
    if (found.kind === 'data') this.#data(found)
    else this.#type(found)
    if (items !== null) this.say(`  items      ${items}`)
    if (state) this.say(`  applied    ${state === 'applied' ? 'yes' : state}`)
    this.say(found.usedBy.length > 0 ? '\nUsed by' : '\nUsed by nothing else.')
    for (const use of found.usedBy) this.say(`  ${used(use)}`)
    const site =
      found.kind === 'data' ? null : typeUses(config, files, SCHEMA_KINDS[found.kind], found.alias)
    if (site?.contentFiles.length) {
      this.say('\nUsed in content files')
      for (const where of site.contentFiles) this.say(`  ${where}`)
    }
    if (site?.views.length) {
      this.say('\nUsed in views')
      for (const where of site.views) this.say(`  ${where}`)
    }
    this.say(
      found.kind === 'data'
        ? `\n\`crombolo types property add <type> <alias> --type ${found.alias}\` uses it in a type.`
        : `\n\`crombolo types property add ${found.alias} <alias> --type <data type>\` adds a property.`,
    )
    return {
      ...found,
      items,
      applied: state,
      database: unavailable,
      ...(site ? { usedInContentFiles: site.contentFiles, usedInViews: site.views } : {}),
    }
  }

  #type(t: TypeDetail) {
    this.say(`${KIND_NAMES[t.kind]} "${t.name}" (${t.alias})`)
    if (t.description) this.say(`  ${t.description}`)
    const traits = [
      t.icon ? `icon ${t.icon}` : '',
      t.allowAtRoot ? 'allowed at the root' : '',
      t.variesByCulture ? 'varies by language' : '',
      t.variesBySegment ? 'varies by segment' : '',
      t.library ? 'in the Library' : '',
      t.listView ? 'shows its children as a list' : '',
    ].filter(Boolean)
    if (traits.length > 0) this.say(`  ${traits.join(' · ')}`)
    if (t.kind === 'content') {
      this.say(`  children   ${listed(t.allowChildren)}`)
      this.say(
        `  views      ${t.views.length > 0 ? t.views.map((v) => (v === t.defaultView ? `${v} (default)` : v)).join(', ') : 'none'}`,
      )
    }
    this.say(`  composed of ${listed(t.compositions)}`)
    let place: string | undefined
    for (const p of t.properties) {
      const where = [p.tab, p.group].filter(Boolean).join(' / ') || 'Not in a tab'
      if (where !== place) {
        place = where
        this.say(`\n  ${where}`)
      }
      const notes = [
        p.mandatory ? 'mandatory' : '',
        p.variesByCulture ? 'varies by language' : '',
        p.variesBySegment ? 'varies by segment' : '',
        p.from ? `from ${p.from}${p.via ? ` through ${p.via}` : ''}` : '',
      ]
        .filter(Boolean)
        .join(', ')
      this.say(
        `    ${p.alias.padEnd(24)} ${p.name.padEnd(24)} ${p.dataType}${notes ? `  ${notes}` : ''}`,
      )
    }
    if (t.properties.length === 0) this.say('\n  No properties.')
  }

  #data(d: DataTypeDetail) {
    this.say(`${KIND_NAMES.data} "${d.name}" (${d.alias})${d.builtIn ? ', built in' : ''}`)
    this.say(`  editor     ${d.editor}`)
    for (const s of d.settings) this.say(`  ${(s.label ?? s.setting).padEnd(28)} ${shown(s.value)}`)
    for (const b of d.blocks)
      this.say(
        `  block      ${b.label ? `${b.label} (${b.element})` : b.element}${b.settings ? `, settings ${b.settings}` : ''}`,
      )
  }
}
