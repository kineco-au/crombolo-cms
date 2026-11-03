import { describeType, type PresetOptions, updateDataType, updateType } from '@crombolo/schema'
import { Args, Flags, type Interfaces } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { siteConfig } from '../../support/site.ts'
import {
  commitDataTypeEdit,
  commitTypeEdit,
  editFlags,
  editSpec,
  findDataType,
  findType,
  KIND_NOUNS,
  startNodeAt,
  TYPE_KINDS,
} from '../../support/type-edit.ts'
import { loadTypes, parseSet } from '../../support/types.ts'

const many = (summary: string, helpValue: string) =>
  Flags.string({ summary, helpValue, multiple: true })
const yesNo = (summary: string) => Flags.boolean({ summary, allowNo: true })

/** The flags that change a type, and those that change a data type. */
const TYPE_FLAGS = [
  'name',
  'description',
  'icon',
  'at-root',
  'element',
  'library',
  'vary-by-culture',
  'vary-by-segment',
  'list-view',
  'allow-child',
  'disallow-child',
  'compose',
  'decompose',
  'view',
  'remove-view',
  'default-view',
] as const
const DATA_FLAGS = [
  'set',
  'unset',
  'max-chars',
  'rows',
  'min',
  'max',
  'step',
  'default-on',
  'label',
  'with-time',
  'option',
  'multiple',
  'allow',
  'columns',
  'add-block',
  'block-label',
  'block-settings',
  'remove-block',
  'start-at',
] as const

