import { BaseCommand } from '../../base.ts'
import { dryRun } from '../../support/flags.ts'
import { needSection, oneKind, refersToLibrary } from '../../support/library.ts'
import { trashLibrary } from '../../support/library-content.ts'
import { itemsArg, positionals, selectionFields, trashItems } from '../../support/tree.ts'

export default class ContentDelete extends BaseCommand {
  static override summary = 'move pages, and the pages below them, to the recycle bin'
  static override description = [
    'Every page named is checked before any moves: one that cannot be deleted stops them all. A page already in the recycle bin is left there.',
    'To delete for good, empty the recycle bin: `crombolo recycle-bin empty`.',
    'Library items, named `library:/…`, go to the Library’s recycle bin, a folder with the elements in it.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content delete "/News/Old post"',
    '<%= config.bin %> content delete /Campaigns/Spring /Campaigns/Summer --dry-run',
    '<%= config.bin %> content delete library:/Menus/Old',
  ]
  static override strict = false
  static override usage = 'content delete PAGE...'
  static override args = { page: itemsArg('content') }
  static override flags = { 'dry-run': dryRun }
  static override access = 'site' as const
  static override section = ['content', 'library'] as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'bounded',
    outputFields: selectionFields,
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { argv, flags } = await this.parse(ContentDelete)
    const refs = positionals(argv)
    const kinds = await Promise.all(
      refs.map(async (ref) => ({ ref, library: await refersToLibrary(ref) })),
    )
    if (oneKind(kinds)) return trashLibrary(this, refs, flags['dry-run'])
    needSection(false)
    return trashItems(this, 'content', refs, flags['dry-run'])
  }
}
