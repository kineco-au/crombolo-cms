import { Args, Flags } from '@oclif/core'
import { CliError } from '../../errors.ts'
import { describeMember, MemberCommand, withMembers } from '../../support/members.ts'
import { readStdin } from '../../support/prompt.ts'
import { profileFlags } from '../../support/remote.ts'

/**
 * A member's password reset (stories 354, 282): the reset link sent where the site sends
 * mail, or printed; `--password` gives them a new one directly, as the Members section does.
 */
export default class MembersResetPassword extends MemberCommand {
  static override summary = 'send a member a link to set a new password, or give them one'
  static override description = [
    "By default the member is sent a link to the site's own page for setting a password (members.resetPasswordPage), where the site sends mail; where it cannot, the link is printed for you to pass on.",
    '--password gives them a new one directly and ends their sessions: one is made and printed once, unless --stdin gives it.',
    'A member who signs in only through an identity provider has no password to reset; --password gives them one deliberately.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> members reset-password ana@example.com',
    '<%= config.bin %> members reset-password ana@example.com --password',
    'printf %s "$PASSWORD" | <%= config.bin %> members reset-password ana@example.com --password --stdin',
  ]
  static override args = {
    member: Args.string({ required: true, description: 'their e-mail address, login or key' }),
  }
  static override flags = {
    password: Flags.boolean({ summary: 'give them a new password instead of a link' }),
    stdin: Flags.boolean({
      summary: 'read the new password from stdin',
      dependsOn: ['password'],
    }),
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
      { name: 'sent', type: 'boolean', description: 'whether a link went by e-mail' },
      {
        name: 'link',
        type: 'string',
        nullable: true,
        description: 'the link, when it could not be sent',
      },
      {
        name: 'password',
        type: 'string',
        nullable: true,
        description: 'with --password, the one made; null when given or for a link',
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
      if (!flags.password) {
        const done = await site.resetLink(member.key)
        this.noted(site, member.key)
        if (done.sent)
          this.say(`  a link to set a new password is on its way to ${describeMember(member)}`)
        else {
          this.say(`  this site cannot send mail; pass this link to ${describeMember(member)}:`)
          this.say(done.link ?? '')
        }
        return {
          key: member.key,
          email: member.email,
          sent: done.sent,
          link: done.link ?? null,
          password: null,
        }
      }
      const done = await site.change(
        member.key,
        given ? { password: given } : { generatePassword: true },
      )
      this.noted(site, member.key)
      this.say(`  ${describeMember(member)} has a new password, and their sessions are ended`)
      if (done.password) this.say(done.password)
      return {
        key: member.key,
        email: member.email,
        sent: false,
        link: null,
        password: done.password ?? null,
      }
    })
  }
}
