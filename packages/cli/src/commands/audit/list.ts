import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import {
  auditFilterOf,
  auditFlags,
  auditLine,
  openAuditSource,
  recordFields,
} from '../../support/audit.ts'

export default class AuditList extends BaseCommand {
  static override summary = 'the audit log, newest first, a page at a time'
  static override description = [
    'Who did what and when, from where: every change made in the back office, from the command line and by the site itself, and every sign-in. Reading it is not itself recorded, and changes nothing.',
    '`next` is the cursor for the page after; pass it back as --before. `crombolo audit stream` ships the log elsewhere as NDJSON.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> audit list --since 2026-10-01 --category sign-in',
    '<%= config.bin %> audit list --user ada@example.com -o json',
    '<%= config.bin %> audit list --remote production --limit 100',
  ]
  static override flags = {
    ...auditFlags,
    limit: Flags.integer({ summary: 'how many on a page', default: 50, min: 1, max: 500 }),
    before: Flags.integer({ summary: 'the page after this cursor', helpValue: '<cursor>', min: 0 }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      { name: 'items', type: 'array', items: { type: 'object', fields: recordFields } },
      {
        name: 'next',
        type: 'integer',
        nullable: true,
        description: 'pass back as --before for the next page; null at the end',
      },
      { name: 'truncated', type: 'boolean' },
    ],
    errors: ['not_found', 'refused', 'usage'],
  } as const

  async run() {
    const { flags } = await this.parse(AuditList)
    const filter = auditFilterOf(flags)
    const source = await openAuditSource(flags)
    try {
      const page = await source.page(filter, { before: flags.before, limit: flags.limit })
      for (const entry of page.items) this.say(auditLine(entry))
      if (page.items.length === 0) this.say('  Nothing in the log matches.')
      else if (page.next !== null) this.say(`\n  More: --before ${page.next}`)
      return page
    } finally {
      await source.close()
    }
  }
}
