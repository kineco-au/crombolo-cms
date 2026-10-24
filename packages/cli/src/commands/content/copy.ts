import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { dryRun } from '../../support/flags.ts'
import { copyPage, placeField } from '../../support/tree.ts'

export default class ContentCopy extends BaseCommand {
  static override summary = 'copy a page under another page; --descendants for the branch below it'
  static override description =
    'The copy is a draft with a free name among its new siblings, as a copy in the backoffice is. `--to /` copies it to the top level.'
  static override examples = [
    '<%= config.bin %> content copy /Campaigns/Spring --to /Campaigns --descendants',
  ]
  static override args = {
    page: Args.string({ required: true, description: 'the page: a path or a uuid' }),
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
    return copyPage(this, args.page, flags.to, {
      descendants: flags.descendants,
      dryRun: flags['dry-run'],
    })
  }
}
