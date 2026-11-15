import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { page, pageFlags, pagination } from '../../support/flags.ts'
import {
  jobFields,
  jobLine,
  STATE_FLAGS,
  stateFlag,
  WAITING_WARNING,
  withJobs,
} from '../../support/jobs.ts'
import { profileFlags } from '../../support/remote.ts'

const EMPTY: Record<keyof typeof STATE_FLAGS, string> = {
  waiting: 'No waiting jobs.',
  running: 'No running jobs.',
  failed: 'No failed jobs.',
  done: 'No finished jobs.',
}

/** The site's and its bundles' background jobs, as Settings → Background jobs lists them (story 359). */
export default class JobsList extends BaseCommand {
  static override summary =
    "the site's and its bundles' background jobs, newest first: what each is, its state and how far it got"
  static override examples = [
    '<%= config.bin %> jobs list --state failed',
    '<%= config.bin %> jobs list --owner site --profile production',
  ]
  static override flags = {
    state: stateFlag,
    owner: Flags.string({
      summary: "only one bundle's jobs, or site for the site's own",
      helpValue: '<bundle|site>',
    }),
    ...pageFlags(50),
    ...profileFlags,
  }
  static override access = 'site' as const
  static override section = 'settings' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    pagination,
    fieldsArg: '--fields',
    outputFields: [
      { name: 'items', type: 'array', items: { type: 'object', fields: jobFields } },
      { name: 'total', type: 'integer' },
      { name: 'offset', type: 'integer' },
      { name: 'truncated', type: 'boolean' },
      {
        name: 'waitingSince',
        type: 'string',
        nullable: true,
        description: 'on a hosted site, since when nothing has been running its jobs',
      },
    ],
    errors: ['refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { flags } = await this.parse(JobsList)
    const state = flags.state as keyof typeof STATE_FLAGS | undefined
    return withJobs(flags, async (site) => {
      const found = await site.list({
        state: state ? STATE_FLAGS[state] : undefined,
        owner: flags.owner,
        skip: flags.offset,
        take: flags.limit,
      })
      if (found.waitingSince) this.warning(WAITING_WARNING)
      if (found.items.length === 0) this.say(state ? EMPTY[state] : 'No background jobs.')
      for (const job of found.items) this.say(jobLine(job))
      if (flags.offset + found.items.length < found.total)
        this.say(
          `  … ${found.total - flags.offset - found.items.length} more: --offset ${flags.offset + found.items.length}`,
        )
      return { ...page(found.items, found.total, flags), waitingSince: found.waitingSince }
    })
  }
}
