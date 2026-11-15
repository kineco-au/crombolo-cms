import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { profileFlags } from '../../support/remote.ts'
import { describeVersion, pickVersion, withUndo } from '../../support/undo.ts'

/** A version made the page's draft, as the back office's rollback does (story 353). */
export default class ContentRollback extends BaseCommand {
  static override summary = "make one of a page's versions its draft; --publish to take it live too"
  static override description = [
    'The whole page goes back, in every language: `content history show <page> <version> --diff` shows what would change.',
    'With --publish it is then published as `content publish` publishes it, approvals included.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> content rollback /Home previous',
    '<%= config.bin %> content rollback /Home latest-published --publish',
  ]
  static override args = {
    page: Args.string({
      required: true,
      description: 'the page: a path or a uuid; a uuid on a hosted site',
    }),
    version: Args.string({
      required: true,
      description: 'the version: its key, `previous` or `latest-published`',
    }),
  }
  static override flags = {
    publish: Flags.boolean({ summary: 'publish it too, as `content publish` would' }),
    'skip-approval': Flags.boolean({
      summary: 'with --publish: publish without the approval its workflow asks for; audited',
      dependsOn: ['publish'],
    }),
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      {
        name: 'page',
        type: 'object',
        fields: [
          { name: 'key', type: 'string' },
          { name: 'name', type: 'string' },
        ],
      },
      { name: 'version', type: 'string' },
      { name: 'published', type: 'boolean' },
    ],
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentRollback)
    return withUndo(flags, 'content-history', async (site) => {
      const history = await site.history(args.page)
      const entry = pickVersion(history, args.version)
      await site.rollback(history.page, entry.id, {
        publish: flags.publish,
        skipApproval: flags['skip-approval'],
      })
      this.say(
        `  rolled ${history.page.name} back to version ${entry.id} (${describeVersion(entry)})`,
      )
      this.say(
        flags.publish ? '  published' : '\nA draft: `crombolo content publish` takes it live.',
      )
      return { page: history.page, version: entry.id, published: flags.publish }
    })
  }
}
