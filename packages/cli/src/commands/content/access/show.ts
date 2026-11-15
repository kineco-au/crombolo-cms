import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { accessFields, describeAccess, withMembers } from '../../../support/members.ts'
import { profileFlags } from '../../../support/remote.ts'

/** Who may see a page: its own rule, an ancestor's, or everyone (story 354). */
export default class ContentAccessShow extends BaseCommand {
  static override summary = 'who may see a page: the member groups or members, and its sign-in page'
  static override examples = ['<%= config.bin %> content access show /Members']
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
    cardinality: 'single',
    outputFields: accessFields,
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(ContentAccessShow)
    return withMembers(flags, 'public-access', async (site) => {
      const access = await site.access(await site.page(args.page))
      for (const line of describeAccess(access)) this.say(line)
      return access
    })
  }
}
