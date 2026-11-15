import { Args } from '@oclif/core'
import { profileFlags } from '../../support/remote.ts'
import { describeUser, UserCommand, userSummaryFields, withUsers } from '../../support/users.ts'

/** A user removed for good, as the Users section deletes one (story 356). */
export default class UsersRemove extends UserCommand {
  static override summary = 'remove a user who has never signed in'
  static override description =
    "Someone who has signed in is disabled instead, with `users disable`, so what they did keeps their name. You can't remove yourself, the site's built-in administrator, or the last administrator."
  static override examples = ['<%= config.bin %> users remove ada@example.com']
  static override args = {
    user: Args.string({ required: true, description: 'their e-mail address, username or key' }),
  }
  static override flags = { ...profileFlags }
  static override audit = { category: 'user', action: 'Delete', entityType: 'User' } as const
  static override access = 'site' as const
  static override section = 'users' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: userSummaryFields,
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(UsersRemove)
    return withUsers(flags, async (site) => {
      const user = await site.find(args.user)
      const gone = await site.remove(user.key)
      this.noted(site, gone.key)
      this.say(`  removed  ${describeUser(gone)}`)
      return gone
    })
  }
}
