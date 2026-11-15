import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { describeMember, memberState, withMembers } from '../../support/members.ts'
import { sayValues } from '../../support/pages.ts'
import { profileFlags } from '../../support/remote.ts'

/** One member, with what the Members section shows of them (story 354). */
export default class MembersShow extends BaseCommand {
  static override summary = 'one member: their type, groups, sign-in and values'
  static override description =
    'Values are shown in the shorthand `members new` and `members update` take. A sensitive value is shown only to the Sensitive data group, and always with nobody signed in.'
  static override examples = ['<%= config.bin %> members show ana@example.com']
  static override args = {
    member: Args.string({ required: true, description: 'their e-mail address, login or key' }),
  }
  static override flags = { ...profileFlags }
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    stdoutSchema: {},
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MembersShow)
    return withMembers(flags, 'members', async (site) => {
      const member = await site.show(args.member)
      const state = memberState(member)
      this.say(`${describeMember(member)}  (${member.type})`)
      this.say(`  key        ${member.key}`)
      this.say(`  login      ${member.login}`)
      this.say(`  groups     ${member.groups.join(', ') || 'none'}`)
      this.say(`  state      ${state.length > 0 ? state.join(', ') : 'can sign in'}`)
      if (member.twoFactor) this.say('  two-factor on')
      this.say(`  signed in  ${member.lastSignIn ?? 'never'}`)
      if (member.failedSignIns > 0)
        this.say(`  failed     ${member.failedSignIns} sign-ins since the last that worked`)
      sayValues(this, member.values)
      return member
    })
  }
}
