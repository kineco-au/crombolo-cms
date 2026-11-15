import { Args } from '@oclif/core'
import { changedFields, MemberCommand } from '../../support/members.ts'
import { profileFlags } from '../../support/remote.ts'

export default class MembersApprove extends MemberCommand {
  static override summary = 'approve a member, so they can sign in'
  static override args = {
    member: Args.string({ required: true, description: 'their e-mail address, login or key' }),
  }
  static override flags = { ...profileFlags }
  static override audit = { category: 'member', action: 'Approve', entityType: 'Member' } as const
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: changedFields,
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MembersApprove)
    return this.changeOne(
      flags,
      args.member,
      { approved: true },
      {
        done: (who) => `${who} is approved, and can sign in`,
        same: (who) => `${who} was approved already: no change`,
      },
    )
  }
}
