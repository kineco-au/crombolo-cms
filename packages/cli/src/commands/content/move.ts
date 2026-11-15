import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { dryRun } from '../../support/flags.ts'
import { needSection, oneKind, refersToLibrary } from '../../support/library.ts'
import { moveLibrary } from '../../support/library-content.ts'
import {
  itemsArg,
  moveItems,
  placeField,
  positionals,
  selectionFields,
} from '../../support/tree.ts'

export default class ContentMove extends BaseCommand {
  static override summary =
    'move pages, and the pages below them, under another page; or Library items into a Library folder'
  static override description = [
    'Every page named is checked before any moves: one that cannot go there stops them all. `--to /` moves them to the top level.',
    'A move records redirects from the addresses the pages had, as a move in the backoffice does.',
    'Library items, named `library:/…`, move into a Library folder, a folder with the elements in it: `--to library:/` is the top of the Library. Pages and Library items are not moved in one go.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content move /Blog/Archive --to /Company',
    '<%= config.bin %> content move "/News/Old post" "/News/Older post" --to /Archive --dry-run',
    '<%= config.bin %> content move library:/Footer --to library:/Menus',
  ]
  static override strict = false
  static override usage = 'content move PAGE... --to <path|uuid|/|library:/…>'
  static override args = { page: itemsArg('content') }
  static override flags = {
    to: Flags.string({
      required: true,
      summary:
        'the page to move them under; / for the top level; a Library folder for Library items',
      helpValue: '<path|uuid|/>',
    }),
    'dry-run': dryRun,
  }
  static override access = 'site' as const
  static override section = ['content', 'library'] as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'bounded',
    outputFields: [...selectionFields, placeField],
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { argv, flags } = await this.parse(ContentMove)
    const refs = positionals(argv)
    const kinds = await Promise.all(
      refs.map(async (ref) => ({ ref, library: await refersToLibrary(ref) })),
    )
    if (oneKind(kinds)) return moveLibrary(this, refs, flags.to, flags['dry-run'])
    needSection(false)
    return moveItems(this, 'content', refs, flags.to, flags['dry-run'])
  }
}