/** A type's settings, children, compositions and views (story 248), or a data type's settings and blocks (249). */
export default class TypesUpdate extends BaseCommand {
  static override summary = "change a type's or a data type's settings"
  static override description = [
    "A type: its settings, allowed children, compositions and views. A data type: any setting, stored as given with --set (it takes effect when the editor uses that name), the named settings `types new data-type` takes, a block list's blocks, and a picker's allowed types and start node.",
    'Checked against the site first: a change its content cannot take is refused with the reason, and nothing is written. Then applied, unless --no-apply. Built-in data types are not changed: make the site its own with `types new data-type`.',
    'Each --no- form turns a setting off: --no-at-root, --no-library. `--list-view none` and `--start-at none` take one away.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> types update article --name "News story" --allow-child quote',
    '<%= config.bin %> types update shortText --max-chars 80',
    '<%= config.bin %> types update gallery --set multiple=true --set \'validationLimit={"max":12}\'',
    '<%= config.bin %> types update pageBlocks --add-block quote --block-label Quote',
    '<%= config.bin %> types update articlePicker --allow article --start-at /Home/News',
  ]
  static override args = {
    alias: Args.string({ required: true, description: "the type's or data type's alias" }),
  }
  static override flags = {
    name: Flags.string({ summary: 'its name', helpValue: '<name>' }),
    description: Flags.string({ summary: 'its description; "" for none', helpValue: '<text>' }),
    icon: Flags.string({ summary: 'its icon', helpValue: '<icon>' }),
    'at-root': yesNo('types: allowed at the root of the tree'),
    element: yesNo('types: an element type, for blocks'),
    library: yesNo('types: may be created in the Library'),
    'vary-by-culture': yesNo('types: its content differs by language'),
    'vary-by-segment': yesNo('types: its content differs by segment'),
    'list-view': Flags.string({
      summary: 'types: show the items beneath it as this list view; none for no list',
      helpValue: '<list view|none>',
    }),
    'allow-child': many('types: allow this type beneath it', '<type>'),
    'disallow-child': many('types: stop allowing this type beneath it', '<type>'),
    compose: many('types: compose it of this type too', '<type>'),
    decompose: many('types: stop composing it of this type', '<type>'),
    view: many('types: add a view it may be shown with', '<view>'),
    'remove-view': many('types: take a view away', '<view>'),
    'default-view': Flags.string({
      summary: 'types: the view it is shown with unless another is chosen',
      helpValue: '<view>',
    }),
    set: many('data types: store a setting as given; JSON when it parses', '<setting>=<value>'),
    unset: many('data types: take a setting away', '<setting>'),
    'max-chars': Flags.integer({ summary: 'data types: the most characters allowed' }),
    rows: Flags.integer({ summary: 'data types: the rows a text area shows' }),
    min: Flags.integer({ summary: 'data types: the least allowed (number, items)' }),
    max: Flags.integer({ summary: 'data types: the most allowed (number, items)' }),
    step: Flags.integer({ summary: 'data types: the step between numbers' }),
    'default-on': yesNo('data types: a toggle starts on'),
    label: Flags.string({ summary: "data types: a toggle's label", helpValue: '<text>' }),
    'with-time': yesNo('data types: a date with a time of day'),
    option: many('data types: a dropdown option; give each, in order', '<option>'),
    multiple: yesNo('data types: more than one may be chosen'),
    allow: many('data types: a type a picker allows; give each', '<type>'),
    columns: Flags.integer({ summary: "data types: a block grid's columns" }),
    'add-block': Flags.string({
      summary: 'data types: offer this element type as a block',
      helpValue: '<element type>',
    }),
    'block-label': Flags.string({
      summary: 'data types: the label of the block --add-block adds',
      helpValue: '<label>',
    }),
    'block-settings': Flags.string({
      summary: 'data types: the settings element type of the block --add-block adds',
      helpValue: '<element type>',
    }),
    'remove-block': Flags.string({
      summary: 'data types: stop offering this block',
      helpValue: '<element type>',
    }),
    'start-at': Flags.string({
      summary: "data types: a picker's start node, by the page's path; none for none",
      helpValue: '<path|none>',
    }),
    ...editFlags,
    kind: Flags.string({
      summary: 'the kind, when two share the alias',
      options: [...TYPE_KINDS, 'data'],
    }),
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(TypesUpdate)
    const given = (names: readonly string[]) =>
      names.filter((name) => (flags as Record<string, unknown>)[name] !== undefined)
    const isData = await isDataType(args.alias, flags.kind)
    const wrong = isData
      ? given(TYPE_FLAGS.filter((f) => f !== 'name' && f !== 'description' && f !== 'icon'))
      : given(DATA_FLAGS)
    if (wrong.length > 0)
      throw new CliError(
        'usage',
        `${wrong.map((f) => `--${f}`).join(', ')} ${wrong.length === 1 ? 'is' : 'are'} for ${isData ? 'types' : 'data types'}, and "${args.alias}" is a ${isData ? 'data type' : 'type'}.`,
      )
    return isData ? this.#dataType(args.alias, flags) : this.#type(args.alias, flags)
  }

