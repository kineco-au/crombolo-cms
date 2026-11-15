import { Args, Flags } from '@oclif/core'
import { CliError } from '../../errors.ts'
import {
  changedFields,
  describeMember,
  MemberCommand,
  summaryOf,
  withMembers,
} from '../../support/members.ts'
import { setsOf } from '../../support/pages.ts'
import { readStdin } from '../../support/prompt.ts'
import { profileFlags } from '../../support/remote.ts'

/** A new member, approved, as the Members section makes one (story 354). */
export default class MembersNew extends MemberCommand {
  static override summary = 'make a member, with their type, groups and values'
  static override description = [
    'Values are in the shorthand `content new` takes. Their login is their e-mail address unless --login gives another.',
    'With no password from --stdin, they sign in only through an identity provider.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> members new ana@example.com --type member --name "Ana Lee" --group Subscribers',
    'printf %s "$PASSWORD" | <%= config.bin %> members new ana@example.com --type member --stdin',
  ]
  static override args = {
    email: Args.string({ required: true, description: 'their e-mail address' }),
  }
  static override flags = {
    type: Flags.string({ required: true, summary: 'the member type', helpValue: '<alias>' }),
    login: Flags.string({ summary: 'their login; their e-mail address when left out' }),
    name: Flags.string({ summary: 'their name; their login when left out' }),
    group: Flags.string({
      summary: 'a member group they join',
      helpValue: '<name>',
      multiple: true,
    }),
    set: Flags.string({
      summary: 'a value, in the shorthand content files use; JSON for a toggle, number or list',
      helpValue: '<property>=<value>',
      multiple: true,
    }),
    'set-file': Flags.string({
      summary: 'a value read from a file',
      helpValue: '<property>=<file>',
      multiple: true,
    }),
    stdin: Flags.boolean({ summary: 'read their password from stdin' }),
    ...profileFlags,
  }
  static override audit = { category: 'member', action: 'Create', entityType: 'Member' } as const
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: changedFields,
    errors: ['not_found', 'conflict', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MembersNew)
    const password = flags.stdin ? await readStdin() : undefined
    if (flags.stdin && !password)
      throw new CliError('usage', 'Nothing came on stdin to use as the password.')
    const sets = setsOf(flags.set, flags['set-file'])
    return withMembers(flags, 'members', async (site) => {
      const member = await site.create({
        email: args.email,
        type: flags.type,
        login: flags.login,
        name: flags.name,
        groups: flags.group ?? [],
        sets,
        password,
      })
      this.noted(site, member.key)
      this.say(`  made ${describeMember(member)}, a ${member.type}`)
      if (member.groups.length > 0) this.say(`  in   ${member.groups.join(', ')}`)
      if (member.signsIn === 'provider')
        this.say(
          `\nThey sign in only through an identity provider: \`crombolo members reset-password ${member.login} --stdin\` gives them a password.`,
        )
      return { ...summaryOf(member), changed: true }
    })
  }
}
