import { Args } from '@oclif/core'
import { profileFlags } from '../../../support/remote.ts'
import { signInFields, signInKind, UserCommand, withUsers } from '../../../support/users.ts'

/** One open sign-in ended, by the id `users sessions` lists (story 356). */
export default class UsersSessionsEnd extends UserCommand {
  static override summary = 'end one sign-in, by the id `users sessions` lists'
  static override description =
    'Yours, or anyone’s for an administrator. Whoever it was signs in again to go on.'
  static override examples = ['<%= config.bin %> users sessions end 3f2a9c1d']
  static override args = {
    id: Args.string({ required: true, description: 'the id listed, or more of it' }),
  }
  static override flags = { ...profileFlags }
  static override audit = { category: 'user', action: 'EndSession', entityType: 'User' } as const
  static override access = 'site' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: signInFields,
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(UsersSessionsEnd)
    return withUsers(flags, async (site) => {
      const ended = await site.endSignIn(args.id)
      this.noted(site, ended.user.key)
      this.say(`  ended    ${ended.user.name}'s sign-in in ${signInKind(ended)}`)
      if (ended.current)
        this.say('  That was this terminal’s own sign-in: `crombolo logout` signs out next time.')
      return ended
    })
  }
}
