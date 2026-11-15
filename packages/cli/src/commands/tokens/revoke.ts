import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { refuseNamed } from '../../profiles/choose.ts'
import { openTokens, tokenFields, tokenFlags, userFlag } from '../../support/tokens.ts'

export default class TokensRevoke extends BaseCommand {
  static override summary = 'stop a command-line token working, by its name'
  static override examples = [
    '<%= config.bin %> tokens revoke deploy',
    '<%= config.bin %> tokens revoke nightly --user ada@example.com',
  ]
  static override args = {
    name: Args.string({ required: true, description: 'the name it was given' }),
  }
  static override flags = { user: userFlag, ...tokenFlags }
  static override access = 'person' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: tokenFields,
    errors: ['auth', 'refused', 'not_found'],
  } as const

  async run() {
    const { args, flags } = await this.parse(TokensRevoke)
    refuseNamed(flags.remote)
    const revoked = await (await openTokens(flags)).revoke(args.name, flags.user)
    this.say(`  revoked  "${revoked.name}"`)
    return revoked
  }
}
