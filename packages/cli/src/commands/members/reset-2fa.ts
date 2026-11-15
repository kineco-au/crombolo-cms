import { Args } from '@oclif/core'
import { changedFields, MemberCommand } from '../../support/members.ts'
import { profileFlags } from '../../support/remote.ts'

export default class MembersResetTwoFactor extends MemberCommand {
  static override summary = "remove a member's second factor, for one who lost their device"
  static override args = {
    member: Args.string({ required: true, description: 'their e-mail address, login or key' }),
  }
  static override flags = { ...profileFlags }
  static override audit = {
    category: 'member',
    action: 'ResetTwoFactor',
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
    const { args, flags } = await this.parse(MembersResetTwoFactor)
    return this.changeOne(
      flags,
      args.member,
      { twoFactor: false },
      {
        done: (who) => `${who} signs in without a second factor now, and can set one up again`,
        same: (who) => `${who} had no second factor: no change`,
      },
    )
  }
}
