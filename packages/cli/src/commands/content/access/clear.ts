import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { accessFields, describeAccess, withMembers } from '../../../support/members.ts'
import { profileFlags } from '../../../support/remote.ts'

/** A page's own rule removed, as the public access dialog's Remove does (story 354). */
export default class ContentAccessClear extends BaseCommand {
  static override summary = "remove a page's own rule, so it is open as the pages above it are"
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
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'access', type: 'object', fields: accessFields },
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentAccessClear)
    return withMembers(flags, 'public-access', async (site) => {
      const cleared = await site.clearAccess(await site.page(args.page))
      if (!cleared.changed)
        this.say(`  ${cleared.access.page.path} had no rule of its own: no change`)
      for (const line of describeAccess(cleared.access)) this.say(`  ${line}`)
      return cleared
    })
  }
}
