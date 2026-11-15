import { Args } from '@oclif/core'
import { MemberCommand, withMembers } from '../../../support/members.ts'
import { profileFlags } from '../../../support/remote.ts'

/** A new member group (story 354). */
export default class MembersGroupsNew extends MemberCommand {
  static override summary = 'make a member group'
  static override args = { name: Args.string({ required: true, description: 'its name' }) }
  static override flags = { ...profileFlags }
  static override audit = {
    category: 'member',
    action: 'Create',
    entityType: 'MemberGroup',
  } as const
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'name', type: 'string' },
    ],
    errors: ['conflict', 'usage', 'refused', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MembersGroupsNew)
    return withMembers(flags, 'members', async (site) => {
      const group = await site.newGroup(args.name)
      this.noted(site, group.key)
      this.say(`  made the member group ${group.name}`)
      return group
    })
  }
}
