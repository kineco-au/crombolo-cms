import { Args, Flags } from '@oclif/core'
import { describeMember, MemberCommand, withMembers } from '../../support/members.ts'
import { confirm } from '../../support/prompt.ts'
import { profileFlags } from '../../support/remote.ts'

/** A member removed for good, out of their groups, as the Members section deletes one (story 354). */
export default class MembersRemove extends MemberCommand {
  static override summary = 'remove a member for good, with their groups and sign-ins'
  static override description = 'Asks first, unless --yes.'
  static override examples = ['<%= config.bin %> members remove ana@example.com --yes']
  static override args = {
    member: Args.string({ required: true, description: 'their e-mail address, login or key' }),
  }
  static override flags = {
    yes: Flags.boolean({ summary: "don't ask" }),
    ...profileFlags,
  }
  static override audit = { category: 'member', action: 'Delete', entityType: 'Member' } as const
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    confirmationBypassArg: '--yes',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'email', type: 'string' },
      {
        name: 'groups',
        type: 'array',
        items: { type: 'string' },
        description: 'the groups they were in',
      },
    ],
    errors: ['not_found', 'confirmation_required', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MembersRemove)
    return withMembers(flags, 'members', async (site) => {
      const member = await site.show(args.member)
      if (!flags.yes)
        await confirm(`Remove ${describeMember(member)} for good? [y/N]`, { bypass: '--yes' })
      const gone = await site.remove(member.key)
      this.noted(site, gone.key)
      this.say(
        `  removed ${describeMember(gone)}, who was in ${gone.groups.length > 0 ? gone.groups.join(', ') : 'no group'}`,
      )
      return { key: gone.key, email: gone.email, groups: gone.groups }
    })
  }
}
