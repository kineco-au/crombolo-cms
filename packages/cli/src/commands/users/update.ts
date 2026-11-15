import { Args, Flags } from '@oclif/core'
import { profileFlags } from '../../support/remote.ts'
import { describeUser, UserCommand, userSummaryFields, withUsers } from '../../support/users.ts'

const FIELD_WORDS = {
  name: 'name',
  email: 'e-mail',
  userName: 'username',
  groups: 'groups',
  uiLanguage: 'language',
} as const

/** A user's name, e-mail, groups or language changed; what is not named is kept (story 356). */
export default class UsersUpdate extends UserCommand {
  static override summary = "change a user's name, e-mail, groups or language"
  static override description =
    "What is not named is kept. Only an administrator changes an administrator's account, and anyone else adds people to, or takes them out of, only the groups they own. Where a user works is their groups': `users groups update` sets where a group starts."
  static override examples = [
    '<%= config.bin %> users update ada@example.com --name "Ada King"',
    '<%= config.bin %> users update ada@example.com --group editor --remove-group writer',
  ]
  static override args = {
    user: Args.string({ required: true, description: 'their e-mail address, username or key' }),
  }
  static override flags = {
    name: Flags.string({ summary: 'their new name', helpValue: '<name>' }),
    email: Flags.string({ summary: 'their new e-mail address', helpValue: '<email>' }),
    group: Flags.string({ summary: 'a group they join', helpValue: '<alias>', multiple: true }),
    'remove-group': Flags.string({
      summary: 'a group they leave',
      helpValue: '<alias>',
      multiple: true,
    }),
    'ui-language': Flags.string({
      summary: 'the language the back office shows them, such as en-US',
      helpValue: '<iso>',
    }),
    ...profileFlags,
  }
  static override audit = { category: 'user', action: 'Save', entityType: 'User' } as const
  static override access = 'site' as const
  static override section = 'users' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      ...userSummaryFields,
      {
        name: 'changed',
        type: 'array',
        items: { type: 'string', enum: ['name', 'email', 'userName', 'groups', 'uiLanguage'] },
        description: 'what changed; empty when it was so already',
      },
    ],
    errors: ['not_found', 'conflict', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(UsersUpdate)
    return withUsers(flags, async (site) => {
      const user = await site.find(args.user)
      const done = await site.change(user.key, {
        ...(flags.name !== undefined ? { name: flags.name } : {}),
        ...(flags.email !== undefined ? { email: flags.email } : {}),
        ...(flags['ui-language'] !== undefined ? { uiLanguage: flags['ui-language'] } : {}),
        addGroups: flags.group ?? [],
        removeGroups: flags['remove-group'] ?? [],
      })
      this.noted(site, done.user.key, done.changed.length > 0)
      this.say(
        done.changed.length > 0
          ? `  saved    ${describeUser(done.user)}: ${done.changed.map((f) => FIELD_WORDS[f]).join(', ')}`
          : `  ${describeUser(done.user)}: no change`,
      )
      return { ...done.user, changed: done.changed }
    })
  }
}
