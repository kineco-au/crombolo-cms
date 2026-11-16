import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { AGENTS_FILE } from '../../support/agents.ts'
import { refreshGuides } from '../../support/agents-refresh.ts'
import { cwd, hasSite } from '../../support/site.ts'

const SAID = {
  updated: 'its guide is up to date',
  'no-guide': 'it offers no guide, so its part is gone',
  unreachable: 'its guide could not be fetched, so its part is as it was',
  'profile-gone': 'no profile has that name now, so its part is gone',
} as const

export default class AgentsRefresh extends BaseCommand {
  static override summary =
    "bring AGENTS.md up to date: crombolo's guide, and the guide of each remote this site names"
  static override description =
    "Writes crombolo's part of AGENTS.md again, and fetches the guide of each profile the site came from (`agents link` adds one). A remote's part goes once it offers no guide or its profile is gone. Every line outside those parts is left as it is."
  static override flags = {
    'dry-run': Flags.boolean({ summary: 'say what would change, and write nothing' }),
  }
  static override access = 'none' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'bounded',
    outputFields: [
      { name: 'changed', type: 'boolean' },
      { name: 'remotes', type: 'array', items: { type: 'object' } },
    ],
    errors: ['refused'],
  } as const

  async run() {
    const { flags } = await this.parse(AgentsRefresh)
    if (!hasSite())
      this.fail(
        'refused',
        'There is no site here.',
        'Run it in the site folder, beside crombolo.config.ts.',
      )
    const dryRun = flags['dry-run']
    if (dryRun) this.changedNothing = true
    const result = await refreshGuides(cwd(), { dryRun })
    for (const remote of result.remotes)
      this.say(
        `  ${remote.profile.padEnd(14)} ${remote.origin}: ${SAID[remote.outcome]}${remote.problem ? ` (${remote.problem})` : ''}`,
      )
    this.say(
      result.changed
        ? `${dryRun ? 'Would change' : 'Changed'} ${AGENTS_FILE}.`
        : `${AGENTS_FILE} is up to date.`,
    )
    return result
  }
}
