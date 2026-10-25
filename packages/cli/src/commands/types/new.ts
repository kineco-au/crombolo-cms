import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DATA_TYPE_PRESETS,
  fileNameFor,
  newType,
  type PresetOptions,
  presetDataType,
  type SchemaSet,
  type SchemaTypeKind,
  TYPE_KIND_FILES,
  viewScaffold,
  writeContentType,
  writeDataType,
} from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { describeSync, here } from '../../support/describe.ts'
import { siteConfig } from '../../support/site.ts'
import { applySchema, loadTypes, needSchemaDir, refuseOwnProblems } from '../../support/types.ts'

const TYPE_KINDS: Record<string, SchemaTypeKind> = {
  'content-type': 'document',
  'media-type': 'media',
  'member-type': 'member',
}

const TYPE_ONLY = [
  'description',
  'icon',
  'at-root',
  'element',
  'tab',
  'no-view',
  'compose',
  'allow-child',
  'vary-by-culture',
  'vary-by-segment',
  'library',
  'list-view',
  'list-view-type',
] as const

const many = (summary: string, helpValue: string) =>
  Flags.string({ summary, helpValue, multiple: true })

/** A type or data type file, the view a content type points at, then applied. */
export default class TypesNew extends BaseCommand {
  static override summary =
    'write a type or data type file, and the view it points at, then apply it'
  static override examples = [
    '<%= config.bin %> types new content-type article --at-root',
    '<%= config.bin %> types new content-type blog --at-root --allow-child article --list-view',
    '<%= config.bin %> types new data-type pageBlocks --editor block-list --block feature --block quote',
  ]
  static override aliases = ['schema:new']
  static override deprecateAliases = true
  static override args = {
    kind: Args.string({
      required: true,
      options: [...Object.keys(TYPE_KINDS), 'data-type'],
      description: 'what kind of type',
    }),
    alias: Args.string({ required: true, description: "the type's alias" }),
  }
  static override flags = {
    name: Flags.string({ summary: "the type's name", helpValue: '<name>' }),
    description: Flags.string({ summary: "the type's description", helpValue: '<text>' }),
    icon: Flags.string({ summary: "the type's icon", helpValue: '<icon>' }),
    'at-root': Flags.boolean({ summary: 'allow it at the root of the tree' }),
    element: Flags.boolean({ summary: 'an element type, for blocks' }),
    tab: Flags.string({ summary: 'the tab its first property goes in', helpValue: '<tab>' }),
    'no-view': Flags.boolean({ summary: 'no view: a type nothing renders' }),
    compose: many('a type it is composed of', '<alias>'),
    'allow-child': many('a type allowed beneath it', '<alias>'),
    'vary-by-culture': Flags.boolean({ summary: 'its content differs by language' }),
    'vary-by-segment': Flags.boolean({ summary: 'its content differs by segment' }),
    library: Flags.boolean({ summary: 'it may be created in the Library' }),
    'list-view': Flags.boolean({ summary: 'show the pages beneath it as a list' }),
    'list-view-type': Flags.string({
      summary: 'the list view data type, instead of the default',
      helpValue: '<alias>',
    }),
    editor: Flags.string({
      summary: 'data types: the editor it uses',
      options: Object.keys(DATA_TYPE_PRESETS),
    }),
    'max-chars': Flags.integer({ summary: 'data types: the most characters allowed' }),
    rows: Flags.integer({ summary: 'data types: the rows a text area shows' }),
    min: Flags.integer({ summary: 'data types: the least allowed (number, items)' }),
    max: Flags.integer({ summary: 'data types: the most allowed (number, items)' }),
    step: Flags.integer({ summary: 'data types: the step between numbers' }),
    'default-on': Flags.boolean({ summary: 'data types: a toggle starts on' }),
    label: Flags.string({ summary: "data types: a toggle's label", helpValue: '<text>' }),
    'with-time': Flags.boolean({ summary: 'data types: a date with a time of day' }),
    option: many('data types: a dropdown choice', '<value>'),
    multiple: Flags.boolean({ summary: 'data types: more than one may be chosen' }),
    allow: many('data types: a type a picker offers', '<alias>'),
    block: many('data types: an element type offered as a block', '<alias>'),
    columns: Flags.integer({ summary: 'data types: the columns a block grid has' }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'created', type: 'array', items: { type: 'string' } },
      { name: 'schema', type: 'string' },
    ],
    errors: ['not_found', 'conflict', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(TypesNew)
    const config = await siteConfig()
    needSchemaDir(config)
    const loaded = loadTypes(config)
    if (args.kind === 'data-type') return this.newDataType(args.alias, flags, config, loaded.set)
    if (flags.editor) this.fail('refused', '--editor is for data types.')
    const kind = TYPE_KINDS[args.kind] as SchemaTypeKind
    const existing = [
      ...loaded.set.contentTypes,
      ...(loaded.set.mediaTypes ?? []),
      ...(loaded.set.memberTypes ?? []),
    ]
    if (existing.some((type) => type.alias === args.alias))
      this.fail('conflict', `There is already a type with the alias "${args.alias}".`)

    const element = flags.element
    const type = newType({
      alias: args.alias,
      kind,
      name: flags.name,
      description: flags.description,
      icon: flags.icon,
      allowAtRoot: flags['at-root'],
      element,
      template: !flags['no-view'],
      // A content type with nothing in it cannot be published, so it starts with
      // the one property every page has; the other kinds get what they are given.
      tab: kind === 'document' ? (flags.tab ?? 'Content') : undefined,
      compose: flags.compose,
      allowChildren: flags['allow-child'],
      variesByCulture: flags['vary-by-culture'],
      variesBySegment: flags['vary-by-segment'],
      library: flags.library,
      listView: flags['list-view-type'] ?? (flags['list-view'] ? 'listViewContent' : undefined),
    })
    if (
      kind !== 'document' &&
      (type.allowChildren.length > 0 || flags['list-view'] || flags['list-view-type'])
    )
      this.fail('refused', '--allow-child and --list-view are for content types.')
    const kinds = { document: 'contentTypes', media: 'mediaTypes', member: 'memberTypes' } as const
    refuseOwnProblems(
      { ...loaded.set, [kinds[kind]]: [...(loaded.set[kinds[kind]] ?? []), type] },
      `schema/${TYPE_KIND_FILES[kind].dir}/${args.alias}`,
    )

    const created: string[] = []
    const file = join(config.schemaDir, TYPE_KIND_FILES[kind].dir, fileNameFor(args.alias))
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, writeContentType(type, kind))
    created.push(here(file))
    this.say(`  created  ${here(file)}`)

