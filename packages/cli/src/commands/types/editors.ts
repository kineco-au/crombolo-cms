import {
  closestNames,
  DATA_TYPE_PRESETS,
  EDITOR_NAMES,
  EDITOR_SCHEMAS,
  EDITOR_UIS,
  findPreset,
  optionFlag,
  presetOf,
} from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'

/** The editors `types new data-type --editor` knows, and the settings each takes by name (story 249). */
export default class TypesEditors extends BaseCommand {
  static override summary = 'the editors a data type can use, and the settings each takes by name'
  static override description =
    'Each is one `crombolo types new data-type --editor <editor>` takes, by its short name or its full name, with the flags it and `types update` set. Any other setting an editor has is stored with `--set <setting>=<value>`, as given: it takes effect when the editor uses that name. `--all` lists every editor the back office offers, with its full name and the settings its data type editor shows.'
  static override examples = [
    '<%= config.bin %> types editors',
    '<%= config.bin %> types editors media-picker',
    '<%= config.bin %> types editors Umbraco.ColorPicker',
    '<%= config.bin %> types editors --all',
  ]
  static override args = {
    editor: Args.string({
      description: 'one editor, by a name `types new data-type --editor` takes',
    }),
  }
  static override flags = {
    all: Flags.boolean({
      summary: 'every editor the back office offers, with its full name and settings',
    }),
  }
  static override access = 'site' as const
  static override section = 'settings' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      {
        name: 'items',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'editor', type: 'string' },
            { name: 'umbracoEditor', type: 'string' },
            { name: 'editorUi', type: 'string' },
            { name: 'label', type: 'string' },
            { name: 'flags', type: 'array', items: { type: 'string' } },
            { name: 'settings', type: 'array', items: { type: 'string' } },
          ],
        },
      },
    ],
    errors: ['not_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(TypesEditors)
    const all = Object.entries(DATA_TYPE_PRESETS).map(([editor, preset]) => ({
      editor,
      umbracoEditor: preset.editor,
      editorUi: preset.editorUi,
      label: EDITOR_UIS[preset.editorUi]?.label ?? EDITOR_SCHEMAS[preset.editor]?.name ?? editor,
      flags: preset.takes.map(optionFlag),
      settings: [
        ...new Set([
          ...Object.keys(EDITOR_SCHEMAS[preset.editor]?.settings ?? {}),
          ...Object.keys(EDITOR_UIS[preset.editorUi]?.settings ?? {}),
        ]),
      ],
    }))
    const offered = Object.entries(EDITOR_UIS).filter(([ui, entry]) => !presetOf(entry.schema, ui))
    const found = args.editor ? findPreset(args.editor) : undefined
    const items = args.editor ? all.filter((item) => item.editor === found?.[0]) : all
    if (args.editor && items.length === 0)
      throw new CliError('not_found', `There is no editor called "${args.editor}".`, {
        hint: `Did you mean ${closestNames(args.editor, EDITOR_NAMES).join(', ')}? \`crombolo types editors --all\` lists them all.`,
      })
    for (const item of items) {
      this.say(
        `  ${item.editor.padEnd(20)} ${item.label.padEnd(26)} ${item.flags.join(' ') || '(no named settings)'}`,
      )
      if (flags.all || args.editor)
        this.say(
          `  ${''.padEnd(20)} ${item.umbracoEditor}, ${item.editorUi}${item.settings.length ? `\n  ${''.padEnd(20)} settings: ${item.settings.join(', ')}` : ''}`,
        )
    }
    for (const [ui, entry] of flags.all ? offered : [])
      this.say(`  ${entry.schema.padEnd(20)} ${entry.label.padEnd(26)} ${ui}, settings by --set`)
    this.say('\nAny other setting: `--set <setting>=<value>`, on `types new` or `types update`.')
    return { items }
  }
}
