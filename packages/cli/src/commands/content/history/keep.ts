import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { profileFlags } from '../../../support/remote.ts'
import { pickVersion, withUndo } from '../../../support/undo.ts'

/** A version kept from cleanup, or no longer kept (story 353). */
export default class ContentHistoryKeep extends BaseCommand {
  static override summary = 'keep a version from cleanup, or with --off stop keeping it'
  static override description =
    'Old versions are cleaned up under the content type’s rules; a kept one stays, as “Prevent cleanup” keeps it in the back office.'
  static override examples = [
    '<%= config.bin %> content history keep /Home latest-published',
    '<%= config.bin %> content history keep /Home 1042 --off',
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
    off: Flags.boolean({ summary: 'stop keeping it' }),
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'idempotent',
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
      { name: 'kept', type: 'boolean' },
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentHistoryKeep)
    return withUndo(flags, 'content-history', async (site) => {
      const history = await site.history(args.page)
      const entry = pickVersion(history, args.version)
      const keep = !flags.off
      const changed = entry.kept !== keep
      if (changed) await site.keep(entry.id, keep)
      else this.changedNothing = true
      this.say(
        keep
          ? `  version ${entry.id} ${changed ? 'is kept' : 'was already kept'} from cleanup`
          : `  version ${entry.id} ${changed ? 'is no longer kept' : 'was not kept'}`,
      )
      return { page: history.page, version: entry.id, kept: keep, changed }
    })
  }
}
