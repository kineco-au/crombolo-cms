import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { dryRun } from '../../support/flags.ts'
import {
  itemsArg,
  moveItems,
  placeField,
  positionals,
  selectionFields,
} from '../../support/tree.ts'

export default class ContentMove extends BaseCommand {
  static override summary = 'move pages, and the pages below them, under another page'
  static override description = [
    'Every page named is checked before any moves: one that cannot go there stops them all. `--to /` moves them to the top level.',
    'A move records redirects from the addresses the pages had, as a move in the backoffice does.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content move /Blog/Archive --to /Company',
    '<%= config.bin %> content move "/News/Old post" "/News/Older post" --to /Archive --dry-run',
  ]
  static override strict = false
  static override usage = 'content move PAGE... --to <path|uuid|/>'
  static override args = { page: itemsArg('content') }
  static override flags = {
    to: Flags.string({
      required: true,
      summary: 'the page to move them under; / for the top level',
      helpValue: '<path|uuid|/>',
    }),
    'dry-run': dryRun,
  }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'bounded',
    outputFields: [...selectionFields, placeField],
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { argv, flags } = await this.parse(ContentMove)
    return moveItems(this, 'content', positionals(argv), flags.to, flags['dry-run'])
  }
}