    // A type nothing allows cannot be created anywhere, which is a confusing
    // first five minutes: the editor simply never offers it.
    if (kind === 'document' && !element && !type.allowAtRoot) {
      const parents = loaded.set.contentTypes.filter((t) => t.allowChildren.includes(args.alias))
      if (parents.length === 0)
        this.say(
          `  note     nothing allows a "${args.alias}" yet — add it to a parent's allow-children, or pass --at-root`,
        )
    }

    if (type.components.length > 0) {
      const view = join(config.componentsDir, `${args.alias}.tsx`)
      if (existsSync(view)) this.say(`  exists   ${here(view)}`)
      else {
        await mkdir(join(view, '..'), { recursive: true })
        await writeFile(view, viewScaffold(type))
        created.push(here(view))
        this.say(`  created  ${here(view)}`)
      }
    }
    const report = await applySchema(this, config)
    return { created, schema: describeSync(report) }
  }

  private async newDataType(
    alias: string,
    flags: Awaited<ReturnType<TypesNew['parse']>>['flags'],
    config: Awaited<ReturnType<typeof siteConfig>>,
    set: SchemaSet,
  ) {
    const typeFlags = TYPE_ONLY.filter((flag) => flags[flag] !== undefined && flags[flag] !== false)
    if (typeFlags.length > 0)
      this.fail(
        'refused',
        `${typeFlags.map((f) => `--${f}`).join(', ')} are for types, not data types.`,
      )
    if (!flags.editor)
      this.fail(
        'refused',
        `A data type needs --editor: one of ${Object.keys(DATA_TYPE_PRESETS).join(', ')}.`,
      )
    if (set.dataTypes.some((d) => d.alias === alias))
      this.fail('conflict', `There is already a data type with the alias "${alias}".`)
    const options: PresetOptions = {
      maxChars: flags['max-chars'],
      rows: flags.rows,
      min: flags.min,
      max: flags.max,
      step: flags.step,
      defaultOn: flags['default-on'] || undefined,
      label: flags.label,
      withTime: flags['with-time'] || undefined,
      option: flags.option,
      multiple: flags.multiple || undefined,
      allow: flags.allow,
      block: flags.block,
      columns: flags.columns,
    }
    const built = presetDataType(alias, flags.editor, options, flags.name)
    if (!built.ok) this.fail('refused', `${built.reason}.`)
    refuseOwnProblems(
      { ...set, dataTypes: [...set.dataTypes, built.dataType] },
      `schema/data-types/${alias}`,
    )
    const file = join(config.schemaDir, 'data-types', fileNameFor(alias))
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, writeDataType(built.dataType))
    this.say(`  created  ${here(file)}`)
    const report = await applySchema(this, config)
    return { created: [here(file)], schema: describeSync(report) }
  }
}
