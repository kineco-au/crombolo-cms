import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { profileFlags } from '../../../support/remote.ts'
import { describeVersion, withUndo } from '../../../support/undo.ts'

/** A page's versions, newest first (story 353). */
export default class ContentHistory extends BaseCommand {
  static override summary = "a page's versions, newest first: when, who, and what is live and kept"
  static override description = [
    'Each version is named by its key, which `content history show`, `content history keep` and `content rollback` take; `previous` and `latest-published` name the usual ones.',
    'A version is the whole page, in every language.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content history /Home',
    '<%= config.bin %> content history 3f2a…  --profile production -o json',
  ]
  static override args = {
    page: Args.string({
      required: true,
      description: 'the page: a path or a uuid; a uuid on a hosted site',
    }),
  }
  static override flags = { ...profileFlags }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      {
        name: 'page',
        type: 'object',
        fields: [
          { name: 'key', type: 'string' },
          { name: 'name', type: 'string' },
        ],
      },
      {
        name: 'versions',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'id', type: 'string' },
            { name: 'date', type: 'string' },
            { name: 'kind', type: 'string', enum: ['save', 'publish', 'rollback', 'migrate'] },
            {
              name: 'by',
              type: 'object',
              nullable: true,
              description: 'null for the command line or the site itself',
              fields: [
                { name: 'key', type: 'string' },
                { name: 'name', type: 'string' },
              ],
            },
            { name: 'draft', type: 'boolean', description: "the page's draft now" },
            { name: 'live', type: 'boolean', description: 'what is published now' },
            { name: 'kept', type: 'boolean', description: 'kept from cleanup' },
          ],
        },
      },
    ],
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentHistory)
    return withUndo(flags, 'content-history', async (site) => {
      const history = await site.history(args.page)
      this.say(`${history.page.name}  (${history.page.key})`)
      const now = Date.now()
      for (const version of history.versions) {
        const marks = [
          version.draft ? 'the draft' : '',
          version.live ? 'live' : '',
          version.kept ? 'kept' : '',
        ].filter(Boolean)
        this.say(
          `  ${version.id.padEnd(8)} ${describeVersion(version, now)}${marks.length > 0 ? `  (${marks.join(', ')})` : ''}`,
        )
      }
      if (history.versions.length === 0) this.say('  It has no versions.')
      return history
    })
  }
}