  async #type(alias: string, flags: UpdateFlags) {
    const found = await findType(alias, flags.kind)
    const listView =
      flags['list-view'] === undefined
        ? undefined
        : flags['list-view'] === 'none'
          ? null
          : flags['list-view']
    const result = updateType(found.type, {
      name: flags.name,
      description: flags.description,
      icon: flags.icon,
      allowAtRoot: flags['at-root'],
      isElement: flags.element,
      allowInLibrary: flags.library,
      variesByCulture: flags['vary-by-culture'],
      variesBySegment: flags['vary-by-segment'],
      listView,
      allowChild: flags['allow-child'],
      disallowChild: flags['disallow-child'],
      compose: flags.compose,
      decompose: flags.decompose,
      view: flags.view,
      removeView: flags['remove-view'],
      defaultView: flags['default-view'],
    })
    const noun = KIND_NOUNS[found.described]
    const said = (flag: boolean | undefined, yes: string, no: string) =>
      flag === undefined ? [] : [flag ? yes : no]
    const change = [
      `The ${noun} "${found.type.name}" (${found.type.alias}):`,
      ...(flags.name ? [`  named "${flags.name}"`] : []),
      ...(flags.description !== undefined
        ? [flags.description ? '  described anew' : '  no description']
        : []),
      ...(flags.icon ? [`  icon ${flags.icon}`] : []),
      ...said(flags['at-root'], '  allowed at the root', '  not allowed at the root'),
      ...said(flags.element, '  an element type', '  not an element type'),
      ...said(flags.library, '  may be created in the Library', '  not in the Library'),
      ...said(flags['vary-by-culture'], '  varies by language', '  does not vary by language'),
      ...said(flags['vary-by-segment'], '  varies by segment', '  does not vary by segment'),
      ...(listView === undefined
        ? []
        : [listView ? `  shows its children as ${listView}` : '  no list view']),
      ...(flags['allow-child'] ?? []).map((t) => `  allows ${t} beneath it`),
      ...(flags['disallow-child'] ?? []).map((t) => `  no longer allows ${t} beneath it`),
      ...(flags.compose ?? []).map((t) => `  composed of ${t}`),
      ...(flags.decompose ?? []).map((t) => `  no longer composed of ${t}`),
      ...(flags.view ?? []).map((v) => `  may be shown with ${v}`),
      ...(flags['remove-view'] ?? []).map((v) => `  no longer shown with ${v}`),
      ...(flags['default-view'] ? [`  shown with ${flags['default-view']} by default`] : []),
    ]
    return commitTypeEdit(this, found, result, change, flags)
  }

  async #dataType(alias: string, flags: UpdateFlags) {
    const found = await findDataType(alias)
    if (flags['block-label'] !== undefined && !flags['add-block'])
      throw new CliError('usage', '--block-label names the block --add-block adds.')
    const options: PresetOptions = {
      maxChars: flags['max-chars'],
      rows: flags.rows,
      min: flags.min,
      max: flags.max,
      step: flags.step,
      defaultOn: flags['default-on'],
      label: flags.label,
      withTime: flags['with-time'],
      option: flags.option,
      multiple: flags.multiple,
      allow: flags.allow,
      columns: flags.columns,
    }
    const startAt = flags['start-at']
    const startNode =
      startAt === undefined
        ? undefined
        : startAt === 'none'
          ? null
          : await startNodeAt(this, found.config, startAt)
    const result = updateDataType(found.dataType, {
      set: parseSet(flags.set ?? []),
      unset: flags.unset,
      options,
      addBlock: flags['add-block']
        ? {
            element: flags['add-block'],
            label: flags['block-label'],
            settings: flags['block-settings'],
          }
        : undefined,
      removeBlock: flags['remove-block'],
      startNode,
    })
    if (!result.ok) throw new CliError('refused', `Nothing was changed: ${result.reason}.`)
    const next = {
      ...result.dataType,
      ...(flags.name ? { name: flags.name } : {}),
    }
    const change = [
      `The data type "${found.dataType.name}" (${found.dataType.alias}):`,
      ...(flags.name ? [`  named "${flags.name}"`] : []),
      ...(flags.set ?? []).map((pair) => `  ${pair.replace('=', ' = ')}`),
      ...(flags.unset ?? []).map((setting) => `  no ${setting}`),
      ...Object.entries(options)
        .filter(([, value]) => value !== undefined)
        .map(([option, value]) => `  ${option} ${JSON.stringify(value)}`),
      ...(flags['add-block'] ? [`  offers ${flags['add-block']}`] : []),
      ...(flags['remove-block'] ? [`  no longer offers ${flags['remove-block']}`] : []),
      ...(startAt === undefined
        ? []
        : [startAt === 'none' ? '  no start node' : `  starts at ${startAt}`]),
    ]
    return commitDataTypeEdit(this, found, next, change, flags)
  }
}

type UpdateFlags = Interfaces.InferredFlags<typeof TypesUpdate.flags>

/** Whether an alias names a data type rather than a type; two kinds sharing it are refused. */
export async function isDataType(alias: string, kind?: string): Promise<boolean> {
  if (kind) return kind === 'data'
  const config = await siteConfig()
  const found = describeType(loadTypes(config).set, alias)
  if (!found.ok && found.reason === 'ambiguous')
    throw new CliError('usage', `"${alias}" names more than one kind of definition.`, {
      hint: `Name one with --kind ${found.kinds.join(' or --kind ')}.`,
    })
  return found.ok && found.found.kind === 'data'
}
