import { Args } from '@oclif/core'
import { changedFields, MemberCommand } from '../../../support/members.ts'
import { profileFlags } from '../../../support/remote.ts'

export default class MembersGroupsLeave extends MemberCommand {
  static override summary = 'take a member out of a group'
  static override args = {
    member: Args.string({ required: true, description: 'their e-mail address, login or key' }),
    group: Args.string({ required: true, description: "the group's name" }),
  }
  static override flags = { ...profileFlags }
  static override audit = {
    category: 'member',
    action: 'LeaveGroup',
    entityType: 'Member',
  } as const
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: changedFields,
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MembersGroupsLeave)
    return this.changeOne(
      flags,
      args.member,
      { removeGroups: [args.group] },
      {
        done: (who) => `${who} has left ${args.group}`,
        same: (who) => `${who} was not in ${args.group}: no change`,
      },
    )
  }
}
