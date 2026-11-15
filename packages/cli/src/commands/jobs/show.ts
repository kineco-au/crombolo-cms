import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { jobDetails, jobFields, withJobs } from '../../support/jobs.ts'
import { profileFlags } from '../../support/remote.ts'

/** One background job: what it is, how far it got, and why it failed (story 359). */
export default class JobsShow extends BaseCommand {
  static override summary = 'one background job: what it is, how far it got, and why it failed'
  static override examples = ['<%= config.bin %> jobs show 1a2b3c4d']
  static override args = {
    id: Args.string({
      required: true,
      description: 'its id, or at least the first 8 characters of it',
    }),
  }
  static override flags = { ...profileFlags }
  static override access = 'site' as const
  static override section = 'settings' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: jobFields,
    errors: ['not_found', 'conflict', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(JobsShow)
    return withJobs(flags, async (site) => {
      const job = await site.show(args.id)
      for (const line of jobDetails(job)) this.say(line)
      return job
    })
  }
}
