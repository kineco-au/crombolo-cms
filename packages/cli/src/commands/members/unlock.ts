import { Args } from '@oclif/core'
import { changedFields, MemberCommand } from '../../support/members.ts'
import { profileFlags } from '../../support/remote.ts'

export default class MembersUnlock extends MemberCommand {
  static override summary = "clear a member's lockout and failed sign-ins"
  static override args = {
    member: Args.string({ required: true, description: 'their e-mail address, login or key' }),
  }
  static override flags = { ...profileFlags }
  static override audit = { category: 'member', action: 'Unlock', entityType: 'Member' } as const
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: changedFields,
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MembersUnlock)
    return this.changeOne(
      flags,
      args.member,
      { locked: false },
      {
        done: (who) => `${who} can sign in again`,
        same: (who) => `${who} was not locked out: no change`,
      },
    )
  }
}
