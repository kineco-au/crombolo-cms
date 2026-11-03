import { DATA_TYPE_PRESETS, optionFlag } from '@crombolo/schema'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'

/** The editors `types new data-type --editor` knows, and the settings each takes by name (story 249). */
export default class TypesEditors extends BaseCommand {
  static override summary = 'the editors a data type can use, and the settings each takes by name'
  static override description =
    'Each is one `crombolo types new data-type --editor <editor>` takes, with the flags it and `types update` set. Any other setting an editor has is stored with `types update <data type> --set <setting>=<value>`, as given: it takes effect when the editor uses that name.'
  static override examples = [
    '<%= config.bin %> types editors',
    '<%= config.bin %> types editors media-picker',
  ]
  static override args = {
    editor: Args.string({
      description: 'one editor, by the name `types new data-type --editor` takes',
    }),
  }
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
            { name: 'flags', type: 'array', items: { type: 'string' } },
          ],
        },
      },
    ],
    errors: ['not_found'],
  } as const

  async run() {
    const { args } = await this.parse(TypesEditors)
    const all = Object.entries(DATA_TYPE_PRESETS).map(([editor, preset]) => ({
      editor,
      umbracoEditor: preset.editor,
      flags: preset.takes.map(optionFlag),
    }))
    const items = args.editor ? all.filter((item) => item.editor === args.editor) : all
    if (args.editor && items.length === 0)
      throw new CliError('not_found', `There is no editor called "${args.editor}".`, {
        hint: `One of: ${all.map((item) => item.editor).join(', ')}.`,
      })
    for (const item of items)
      this.say(
        `  ${item.editor.padEnd(16)} ${item.umbracoEditor.padEnd(30)} ${item.flags.join(' ') || '(no named settings)'}`,
      )
    this.say('\nAny other setting: `crombolo types update <data type> --set <setting>=<value>`.')
    return { items }
  }
}
