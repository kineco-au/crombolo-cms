import { Args, Flags } from '@oclif/core'
import { CliError } from '../../errors.ts'
import { describeMember, MemberCommand, withMembers } from '../../support/members.ts'
import { readStdin } from '../../support/prompt.ts'
import { profileFlags } from '../../support/remote.ts'

/** A member given a new password, as the Members section gives one (story 354). */
export default class MembersResetPassword extends MemberCommand {
  static override summary = 'give a member a new password, and end their sessions'
  static override description = [
    'A new one is made and printed once, unless --stdin gives it. Pass it on to them yourself: no link is sent.',
    'A member who signs in only through an identity provider has no password to reset; --stdin gives them one deliberately.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> members reset-password ana@example.com',
    'printf %s "$PASSWORD" | <%= config.bin %> members reset-password ana@example.com --stdin',
  ]
  static override args = {
    member: Args.string({ required: true, description: 'their e-mail address, login or key' }),
  }
  static override flags = {
    stdin: Flags.boolean({ summary: 'read the new password from stdin' }),
    ...profileFlags,
  }
  static override audit = {
    category: 'member',
    action: 'ResetPassword',
    entityType: 'Member',
  } as const
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'key', type: 'string' },
      { name: 'email', type: 'string' },
      {
        name: 'password',
        type: 'string',
        nullable: true,
        description: 'the one made; null when given',
      },
    ],
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MembersResetPassword)
    const given = flags.stdin ? await readStdin() : undefined
    if (flags.stdin && !given)
      throw new CliError('usage', 'Nothing came on stdin to use as the password.')
    return withMembers(flags, 'members', async (site) => {
      const member = await site.show(args.member)
      if (!given && member.signsIn === 'provider')
        throw new CliError(
          'refused',
          `${describeMember(member)} signs in only through an identity provider, so has no password to reset.`,
          { hint: 'To give them one all the same, pass it with --stdin.' },
        )
      const done = await site.change(
        member.key,
        given ? { password: given } : { generatePassword: true },
      )
      this.noted(site, member.key)
      this.say(`  ${describeMember(member)} has a new password, and their sessions are ended`)
      if (done.password) this.say(done.password)
      return { key: member.key, email: member.email, password: done.password }
    })
  }
}
