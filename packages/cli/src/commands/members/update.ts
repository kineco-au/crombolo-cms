import { Args, Flags } from '@oclif/core'
import { changedFields, MemberCommand } from '../../support/members.ts'
import { setsOf } from '../../support/pages.ts'
import { profileFlags } from '../../support/remote.ts'

/** A member's details and groups changed; what is not named is kept (story 354). */
export default class MembersUpdate extends MemberCommand {
  static override summary = "change a member's e-mail, login, name, values or groups"
  static override description =
    'Values are in the shorthand `content update` takes; what is not named is kept. A sensitive value is changed only by the Sensitive data group, or with nobody signed in.'
  static override examples = [
    '<%= config.bin %> members update ana@example.com --name "Ana Lee-Park" --set phone=0400111222',
    '<%= config.bin %> members update ana@example.com --group Staff --remove-group Subscribers',
  ]
  static override args = {
    member: Args.string({ required: true, description: 'their e-mail address, login or key' }),
  }
  static override flags = {
    email: Flags.string({ summary: 'their new e-mail address' }),
    login: Flags.string({ summary: 'their new login' }),
    name: Flags.string({ summary: 'their new name' }),
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
    unset: Flags.string({ summary: 'clear a value', helpValue: '<property>', multiple: true }),
    group: Flags.string({ summary: 'a group they join', helpValue: '<name>', multiple: true }),
    'remove-group': Flags.string({
      summary: 'a group they leave',
      helpValue: '<name>',
      multiple: true,
    }),
    ...profileFlags,
  }
  static override audit = { category: 'member', action: 'Save', entityType: 'Member' } as const
  static override access = 'site' as const
  static override section = 'members' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: changedFields,
    errors: ['not_found', 'conflict', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MembersUpdate)
    return this.changeOne(
      flags,
      args.member,
      {
        ...(flags.email !== undefined ? { email: flags.email } : {}),
        ...(flags.login !== undefined ? { login: flags.login } : {}),
        ...(flags.name !== undefined ? { name: flags.name } : {}),
        sets: setsOf(flags.set, flags['set-file']),
        unset: flags.unset ?? [],
        addGroups: flags.group ?? [],
        removeGroups: flags['remove-group'] ?? [],
      },
      { done: (who) => `saved ${who}`, same: (who) => `${who}: no change` },
    )
  }
}
