import { tomlValue } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import { sayValues } from '../../../support/pages.ts'
import { profileFlags } from '../../../support/remote.ts'
import { describeVersion, pickVersion, withUndo } from '../../../support/undo.ts'

const shown = (value: unknown) => tomlValue(value) ?? JSON.stringify(value)

/** One version of a page, as `content show` shows a page (story 353). */
export default class ContentHistoryShow extends BaseCommand {
  static override summary =
    "one of a page's versions: its values and blocks, or with --diff what differs from the draft"
  static override examples = [
    '<%= config.bin %> content history show /Home previous',
    '<%= config.bin %> content history show /Home 1042 --diff',
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
    diff: Flags.boolean({ summary: 'only what differs from the current draft' }),
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    stdoutSchema: {},
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentHistoryShow)
    return withUndo(flags, 'content-history', async (site) => {
      const history = await site.history(args.page)
      const entry = pickVersion(history, args.version)
      const version = await site.version(entry.id, flags.diff)
      if (version.page.key !== history.page.key)
        throw new CliError(
          'not_found',
          `Version ${entry.id} is not one of "${history.page.name}"'s.`,
        )
      this.say(`${history.page.name}, version ${entry.id}: "${version.name}"`)
      this.say(`  ${describeVersion(entry)}`)
      if (!flags.diff) {
        sayValues(this, version.values)
        return { ...version, date: entry.date, by: entry.by, kind: entry.kind }
      }
      const changes = version.diff ?? []
      for (const change of changes) {
        const label = `${change.property}${change.culture ? ` (${change.culture})` : ''}`.padEnd(22)
        if (change.change === 'added')
          this.say(`  ${label} only in this version: ${shown(change.version)}`)
        else if (change.change === 'removed')
          this.say(`  ${label} only in the draft: ${shown(change.draft)}`)
        else
          this.say(`  ${label} draft ${shown(change.draft)}, this version ${shown(change.version)}`)
      }
      if (changes.length === 0) this.say('  Its values are the same as the draft’s.')
      const { values: _values, ...rest } = version
      return { ...rest, date: entry.date, by: entry.by, kind: entry.kind, diff: changes }
    })
  }
}
