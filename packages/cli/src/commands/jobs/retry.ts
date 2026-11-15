import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { jobFields, withJobs } from '../../support/jobs.ts'
import { profileFlags } from '../../support/remote.ts'

/** A failed background job run again from its first attempt, as the dashboard's button does (story 359). */
export default class JobsRetry extends BaseCommand {
  static override summary = 'run a failed background job again, from its first attempt'
  static override description =
    'Only a job that has failed can be run again. It runs within a few seconds on a running site, or when the site next starts. The audit log records who ran it again.'
  static override examples = ['<%= config.bin %> jobs retry 1a2b3c4d --profile production']
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
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: jobFields,
    errors: ['not_found', 'conflict', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(JobsRetry)
    return withJobs(flags, async (site) => {
      const done = await site.retry(args.id)
      this.say(`${done.job.name} is queued to run again.`)
      return done.job
    })
  }
}
