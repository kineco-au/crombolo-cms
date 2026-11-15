import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { dryRun } from '../../support/flags.ts'
import { needSection, refersToLibrary } from '../../support/library.ts'
import { copyElement } from '../../support/library-content.ts'
import { copyPage, placeField } from '../../support/tree.ts'

export default class ContentCopy extends BaseCommand {
  static override summary = 'copy a page under another page; --descendants for the branch below it'
  static override description = [
    'The copy is a draft with a free name among its new siblings, as a copy in the backoffice is. `--to /` copies it to the top level.',
    'A Library element, named `library:/…`, is copied into a Library folder: `--to library:/` is the top of the Library.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content copy /Campaigns/Spring --to /Campaigns --descendants',
    '<%= config.bin %> content copy library:/Menus/Main --to library:/Archive',
  ]
  static override args = {
    page: Args.string({
      required: true,
      description: 'the page: a path or a uuid; library:/… for a Library element',
    }),
  }
  static override flags = {
    to: Flags.string({
      required: true,
      summary: 'the page to copy it under; / for the top level',
      helpValue: '<path|uuid|/>',
    }),
    descendants: Flags.boolean({ summary: 'the pages below it too' }),
    'dry-run': dryRun,
  }
  static override access = 'site' as const
  static override section = ['content', 'library'] as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'key', type: 'string', nullable: true, description: 'the copy; null in a dry run' },
      { name: 'name', type: 'string' },
      placeField,
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentCopy)
    if (await refersToLibrary(args.page))
      return copyElement(this, args.page, flags.to, flags['dry-run'])
    needSection(false)
    return copyPage(this, args.page, flags.to, {
      descendants: flags.descendants,
      dryRun: flags['dry-run'],
    })
  }
}
