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

export default class MediaMove extends BaseCommand {
  static override summary = 'move media items, and what is inside them, into another folder'
  static override description = [
    'Every item named is checked before any moves: one that cannot go there stops them all. `--to /` moves them to the top level.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> media move /Images/Logo.png --to /Brand',
    '<%= config.bin %> media move /Uploads/a.jpg /Uploads/b.jpg --to /Gallery --dry-run',
  ]
  static override strict = false
  static override usage = 'media move ITEM... --to <path|uuid|/>'
  static override args = { item: itemsArg('media') }
  static override flags = {
    to: Flags.string({
      required: true,
      summary: 'the folder to move them into; / for the top level',
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
    const { argv, flags } = await this.parse(MediaMove)
    return moveItems(this, 'media', positionals(argv), flags.to, flags['dry-run'])
  }
}
