import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { signedInPerson } from '../../../support/acting.ts'
import { profileFlags } from '../../../support/remote.ts'
import { describeSignIn, signInFields, withUsers } from '../../../support/users.ts'

/** A user's open sign-ins, in browsers and terminals (story 356). */
export default class UsersSessions extends BaseCommand {
  static override summary = 'the browsers and terminals signed in as you, or as someone else'
  static override description =
    'Yours, with no user named. Only an administrator sees someone else’s. `users sessions end <id>` ends one, by the id listed.'
  static override examples = [
    '<%= config.bin %> users sessions',
    '<%= config.bin %> users sessions ada@example.com --profile production',
  ]
  static override args = {
    user: Args.string({
      description: 'whose: their e-mail address, username or key; yours when left out',
    }),
  }
  static override flags = { ...profileFlags }
  static override access = 'site' as const
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      { name: 'items', type: 'array', items: { type: 'object', fields: signInFields } },
    ],
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(UsersSessions)
    return withUsers(flags, async (site) => {
      if (!args.user && !site.hosted && !signedInPerson())
        this.fail(
          'usage',
          'Nobody is signed in to this site, so name whose sign-ins to list.',
          'Give their e-mail address: `crombolo users sessions <user>`.',
        )
      const user = args.user ? await site.find(args.user) : undefined
      const items = await site.signIns(user?.key)
      if (items.length === 0)
        this.say(user ? `${user.name} is not signed in anywhere.` : 'No open sign-ins.')
      for (const signIn of items) this.say(describeSignIn(signIn))
      return { items }
    })
  }
}
