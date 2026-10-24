import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { dryRun } from '../../support/flags.ts'
import { positionals, sortChildren } from '../../support/tree.ts'

export default class ContentSort extends BaseCommand {
  static override summary = 'put the pages under a page in order'
  static override description = [
    'The pages named come first, in the order given; the rest follow in the order they had. Name a child by its name under the parent, or by a path or a uuid. `/` as the parent sorts the top level.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content sort /About Team History Contact',
    '<%= config.bin %> content sort / Home Blog --dry-run',
  ]
  static override strict = false
  static override usage = 'content sort PARENT CHILD...'
  static override args = {
    parent: Args.string({
      required: true,
      description: 'the page whose children to sort; / for the top level',
    }),
    child: Args.string({
      required: true,
      description: 'a page under it, by name, path or uuid; name more after it',
    }),
  }
  static override flags = { 'dry-run': dryRun }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      {
        name: 'parent',
        type: 'object',
        nullable: true,
        fields: [
          { name: 'key', type: 'string' },
          { name: 'name', type: 'string' },
        ],
      },
      {
        name: 'order',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'key', type: 'string' },
            { name: 'name', type: 'string' },
          ],
        },
      },
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { argv, flags } = await this.parse(ContentSort)
    const [parent, ...children] = positionals(argv)
    return sortChildren(this, parent as string, children, flags['dry-run'])
  }
}
