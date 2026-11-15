import { Args } from '@oclif/core'
import { changedFields, MemberCommand } from '../../../support/members.ts'
import { profileFlags } from '../../../support/remote.ts'

export default class MembersGroupsAdd extends MemberCommand {
  static override summary = 'add a member to a group'
  static override args = {
    member: Args.string({ required: true, description: 'their e-mail address, login or key' }),
    group: Args.string({ required: true, description: "the group's name" }),
  }
  static override flags = { ...profileFlags }
  static override audit = { category: 'member', action: 'JoinGroup', entityType: 'Member' } as const
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: changedFields,
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MembersGroupsAdd)
    return this.changeOne(
      flags,
      args.member,
      { addGroups: [args.group] },
      {
        done: (who) => `${who} is in ${args.group} now`,
        same: (who) => `${who} was in ${args.group} already: no change`,
      },
    )
  }
}
