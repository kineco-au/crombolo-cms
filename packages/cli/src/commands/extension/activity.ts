import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { countsLine } from '@crombolo/backoffice-host/activity-words'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import {
  activityFlags,
  activityLine,
  activitySearch,
  extensionId,
  withActivity,
} from '../../support/extension-activity.ts'
import { profileFlags } from '../../support/remote.ts'

/** What an extension did, as Installed → Activity lists it (story 362). */
export default class ExtensionActivity extends BaseCommand {
  static override summary =
    'what an extension did, newest first: what it read and changed, for whom, and what it was refused'
  static override description = [
    'The counts for the days the site keeps come first, then a line for each thing it did. `next` is the cursor for the page after; pass it back as --before.',
    '--csv writes everything the filters match as the Activity screen exports it, to stdout or to --file.',
    'On this site, what it did in the last second may not be there yet while the site is running.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> extension activity crm --kind refused',
    '<%= config.bin %> extension activity @acme/crm --user ada@example.com --since 2026-11-01',
    '<%= config.bin %> extension activity crm --csv --file crm-activity.csv --profile production',
  ]
  static override args = {
    extension: Args.string({
      required: true,
      description: 'its id or package name; one removed is named by its id',
    }),
  }
  static override flags = {
    ...activityFlags,
    limit: Flags.integer({ summary: 'how many on a page', default: 50, min: 1, max: 500 }),
    before: Flags.integer({ summary: 'the page after this cursor', helpValue: '<cursor>', min: 0 }),
    csv: Flags.boolean({
      summary: 'everything the filters match, as the Activity screen exports it',
    }),
    file: Flags.string({
      summary: 'write the CSV file here rather than to stdout',
      helpValue: '<path>',
      dependsOn: ['csv'],
    }),
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = 'settings' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      {
        name: 'summary',
        type: 'object',
        fields: [
          {
            name: 'counts',
            type: 'object',
            description: 'how many of each kind, reads counted as made',
          },
          { name: 'people', type: 'array', items: { type: 'object' } },
          { name: 'days', type: 'integer', description: 'the days the counts cover' },
        ],
      },
      { name: 'items', type: 'array', items: { type: 'object' } },
      {
        name: 'next',
        type: 'integer',
        nullable: true,
        description: 'pass back as --before for the next page; null at the end',
      },
    ],
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ExtensionActivity)
    if (flags.csv && !flags.file && this.jsonEnabled())
      this.fail(
        'usage',
        '--csv writes the file to stdout, so it cannot also write JSON there.',
        'Give --file as well.',
      )
    const search = activitySearch(flags)
    return withActivity(flags, async (site) => {
      const id = await extensionId(site, args.extension)
      if (flags.csv) {
        const answer = await site.read(id, 'csv', search)
        const csv = answer.part === 'csv' ? answer.csv : ''
        const rows = csv.trimEnd().split('\n').length - 1
        if (!flags.file) {
          process.stdout.write(csv)
          return undefined
        }
        const file = resolve(flags.file)
        writeFileSync(file, csv)
        this.say(`Wrote ${rows} ${rows === 1 ? 'row' : 'rows'} to ${flags.file}.`)
        return { file, rows }
      }
      const summarised = await site.read(id, 'summary', search)
      const paged = await site.read(id, 'page', search)
      const summary = summarised.part === 'summary' ? summarised.summary : undefined
      const page = paged.part === 'page' ? paged.page : { items: [], next: null }
      if (summary) this.say(`  ${countsLine(summary.counts)} in the last ${summary.days} days\n`)
      for (const row of page.items) this.say(activityLine(row))
      if (page.items.length === 0) this.say('  Nothing recorded.')
      else if (page.next !== null) this.say(`\n  More: --before ${page.next}`)
      return { summary, items: page.items, next: page.next }
    })
  }
}
