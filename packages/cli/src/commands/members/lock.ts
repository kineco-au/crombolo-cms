import { Args } from '@oclif/core'
import { changedFields, MemberCommand } from '../../support/members.ts'
import { profileFlags } from '../../support/remote.ts'

export default class MembersLock extends MemberCommand {
  static override summary = 'lock a member out, so they cannot sign in until unlocked'
  static override args = {
    member: Args.string({ required: true, description: 'their e-mail address, login or key' }),
  }
  static override flags = { ...profileFlags }
  static override audit = { category: 'member', action: 'Lock', entityType: 'Member' } as const
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: changedFields,
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MembersLock)
    return this.changeOne(
      flags,
      args.member,
      { locked: true },
      {
        done: (who) => `${who} is locked out`,
        same: (who) => `${who} was locked out already: no change`,
      },
    )
  }
}
