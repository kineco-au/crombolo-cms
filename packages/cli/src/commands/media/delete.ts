import { BaseCommand } from '../../base.ts'
import { dryRun } from '../../support/flags.ts'
import { itemsArg, positionals, selectionFields, trashItems } from '../../support/tree.ts'

export default class MediaDelete extends BaseCommand {
  static override summary = 'move media items, and what is inside them, to the recycle bin'
  static override description = [
    'Every item named is checked before any moves: one that cannot be deleted stops them all. An item already in the recycle bin is left there.',
    'To delete for good, files and all, empty the recycle bin: `crombolo recycle-bin empty --media`.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> media delete /Uploads/old-logo.png',
    '<%= config.bin %> media delete /Uploads/a.jpg /Uploads/b.jpg --dry-run',
  ]
  static override strict = false
  static override usage = 'media delete ITEM...'
  static override args = { item: itemsArg('media') }
  static override flags = { 'dry-run': dryRun }
  static override spec = {
    effects: 'idempotent',
    cardinality: 'bounded',
    outputFields: selectionFields,
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { argv, flags } = await this.parse(MediaDelete)
    return trashItems(this, 'media', positionals(argv), flags['dry-run'])
  }
}
